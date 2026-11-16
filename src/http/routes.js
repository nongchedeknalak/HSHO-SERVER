const express = require('express');

const staticJson = require('@utils/static-json.util');

const playerRoutes = require('../modules/players/player.routes');
const storeRoutes = require('../modules/shop/shop.routes');
const inventoryRoutes = require('../modules/inventory/inventory.routes');
const immortalRoutes = require('../modules/authentication/immortal.routes');
const gameRoutes = require('../modules/game-session/game.routes');
const gachaRoutes = require('../modules/gacha/gacha.routes');
const gmRoutes = require('../modules/gm/gm.routes');
const relicController = require('@controllers/relic.controller');
const authController = require('@controllers/auth.controller');

const router = express.Router();

const LOOT_BOX_FILE_MAP = {
  Default_Gacha: 'static/pots/greedy.json',
  Bullet_Gacha: 'static/pots/bullet.json',
};

router.use('/live/player', playerRoutes);
router.use('/live/player', inventoryRoutes);
router.use('/live', gameRoutes);
router.use('/live', storeRoutes);
router.use('/live', immortalRoutes);
router.use('/live/lootboxgo', gachaRoutes);
router.use('/live/gm', gmRoutes);

router.use('/live/immortal/get', staticJson.serve('static/player/immortal.json'));
router.route('/live/player/curserelic/get')
  .get(authController.verifySession, relicController.getOwnedRelics)
  .post(authController.verifySession, relicController.getOwnedRelics);

router.get('/live/lootboxgo/api/items', (req, res) => {
  const file = LOOT_BOX_FILE_MAP[req.query.loot_box_short_code];
  if (!file) {
    return res.status(404).json({ error: 'Loot box not found' });
  }
  return staticJson.serve(file)(req, res);
});

// Log any /live request nobody handles, so you can see which endpoints the game client still needs.
router.use('/live', (req, res) => {
  console.warn(`Unhandled request: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ status: 0, data: null, error: 'Not found' });
});

module.exports = router;
