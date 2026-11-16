const express = require('express');
const router = express.Router();

const gacha = require('@controllers/gacha.controller');
const authController = require('@controllers/auth.controller');

router.post('/api/open', authController.verifySession, gacha.OpenLootBox);

module.exports = router;
