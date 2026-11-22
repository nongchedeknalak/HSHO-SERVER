module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || process.env.API_PORT || 3000,
  version: process.env.VERSION || 'prod',

  developers: process.env.DEVELOPERS
    ? process.env.DEVELOPERS.split(',').map(id => id.trim())
    : [],

  mongo: {
    uri: process.env.MONGO_URI,
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

  player: {
    // New accounts only get the default skin of each character; every other skin comes from the Greedy Pot.
    // UNLOCK_SKINS=true gives new accounts every skin again.
    lockSkins: process.env.UNLOCK_SKINS !== 'true',
    // LOCK_SKINS_EXISTING=true: one time per account, strip skins an existing account already has
    // (default skins stay). Accounts created while lockSkins is on are never touched.
    lockExistingSkins: process.env.LOCK_SKINS_EXISTING === 'true',
  },

  store: {
    // priceTags[].currencyType -> field on the Player model.
    // 3 and 5 are real-money products (Gem_Pack_*, Bundle_CPH_*), so they are not purchasable here.
    currencyMap: { 1: 'coin', 2: 'amethyst', 4: 'amulet' },
    maxPurchaseQuantity: 99,
    // The original server closed, so most limited-time listings have long expired.
    // false = every active product stays listed and buyable. true = respect startAt/endAt.
    enforceListingWindow: process.env.STORE_ENFORCE_WINDOW === 'true',
    // Skins are hidden from the shop and cannot be bought. STORE_SELL_SKINS=true turns that off.
    blockSkins: process.env.STORE_SELL_SKINS !== 'true',
    // Your own items and bundles (see CUSTOM_SHOP.md)
    shopFile: 'static/store/custom/shop.json',
  },
};
