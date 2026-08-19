#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Sprite-position audit — enforces terracart's "one cell" sprite rule.
//
// THE RULE (see CLAUDE.md › QC rules and src/sprite_layout.js):
//   For every world sprite EXCEPT buildings (house / tower / shrine / produce
//   stands / pot-of-gold) and moving actors (creatures):
//     1. The sprite's visible art must NEVER cross the cell's bottom edge
//        (it may not overlap the cell below).
//     2. Art that FITS in the cell (height <= one cell) is centred vertically.
//     3. Art that does NOT fit is seated with its bottom 1px above the edge.
//     4. The art is always centred horizontally on the cell.
//
// HOW IT VERIFIES — independently of the renderer's baked numbers:
//   • It decodes the REAL PNGs and trims each frame to its opaque bounds.
//   • It checks those fresh bounds match the ART_BOUNDS table the game seats
//     from (src/sprite_layout.js) — a drift guard: if the art changed and the
//     table wasn't regenerated, this fails.
//   • It seats each sprite with the SAME seatInCell() the renderer uses, then
//     measures the resulting art box against the rule. So a bug in seatInCell
//     OR a non-compliant origin/scale is caught here, not in-game.
//
//   node tools/sprite_audit.js                 # audit (exit 1 on violation)
//   node tools/sprite_audit.js --emit-bounds   # print a fresh ART_BOUNDS table
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const { CELL_PX, ART_BOUNDS, seatInCell } = require(path.join(ROOT, 'src', 'sprite_layout.js'));
const CELL_BOTTOM = CELL_PX / 2;

// Tolerances (px). Sub-pixel slop is fine; these are the "looks wrong" gates.
const TOL_OVERLAP = 0.5;   // art may not cross the cell bottom by more than this
const TOL_CENTER  = 1.0;   // centring deviation that reads as off-centre
const ALPHA_MIN   = 16;    // pixels with alpha < this are treated as transparent

// ── Minimal PNG decoder (8-bit, colour-type 6 RGBA — all game sprites) ─────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const bitDepth = buf[24], colorType = buf[25];
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`unsupported PNG (bitDepth=${bitDepth} colorType=${colorType})`);
  }
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= bpp ? cur[x - bpp] : 0;            // left
      const b = prev ? prev[x] : 0;                     // up
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0; // up-left
      let v;
      switch (filter) {
        case 0: v = rawByte; break;
        case 1: v = rawByte + a; break;
        case 2: v = rawByte + b; break;
        case 3: v = rawByte + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad filter ' + filter);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, data: out };
}

const _pngCache = new Map();
function loadPng(rel) {
  if (!_pngCache.has(rel)) {
    const clean = rel.replace(/\?.*$/, '');   // drop ?v= cache-bust suffixes
    _pngCache.set(rel, decodePng(fs.readFileSync(path.join(ROOT, clean))));
  }
  return _pngCache.get(rel);
}

// Opaque (trimmed) bounding box of one frame, in frame-local pixels.
// Returns {minX,minY, maxX,maxY} with max EXCLUSIVE; null if fully transparent.
function trimFrame(img, fx, fy, fw, fh) {
  let minX = fw, minY = fh, maxX = 0, maxY = 0, any = false;
  for (let y = 0; y < fh; y++) {
    const row = (fy + y) * img.w * 4;
    for (let x = 0; x < fw; x++) {
      if (img.data[row + (fx + x) * 4 + 3] >= ALPHA_MIN) {
        any = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + 1 > maxX) maxX = x + 1;
        if (y + 1 > maxY) maxY = y + 1;
      }
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

// Trim a sheet by (textureKey, frameIndex) using the sheet metadata table.
function trimSheetFrame(file, fw, fh, frameIdx) {
  const img = loadPng(file);
  const cols = Math.floor(img.w / fw);
  const col = frameIdx % cols, row = Math.floor(frameIdx / cols);
  return trimFrame(img, col * fw, row * fh, fw, fh);
}

// ── Pull live tree scales from util.js (so they never drift from gameplay) ──
const treeCtx = { Math, console };
vm.createContext(treeCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'util.js'), 'utf8'),
  treeCtx, { filename: 'util.js' });
const treeScale = treeCtx.treeScale;

// ── Sheet metadata: where each texture key's PNG lives + frame size, and the
//    frame indices the renderer actually seats (used to (re)build ART_BOUNDS).
const SHEETS = {
  trees:         { file: 'assets/Objects/Maple Tree.png',                    fw: 32, fh: 48, frames: [1, 2, 3] },
  pine_tree:     { file: 'assets/Objects/Wilderness/Pine Tree.png',          fw: 32, fh: 64, frames: [3] },
  birch_tree:    { file: 'assets/Objects/Wilderness/Birch Tree.png',         fw: 32, fh: 64, frames: [3] },
  mahogany_tree: { file: 'assets/Objects/Wilderness/Mahogany Tree.png',      fw: 32, fh: 64, frames: [3] },
  bushes:        { file: 'assets/Objects/Wilderness/bushes.png',             fw: 48, fh: 32, frames: [0] },
  apple_tree:    { file: 'assets/Objects/Wilderness/Apple Tree.png',         fw: 32, fh: 48, frames: [0, 2, 4, 5, 7] },
  peach_tree:    { file: 'assets/Objects/Wilderness/Peach Tree.png',         fw: 32, fh: 48, frames: [0, 2, 3, 4, 5] },
  chest:         { file: 'assets/Objects/trunk.png',                         fw: 32, fh: 32, frames: [0] },
  box:           { file: 'assets/Objects/Wilderness/Box_Single_16x16.png',   fw: 16, fh: 16, frames: [0] },
  mineralrock:   { file: 'assets/Objects/Wilderness/stone with minerals.png',fw: 16, fh: 16, frames: [168, 169, 170, 171, 0, 1, 2, 3, 5, 6] },
  well:          { file: 'assets/Objects/Wilderness/well.png',               fw: 48, fh: 32, frames: [0] },
  pillar:        { file: 'assets/Objects/Wilderness/pillar.png',             fw: 16, fh: 32, frames: [0] },
  scarecrow:     { file: 'assets/Objects/Scarecrow_16x16.png',               fw: 48, fh: 48, frames: [0] },
  bonfire:       { file: 'assets/Objects/Wilderness/bonfire.png',            fw: 16, fh: 32, frames: [0] },
};

// ── Scenarios: one row per representative (sprite, variant). key/frameIdx pick
//    the ART_BOUNDS entry; origin/scale mirror the RENDER_SPEC branch the
//    renderer seats with (scaleYMul covers fruit trees' 1.10 Y stretch).
const t = (species, size) => treeScale({ species, size });
const SCENARIOS = [
  { name: 'maple sprout',    key: 'trees',         frameIdx: 1, origin: [0.5, 0.95], scale: t('maple', 'small') },
  { name: 'maple young',     key: 'trees',         frameIdx: 2, origin: [0.5, 0.95], scale: t('maple', 'medium') },
  { name: 'maple small',     key: 'trees',         frameIdx: 3, origin: [0.5, 0.95], scale: t('maple', 'small') },
  { name: 'maple medium',    key: 'trees',         frameIdx: 3, origin: [0.5, 0.95], scale: t('maple', 'medium') },
  { name: 'maple large',     key: 'trees',         frameIdx: 3, origin: [0.5, 0.95], scale: t('maple', 'large') },
  { name: 'pine small',      key: 'pine_tree',     frameIdx: 3, origin: [0.5, 0.92], scale: t('pine', 'small') },
  { name: 'pine medium',     key: 'pine_tree',     frameIdx: 3, origin: [0.5, 0.92], scale: t('pine', 'medium') },
  { name: 'pine large',      key: 'pine_tree',     frameIdx: 3, origin: [0.5, 0.92], scale: t('pine', 'large') },
  { name: 'birch medium',    key: 'birch_tree',    frameIdx: 3, origin: [0.5, 0.92], scale: t('birch', 'medium') },
  { name: 'mahogany medium', key: 'mahogany_tree', frameIdx: 3, origin: [0.5, 0.92], scale: t('mahogany', 'medium') },
  { name: 'bush',            key: 'bushes',        frameIdx: 0, origin: [0.5, 0.9],  scale: 0.667 /* = CROP_SPRITE.shrub.scale (render.js); a bush is one size */ },
  { name: 'apple sapling',   key: 'apple_tree',    frameIdx: 2, origin: [0.5, 0.95], scale: 0.85 * 0.625, scaleYMul: 1.10 },
  { name: 'apple (wild)',    key: 'apple_tree',    frameIdx: 7, origin: [0.5, 0.95], scale: 0.85, scaleYMul: 1.10 },
  { name: 'peach (wild)',    key: 'peach_tree',    frameIdx: 5, origin: [0.5, 0.95], scale: 0.85, scaleYMul: 1.10 },
  { name: 'chest',           key: 'chest',         frameIdx: 0, origin: [0.5, 0.9],  scale: 1.0 },
  { name: 'crate (box)',     key: 'box',           frameIdx: 0, origin: [0.5, 0.9],  scale: 1.53 },
  { name: 'mineralrock',     key: 'mineralrock',   frameIdx: 171, origin: [0.5, 0.5], scale: 1.6 },
  { name: 'ore rock',        key: 'mineralrock',   frameIdx: 0,   origin: [0.5, 0.5], scale: 1.6 },
  { name: 'well',            key: 'well',          frameIdx: 0, origin: [0.406, 0.62], scale: 0.9 },
  { name: 'pole (pillar)',   key: 'pillar',        frameIdx: 0, origin: [0.25, 0.95], scale: 2.0 },
  { name: 'scarecrow',       key: 'scarecrow',     frameIdx: 0, origin: [0.5, 0.5],  scale: 0.455 },
  { name: 'bonfire',         key: 'bonfire',       frameIdx: 0, origin: [0.5, 0.82], scale: 1.1 },
];

// ── Evaluate one scenario against the rule ─────────────────────────────────
function evaluate(s) {
  const sheet = SHEETS[s.key];
  const fresh = trimSheetFrame(sheet.file, sheet.fw, sheet.fh, s.frameIdx);
  if (!fresh) return { ...s, error: 'frame is fully transparent' };
  const lookup = `${s.key}:${s.frameIdx}`;
  const table = ART_BOUNDS[lookup];

  const violations = [];
  // Drift guard: the seated table must match the real art.
  if (!table) {
    violations.push(`ART_BOUNDS missing "${lookup}" (run --emit-bounds)`);
  } else if (table.minX !== fresh.minX || table.minY !== fresh.minY ||
             table.maxX !== fresh.maxX || table.maxY !== fresh.maxY ||
             table.fw !== sheet.fw || table.fh !== sheet.fh) {
    violations.push(`ART_BOUNDS "${lookup}" stale (run --emit-bounds)`);
  }

  // Seat with the SAME maths the renderer uses, then measure the real art box.
  const box = table || { ...fresh, fw: sheet.fw, fh: sheet.fh };
  const scaleX = s.scale, scaleY = s.scale * (s.scaleYMul || 1);
  const { dxPx, dyPx, fits } = seatInCell(box, s.origin[0], s.origin[1], scaleX, scaleY);
  const tlx = dxPx - s.origin[0] * sheet.fw * scaleX;
  const tly = dyPx - s.origin[1] * sheet.fh * scaleY;
  const left = tlx + fresh.minX * scaleX, right = tlx + fresh.maxX * scaleX;
  const top = tly + fresh.minY * scaleY, bottom = tly + fresh.maxY * scaleY;
  const artH = bottom - top, centerX = (left + right) / 2;
  const overlap = bottom - CELL_BOTTOM;
  const targetBottom = fits ? artH / 2 : CELL_BOTTOM - 1;

  if (overlap > TOL_OVERLAP) violations.push(`overlaps cell below by ${overlap.toFixed(1)}px`);
  if (Math.abs(centerX) > TOL_CENTER) violations.push(`off-centre X by ${centerX.toFixed(1)}px`);
  if (Math.abs(targetBottom - bottom) > TOL_CENTER)
    violations.push(fits ? `not centred (off by ${(bottom - targetBottom).toFixed(1)}px)`
                         : `bottom not 1px above edge (off by ${(bottom - targetBottom).toFixed(1)}px)`);

  return { ...s, fits, artH, bottom, centerX, overlap, violations };
}

// ── --emit-bounds: regenerate the ART_BOUNDS literal for sprite_layout.js ──
function emitBounds() {
  const lines = [];
  for (const [key, sh] of Object.entries(SHEETS)) {
    for (const fi of sh.frames) {
      const b = trimSheetFrame(sh.file, sh.fw, sh.fh, fi);
      lines.push(`    '${key}:${fi}': { fw: ${sh.fw}, fh: ${sh.fh}, ` +
        `minX: ${b.minX}, minY: ${b.minY}, maxX: ${b.maxX}, maxY: ${b.maxY} },`);
    }
  }
  console.log('  const ART_BOUNDS = {\n' + lines.join('\n') + '\n  };');
}

module.exports = { decodePng, loadPng, trimFrame, trimSheetFrame, evaluate, SCENARIOS, SHEETS, CELL_PX };
if (require.main !== module) return;

if (process.argv.includes('--emit-bounds')) { emitBounds(); process.exit(0); }

// ── Run + report ───────────────────────────────────────────────────────────
const rows = SCENARIOS.map(evaluate);
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 7) => (typeof v === 'number' ? v.toFixed(1) : String(v)).padStart(n);

console.log('\nSprite-position audit — cell = 32px, centre at 0, bottom edge at +16\n');
console.log(pad('sprite', 18), pad('fit?', 5), num('artH'), num('bottom'), num('overlap'), num('ctrX'), '  verdict');
console.log('─'.repeat(80));
let bad = 0;
for (const r of rows) {
  if (r.error) { console.log(pad(r.name, 18), '  ERROR: ' + r.error); bad++; continue; }
  const ok = r.violations.length === 0;
  if (!ok) bad++;
  console.log(pad(r.name, 18), pad(r.fits ? 'fits' : 'tall', 5),
    num(r.artH), num(r.bottom), num(r.overlap), num(r.centerX),
    '  ' + (ok ? '✓ OK' : '✗ ' + r.violations.join('; ')));
}
console.log('─'.repeat(80));
console.log(`${rows.length - bad} OK, ${bad} need attention.`);
console.log('Exempt (not audited): buildings (house/tower/shrine), produce stands,');
console.log('pot-of-gold, creatures, crops/wildplants, dropped-item ground stacks.\n');
process.exit(bad ? 1 : 0);
