#!/usr/bin/env node
// Bake the campfire's cooked-food icons (assets/Icons/Food Icons/Cooked.png)
// with ImageMagick.
//
// One 16px frame per items.js COOKED_FOODS row, in that table's order (the
// frame index IS the row index — MINERAL_ICON_SHEET reads it that way). Each
// frame is the RAW food's own inventory icon, resolved through the same
// inventoryIconSource the game draws with and cropped out of the same
// ICON_SHEETS file, then cooked: darkened, warmed toward a toasted brown and
// given a charred rim — so a baked potato is recognisably THAT potato.
//
//   node tools/cook_icons.js                # needs `magick` on PATH
//   MAGICK=/path/to/magick node tools/cook_icons.js
//
// Rerun it whenever a COOKED_FOODS row is added or reordered;
// campfire_cook.test.js fails if the sheet's width stops matching the table.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAGICK = process.env.MAGICK || 'magick';
const OUT = path.join(ROOT, 'assets', 'Icons', 'Food Icons', 'Cooked.png');
const FRAME = 16;
// The look, in one place: the toast colour and how hard it washes, the
// brightness/saturation left after cooking, and the charred rim.
const TOAST = '#8a4a1c';
const TOAST_PCT = '40';
const MODULATE = '88,80,100';
const CRUST = '#2a1208';

// items.js leans on util.js; load the pair the way index.html does.
const ctx = { console };
vm.createContext(ctx);
for (const f of ['src/util.js', 'src/items.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const { COOKED_FOODS, inventoryIconSource } =
  vm.runInContext('({ COOKED_FOODS, inventoryIconSource })', ctx);

// ICON_SHEETS lives in app.js, which needs Phaser — lift just the literal.
const app = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
const start = app.indexOf('const ICON_SHEETS = {');
const ICON_SHEETS = vm.runInNewContext(
  '(' + app.slice(start + 'const ICON_SHEETS = '.length, app.indexOf('\n};', start) + 2) + ')');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cook-'));
const frames = Object.keys(COOKED_FOODS).map((raw, i) => {
  const src = inventoryIconSource(raw);
  const sheet = src && ICON_SHEETS[src.sheet];
  if (!sheet) throw new Error(`${raw}: no icon source`);
  const fw = sheet.srcW / sheet.cols;
  if (fw !== FRAME) throw new Error(`${raw}: ${src.sheet} frames are ${fw}px, not ${FRAME}`);
  const x = (src.frame % sheet.cols) * fw;
  const y = Math.floor(src.frame / sheet.cols) * fw;
  const file = path.join(ROOT, sheet.url.replace(/\?.*$/, ''));
  const out = path.join(tmp, `${i}.png`);
  const tinted = path.join(tmp, `${i}_t.png`);
  const edge = path.join(tmp, `${i}_e.png`);
  // Cook: wash the colour toward toasted brown and dim it a touch — a tint,
  // not a fill, so the pixel clusters keep their own shading.
  execFileSync(MAGICK, [file, '-crop', `${fw}x${fw}+${x}+${y}`, '+repage',
    '-fill', TOAST, '-colorize', TOAST_PCT, '-modulate', MODULATE, tinted]);
  // Char the silhouette: the outermost ring of opaque pixels (the alpha
  // mask's inner edge) becomes a dark crust.
  execFileSync(MAGICK, [tinted, '-alpha', 'extract',
    '-morphology', 'EdgeIn', 'Diamond:1', edge]);
  execFileSync(MAGICK, [tinted,
    '(', '-size', `${fw}x${fw}`, `xc:${CRUST}`, edge, '-alpha', 'off',
    '-compose', 'CopyOpacity', '-composite', ')',
    '-compose', 'over', '-composite', out]);
  return out;
});
execFileSync(MAGICK, [...frames, '+append', '-strip', OUT]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${path.relative(ROOT, OUT)}: ${frames.length} frames`);
