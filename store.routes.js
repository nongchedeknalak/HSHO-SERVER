const router = require('express').Router();
const staticJson = require('@utils/static-json.util');

const authController = require('@controllers/auth.controller');
const storeController = require('@controllers/store.controller');
const { Taglist } = require('@controllers/store.taglist.controller');

router.post('/productlisting/list', storeController.productListing);
router.post('/item/listall', staticJson.serve('static/store/I_List.json'));
router.post('/store/list', storeController.storeList);
router.post('/store/productlisting/list/tag', Taglist);

// Buy with coin / amethyst / amulet. Mounted under /live by routes/index.js.
router.post('/store/purchase', authController.verifySession, storeController.purchase);

module.exports = router;
