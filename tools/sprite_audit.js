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
const { CELL_PX, ART_BOUNDS, CROWN_BOUNDS, seatInCell, CREATURE_ART,
        CREATURE_WHEEL_R, creatureWheelDy } =
  require(path.join(ROOT, 'src', 'sprite_layout.js'));
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

// Longest run of fully transparent rows BETWEEN opaque rows of one frame. A
// seated sprite is one piece of art — a tree is canopy over trunk over roots
// with no gap — so a gap means the frame box reaches past its own art into a
// neighbour on the sheet. That is how the birch went wrong: sliced 32×64 on
// a 96px sheet, its frame took in the tip of the red tree from the band
// below, the trimmed bounds ran to the frame's bottom, and the seat pass
// stood the birch on the wrong tree's crown, 16px too high in its cell.
function frameRowGap(img, fx, fy, fw, fh) {
  let gap = 0, run = 0, seen = false;
  for (let y = 0; y < fh; y++) {
    const row = (fy + y) * img.w * 4;
    let opaque = false;
    for (let x = 0; x < fw && !opaque; x++) opaque = img.data[row + (fx + x) * 4 + 3] >= ALPHA_MIN;
    if (opaque) { if (seen && run > gap) gap = run; run = 0; seen = true; }
    else if (seen) run++;
  }
  return gap;
}
function sheetFrameRowGap(file, fw, fh, frameIdx) {
  const img = loadPng(file);
  const cols = Math.floor(img.w / fw);
  const col = frameIdx % cols, row = Math.floor(frameIdx / cols);
  return frameRowGap(img, col * fw, row * fh, fw, fh);
}
// A run of empty rows this long inside one frame is another sprite, not a
// feature of this one (a flame lifting off its logs is a couple of rows).
const MAX_ROW_GAP = 4;

// ── The CROWN of a fruit tree: the canopy, without the trunk ───────────────
// A bearing fruit tree wears a fruit sprite on its crown (render.js's fruit
// pass, seated by SpriteLayout.fruitCrownOffset over CROWN_BOUNDS), so "where
// do the leaves end and the trunk begin" is drawn geometry now and has to be
// derived from the art rather than eyeballed.
//
// The rule: walk down from the canopy's WIDEST row; the crown ends at the
// first row whose opaque span drops under half that width — that narrowing is
// the trunk. (Reading the art's full bounds instead would put the "crown"
// midline on bare bark: the bounds run on down through the trunk to the root
// base, which is wide again and would drag the midline lower still.)
// Returns the canopy's box in frame pixels, max EXCLUSIVE, or null.
function crownBox(file, fw, fh, frameIdx) {
  const img = loadPng(file);
  const cols = Math.floor(img.w / fw);
  const fx = (frameIdx % cols) * fw, fy = Math.floor(frameIdx / cols) * fh;
  const spans = [];
  for (let y = 0; y < fh; y++) {
    let mn = fw, mx = 0, any = false;
    const row = (fy + y) * img.w * 4;
    for (let x = 0; x < fw; x++) {
      if (img.data[row + (fx + x) * 4 + 3] >= ALPHA_MIN) {
        any = true;
        if (x < mn) mn = x;
        if (x + 1 > mx) mx = x + 1;
      }
    }
    if (any) spans.push({ y, mn, mx, w: mx - mn });
  }
  if (!spans.length) return null;
  const maxW = Math.max(...spans.map(r => r.w));
  const widest = spans.find(r => r.w === maxW).y;
  const trunk = spans.find(r => r.y > widest && r.w < maxW / 2);
  const bottom = trunk ? trunk.y : fh;
  const canopy = spans.filter(r => r.y < bottom);
  return {
    fw, fh,
    minX: Math.min(...canopy.map(r => r.mn)),
    minY: canopy[0].y,
    maxX: Math.max(...canopy.map(r => r.mx)),
    maxY: bottom,
  };
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

// ── And the bush's scale from items.js, for the same reason ────────────────
// A bush is one species at one size, so the bush-tier TREE and the `shrub`
// wildplant must draw at the same size — CROP_SPRITE.shrub.scale is the one
// number both render.js branches read. Copying it here as a literal made a
// third place to change it, which is how a table drifts.
// A top-level `const` in a script lands in the script scope, not on the global
// object (unlike a `function`, which is why treeScale above needs no bridge),
// so hand it over explicitly.
const itemsCtx = { Math, console };
vm.createContext(itemsCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'items.js'), 'utf8'),
  itemsCtx, { filename: 'items.js' });
vm.runInContext('globalThis.CROP_SPRITE = CROP_SPRITE;', itemsCtx);
const SHRUB_SCALE = itemsCtx.CROP_SPRITE.shrub.scale;

// ── Sheet metadata: where each texture key's PNG lives + frame size, and the
//    frame indices the renderer actually seats (used to (re)build ART_BOUNDS).
const SHEETS = {
  trees:         { file: 'assets/Objects/Maple Tree.png',                    fw: 32, fh: 48, frames: [1, 2, 3] },
  // 32×48, not 32×64: at 64 the birch frame reached into the sheet's lower
  // band and picked up the tip of the red autumn tree (see assets.js).
  pine_tree:     { file: 'assets/Objects/Wilderness/Pine Tree.png',          fw: 32, fh: 48, frames: [3] },
  birch_tree:    { file: 'assets/Objects/Wilderness/Birch Tree.png',         fw: 32, fh: 48, frames: [3] },
  mahogany_tree: { file: 'assets/Objects/Wilderness/Mahogany Tree.png',      fw: 32, fh: 48, frames: [3] },
  bushes:        { file: 'assets/Objects/Wilderness/bushes.png',             fw: 48, fh: 32, frames: [0] },
  // The sheets' fruiting cells (apple 7, peach 5) are deliberately absent: a
  // bearing tree now keeps its mature frame and wears a fruit sprite instead,
  // so nothing ever seats them (see FRUIT_FRAMES in render.js).
  apple_tree:    { file: 'assets/Objects/Wilderness/Apple Tree.png',         fw: 32, fh: 48, frames: [0, 2, 4, 5], crownFrame: 4 },
  peach_tree:    { file: 'assets/Objects/Wilderness/Peach Tree.png',         fw: 32, fh: 48, frames: [0, 2, 3, 4], crownFrame: 3 },
  chest:         { file: 'assets/Objects/trunk.png',                         fw: 32, fh: 32, frames: [0] },
  box:           { file: 'assets/Objects/Wilderness/Box_Single_16x16.png',   fw: 16, fh: 16, frames: [0] },
  mineralrock:   { file: 'assets/Objects/Wilderness/stone with minerals.png',fw: 16, fh: 16, frames: [168, 169, 170, 171, 0, 1, 2, 3, 5, 6] },
  well:          { file: 'assets/Objects/Wilderness/well.png',               fw: 30, fh: 32, frames: [0] },
  pillar:        { file: 'assets/Objects/Wilderness/pillar.png',             fw: 16, fh: 32, frames: [0] },
  scarecrow:     { file: 'assets/Objects/Scarecrow_16x16.png',               fw: 48, fh: 48, frames: [0] },
  bonfire:       { file: 'assets/Objects/Wilderness/bonfire.png',            fw: 16, fh: 32, frames: [0] },
};

// ── Scenarios: one row per representative (sprite, variant). key/frameIdx pick
//    the ART_BOUNDS entry; scale mirrors the RENDER_SPEC branch the renderer
//    seats with (scaleYMul covers fruit trees' 1.10 Y stretch).
//
//    There is deliberately no `origin` column. The seat maths measures the art
//    relative to the anchor and then subtracts exactly that, so the ORIGIN
//    CANCELS: a seated frame lands in the same place at [0.5,0.5] as at
//    [0.406,0.62]. A column that cannot change an outcome only invites drift,
//    and it had: this table said the pole anchored at 0.25 while RENDER_SPEC
//    said 0.5, and nothing noticed for the good reason that nothing could.
//    SEAT_ANCHOR below stands in for all of them.
const t = (species, size) => treeScale({ species, size });
const SEAT_ANCHOR = [0.5, 0.5];
const SCENARIOS = [
  { name: 'maple sprout',    key: 'trees',         frameIdx: 1, scale: t('maple', 'small') },
  { name: 'maple young',     key: 'trees',         frameIdx: 2, scale: t('maple', 'medium') },
  { name: 'maple small',     key: 'trees',         frameIdx: 3, scale: t('maple', 'small') },
  { name: 'maple medium',    key: 'trees',         frameIdx: 3, scale: t('maple', 'medium') },
  { name: 'maple large',     key: 'trees',         frameIdx: 3, scale: t('maple', 'large') },
  { name: 'pine small',      key: 'pine_tree',     frameIdx: 3, scale: t('pine', 'small') },
  { name: 'pine medium',     key: 'pine_tree',     frameIdx: 3, scale: t('pine', 'medium') },
  { name: 'pine large',      key: 'pine_tree',     frameIdx: 3, scale: t('pine', 'large') },
  { name: 'birch medium',    key: 'birch_tree',    frameIdx: 3, scale: t('birch', 'medium') },
  { name: 'mahogany medium', key: 'mahogany_tree', frameIdx: 3, scale: t('mahogany', 'medium') },
  { name: 'bush',            key: 'bushes',        frameIdx: 0, scale: SHRUB_SCALE },
  { name: 'apple sapling',   key: 'apple_tree',    frameIdx: 2, scale: 0.85 * 0.625, scaleYMul: 1.10 },
  { name: 'apple (wild)',    key: 'apple_tree',    frameIdx: 4, scale: 0.85, scaleYMul: 1.10 },
  { name: 'peach (wild)',    key: 'peach_tree',    frameIdx: 3, scale: 0.85, scaleYMul: 1.10 },
  { name: 'chest',           key: 'chest',         frameIdx: 0, scale: 0.9 },
  { name: 'crate (box)',     key: 'box',           frameIdx: 0, scale: 1.53 },
  { name: 'mineralrock',     key: 'mineralrock',   frameIdx: 171, scale: 1.6 },
  { name: 'ore rock',        key: 'mineralrock',   frameIdx: 0,   scale: 1.6 },
  { name: 'well',            key: 'well',          frameIdx: 0, scale: 0.9 },
  { name: 'pole (pillar)',   key: 'pillar',        frameIdx: 0, scale: 2.0 },
  { name: 'scarecrow',       key: 'scarecrow',     frameIdx: 0, scale: 0.455 },
  { name: 'bonfire',         key: 'bonfire',       frameIdx: 0, scale: 1.1 },
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
  // One frame, one piece of art: a gap of empty rows inside the frame means
  // the slice reaches into a neighbouring sprite on the sheet (see frameRowGap).
  const gap = sheetFrameRowGap(sheet.file, sheet.fw, sheet.fh, s.frameIdx);
  if (gap > MAX_ROW_GAP) {
    violations.push(`frame holds two pieces of art (${gap} empty rows between opaque rows) — ` +
      `the ${sheet.fw}×${sheet.fh} slice reaches into a neighbour on the sheet`);
  }

  // Seat with the SAME maths the renderer uses, then measure the real art box.
  const box = table || { ...fresh, fw: sheet.fw, fh: sheet.fh };
  const scaleX = s.scale, scaleY = s.scale * (s.scaleYMul || 1);
  const [ox, oy] = SEAT_ANCHOR;
  const { dxPx, dyPx, fits } = seatInCell(box, ox, oy, scaleX, scaleY);
  const tlx = dxPx - ox * sheet.fw * scaleX;
  const tly = dyPx - oy * sheet.fh * scaleY;
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

// ── Creature check ─────────────────────────────────────────────────────────
// Creatures are exempt from the seat rule (moving actors), but their entries in
// CREATURE_ART still have to describe the real art: the work-progress wheel is
// centred on each kind's CROWN from that table, so a resized or repainted
// creature sheet must not be able to leave its wheel floating in the air.
// Reference frame is 0 — the rest pose — for every kind; sibling frames in
// these sheets agree to within a pixel, and pinning one frame keeps the wheel
// from bobbing with the idle animation.
//
// The rule checked below is that the ring RESTS ON the crown — its top edge on
// the art's top row — not that its centre sits there. Centring on the crown put
// a full radius of ring in the sky above every animal, which is what read as
// "the wheel is too high".
const CREATURE_SHEETS = {
  chicken:       'assets/Farm Animals/Chicken Red.png',
  cow:           'assets/Farm Animals/Female Cow Brown.png',
  cat:           'assets/Objects/Pets/cat.png',
  dog:           'assets/Objects/Pets/dog.png',
  deer:          'assets/Objects/Wilderness/Deer Idle.png',
  rabbit:        'assets/Objects/Wilderness/Rabbit White.png',
  crow:          'assets/Objects/Wilderness/Crow.png',
  butterfly:     'assets/Objects/Wilderness/Azure Butterfly.png',
  slime:         'assets/Enemy/Slime Green.png',
  cave_slime:    'assets/Enemy/Slime Green.png',   // tinted reuse of the slime sheet
  purple_slime:  'assets/Enemy/Purple Slime.png',
  goblin:        'assets/Enemy/Goblin.png',
  goblin_archer: 'assets/Enemy/Goblin Archer.png',
};
// Outer radius of the wheel — the backing disc, one px past the stroked ring.
// Taken from the shared table so this can't drift from what app.js draws.
const WHEEL_R = CREATURE_WHEEL_R + 1;

function evaluateCreature(kind) {
  const file = CREATURE_SHEETS[kind];
  const a = CREATURE_ART[kind];
  const violations = [];
  if (!a) return { kind, violations: ['no CREATURE_ART entry'] };
  if (!file) return { kind, violations: ['no sheet mapped in CREATURE_SHEETS'] };
  const fresh = trimSheetFrame(file, a.fw, a.fh, 0);
  if (!fresh) return { kind, violations: ['reference frame is fully transparent'] };
  if (fresh.minY !== a.minY || fresh.maxY !== a.maxY) {
    violations.push(`CREATURE_ART stale: art rows ${fresh.minY}-${fresh.maxY}, ` +
                    `table says ${a.minY}-${a.maxY}`);
  }
  // Replay the renderer's placement, then measure the wheel against the art.
  const anchorY = 2 - a.float;                       // CREATURE_GROUND_DY - float
  const frameTop = anchorY - a.foot * a.fh * a.scale;
  const artTop = frameTop + fresh.minY * a.scale;
  const artBottom = frameTop + fresh.maxY * a.scale;
  const cy = creatureWheelDy(kind);
  const artH = artBottom - artTop;
  // The ring's top edge rests on the crown — or, on an animal too short to
  // give up a full radius, the wheel centres on its midline instead.
  const want = artTop + Math.min(WHEEL_R, artH / 2);
  if (Math.abs(cy - want) > 0.5) {
    violations.push(`wheel off its seating by ${(cy - want).toFixed(1)}px ` +
                    `(want ${want.toFixed(1)}, got ${cy.toFixed(1)})`);
  }
  // No part of the ring may float above the crown on an animal tall enough to
  // seat it — that overshoot is the bug this rule exists to prevent.
  if (artH >= 2 * WHEEL_R && cy - WHEEL_R < artTop - 0.5) {
    violations.push(`wheel overshoots the crown by ${(artTop - (cy - WHEEL_R)).toFixed(1)}px`);
  }
  // And it must still touch the body it reports on.
  if (cy + WHEEL_R <= artTop) violations.push('wheel floats clear above the art');
  if (cy - WHEEL_R >= artBottom) violations.push('wheel sits below the art');
  return { kind, artTop, artBottom, cy, violations };
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
  const crowns = [];
  for (const [key, sh] of Object.entries(SHEETS)) {
    if (sh.crownFrame === undefined) continue;
    const c = crownBox(sh.file, sh.fw, sh.fh, sh.crownFrame);
    crowns.push(`    '${key}:${sh.crownFrame}': { fw: ${c.fw}, fh: ${c.fh}, ` +
      `minX: ${c.minX}, minY: ${c.minY}, maxX: ${c.maxX}, maxY: ${c.maxY} },`);
  }
  console.log('\n  const CROWN_BOUNDS = {\n' + crowns.join('\n') + '\n  };');
}

// ── Crown drift guard: CROWN_BOUNDS must still describe the real canopy ────
function evaluateCrowns() {
  const rows = [];
  for (const [key, sh] of Object.entries(SHEETS)) {
    if (sh.crownFrame === undefined) continue;
    const lookup = `${key}:${sh.crownFrame}`;
    const fresh = crownBox(sh.file, sh.fw, sh.fh, sh.crownFrame);
    const table = CROWN_BOUNDS[lookup];
    const violations = [];
    if (!fresh) violations.push('frame is fully transparent');
    else if (!table) violations.push(`CROWN_BOUNDS missing "${lookup}" (run --emit-bounds)`);
    else if (table.fw !== fresh.fw || table.fh !== fresh.fh ||
             table.minX !== fresh.minX || table.minY !== fresh.minY ||
             table.maxX !== fresh.maxX || table.maxY !== fresh.maxY) {
      violations.push(`CROWN_BOUNDS "${lookup}" stale — art says ` +
        `minX ${fresh.minX} minY ${fresh.minY} maxX ${fresh.maxX} maxY ${fresh.maxY} ` +
        `(run --emit-bounds)`);
    }
    // The fruit hangs at the crown's midline: it has to land on leaves, not on
    // the trunk under them or the sky over them.
    if (fresh && table && !violations.length) {
      const art = trimSheetFrame(sh.file, sh.fw, sh.fh, sh.crownFrame);
      const mid = (table.minY + table.maxY) / 2;
      if (mid <= art.minY || mid >= table.maxY) violations.push('crown midline is off the canopy');
    }
    rows.push({ lookup, fresh, table, violations });
  }
  return rows;
}

module.exports = { decodePng, loadPng, trimFrame, trimSheetFrame, crownBox,
  evaluate, evaluateCreature, evaluateCrowns, CREATURE_SHEETS, SCENARIOS,
  SHEETS, CELL_PX };
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

// ── Creatures: exempt from the seat rule, audited for the wheel crown rule ──
const cRows = Object.keys(CREATURE_SHEETS).map(evaluateCreature);
console.log('\nCreature wheel audit — wheel centre must sit on the art crown\n');
console.log(pad('creature', 16), num('artTop'), num('artBot'), num('wheelY'), '  verdict');
console.log('─'.repeat(80));
let cBad = 0;
for (const r of cRows) {
  const ok = r.violations.length === 0;
  if (!ok) cBad++;
  console.log(pad(r.kind, 16), num(r.artTop), num(r.artBottom), num(r.cy),
    '  ' + (ok ? '✓ OK' : '✗ ' + r.violations.join('; ')));
}
console.log('─'.repeat(80));
console.log(`${cRows.length - cBad} OK, ${cBad} need attention.`);
// ── Fruit-tree crowns: where a bearing tree's fruit sprite is seated ───────
const crownRows = evaluateCrowns();
console.log('\nFruit-tree crown audit — the fruit overlay sits on the canopy midline\n');
console.log(pad('crown', 16), num('minY'), num('maxY'), num('midY'), '  verdict');
console.log('─'.repeat(80));
let crBad = 0;
for (const r of crownRows) {
  const ok = r.violations.length === 0;
  if (!ok) crBad++;
  const t = r.table || {};
  console.log(pad(r.lookup, 16), num(t.minY), num(t.maxY),
    num(t.minY === undefined ? '—' : (t.minY + t.maxY) / 2),
    '  ' + (ok ? '✓ OK' : '✗ ' + r.violations.join('; ')));
}
console.log('─'.repeat(80));
console.log(`${crownRows.length - crBad} OK, ${crBad} need attention.`);

console.log('Exempt (not audited): buildings (house/tower/shrine), produce stands,');
console.log('pot-of-gold, crops/wildplants, dropped-item ground stacks. Creatures are');
console.log('exempt from the SEAT rule — only their wheel placement is checked.\n');
process.exit((bad + cBad + crBad) ? 1 : 0);
