const crypto = require('crypto');

const config = require('@config');
const Player = require('@models/player.model');
const staticJsonUtil = require('@utils/static-json.util');
const inventoryService = require('@services/inventory.service');

const TAGLIST_FILES = [
  'static/store/taglist/C_Survivor.json',
  'static/store/taglist/C_Hunter.json',
  'static/store/taglist/P_Survivor.json',
  'static/store/taglist/P_Hunter.json',
  'static/store/taglist/Effect_Hunter.json',
];

const CATALOG_TTL_MS = 30 * 1000;

class StoreError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'StoreError';
    this.statusCode = statusCode;
  }
}

class StoreService {
  constructor() {
    this.catalog = null;
    this.catalogBuiltAt = 0;
    this.locks = new Map();
  }

  // ---------------------------------------------------------------- catalog

  async safeLoad(file) {
    try {
      return await staticJsonUtil.load(file);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`Store: could not read ${file}:`, error.message);
      }
      return null;
    }
  }

  // Every product the client can see: P_List, S_List shelves, the tag lists, and the old full list.
  async collectProducts() {
    const products = [];

    const productList = await this.safeLoad('static/store/P_List.json');
    if (Array.isArray(productList?.data?.productListing)) {
      products.push(...productList.data.productListing);
    }

    const storeList = await this.safeLoad('static/store/S_List.json');
    for (const store of storeList?.data?.store || []) {
      products.push(...(store.productListingOnShelfWithTitle || []));
    }

    for (const file of TAGLIST_FILES) {
      const tagList = await this.safeLoad(file);
      products.push(...(tagList?.data?.bundles || []));
    }

    const oldList = await this.safeLoad('static/store/OLD/P_List.json');
    if (Array.isArray(oldList?.data?.productListing)) {
      products.push(...oldList.data.productListing);
    }

    return products;
  }

  async getCatalog() {
    const fresh = Date.now() - this.catalogBuiltAt < CATALOG_TTL_MS;
    const cacheable = process.env.NODE_ENV === 'production' ? Boolean(this.catalog) : fresh;

    if (this.catalog && cacheable) {
      return this.catalog;
    }

    const byId = new Map();
    const byShortCode = new Map();

    for (const product of await this.collectProducts()) {
      if (!product?._id) {
        continue;
      }

      // The first source that defines a product wins (current lists before the OLD fallback).
      if (!byId.has(product._id)) {
        byId.set(product._id, product);
      }

      if (product.shortCode && !byShortCode.has(product.shortCode)) {
        byShortCode.set(product.shortCode, product);
      }
    }

    this.catalog = { byId, byShortCode };
    this.catalogBuiltAt = Date.now();
    return this.catalog;
  }

  async findProduct({ productListingId, shortCode }) {
    const catalog = await this.getCatalog();

    if (productListingId && catalog.byId.has(productListingId)) {
      return catalog.byId.get(productListingId);
    }

    if (shortCode && catalog.byShortCode.has(shortCode)) {
      return catalog.byShortCode.get(shortCode);
    }

    return null;
  }

  async getProductById(productListingId) {
    return this.findProduct({ productListingId });
  }

  async getStoreListings() {
    const storeData = await staticJsonUtil.load('static/store/S_List.json');
    return storeData.data.store;
  }

  async getAllProducts() {
    return [...(await this.getCatalog()).byId.values()];
  }

  // ------------------------------------------------------------ validation

  isListed(product, now = Date.now()) {
    if (product.isActive === false) {
      return false;
    }

    const policy = product.listingPolicy || {};
    const startAt = policy.startAt ? new Date(policy.startAt).getTime() : null;
    const endAt = policy.endAt ? new Date(policy.endAt).getTime() : null;

    if (startAt && now < startAt) {
      return false;
    }

    // type 3 is a limited-time listing; any listing with an endAt expires.
    if (endAt && now > endAt) {
      return false;
    }

    return true;
  }

  isDiscountActive(product, now = Date.now()) {
    if (!Array.isArray(product.discountPriceTags) || product.discountPriceTags.length === 0) {
      return false;
    }

    const policy = product.discountPolicy || {};
    const startAt = policy.startAt ? new Date(policy.startAt).getTime() : null;
    const endAt = policy.endAt ? new Date(policy.endAt).getTime() : null;

    return !(startAt && now < startAt) && !(endAt && now > endAt);
  }

  resolvePrice(product, selectedPriceTagIndex = 0) {
    const useDiscount = this.isDiscountActive(product);
    const priceTags = useDiscount ? product.discountPriceTags : product.priceTags;

    if (!Array.isArray(priceTags) || priceTags.length === 0) {
      throw new StoreError(400, 'This product is not sold with in-game currency');
    }

    const index = Number.isInteger(selectedPriceTagIndex) ? selectedPriceTagIndex : 0;
    const priceTag = priceTags[index];

    if (!priceTag) {
      throw new StoreError(400, 'Invalid price tag');
    }

    const currency = config.store.currencyMap[priceTag.currencyType];

    if (!currency) {
      throw new StoreError(400, 'This product is not sold with in-game currency');
    }

    if (!Number.isInteger(priceTag.price) || priceTag.price < 0) {
      throw new StoreError(400, 'Invalid product price');
    }

    return { currency, unitPrice: priceTag.price, index, isDiscount: useDiscount };
  }

  validateQuantity(quantity) {
    const amount = quantity === undefined ? 1 : quantity;

    if (!Number.isInteger(amount) || amount < 1 || amount > config.store.maxPurchaseQuantity) {
      throw new StoreError(400, 'Invalid quantity');
    }

    return amount;
  }

  // ------------------------------------------------------------- purchase

  // Serialise purchases per player so two quick requests cannot overwrite each other's inventory.
  async withPlayerLock(steamId, task) {
    const previous = this.locks.get(steamId) || Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});

    this.locks.set(steamId, tail);
    tail.then(() => {
      if (this.locks.get(steamId) === tail) {
        this.locks.delete(steamId);
      }
    });

    return run;
  }

  async purchase(steamId, request) {
    return this.withPlayerLock(steamId, () => this.executePurchase(steamId, request));
  }

  async executePurchase(steamId, { productListingId, shortCode, quantity, selectedPriceTagIndex }) {
    const product = await this.findProduct({ productListingId, shortCode });

    if (!product) {
      throw new StoreError(404, 'Product not found');
    }

    if (!this.isListed(product)) {
      throw new StoreError(400, 'Product is not available');
    }

    const amount = this.validateQuantity(quantity);
    const { currency, unitPrice, index, isDiscount } = this.resolvePrice(
      product,
      selectedPriceTagIndex
    );
    const totalPrice = unitPrice * amount;

    const bundleItems = (product.itemsInBundle || []).filter((entry) => entry?.shortCode);

    if (bundleItems.length === 0) {
      throw new StoreError(400, 'Product has no items');
    }

    const player = await Player.findOne({ steamId });

    if (!player) {
      throw new StoreError(404, 'Player not found');
    }

    const maxPerUser = Number.isInteger(product.maxQuantityPerUser) ? product.maxQuantityPerUser : null;
    const alreadyBought = player.purchaseCounts?.[product._id] || 0;

    if (maxPerUser !== null && alreadyBought + amount > maxPerUser) {
      throw new StoreError(409, 'Purchase limit reached for this product');
    }

    const allUnique = bundleItems.every(
      (entry) => inventoryService.resolveInventoryCategory(entry.shortCode) !== 'items'
    );

    if (
      allUnique &&
      bundleItems.every((entry) => inventoryService.isUniqueItemOwned(player, entry.shortCode))
    ) {
      throw new StoreError(409, 'You already own everything in this product');
    }

    // 1) Debit atomically: the filter fails if the balance is too low or the limit was just reached.
    const countPath = `purchaseCounts.${product._id}`;
    const orderId = crypto.randomUUID();
    const logEntry = {
      orderId,
      productListingId: product._id,
      shortCode: product.shortCode,
      title: product.title,
      currency,
      unitPrice,
      quantity: amount,
      totalPrice,
      isDiscount,
      createdAt: new Date(),
    };

    const filter = { steamId, [currency]: { $gte: totalPrice } };
    if (maxPerUser !== null) {
      filter[countPath] = { $not: { $gt: maxPerUser - amount } };
    }

    const debited = await Player.findOneAndUpdate(
      filter,
      {
        $inc: { [currency]: -totalPrice, [countPath]: amount },
        $push: { purchaseLog: { $each: [logEntry], $slice: -200 } },
      },
      { new: true }
    );

    if (!debited) {
      const latest = await Player.findOne({ steamId });
      if (!latest) {
        throw new StoreError(404, 'Player not found');
      }
      if ((latest[currency] || 0) < totalPrice) {
        throw new StoreError(400, `Not enough ${currency}`);
      }
      throw new StoreError(409, 'Purchase limit reached for this product');
    }

    // 2) Grant the items. If that fails, give the money back.
    const itemAddResult = {};

    try {
      const fresh = await Player.findOne({ steamId });

      if (!fresh.inventory) {
        fresh.inventory = {};
      }

      for (const entry of bundleItems) {
        const grant = (Number.isInteger(entry.amount) && entry.amount > 0 ? entry.amount : 1) * amount;
        inventoryService.applyItemToInventory(fresh.inventory, entry.shortCode, grant);
        itemAddResult[entry.shortCode] = (itemAddResult[entry.shortCode] || 0) + grant;
      }

      fresh.markModified('inventory');
      await fresh.save();
    } catch (error) {
      console.error('Purchase item grant failed, refunding:', error);
      await Player.updateOne(
        { steamId },
        {
          $inc: { [currency]: totalPrice, [countPath]: -amount },
          $pull: { purchaseLog: { orderId } },
        }
      );
      throw new StoreError(500, 'Could not add items to inventory, you were not charged');
    }

    const finalPlayer = await Player.findOne({ steamId });

    return {
      orderId,
      product,
      currency,
      unitPrice,
      totalPrice,
      quantity: amount,
      priceTagIndex: index,
      isDiscount,
      itemAddResult,
      logEntry,
      player: finalPlayer,
    };
  }

  buildPurchaseResponse(result) {
    const { player, product, orderId, currency, totalPrice, quantity, priceTagIndex } = result;
    const now = new Date().toISOString();

    // Same shape as data/static/store/purchase.json
    return {
      data: {
        currentCurrency: {
          coin: player.coin || 0,
          amethyst: player.amethyst || 0,
          amulet: player.amulet || 0,
        },
        purchasing: {
          _id: orderId,
          orderId,
          userId: player.steamId,
          displayName: player.profile?.displayName || '',
          type_currency: currency,
          balance: player[currency] || 0,
          status: 0,
          purchasingToken: '',
          productListingId: product._id,
          redeemCode: null,
          purchasedBundleInfos: {
            title: product.title,
            descript: product.description,
            shortCode: product.shortCode,
            itemsInBundle: product.itemsInBundle,
            currency_type: product.priceTags?.[priceTagIndex]?.currencyType ?? null,
            price: totalPrice,
            quantity,
          },
          selectedPriceTagIndex: priceTagIndex,
          platformSpecificInfo: { country: '', currency: '' },
          isDiscount: result.isDiscount,
          remark: 'from finalize purchasing',
          updatedAt: now,
          createdAt: now,
          completedAt: now,
        },
        purchasingLog: {
          _id: orderId,
          userId: player.steamId,
          status: 1,
          purchasingId: orderId,
          purchasingToken: '',
          productListingId: product._id,
          remark: 'from finalize purchasing',
          compensationInfo: {},
          logRefs: {
            itemAdd: [
              {
                playerId: player.steamId,
                itemChanges: result.itemAddResult,
                remark: 'from purchasing',
                timeStamp: now,
                _id: orderId,
              },
            ],
          },
          createdAt: now,
        },
        itemAddResult: result.itemAddResult,
      },
      status: 200,
      mime: 'application/json',
    };
  }
}

module.exports = new StoreService();
module.exports.StoreError = StoreError;
