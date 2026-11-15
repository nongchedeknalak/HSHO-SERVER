# HSHO SOCOOL API — Modular Feature Architecture

The API is organized by game feature under `src/modules`. Each feature owns its controller, service, routes, and model where applicable.

- `src/bootstrap`: application configuration and health/startup support
- `src/modules`: authentication, players, SaveData, inventory, shop, relics, gacha, game sessions, GM
- `src/infrastructure`: integration boundaries for MongoDB, Steam, cache, and security
- `src/catalog`: reserved for normalized read-only item/catalog definitions; original JSON assets remain under `data/` for compatibility
- `src/shared`: shared utilities
- `src/http`: API route composition
- `src/compat`: temporary import-compatibility adapters for existing `@controllers`, `@services`, `@models`, and `@utils` imports
- `data/static`: original game static data, retained without destructive conversion
- `data/custom`: server customizations

This is a structural refactor. Existing route behavior and game data are intentionally preserved; it does not claim to have verified a live MongoDB connection or in-game client integration.
