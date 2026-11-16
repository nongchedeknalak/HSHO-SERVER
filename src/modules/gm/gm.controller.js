const Player = require('@models/player.model');
const staticJson = require('@utils/static-json.util');
const inventoryService = require('@services/inventory.service');

exports.getMe = async (req, res) => res.json({
  status: 1,
  data: { steamId: req.player.steamId, isGM: true, profile: req.player.profile },
});

exports.getPlayer = async (req, res) => {
  try {
    const player = await Player.findOne({ steamId: String(req.params.steamId) });
    if (!player) return res.status(404).json({ status: 0, error: 'Player not found' });
    return res.json({
      status: 1,
      data: {
        steamId: player.steamId,
        profile: player.profile,
        currencies: { coin: player.coin, amethyst: player.amethyst, amulet: player.amulet },
        inventory: player.inventory || {},
        curseRelic: Array.isArray(player.curseRelic) ? player.curseRelic : [],
        playerStat: player.playerStat || {},
        isOnline: player.isOnline,
        lastOnline: player.lastOnline,
      },
    });
  } catch (error) {
    console.error('GM get player error:', error);
    return res.status(500).json({ status: 0, error: 'Internal server error' });
  }
};

// Grant/update one relic by its exact ShortCode from the bundled relic catalogue.
exports.grantRelic = async (req, res) => {
  try {
    const { shortCode, level = 1, maxDurability = 20, currentDurability = maxDurability } = req.body || {};
    if (typeof shortCode !== 'string' || !/^([A-Za-z0-9_]){1,80}$/.test(shortCode)) {
      return res.status(400).json({ status: 0, error: 'Valid shortCode is required' });
    }
    for (const [name, value] of Object.entries({ level, maxDurability, currentDurability })) {
      if (!Number.isInteger(value) || value < 0 || value > 100000) {
        return res.status(400).json({ status: 0, error: `${name} must be a non-negative integer` });
      }
    }
    if (currentDurability > maxDurability) {
      return res.status(400).json({ status: 0, error: 'currentDurability cannot exceed maxDurability' });
    }

    const catalogue = await staticJson.load('static/player/curserelic.json');
    const known = new Set((catalogue?.data?.curseRelic || []).map((item) => item.ShortCode));
    if (!known.has(shortCode)) {
      return res.status(404).json({ status: 0, error: 'Relic ShortCode is not in this server catalogue' });
    }

    const player = await Player.findOne({ steamId: String(req.params.steamId) });
    if (!player) return res.status(404).json({ status: 0, error: 'Player not found' });
    player.curseRelic = Array.isArray(player.curseRelic) ? player.curseRelic : [];
    const entry = { ShortCode: shortCode, Level: level, MaxDurability: maxDurability, CurrentDurability: currentDurability };
    const index = player.curseRelic.findIndex((item) => item.ShortCode === shortCode);
    if (index >= 0) player.curseRelic[index] = entry;
    else player.curseRelic.push(entry);
    player.markModified('curseRelic');
    await player.save();
    return res.json({ status: 1, data: { steamId: player.steamId, relic: entry, ownedRelics: player.curseRelic } });
  } catch (error) {
    console.error('GM grant relic error:', error);
    return res.status(500).json({ status: 0, error: 'Internal server error' });
  }
};

exports.grantItem = async (req, res) => {
  try {
    const { itemId, quantity = 1 } = req.body || {};
    if (typeof itemId !== 'string' || !/^[A-Za-z0-9_]{1,100}$/.test(itemId)) {
      return res.status(400).json({ status: 0, error: 'Valid itemId is required' });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      return res.status(400).json({ status: 0, error: 'quantity must be between 1 and 10000' });
    }
    const player = await Player.findOne({ steamId: String(req.params.steamId) });
    if (!player) return res.status(404).json({ status: 0, error: 'Player not found' });
    const result = await inventoryService.addItemToInventory(player, itemId, quantity);
    return res.json({ status: 1, data: result });
  } catch (error) {
    console.error('GM grant item error:', error);
    return res.status(500).json({ status: 0, error: 'Internal server error' });
  }
};
