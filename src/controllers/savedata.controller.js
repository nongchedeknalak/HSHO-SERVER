const crypto = require('crypto');
const Player = require('@models/player.model');
const MatchRoom = require('@models/match-room.model');
const { sendError } = require('@utils/response.util');

const MAX_SAVE_BYTES = 256 * 1024;
const safeSaveKeys = new Set(['settings', 'progress', 'gameOptions', 'lastLocation', 'tutorial', 'customData']);

exports.get = async (req, res) => {
  const player = await Player.findOne({ steamId: req.player.steamId }).select('gameSaveData updatedAt');
  return res.status(200).json({ status: 1, data: { steamId: req.player.steamId, savedata: player?.gameSaveData || {}, updatedAt: player?.updatedAt || null } });
};

exports.save = async (req, res) => {
  try {
    const payload = req.body?.savedata ?? req.body?.data ?? req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendError(res, 400, 'savedata must be an object');
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_SAVE_BYTES) return sendError(res, 413, 'savedata is too large (max 256 KB)');
    const patch = {};
    for (const [key, value] of Object.entries(payload)) {
      if (safeSaveKeys.has(key)) patch[`gameSaveData.${key}`] = value;
    }
    if (!Object.keys(patch).length) return sendError(res, 400, 'No supported savedata fields. Allowed: ' + [...safeSaveKeys].join(', '));
    const player = await Player.findOneAndUpdate({ steamId: req.player.steamId }, { $set: { ...patch, lastOnline: new Date(), isOnline: true } }, { new: true }).select('gameSaveData updatedAt');
    return res.status(200).json({ status: 1, data: { savedata: player.gameSaveData, updatedAt: player.updatedAt } });
  } catch (error) { console.error('Savedata save error:', error); return sendError(res, 500, 'Could not save player data'); }
};

function roomView(room) {
  if (!room) return null;
  return { roomId: room.roomId, ownerSteamId: room.ownerSteamId, playerSteamIds: room.playerSteamIds, maxPlayers: room.maxPlayers, status: room.status, mode: room.mode, metadata: room.metadata, lastActivityAt: room.lastActivityAt };
}

exports.createRoom = async (req, res) => {
  try {
    const steamId = req.player.steamId;
    await MatchRoom.updateMany({ playerSteamIds: steamId, status: { $in: ['waiting', 'starting'] } }, { $pull: { playerSteamIds: steamId } });
    const maxPlayers = Math.min(16, Math.max(1, Number(req.body?.maxPlayers) || 5));
    const room = await MatchRoom.create({ roomId: crypto.randomUUID(), ownerSteamId: steamId, playerSteamIds: [steamId], maxPlayers, mode: String(req.body?.mode || 'default').slice(0, 40), metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {} });
    await Player.updateOne({ steamId }, { $set: { currentRoomId: room.roomId, isOnline: true, lastOnline: new Date() } });
    return res.status(201).json({ status: 1, data: { room: roomView(room) } });
  } catch (error) { console.error('Create room error:', error); return sendError(res, 500, 'Could not create room'); }
};

exports.joinRoom = async (req, res) => {
  try {
    const roomId = String(req.body?.roomId || '').trim();
    if (!roomId) return sendError(res, 400, 'roomId is required');
    const steamId = req.player.steamId;
    const room = await MatchRoom.findOneAndUpdate({ roomId, status: 'waiting', $expr: { $lt: [{ $size: '$playerSteamIds' }, '$maxPlayers'] } }, { $addToSet: { playerSteamIds: steamId }, $set: { lastActivityAt: new Date() } }, { new: true });
    if (!room) return sendError(res, 409, 'Room not found, full, or not joinable');
    await MatchRoom.updateMany({ roomId: { $ne: roomId }, playerSteamIds: steamId, status: { $in: ['waiting', 'starting'] } }, { $pull: { playerSteamIds: steamId } });
    await Player.updateOne({ steamId }, { $set: { currentRoomId: roomId, isOnline: true, lastOnline: new Date() } });
    return res.status(200).json({ status: 1, data: { room: roomView(room) } });
  } catch (error) { console.error('Join room error:', error); return sendError(res, 500, 'Could not join room'); }
};

exports.leaveRoom = async (req, res) => {
  try {
    const steamId = req.player.steamId;
    const roomId = String(req.body?.roomId || req.player.currentRoomId || '').trim();
    const filter = roomId ? { roomId, playerSteamIds: steamId } : { playerSteamIds: steamId, status: { $in: ['waiting', 'starting', 'playing'] } };
    const rooms = await MatchRoom.find(filter);
    for (const room of rooms) {
      room.playerSteamIds = room.playerSteamIds.filter((id) => id !== steamId);
      if (room.ownerSteamId === steamId) {
        if (room.playerSteamIds.length) room.ownerSteamId = room.playerSteamIds[0];
        else room.status = 'closed';
      }
      room.lastActivityAt = new Date();
      await room.save();
    }
    await Player.updateOne({ steamId }, { $unset: { currentRoomId: 1 }, $set: { isOnline: true, lastOnline: new Date() } });
    return res.status(200).json({ status: 1, data: { left: true, roomsUpdated: rooms.length } });
  } catch (error) { console.error('Leave room error:', error); return sendError(res, 500, 'Could not leave room'); }
};

exports.findRoom = async (req, res) => {
  try {
    const steamId = req.player.steamId;
    const maxPlayers = Math.min(16, Math.max(1, Number(req.body?.maxPlayers) || 5));
    const mode = String(req.body?.mode || 'default').slice(0, 40);
    let room = await MatchRoom.findOneAndUpdate({ status: 'waiting', mode, maxPlayers: { $gte: maxPlayers }, playerSteamIds: { $ne: steamId }, $expr: { $lt: [{ $size: '$playerSteamIds' }, '$maxPlayers'] } }, { $addToSet: { playerSteamIds: steamId }, $set: { lastActivityAt: new Date() } }, { new: true, sort: { createdAt: 1 } });
    if (!room) {
      room = await MatchRoom.create({ roomId: crypto.randomUUID(), ownerSteamId: steamId, playerSteamIds: [steamId], maxPlayers, mode });
    }
    await MatchRoom.updateMany({ roomId: { $ne: room.roomId }, playerSteamIds: steamId, status: { $in: ['waiting', 'starting'] } }, { $pull: { playerSteamIds: steamId } });
    await Player.updateOne({ steamId }, { $set: { currentRoomId: room.roomId, isOnline: true, lastOnline: new Date() } });
    return res.status(200).json({ status: 1, data: { room: roomView(room), matched: room.playerSteamIds.length > 1 } });
  } catch (error) { console.error('Find room error:', error); return sendError(res, 500, 'Could not find a room'); }
};

exports.roomStatus = async (req, res) => {
  const steamId = req.player.steamId;
  const room = await MatchRoom.findOne({ playerSteamIds: steamId, status: { $in: ['waiting', 'starting', 'playing'] } }).sort({ updatedAt: -1 });
  return res.status(200).json({ status: 1, data: { room: roomView(room) } });
};

exports.heartbeat = async (req, res) => {
  const steamId = req.player.steamId;
  await Player.updateOne({ steamId }, { $set: { isOnline: true, lastOnline: new Date() } });
  const roomId = req.body?.roomId || req.player.currentRoomId;
  if (roomId) await MatchRoom.updateOne({ roomId, playerSteamIds: steamId, status: { $in: ['waiting', 'starting', 'playing'] } }, { $set: { lastActivityAt: new Date() } });
  return res.status(200).json({ status: 1, data: { alive: true } });
};
