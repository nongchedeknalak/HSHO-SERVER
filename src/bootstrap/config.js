module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || process.env.API_PORT || 3000,
  version: process.env.VERSION || 'prod',

  developers: process.env.DEVELOPERS
    ? process.env.DEVELOPERS.split(',').map(id => id.trim())
    : [],

  mongo: {
    uri: process.env.MONGO_URI || process.env.MONGODB_URI,
    dbName: process.env.MONGO_DB_NAME,
  },

  jwt: {
    secret: process.env.JWT_SECRET || "c6fcbf11479b44007e6129b",
    sessionExpiry: 24 * 60 * 60 * 1000,
  },

  steam: {
    apiKey: process.env.STEAM_API_KEY,
    appId: process.env.STEAM_APP_ID || 2334220,
  },

  cors: {
    allowedOrigins: [
      'http://localhost:3000',
      'api.homesweethomegame.com'
    ],
  },

  server: {
    version: '1.0.0',
  },

  store: {
    // priceTags[].currencyType -> field on the Player model.
    // 3 and 5 are real-money products (Gem_Pack_*, Bundle_CPH_*), so they are not purchasable here.
    currencyMap: { 1: 'coin', 2: 'amethyst', 4: 'amulet' },
    maxPurchaseQuantity: 99,
    // The original server closed, so most limited-time listings have long expired.
    // false = every active product stays listed and buyable. true = respect startAt/endAt.
    enforceListingWindow: process.env.STORE_ENFORCE_WINDOW === 'true',
    // Your own bundles (see data/custom/bundles.json)
    customBundlesFile: 'custom/bundles.json',
  },
};
