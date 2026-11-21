'use strict';

const staticJson = require('@utils/static-json.util');

// SaveData is progression data the game client owns. Currency / inventory / ban status
// are deliberately excluded so a modified client cannot grant itself items or money.
const CLIENT_WRITABLE_FIELDS = Object.freeze([
  'playerStat',
  'playerRecord',
  'playerRecordHunter',
  'playerRecordSurvivor',
  'rankData',
  'returnPlayerStatus',
  'curseRelic',
  'firstPayReward',
  'isNewPlayer',
]);

const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const LIMITS = Object.freeze({ depth: 6, keys: 120, array: 200, string: 200 });

class SaveDataService {
  constructor() {
    this._base = null;
  }

  async _getBasePlayer() {
    if (!this._base) {
      const data = await staticJson.load('static/player/auth.json');
      this._base = data?.data?.player ?? {};
    }
    return this._base;
  }

  // Older accounts were created before these fields existed in the schema, so
  // Mongoose dropped them. Fill them from the shipped template on login.
  async ensureDefaults(player) {
    const base = await this._getBasePlayer();
    const changed = [];

    for (const field of ['playerStat', 'rankData', 'returnPlayerStatus']) {
      if (player[field] === undefined || player[field] === null) {
        player[field] = base[field] ? structuredClone(base[field]) : {};
        changed.push(field);
      }
    }
    if (!Array.isArray(player.curseRelic)) {
      player.curseRelic = Array.isArray(base.curseRelic) ? structuredClone(base.curseRelic) : [];
      changed.push('curseRelic');
    }
    if (!player.playerRecord || typeof player.playerRecord !== 'object') {
      player.playerRecord = base.playerRecord ? structuredClone(base.playerRecord) : {};
      changed.push('playerRecord');
    }
    for (const field of ['playerRecordHunter', 'playerRecordSurvivor']) {
      if (!player[field] || typeof player[field] !== 'object') {
        player[field] = base[field] ? structuredClone(base[field]) : {};
        changed.push(field);
      }
    }
    if (player.firstPayReward === undefined) {
      player.firstPayReward = false;
      changed.push('firstPayReward');
    }
    if (player.isNewPlayer === undefined) {
      player.isNewPlayer = false;
      changed.push('isNewPlayer');
    }

    if (changed.length === 0) return false;
    changed.forEach((field) => player.markModified(field));
    await player.save();
    return true;
  }

  // Client-shaped SaveData block. Values come from this player's own document,
  // never from the shared auth.json sample (except for missing defaults).
  buildClientSaveData(player) {
    const result = {};
    for (const field of CLIENT_WRITABLE_FIELDS) {
      const value = player[field];
      result[field] = value === undefined || value === null
        ? (field === 'curseRelic' ? [] : {})
        : value;
    }
    return result;
  }

  getSaveData(player) {
    return {
      ...this.buildClientSaveData(player),
      coin: player.coin ?? 0,
      amethyst: player.amethyst ?? 0,
      amulet: player.amulet ?? 0,
      lastSavedAt: player.lastSavedAt ? new Date(player.lastSavedAt).toISOString() : null,
    };
  }

  sanitizeValue(value, depth = 0) {
    if (depth > LIMITS.depth) throw new Error('Invalid save data: nested too deep');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Invalid save data: non-finite number');
      return value;
    }
    if (typeof value === 'string') return value.slice(0, LIMITS.string);
    if (Array.isArray(value)) {
      if (value.length > LIMITS.array) throw new Error('Invalid save data: array too long');
      return value.map((entry) => this.sanitizeValue(entry, depth + 1));
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length > LIMITS.keys) throw new Error('Invalid save data: too many keys');
      const clean = {};
      for (const [key, entry] of entries) {
        if (!SAFE_KEY.test(key)) throw new Error(`Invalid save data key: ${key}`);
        clean[key] = this.sanitizeValue(entry, depth + 1);
      }
      return clean;
    }
    throw new Error('Invalid save data: unsupported value');
  }

  mergeObjects(target, patch) {
    const result = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
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
      if (payload[field] === undefined) continue;
      const clean = this.sanitizeValue(payload[field]);

      if (field === 'curseRelic') {
        if (!Array.isArray(clean)) throw new Error('Invalid save data: curseRelic must be an array');
        player.curseRelic = clean;
      } else if (field === 'firstPayReward' || field === 'isNewPlayer') {
        if (typeof clean !== 'boolean') throw new Error(`Invalid save data: ${field} must be a boolean`);
        player[field] = clean;
      } else {
        if (!clean || typeof clean !== 'object' || Array.isArray(clean)) {
          throw new Error(`Invalid save data: ${field} must be an object`);
        }
        player[field] = this.mergeObjects(player[field], clean);
      }
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
module.exports.CLIENT_WRITABLE_FIELDS = CLIENT_WRITABLE_FIELDS;
