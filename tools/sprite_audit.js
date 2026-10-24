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
const { CELL_PX, ART_BOUNDS, CROWN_BOUNDS, seatInCell, CREATURE_ART, GROVE_SHRINE_ART, SHRINE_KIND_ART, SHRINE_SPIRIT_ART, CHEST_SCALE,
        CREATURE_WHEEL_R, creatureWheelDy } =
  require(path.join(ROOT, 'src', 'sprite_layout.js'));
const EnemyRoster = require(path.join(ROOT, 'src', 'enemy_roster.js'));
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

// Opaque (trimmed) bounding box of one frame, frame-local, max EXCLUSIVE; null if fully transparent.
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
  if (!any) return null;
  // Bottom three opaque rows describe the support/base, not the overhanging crown.
  let baseMinX = fw, baseMaxX = 0;
  for (let y = Math.max(minY, maxY - 3); y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if (img.data[((fy + y) * img.w + fx + x) * 4 + 3] >= ALPHA_MIN) {
        baseMinX = Math.min(baseMinX, x); baseMaxX = Math.max(baseMaxX, x + 1);
      }
    }
  }
  return { minX, minY, maxX, maxY, baseX: (baseMinX + baseMaxX) / 2 };
}

// Longest run of fully transparent rows BETWEEN opaque rows of one frame. A
// seated sprite is one piece of art with no gap, so a gap means the frame box
// reaches past its own art into a neighbour on the sheet (the birch once took
// in the tip of the red tree below and was seated 16px too high).
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
function sheetFrameRowGap(file, fw, fh, frameIdx, textureKey) {
  const img = loadPng(file), r = sourceFrameRect(file, fw, fh, frameIdx, img.w, textureKey);
  return frameRowGap(img, r.x, r.y, r.width, r.height);
}
// A run of empty rows this long inside one frame is another sprite, not a
// feature of this one (a flame lifting off its logs is a couple of rows).
const MAX_ROW_GAP = 4;

// ── The CROWN of a fruit tree: the canopy, without the trunk ───────────────
// A bearing fruit tree wears a fruit sprite on its crown (render.js's fruit
// pass, seated by SpriteLayout.fruitCrownOffset over CROWN_BOUNDS), so where
// the leaves end and the trunk begins is derived from the art.
//
// The rule: walk down from the canopy's WIDEST row; the crown ends at the
// first row whose opaque span drops under half that width (the trunk). The
// art's full bounds would put the midline on bare bark (the root base is wide
// again and drags it lower still).
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
function sourceFrameRect(file, fw, fh, frameIdx, imageWidth, textureKey) {
  const candidates = Object.values(ASSETS).filter(row => row.path === file);
  const asset = textureKey ? ASSETS[textureKey] : candidates.length === 1 ? candidates[0] : null;
  if (!textureKey && candidates.some(row => row.kind === 'atlas-alias')) {
    throw new Error(`Atlas frame lookup requires a texture key: ${file}`);
  }
  if (asset?.kind === 'image') return { x: 0, y: 0, width: fw, height: fh };
  const rect = asset?.frameRects?.[frameIdx];
  const cols = Math.floor(imageWidth / fw);
  // The profile's onLoad hooks trim contact ink by replacing frame height,
  // while retaining its original sheet position and width.
  const cropHeight = textureKey && ROGUE_PROP_PROFILE.frameCrops?.[textureKey]?.[frameIdx];
  return rect || { x: frameIdx % cols * fw, y: Math.floor(frameIdx / cols) * fh, width: fw, height: cropHeight ?? fh };
}
function trimSheetFrame(file, fw, fh, frameIdx, textureKey) {
  const img = loadPng(file), r = sourceFrameRect(file, fw, fh, frameIdx, img.w, textureKey);
  const bounds = trimFrame(img, r.x, r.y, r.width, r.height);
  return bounds && { ...bounds, fw: r.width, fh: r.height };
}

// ── Pull live tree scales from util.js (so they never drift from gameplay) ──
const treeCtx = { Math, console };
vm.createContext(treeCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'util.js'), 'utf8'),
  treeCtx, { filename: 'util.js' });
const treeScale = treeCtx.treeScale;

// ── And the bush's scale from items.js ──────────────────────────────────────
// The bush-tier TREE and the `shrub` wildplant draw at the same size:
// CROP_SPRITE.shrub.scale is the one number both render.js branches read.
// A top-level `const` lands in the script scope, not on the global object
// (unlike a `function`, hence no bridge for treeScale above), so hand it over.
const itemsCtx = { Math, console, EnemyRoster: require('../src/enemy_roster.js') };
vm.createContext(itemsCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/selected_item_art.js'), 'utf8'), itemsCtx);
// util.js first, as index.html orders them (the catalog uses shortDuration at load).
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'util.js'), 'utf8'),
  itemsCtx, { filename: 'util.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'items.js'), 'utf8'),
  itemsCtx, { filename: 'items.js' });
vm.runInContext('globalThis.FURNITURE = FURNITURE; globalThis.FURNITURE_SCALE = FURNITURE_SCALE; globalThis.ROCK_VARIANT_ART = ROCK_VARIANT_ART; globalThis.GEM_DEPOSITS = GEM_DEPOSITS; globalThis.CROP_SPRITE = CROP_SPRITE; globalThis.WILDPLANT_CONTEXT_ART = WILDPLANT_CONTEXT_ART;', itemsCtx);
const SHRUB_SCALE = 1; // Legacy bushes remain tree undergrowth; selected shrub has its own sheet.
const CROP_SPRITE = itemsCtx.CROP_SPRITE;

// ── …and the texture table from assets.js, so the wildplant-frame audit reads
//    the SAME sheet geometry the game loads. The onLoad hooks are never called.
const assetsCtx = { Math, console, window: {}, EnemyRoster: require('../src/enemy_roster.js'),
  SpriteLayout: require('../src/sprite_layout.js'),
  CROP_SPRITE: itemsCtx.CROP_SPRITE, BUSH_SPRITE: vm.runInContext('BUSH_SPRITE', itemsCtx) };
vm.createContext(assetsCtx);
for (const file of ['art_atlas.js', 'selected_world_atlas.js', 'selected_item_art.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'), assetsCtx, { filename: file });
}
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'assets.js'), 'utf8'),
  assetsCtx, { filename: 'assets.js' });
// Apply the same active profile as the browser. It supplies both replacement
// PNGs and their measured bounds; the base table describes legacy sources.
for (const file of ['rogue_object_bounds.js', 'rogue_prop_profile.js', 'rogue_objects.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'), assetsCtx, { filename: file });
}
const ROGUE_PROP_PROFILE = vm.runInContext('ROGUE_PROP_PROFILE', assetsCtx);
const ASSETS = assetsCtx.window.ASSETS;

// Resolve audit samples through the same profile spec, including growth scale.
assetsCtx.treeArtFrame = treeCtx.treeArtFrame;
const RogueObjects = assetsCtx.window.RogueObjects;
const rogueTreeCases = [];
const seenTrees = new Set();
for (let i = 0; i < 256; i++) {
  for (const size of ['small', 'medium', 'large']) {
    const object = {kind:'tree',id:'audit-tree-' + i,size,species:'maple'};
    const spec = RogueObjects.spec(object, {}, {});
    const identity = spec.key + ':' + spec.scale;
    if (!seenTrees.has(identity)) {
      seenTrees.add(identity);
      rogueTreeCases.push({name:`${spec.key} ${size}`,key:spec.key,frameIdx:spec.frame,scale:spec.scale});
    }
  }
}

// ── Sheet metadata: where each texture key's PNG lives + frame size, and the
//    frame indices the renderer actually seats (used to (re)build ART_BOUNDS).
const GEM_ROCKS = Object.values(itemsCtx.GEM_DEPOSITS).filter(row => row.art.sheet === 'cave_props');
const SHEETS = {
  furniture: { file: ASSETS.furniture.path, fw: ASSETS.furniture.frameWidth, fh: ASSETS.furniture.frameHeight, frames: [...new Set(Object.values(itemsCtx.FURNITURE).flatMap(row => [row.frame, ...Object.values(row.tierSheetFrame || {})]))] },
  cave_props: { file: ASSETS.cave_props.path, fw: 24, fh: 24, frames: [1, 6, ...GEM_ROCKS.map(row => row.art.frame)] },
  poison_vent_inactive: { file: ASSETS.poison_vent_inactive.path, fw: 24, fh: 24, frames: [0] },
  trees:         { file: 'assets/Objects/Approved/trees.png',                    fw: 32, fh: 48, frames: [1, 2, 3] },
  // 32×48, not 32×64: at 64 the birch frame picked up the tip of the red tree below (see assets.js).
  pine_tree:     { file: 'assets/Objects/Approved/pine_tree.png',          fw: 32, fh: 48, frames: [1, 2, 3] },
  beach_palms: { file: ASSETS.beach_palms.path, fw: ASSETS.beach_palms.frameWidth, fh: ASSETS.beach_palms.frameHeight, frames: [0, 1, 2, 3, 4, 5] },
  bushes: { file: ASSETS.bushes.path, fw: 24, fh: 24, frames: [0,1,2,3,4,5,6,7] },
  selected_shrub: { file: ASSETS.selected_shrub.path, fw: 16, fh: 16, frames: [0] },
  selected_grave_pillar: { file: ASSETS.selected_grave_pillar.path, fw: 16, fh: 32, frames: [0] },
  bramble: { file: ASSETS.bramble.path, fw: 24, fh: 24, frames: itemsCtx.CROP_SPRITE.shrub.looks.bramble.frames },
  approved_clipped_hedge: { file: ASSETS.approved_clipped_hedge.path, fw: 24, fh: 24, frames: [0] },
  zone_hedge_single: { file: ASSETS.zone_hedge_single.path, fw: 24, fh: 24, frames: itemsCtx.WILDPLANT_CONTEXT_ART.zone_hedge_single.frames },
  zone_hedge: { file: ASSETS.zone_hedge.path, fw: 24, fh: 24, frames: Array.from({ length: 15 }, (_, i) => i) },
  // The sheets' fruiting cells (apple 7, peach 5) are deliberately absent: a
  // bearing tree keeps its mature frame and wears a fruit sprite (FRUIT_FRAMES in render.js).
  apple_tree:    { file: 'assets/Objects/Approved/apple_tree.png',         fw: 32, fh: 48, frames: [0, 2, 4, 8], crownFrame: 4 },
  worldpeach_tree:    { file: 'assets/Objects/Approved/peach_tree.png',         fw: 32, fh: 48, frames: [0, 2, 3, 4], crownFrame: 3 },
  beehive:       { file: ASSETS.beehive.path, fw: 16, fh: 16, frames: [0] },
  waystone:      { file: ASSETS.waystone.path, fw: 16, fh: 16, frames: [0, 1] },
  // Authored tier frames each carry their own measured alpha bounds.
  chest:         { file: ASSETS.chest.path, fw: 16, fh: 16, frames: [0, 1, 2, 3, 4, 5, 6] },
  box:           { file: ASSETS.box.path, fw: 16, fh: 16, frames: [0,1,2,3] },
  shrine_spirit: { file: ASSETS.shrine_spirit.path, fw: 16, fh: 16, frames: [0, 1, 2, 3] },
  crystal_cluster: { file: ASSETS.crystal_cluster.path, fw: 16, fh: 16, frames: [0] },
  mineralrock:   { file: 'assets/Objects/Approved/mineralrock.png',fw: 16, fh: 16, frames: [168, 169, 170, 171, 0, 1, 2, 3, 5, 7] },
  mineralboulder: { file: 'assets/Objects/Approved/mineralrock.png', fw: 32, fh: 16, frames: [45, 60, 46, 47, 48, 49, 51, 53] },
  approved_charred_stakes: { file: 'assets/Objects/Approved/approved_charred_stakes.png', fw: 24, fh: 24, frames: [0] },
  well:          { file: ASSETS.well.path, fw: ASSETS.well.frameWidth, fh: ASSETS.well.frameHeight, frames: [0] },
  pillar:        { file: ASSETS.pillar.path, fw: 24, fh: 24, frames: [0] },
  scarecrow:     { file: 'assets/Objects/Approved/scarecrow.png',               fw: 48, fh: 48, frames: [0] },
  bonfire:       { file: 'assets/Objects/Wilderness/bonfire.png',            fw: 16, fh: 32, frames: [0] },
  torch: { file: ASSETS.torch.path, fw: 16, fh: 16, frames: [0] },
  tar:           { file: 'assets/Objects/Approved/tar.png',                 fw: 16, fh: 16, frames: [0] },
  ...Object.fromEntries(GROVE_SHRINE_ART.map(({ key, frame }) => [key, {
    file: ASSETS[key].path, fw: ASSETS[key].frameWidth, fh: ASSETS[key].frameHeight, frames: [frame],
  }])),
  ...Object.fromEntries(['gas_mushroom_small', 'gas_mushroom_large'].map(key => [key, {
    file: ASSETS[key].path, fw: ASSETS[key].frameWidth, fh: ASSETS[key].frameHeight, frames: key === 'gas_mushroom_small' ? [0,1] : [0],
  }])),
  rock_variants: { file: ASSETS.rock_variants.path, fw: 16, fh: 16, frames: Array.from({ length: 65 }, (_, i) => i) },
  zone_objects: { file: ASSETS.zone_objects.path, fw: 24, fh: 24, frames: [1,4,5,6,7,34,37,38,39,40,54,58,59,61,64,65,66,67,68,69,70,71] },
  zone_berry_bush: { file: ASSETS.zone_berry_bush.path, fw: 16, fh: 16, frames: [0,1] },
  reef_coral:    { file: 'assets/Objects/Reef/coral.png', fw: 24, fh: 24, frames: [0,1,2,3,4,5,6,7] },
  vista_scope:   { file: 'extra_assets/inactive/assets/Objects/Approved/vista_scope.png',               fw: 16, fh: 24, frames: [0] },
  [SHRINE_KIND_ART.key]: { file: ASSETS[SHRINE_KIND_ART.key].path, fw: ASSETS[SHRINE_KIND_ART.key].frameWidth,
    fh: ASSETS[SHRINE_KIND_ART.key].frameHeight, frames: SHRINE_KIND_ART.frames },
  barrel: { file: ASSETS.barrel.path, fw: 16, fh: 16, frames: [0,1,2,3,4,5,6,7,8] },
  clay_pot: { file: ASSETS.clay_pot.path, fw: 16, fh: 16, frames: [0,1] },
  clay_pot_smashed: { file: ASSETS.clay_pot_smashed.path, fw: 24, fh: 24, frames: [0, 1, 2, 3] },
  bike_rack:      { file: 'assets/Objects/Approved/bike_rack.png',          fw: 16, fh: 16, frames: [0] },
  signpost:       { file: ASSETS.signpost.path,           fw: 16, fh: 16, frames: [0] },
  gatepost:       { file: 'extra_assets/inactive/assets/Objects/Approved/gatepost.png',           fw: 16, fh: 16, frames: [0] },
};

// ── Scenarios: one row per representative (sprite, variant). key/frameIdx pick
//    the ART_BOUNDS entry; scale mirrors the RENDER_SPEC branch the renderer
//    seats with (scaleYMul covers fruit trees' 1.10 Y stretch).
//
//    There is deliberately no `origin` column: the seat maths subtracts the
//    anchor it measures from, so the ORIGIN CANCELS. SEAT_ANCHOR stands in for all.
const t = (species, size) => treeScale({ species, size });
const SEAT_ANCHOR = [0.5, 0.5];
const furnitureManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/Objects/Furniture/manifest.json'), 'utf8'));
const SCENARIOS = [
  ...Object.entries(itemsCtx.FURNITURE).flatMap(([id, row]) =>
    [row.frame, ...Object.values(row.tierSheetFrame || {})].flatMap(frameIdx =>
      [false, ...(row.flip ? [true] : [])].map(flipX => ({
        name: `${id}:${frameIdx}${flipX ? ' flipped' : ''}`, key: 'furniture', frameIdx, scale: itemsCtx.FURNITURE_SCALE, flipX, seatFoot: row.seatFoot,
        frameSize: furnitureManifest.items.find(entry => entry.itemId === id).frameSize,
      })))),
  ...['gas_mushroom_small', 'gas_mushroom_large'].flatMap(key => SHEETS[key].frames.map(frameIdx => ({
    name: key.replaceAll('_', ' ') + ' ' + frameIdx, key, frameIdx, scale: itemsCtx.WILDPLANT_CONTEXT_ART[key].scale,
  }))),
  { name: 'drill shrine', key: 'cave_props', frameIdx: 6, scale: 4 / 3 },
  { name: 'stalagmites', key: 'cave_props', frameIdx: 1, scale: 4 / 3 },
  { name: 'inactive poison vent', key: 'poison_vent_inactive', frameIdx: 0, scale: 4 / 3 },
  ...GEM_ROCKS.map(row => ({ name: row.item + ' deposit', key: row.art.sheet, frameIdx: row.art.frame, scale: row.art.scale })),
  { name: 'maple sprout',    key: 'trees',         frameIdx: 1, scale: t('maple', 'small') },
  { name: 'maple young',     key: 'trees',         frameIdx: 2, scale: t('maple', 'medium') },
  { name: 'maple small',     key: 'trees',         frameIdx: 1, scale: t('maple', 'small') },
  { name: 'maple medium',    key: 'trees',         frameIdx: 2, scale: t('maple', 'medium') },
  { name: 'maple large',     key: 'trees',         frameIdx: 3, scale: t('maple', 'large') },
  { name: 'pine small',      key: 'pine_tree',     frameIdx: 1, scale: t('pine', 'small') },
  { name: 'pine medium',     key: 'pine_tree',     frameIdx: 2, scale: t('pine', 'medium') },
  { name: 'pine large',      key: 'pine_tree',     frameIdx: 3, scale: t('pine', 'large') },
  ...[0, 1, 2, 3, 4, 5].map(frameIdx => ({ name: `beach palm ${frameIdx}`, key: 'beach_palms', frameIdx, scale: itemsCtx.WILDPLANT_CONTEXT_ART.palm.scale })),
  { name: 'selected shrub', key: 'selected_shrub', frameIdx: 0, scale: 1.5 },
  ...SHEETS.bushes.frames.map(frameIdx => ({ name: `bush ${frameIdx}`, key: 'bushes', frameIdx, scale: SHRUB_SCALE })),
  ...SHEETS.bramble.frames.map(frameIdx => ({ name: `bramble ${frameIdx}`, key: 'bramble', frameIdx, scale: itemsCtx.CROP_SPRITE.shrub.looks.bramble.scale })),
  ...SHEETS.approved_clipped_hedge.frames.map(frameIdx => ({ name: `clipped hedge ${frameIdx}`, key: 'approved_clipped_hedge', frameIdx, scale: itemsCtx.CROP_SPRITE.shrub.looks.clipped.scale })),
  { name: 'giant mushroom', key: 'zone_objects', frameIdx: 40, scale: itemsCtx.CROP_SPRITE.giant_mushroom.scale },
  { name: 'apple sapling',   key: 'apple_tree',    frameIdx: 2, scale: 0.85 * 0.625, scaleYMul: 1.10 },
  { name: 'apple (wild)',    key: 'apple_tree',    frameIdx: 4, scale: 0.85, scaleYMul: 1.10 },
  { name: 'apple blossom',   key: 'apple_tree', frameIdx: 8, scale: 0.85, scaleYMul: 1.10 },
  { name: 'peach blossom',   key: 'worldpeach_tree', frameIdx: 4, scale: 0.85, scaleYMul: 1.10 },
  { name: 'peach (wild)',    key: 'worldpeach_tree',    frameIdx: 3, scale: 0.85, scaleYMul: 1.10 },
  ...SHEETS.chest.frames.map(frameIdx => ({ name: `chest tier ${frameIdx + 1}`, key: 'chest', frameIdx, scale: CHEST_SCALE })),
  ...SHEETS.box.frames.map(frameIdx => ({ name: 'crate (box) ' + frameIdx, key: 'box', frameIdx, scale: 0.8 * 1.1 })),
  ...[0, 1, 2, 3].map(frameIdx => ({ name: `shrine spirit idle ${frameIdx}`, key: 'shrine_spirit', frameIdx,
    scale: SHRINE_SPIRIT_ART.scale })),
  { name: 'mineralrock',     key: 'mineralboulder', frameIdx: 45, scale: 1.8 },
  { name: 'crystal deposit', key: itemsCtx.GEM_DEPOSITS.sapphire.art.sheet, frameIdx: itemsCtx.GEM_DEPOSITS.sapphire.art.frame, scale: itemsCtx.GEM_DEPOSITS.sapphire.art.scale },
  { name: 'ore rock',        key: 'mineralboulder', frameIdx: 46, scale: 1.7 },
  { name: 'well',            key: 'well',          frameIdx: 0, scale: 0.9 },
  { name: 'pole (pillar)',   key: 'pillar',        frameIdx: 0, scale: 4 / 3 },
  { name: 'scarecrow',       key: 'scarecrow',     frameIdx: 0, scale: 0.6 },
  { name: 'bonfire',         key: 'bonfire',       frameIdx: 0, scale: 1.1 },
  { name: 'torch',           key: 'torch',         frameIdx: 0, scale: 1.1 },
  { name: 'waystone',        key: 'waystone',      frameIdx: 0, scale: 16 / 15 },
  { name: 'waystone (lit)',  key: 'waystone',      frameIdx: 1, scale: 16 / 15 },
  { name: 'charred stakes', key: 'approved_charred_stakes', frameIdx: 0, scale: 4 / 3 },
  { name: 'tar',             key: 'tar',           frameIdx: 0, scale: 1.6 },
  { name: 'headstone', key: 'selected_grave_pillar', frameIdx: 0, scale: 4 / 3 },
  ...GROVE_SHRINE_ART.map(({ name, key, frame, scale }) => ({ name, key, frameIdx: frame, scale })),
  ...[1,4,5,6,7,34,37,38,39,40,54,58,59,61,64,65,66,67,68,69,70,71].map(frameIdx => ({ name: `selected zone object ${frameIdx}`, key: 'zone_objects', frameIdx, scale: frameIdx >= 64 && frameIdx <= 71 ? 1 : 4 / 3 })),
  ...Array.from({ length: 13 }, (_, frameIdx) => [itemsCtx.ROCK_VARIANT_ART.themedScale].map(scale => ({ name: `zone themed rock ${frameIdx} scale ${scale}`, key: 'rock_variants', frameIdx: frameIdx + 52, scale }))).flat(),
  ...Array.from({ length: 16 }, (_, frameIdx) => ({ name: `zone plain rock ${frameIdx}`, key: 'rock_variants', frameIdx: frameIdx + 36, scale: frameIdx % 2 ? itemsCtx.ROCK_VARIANT_ART.largeScale : itemsCtx.ROCK_VARIANT_ART.smallScale })),
  ...Array.from({ length: 36 }, (_, frameIdx) => ({ name: `rock variant ${frameIdx}`, key: 'rock_variants', frameIdx, scale: frameIdx % 2 ? itemsCtx.ROCK_VARIANT_ART.largeScale : itemsCtx.ROCK_VARIANT_ART.smallScale })),
  ...SHEETS.zone_berry_bush.frames.map(frameIdx => ({name: 'berry bush ' + frameIdx, key: 'zone_berry_bush', frameIdx, scale: 2})),
  ...[0,1,2,3,4,5,6,7].map(frameIdx => ({ name: `reef coral ${frameIdx}`, key: 'reef_coral', frameIdx, scale: 4 / 3 })),
  { name: 'vista scope',     key: 'vista_scope',   frameIdx: 0, scale: 1.6 },
  ...SHRINE_KIND_ART.frames.map((f) => ({ name: `shrine kind ${f}`, key: SHRINE_KIND_ART.key, frameIdx: f, scale: SHRINE_KIND_ART.scale })),
  // The POI props (loot.js chestLook — barrel / bike_rack at render.js
  // SMALL_POI_SCALE; the notice board and the gate post at 1.6).
  ...SHEETS.barrel.frames.map(frameIdx => ({ name: `barrel ${frameIdx}`, key: 'barrel', frameIdx, scale: 1.1 * 1.1 })),
  ...SHEETS.clay_pot.frames.map(frameIdx => ({ name: `clay pot ${frameIdx}`, key: 'clay_pot', frameIdx, scale: (4 / 3) * 0.8 * 0.9 * 0.92 * 1.5 })),
  ...SHEETS.clay_pot_smashed.frames.map(frameIdx => ({ name: `pot shards ${frameIdx}`, key: 'clay_pot_smashed', frameIdx, scale: (4 / 3) * 0.8 * 0.9 * 0.92 })),
  { name: 'bike rack',       key: 'bike_rack',     frameIdx: 0, scale: 1.3 },
  { name: 'notice board',    key: 'signpost',      frameIdx: 0, scale: 1.6 },
  { name: 'gate post',       key: 'gatepost',      frameIdx: 0, scale: 1.6 },
];

// Alias registrations read the atlas texture, not the historical path attached
// to an alias row. Standalone profile replacements use their own image geometry.
for (const [key, sheet] of Object.entries(SHEETS)) {
  const asset = ASSETS[key];
  if (!asset) continue;
  sheet.file = asset.kind === 'atlas-alias' ? ASSETS[asset.atlasKey].path : asset.path;
  sheet.fw = asset.frameWidth ?? sheet.fw;
  sheet.fh = asset.frameHeight ?? sheet.fh;
}
for (const sample of rogueTreeCases) {
  const asset = ASSETS[sample.key], bounds = ART_BOUNDS[sample.key + ':__BASE'];
  SHEETS[sample.key] = {file:asset.path,fw:bounds.fw,fh:bounds.fh,frames:['__BASE']};
  SCENARIOS.push(sample);
}

// ── Evaluate one scenario against the rule ─────────────────────────────────
function evaluate(s) {
  const sheet = SHEETS[s.key];
  const fresh = trimSheetFrame(sheet.file, sheet.fw, sheet.fh, sheet.sourceFrame ?? s.frameIdx, s.key);
  if (!fresh) return { ...s, error: 'frame is fully transparent' };
  const lookup = `${s.key}:${s.frameIdx}`;
  const table = ART_BOUNDS[lookup];

  const violations = [];
  // Furniture uses uniform slots with per-item height limits. Tall approved
  // beds/bookcases may extend upward; all bases must remain inside the cell.
  if (s.frameSize) {
    const [width, height] = s.frameSize, left = (fresh.fw - width) / 2;
    if (fresh.minX < left || fresh.maxX > left + width || fresh.minY < fresh.fh - height)
      violations.push(`art exceeds its ${width}×${height} furniture frame`);
  }
  // Drift guard: the seated table must match the real art.
  if (!table) {
    violations.push(`ART_BOUNDS missing "${lookup}" (run --emit-bounds)`);
  } else if (table.minX !== fresh.minX || table.minY !== fresh.minY ||
             table.maxX !== fresh.maxX || table.maxY !== fresh.maxY ||
             table.fw !== fresh.fw || table.fh !== fresh.fh ||
             (s.key === 'furniture' && table.baseX !== fresh.baseX)) {
    violations.push(`ART_BOUNDS "${lookup}" stale (run --emit-bounds)`);
  }
  // One frame, one piece of art (see frameRowGap).
  const gap = sheetFrameRowGap(sheet.file, sheet.fw, sheet.fh, sheet.sourceFrame ?? s.frameIdx, s.key);
  if (gap > MAX_ROW_GAP) {
    violations.push(`frame holds two pieces of art (${gap} empty rows between opaque rows) — ` +
      `the ${sheet.fw}×${sheet.fh} slice reaches into a neighbour on the sheet`);
  }

  // Seat with the SAME maths the renderer uses, then measure the real art box.
  const mirror = box => s.flipX ? { ...box, minX: box.fw - box.maxX, maxX: box.fw - box.minX, baseX: box.fw - box.baseX } : box;
  const box = mirror(table || fresh);
  const shown = mirror(fresh);
  const scaleX = s.scale, scaleY = s.scale * (s.scaleYMul || 1);
  const [ox, oy] = SEAT_ANCHOR;
  const { dxPx, dyPx, fits } = seatInCell(box, ox, oy, scaleX, scaleY, undefined, s.seatFoot);
  const tlx = dxPx - ox * fresh.fw * scaleX;
  const tly = dyPx - oy * fresh.fh * scaleY;
  const left = tlx + shown.minX * scaleX, right = tlx + shown.maxX * scaleX;
  const top = tly + fresh.minY * scaleY, bottom = tly + fresh.maxY * scaleY;
  const artH = bottom - top, centerX = Number.isFinite(s.seatFoot)
    ? tlx + shown.baseX * scaleX : (left + right) / 2;
  const overlap = bottom - CELL_BOTTOM;
  const targetBottom = Number.isFinite(s.seatFoot) ? (s.seatFoot - 0.5) * 32
    : fits ? artH / 2 : CELL_BOTTOM - 1;

  if (overlap > TOL_OVERLAP) violations.push(`overlaps cell below by ${overlap.toFixed(1)}px`);
  if (Math.abs(centerX) > TOL_CENTER) violations.push(`off-centre X by ${centerX.toFixed(1)}px`);
  if (Math.abs(targetBottom - bottom) > TOL_CENTER)
    violations.push(fits ? `not centred (off by ${(bottom - targetBottom).toFixed(1)}px)`
                         : `bottom not 1px above edge (off by ${(bottom - targetBottom).toFixed(1)}px)`);

  return { ...s, fits, artH, bottom, centerX, overlap, violations };
}

// ── Creature check ─────────────────────────────────────────────────────────
// Creatures are exempt from the seat rule, but their CREATURE_ART entries must
// describe the real art: the work wheel is placed from that table, so a
// repainted sheet must not leave it floating. Enemy atlases reference their
// first downward idle pose (pinning the rest pose keeps the wheel from bobbing);
// other sheets use frame 0.
//
// The rule checked is that the ring RESTS ON the crown (its top edge on the
// art's top row), not that its centre sits there.
// Paths are DERIVED: each CREATURE_ART row names its assets.js texture key
// (`sheet`), and assets.js owns where that PNG lives.
const CREATURE_SHEETS = Object.fromEntries(
  Object.entries(CREATURE_ART).map(([kind, a]) => {
    const asset = ASSETS[a.sheet];
    if (!asset || !asset.path) {
      throw new Error(`CREATURE_ART.${kind}.sheet = '${a.sheet}' is not an assets.js texture key`);
    }
    // assets.js is what Phaser cuts the sheet with; a disagreeing row measures a window never drawn.
    if (asset.frameWidth !== a.fw || asset.frameHeight !== a.fh) {
      throw new Error(`CREATURE_ART.${kind} is ${a.fw}x${a.fh} but assets.js cuts `
                    + `'${a.sheet}' at ${asset.frameWidth}x${asset.frameHeight}`);
    }
    return [kind, asset.path];
  }));
// Outer radius of the wheel: the backing disc, one px past the stroked ring.
const WHEEL_R = CREATURE_WHEEL_R + 1;

function evaluateCreature(kind) {
  const file = CREATURE_SHEETS[kind];
  const a = CREATURE_ART[kind];
  const violations = [];
  if (!a) return { kind, violations: ['no CREATURE_ART entry'] };
  if (!file) return { kind, violations: ['no sheet mapped in CREATURE_SHEETS'] };
  const fresh = trimSheetFrame(file, a.fw, a.fh, EnemyRoster.get(kind)?.art.directions?.down?.idle?.[0] ?? 0);
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
  // The ring's top edge rests on the crown, or on an animal too short for a
  // full radius the wheel centres on its midline.
  const want = artTop + Math.min(WHEEL_R, artH / 2);
  if (Math.abs(cy - want) > 0.5) {
    violations.push(`wheel off its seating by ${(cy - want).toFixed(1)}px ` +
                    `(want ${want.toFixed(1)}, got ${cy.toFixed(1)})`);
  }
  // No part of the ring may float above the crown on an animal tall enough to seat it.
  if (artH >= 2 * WHEEL_R && cy - WHEEL_R < artTop - 0.5) {
    violations.push(`wheel overshoots the crown by ${(artTop - (cy - WHEEL_R)).toFixed(1)}px`);
  }
  // It must still touch the body it reports on.
  if (cy + WHEEL_R <= artTop) violations.push('wheel floats clear above the art');
  if (cy - WHEEL_R >= artBottom) violations.push('wheel sits below the art');
  return { kind, artTop, artBottom, cy, violations };
}

// ── --emit-bounds: regenerate the ART_BOUNDS literal for sprite_layout.js ──
function emitBounds() {
  const lines = [];
  for (const [key, sh] of Object.entries(SHEETS)) {
    for (const fi of sh.frames) {
      const b = trimSheetFrame(sh.file, sh.fw, sh.fh, sh.sourceFrame ?? fi, key);
      lines.push(`    '${key}:${fi}': { fw: ${b.fw}, fh: ${b.fh}, ` +
        `minX: ${b.minX}, minY: ${b.minY}, maxX: ${b.maxX}, maxY: ${b.maxY}${key === 'furniture' ? `, baseX: ${b.baseX}` : ''} },`);
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

// ── Wildplant frames: every frame a crop DECLARES must carry art ──────────
// A wildplant's sprite comes from its CROP_SPRITE entry (`frame`, `frames`, or
// `caveFrames`), and the renderer can't tell a frame holding a shell from one
// holding nothing: a blank frame draws a pickup the player can tap but not see
// (the beaches emptied when `shell` declared `variants: 12` on a sheet with 4
// blanks and 5 duplicate/mask cells). This decodes the PNG behind each declared
// frame and fails if it is off the sheet, transparent, or one flat colour (a
// mask silhouette, not art).
function frameInk(img, fw, fh, frameIdx, rect) {
  const cols = Math.floor(img.w / fw), rows = Math.floor(img.h / fh);
  if (!rect && (frameIdx < 0 || frameIdx >= cols * rows)) return null;
  const fx = rect ? rect.x : (frameIdx % cols) * fw, fy = rect ? rect.y : Math.floor(frameIdx / cols) * fh;
  if (rect) { fw = rect.width; fh = rect.height; }
  if (fx < 0 || fy < 0 || fx + fw > img.w || fy + fh > img.h) return null;
  const colours = new Set();
  let opaque = 0;
  for (let y = 0; y < fh; y++) {
    const row = (fy + y) * img.w * 4;
    for (let x = 0; x < fw; x++) {
      const i = row + (fx + x) * 4;
      if (img.data[i + 3] < ALPHA_MIN) continue;
      opaque++;
      colours.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
    }
  }
  return { opaque, colours: colours.size };
}
// One row per (crop, frame) a CROP_SPRITE entry declares on a custom sheet.
function wildFrameRows() {
  const rows = [];
  for (const [crop, ov] of Object.entries(CROP_SPRITE).flatMap(([crop, row]) =>
    [[crop, row], ...Object.entries(row.looks || {}).map(([look, art]) => [crop + '.' + look, art])]).concat(Object.entries(itemsCtx.WILDPLANT_CONTEXT_ART))) {
    if (!ov || !ov.custom) continue;
    const declared = [];
    if (ov.frame != null) declared.push(['frame', ov.frame]);
    for (const f of (ov.frames || [])) declared.push(['frames', f]);
    for (const f of (ov.caveFrames || [])) declared.push(['caveFrames', f]);
    if (typeof ov.variants === 'number') {
      // A COUNT can't be checked without assuming every sheet cell is a sprite (the assumption that broke).
      rows.push({ name: `${crop}`, violations: [
        `CROP_SPRITE.${crop} declares a variant COUNT (${ov.variants}); ` +
        'list the frames that carry art instead (`frames: [...]`)'] });
      continue;
    }
    for (const [field, frameIdx] of declared) {
      const name = `${crop} ${field}[${frameIdx}]`;
      const asset = ASSETS[ov.sheet];
      const violations = [];
      if (!asset) violations.push(`no ASSETS entry for sheet "${ov.sheet}"`);
      else {
        const fw = asset.frameWidth || 16, fh = asset.frameHeight || 16;
        const ink = asset.kind === 'atlas-alias' && !asset.frameRects[frameIdx] ? null
          : frameInk(loadPng(asset.path), fw, fh, frameIdx, asset.frameRects?.[frameIdx]);
        if (!ink) violations.push(`frame ${frameIdx} is off the end of ${ov.sheet}`);
        else if (!ink.opaque) violations.push(`frame ${frameIdx} of ${ov.sheet} is blank`);
        else if (ink.colours < 2) {
          violations.push(`frame ${frameIdx} of ${ov.sheet} is one flat colour ` +
            '— that is a mask/silhouette row, not the sprite');
        }
      }
      rows.push({ name, violations });
    }
  }
  return rows;
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
    // The fruit hangs at the crown's midline: on leaves, not trunk or sky.
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
  evaluate, evaluateCreature, evaluateCrowns, wildFrameRows, frameInk,
  CREATURE_SHEETS, SCENARIOS, SHEETS, ASSETS, CROP_SPRITE, CELL_PX };
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

// ── Wildplant frames: every frame a crop declares must carry art ──────────
const wRows = wildFrameRows();
console.log('\nWildplant frame audit — a declared frame must hold a sprite\n');
console.log(pad('crop frame', 26), '  verdict');
console.log('─'.repeat(80));
let wBad = 0;
for (const r of wRows) {
  const ok = r.violations.length === 0;
  if (!ok) wBad++;
  console.log(pad(r.name, 26), '  ' + (ok ? '✓ OK' : '✗ ' + r.violations.join('; ')));
}
console.log('─'.repeat(80));
console.log(`${wRows.length - wBad} OK, ${wBad} need attention.`);

console.log('\nExempt (not audited): buildings (house/tower/shrine), produce stands,');
console.log('pot-of-gold, crops/wildplants, dropped-item ground stacks. Creatures are');
console.log('exempt from the SEAT rule — only their wheel placement is checked;');
console.log('wildplants only for the frames they declare (above).\n');
process.exit((bad + cBad + crBad + wBad) ? 1 : 0);
