// Exercise the real DOM renderers at several sizes, including all gear tiers.
// Pixel-for-pixel source parity: node tools/build-dom-icon-atlas.cjs --check
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const ctx = vm.createContext({ console, window: { addEventListener() {} }, IconNet: { ready: () => false, prewarm: urls => { ctx.warmed = urls; } } });
for (const name of ['util', 'sprite_layout', 'items']) {
  vm.runInContext(fs.readFileSync(path.join(root, `src/${name}.js`), 'utf8'), ctx);
}
const start = app.indexOf('const ICON_SHEETS = {');
const end = app.indexOf('\nclass MapScene extends Phaser.Scene', start);
vm.runInContext(app.slice(start, end), ctx);
const methods = ['renderItemIcon', 'gearIconHTML', '_prewarmModalIcons'].map(name => {
  const start = app.indexOf(`\n  ${name}(`) + 1;
  const tail = app.slice(start);
  const end = tail.search(/^  \}/m) + 3;
  return tail.slice(0, end);
}).join('\n');
vm.runInContext(`const scene = { ${methods.replace(/\n  }\n  /g, '\n  },\n  ')} };`, ctx);
// Object method separators (last method closes without a trailing comma).
const { scene, ICON_SHEETS: sheets, DOM_ICON_ATLAS: atlas, ITEMS: items, inventoryIconSource, gearAssetPath, RELIC_DEFS: relics, ARMOR_DEFS: armor, TIER_BY_NUM: tiers, AMULET_FRAME_BY_TIER: amulets, domIconSheet } = vm.runInContext('({scene, ICON_SHEETS, DOM_ICON_ATLAS, ITEMS, inventoryIconSource, gearAssetPath, RELIC_DEFS, ARMOR_DEFS, TIER_BY_NUM, AMULET_FRAME_BY_TIER, domIconSheet})', ctx);
scene._bakeCreatureIcon = () => {};
assert.match(atlas.url, /\?v=[0-9a-f]{8}$/);
const png = fs.readFileSync(path.join(root, atlas.url.split('?')[0]));
assert.equal(atlas.url.split('?v=')[1], crypto.createHash('sha256').update(png).digest('hex').slice(0, 8));
assert.equal(png.readUInt32BE(16), atlas.width);
assert.equal(png.readUInt32BE(20), atlas.height);
function expected(html, url, col, row, size) {
  const rect = atlas.rects[url.split('?')[0]];
  assert.ok(rect, `missing atlas source ${url}`);
  assert.ok(rect[0] + rect[2] <= atlas.width && rect[1] + rect[3] <= atlas.height);
  const scale = size / 16;
  assert.ok(html.includes(`background-image:url('${atlas.url}')`), url);
  assert.ok(html.includes(`background-size:${atlas.width * scale}px ${atlas.height * scale}px`), url);
  assert.ok(html.includes(`background-position:-${rect[0] * scale + col * size}px -${rect[1] * scale + row * size}px`), url);
  assert.ok(html.includes(`data-iconsrc="${atlas.url}"`), 'loading indicator tracks atlas');
}
let itemCount = 0, gearCount = 0;
for (const item of items) {
  const src = inventoryIconSource(item.base || item.id);
  if (!src) continue;
  const sheet = sheets[src.sheet] || sheets.crops;
  for (const size of [16, 20, 28]) expected(scene.renderItemIcon(item.id, size), sheet.url, src.frame % sheet.cols, Math.floor(src.frame / sheet.cols), size);
  itemCount++;
}
for (const [kind, defs] of [['relic', relics], ['armor', armor]]) {
  for (const slot of Object.keys(defs)) for (const tierString of Object.keys(tiers)) {
    const tier = Number(tierString), url = gearAssetPath(kind, slot, tier);
    if (!url) { assert.equal(scene.gearIconHTML(kind, slot, tier), ''); continue; }
    const frame = kind === 'relic' && slot === 'bag' ? tier - 1 : kind === 'relic' && slot === 'amulet' ? amulets[tier] : 0;
    const cols = slot === 'bag' ? 7 : slot === 'amulet' ? 6 : slot === 'net' ? 1 : 2;
    for (const size of [16, 20, 28]) expected(scene.gearIconHTML(kind, slot, tier, size), url, frame % cols, Math.floor(frame / cols), size);
    gearCount++;
  }
}
scene._prewarmModalIcons();
assert.deepEqual(Array.from(ctx.warmed), [atlas.url], 'all icon prewarming is one request');
const fallback = domIconSheet('assets/new.png?v=123', 32, 16);
assert.equal(fallback.url, 'assets/new.png?v=123');
assert.equal(fallback.width, 32);
assert.equal(fallback.x, 0);
ctx.window.ITEM_DATA_URLS = { apple: 'data:image/png;base64,example' };
assert.ok(scene.renderItemIcon('apple', 20).includes('data:image/png;base64,example'), 'baked icons retain priority');
console.log(`DOM atlas: ${itemCount} item icons and ${gearCount} gear variants preserve source frames at 3 sizes; prewarm = 1 URL`);
