const staticJson = require('@utils/static-json.util');
const Player = require('@models/player.model');
const inventoryService = require('@services/inventory.service');
const { withPlayerLock } = require('@utils/player-lock.util');

const RARITY_WEIGHTS = {
  1: 70, // Common
  2: 20, // Uncommon
  3: 7, // Rare
  4: 2, // Epic
  5: 1, // Legendary
};
const DEFAULT_RARITY_WEIGHT = 1;

// loot box short code -> banner file. The ticket item with the same short code is what an
// opening spends (the shop sells Default_Gacha / Bullet_Gacha as normal inventory items).
const BANNER_FILES = {
  Default_Gacha: 'static/pots/greedy.json',
  Bullet_Gacha: 'static/pots/bullet.json',
};

// duplicate_exchange.short_code -> field on the player
const EXCHANGE_FIELDS = { coin: 'coin', amethyst: 'amethyst', amulet: 'amulet', token: 'token' };

class GachaError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'GachaError';
    this.statusCode = statusCode;
  }
}

// Weighted pick among the rarities that actually exist in this banner.
const selectRarity = (items) => {
  const present = [...new Set(items.map((item) => String(item.rarity)))];
  const weightOf = (rarity) => RARITY_WEIGHTS[rarity] ?? DEFAULT_RARITY_WEIGHT;
  const total = present.reduce((sum, rarity) => sum + weightOf(rarity), 0);

  let roll = Math.random() * total;
  for (const rarity of present) {
    roll -= weightOf(rarity);
    if (roll <= 0) {
      return rarity;
    }
  }

  return present[present.length - 1];
};

const selectItem = (items) => {
  const rarity = selectRarity(items);
  const pool = items.filter((item) => String(item.rarity) === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
};

const getTicketCount = (inventory, code) => {
  const index = (inventory?.items || []).indexOf(code);
  return index > -1 ? inventory.itemCounts?.[index] || 0 : 0;
};

const spendTickets = (inventory, code, amount) => {
  const index = inventory.items.indexOf(code);
  inventory.itemCounts[index] -= amount;

  if (inventory.itemCounts[index] <= 0) {
    inventory.items.splice(index, 1);
    inventory.itemCounts.splice(index, 1);
  }
};

async function openLootBox(steamId, lootBoxShortCode, amount) {
  const filePath = BANNER_FILES[lootBoxShortCode];

  if (!filePath) {
    throw new GachaError(400, 'Invalid loot box type');
  }

  const bannerData = await staticJson.load(filePath);
  const items = bannerData.data?.items || bannerData.items || [];

  if (items.length === 0) {
    throw new GachaError(500, 'Banner has no items configured');
  }

  const player = await Player.findOne({ steamId });

  if (!player) {
    throw new GachaError(404, 'Player not found');
  }

  if (!player.inventory) {
    player.inventory = {};
  }
  inventoryService.ensureInventoryArrays(player.inventory);

  const owned = getTicketCount(player.inventory, lootBoxShortCode);
  if (owned < amount) {
    throw new GachaError(400, `Not enough ${lootBoxShortCode} (have ${owned}, need ${amount})`);
  }

  spendTickets(player.inventory, lootBoxShortCode, amount);

  const lootdrops = [];

  for (let i = 0; i < amount; i += 1) {
    const selected = selectItem(items);
    const isDuplicate = inventoryService.isUniqueItemOwned(player, selected.short_code);
    const exchange = selected.duplicate_exchange || {
      enable: true,
      short_code: 'coin',
      amount: parseInt(selected.rarity, 10) * 100,
      type: 'currency',
    };

    if (isDuplicate) {
      const field = EXCHANGE_FIELDS[String(exchange.short_code).toLowerCase()];
      if (exchange.enable && field) {
        player[field] = (player[field] || 0) + (exchange.amount || 0);
      }
    } else {
      inventoryService.applyItemToInventory(player.inventory, selected.short_code, selected.amount || 1);
    }

    lootdrops.push({
      short_code: selected.short_code,
      name: selected.name,
      type: selected.type,
      rarity: selected.rarity,
      amount: selected.amount || 1,
      duplicate_exchange: exchange,
      is_dup: isDuplicate,
    });
  }

  player.markModified('inventory');
  await player.save();

  return {
    lootdrops,
    remaining: getTicketCount(player.inventory, lootBoxShortCode),
  };
}

module.exports.OpenLootBox = async (req, res) => {
  try {
    const { loot_box_short_code: lootBoxShortCode, amount } = req.body || {};

    if (!lootBoxShortCode) {
      return res.status(400).json({ status: 'error', message: 'loot_box_short_code is required' });
    }

    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      return res.status(400).json({ status: 'error', message: 'amount must be between 1 and 100' });
    }

    const { lootdrops, remaining } = await withPlayerLock(req.player.steamId, () =>
      openLootBox(req.player.steamId, lootBoxShortCode, amount)
    );

    return res.status(200).json({
      status: 'success',
      data: {
        loot_box_type_str: lootBoxShortCode,
        loot_box_amount: amount,
        loot_box_remaining: remaining,
        lootdrops,
      },
    });
  } catch (error) {
    if (error.name === 'GachaError') {
      return res.status(error.statusCode).json({ status: 'error', message: error.message });
    }

    if (error.code === 'ENOENT') {
      return res.status(404).json({ status: 'error', message: 'Loot box configuration not found' });
    }

    console.error('Error opening loot box:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to open loot box' });
  }
};
