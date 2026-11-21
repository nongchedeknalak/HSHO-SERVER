# Store fix (Pv Server)

แก้เฉพาะระบบร้านค้า ไม่แตะ SaveData / หม้อ / Relic / ระบบอื่น

## ปัญหาที่พบ
- ไม่มี endpoint ซื้อของเลย (`/live/store/purchase`)
- `P_List.json` / `S_List.json` เป็นไฟล์เปล่า (0 สินค้า / 0 ร้าน) ทั้งที่ `OLD/` มีของครบ
- ระบบเดิมอ่าน currency ได้แต่อนุญาตให้จ่ายแค่ coin; amethyst / amulet ไม่มีใน mapping
- ผู้เล่นที่สร้างก่อนหน้าไม่มี amethyst / amulet
- บาง build ของเกมเรียกหน้าร้านด้วย GET แต่ server รับแค่ POST

## สิ่งที่เพิ่ม/แก้
| ไฟล์ | รายละเอียด |
|---|---|
| `src/services/store.service.js` | เขียนใหม่: catalog, สินค้าทำเอง, ตรวจราคา, หักเงิน atomic, ใส่ของเข้า inventory, คืนเงินถ้าพัง |
| `src/controllers/store.controller.js` | **ใหม่** — productListing / storeList / purchase / reload |
| `src/routes/store.routes.js` | เพิ่ม `/store/purchase`, `/store/admin/reload`, รองรับ GET+POST |
| `src/utils/player-lock.util.js` | **ใหม่** — lock ราย steamId กันกดซื้อซ้ำ |
| `src/config/index.js` | เพิ่ม `store.currencyMap` = `1:coin, 2:amethyst, 4:amulet` + `customBundlesFile` |
| `src/models/player.model.js` | เพิ่ม `purchaseLog`, `storeStarterGranted` |
| `src/services/player-data.service.js` | ให้ amethyst/amulet เริ่มต้น 5000 + เติมครั้งเดียวสำหรับเก่า |
| `src/routes/index.js` | log request ที่ไม่มี route รับ → ดูได้ว่าเกมเรียก endpoint อะไร |
| `data/static/store/P_List.json` | เอากลับมาจาก `OLD/P_List.json` (2060 สินค้า) |
| `data/static/store/S_List.json` | เอากลับมาจาก `OLD/S_List.json` (6 ร้าน) |
| `data/custom/bundles.json` | **ใหม่** — ของที่คุณขายเอง เปิดไว้ให้แล้ว 5 รายการ |

## Endpoint
```text
GET|POST /live/productlisting/list              (ไม่ต้อง login)
GET|POST /live/item/listall                     (ไม่ต้อง login)
GET|POST /live/store/list                       (ไม่ต้อง login)
GET|POST /live/store/productlisting/list/tag    (ไม่ต้อง login)
POST     /live/store/purchase                   (ต้องมี token)
POST     /live/store/admin/reload               (ต้องมี token — โหลดของขายเองใหม่)
```

---

## ทำของเราไปขายเอง

แก้ `data/custom/bundles.json` แล้ว restart เซิร์ฟเวอร์ (หรือ `POST /live/store/admin/reload`)

```json
{
  "enabled": true,
  "shortCode": "Bundle_RIN_MyItem",
  "title": "ชื่อของที่โชว์ในร้าน",
  "description": "คำอธิบาย",
  "items": [{ "shortCode": "Default_Gacha", "amount": 5 }],
  "currency": "amethyst",
  "price": 500,
  "limitPerUser": null,
  "shelf": "recommend_store"
}
```

| ฟิลด์ | ความหมาย |
|---|---|
| `enabled` | `true` = ขาย, `false` = ซ่อน |
| `shortCode` | รหัสสินค้า (A-Z 0-9 _ เท่านั้น ห้ามซ้ำ) |
| `items[].shortCode` | รหัสของจาก `data/static/store/I_List.json` หรือ `coin`/`amethyst`/`amulet` = จ่ายเป็นเงิน |
| `currency` | `coin` / `amethyst` / `amulet` |
| `price` | ราคาต่อชิ้น (ตัวเลขเต็ม) |
| `limitPerUser` | `null` = ไม่จำกัด, หรือใส่เลข = จำกัดต่อคน |
| `shelf` | `direct_sale_store`, `recommend_store`, `amulet_store`, `amethys_store`, `lootbox_store`, `webinflu_store` |
| `startAt` / `endAt` | ไม่บังคับ (ISO date) |

ตัวอย่างที่เปิดไว้ให้แล้ว 5 รายการ: Starter, แลก coin→amethyst, coin→amulet, Skin ราคา amethyst, Gacha ราคา amulet

ถ้าแก้แล้วของไม่โชว์ → ดู console ว่าขึ้น `[Store] custom bundle skipped - ...` ไหม (มักเกิดจาก shortCode ไม่มีใน `I_List.json`)

---

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
_RESPONSE_ เหมือน `data/static/store/purchase.json` เลย

## สกุลเงินที่จ่ายได้
| currencyType | ฟิลด์ | หมายเหตุ |
|---|---|---|
| 1 | `coin` | ✅ |
| 2 | `amethyst` | ✅ (909 สินค้า) |
| 4 | `amulet` | ✅ (143 สินค้า) |
| 3, 5 | — | ❌ สินค้าเรียลมันีย (Gem Pack / CPH) |

## ความปลอดภัย
- หักเงินด้วย `findOneAndUpdate` + `$gte` → ไม่ติดลบ / ไม่ซื้อเกินโควต้า
- ถ้าใส่ของเข้า inventory พัง → คืนเงิน + ลบ log อัตโนมัติ
- กันกดซื้อซ้ำด้วย `withPlayerLock(steamId)`
- ไม่สนใจ `listingPolicy` (เซิร์ฟเวอร์ต้นฉบับปิดไปแล้ว) เปลี่ยนได้ด้วย `STORE_ENFORCE_WINDOW=true`

## หมายเหตุ
Root ของแอปคือโฟลเดอร์ `HSHO Pv Server` (ชั้นใน) ไม่ใช่โฟลเดอร์ zip ชั้นนอก
