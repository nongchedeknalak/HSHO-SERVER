const saveDataService = require('@services/savedata.service');
const { sendError, sendSuccess } = require('@utils/response.util');

exports.getSaveData = async (req, res) => {
  try {
    return sendSuccess(res, {
      saveData: saveDataService.getSaveData(req.player),
      session_token: req.player.session_token,
    });
  } catch (error) {
    console.error('getSaveData error:', error);
    return sendError(res, 500, 'Internal server error');
  }
};

exports.saveSaveData = async (req, res) => {
  try {
    const payload = req.body?.saveData ?? req.body?.data;
    const result = await saveDataService.applySaveData(req.player, payload);

    return sendSuccess(res, {
      ...result,
      session_token: req.player.session_token,
    });
  } catch (error) {
    console.error('saveSaveData error:', error);
    const status = error.message?.startsWith('Invalid save data') ? 400 : 500;
    return sendError(res, status, status === 400 ? error.message : 'Internal server error');
  }
};
