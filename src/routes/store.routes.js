const router = require('express').Router();
const staticJson = require('@utils/static-json.util');

const authController = require('@controllers/auth.controller');
const storeController = require('@controllers/store.controller');
const { Taglist } = require('@controllers/store.taglist.controller');

router.post('/productlisting/list', staticJson.serve('static/store/P_List.json'));
router.post('/item/listall', staticJson.serve('static/store/I_List.json'));
router.post('/store/list', staticJson.serve('static/store/S_List.json'));
router.post('/store/productlisting/list/tag', Taglist);

// Buy a product with in-game currency (coin / amethyst / amulet)
router.post('/store/purchase', authController.verifySession, storeController.purchase);

module.exports = router;
