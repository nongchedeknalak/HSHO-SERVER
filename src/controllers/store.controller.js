const storeService = require('@services/store.service');
const { sendError } = require('@utils/response.util');

exports.purchase = async (req, res) => {
  try {
    const body = req.body || {};

    const result = await storeService.purchase(req.player.steamId, {
      productListingId: body.productListingId || body.productId,
      shortCode: body.shortCode,
      quantity: body.quantity,
      selectedPriceTagIndex: body.selectedPriceTagIndex,
    });

    console.log(
      `Purchase: ${req.player.steamId} bought ${result.quantity}x ${result.product.shortCode} ` +
        `for ${result.totalPrice} ${result.currency}`
    );

    return res.status(200).json(storeService.buildPurchaseResponse(result));
  } catch (error) {
    if (error.name === 'StoreError') {
      return sendError(res, error.statusCode, error.message);
    }

    console.error('Purchase error:', error);
    return sendError(res, 500, 'Internal server error');
  }
};

exports.productListing = async (req, res) => {
  try {
    return res.status(200).json(await storeService.getProductListingResponse());
  } catch (error) {
    console.error('productListing error:', error);
    return sendError(res, 500, 'Failed to load product listing');
  }
};

exports.storeList = async (req, res) => {
  try {
    return res.status(200).json(await storeService.getStoreListResponse());
  } catch (error) {
    console.error('storeList error:', error);
    return sendError(res, 500, 'Failed to load store list');
  }
};

exports.reload = async (req, res) => {
  try {
    return res.status(200).json({ status: 200, data: await storeService.reload() });
  } catch (error) {
    console.error('store reload error:', error);
    return sendError(res, 500, 'Failed to reload store');
  }
};

// Developer accounts only: add (or remove, with a negative number) coin / amethyst / amulet.
// Body: { "coin": 100000, "amethyst": 500, "amulet": 50, "steamId": "optional, default = yourself" }
exports.grant = async (req, res) => {
  try {
    const Player = require('@models/player.model');
    const inc = {};
    for (const field of ['coin', 'amethyst', 'amulet']) {
      const value = req.body?.[field];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || Math.abs(value) > 1e9) {
        return sendError(res, 400, `${field} must be an integer`);
      }
      inc[field] = value;
    }
    if (Object.keys(inc).length === 0) {
      return sendError(res, 400, 'Send at least one of coin, amethyst, amulet');
    }
    const target = String(req.body?.steamId || req.player.steamId);
    const updated = await Player.findOneAndUpdate({ steamId: target }, { $inc: inc }, { new: true });
    if (!updated) return sendError(res, 404, 'Player not found');
    return res.status(200).json({ status: 200, data: { steamId: target, coin: updated.coin, amethyst: updated.amethyst, amulet: updated.amulet } });
  } catch (error) {
    console.error('grant error:', error);
    return sendError(res, 500, 'Could not grant currency');
  }
};
