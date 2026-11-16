const staticJson = require('@utils/static-json.util');

/** Return the authenticated account's actual relic ownership, never the shared sample catalogue. */
exports.getOwnedRelics = async (req, res) => {
  try {
    const player = req.player;
    return res.status(200).json({
      data: { curseRelic: Array.isArray(player.curseRelic) ? player.curseRelic : [] },
      status: true,
    });
  } catch (error) {
    console.error('Get owned relics error:', error);
    return res.status(500).json({ data: null, status: false, error: 'Internal server error' });
  }
};

exports.getRelicCatalogue = async (req, res) => {
  try {
    const catalogue = await staticJson.load('static/player/curserelic.json');
    return res.status(200).json(catalogue);
  } catch (error) {
    console.error('Get relic catalogue error:', error);
    return res.status(500).json({ data: null, status: false, error: 'Failed to load relic catalogue' });
  }
};
