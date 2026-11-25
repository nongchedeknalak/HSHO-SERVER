const router = require('express').Router();
const staticJson = require('@utils/static-json.util');

const authController = require('@controllers/auth.controller');
const storeController = require('@controllers/store.controller');
const { Taglist } = require('@controllers/store.taglist.controller');

router.post('/productlisting/list', storeController.productListing);
router.post('/item/listall', staticJson.serve('static/store/I_List.json'));
router.post('/store/list', storeController.storeList);
router.post('/store/productlisting/list/tag', Taglist);

// Buy a product with in-game currency (coin / amethyst / amulet)
router.post('/store/purchase', authController.verifySession, storeController.purchase);

// Developer accounts only: re-read data/custom/bundles.json without restarting the server
router.post(
  '/store/admin/reload',
  authController.verifySession,
  authController.requireDeveloper,
  storeController.reload
);

router.post(
  '/store/admin/grant',
  authController.verifySession,
  authController.requireDeveloper,
  storeController.grant
);

module.exports = router;
