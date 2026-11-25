const Player = require('@models/player.model');
const MatchLog = require('@models/match-log.model');

exports.checkPenalty = async (req, res) => {
  try {
    const gsid = String(req.body?.Player?.GSID || req.body?.GSID || req.body?.steamId || '');
    const player = gsid ? await Player.findOne({ steamId: gsid }).select('banStatus').lean() : null;
    const ban = player?.banStatus || {};
    const banned = Boolean(ban.isBanned || ban.banned || ban.Banned || ban.PenaltyLevel > 0);
    return res.status(200).json({ data: { BanInSecond: Number(ban.BanInSecond || ban.banInSecond || 0), count: 0, GSID: gsid, PenaltyLevel: Number(ban.PenaltyLevel || ban.penaltyLevel || 0), UnbannedDateTime: ban.UnbannedDateTime || ban.unbannedDateTime || null, UnBannedIn: Number(ban.UnBannedIn || ban.unbannedIn || 0), isBanned: banned }, hasUnBannedIn: Number(ban.UnBannedIn || ban.unbannedIn || 0), message: 'All transaction success', status: 1 });
  } catch (error) { console.error('Penalty check error:', error); return res.status(500).json({ status: 0, message: 'Could not check penalty' }); }
};

exports.addMatchLog = async (req, res) => {
  try {
    const body = req.body || {};
    const gsid = String(body?.Player?.GSID || body?.GSID || body?.steamId || body?.playerId || '');
    const roomId = String(body?.RoomID || body?.roomId || body?.MatchID || body?.matchId || '');
    await MatchLog.create({ steamId: gsid || undefined, roomId: roomId || undefined, payload: body });
    return res.status(200).json({ data: null, error: null, status: 1 });
  } catch (error) { console.error('Match log save error:', error); return res.status(500).json({ data: null, error: 'Could not save match log', status: 0 }); }
};

exports.serverDetect = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.playerIds) ? req.body.playerIds.map(String) : [];
    const gsid = ids[0] || String(req.body?.GSID || '');
    const player = gsid ? await Player.findOne({ steamId: gsid }).select('isOnline currentRoomId').lean() : null;
    return res.status(200).json({ data: { GSID: gsid, isOnline: Boolean(player?.isOnline), roomId: player?.currentRoomId || null }, error: null, status: 1 });
  } catch (error) { console.error('Server detect error:', error); return res.status(500).json({ data: null, error: 'Could not detect server state', status: 0 }); }
};
