const router = require('express').Router();
const auth = require('@controllers/auth.controller');
const savedata = require('@controllers/savedata.controller');

// verifySession per route: a router-wide router.use() would also run for every /live request
// that no earlier router handled.
const guard = auth.verifySession;
router.get('/savedata/get', guard, savedata.get);
router.post('/savedata/get', guard, savedata.get);
router.post('/savedata/save', guard, savedata.save);

// Same SaveData under /live/player/* (where the game client keeps its player calls)
router.post('/player/savedata/get', guard, savedata.get);
router.post('/player/savedata/save', guard, savedata.save);

router.post('/room/create', guard, savedata.createRoom);
router.post('/room/join', guard, savedata.joinRoom);
router.post('/room/leave', guard, savedata.leaveRoom);
router.post('/room/find', guard, savedata.findRoom);
router.post('/room/status', guard, savedata.roomStatus);
router.post('/player/heartbeat', guard, savedata.heartbeat);
module.exports = router;
