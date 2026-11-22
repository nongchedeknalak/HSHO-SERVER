const crypto = require('crypto');

const config = require('@config');
const Player = require('@models/player.model');
const staticJsonUtil = require('@utils/static-json.util');
const inventoryService = require('@services/inventory.service');
const { withPlayerLock } = require('@utils/player-lock.util');

const TAGLIST_FILES = [
  'static/store/taglist/C_Survivor.json',
  'static/store/taglist/C_Hunter.json',
  'static/store/taglist/P_Survivor.json',
  'static/store/taglist/P_Hunter.json',
  'static/store/taglist/Effect_Hunter.json',
];

const CATALOG_TTL_MS = 30 * 1000;

const CURRENCY_ITEM_CODES = { coin: 'coin', amethyst: 'amethyst', amulet: 'amulet' };
const DEFAULT_SHELF = 'direct_sale_store';
// Where your own products appear in the game's shop when no "shelf" is given
const DEFAULT_SHELF_BY_CURRENCY = {
  coin: 'direct_sale_store',
  amethyst: 'amethys_store',
  amulet: 'amulet_store',
};
// Pot tickets are not inventory items in this server: buying them raises the pot counters
const COUNTER_ITEM_FIELDS = { Default_Gacha: 'lootBoxAmount', Bullet_Gacha: 'bulletAmount' };
const SHORT_CODE_PATTERN = /^[A-Za-z0-9_]{1,80}$/;

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
    this.customProblems = [];
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
    const products = [...(await this.loadCustomProducts())];

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

  // ------------------------------------------------------ custom bundles

  async getKnownItemCodes() {
    const itemList = await this.safeLoad('static/store/I_List.json');
    return new Set((itemList?.data?.items || []).map((item) => item.shortCode));
  }

  customProductId(shortCode) {
    // Stable 24-hex id (same shape as the original Mongo ids) derived from the short code
    return crypto.createHash('sha1').update(`rin-custom:${shortCode}`).digest('hex').slice(0, 24);
  }

  customCurrencyType(currency) {
    const entry = Object.entries(config.store.currencyMap).find(([, field]) => field === currency);
    return entry ? Number(entry[0]) : null;
  }

  // Turns one entry of data/custom/bundles.json into a product in the client's format.
  // Throws Error with a readable reason when the entry is invalid.
  buildCustomProduct(def, knownItems) {
    if (!def || !SHORT_CODE_PATTERN.test(def.shortCode || '')) {
      throw new Error('shortCode must be letters, digits and _ only');
    }

    const currencyType = this.customCurrencyType(def.currency);
    if (currencyType === null) {
      throw new Error('currency must be coin, amethyst or amulet');
    }

    if (!Number.isInteger(def.price) || def.price < 0) {
      throw new Error('price must be a whole number >= 0');
    }

    if (!Array.isArray(def.items) || def.items.length === 0) {
      throw new Error('items is empty');
    }

    if (!/^[A-Za-z0-9_]{1,80}$/.test(def.shortCode)) {
      throw new Error('id must be letters, digits and _ only');
    }

    const itemsInBundle = def.items.map((entry) => {
      const code = entry?.shortCode;
      const amount = entry?.amount ?? 1;
      const isCurrency = CURRENCY_ITEM_CODES[String(code).toLowerCase()];

      if (config.store.blockSkins && inventoryService.resolveInventoryCategory(String(code)) === 'skins') {
        throw new Error(`"${code}" is a skin - skins can only be won from the Greedy Pot`);
      }

      if (!isCurrency && !knownItems.has(code)) {
        throw new Error(`unknown item "${code}" (not in I_List.json)`);
      }

      if (!Number.isInteger(amount) || amount < 1) {
        throw new Error(`bad amount for "${code}"`);
      }

      return { amount, shortCode: code };
    });

    if (def.limitPerUser !== null && def.limitPerUser !== undefined) {
      if (!Number.isInteger(def.limitPerUser) || def.limitPerUser < 1) {
        throw new Error('limitPerUser must be null or a whole number >= 1');
      }
    }

    const now = new Date().toISOString();
    const listingPolicy = { type: def.endAt ? 3 : 1, startAt: def.startAt || now };
    if (def.endAt) {
      listingPolicy.endAt = def.endAt;
    }

    return {
      _id: this.customProductId(def.shortCode),
      title: def.title || def.shortCode,
      description: def.description || '',
      shortCode: def.shortCode,
      steamProductId: null,
      imageURL: def.imageURL || '',
      tags: Array.isArray(def.tags) && def.tags.length ? def.tags : ['bundle'],
      isActive: true,
      itemsInBundle,
      maxQuantityPerUser: def.limitPerUser ?? null,
      priceTags: [{ currencyType, price: def.price }],
      discountPriceTags: [],
      listingPolicy,
      discountPolicy: {},
      createdAt: now,
      updatedAt: now,
      customShelf: def.shelf || DEFAULT_SHELF_BY_CURRENCY[def.currency] || DEFAULT_SHELF,
    };
  }

  // Reads data/static/store/custom/shop.json (see CUSTOM_SHOP.md) and turns every enabled
  // item and bundle into a product in the client's format.
  async loadCustomProducts() {
    const file = await this.safeLoad(config.store.shopFile);
    const data = file?.data || {};
    const fallbackCurrency = data.currency || 'coin';
    const knownItems = await this.getKnownItemCodes();
    const products = [];
    const problems = [];
    const seen = new Set();

    const add = (label, build) => {
      try {
        const product = build();
        if (seen.has(product.shortCode)) {
          throw new Error('duplicate id');
        }
        seen.add(product.shortCode);
        products.push(product);
      } catch (error) {
        problems.push(`${label}: ${error.message}`);
      }
    };

    for (const item of data.items || []) {
      if (item?.enabled === false) {
        continue;
      }

      add(`item ${item?.itemId}`, () =>
        this.buildCustomProduct(
          {
            shortCode: `Shop_${item.itemId}`,
            title: item.name || item.itemId,
            description: item.description,
            items: [{ shortCode: item.itemId, amount: 1 }],
            currency: item.currency || fallbackCurrency,
            price: Number(item.price),
            limitPerUser: item.limitPerUser ?? null,
            shelf: item.shelf,
            tags: ['item'],
          },
          knownItems
        )
      );
    }

    for (const bundle of data.bundles || []) {
      if (bundle?.enabled !== true) {
        continue;
      }

      add(`bundle ${bundle?.id}`, () =>
        this.buildCustomProduct(
          {
            shortCode: `Bundle_${bundle.id}`,
            title: bundle.name || bundle.id,
            description: bundle.description,
            items: (bundle.items || []).map((entry) => ({
              shortCode: entry.itemId,
              amount: entry.quantity ?? 1,
            })),
            currency: bundle.currency || fallbackCurrency,
            price: Number(bundle.price),
            limitPerUser: bundle.limitPerUser ?? null,
            shelf: bundle.shelf,
            tags: ['bundle'],
          },
          knownItems
        )
      );
    }

    problems.forEach((problem) => console.warn(`Custom shop entry skipped - ${problem}`));
    this.customProblems = problems;
    return products;
  }

  // Drops the cached catalog so edits to bundles.json show up immediately.
  async reload() {
    this.catalog = null;
    this.catalogBuiltAt = 0;
    const catalog = await this.getCatalog();
    return {
      products: catalog.byId.size,
      customBundles: [...catalog.byId.values()].filter((p) => p.customShelf).length,
      problems: this.customProblems,
    };
  }

  // ------------------------------------------------------------ listings

  // Character skins are not for sale: they can only be won from the Greedy Pot.
  isSkinLocked(product) {
    return (
      config.store.blockSkins &&
      (product?.itemsInBundle || []).some(
        (entry) => inventoryService.resolveInventoryCategory(String(entry?.shortCode)) === 'skins'
      )
    );
  }

  isSellable(product) {
    return Boolean(product) && this.isListed(product) && !this.isSkinLocked(product);
  }

  // Products for /live/productlisting/list: current P_List.json when filled in, else the original
  // server's list, plus your custom bundles.
  async getProductListingResponse() {
    const current = await this.safeLoad('static/store/P_List.json');
    const old = await this.safeLoad('static/store/OLD/P_List.json');
    const base = Array.isArray(current?.data?.productListing)
      ? current.data.productListing
      : old?.data?.productListing || [];

    const catalog = await this.getCatalog();
    const custom = [...catalog.byId.values()].filter((product) => product.customShelf);
    const baseIds = new Set(base.map((product) => product._id));

    const productListing = [...base, ...custom.filter((product) => !baseIds.has(product._id))]
      .filter((product) => this.isSellable(product))
      .map(({ customShelf, ...product }) => product);

    return {
      data: {
        next: {},
        previous: {},
        totalDocument: productListing.length,
        productListing,
      },
      status: 200,
      mime: 'application/json',
    };
  }

  // Shelves for /live/store/list, with your custom bundles placed on the shelf they asked for.
  async getStoreListResponse() {
    const current = await this.safeLoad('static/store/S_List.json');
    const old = await this.safeLoad('static/store/OLD/S_List.json');
    const source = Array.isArray(current?.data?.store) && current.data.store.length > 0 ? current : old;

    const catalog = await this.getCatalog();
    const custom = [...catalog.byId.values()].filter((product) => product.customShelf);
    const stores = structuredClone(source?.data?.store || []);

    for (const shelf of stores) {
      const embedded = (shelf.productListingOnShelfWithTitle || []).filter(
        (product) => product.isActive === undefined || this.isSellable(product)
      );

      const ids = (shelf.productListingOnShelf || []).filter((id) => {
        const known = catalog.byId.get(id);
        return !known || this.isSellable(known);
      });

      for (const product of custom.filter((entry) => entry.customShelf === shelf.shortCode)) {
        const { customShelf, ...clean } = product;
        if (!ids.includes(clean._id)) {
          ids.push(clean._id);
        }
        if (Array.isArray(shelf.productListingOnShelfWithTitle) && !embedded.some((p) => p._id === clean._id)) {
          embedded.push(clean);
        }
      }

      shelf.productListingOnShelf = ids;
      if (Array.isArray(shelf.productListingOnShelfWithTitle)) {
        shelf.productListingOnShelfWithTitle = embedded;
      }
    }

    return {
      data: { next: {}, previous: {}, store: stores },
      status: 200,
      mime: 'application/json',
    };
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

    if (!config.store.enforceListingWindow) {
      return true;
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

    if (!config.store.enforceListingWindow) {
      return true;
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

  async purchase(steamId, request) {
    return withPlayerLock(steamId, () => this.executePurchase(steamId, request));
  }

  async executePurchase(steamId, { productListingId, shortCode, quantity, selectedPriceTagIndex }) {
    const product = await this.findProduct({ productListingId, shortCode });

    if (!product) {
      throw new StoreError(404, 'Product not found');
    }

    if (!this.isListed(product)) {
      throw new StoreError(400, 'Product is not available');
    }

    if (this.isSkinLocked(product)) {
      throw new StoreError(400, 'Skins can only be won from the Greedy Pot');
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
        const currencyField = CURRENCY_ITEM_CODES[String(entry.shortCode).toLowerCase()];
        const counterField = COUNTER_ITEM_FIELDS[entry.shortCode];

        if (counterField) {
          fresh.inventory[counterField] = (Number(fresh.inventory[counterField]) || 0) + grant;
        } else if (currencyField) {
          // "coin" / "amethyst" / "amulet" inside a bundle pays out currency, not an inventory item
          fresh[currencyField] = (fresh[currencyField] || 0) + grant;
        } else {
          inventoryService.applyItemToInventory(fresh.inventory, entry.shortCode, grant);
        }

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
