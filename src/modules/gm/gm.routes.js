const router = require('express').Router();
const auth = require('@controllers/auth.controller');
const gm = require('@controllers/gm.controller');

router.use(auth.verifySession, auth.requireDeveloper.bind(auth));
router.get('/me', gm.getMe);
router.get('/player/:steamId', gm.getPlayer);
router.post('/player/:steamId/relic', gm.grantRelic);
router.post('/player/:steamId/item', gm.grantItem);

module.exports = router;
