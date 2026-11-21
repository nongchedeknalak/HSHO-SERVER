# SaveData fix (Pv Server)

แก้เฉพาะระบบ SaveData ไม่แตะร้านค้า / หม้อ / ระบบอื่น

## ปัญหาที่พบ
- `player-save` ไม่มี route: มี controller/service ไม่ได้เสียบเข้า `/live/player`
- Mongoose schema ไม่มี `playerStat`, `rankData`, `returnPlayerStatus`, `playerRecordHunter`, `playerRecordSurvivor`, `curseRelic`, `firstPayReward`, `isNewPlayer`, `lastSavedAt` → strict mode ตัดทิ้ง เซฟไม่ติด
- `/authen` ส่งค่าจาก `data/static/player/auth.json` (sample account) ทุกครั้ง → progress รีเซ็ตตอนล็อกอิน
- ไม่มี `/savedata/get` และ `/savedata/save`

## สิ่งที่เพิ่ม/แก้
- `src/services/savedata.service.js` — seed default, sanitize payload, merge แบบปลอดภัย
- `src/controllers/savedata.controller.js` — endpoint get/save
- `src/routes/player.routes.js` — เพิ่ม
  - `POST /live/player/savedata/get`
  - `POST /live/player/savedata/save`
- `src/models/player.model.js` — เพิ่ม field ที่ขาด
- `src/controllers/auth.controller.js` — เรียก `ensureDefaults()` ก่อนตอบ authen
- `src/services/player-data.service.js` — `/authen` อ่านค่าจาก player จริง ไม่ใช้ sample

## ความปลอดภัย
client เขียนได้เฉพาะ:
`playerStat`, `playerRecord`, `playerRecordHunter`, `playerRecordSurvivor`, `rankData`, `returnPlayerStatus`, `firstPayReward`, `isNewPlayer`

เขียนไม่ได้: `curseRelic`, เงิน, inventory, ban status, `lastSavedAt`

## หมายเหตุ
Root ของแอปคือโฟลเดอร์ `HSHO Pv Server` (โฟลเดอร์ชั้นใน) ไม่ใช่โฟลเดอร์ zip ชั้นนอก
