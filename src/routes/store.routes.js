const router = require('express').Router();
const staticJson = require('@utils/static-json.util');

const authController = require('@controllers/auth.controller');
const storeController = require('@controllers/store.controller');
const { Taglist } = require('@controllers/store.taglist.controller');

const serveItems = staticJson.serve('static/store/I_List.json');

// Both GET and POST are accepted — some game builds use GET for the shop pages.
router.route('/productlisting/list').get(storeController.productListing).post(storeController.productListing);
router.route('/item/listall').get(serveItems).post(serveItems);
router.route('/store/list').get(storeController.storeList).post(storeController.storeList);
router.route('/store/productlisting/list/tag').get(Taglist).post(Taglist);

// Buy with coin / amethyst / amulet. Mounted under /live by routes/index.js.
router.post('/store/purchase', authController.verifySession, storeController.purchase);

// Re-read data/custom/bundles.json without restarting (any logged-in account).
router.post('/store/admin/reload', authController.verifySession, storeController.reload);

module.exports = router;
