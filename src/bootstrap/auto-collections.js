'use strict';

const mongoose = require('mongoose');

// These collections are created automatically after MongoDB connects.
// strict:false keeps this setup from restricting fields added by future API modules.
const collectionSchema = new mongoose.Schema({}, {
  strict: false,
  versionKey: false,
});

const NongcheApi = mongoose.models.NongcheApi
  || mongoose.model('NongcheApi', collectionSchema.clone(), 'nongcheApi');
const Transaction = mongoose.models.Transaction
  || mongoose.model('Transaction', collectionSchema.clone(), 'transactions');
const GMLog = mongoose.models.GMLog
  || mongoose.model('GMLog', collectionSchema.clone(), 'gm_logs');

async function ensureCollection(model) {
  try {
    await model.createCollection();
    console.log(`MongoDB collection created: ${model.collection.collectionName}`);
  } catch (error) {
    // MongoDB returns NamespaceExists when the collection is already present.
    if (error.codeName === 'NamespaceExists' || error.code === 48) {
      console.log(`MongoDB collection already exists: ${model.collection.collectionName}`);
      return;
    }
    throw error;
  }
}

module.exports = async function ensureAutoCollections() {
  await ensureCollection(NongcheApi);
  await ensureCollection(Transaction);
  await ensureCollection(GMLog);
};
