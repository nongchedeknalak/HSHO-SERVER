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
    // Mongo collection that holds the players. Set MONGO_COLLECTION to use another one.
    collection: process.env.MONGO_COLLECTION || 'nongche-api-data',
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
    // Wallet of a brand new account (the template file has 5000 coin / 0 amethyst / 0 amulet).
    starterCurrency: {
      coin: Number(process.env.STARTER_COIN ?? 250000),
      amethyst: Number(process.env.STARTER_AMETHYST ?? 5000),
      amulet: Number(process.env.STARTER_AMULET ?? 500),
    },
    // true = one time per account, ADD the starter wallet to accounts that already exist
    // (this is how existing players that show 0 amethyst / amulet get some).
    grantStarterToExisting: process.env.GRANT_STARTER_TO_EXISTING === 'true',
    // DEVELOPERS accounts are topped up to at least this much at every login (0 = off).
    devMinCurrency: {
      coin: Number(process.env.DEV_MIN_COIN ?? 0),
      amethyst: Number(process.env.DEV_MIN_AMETHYST ?? 0),
      amulet: Number(process.env.DEV_MIN_AMULET ?? 0),
    },
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
