const staticJson = require('@utils/static-json.util');
const gameService = require('@services/game.service');

const DEFAULT_RANK = () => ({
  current_rank_point: 0,
  current_rank_name: 'Bronze V',
  current_rank_tier: 5,
  leaderboard_number: '-',
});

const DEFAULT_PLAYER_STAT = () => ({
  level: 0,
  exp: 0,
  mmrSurvivor: 100,
  mmrHunter: 100,
  mmrVisitor: 100,
  mmrWarden: 100,
  mmrRankVisitor: 100,
  mmrRankWarden: 100,
  mmr4v4: 100,
  MatchHistory: { survivor: [], hunter: [], '4v4': [] },
});

// Top-level save fields the client is allowed to write through /savedata/save.
// Currency, inventory, ban status, role etc. are deliberately NOT here.
const CLIENT_WRITABLE_FIELDS = ['playerStat', 'playerRecord', 'rankData'];

const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const LIMITS = { depth: 6, keys: 100, array: 200, string: 200 };

class SaveDataService {
  /**
   * Make sure every SaveData field exists on the player document.
   * Fixes accounts created before these fields were persisted.
   * Returns true when something was filled in.
   */
  async ensureDefaults(player) {
    const base = (await staticJson.load('static/player/auth.json')).data.player;
    const modified = [];

    if (!player.playerStat) {
      player.playerStat = DEFAULT_PLAYER_STAT();
      modified.push('playerStat');
    }

    if (!player.rankData) {
      player.rankData = { warden: DEFAULT_RANK(), visitor: DEFAULT_RANK(), '4v4': DEFAULT_RANK() };
      modified.push('rankData');
    }

    if (!player.returnPlayerStatus) {
      player.returnPlayerStatus = { active: false, expiresAt: null, history: [], updatedAt: null };
      modified.push('returnPlayerStatus');
    }

    if (!Array.isArray(player.curseRelic)) {
      // Relic ownership is per-account. Never seed every account with the shared sample catalogue.
      player.curseRelic = [];
      modified.push('curseRelic');
    }

    if (!player.playerRecord || typeof player.playerRecord !== 'object') {
      player.playerRecord = {};
      modified.push('playerRecord');
    }

    if (!player.purchaseCounts || typeof player.purchaseCounts !== 'object') {
      player.purchaseCounts = {};
      modified.push('purchaseCounts');
    }

    if (modified.length === 0) {
      return false;
    }

    modified.forEach((path) => player.markModified(path));
    await player.save();
    return true;
  }

  /**
   * Client-shaped SaveData block used by /authen and /savedata/get.
   * Previously /authen returned the DB shape of playerRecord and fell back to
   * the sample account stored in auth.json for everything else.
   */
  buildClientSaveData(player) {
    const stats = gameService.getPlayerStats(player);

    return {
      playerStat: stats.playerStat,
      playerRecord: stats.playerRecord,
      playerRecordHunter: stats.playerRecordHunter,
      playerRecordSurvivor: stats.playerRecordSurvivor,
      rankData: stats.rankData,
      returnPlayerStatus: stats.returnPlayerStatus,
      curseRelic: Array.isArray(player.curseRelic) ? player.curseRelic : [],
      firstPayReward: Boolean(player.firstPayReward),
      isNewPlayer: Boolean(player.isNewPlayer),
    };
  }

  getSaveData(player) {
    return {
      ...this.buildClientSaveData(player),
      coin: player.coin || 0,
      amethyst: player.amethyst || 0,
      amulet: player.amulet || 0,
      lastSavedAt: player.lastSavedAt ? player.lastSavedAt.toISOString() : null,
    };
  }

  sanitizeValue(value, depth = 0) {
    if (depth > LIMITS.depth) {
      throw new Error('Invalid save data: nested too deep');
    }

    if (value === null || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error('Invalid save data: non-finite number');
      }
      return value;
    }

    if (typeof value === 'string') {
      return value.slice(0, LIMITS.string);
    }

    if (Array.isArray(value)) {
      if (value.length > LIMITS.array) {
        throw new Error('Invalid save data: array too long');
      }
      return value.map((entry) => this.sanitizeValue(entry, depth + 1));
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value);

      if (entries.length > LIMITS.keys) {
        throw new Error('Invalid save data: too many keys');
      }

      const clean = {};
      for (const [key, entry] of entries) {
        if (!SAFE_KEY.test(key)) {
          throw new Error(`Invalid save data key: ${key}`);
        }
        clean[key] = this.sanitizeValue(entry, depth + 1);
      }
      return clean;
    }

    throw new Error('Invalid save data: unsupported value');
  }

  mergeObjects(target, patch) {
    const result = { ...(target || {}) };

    for (const [key, value] of Object.entries(patch)) {
      const isPlainObject = value && typeof value === 'object' && !Array.isArray(value);
      const current = result[key];
      const currentIsPlain = current && typeof current === 'object' && !Array.isArray(current);

      result[key] = isPlainObject && currentIsPlain ? this.mergeObjects(current, value) : value;
    }

    return result;
  }

  async applySaveData(player, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid save data: object required');
    }

    const updated = [];

    for (const field of CLIENT_WRITABLE_FIELDS) {
      if (payload[field] === undefined) {
        continue;
      }

      const clean = this.sanitizeValue(payload[field]);

      if (!clean || typeof clean !== 'object' || Array.isArray(clean)) {
        throw new Error(`Invalid save data: ${field} must be an object`);
      }
      player[field] = this.mergeObjects(player[field], clean);

      player.markModified(field);
      updated.push(field);
    }

    if (updated.length === 0) {
      throw new Error('Invalid save data: no writable fields provided');
    }

    player.lastSavedAt = new Date();
    await player.save();

    return { updated, lastSavedAt: player.lastSavedAt.toISOString() };
  }
}

module.exports = new SaveDataService();
