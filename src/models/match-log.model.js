const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  steamId: { type: String, index: true },
  roomId: { type: String, index: true },
  event: { type: String, default: 'matchlog' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, collection: 'matchlogs' });
module.exports = mongoose.model('MatchLog', schema);
