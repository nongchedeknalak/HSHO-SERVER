# Store fix (Pv Server)

แก้เฉพาะระบบร้านค้า ไม่แตะ SaveData / หม้อ / Relic / ระบบอื่น

## ปัญหาที่พบ
- ไม่มี endpoint ซื้อของเลย (`/live/store/purchase`)
- `P_List.json` / `S_List.json` เป็นไฟล์เปล่า (0 สินค้า / 0 ร้าน) ทั้งที่ `OLD/` มีของครบ
- ระบบเดิมอ่าน currency ได้แต่อนุญาตให้จ่ายแค่ coin; amethyst / amulet ไม่มีใน mapping
- ผู้เล่นที่สร้างก่อนหน้าไม่มี amethyst / amulet

## สิ่งที่เพิ่ม/แก้ (10 ไฟล์)
| ไฟล์ | รายละเอียด |
|---|---|
| `src/services/store.service.js` | เขียนใหม่: catalog, ตรวจราคา, หักเงิน atomic, ใส่ของเข้า inventory, คืนเงินถ้าพัง |
| `src/controllers/store.controller.js` | **ใหม่** — productListing / storeList / purchase |
| `src/routes/store.routes.js` | เพิ่ม `POST /live/store/purchase` (ต้องมี token) และใช้ controller ใหม่สำหรับ list |
| `src/utils/player-lock.util.js` | **ใหม่** — lock ราย steamId กันกดซื้อซ้ำ |
| `src/config/index.js` | เพิ่ม `store.currencyMap` = `1:coin, 2:amethyst, 4:amulet` |
| `src/models/player.model.js` | เพิ่ม `purchaseLog`, `storeStarterGranted` |
| `src/services/player-data.service.js` | ให้ amethyst/amulet เริ่มต้น 5000 + เติมครั้งเดียวสำหรับเก่า |
| `data/static/store/P_List.json` | เอากลับมาจาก `OLD/P_List.json` (2060 สินค้า) |
| `data/static/store/S_List.json` | เอากลับมาจาก `OLD/S_List.json` (6 ร้าน) |
| `STORE_FIX.md` | ไฟล์นี้ |

## Endpoint
```text
POST /live/productlisting/list              (ไม่ต้อง login)
POST /live/item/listall                     (ไม่ต้อง login)
POST /live/store/list                       (ไม่ต้อง login)
POST /live/store/productlisting/list/tag    (ไม่ต้อง login)
POST /live/store/purchase                   (ต้อง login)
```

## ตัวอย่างการซื้อ
```json
POST /live/store/purchase
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "productListingId": "63185e2903c94e418910a14a",
  "quantity": 1,
  "selectedPriceTagIndex": 0
}
```
หรือใช้ `shortCode` แทน `productListingId` ก็ได้

_RESPONSE_ เหมือน `data/static/store/purchase.json` เลย (`currentCurrency`, `purchasing`, `purchasingLog`, `itemAddResult`)

## สกุลเงินที่จ่ายได้
| currencyType | ฟิลด์ | หมายเหตุ |
|---|---|---|
| 1 | `coin` | ✅ |
| 2 | `amethyst` | ✅ |
| 4 | `amulet` | ✅ |
| 3, 5 | — | ❌ สินค้าเรียลมันีย (Gem Pack / CPH) ห้ามซื้อด้วยเงินในเกม |

## ความปลอดภัย
- หักเงินด้วย `findOneAndUpdate` + `$gte` → ไม่ติดลบ / ไม่ซื้อเกินโควต้า
- ถ้าใส่ของเข้า inventory พัง → คืนเงิน + ลบ log อัตโนมัติ
- กันกดซื้อซ้ำด้วย `withPlayerLock(steamId)`
- ไม่สนใจ `listingPolicy` (เซิร์ฟเวอร์ต้นฉบับปิดไปแล้ว) เปลี่ยนได้ด้วย `STORE_ENFORCE_WINDOW=true`

## หมายเหตุ
Root ของแอปคือโฟลเดอร์ `HSHO Pv Server` (ชั้นใน) ไม่ใช่โฟลเดอร์ zip ชั้นนอก
