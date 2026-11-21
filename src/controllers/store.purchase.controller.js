'use strict';

const crypto = require('crypto');

const Player = require('@models/player.model');
const inventoryService = require('@services/inventory.service');
const staticJson = require('@utils/static-json.util');
const { sendError } = require('@utils/response.util');

const CURRENCY_FIELDS = Object.freeze({ 1: 'coin', 2: 'amethyst', 4: 'amulet' });

// Bundle entries that are really currency or pot counters, not inventory items.
const CURRENCY_ITEMS = Object.freeze({ coin: 'coin', amethyst: 'amethyst', amulet: 'amulet' });
const POT_ITEMS = Object.freeze({ default_gacha: 'lootBoxAmount', bullet_gacha: 'bulletAmount' });

const TAGLIST_FILES = Object.freeze([
  'static/store/taglist/C_Survivor.json',
  'static/store/taglist/C_Hunter.json',
  'static/store/taglist/P_Survivor.json',
  'static/store/taglist/P_Hunter.json',
  'static/store/taglist/Effect_Hunter.json',
]);

const CATALOG_TTL_MS = 30_000;
let cachedCatalog = null;
let catalogBuiltAt = 0;

async function safeLoad(file) {
  try {
    return await staticJson.load(file);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[Store] could not read ${file}:`, err.message);
    return null;
  }
}

// The client displays products from several static lists. Build one lookup table
// so a purchase by id OR shortCode works no matter which shelf the item came from.
async function getCatalog() {
  if (cachedCatalog && Date.now() - catalogBuiltAt < CATALOG_TTL_MS) return cachedCatalog;
  const byId = new Map();
  const byShortCode = new Map();

  const add = (product) => {
    if (!product?._id) return;
    if (!byId.has(product._id)) byId.set(product._id, product);
    if (product.shortCode && !byShortCode.has(product.shortCode)) byShortCode.set(product.shortCode, product);
  };

  const productList = await safeLoad('static/store/P_List.json');
  (productList?.data?.productListing ?? []).forEach(add);

  const storeList = await safeLoad('static/store/S_List.json');
  for (const store of storeList?.data?.store ?? []) {
    (store.productListingOnShelfWithTitle ?? []).forEach(add);
  }
  for (const file of TAGLIST_FILES) {
    const tagList = await safeLoad(file);
    (tagList?.data?.bundles ?? []).forEach(add);
  }
  const oldList = await safeLoad('static/store/OLD/P_List.json');
  (oldList?.data?.productListing ?? []).forEach(add);

  cachedCatalog = { byId, byShortCode };
  catalogBuiltAt = Date.now();
  return cachedCatalog;
}

// The catalog lists a discount price next to the normal one. Charge what the shop shows:
// use the discount tag (same currency) while the discount window is open.
function resolvePriceTag(listing, priceIndex, now = new Date()) {
  const base = listing.priceTags?.[priceIndex];
  const discounts = Array.isArray(listing.discountPriceTags) ? listing.discountPriceTags : [];
  if (!base || discounts.length === 0) return base;
  const start = listing.discountPolicy?.startAt ? new Date(listing.discountPolicy.startAt) : null;
  const end = listing.discountPolicy?.endAt ? new Date(listing.discountPolicy.endAt) : null;
  if ((start && start > now) || (end && end < now)) return base;
  return discounts.find((tag) => Number(tag?.currencyType) === Number(base.currencyType)) ?? base;
}

function isListed(listing, now = new Date()) {
  if (listing.isActive === false) return false;
  const policy = listing.listingPolicy ?? {};
  const start = policy.startAt ? new Date(policy.startAt) : null;
  const end = policy.endAt ? new Date(policy.endAt) : null;
  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
}

function getListingId(body = {}) {
  return body.productListingId || body.productListingID || body.product_listing_id ||
    body.productId || body.product_id || body._id || body.id;
}

// Build the response in the same shape as data/static/store/purchase.json — this is
// what the game client reads after pressing Buy.
function buildPurchaseResponse(result) {
  const now = new Date().toISOString();
  const { orderId, listing, quantity, currencyField, price, granted, player } = result;
  return {
    data: {
      currentCurrency: {
        coin: player?.coin ?? 0,
        amethyst: player?.amethyst ?? 0,
        amulet: player?.amulet ?? 0,
      },
      purchasing: {
        _id: orderId,
        orderId,
        userId: String(player?._id ?? ''),
        displayName: player?.profile?.displayName ?? '',
        type_currency: currencyField,
        balance: player?.[currencyField] ?? 0,
        status: 0,
        purchasingToken: '',
        productListingId: listing._id,
        redeemCode: null,
        purchasedBundleInfos: {
          title: listing.title,
          descript: listing.description,
          shortCode: listing.shortCode,
          itemsInBundle: listing.itemsInBundle,
          currency_type: Number(listing.priceTags?.[0]?.currencyType) || null,
          price,
          quantity,
        },
        selectedPriceTagIndex: result.priceIndex,
        platformSpecificInfo: { country: '', currency: '' },
        isDiscount: result.isDiscount,
        remark: 'from finalize purchasing',
        updatedAt: now,
        createdAt: now,
        completedAt: now,
      },
      purchasingLog: {
        _id: orderId,
        userId: String(player?._id ?? ''),
        status: 1,
        purchasingId: orderId,
        purchasingToken: '',
        productListingId: listing._id,
        remark: 'from finalize purchasing',
        compensationInfo: {},
        logRefs: {
          itemAdd: [{
            playerId: String(player?._id ?? ''),
            itemChanges: Object.fromEntries(granted.map((g) => [g.shortCode, g.amount])),
            remark: 'from purchasing',
            timeStamp: now,
            _id: orderId,
          }],
        },
        createdAt: now,
      },
      itemAddResult: Object.fromEntries(granted.map((g) => [g.shortCode, g.amount])),
    },
    status: 200,
    mime: 'application/json',
  };
}

exports.purchase = async (req, res) => {
  const playerId = req.player?._id;
  if (!playerId) return sendError(res, 401, 'Unauthorized');

  let debitedCurrency = null;
  let debitedAmount = 0;
  try {
    const listingId = getListingId(req.body) ?? req.body?.shortCode ?? req.body?.shortcode;
    const quantity = Number.parseInt(req.body?.quantity ?? req.body?.amount ?? 1, 10);
    const priceIndex = Number.parseInt(req.body?.selectedPriceTagIndex ?? 0, 10);
    if (!listingId || typeof listingId !== 'string' ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 20 ||
        !Number.isInteger(priceIndex) || priceIndex < 0) {
      return sendError(res, 400, 'Invalid product or quantity');
    }

    const catalog = await getCatalog();
    const listing = catalog.byId.get(String(listingId)) ?? catalog.byShortCode.get(String(listingId));
    if (!listing || !isListed(listing)) return sendError(res, 404, 'Product not found or inactive');

    if (Number.isInteger(listing.maxQuantityPerUser) && listing.maxQuantityPerUser > 0 && quantity > listing.maxQuantityPerUser) {
      return sendError(res, 400, `Maximum quantity per purchase is ${listing.maxQuantityPerUser}`);
    }
    const priceTag = resolvePriceTag(listing, priceIndex);
    const currencyField = CURRENCY_FIELDS[Number(priceTag?.currencyType)];
    const unitPrice = Number(priceTag?.price);
    if (!currencyField || !Number.isSafeInteger(unitPrice) || unitPrice < 0) {
      return sendError(res, 400, 'Unsupported product currency or price');
    }
    if (!Array.isArray(listing.itemsInBundle) || listing.itemsInBundle.length === 0) {
      return sendError(res, 400, 'Product has no deliverable items');
    }

    // Read the freshest document: req.player can be stale for rapid purchases.
    const fresh = await Player.findById(playerId).lean();
    if (!fresh) return sendError(res, 404, 'Player not found');
    const purchaseKey = String(listing._id);
    const alreadyBought = Number(fresh.purchaseCounts?.[purchaseKey]) || 0;
    const relicEntries = listing.itemsInBundle.filter((e) => String(e?.shortCode || '').startsWith('Relic_'));
    const ownedRelics = Array.isArray(fresh.curseRelic) ? fresh.curseRelic : [];
    if (relicEntries.some((e) => ownedRelics.some((r) => (r?.ShortCode || r?.shortCode) === e.shortCode))) {
      return res.status(409).json({ status: 0, data: null, error: 'Item already owned' });
    }
    if (Number.isInteger(listing.maxQuantityPerUser) && listing.maxQuantityPerUser > 0 &&
        alreadyBought + quantity > listing.maxQuantityPerUser) {
      return sendError(res, 409, 'Purchase limit reached for this product');
    }

    // Do not charge again for a bundle made only of permanent items the player already owns.
    const isPermanent = (id) => typeof id === 'string' && id &&
      !CURRENCY_ITEMS[id.toLowerCase()] && !POT_ITEMS[id.toLowerCase()] &&
      inventoryService.resolveInventoryCategory(id) !== 'items';
    const bundleIds = listing.itemsInBundle.map((entry) => entry?.shortCode);
    if (bundleIds.every(isPermanent) && bundleIds.every((id) => inventoryService.playerOwnsItem(fresh, id))) {
      return res.status(409).json({ status: 0, data: null, error: 'Item already owned' });
    }

    const totalPrice = unitPrice * quantity;
    if (!Number.isSafeInteger(totalPrice)) return sendError(res, 400, 'Invalid total price');

    const orderId = crypto.randomUUID?.() ?? String(Date.now());
    const debited = await Player.findOneAndUpdate(
      { _id: playerId, [currencyField]: { $gte: totalPrice } },
      {
        $inc: { [currencyField]: -totalPrice, [`purchaseCounts.${purchaseKey}`]: quantity },
        $push: {
          purchaseLog: {
            $each: [{
              orderId,
              productListingId: listing._id,
              shortCode: listing.shortCode,
              title: listing.title,
              currency: currencyField,
              unitPrice,
              quantity,
              totalPrice,
              createdAt: new Date(),
            }],
            $slice: -200,
          },
        },
      },
      { new: true }
    );
    if (!debited) {
      const current = await Player.findById(playerId).select(currencyField).lean();
      return res.status(409).json({
        status: 0,
        data: { currency: currencyField, required: totalPrice, balance: Number(current?.[currencyField]) || 0 },
        error: 'Insufficient funds',
      });
    }
    debitedCurrency = currencyField;
    debitedAmount = totalPrice;

    const granted = [];
    const counters = {};
    const relicAdditions = [];
    try {
      for (const entry of listing.itemsInBundle) {
        const itemId = entry?.shortCode;
        const itemAmount = Number(entry?.amount ?? 1) * quantity;
        if (typeof itemId !== 'string' || !itemId || !Number.isInteger(itemAmount) || itemAmount < 1) {
          throw new Error('Invalid item in product bundle');
        }
        const lower = itemId.toLowerCase();
        if (CURRENCY_ITEMS[lower]) {
          counters[CURRENCY_ITEMS[lower]] = (counters[CURRENCY_ITEMS[lower]] ?? 0) + itemAmount;
        } else if (POT_ITEMS[lower]) {
          const key = `inventory.${POT_ITEMS[lower]}`;
          counters[key] = (counters[key] ?? 0) + itemAmount;
        } else if (itemId.startsWith('Relic_') || itemId.startsWith('Curse_')) {
          relicAdditions.push({ ShortCode: itemId, Level: 1, MaxDurability: 20, CurrentDurability: 20 });
        } else {
          await inventoryService.addItemToInventory(debited, itemId, itemAmount);
        }
        granted.push({ shortCode: itemId, amount: itemAmount });
      }
      if (relicAdditions.length) {
        const currentRelics = Array.isArray(debited.curseRelic) ? [...debited.curseRelic] : [];
        for (const relic of relicAdditions) {
          if (!currentRelics.some((r) => (r?.ShortCode || r?.shortCode) === relic.ShortCode)) currentRelics.push(relic);
        }
        await Player.updateOne({ _id: playerId }, { $set: { curseRelic: currentRelics } });
      }
      if (Object.keys(counters).length > 0) {
        await Player.updateOne({ _id: playerId }, { $inc: counters });
      }
    } catch (grantError) {
      await Player.updateOne(
        { _id: playerId },
        {
          $inc: {
            [currencyField]: totalPrice,
            [`purchaseCounts.${purchaseKey}`]: -quantity,
          },
          $pull: { purchaseLog: { orderId } },
        }
      );
      debitedCurrency = null;
      throw grantError;
    }

    const latest = await Player.findById(playerId);
    debitedCurrency = null; // purchase committed — never auto-refund after this point
    return res.status(200).json(buildPurchaseResponse({
      orderId,
      listing,
      quantity,
      currencyField,
      price: totalPrice,
      priceIndex,
      isDiscount: resolvePriceTag(listing, priceIndex) !== listing.priceTags?.[priceIndex],
      granted,
      player: latest,
    }));
  } catch (err) {
    if (debitedCurrency && debitedAmount > 0) {
      try { await Player.updateOne({ _id: playerId }, { $inc: { [debitedCurrency]: debitedAmount } }); } catch (_) { /* keep original error */ }
    }
    console.error('[StorePurchase] Purchase failed:', err);
    return sendError(res, 500, 'Purchase failed');
  }
};
