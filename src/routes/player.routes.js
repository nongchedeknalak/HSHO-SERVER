'use strict';

const router = require('express').Router();
const { authenticate, verifySession } = require('@controllers/auth.controller');
const saveDataController = require('@controllers/savedata.controller');

router.post('/authen', authenticate);

// Progression SaveData: the client writes stats/records/rank here, not to /authen.
router.post('/savedata/get', verifySession, saveDataController.getSaveData);
router.post('/savedata/save', verifySession, saveDataController.saveSaveData);

module.exports = router;
