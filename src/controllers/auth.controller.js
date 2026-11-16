'use strict';

const authService       = require('@services/auth.service');
const playerDataService = require('@services/player-data.service');
const Player            = require('@models/player.model');
const config            = require('@config');
const { verifySession } = require('@middleware/auth.middleware');
const { sendError }     = require('@utils/response.util');

// ───────────────────────────────────────────────────────────────────────────
// Save data
// /authen used to read playerStat / rankData / returnPlayerStatus from the static
// auth.json on every login, and the Player model has no field for them, so level, exp,
// MMR and rank were reset each time. They are now stored per player in the database.
// They are read/written with the native collection, so this file works without changing
// player.model.js. Anything that later updates them (e.g. exp after a match) must write
// the same fields: Player.collection.updateOne({ _id }, { $set: { playerStat: ... } }).
// ───────────────────────────────────────────────────────────────────────────
const SAVED_FIELDS = ['playerStat', 'rankData', 'returnPlayerStatus'];

// Keep everything stored, only add keys that are new in the defaults.
function mergeDefaults(stored, base) {
  if (stored === undefined || stored === null) return structuredClone(base);
  if (Array.isArray(stored) || typeof stored !== 'object') return stored;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return stored;
  const out = { ...stored };
  for (const [key, value] of Object.entries(base)) {
    out[key] = key in out ? mergeDefaults(out[key], value) : structuredClone(value);
  }
  return out;
}

async function applySavedProgress(player, authResponse) {
  const target = authResponse?.data?.player;
  if (!target) return;

  const stored = (await Player.collection.findOne(
    { _id: player._id },
    { projection: Object.fromEntries(SAVED_FIELDS.map((f) => [f, 1])) }
  )) ?? {};

  const firstSave = {};
  for (const field of SAVED_FIELDS) {
    if (stored[field] === undefined || stored[field] === null) {
      if (target[field] !== undefined) firstSave[field] = structuredClone(target[field]);
    } else {
      target[field] = mergeDefaults(stored[field], target[field]);
    }
  }
  if (Object.keys(firstSave).length > 0) {
    await Player.collection.updateOne({ _id: player._id }, { $set: firstSave });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Developer perk: accounts listed in DEVELOPERS (comma-separated Steam IDs in .env)
// get the GM profile. Set GM_PROFILE_ID in .env if the game's item name is different.
// ───────────────────────────────────────────────────────────────────────────
const GM_PROFILE_ID = process.env.GM_PROFILE_ID || 'Profile_GM';

async function grantDeveloperProfile(player) {
  if (!(config.developers ?? []).includes(player.steamId)) return;

  const inventory = player.inventory ?? (player.inventory = {});
  inventory.profiles = Array.isArray(inventory.profiles) ? inventory.profiles : [];
  inventory.devAccount = true;

  if (!inventory.profiles.includes(GM_PROFILE_ID)) {
    inventory.profiles.push(GM_PROFILE_ID);
    // Equip it the first time only; the player can change it afterwards.
    player.profile.display   = GM_PROFILE_ID;
    player.profile.updatedAt = new Date();
    player.markModified('profile');
  }
  player.markModified('inventory');
  await player.save();
}

class AuthController {
    async authenticate(req, res) {
    try {
      const { authType, ticket, clientversion } = req.body;

      if (!ticket) {
        return sendError(res, 400, 'ticket is required');
      }
      if (authType !== 'steam') {
        return sendError(res, 400, 'Only Steam authentication is supported');
      }

      const verification = await authService.verifySteamTicket(ticket);
      if (!verification.success) {
        return sendError(res, 401, verification.error ?? 'Authentication failed');
      }

      const { steamId } = verification;
      const steamName   = await authService.getSteamPlayerName(steamId);
      const player      = await playerDataService.getOrCreatePlayerData(steamId, steamName);

      const banCheck = playerDataService.checkBanStatus(player);
      if (banCheck.banned) {
        return sendError(res, 403, banCheck.reason);
      }

      await grantDeveloperProfile(player);

      const sessionToken = authService.generateJWT(steamId);
      await playerDataService.updatePlayerSession(player, steamId, sessionToken);

      console.log(`[Auth] Player authenticated — ${steamName} (${steamId})`);

      const authResponse = await playerDataService.prepareAuthResponse(player, steamName, sessionToken);
      await applySavedProgress(player, authResponse);

      return res.status(200).json(authResponse);
    } catch (error) {
      console.error('[Auth] authenticate failed:', error);
      return sendError(res, 500, 'Internal server error');
    }
  }
}

const authController = new AuthController();

module.exports = {
  authenticate:  authController.authenticate.bind(authController),
  verifySession,
};
