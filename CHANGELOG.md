# Changelog (hsho-nongche)
- server.js: req.body always an object; JSON 404; request logger [req]
- Reject non-string ids / NoSQL operator injection (game.service, auth, immortal, inventory, gacha, loot-box lookup)
- immortal update: owner or developer only (403 otherwise)
- inventory: type validation for profile/sticker/addItem/removeItem
- player-data: ISO dates, first-login duplicate-key race
- characterSlot.updatedAt maintained
- version check lenient by default (ENFORCE_CLIENT_VERSION=true for strict)
- startup warning if STEAM_API_KEY unset

## Store / Greedy Pot / Relic shop / SaveData fix
- Savedata: wired `/live/player/savedata/get` and `/live/player/savedata/save` (controller existed but had no route). New `savedata.service.js` sanitizes client payloads; only progression fields may be written, never currency/inventory/ban. `/authen` now seeds SaveData defaults on login and returns `firstPayReward`, `isNewPlayer`, `lastSavedAt`.
- Player model: added `firstPayReward`, `isNewPlayer`, `lastSavedAt`, `purchaseCounts`, `purchaseLog` (previously dropped by Mongoose strict mode).
- Store: purchase now looks up products in `P_List`, `S_List` shelves, tag lists and `OLD/P_List` by id **or** shortCode; accepts the client's finalize field names; returns the same response shape as `static/store/purchase.json`; tracks `purchaseCounts` so one-off relics cannot be bought twice; checks ownership from a fresh DB document; refunds currency and order count if item grant fails.
- Greedy Pot / Bullet Pot: relic rewards are no longer silently discarded — they are added to `curseRelic` atomically alongside pot consumption and duplicate compensation.

## Render deploy fix
- `server.js` now registers module aliases with absolute paths from `__dirname` instead of relying on `module-alias/register` + cwd. Fixes `Cannot find module '/opt/render/project/src/src/config/index'` when the Render Root Directory differs from the local working directory.
- IMPORTANT: deploy the **full project** (`server.js`, `package.json`, `src/`, `data/`). The earlier "fixed files only" bundle intentionally omitted `src/config`, `src/utils` and `data` and must not be used as the deploy root.

