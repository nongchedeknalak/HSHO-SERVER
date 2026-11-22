const storeService = require('@services/store.service');
const { sendError, sendSuccess } = require('@utils/response.util');

// Custom Shop API. Listings come from data/static/store/custom/shop.json (see CUSTOM_SHOP.md).
// Purchases go through the same store service as the in-game shop (atomic, limits, refunds).

function balances(player) {
  return {
    coin: Number(player.coin || 0),
    amethyst: Number(player.amethyst || 0),
    amulet: Number(player.amulet || 0),
  };
}

async function listShop(player) {
  const catalog = await storeService.getCatalog();
  const mine = [...catalog.byId.values()].filter((product) => product.customShelf);

  const view = (product) => ({
    productListingId: product._id,
    shortCode: product.shortCode,
    name: product.title,
    description: product.description,
    price: product.priceTags[0].price,
    currency: storeService.resolvePrice(product, 0).currency,
    limitPerUser: product.maxQuantityPerUser,
    shelf: product.customShelf,
    items: product.itemsInBundle,
  });

  return {
    balances: balances(player),
    items: mine.filter((product) => product.tags.includes('item')).map(view),
    bundles: mine.filter((product) => product.tags.includes('bundle')).map(view),
    problems: storeService.customProblems,
  };
}

async function buy(req, res, shortCode, quantity) {
  try {
    const result = await storeService.purchase(req.player.steamId, { shortCode, quantity });

    return sendSuccess(res, {
      productListingId: result.product._id,
      items: result.itemAddResult,
      currency: result.currency,
      quantity: result.quantity,
      totalPrice: result.totalPrice,
      balances: balances(result.player),
    });
  } catch (error) {
    if (error.name === 'StoreError') {
      return sendError(res, error.statusCode, error.message);
    }

    console.error('Custom shop purchase error:', error);
    return sendError(res, 500, 'Purchase failed');
  }
}

exports.list = async (req, res) => {
  try {
    return sendSuccess(res, await listShop(req.player));
  } catch (error) {
    console.error('Custom shop list error:', error);
    return sendError(res, 500, 'Could not load shop');
  }
};

exports.buyItem = async (req, res) => {
  const { itemId, quantity } = req.body || {};

  if (!itemId) {
    return sendError(res, 400, 'itemId is required');
  }

  return buy(req, res, `Shop_${itemId}`, quantity);
};

exports.buyBundle = async (req, res) => {
  const bundleId = req.body?.bundleId;

  if (!bundleId) {
    return sendError(res, 400, 'bundleId is required');
  }

  return buy(req, res, `Bundle_${bundleId}`, 1);
};
