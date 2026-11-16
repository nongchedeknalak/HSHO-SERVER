const config = require('@config');
const authService = require('@services/auth.service');
const playerDataService = require('@services/player-data.service');
const saveDataService = require('@services/savedata.service');
const { sendError } = require('@utils/response.util');

class AuthController {
  async authenticate(req, res) {
    try {
      const { authType, ticket, clientversion } = req.body;

      console.log(`Auth request - Type: ${authType}, Version: ${clientversion}`);

      if (authType !== 'steam') {
        return sendError(res, 400, 'Only Steam authentication is supported');
      }

      const verification = await authService.verifySteamTicket(ticket);

      if (!verification.success) {
        return sendError(res, 401, verification.error || 'Authentication failed');
      }

      const steamId = verification.steamId;
      const steamName = await authService.getSteamPlayerName(steamId);
      const player = await playerDataService.getOrCreatePlayerData(steamId, steamName);
      const banCheck = playerDataService.checkBanStatus(player);

      if (banCheck.banned) {
        return sendError(res, 403, banCheck.reason);
      }

      const sessionToken = authService.generateJWT(steamId);
      await playerDataService.updatePlayerSession(player, steamId, sessionToken);
      await saveDataService.ensureDefaults(player);

      // Only SteamIDs explicitly listed in DEVELOPERS receive the GM profile.
      // Grant the profile item and equip it so the game client can display it.
      if (config.developers.includes(steamId)) {
        player.inventory = { ...(player.inventory || {}) };
        player.inventory.devAccount = true;
        player.inventory.profiles = Array.isArray(player.inventory.profiles)
          ? player.inventory.profiles
          : [];
        if (!player.inventory.profiles.includes('Profile_GM')) {
          player.inventory.profiles.push('Profile_GM');
        }
        player.profile = { ...(player.profile || {}), display: 'Profile_GM', updatedAt: new Date() };
        player.markModified('inventory');
        player.markModified('profile');
        await player.save();
      }

      // prepareAuthResponse expects the MongoDB player document, not the SteamID string.
      const authResponse = await playerDataService.prepareAuthResponse(
        player,
        steamName,
        sessionToken
      );

      // isNewPlayer is only true on the very first login
      if (player.isNewPlayer) {
        player.isNewPlayer = false;
        await player.save();
      }

      console.log(`Auth successful for ${steamName} (${steamId})`);
      return res.status(200).json(authResponse);
    } catch (error) {
      console.error('Auth endpoint error:', error);
      return sendError(res, 500, 'Internal server error');
    }
  }

  // Use after verifySession: only accounts listed in DEVELOPERS (.env) may continue.
  requireDeveloper(req, res, next) {
    if (!req.player || !config.developers.includes(req.player.steamId)) {
      return sendError(res, 403, 'Developer account required');
    }

    return next();
  }

  async verifySession(req, res, next) {
    try {
      const token = authService.extractToken(req);

      if (!token) {
        return sendError(res, 401, 'No token provided');
      }

      const player = await authService.verifyToken(token);

      if (!player) {
        return sendError(res, 401, 'Invalid token');
      }

      const banCheck = playerDataService.checkBanStatus(player);

      if (banCheck.banned) {
        return sendError(res, 403, banCheck.reason);
      }

      req.player = player;
      return next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return sendError(res, 401, 'Token expired');
      }

      console.error('Token verification error:', error);
      return sendError(res, 401, 'Invalid token');
    }
  }
}

module.exports = new AuthController();
