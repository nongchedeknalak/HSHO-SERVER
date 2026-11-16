const router = require('express').Router();
const authController = require('@controllers/auth.controller');
const saveDataController = require('@controllers/savedata.controller');

router.post('/authen', authController.authenticate.bind(authController));

router.post('/savedata/get', authController.verifySession, saveDataController.getSaveData);
router.post('/savedata/save', authController.verifySession, saveDataController.saveSaveData);

module.exports = router;
