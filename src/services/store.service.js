'use strict';

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
const SHORT_CODE_PATTERN = /^[A-Za-z0-9_]{1,80}$/;
const DEFAULT_SHELF = 'direct_sale_store';

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

  // ------------------------------------------------------ custom bundles

  async getKnownItemCodes() {
    const itemList = await this.safeLoad('static/store/I_List.json');
    return new Set((itemList?.data?.items || []).map((item) => item.shortCode));
  }

  // Stable 24-hex id derived from the short code, same shape as the original ids.
  customProductId(shortCode) {
    return crypto
      .createHash('sha1')
      .update(`rin-custom:${shortCode}`)
      .digest('hex')
      .slice(0, 24);
  }

  customCurrencyType(currency) {
    const entry = Object.entries(config.store.currencyMap).find(([, field]) => field === currency);
    return entry ? Number(entry[0]) : null;
  }

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

    const itemsInBundle = def.items.map((entry) => {
      const code = entry?.shortCode;
      const amount = entry?.amount ?? 1;
      const isCurrency = CURRENCY_ITEM_CODES[String(code).toLowerCase()];

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
      listingPolicy: { type: def.endAt ? 3 : 1, startAt: def.startAt || now, ...(def.endAt ? { endAt: def.endAt } : {}) },
      discountPolicy: {},
      createdAt: now,
      updatedAt: now,
      customShelf: def.shelf || DEFAULT_SHELF,
    };
  }

  async loadCustomProducts() {
    const file = await this.safeLoad(config.store.customBundlesFile);
    const knownItems = await this.getKnownItemCodes();
    const products = [];
    const problems = [];
    const seen = new Set();

    for (const def of file?.bundles || []) {
      if (def?.enabled !== true) continue;

      try {
        const product = this.buildCustomProduct(def, knownItems);
        if (seen.has(product.shortCode)) throw new Error('duplicate shortCode');
        seen.add(product.shortCode);
        products.push(product);
      } catch (error) {
        problems.push(`${def?.shortCode || '(no shortCode)'}: ${error.message}`);
      }
    }

    problems.forEach((problem) => console.warn(`[Store] custom bundle skipped - ${problem}`));
    this.customProblems = problems;
    return products;
  }

  // Drops the cached catalog so edits to bundles.json show up without a restart.
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

  // P_List/S_List are empty stubs on this server, so OLD/ is used as the real
  // catalogue. Whatever is in the current files still wins when present.
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

    const oldStore = await this.safeLoad('static/store/OLD/S_List.json');
    for (const store of oldStore?.data?.store || []) {
      products.push(...(store.productListingOnShelfWithTitle || []));
    }

    return products;
  }

  async getCatalog() {
    if (this.catalog && Date.now() - this.catalogBuiltAt < CATALOG_TTL_MS) {
      return this.catalog;
    }

    const byId = new Map();
    const byShortCode = new Map();

    for (const product of await this.collectProducts()) {
      if (!product?._id) continue;

      // First source wins: current lists before the OLD fallback.
      if (!byId.has(product._id)) byId.set(product._id, product);
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

  async getAllProducts() {
    return [...(await this.getCatalog()).byId.values()];
  }

  async getStoreListings() {
    return (await this.safeLoad('static/store/S_List.json'))?.data?.store || [];
  }

  // -------------------------------------------------------------- listings

  isListed(product, now = Date.now()) {
    if (!product || product.isActive === false) return false;
    if (!config.store.enforceListingWindow) return true;

    const policy = product.listingPolicy || {};
    const startAt = policy.startAt ? new Date(policy.startAt).getTime() : null;
    const endAt = policy.endAt ? new Date(policy.endAt).getTime() : null;

    return !(startAt && now < startAt) && !(endAt && now > endAt);
  }

  async getProductListingResponse() {
    const current = await this.safeLoad('static/store/P_List.json');
    const old = await this.safeLoad('static/store/OLD/P_List.json');
    const base = Array.isArray(current?.data?.productListing) && current.data.productListing.length > 0
      ? current.data.productListing
      : old?.data?.productListing || [];

    const catalog = await this.getCatalog();
    const custom = [...catalog.byId.values()].filter((product) => product.customShelf);
    const baseIds = new Set(base.map((product) => product._id));

    const productListing = [...base, ...custom.filter((product) => !baseIds.has(product._id))]
      .filter((product) => this.isListed(product))
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

  async getStoreListResponse() {
    const current = await this.safeLoad('static/store/S_List.json');
    const old = await this.safeLoad('static/store/OLD/S_List.json');
    const source =
      Array.isArray(current?.data?.store) && current.data.store.length > 0 ? current : old;

    const catalog = await this.getCatalog();
    const custom = [...catalog.byId.values()].filter((product) => product.customShelf);
    const stores = structuredClone(source?.data?.store || []);

    for (const shelf of stores) {
      shelf.productListingOnShelfWithTitle = (shelf.productListingOnShelfWithTitle || []).filter(
        (product) => product.isActive === undefined || this.isListed(product)
      );

      const ids = Array.isArray(shelf.productListingOnShelf)
        ? [...shelf.productListingOnShelf]
        : [];

      for (const product of custom.filter((entry) => entry.customShelf === shelf.shortCode)) {
        const { customShelf, ...clean } = product;
        if (!ids.includes(clean._id)) ids.push(clean._id);
        if (!shelf.productListingOnShelfWithTitle.some((p) => p._id === clean._id)) {
          shelf.productListingOnShelfWithTitle.push(clean);
        }
      }

      shelf.productListingOnShelf = ids;
    }

    return {
      data: { next: {}, previous: {}, store: stores },
      status: 200,
      mime: 'application/json',
    };
  }

  // ------------------------------------------------------------- validation

  isDiscountActive(product, now = Date.now()) {
    if (!Array.isArray(product.discountPriceTags) || product.discountPriceTags.length === 0) {
      return false;
    }
    if (!config.store.enforceListingWindow) return true;

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
    if (!priceTag) throw new StoreError(400, 'Invalid price tag');

    const currency = config.store.currencyMap[priceTag.currencyType];
    if (!currency) throw new StoreError(400, 'This product is not sold with in-game currency');

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

  isUniqueItemOwned(player, shortCode) {
    if (inventoryService.resolveInventoryCategory(shortCode) === 'items') return false;
    return Object.values(player.inventory || {}).some(
      (value) => Array.isArray(value) && value.includes(shortCode)
    );
  }

  // -------------------------------------------------------------- purchase

  purchase(steamId, request) {
    return withPlayerLock(String(steamId), () => this.executePurchase(steamId, request));
  }

  async executePurchase(steamId, { productListingId, shortCode, quantity, selectedPriceTagIndex }) {
    const product = await this.findProduct({ productListingId, shortCode });
    if (!product) throw new StoreError(404, 'Product not found');
    if (!this.isListed(product)) throw new StoreError(400, 'Product is not available');

    const amount = this.validateQuantity(quantity);
    const { currency, unitPrice, index, isDiscount } = this.resolvePrice(
      product,
      selectedPriceTagIndex
    );
    const totalPrice = unitPrice * amount;

    const bundleItems = (product.itemsInBundle || []).filter((entry) => entry?.shortCode);
    if (bundleItems.length === 0) throw new StoreError(400, 'Product has no items');

    const player = await Player.findOne({ steamId });
    if (!player) throw new StoreError(404, 'Player not found');

    // Mongo field paths cannot contain dots or '$'.
    const countKey = String(product._id).replace(/[.$]/g, '_');
    const countPath = `purchaseCounts.${countKey}`;
    const maxPerUser = Number.isInteger(product.maxQuantityPerUser)
      ? product.maxQuantityPerUser
      : null;
    const alreadyBought = player.purchaseCounts?.[countKey] || 0;

    if (maxPerUser !== null && alreadyBought + amount > maxPerUser) {
      throw new StoreError(409, 'Purchase limit reached for this product');
    }

    const allUnique = bundleItems.every(
      (entry) => inventoryService.resolveInventoryCategory(entry.shortCode) !== 'items'
    );
    if (allUnique && bundleItems.every((entry) => this.isUniqueItemOwned(player, entry.shortCode))) {
      throw new StoreError(409, 'You already own everything in this product');
    }

    // 1) Debit atomically: the filter fails if the balance is too low or the limit was reached.
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
      if (!latest) throw new StoreError(404, 'Player not found');
      if ((latest[currency] || 0) < totalPrice) {
        throw new StoreError(400, `Not enough ${currency}`);
      }
      throw new StoreError(409, 'Purchase limit reached for this product');
    }

    // 2) Grant the items. Refund if anything fails.
    const itemAddResult = {};
    try {
      const fresh = await Player.findOne({ steamId });
      if (!fresh.inventory) fresh.inventory = {};

      for (const entry of bundleItems) {
        const grant = (Number.isInteger(entry.amount) && entry.amount > 0 ? entry.amount : 1) * amount;
        const currencyField = CURRENCY_ITEM_CODES[String(entry.shortCode).toLowerCase()];

        if (currencyField) {
          fresh[currencyField] = (fresh[currencyField] || 0) + grant;
        } else {
          inventoryService.ensureInventoryArrays(fresh.inventory);
          const category = inventoryService.resolveInventoryCategory(entry.shortCode);

          if (category === 'items') {
            const existingIndex = fresh.inventory.items.indexOf(entry.shortCode);
            if (existingIndex > -1) {
              fresh.inventory.itemCounts[existingIndex] =
                (fresh.inventory.itemCounts[existingIndex] || 0) + grant;
            } else {
              fresh.inventory.items.push(entry.shortCode);
              fresh.inventory.itemCounts.push(grant);
            }
          } else if (!fresh.inventory[category].includes(entry.shortCode)) {
            fresh.inventory[category].push(entry.shortCode);
          }
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

    // Same shape as data/static/store/purchase.json.
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
