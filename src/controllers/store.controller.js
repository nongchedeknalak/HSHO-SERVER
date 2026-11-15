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
