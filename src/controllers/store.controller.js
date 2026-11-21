'use strict';

const storeService = require('@services/store.service');
const StoreError = require('@services/store.service').StoreError;
const { sendError } = require('@utils/response.util');

exports.productListing = async (req, res) => {
  try {
    return res.status(200).json(await storeService.getProductListingResponse());
  } catch (error) {
    console.error('[Store] productListing failed:', error);
    return sendError(res, 500, 'Failed to load product listing');
  }
};

exports.storeList = async (req, res) => {
  try {
    return res.status(200).json(await storeService.getStoreListResponse());
  } catch (error) {
    console.error('[Store] storeList failed:', error);
    return sendError(res, 500, 'Failed to load store list');
  }
};

exports.reload = async (req, res) => {
  try {
    return res.status(200).json({ status: 200, data: await storeService.reload() });
  } catch (error) {
    console.error('[Store] reload failed:', error);
    return sendError(res, 500, 'Failed to reload store');
  }
};

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
      `[Store] ${req.player.steamId} bought ${result.quantity}x ${result.product.shortCode} ` +
        `for ${result.totalPrice} ${result.currency}`
    );

    return res.status(200).json(storeService.buildPurchaseResponse(result));
  } catch (error) {
    if (error instanceof StoreError) {
      return sendError(res, error.statusCode, error.message);
    }

    console.error('[Store] purchase failed:', error);
    return sendError(res, 500, 'Internal server error');
  }
};
