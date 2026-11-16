'use strict';
const fs = require('fs');
const path = require('path');
const required = [
  'server.js', 'src/bootstrap/config.js', 'src/bootstrap/health.js',
  'src/http/routes.js', 'src/modules/authentication/auth.controller.js',
  'src/modules/savedata/savedata.service.js', 'src/modules/shop/shop.service.js',
  'src/modules/inventory/inventory.service.js', 'src/modules/relics/relic.controller.js',
  'src/modules/gm/gm.controller.js', 'src/shared/static-json.util.js',
  'data/static/player/curserelic.json', 'data/static/store/I_List.json'
];
const missing = required.filter(file => !fs.existsSync(path.join(__dirname, '..', file)));
if (missing.length) {
  console.error('Missing required files:', missing.join(', '));
  process.exit(1);
}
console.log('HSHO SOCOOL modular layout verified.');
