const mongoose = require('mongoose');
const matchRoomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true, index: true },
  ownerSteamId: { type: String, required: true, index: true },
  playerSteamIds: { type: [String], default: [] },
  maxPlayers: { type: Number, default: 5, min: 1, max: 16 },
  status: { type: String, enum: ['waiting', 'starting', 'playing', 'finished', 'closed'], default: 'waiting', index: true },
  mode: { type: String, default: 'default' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastActivityAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true, collection: 'matchrooms' });
matchRoomSchema.index({ status: 1, createdAt: 1 });
module.exports = mongoose.model('MatchRoom', matchRoomSchema);
