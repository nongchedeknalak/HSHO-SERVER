const staticJson = require('@utils/static-json.util');
const inventoryService = require('@services/inventory.service');
const Player = require('@models/player.model');
const { withPlayerLock } = require('@utils/player-lock.util');

// Roll weights per rarity (relative, they do not have to add up to 100).
// Easier odds: rarity 4 + 5 together are 50% of all rolls.
const RARITY_WEIGHTS = { 1: 10, 2: 15, 3: 25, 4: 30, 5: 20 };
const LOOT_BOX_FILES = {
  Default_Gacha: 'static/pots/greedy.json',
  Bullet_Gacha: 'static/pots/bullet.json',
};

// Weighted pick among the rarities that actually exist in the pot, then a random item of that rarity.
function chooseItem(items) {
  const present = [...new Set(items.map((item) => String(item.rarity)))];
  const weightOf = (rarity) => RARITY_WEIGHTS[rarity] ?? 1;
  const total = present.reduce((sum, rarity) => sum + weightOf(rarity), 0);

  let roll = Math.random() * total;
  let rarity = present[present.length - 1];
  for (const candidate of present) {
    roll -= weightOf(candidate);
    if (roll < 0) {
      rarity = candidate;
      break;
    }
  }

  const pool = items.filter((item) => String(item.rarity) === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}


const openLootBox = async (req, res) => {
  try {
    const player = req.player;
    if (!player) return res.status(401).json({ status: 'error', message: 'Unauthorized' });

    const { loot_box_short_code, amount } = req.body || {};
    if (!LOOT_BOX_FILES[loot_box_short_code]) {
      return res.status(400).json({ status: 'error', message: 'Invalid loot box type' });
    }
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      return res.status(400).json({ status: 'error', message: 'amount must be an integer between 1 and 100' });
    }

    // Only Default_Gacha uses the Greedy Pot counter. Bullet pot keeps its own counter.
    const inventory = player.inventory || (player.inventory = {});
    const counterKey = loot_box_short_code === 'Default_Gacha' ? 'lootBoxAmount' : 'bulletAmount';
    const available = Number(inventory[counterKey] || 0);
    if (available < amount) {
      return res.status(400).json({ status: 'error', message: `Not enough pot charges (${available} available)` });
    }

    const bannerData = await staticJson.load(LOOT_BOX_FILES[loot_box_short_code]);
    const configuredItems = bannerData.data?.items || bannerData.items || [];
    // Greedy Pot = every character skin that is not a default skin (data/static/pots/greedy.json).
    const items = loot_box_short_code === 'Default_Gacha'
      ? configuredItems.filter((item) => item.type === 'skin' && String(item.short_code || '').startsWith('Skin_'))
      : configuredItems;
    if (!items.length) return res.status(500).json({ status: 'error', message: 'Pot has no eligible items configured' });

    const drops = [];
    for (let i = 0; i < amount; i++) {
      const item = chooseItem(items);
      const isDuplicate = inventoryService.playerOwnsItem(player, item.short_code);
      const drop = {
        short_code: item.short_code,
        name: item.name || item.short_code,
        type: item.type,
        rarity: String(item.rarity || '1'),
        amount: Number(item.amount || 1),
        duplicate_exchange: item.duplicate_exchange || { enable: false, short_code: 'coin', amount: 0, type: 'currency' },
        is_dup: isDuplicate,
      };

      if (isDuplicate && drop.duplicate_exchange.enable) {
        const exchangeAmount = Math.max(0, Number(drop.duplicate_exchange.amount || 0));
        if (drop.duplicate_exchange.short_code === 'coin') player.coin = Number(player.coin || 0) + exchangeAmount;
        drop.exchange_received = { currency: drop.duplicate_exchange.short_code, amount: exchangeAmount };
      } else if (!isDuplicate) {
        await inventoryService.addItemToInventory(player, item.short_code, drop.amount, { save: false });
      }
      drops.push(drop);
    }

    inventory[counterKey] = available - amount;
    player.markModified('inventory');
    await player.save();


    return res.status(200).json({ status: 'success', data: {
      loot_box_type_str: loot_box_short_code,
      loot_box_amount: amount,
      remaining: inventory[counterKey],
      // current balances, so the client can show coin / amethyst / amulet after every opening
      currency: {
        coin: Number(player.coin || 0),
        amethyst: Number(player.amethyst || 0),
        amulet: Number(player.amulet || 0),
      },
      lootdrops: drops,
    }});
  } catch (error) {
    console.error('Error opening loot pot:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to open loot pot' });
  }
};

// One opening at a time per player, on a freshly loaded document, so it cannot overwrite a purchase.
module.exports.OpenLootBox = (req, res) => {
  if (!req.player) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  return withPlayerLock(req.player.steamId, async () => {
    req.player = (await Player.findOne({ steamId: req.player.steamId })) || req.player;
    return openLootBox(req, res);
  });
};
