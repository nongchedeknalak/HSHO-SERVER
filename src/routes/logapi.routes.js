const router = require('express').Router();
const logapi = require('@controllers/logapi.controller');
router.post('/check/penalty', logapi.checkPenalty);
router.post('/add/matchlog', logapi.addMatchLog);
router.post('/check/serverdetect', logapi.serverDetect);
module.exports = router;
