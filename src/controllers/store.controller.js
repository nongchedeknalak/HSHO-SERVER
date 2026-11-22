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
