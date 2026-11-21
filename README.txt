ชุดไฟล์ที่แก้ไข / เพิ่มใหม่สำหรับโปรเจกต์ NONGCHE
อัปเดต: 2026-11-21

วิธีใช้:
1) backup โปรเจกต์เดิมก่อน
2) คัดลอกไฟล์ในโฟลเดอร์นี้ไปวางทับโปรเจกต์เดิม โดยรักษาโครงสร้างโฟลเดอร์ให้ตรง เช่น
   src/controllers/gacha.controller.js -> <project>/src/controllers/gacha.controller.js
3) ไฟล์ใหม่ 2 ไฟล์ที่ต้องมีคือ
   src/services/savedata.service.js
   src/controllers/savedata.controller.js
4) รัน npm install (ถ้ายังไม่มี node_modules) แล้ว npm start

รายการไฟล์ (9 ไฟล์):
- CHANGELOG.md
- src/controllers/auth.controller.js
- src/controllers/gacha.controller.js
- src/controllers/savedata.controller.js  [ไฟล์ใหม่]
- src/controllers/store.purchase.controller.js
- src/models/player.model.js
- src/routes/player.routes.js
- src/services/player-data.service.js
- src/services/savedata.service.js       [ไฟล์ใหม่]

หมายเหตุ: ไฟล์ที่แก้แล้วอยู่ในโปรเจกต์Downloads\Home-Sweet-Home-Online-API-NONGCHE-greedy-shop-reward-fixed ด้วยแล้ว
ชุดนี้เป็นการ "แตกเฉพาะไฟล์ที่เปลี่ยน" เพื่อนำไปวางทับเครื่องอื่นเท่านั้น
