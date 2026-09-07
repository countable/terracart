// Per-frame draw pipeline — extracted from app.js. Owns the cell-grid paint
// (terrain, tilled overlay, pier planks, reach silhouette, treasure X marks)
// and the dynamic sprite-pool dance for chests / planted / wild plants /
// creatures / labels / tier diamonds.
//
// The scene retains thin method forwarders (drawCells / drawObjects /
// renderPool / worldMetersToScreen / screenToWorldMeters) so existing call
// sites — including interact.js, the update() loop, and test/tests.js —
// continue to work without churn.
//
// Depends on:
//   app.js       — MapScene fields used per-frame (read unless noted):
//                    Graphics:   cellGfx, tierGfx
//                    Containers: padContainer, trapContainer,
//                                worldContainer (aliased as objectsContainer /
//                                plantedContainer / creaturesContainer — one
//                                shared, depth-sorted layer)
//                    Pools:      cobblePool, noisePool, padPool, trapPool,
//                                letterPool, objectPool, padPool,
//                                plantedPool, creaturePool, chestLabelPool
//                                (chestLabelPool may be pushed to)
//                    View:       viewCenterX/Y, viewLeft, viewTop, viewSize
//                    World:      startWorldM, playerM, cellM, tileEdgeM,
//                                cellsPerTile, feetOffsetM,
//                                originPx, mPerPx
//                    State:      tilledSet, placedRockSet, brokenRockSet,
//                                save (.foundTreasures, .planted, .picked,
//                                .caught, .opened, .sprungTraps, .tilled —
//                                and .tilled is written-back when self-healing
//                                orphaned tilled cells)
//                    Helpers:    playerToWorldCell, neighborNonRoadColor,
//                                absCellCenterMeters
//                    Phaser:     this.add, this.textures
//   worldgen.js  — WorldGen.tileCache, WorldGen.Z
//   textures.js  — BIOME_TEX, TILLED_VARIANTS, PAD_SHAPES
//   items.js     — CROP_SPRITE, CROP_ROW, CROPS_SHEET_COLS,
//                  SPRING_CROPS_COLS, MAX_GROWTH_STAGE
//   loot.js      — POI_CLASS_FALLBACK, CHEST_TIER_COLOR,
//                  padShapeKeyForPoi, chestTier, rusticifyName
//   save.js      — persistSave (used by drawCells self-heal path)
//   app.js consts — VIEW_CELLS, CELL_PX, COLORS, isTillable
//
// Exports as globals:
//   Render.drawCells(scene)
//   Render.drawObjects(scene)
//   Render.renderPool(scene, pool, container, list, configure)
//   worldMetersToScreen(scene, wmx, wmy) → { x, y }
//   screenToWorldMeters(scene, sx, sy)   → { x, y }
//
// (The scene also keeps one-line methods that forward to these — that's the
// pattern other scene code and tests use.)

const Render = {};

// Fallback fill for cells whose terrain type has no COLORS entry (and for the
// diagonal-neighbour colour painted into rounded corners). Matches the grass
// tone so an unmapped type reads as a green field rather than a black gap.
const GRASS_FALLBACK_COLOR = 0x479757;   // matches COLORS[0] grass (shore-matched)
// Pseudo-3D extrusion: a building footprint is the "top surface", and its
// south-facing edge gets a darker wall projected downward onto the row below.
// Wall face = 40% brightness of the footprint colour (60% darker) — deep
// shadow under the lit top surface, but with enough hue to read as the
// building's own material rather than a generic dark stripe. Houses get a 4px
// wall; civic slabs (LARGE) keep a thicker 5px one to read at their bigger
// footprint scale.
//
// Module scope, and exported on Render, because the TILED pass below is not
// the only thing that draws this wall: building_overlay.js extrudes the source
// POLYGON with the same colours at the same depths, and a wall that changed
// height when the footprint stopped being square would give the two modes
// different silhouettes for the same building.
const BUILDING_FACE_COLOR = { 9: 0x472d24, 11: 0x3c2e22, 12: 0x36373a };
const BUILDING_FACE_PX = { 9: 4, 11: 4, 12: 5 };
// Building tiers, as a predicate. Module scope for the same reason: the base
// terrain fill needs it too, several hundred lines before the outline pass
// that used to own it.
const isBuildingType = (t) => t === 9 || t === 11 || t === 12;
Render.BUILDING_FACE_COLOR = BUILDING_FACE_COLOR;
Render.BUILDING_FACE_PX = BUILDING_FACE_PX;
// The dashed cell grid: a hairline black at 8%, 4 on / 4 off. Faint on
// purpose — it says "the world is on a lattice" without competing with
// anything drawn on it. Shared, because the grid is drawn in TWO places: the
// gridGfx pass below lays it over the ground, and building_overlay.js lays the
// same lattice over each polygon footprint (the tiled floors got it for free,
// sitting a layer under gridContainer; a polygon in a layer above it would
// otherwise wipe the grid out wherever a building stands).
const GRID_LINE = { width: 1, color: 0x000000, alpha: 0.08, dash: 4, gap: 4 };
Render.GRID_LINE = GRID_LINE;
// Is the POLYGONAL building mode on? When it is, building cells paint as the
// GROUND around them here and every piece of tiled building art below is
// skipped — the footprints are drawn from their source rings by
// building_overlay.js instead. Resolved per pass (the flag is a runtime toggle,
// so a frame has to be able to change its mind) and false whenever that module
// isn't loaded, which is what keeps the tiled path the default everywhere else.
const polyBuildings = () =>
  typeof BuildingOverlay !== 'undefined' && BuildingOverlay.enabled();
// Electric light blue — the POI pad's tint. Punchier and more saturated than
// the plain --treasure-deep (#7fb0ff) accent, so the pad itself (the "main
// display" every POI sits on) reads as a live landmark rather than a grey
// concrete disc. Deliberately a step brighter than the rest of the blue-white
// treasure family (spec §UI COLOUR LANGUAGE) — this is the one surface that
// carries the "a place lives here" cue on its own, with no gem to help it
// (the POI's own light in the lightmap breathes beside it — see
// Lighting.KINDS.poi).
const POI_PAD_TINT = 0x33ccff;
// Minor/lowtier POIs (bus stops, ATMs, fuel, etc.) get the same pad shrunk
// down rather than skipped outright — still marked as a place, just a
// smaller one.
const POI_PAD_MINI_SCALE = 0.55;
// Terrain codes drawCells' road/path tests share.
//
// THERE ARE NO COBBLE SPRITES. Until Sep 2026 this pass stamped a pebble on a
// share of every path cell and a stone cluster on a share of every road cell,
// and app.js lit them one at a time as the player walked past. Restoring a
// street is arclength along the WAY now (src/streets.js), drawn by
// road_overlay.js on the band itself at the width the carriageway really is —
// so the thinning rule (cobbleShown), the spacing (COBBLE_SPACING_M), the
// lit-copy textures (litCobbleTexKey) and the scale-pop (PATH_STONE_FLASH_MS)
// all went with them. A stone drawn per CELL could never line up with a band
// stroked per METRE, which is the whole reason the mechanic moved.
const T_PATH = 8;
const isRoadType = (t) => t === 7 || t === 13 || t === 14;

// Both directions of the world⇄screen projection are defined against the CAMERA
// ANCHOR (coords.js viewAnchorWorldM), not the player: they are the same thing
// until a peek drag slides the camera off the body, and going through the
// anchor is what keeps a tap landing on the cell it was drawn over while it has.
// The anchor is spelled out here rather than taken from viewAnchorWorldM: these
// two run per object, per creature and per label EVERY frame, and the helper's
// return object would be a second allocation on each of them.
function worldMetersToScreen(scene, wmx, wmy) {
  const p = peekM(scene);
  const ax = scene.startWorldM.x + scene.playerM.x + p.x;
  const ay = scene.startWorldM.y + scene.playerM.y + p.y;
  return {
    x: scene.viewCenterX + ((wmx - ax) / scene.cellM) * CELL_PX,
    y: scene.viewCenterY + ((wmy - ay) / scene.cellM) * CELL_PX,
  };
}

function screenToWorldMeters(scene, sx, sy) {
  const p = peekM(scene);
  const dx = (sx - scene.viewCenterX) / CELL_PX * scene.cellM;
  const dy = (sy - scene.viewCenterY) / CELL_PX * scene.cellM;
  return {
    x: scene.startWorldM.x + scene.playerM.x + p.x + dx,
    y: scene.startWorldM.y + scene.playerM.y + p.y + dy,
  };
}

// Hide every pooled sprite from startIdx onward — the trailing slots a render
// pass didn't reuse this frame. Centralizes the "drain the rest of the pool"
// loop that each manual render block repeats.
function hidePoolFrom(pool, startIdx) {
  for (let i = startIdx; i < pool.length; i++) pool[i].setVisible(false);
}

// Swap a sprite's texture only when it differs — skips Phaser's redundant
// texture-rebind work on the common frame where the key is unchanged. Returns
// whether it swapped, so a caller can gate a same-frame side effect (e.g.
// (re)starting an animation) on the swap actually having happened.
function setTextureIfDifferent(s, key) {
  if (s.texture.key === key) return false;
  s.setTexture(key);
  return true;
}

// Change-guarded Text style setters. Phaser guards setText / setFontSize /
// setStroke against no-op values, but setColor, setBackgroundColor, setShadow
// and setPadding are UNguarded: each call unconditionally re-measures, redraws
// the label's backing canvas and re-uploads it as a GPU texture. The label
// passes below run per visible label per frame, so on a dense block the
// unguarded setters were dozens of full text rasterizations + texture uploads
// every frame — a large slice of the walking jitter. These wrappers stamp the
// last-applied value on the (pooled, reused) Text object and only touch the
// real setter on change. `key` for the multi-arg setters is any string that
// uniquely encodes the full argument tuple at that call site.
function setColorOnce(tx, color) {
  if (tx._lastInk === color) return;
  tx._lastInk = color;
  tx.setColor(color);
}
function setBgColorOnce(tx, color) {
  if (tx._lastBg === color) return;
  tx._lastBg = color;
  tx.setBackgroundColor(color);
}
function setShadowOnce(tx, key, x, y, color, blur, shadowStroke, shadowFill) {
  if (tx._lastShadow === key) return;
  tx._lastShadow = key;
  tx.setShadow(x, y, color, blur, shadowStroke, shadowFill);
}
function setPaddingOnce(tx, key, left, top) {
  if (tx._lastPad === key) return;
  tx._lastPad = key;
  tx.setPadding(left, top);
}

// The peek drag in SCREEN pixels — how far the camera has slid off the player
// (coords.js peekM, converted through the fixed cell size). Cached geometry
// that is drawn about the viewport centre because the player is normally there
// rides it with setPosition(-x, -y) instead of being rebuilt every frame.
function peekPxOf(scene) {
  const p = peekM(scene);
  const k = CELL_PX / scene.cellM;
  return { x: p.x * k, y: p.y * k };
}

// Cell offset (ox, oy) -> rounded top-left screen pixel, given the sub-cell
// pan fraction (fracX, fracY). drawCells inlined this expression at six call
// sites; factored out here since they all had to stay byte-identical anyway.
// Returns a shared scratch object (not a fresh one) — drawCells calls this up
// to VIEW_CELLS² times per pass, several times a frame, so this avoids an
// allocation per cell; read sx/sy out of it before the next call.
// The reach outline of ONE cell at screen px (sx, sy): its exposed edges
// (top/bot/lft/rgt: that neighbour is out of reach), with the corners rounded
// by ReachCorner (coords.js) — the same rule the lightmap plateau fills by, so
// the white line rounds exactly the corners the light does. An exposed edge
// stops R short of a corner a round continues (ReachCorner.shortenH/V); an
// OUTER corner gets a quarter-arc inside the cell, an INNER corner a fillet
// arc in the empty cell above/below, owned by this cell's horizontal edge so
// each is drawn once (dTL..dBR: the diagonals' reach). At R = 2 px the arc is
// two segments through its 45° point — a true arc is invisible at that size
// and Phaser's ARC command would batch a hundred points per corner.
// Without the rule loaded the edges are drawn full length, square.
Render.reachOutlineCell = function reachOutlineCell(gr, sx, sy, top, bot, lft, rgt, dTL, dTR, dBL, dBR) {
  const x1 = sx + CELL_PX, y1 = sy + CELL_PX;
  const RC = (typeof ReachCorner !== 'undefined') ? ReachCorner : null;
  if (!RC) {
    if (top) gr.lineBetween(sx, sy, x1, sy);
    if (bot) gr.lineBetween(sx, y1, x1, y1);
    if (lft) gr.lineBetween(sx, sy, sx, y1);
    if (rgt) gr.lineBetween(x1, sy, x1, y1);
    return;
  }
  const R = RC.R;
  if (top) gr.lineBetween(sx + (RC.shortenH(lft, dTL) ? R : 0), sy, x1 - (RC.shortenH(rgt, dTR) ? R : 0), sy);
  if (bot) gr.lineBetween(sx + (RC.shortenH(lft, dBL) ? R : 0), y1, x1 - (RC.shortenH(rgt, dBR) ? R : 0), y1);
  if (lft) gr.lineBetween(sx, sy + (RC.shortenV(top, dTL) ? R : 0), sx, y1 - (RC.shortenV(bot, dBL) ? R : 0));
  if (rgt) gr.lineBetween(x1, sy + (RC.shortenV(top, dTR) ? R : 0), x1, y1 - (RC.shortenV(bot, dBR) ? R : 0));
  reachCornerArcs(gr, sx, sy, +1, +1, R, RC.convex(lft, top), RC.fillet(lft, top, dTL));
  reachCornerArcs(gr, x1, sy, -1, +1, R, RC.convex(rgt, top), RC.fillet(rgt, top, dTR));
  reachCornerArcs(gr, sx, y1, +1, -1, R, RC.convex(lft, bot), RC.fillet(lft, bot, dBL));
  reachCornerArcs(gr, x1, y1, -1, -1, R, RC.convex(rgt, bot), RC.fillet(rgt, bot, dBR));
};
// The round at corner point (px, py); (ix, iy) points INTO the cell. A convex
// arc joins (px, py + iy·R) on the vertical edge to (px + ix·R, py) on the
// horizontal one, bowing toward the corner; a fillet joins (px + ix·R, py) on
// this cell's horizontal edge to (px, py − iy·R) on the diagonal cell's
// vertical edge, bowing the same way into the empty cell.
const ARC_MID = 1 - Math.SQRT1_2;   // the 45° point's inset from the corner, per R
function reachCornerArcs(gr, px, py, ix, iy, R, convex, fillet) {
  const m = R * ARC_MID;
  if (convex) {
    gr.lineBetween(px, py + iy * R, px + ix * m, py + iy * m);
    gr.lineBetween(px + ix * m, py + iy * m, px + ix * R, py);
  }
  if (fillet) {
    gr.lineBetween(px + ix * R, py, px + ix * m, py - iy * m);
    gr.lineBetween(px + ix * m, py - iy * m, px, py - iy * R);
  }
}

const _cellScreenXY = { x: 0, y: 0 };
function cellScreenXY(scene, ox, oy, fracX, fracY) {
  _cellScreenXY.x = Math.round(scene.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
  _cellScreenXY.y = Math.round(scene.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);
  return _cellScreenXY;
}

Render.renderPool = function renderPool(scene, pool, container, list, configure) {
  let i = 0;
  for (const item of list) {
    let s = pool[i];
    if (!s) {
      s = scene.add.sprite(0, 0, 'idle', 0);
      container.add(s);
      pool.push(s);
    }
    s.setVisible(true);
    configure(s, item);
    i++;
  }
  hidePoolFrom(pool, i);
};

// Linear blend between two packed RGB colours. t=0 -> a, t=1 -> b.
// Same implementation as BiomeProfiles.mixHex (biome_profiles.js loads before
// this file) — aliased locally rather than deleted since this runs in the
// per-bordered-cell-edge hot path below (getBlend).
const mixHex = BiomeProfiles.mixHex;

// Biome border wave — precomputed once. Values are integer pixel offsets
// (±WAVE_AMP) for each column/row index 0..CELL_PX-1.
const BORDER_W   = 2;
const WAVE_AMP   = 1;
const WAVE_LEN   = 16;
// How far a biome seam darkens the cell's OWN colour. This is now only the
// SHORELINE case: a land cell facing water keeps its dark wet margin, which is
// what gives a shore its dark-margin-then-white-surf band (see the surf comment
// in drawCells). Every other seam blends instead — see BLUR_MIX.
const BORDER_DIM = 0.86;
// Biome seams BLEND rather than outline. A single darkened line, however light,
// still reads as a border drawn AROUND a zone; two biomes meeting in the world
// should read as one grading into the other. Each cell paints a short inward
// ramp of its own colour mixed toward the NEIGHBOUR's, most neighbour-like at
// the boundary. The neighbour paints the mirror of the same ramp, so the seam
// is BLUR_STEPS*BLUR_W px wide on each side — 12px in total across a 32px cell,
// wide enough to read as a gradient and narrow enough that a cell still reads
// as its own colour.
//
// The two innermost values matter more than they look: the outermost step is
// 0.55 rather than 0.5 on purpose. At exactly 0.5 both sides of the boundary
// resolve to the identical colour and the seam goes completely flat, which
// loses the zone edge as a readable thing. Slightly past halfway, each side
// leans a hair toward the other and the transition still has a direction.
const BLUR_STEPS = 3;
const BLUR_W     = 2;                      // px per step
const BLUR_MIX   = [0.55, 0.32, 0.14];     // toward the neighbour, outermost first
const BORDER_TRANS_SKIP = new Set([9, 11, 12]); // buildings only; water + sand now use procedural borders
// Surf: the colour a WATER cell paints its biome-seam edge, in place of the
// darkened own-colour edge every other terrain uses. Pale blue-white rather
// than pure white so it reads as foam lit by the same flat daylight as the
// rest of the map, not as a hard highlight.
const SURF_COLOR = 0xdff0f7;
// Does the edge between a cell painted `color` and a neighbour of terrain
// `nbrType` painted `nbrColor` get the wavy biome border? The rule is just
// "the painted colours differ", with buildings opted out (their own outline
// draws the seam). It lives out here, named and pure, because the interesting
// case is subtle: road/path cells are painted the majority biome AROUND them
// (neighborNonRoadColor), so two adjacent cells of the SAME road tier can
// carry different colours where a road runs along a zone seam — and the old
// rule, which skipped any edge between two road-like cells, dropped the
// border exactly there. See the caller in drawCells for the full story.
function edgeNeedsBorder(color, nbrType, nbrColor) {
  if (BORDER_TRANS_SKIP.has(nbrType)) return false;
  return nbrColor !== color;
}
if (typeof window !== 'undefined') window.edgeNeedsBorder = edgeNeedsBorder;
// Darkened-edge colours (the cell colour blended BORDER_DIM of the way from
// black — per channel round(c * BORDER_DIM)) — stable across frames, ~25
// entries max.
const _darkCache = new Map();
const getDark = (c) => { let d = _darkCache.get(c); if (d === undefined) { d = mixHex(0x000000, c, BORDER_DIM); _darkCache.set(c, d); } return d; };
// Seam blend results, cached like the darkened edges above. Bounded by
// (palette x palette x BLUR_STEPS) and in practice far smaller — only colour
// pairs that actually border each other are ever asked for. The key packs both
// colours and the step into one number rather than a template string: this runs
// per bordered cell edge on every cell-crossing rebuild.
const _mixCache = new Map();
const getBlend = (own, nbr, k) => {
  const key = (own * 0x1000000 + nbr) * BLUR_STEPS + k;
  let m = _mixCache.get(key);
  if (m === undefined) { m = mixHex(own, nbr, BLUR_MIX[k]); _mixCache.set(key, m); }
  return m;
};
const _WAVE_TABLE = (() => {
  const t = new Int8Array(32); // CELL_PX = 32 (also SpriteLayout.CELL_PX)
  for (let i = 0; i < 32; i++)
    t[i] = Math.round(Math.sin(i * 2 * Math.PI / WAVE_LEN) * WAVE_AMP);
  return t;
})();

// Flat-only terrain types (no tileset art) get rounded corners at zone
// boundaries. Module-level: the membership never changes, and drawCells runs
// every frame — rebuilding a 12-element Set 60 times a second bought nothing.
// Watered tilled soil: the old 22%-black wash over the cell, as a sprite tint
// (multiply by 0.78 per channel). Applied to the `tilled_N` pad sprite.
const WATERED_TINT = 0xc7c7c7;
const FLAT_ROUNDABLE = new Set([2, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 25, 30]);  // sand, water, residential, all roads, path, all buildings, rock, cave wall, unmapped fog
// Fog of war — the wash over land the player has never visited.
//
// Pure black, NOT the biome's `atmos.dim` that the out-of-reach wash uses.
// That dim is deliberately tinted so unlit ground still reads as this biome
// after dark; fog is the opposite claim — it is the absence of information,
// and colouring it would say "here is a forest you haven't been to" when the
// point is that the player doesn't know that yet.
//
// 0.8 leaves the terrain faintly legible as shape rather than blacking it out,
// so the world reads as continuous and the revealed region has an edge to it.
// Note it STACKS with the lightmap's falloff (Lighting.FALLOFF_A 0.90 at the
// viewport corner, drawn on the layer just below): out at the corners, fogged
// and explored ground are both close to black and the fog edge is only really
// legible in the mid-field. Retune the pair together if that ever matters.
const FOG_COLOR = 0x000000;
const FOG_ALPHA = 0.8;
// ── The frontier ramp ─────────────────────────────────────────────────────
// The fog does not arrive as a wall. Darkness by DISTANCE from the nearest
// revealed cell, in cells:
//
//   0 (revealed ground)   0
//   1 cell out            0.55
//   2 cells out           0.70
//   3 cells out and past  FOG_ALPHA
//
// The interior deliberately still lands on the old flat value: this softens
// the EDGE, it does not lighten the unknown.
//
// Between those samples the ramp is CONTINUOUS — smoothstep between the whole-
// cell entries, evaluated per texture pixel rather than per cell. That is the
// whole difference between fog and a chequerboard: the ramp used to be three
// concentric SHELLS of 32px rects with hashed corner bites, which softened the
// staircase but was still a staircase — the eye reads any 32px alpha step as a
// UI element sitting on the world, and the bevels only turned the step into a
// row of little chamfered tiles. Sampled continuously there is no step at all.
const FOG_RAMP_A = [0, 0.55, 0.70, FOG_ALPHA];
// How deep the ramp runs, in cells.
const FOG_RAMP_CELLS = FOG_RAMP_A.length - 1;
// The wash starts at the EDGE of explored ground, not at the centre of the last
// explored cell — the distance field measures cell centre to cell centre, so
// half a cell comes back off it. Without that the ramp is centred on the cell
// boundary and the outer half of every frontier cell the player HAS walked sits
// under half-strength fog, which is the one thing the wash may never do: it is
// the record of where you have been. With it the feather onto walked ground
// stays a feather and the darkness lands on the unknown side.
const FOG_EDGE_BIAS = 0.5;
// How far the distance field has to see beyond the cells it reports on: the
// full ramp, plus the cell the bias gives back.
const FOG_FIELD_R = FOG_RAMP_CELLS + 1;

// The ramp, sampled at an arbitrary distance in cells. Smoothstep between the
// table's whole-cell entries: zero slope at every knot, so the piecewise curve
// is smooth across them and no sample band shows.
function fogRampAlpha(d) {
  if (!(d > 0)) return 0;
  if (d >= FOG_RAMP_CELLS) return FOG_ALPHA;
  const i = d | 0, t = d - i;
  return FOG_RAMP_A[i] + (FOG_RAMP_A[i + 1] - FOG_RAMP_A[i]) * (t * t * (3 - 2 * t));
}

// ── The wisps ─────────────────────────────────────────────────────────────
// A smooth ramp alone is a clean gradient, and a clean gradient reads as a
// vignette — a lens effect, not weather. So the distance driving the ramp is
// perturbed by two octaves of value noise before it is sampled, which bends
// the iso-alpha lines into fingers and pockets: fog rolling over ground.
//
// Keyed on the cell's ABSOLUTE world position, which is the whole point: a
// jitter keyed on screen position crawls along the frontier as the player
// walks and reads as the fog boiling. Keyed on the world, the same tongue of
// fog sits over the same ground every time you come back to it.
//
// The push is TAPERED to nothing at both ends of the ramp (4u(1-u), peaking
// mid-ramp). That is not a nicety — it is what keeps the two claims the ramp
// makes intact: ground the player has actually walked never takes a wisp, and
// the deep interior still lands on FOG_ALPHA exactly. Only the frontier moves.
const FOG_WISP_CELLS = 1.7;   // lattice spacing of the base octave, in cells
const FOG_WISP_AMP = 1.1;     // peak push, in cells, at the middle of the ramp

function fogHash(ix, iy) {
  let h = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise in [0,1): a hash per lattice point, smoothstepped between them.
function fogNoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const sx = (x - x0) * (x - x0) * (3 - 2 * (x - x0));
  const sy = (y - y0) * (y - y0) * (3 - 2 * (y - y0));
  const a = fogHash(x0, y0), b = fogHash(x0 + 1, y0);
  const c = fogHash(x0, y0 + 1), d = fogHash(x0 + 1, y0 + 1);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

// Two octaves at absolute cell coordinates — the coarse one shapes the tongues,
// the fine one frays their edges. In [0,1), mean ~0.5.
function fogWisp(ax, ay) {
  const x = ax / FOG_WISP_CELLS, y = ay / FOG_WISP_CELLS;
  return fogNoise(x, y) * 0.65 + fogNoise(x * 2.7 + 19.3, y * 2.7 - 7.1) * 0.35;
}

// Distance, in cells, from every reported cell to the nearest REVEALED one.
//
// `bits` is a W×W row-major array of 0/1 (1 = the player has been to that cell)
// covering the reported window PLUS FOG_FIELD_R cells of margin on every side;
// the result is the inner D×D window, D = W - 2R, as 0 for revealed ground and
// a real distance — measured to the edge of explored ground, see FOG_EDGE_BIAS,
// and clamped at FOG_RAMP_CELLS — for everything else.
//
// Pure and exported so the ramp can be pinned headlessly — the drawing around
// it needs a canvas, this doesn't.
function fogDistField(bits, W, out) {
  const R = FOG_FIELD_R;
  const D = W - 2 * R;
  if (!out || out.length !== D * D) out = new Float32Array(D * D);
  for (let r = 0; r < D; r++) {
    for (let c = 0; c < D; c++) {
      const br = r + R, bc = c + R;
      if (bits[br * W + bc]) { out[r * D + c] = 0; continue; }
      // Nearest revealed cell in the kernel, as a squared distance. Rows whose
      // vertical offset alone already exceeds the best so far can't improve it.
      let best = R * R + 1;
      for (let dy = -R; dy <= R; dy++) {
        const dy2 = dy * dy;
        if (dy2 >= best) continue;
        const rowOff = (br + dy) * W + bc;
        for (let dx = -R; dx <= R; dx++) {
          if (!bits[rowOff + dx]) continue;
          const d2 = dx * dx + dy2;
          if (d2 < best) best = d2;
        }
      }
      const d = Math.sqrt(best) - FOG_EDGE_BIAS;
      out[r * D + c] = d > FOG_RAMP_CELLS ? FOG_RAMP_CELLS : d;
    }
  }
  return out;
}
if (typeof window !== 'undefined') window.fogDistField = fogDistField;

// Bilinear read of a D×D field at fractional cell coordinates (an integer lands
// exactly on that cell's own value, which is what keeps revealed ground at
// distance 0 no matter how finely the texture is sampled). Clamped at the edges.
function fogSample(arr, D, x, y) {
  if (!(x > 0)) x = 0; else if (x > D - 1) x = D - 1;
  if (!(y > 0)) y = 0; else if (y > D - 1) y = D - 1;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 + 1 < D ? x0 + 1 : x0, y1 = y0 + 1 < D ? y0 + 1 : y0;
  const tx = x - x0, ty = y - y0;
  const a = arr[y0 * D + x0], b = arr[y0 * D + x1];
  const c = arr[y1 * D + x0], d = arr[y1 * D + x1];
  const top = a + (b - a) * tx, bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}

// The alpha the fog takes at one point, given the distance field around it.
// `fx`/`fy` are FIELD coordinates (integers on cell centres, 0 = the field's
// first reported cell); `ax`/`ay` the same point's absolute world cell, which
// is what the wisps are keyed on. Pure — the texture loop below is just this,
// ten thousand times.
function fogAlphaAt(dist, D, fx, fy, ax, ay) {
  let d = fogSample(dist, D, fx, fy);
  if (!(d > 0)) return 0;
  const u = d / FOG_RAMP_CELLS;
  d += FOG_WISP_AMP * (fogWisp(ax, ay) - 0.5) * 4 * u * (1 - u);
  return fogRampAlpha(d);
}

// Texture pixels per cell in the low-res buffer the wash is computed in. The
// field it samples only carries information at cell resolution, so painting it
// at 32 would be eight times the arithmetic for detail that isn't there — the
// wisps are the only sub-cell signal, and 8 samples a cell resolves them well
// past the point the upscale can show. Everything finer is left to the smooth
// upscale onto the full-size texture, which is the browser's job and free.
const FOG_SUB = 8;
// Cells the fog texture covers: the drawn range -1..VIEW_CELLS. The 1-cell halo
// is what lets the container scroll by a sub-cell fraction without exposing an
// unfogged edge.
const FOG_TEX_CELLS_PAD = 2;

// Scratch for the field and the texture axis, allocated on first use: the sizes
// derive from VIEW_CELLS, which app.js owns and which isn't readable when this
// file loads (same reason as the ring buffers below).
let _fogBits = null, _fogDist = null, _fogOpen = null;
let _fogAxis = null, _fogSq = null, _fogFlat = null;

// The revealed bits around the player, and the distance field over them.
//
// This reads the fog masks DIRECTLY rather than reusing drawCells' `seen` ring:
// a cell at the edge of the drawn range needs bits FOG_FIELD_R cells further
// out than that ring carries, and widening the ring would put the extra cells
// on the per-frame path for the sake of a pass that rebuilds a few times a
// second. The tile-run trick is the same one the ring scan uses — the window
// spans at most a 2×2 block of tiles, so this resolves a handful of masks, not
// one per cell.
//
// Returns D, the edge of the field, which covers -2..VIEW_CELLS+1: one cell
// beyond the drawn range on each side, so the bilinear read at the very edge of
// the texture still has a neighbour to interpolate towards.
function fogFieldAround(scene, baseIX, baseIY, half) {
  const D = VIEW_CELLS + 4;
  const W = D + 2 * FOG_FIELD_R;
  if (!_fogBits || _fogBits.length !== W * W) {
    _fogBits = new Uint8Array(W * W);
    _fogDist = new Float32Array(D * D);
    _fogOpen = new Float32Array(D * D);
  }
  const N = scene.cellsPerTile;
  const haveFog = (typeof Fog !== 'undefined');
  const off = FOG_FIELD_R + 2;          // bits index 0 is cell -2-R
  let mTx = NaN, mTy = NaN, mMask = null;
  for (let r = 0; r < W; r++) {
    const ay = baseIY + (r - off) - half;
    const ty2 = Math.floor(ay / N);
    const iy2 = ay - ty2 * N;
    for (let c = 0; c < W; c++) {
      const ax = baseIX + (c - off) - half;
      const tx2 = Math.floor(ax / N);
      if (tx2 !== mTx || ty2 !== mTy) {
        mTx = tx2; mTy = ty2;
        mMask = haveFog ? Fog.maskFor(tx2, ty2) : null;
      }
      _fogBits[r * W + c] = mMask ? Fog.bit(mMask, iy2 * N + (ax - tx2 * N)) : 0;
    }
  }
  _fogDist = fogDistField(_fogBits, W, _fogDist);
  return D;
}

// The low-res buffer the wash is computed into, plus its ImageData. One colour
// at varying alpha, so the RGB bytes are written once at creation and only the
// alpha channel is touched per repaint.
function fogScratch(scene, N) {
  let s = scene._fogBuf;
  if (!s || s.n !== N) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    const ctx = canvas.getContext('2d');
    s = scene._fogBuf = { n: N, canvas, ctx, img: ctx.createImageData(N, N) };
    const d = s.img.data;
    const r = (FOG_COLOR >> 16) & 255, g = (FOG_COLOR >> 8) & 255, b = FOG_COLOR & 255;
    for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
  }
  return s;
}

// Repaint the fog texture: the alpha field at FOG_SUB samples per cell, then
// one smooth upscale onto the full-size canvas texture the fog image shows.
//
// The upscale is where the last of the pixel grid goes. The field only knows
// things at cell resolution and the wisps at FOG_SUB; drawing the buffer up to
// CELL_PX with smoothing on turns both into a continuous wash, and Phaser then
// blits the result 1:1 so no texture filter mode (this game runs pixelArt, i.e.
// NEAREST everywhere) can put the steps back.
//
// The cost is paid per CELL CROSSING, not per frame (see the dirty gate at the
// call site), and the FLAT-SQUARE skip below keeps even that proportional to
// the length of the frontier rather than to the area of the screen: bilinear
// interpolation between four equal corners is that value, and a wisp is tapered
// to nothing at both ends of the ramp, so a lattice square whose four cells are
// all revealed — or all past the ramp — is one constant, exactly. Typically
// only the band along the frontier is actually computed. That matters most
// while tiles are still landing, which is the one window where this runs every
// frame and also, veil and all, the window where most squares are constant.
function paintFogTexture(scene, VEIL, anyVeil, baseIX, baseIY, half) {
  const D = fogFieldAround(scene, baseIX, baseIY, half);
  const N = (VIEW_CELLS + FOG_TEX_CELLS_PAD) * FOG_SUB;
  const s = fogScratch(scene, N);
  const data = s.img.data;
  const dist = _fogDist;
  const open = _fogOpen;
  const SQ = D - 1;                      // lattice squares along an edge
  // Field coordinate of each texture axis sample, and the lattice square it
  // falls in. Cell -1 is field index 1 (the field starts at cell -2), and a
  // sample sits at the centre of its sub-pixel, so index i of cell c lands at
  // c + 2 + (i + 0.5)/FOG_SUB - 0.5 — always inside the field, never on its
  // last row or column, so the square index needs no clamping.
  if (!_fogAxis || _fogAxis.length !== N) {
    _fogAxis = new Float32Array(N);
    _fogSq = new Int32Array(N);
  }
  for (let i = 0; i < N; i++) {
    _fogAxis[i] = 1 + (i + 0.5) / FOG_SUB - 0.5;
    _fogSq[i] = _fogAxis[i] | 0;
  }
  // The UNMAPPED VEIL, as a per-cell gate. A cell whose tile hasn't arrived is
  // already drawn as the animated survey-line fog that means "loading", and
  // stacking the wash on that would smother the one thing it exists to show —
  // so the fog is held off it and picks the cell up the moment its tile lands.
  // Sampled bilinearly like everything else, so the handover has no hard edge.
  if (anyVeil) {
    for (let r = 0; r < D; r++) {
      for (let c = 0; c < D; c++) open[r * D + c] = VEIL(c - 2, r - 2) >= 1 ? 0 : 1;
    }
  }
  // Which lattice squares are constant: 1 = no wash at all, 2 = full FOG_ALPHA,
  // 0 = the frontier, compute it properly.
  if (!_fogFlat || _fogFlat.length !== SQ * SQ) _fogFlat = new Uint8Array(SQ * SQ);
  for (let r = 0; r < SQ; r++) {
    for (let c = 0; c < SQ; c++) {
      const i0 = r * D + c, i1 = i0 + D;
      const d0 = dist[i0], d1 = dist[i0 + 1], d2 = dist[i1], d3 = dist[i1 + 1];
      const shut = anyVeil && !open[i0] && !open[i0 + 1] && !open[i1] && !open[i1 + 1];
      const clear = (d0 === 0 && d1 === 0 && d2 === 0 && d3 === 0);
      const deep = (d0 === FOG_RAMP_CELLS && d1 === FOG_RAMP_CELLS
                 && d2 === FOG_RAMP_CELLS && d3 === FOG_RAMP_CELLS);
      const lit = !anyVeil || (open[i0] === 1 && open[i0 + 1] === 1
                            && open[i1] === 1 && open[i1 + 1] === 1);
      _fogFlat[r * SQ + c] = (clear || shut) ? 1 : (deep && lit) ? 2 : 0;
    }
  }
  const deepByte = FOG_ALPHA * 255;
  let i = 3;                             // the alpha byte of pixel 0
  for (let py = 0; py < N; py++) {
    const fy = _fogAxis[py];
    const wy = baseIY + fy - 2 - half;   // field coord → absolute world cell
    const sqRow = _fogSq[py] * SQ;
    for (let px = 0; px < N; px++) {
      const flat = _fogFlat[sqRow + _fogSq[px]];
      if (flat) { data[i] = flat === 1 ? 0 : deepByte; i += 4; continue; }
      const fx = _fogAxis[px];
      let a = fogAlphaAt(dist, D, fx, fy, baseIX + fx - 2 - half, wy);
      if (a > 0 && anyVeil) a *= fogSample(open, D, fx, fy);
      data[i] = a * 255;
      i += 4;
    }
  }
  s.ctx.putImageData(s.img, 0, 0);
  // 'copy' rather than a clearRect + default source-over: the upscale covers
  // every pixel of the texture, so clearing first is a second full-canvas pass
  // for nothing.
  const tex = scene.fogTex, tc = tex.context;
  // Plain bilinear (the default quality), not 'high': the field being upscaled is
  // already smooth, so a costlier resampler buys under one alpha step of
  // accuracy for several times the milliseconds.
  tc.imageSmoothingEnabled = true;
  tc.globalCompositeOperation = 'copy';
  tc.drawImage(s.canvas, 0, 0, N, N, 0, 0, tex.width, tex.height);
  tc.globalCompositeOperation = 'source-over';
  tex.refresh();
}
// Test seams for the frontier ramp — the field, its alpha ladder and the wisp
// taper are pure enough to pin headlessly; only the upscale needs a canvas.
if (typeof window !== 'undefined') {
  window.fogRampAlpha = fogRampAlpha;
  window.fogAlphaAt = fogAlphaAt;
  window.fogSample = fogSample;
  window.fogWisp = fogWisp;
  window.FOG_RAMP_A = FOG_RAMP_A;
  window.FOG_RAMP_CELLS = FOG_RAMP_CELLS;
  window.FOG_FIELD_R = FOG_FIELD_R;
  window.FOG_EDGE_BIAS = FOG_EDGE_BIAS;
  window.FOG_SUB = FOG_SUB;
  window.FOG_ALPHA = FOG_ALPHA;
}
// Scratch buffers for drawCells' per-frame ring scan, reused across frames.
// Allocated on first use rather than at parse time because their size derives
// from VIEW_CELLS, which app.js defines and which therefore is not readable
// until the first call. Every element is overwritten by the scan before it is
// read, so carrying them between frames is safe.
let _ringTypes  = null;
let _ringOwners = null;
let _ringUnclaimed = null;
// Flat [sx, sy, southFaceDepth] triples for the unclaimed-building wash. Reused
// every frame — the pass runs for every visible building cell, and a fresh
// array per frame is garbage the render loop can't afford. CASTLES ARE NOT IN
// HERE: their unclaimed look is baked into the stone they're drawn with, so a
// tier-12 cell never reaches the wash.
const _washCells = [];
// The shade an unclaimed building takes: 35% of the way to dark green, then a
// murk over the top of it — a cold near-black at low alpha, the same idea as
// the fog-of-war wash (FOG_COLOR at FOG_ALPHA) but a fraction of the strength.
// The green alone said "not yours" and read as a colour choice; the murk says
// "unlit, nobody home", which is the thing being communicated. Two passes
// rather than one darker green because they do different jobs — the green
// carries the meaning, the murk carries the mood, and either can be tuned
// without disturbing the other.
//
// The numbers live in textures.js (UNCLAIMED_SHADE) because a CASTLE doesn't
// take this wash at all any more — its stone, turret and court floor are BAKED
// in a second palette put through the same transform. Read from there so the
// painted houses and the baked castles can't drift apart. The literals are the
// headless fallback: render.js loads in the node suite, textures.js can't.
const _USH = (typeof UNCLAIMED_SHADE !== 'undefined') ? UNCLAIMED_SHADE : null;
const UNCLAIMED_WASH = _USH ? _USH.wash : 0x1e3b24;
const UNCLAIMED_WASH_A = _USH ? _USH.washA : 0.35;
const UNCLAIMED_MURK = _USH ? _USH.murk : 0x05070c;
const UNCLAIMED_MURK_A = _USH ? _USH.murkA : 0.12;
// White lerped UNCLAIMED_WASH_A of the way to the wash — the multiply tint that
// lands a sprite roughly where the wash lands the ground under it.
const UNCLAIMED_SPRITE_TINT = (() => {
  const lerp = (a, b, t) => a * (1 - t) + b * t;
  const ch = (sh) => {
    const washed = lerp(255, (UNCLAIMED_WASH >> sh) & 255, UNCLAIMED_WASH_A);
    return Math.round(lerp(washed, (UNCLAIMED_MURK >> sh) & 255, UNCLAIMED_MURK_A));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
})();
// unclaimedShade() is a dozen float ops and the court-floor colour resolution
// below asks for it up to five times per castle cell per frame (the fill, the
// four border comparisons). There are six colours in the whole game that ever
// reach it, so memoise.
const _shadeMemo = new Map();
const _shadeOnce = (n) => {
  if (typeof unclaimedShade !== 'function') return n;
  let v = _shadeMemo.get(n);
  if (v === undefined) { v = unclaimedShade(n); _shadeMemo.set(n, v); }
  return v;
};
// (Tints compose with util.js's mulTint — channel-wise multiply — so an
// unclaimed shop keeps its role colour AND takes the wash, instead of one
// replacing the other.)
// A wash laid on the GROUND, expressed as the multiply tint that lands a
// SPRITE in the same place — white lerped `alpha` of the way to the wash
// colour, exactly the construction UNCLAIMED_SPRITE_TINT is built with. A
// multiply can't reproduce a lerp exactly; what it does reproduce is the
// mid-tones, which is what makes a sprite read as standing in the same light
// as the cells under it.
const _washTint = (color, alpha) => {
  const ch = (sh) => Math.round(255 * (1 - alpha) + ((color >> sh) & 255) * alpha);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
// ── The out-of-reach wash, in ONE place ───────────────────────────────────
// drawCells PAINTS it over every unlit cell (on the lighting layer); the wreck
// sprite tint in drawObjects READS it, so a roof whose footprint just went
// dark goes dark by the same amount instead of by a number of its own. Both
// halves are the same expressions the ground pass has always used: the biome's
// `dim` at 0.38 on the surface, pure black deepening half a step per level
// underground (see the long note at the wash itself for why each is what it
// is).
Render.reachDimColor = (scene) =>
  ((scene.depth ?? 0) > 0 ? 0x000000 : (scene._atmos ? scene._atmos.dim : 0x000000));
Render.reachDimAlpha = (scene) => {
  const d = scene.depth ?? 0;
  return d > 0 ? Math.min(0.88, 0.74 + 0.06 * (d - 1)) : 0.38;
};
Render.reachDimTint = (scene) => _washTint(Render.reachDimColor(scene), Render.reachDimAlpha(scene));

// The multiply tint a world sprite wears, resolved in ONE place so the rules
// compose in a fixed order instead of racing each other down configureObject:
// a shiny's sheen, then the biome's, then — for a house that isn't the
// player's — the derelict wash.
//
// NOT in here any more: the out-of-reach dim. Until Sep 2026 the lighting
// layer sat BELOW the sprites and every sprite was exempt from the reach
// wash — except the wreck, whose roof had to follow its darkened footprint,
// so this function composed the reach dim onto it by hand. The lightmap
// (src/lighting.js) sits ABOVE the sprites now and dims every one of them
// with the ground it stands on, so a wreck outside the bubble goes dark by
// the same amount as its footprint with no help from here. Composing the dim
// again would darken it twice.
// Pure (object + scene in, a colour out), which is also what makes it
// auditable headlessly: test/node/wreck_dim.test.js drives it directly.
Render.spriteTint = function spriteTint(o, scene) {
  // White (no tint) unless one of the three rules below applies. Houses get
  // NO role tint of any kind: a plain house is a delivery host and stays
  // untinted, and a themed shop (blacksmith/trader/market/wizard/trailer)
  // carries its own house_<role> sprite, which tinting would only discolour.
  // The only thing a house can wear is the derelict wash (+ reach dim) at the
  // bottom of this function.
  let tint = 0xffffff;
  // Rare shiny flora — trees + fruit trees get the warm yellow sheen so the
  // player can spot a shiny harvest from across the tile.
  if ((o.kind === 'tree' || o.kind === 'fruittree') && isShiny(o.id, SHINY_RATE.tree)) {
    tint = SHINY_TINT;
  }
  // Per-biome tint for primary interactables (e.g. rusty mineralrock on an
  // industrial lot) — only when nothing more specific (shop/shiny) already
  // tinted it. The cell's terrain was stamped as `_biome` at worldgen time.
  // A spec.after hook (e.g. mineralrock tier shading) may still override.
  if (tint === 0xffffff && typeof BiomeProfiles !== 'undefined' && o._biome != null) {
    const bt = BiomeProfiles.tint(o._biome, o.kind);
    if (bt) tint = bt;
  }
  // A HOUSE that isn't the player's is washed toward dark green with the rest
  // of its footprint (see the wash pass in drawCells). Its SPRITE is not on
  // that canvas — the roof is a pooled image above it — so the same shift is
  // applied here as a multiply tint. Multiply can't reproduce a
  // lerp exactly, so the tint is white lerped 35% toward the wash colour:
  // mid-tones land where the wash puts them and the art keeps its shading.
  // Applied last so it also carries over a shop's own role tint.
  // (A TURRET is exempt: it swaps to its own baked texture above rather than
  // taking the tint, so applying this as well would shade it twice.)
  if (o.kind === 'house' && scene.isClaimedKey && !scene.isClaimedKey(o.id)) {
    tint = mulTint(tint, UNCLAIMED_SPRITE_TINT);
  }
  return tint;
};

// Parallel ring: per-cell "unmapped veil" strength, 0..1. 1 = the cell's map
// tile hasn't loaded (the cell is stamped UNMAPPED_T and renders as fog with
// the survey-line shimmer — the tile-loading indicator); values in between =
// the tile JUST landed and the fog is fading off the freshly revealed ground.
let _ringVeil = null;
// Render-only pseudo-terrain for cells whose tile isn't loaded yet. Never
// written into a tile's grid — spawners, movement and interaction all read
// the real grid, so this can't leak into gameplay. COLORS[30] is the fog
// base; BIOME_TEX[30] the animated shimmer.
const UNMAPPED_T = 30;
// How long the fog takes to fade off a tile once its grid arrives. The stamp
// lives on the tile entry (first frame the renderer SEES it loaded), so the
// reveal happens exactly once per cache entry, at the loading frontier.
const UNMAPPED_REVEAL_MS = 600;
// Reused across frames — cells currently mid-reveal, as (sx, sy, alpha)
// triples for the veil pass on the lighting layer.
const _fadeRects = [];

// ── Atmosphere ───────────────────────────────────────────────────────────────
// Which biome is the player actually IN? The viewport routinely straddles three
// or four of them, so "the terrain under the feet" flickers at every seam and
// makes a terrible atmosphere source. Take the MODE of the visible 11x11
// instead, and only re-sample when the player crosses a cell — between
// crossings the answer physically cannot change, so this costs nothing on the
// frames in between (same dirty-gate discipline as the border + grid layers).
//
// The sampled target is then EASED toward rather than snapped to. Walking from
// the park into the industrial yard should be a felt transition over ~1.5 s;
// snapping would read as a bug. The ease is the whole reason the biome comes
// across as an atmosphere you're standing in rather than a per-cell property.
const ATMOS_EASE_S = 1.5;
// Ground-plane wash strength. Enough to grade the ground toward the biome's
// dead air, low enough that the terrain textures the biomes are told apart by
// still read through it. Above ~0.20 the textures start to disappear.
const ATMOS_GROUND_A = 0.16;
// Rim haze — ramp depth in px and its alpha at the very edge. The falloff is
// quadratic so the haze is dense in the outer few px and gone well before the
// reach bubble.
const ATMOS_RIM_PX = 30;
const ATMOS_RIM_A = 0.44;

// Mode of the rendered VIEW_CELLS x VIEW_CELLS window. `types` carries a 2-cell
// halo on every side (see the RING gather in drawCells); skip it so off-screen
// cells can't vote.
function sampleDominantBiome(types, RING) {
  const counts = new Map();
  let bestType = 0, bestN = -1;
  for (let r = 2; r < RING - 2; r++) {
    for (let c = 2; c < RING - 2; c++) {
      const t = types[r * RING + c];
      const n = (counts.get(t) || 0) + 1;
      counts.set(t, n);
      if (n > bestN) { bestN = n; bestType = t; }
    }
  }
  return bestType;
}

// Unpack/pack helpers for the eased colour. The easing state is kept as FLOAT
// channels, not as a packed int that gets re-rounded every frame: at 60 fps one
// frame of a 1.5 s ease moves a channel by well under 1/255, so rounding to an
// int each step snaps it straight back and the transition STALLS partway —
// leaving the world permanently stuck between two biomes' air.
const _chans = (hex) => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
const _pack = (c) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
const _easeInto = (cur, target, t) => {
  cur[0] += (target[0] - cur[0]) * t;
  cur[1] += (target[1] - cur[1]) * t;
  cur[2] += (target[2] - cur[2]) * t;
};

// Resolve (and ease) the scene's live atmosphere. Returns null when the biome
// registry isn't loaded — every caller then falls back to the old flat black,
// so the renderer still works standalone (node tests, bare harness pages).
function updateAtmos(scene, types, RING, cellChanged) {
  if (typeof BiomeProfiles === 'undefined' || !BiomeProfiles.atmos) return null;
  let a = scene._atmos;
  if (!a) a = scene._atmos = { hazeF: null, dimF: null, targetType: null, lastMs: 0, rimKey: -1 };
  if (cellChanged || a.targetType == null) {
    a.targetType = sampleDominantBiome(types, RING);
    const t = BiomeProfiles.atmos(a.targetType);
    a.hazeT = _chans(t.haze);
    a.dimT  = _chans(t.dim);
  }
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  // Clamp dt: a backgrounded tab resumes with a huge delta, which would snap
  // the ease and defeat the point of having one.
  const dt = a.lastMs ? Math.min(0.25, (now - a.lastMs) / 1000) : 0;
  a.lastMs = now;
  if (!a.hazeF) {                 // first frame — adopt the target outright
    a.hazeF = a.hazeT.slice();
    a.dimF  = a.dimT.slice();
  } else {
    const t = Math.min(1, dt / ATMOS_EASE_S);
    _easeInto(a.hazeF, a.hazeT, t);
    _easeInto(a.dimF,  a.dimT,  t);
  }
  a.haze = _pack(a.hazeF);
  a.dim  = _pack(a.dimF);
  return a;
}

// Rim haze: nested 1px strokes ramping inward from the viewport edge, the same
// technique (and for the same reason — Phaser Graphics has no gradient fill) as
// the black vignette baked in app.js create(). Unlike that one this layer is
// biome-coloured, so it has to be rebuilt when the eased colour moves. Rebuild
// only when the colour changes VISIBLY (quantised to 3 bits per channel): the
// ease is continuous, and rebuilding ATMOS_RIM_PX strokes every frame is
// exactly the per-frame Graphics churn the rest of this file works to avoid.
function drawAtmosRim(scene, haze) {
  const g = scene.atmosRimGfx;
  if (!g) return;
  const key = ((haze >> 21) & 0x7) << 6 | ((haze >> 13) & 0x7) << 3 | ((haze >> 5) & 0x7);
  if (scene._atmos.rimKey === key) return;
  scene._atmos.rimKey = key;
  g.clear();
  for (let i = 0; i < ATMOS_RIM_PX; i++) {
    const t = 1 - i / ATMOS_RIM_PX;             // 1 at the rim -> 0 inward
    g.lineStyle(1, haze, ATMOS_RIM_A * t * t);
    g.strokeRect(
      scene.viewLeft + i + 0.5, scene.viewTop + i + 0.5,
      scene.viewSize - 2 * i - 1, scene.viewSize - 2 * i - 1,
    );
  }
}

Render.drawCells = function drawCells(scene) {
  const g = scene.cellGfx;
  g.clear();
  // One read per pass — every building-art decision below asks it, and a
  // toggle flipping mid-pass would draw half a building.
  const POLY = polyBuildings();
  const gb2 = scene.borderGfx;
  // Castle ramparts split across TWO layers so towers (objectsContainer) sort
  // correctly per edge: the FRONT (south) wall draws ABOVE objects (towers read
  // as standing behind it), while the BACK (north) wall + the E/W SIDE walls
  // draw BELOW objects (towers stand in front of the top wall; side walls sit
  // under everything). Both cleared in lockstep with cellGfx so nothing desyncs.
  const gf = scene.rampartFrontGfx || g;   // front (south) wall — ABOVE objects
  const gb = scene.rampartBackGfx  || g;   // back (north) + side walls — BELOW objects
  if (gf !== g) gf.clear();
  if (gb !== g) gb.clear();
  const half = (VIEW_CELLS - 1) / 2;
  // One clock read per pass for the animated biome textures (water) — every
  // cell must sample the same instant or a pass could straddle a phase step.
  const texNow = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  // The drawn window hangs off the CAMERA ANCHOR, not the body — a peek drag
  // moves this and the whole 11×11 pass paints a different patch of ground for
  // the same cost (see coords.js viewAnchorCell).
  const pc = viewAnchorCell(scene);
  const _wBaseX = pc.cx + pc.tx * scene.cellsPerTile; // hoisted for inferredColor
  const _wBaseY = pc.cy + pc.ty * scene.cellsPerTile;
  const fracX = pc.cx - Math.floor(pc.cx);
  const fracY = pc.cy - Math.floor(pc.cy);
  // Player's absolute cell index in the unified tile-pixel basis. All per-cell
  // state lookups (tilled, watered) must derive from this same basis or they'll
  // drift relative to the rendered cell positions.
  const baseCellIX = pc.tx * scene.cellsPerTile + Math.floor(pc.cx);
  const baseCellIY = pc.ty * scene.cellsPerTile + Math.floor(pc.cy);
  // Planted entries near the viewport, filtered ONCE per pass. The tilled-cell
  // loop below matches each visible tilled cell against save.planted (watered
  // tint + the orphaned-soil self-heal); scanning the whole planted list per
  // cell made that O(visible-tilled × every-crop-ever-planted). The filter
  // keeps every entry that could possibly match an on-screen cell (±0.1 m
  // tolerance, so a one-cell margin is plenty) and the per-cell tests below
  // are unchanged.
  const _plantedNear = [];
  if (scene.save.planted && scene.save.planted.length) {
    const _a = viewAnchorWorldM(scene);
    const _pcx = _a.x;
    const _pcy = _a.y;
    const _spanM = (VIEW_CELLS / 2 + 2) * scene.cellM;
    for (const pp of scene.save.planted) {
      if (Math.abs(pp.x - _pcx) <= _spanM && Math.abs(pp.y - _pcy) <= _spanM) _plantedNear.push(pp);
    }
  }
  // Border layer: only redraw geometry when the camera crosses a cell boundary.
  // Between crossings scroll the container for sub-cell fractional movement.
  // This keeps the Graphics object's draw-command list stable across frames,
  // eliminating the GC churn from clear()+rebuild every frame.
  const borderDirty = baseCellIX !== scene._lastBorderIX || baseCellIY !== scene._lastBorderIY;
  if (borderDirty) { gb2.clear(); scene._lastBorderIX = baseCellIX; scene._lastBorderIY = baseCellIY; }
  // Stamped for the profiler: app.js's drawCells/update wrappers read this
  // to label a crossing frame's cost separately from steady-state frames
  // (see the 'update @crossing' / 'drawCells @crossing' ticks). Plain
  // assignment, no allocation — cheap even when nobody's measuring.
  scene._boot_crossing = borderDirty;
  scene.borderContainer.setPosition(-fracX * CELL_PX, -fracY * CELL_PX);
  let cobbleIdx = 0;
  let noiseIdx = 0;
  let letterIdx = 0;
  // (Road / path terrain tests are the module-scope isRoadType / T_PATH.)
  // PIER (terrain code 23) — wooden walkway over water (OSM transportation:pier).
  // The ONLY thing left on the cobblePool: the road and path stones that
  // shared it are gone (see the note by T_PATH). The pool and its container
  // keep their name — the layer order is pinned on it (tools/layer_audit.js)
  // and a plank is still ground decoration in the same slot.
  // 'pier' is assets/Objects/Wilderness/Bridge Beach.png, 8×14 of
  // 16×16 frames. Frame 20 = row 2 col 4 = an interior tile of the continuous
  // plank-deck band (frames 16-23): 100% opaque wood, no baked-in water, no
  // gaps, no support posts — so it tiles edge-to-edge across adjacent pier
  // cells (vertical OR horizontal runs) as clean decking. The earlier choice
  // (frame 33) was a bridge-span tile with baked-in blue water + a diagonal
  // support leg + transparent holes, which rendered as fragmented "docks with
  // posts and water patches" instead of a solid walkway. Pier cells are NOT
  // roads (no road-name labels) and NOT paths.
  const PIER = 23;
  const PIER_FRAME = 20;
  const WATER = 3;
  // Pre-compute a ring of cell types (VIEW_CELLS+4) — that's the visible 11×11
  // PLUS a 1-cell halo of pre-rendered cells (so the player never sees a black
  // gap at the viewport edge mid-step) PLUS another 1-cell halo for per-corner
  // rounding to read its diagonal neighbor.
  const RING = VIEW_CELLS + 4;
  if (!_ringTypes || _ringTypes.length !== RING * RING) {
    _ringTypes  = new Int8Array(RING * RING);
    // Parallel ring of building ownership. 0 = no building; otherwise
    // (tileSalt<<16)|localId, where localId is the per-tile owner from worldgen
    // and tileSalt distinguishes tiles so two buildings that happen to share a
    // local id in different tiles never read as "the same building".
    _ringOwners = new Int32Array(RING * RING);
    _ringVeil   = new Float32Array(RING * RING);
    // Parallel ring of "this building cell belongs to somebody else". 1 =
    // unclaimed, and gets the dark-green wash below.
    _ringUnclaimed = new Uint8Array(RING * RING);
  }
  const types  = _ringTypes;
  const owners = _ringOwners;
  const unclaimed = _ringUnclaimed;
  // Per-frame memo of ownerKey -> claimed, so a 30-cell footprint asks the save
  // once instead of 30 times. Cleared each frame because a claim can land
  // mid-session (restoring a wreck, unsealing a fort, taking a castle).
  const _claimMemo = new Map();
  const _claimedKey = (k) => {
    if (!k) return true;                       // no key = nothing to own
    let v = _claimMemo.get(k);
    if (v === undefined) {
      v = scene.isClaimedKey ? scene.isClaimedKey(k) : true;
      _claimMemo.set(k, v);
    }
    return v;
  };
  // A tile is ~222 cells on a side, so this 15x15 ring falls inside at most a
  // 2x2 block of tiles and, scanning row-major, long runs of consecutive cells
  // resolve to the same one. Hold the last tile (and its salt, which depends
  // only on the tile) instead of rebuilding a `Z/tx/ty` key string and hitting
  // the Map for all 225 cells on every frame.
  let mTx = NaN, mTy = NaN, mEntry = null, mSalt = 0, mVeil = 0;
  for (let r = 0; r < RING; r++) {
    for (let c = 0; c < RING; c++) {
      const wcx = pc.cx + (c - 2 - half) + pc.tx * scene.cellsPerTile;
      const wcy = pc.cy + (r - 2 - half) + pc.ty * scene.cellsPerTile;
      const N = scene.cellsPerTile;
      const tx2 = Math.floor(wcx / N);
      const ty2 = Math.floor(wcy / N);
      // Integer-modulo for the local cell index — guard against FP drift that can
      // produce ix==N (out-of-bounds → silent grass fallback) at exact tile seams.
      const ix2 = ((Math.floor(wcx) % N) + N) % N;
      const iy2 = ((Math.floor(wcy) % N) + N) % N;
      if (tx2 !== mTx || ty2 !== mTy) {
        mTx = tx2; mTy = ty2;
        mEntry = WorldGen.tileCache.get(WorldGen.tileKey(tx2, ty2));
        mSalt = (((tx2 * 73856093) ^ (ty2 * 19349663)) & 0x7fff);
        // Unmapped veil, per tile: 1 while the tile's grid isn't in hand, then
        // a fade the first time the renderer sees it loaded. The stamp lives
        // on the cache entry, so a tile reveals once and stays revealed.
        if (mEntry && mEntry.grid) {
          if (!mEntry._mappedAtMs) mEntry._mappedAtMs = texNow;
          mVeil = Math.max(0, 1 - (texNow - mEntry._mappedAtMs) / UNMAPPED_REVEAL_MS);
        } else {
          mVeil = 1;
        }
      }
      const e2 = mEntry;
      // A cell with no loaded tile renders as UNMAPPED fog (not fake grass —
      // that's the tile-loading indicator; see the _ringVeil comment above).
      types[r * RING + c] = (e2 && e2.grid) ? (e2.grid[iy2 * N + ix2] || 0) : UNMAPPED_T;
      _ringVeil[r * RING + c] = mVeil;
      const ol = (e2 && e2.owners) ? (e2.owners[iy2 * N + ix2] || 0) : 0;
      owners[r * RING + c] = ol ? ((mSalt << 16) | ol) : 0;
      unclaimed[r * RING + c] =
        (ol && e2.ownerKeys && !_claimedKey(e2.ownerKeys[ol])) ? 1 : 0;
    }
  }
  const T = (c, r) => types[(r + 2) * RING + (c + 2)];   // c,r in -1..VIEW_CELLS (rendered range), -2..VIEW_CELLS+1 reads still valid for halo
  // Atmosphere: re-sample the dominant biome on cell crossings only (borderDirty
  // is exactly that signal), then ease toward it every frame.
  const atmos = updateAtmos(scene, types, RING, borderDirty);
  const OWN = (c, r) => owners[(r + 2) * RING + (c + 2)];
  const UNCLAIMED = (c, r) => unclaimed[(r + 2) * RING + (c + 2)] === 1;
  // An unclaimed castle's COURT is painted in the shaded colour, so every place
  // that resolves a cell's painted colour has to agree: the fill, the rounded
  // corners' diagonal fills, and the wavy-border test that asks whether two
  // cells differ. Disagreeing put a border between every pair of unclaimed
  // court cells — the whole castle floor came out gridded.
  const courtShaded = (t, colour, c, r) =>
    (t === 12 && UNCLAIMED(c, r)) ? _shadeOnce(colour) : colour;
  // Cells whose PAINTED colour isn't COLORS[type] — the ones every neighbour
  // test has to look THROUGH to the zone underneath. Road and path cells are
  // painted the majority biome around them; in polygonal mode a building cell
  // is too (see the base fill below), so the wavy biome borders and the
  // rounded-corner fills have to resolve it the same way or a building would
  // be ringed by a seam against the ground it was just painted to match.
  const lookThrough = (t) => isRoadType(t) || t === T_PATH || (POLY && isBuildingType(t));
  const VEIL = (c, r) => _ringVeil[(r + 2) * RING + (c + 2)];
  _fadeRects.length = 0;
  // (FLAT_ROUNDABLE is module-level — see above.)
  const CORNER_R = 6;
  // (Border wave constants are module-level: BORDER_W, WAVE_AMP, WAVE_LEN,
  //  BORDER_DIM, BORDER_TRANS_SKIP, _WAVE_TABLE — computed once at load time.)
  const TRANS_SKIP = BORDER_TRANS_SKIP;
  // Render a 1-cell halo beyond the visible VIEW_CELLS×VIEW_CELLS so the player
  // never sees a black bar at the viewport edge while sliding between cells.
  // The mask clips the halo to the visible viewport.
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      const ox = col - half;
      const oy = row - half;
      // Per-cell state override: placed rockfruit rocks render as ROCK (10),
      // broken natural rocks revert to GRASS (0). cellKey here matches the
      // tile-pixel basis used for tilled / planted state.
      const _absIX = baseCellIX + ox;
      const _absIY = baseCellIY + oy;
      const _cellKey = cellKeyFromAbsCell(_absIX, _absIY);
      let type = T(col, row);
      if (scene.placedRockSet && scene.placedRockSet.has(_cellKey)) type = 10;
      // Broken rock cells used to revert to type 0 (grass) — that flipped
      // the cell green while the mineralrock-overlay 'after' hook
      // separately darkened the rock sprite. The visual mismatch
      // ("rubble" flash on a grass-coloured tile) confused players. Now
      // we keep type=10 so the broken cell still reads as rock terrain;
      // the dimmed mineralrock sprite alone signals "spent".
      // For ROAD cells, inherit the color of the nearest non-road neighbor so the road
      // band sits on top of the surrounding zone (residential/grass/etc) instead of a hard gray strip.
      let color = COLORS[type] ?? GRASS_FALLBACK_COLOR;
      // An unclaimed castle's COURT is shaded with its stone. The paving
      // overlay baked over this fill (drawCastleFloorTex) is pure alpha, so
      // recolouring the fill recolours the paving with it — no second texture
      // family, and the floor can't end up lit under shaded walls.
      if (type === 12 && UNCLAIMED(col, row)) color = _shadeOnce(color);
      // In POLYGONAL mode a building cell is not a floor — the floor is drawn
      // from the source ring by building_overlay.js — so the cell paints as
      // the GROUND the building stands on, exactly the way a road cell
      // inherits the zone it crosses. Same helper, one sample: the mode of the
      // surrounding non-road, non-building cells. `polyGround` carries the
      // inherited TYPE down to the texture pass below so the cell wears that
      // zone's material too; -1 = paint normally. When nothing but building
      // sits within the sample (deep inside a big footprint) it stays -1 and
      // the tier colour shows through — which is under the polygon anyway.
      let polyGround = -1;
      const polyB = POLY && isBuildingType(type);
      if (isRoadType(type) || type === T_PATH || polyB) {
        const wcx = pc.cx + ox + pc.tx * scene.cellsPerTile;
        const wcy = pc.cy + oy + pc.ty * scene.cellsPerTile;
        if (polyB) {
          const nt = scene.neighborNonRoadType ? scene.neighborNonRoadType(wcx, wcy) : null;
          if (nt != null) { polyGround = nt; color = COLORS[nt] ?? color; }
        } else {
          color = scene.neighborNonRoadColor(wcx, wcy) ?? color;
        }
      }
      const { x: sx, y: sy } = cellScreenXY(scene, ox, oy, fracX, fracY);

      // Mid-reveal cell: its tile just loaded, so the real terrain paints
      // below and the fog fades off it on the lighting layer (drawn there so
      // the veil covers borders / planks / noise, not just the base fill).
      {
        const veil = VEIL(col, row);
        if (veil > 0 && veil < 1) _fadeRects.push(sx, sy, veil);
      }

      // Per-corner rounding: a corner rounds only when both orthogonal neighbors AND the
      // diagonal are a different type (avoids notches between two already-square zones).
      // Sprite-art zones cover the full 32×32 box, so we skip rounding there entirely.
      let tl = 0, tr = 0, bl = 0, br = 0;
      if (FLAT_ROUNDABLE.has(type)) {
        const tn = T(col, row - 1), ts_ = T(col, row + 1);
        const tw = T(col - 1, row), te = T(col + 1, row);
        const tnw = T(col - 1, row - 1), tne = T(col + 1, row - 1);
        const tsw = T(col - 1, row + 1), tse = T(col + 1, row + 1);
        // Road/path cells only paint a BACKDROP here (the inherited zone
        // colour — the carriageway itself is the band drawn above), so for
        // rounding purposes all road/path tiers count as ONE type: a tier
        // change must not round corners, and a road-like diagonal's corner
        // paint must use its inferred backdrop colour, never the raw road
        // grey from COLORS (which left grey notches at elbows/junctions).
        const roadish = (t) => isRoadType(t) || t === T_PATH;
        const selfRoadish = roadish(type);
        const sameAs = (t) => t === type || (selfRoadish && roadish(t));
        if (!sameAs(tn) && !sameAs(tw) && !sameAs(tnw)) tl = CORNER_R;
        if (!sameAs(tn) && !sameAs(te) && !sameAs(tne)) tr = CORNER_R;
        if (!sameAs(ts_) && !sameAs(tw) && !sameAs(tsw)) bl = CORNER_R;
        if (!sameAs(ts_) && !sameAs(te) && !sameAs(tse)) br = CORNER_R;
        // Paint diagonal-neighbor color in each rounded corner first so the pixels
        // revealed outside the curve are the correct adjacent-zone colour.
        const cornerColor = (t, dnx, dny) => lookThrough(t)
          ? (scene.neighborNonRoadColor(_wBaseX + ox + dnx, _wBaseY + oy + dny) ?? GRASS_FALLBACK_COLOR)
          : courtShaded(t, COLORS[t] ?? GRASS_FALLBACK_COLOR, col + dnx, row + dny);
        if (tl) { g.fillStyle(cornerColor(tnw, -1, -1), 1); g.fillRect(sx, sy, CORNER_R, CORNER_R); }
        if (tr) { g.fillStyle(cornerColor(tne, 1, -1), 1); g.fillRect(sx + CELL_PX - CORNER_R, sy, CORNER_R, CORNER_R); }
        if (bl) { g.fillStyle(cornerColor(tsw, -1, 1), 1); g.fillRect(sx, sy + CELL_PX - CORNER_R, CORNER_R, CORNER_R); }
        if (br) { g.fillStyle(cornerColor(tse, 1, 1), 1); g.fillRect(sx + CELL_PX - CORNER_R, sy + CELL_PX - CORNER_R, CORNER_R, CORNER_R); }
      }
      g.fillStyle(color, 1);
      if (tl || tr || bl || br) {
        g.fillRoundedRect(sx, sy, CELL_PX, CELL_PX, { tl, tr, bl, br });
      } else {
        g.fillRect(sx, sy, CELL_PX, CELL_PX);
      }

      // Wavy dark-border at arbitrary biome boundaries.
      // Skip entirely on non-dirty frames — no closures, no neighborNonRoadColor calls.
      if (borderDirty && !TRANS_SKIP.has(type)) {
        const tN = T(col, row - 1), tS = T(col, row + 1);
        const tW = T(col - 1, row), tE = T(col + 1, row);
        // Resolve the inferred colour of a road/path neighbour by looking through it.
        const nbrInferred = (dnx, dny) =>
          scene.neighborNonRoadColor(_wBaseX + ox + dnx, _wBaseY + oy + dny) ?? GRASS_FALLBACK_COLOR;
        // An edge needs the wavy border exactly when the PAINTED colours differ
        // across it — nothing else (edgeNeedsBorder, above). That sounds
        // obvious, but the old test ALSO short-circuited "both sides are
        // road-like → no border", on the assumption that road cells all share
        // one surface colour. They don't: a road cell is painted the majority
        // biome of its 7×7 neighbourhood (neighborNonRoadColor), so a road
        // running ALONG a biome seam flips from the grass colour to the
        // residential colour partway down its own run. That flip is a
        // full-strength colour seam on screen, and the short-circuit
        // suppressed the border on precisely those cells — which is why zone
        // boundaries appeared to lose their decoration wherever a road sat
        // on them.
        // Comparing colours alone also subsumes the old `t === type` skip: two
        // cells of one non-road type always resolve to the same colour.
        // The neighbour's PAINTED colour, which both the needs-a-border test
        // and the blend ramp want — resolved once per side rather than twice.
        const nbrColorOf = (t, dnx, dny) =>
          lookThrough(t) ? nbrInferred(dnx, dny)
            : courtShaded(t, COLORS[t] ?? GRASS_FALLBACK_COLOR, col + dnx, row + dny);
        const cN = nbrColorOf(tN,  0, -1);
        const cS = nbrColorOf(tS,  0, +1);
        const cW = nbrColorOf(tW, -1,  0);
        const cE = nbrColorOf(tE, +1,  0);
        const drawN = edgeNeedsBorder(color, tN, cN);
        const drawS = edgeNeedsBorder(color, tS, cS);
        const drawW = edgeNeedsBorder(color, tW, cW);
        const drawE = edgeNeedsBorder(color, tE, cE);
        if (drawN || drawS || drawW || drawE) {
          // Draw at integer-snapped positions — the borderContainer scrolls by
          // (-fracX*CELL_PX, -fracY*CELL_PX) each frame to handle sub-cell movement,
          // so geometry only needs to be rebuilt when baseCellIX/IY changes.
          const bx = scene.viewCenterX + ox * CELL_PX;
          const by = scene.viewCenterY + oy * CELL_PX;
          // One wavy strip of thickness BLUR_W along `side`, `inset` px in from
          // that edge. Runs are coalesced by wave offset exactly as before —
          // consecutive columns sharing an offset become a single fillRect.
          //   side: 0=N 1=S 2=W 3=E
          const strip = (side, inset) => {
            for (let i = 0, s = 0; i <= CELL_PX; i++) {
              if (i !== CELL_PX && _WAVE_TABLE[i] === _WAVE_TABLE[s]) continue;
              const w = _WAVE_TABLE[s], len = i - s;
              if      (side === 0) gb2.fillRect(bx + s, by + inset + w, len, BLUR_W);
              else if (side === 1) gb2.fillRect(bx + s, by + CELL_PX - inset - BLUR_W + w, len, BLUR_W);
              else if (side === 2) gb2.fillRect(bx + inset + w, by + s, BLUR_W, len);
              else                 gb2.fillRect(bx + CELL_PX - inset - BLUR_W + w, by + s, BLUR_W, len);
              s = i;
            }
          };
          // Water draws foam, not a blend: a shore is where the world's one
          // genuinely hard edge lives, and blurring land into sea would lose
          // both the surf line and the coast. It stays a single BORDER_W strip
          // in SURF_COLOR. The land cell opposite likewise keeps its darkened
          // wet margin (see nbrDark below), preserving the dark-margin-then-
          // white-surf band a real shoreline has.
          //
          // PIER deliberately stays hard-edged too: foam on its own outline
          // traced the decking in white like a sticker, and the water cells
          // around it already lap it with their own foam.
          if (type === WATER) {
            gb2.fillStyle(SURF_COLOR, 1);
            if (drawN) strip(0, 0);
            if (drawS) strip(1, 0);
            if (drawW) strip(2, 0);
            if (drawE) strip(3, 0);
            if (drawN && drawW) gb2.fillCircle(bx + BORDER_W, by + BORDER_W, BORDER_W);
            if (drawN && drawE) gb2.fillCircle(bx + CELL_PX - BORDER_W, by + BORDER_W, BORDER_W);
            if (drawS && drawW) gb2.fillCircle(bx + BORDER_W, by + CELL_PX - BORDER_W, BORDER_W);
            if (drawS && drawE) gb2.fillCircle(bx + CELL_PX - BORDER_W, by + CELL_PX - BORDER_W, BORDER_W);
          } else {
            // Facing water, keep the old darkened margin rather than blending
            // toward the sea colour — that margin is half of the shoreline.
            const edgeCol = (t, nbr, k) =>
              t === WATER ? getDark(color) : getBlend(color, nbr, k);
            for (let k = 0; k < BLUR_STEPS; k++) {
              const inset = k * BLUR_W;
              // A water-facing side has no ramp to walk: draw its flat margin
              // once, on the outermost step only.
              if (drawN && (tN !== WATER || k === 0)) { gb2.fillStyle(edgeCol(tN, cN, k), 1); strip(0, inset); }
              if (drawS && (tS !== WATER || k === 0)) { gb2.fillStyle(edgeCol(tS, cS, k), 1); strip(1, inset); }
              if (drawW && (tW !== WATER || k === 0)) { gb2.fillStyle(edgeCol(tW, cW, k), 1); strip(2, inset); }
              if (drawE && (tE !== WATER || k === 0)) { gb2.fillStyle(edgeCol(tE, cE, k), 1); strip(3, inset); }
              // Round each step's inner corner, as the single-line border did.
              // The N/S colour wins the shared pixel; at BLUR_W the difference
              // from the E/W ramp is under a level.
              const o = inset + BLUR_W;
              if (drawN && drawW) { gb2.fillStyle(edgeCol(tN, cN, k), 1); gb2.fillCircle(bx + o, by + o, BLUR_W); }
              if (drawN && drawE) { gb2.fillStyle(edgeCol(tN, cN, k), 1); gb2.fillCircle(bx + CELL_PX - o, by + o, BLUR_W); }
              if (drawS && drawW) { gb2.fillStyle(edgeCol(tS, cS, k), 1); gb2.fillCircle(bx + o, by + CELL_PX - o, BLUR_W); }
              if (drawS && drawE) { gb2.fillStyle(edgeCol(tS, cS, k), 1); gb2.fillCircle(bx + CELL_PX - o, by + CELL_PX - o, BLUR_W); }
            }
          }
        }
      }

      // (Building outlines are drawn in a second pass after every cell is
      // filled — drawing them inline gets overpainted by the next cell's
      // fillRect on the shared boundary, leaving missing segments.)

      // Tilled check — use the same tile-pixel basis as cell rendering.
      const absCellIX = baseCellIX + ox;
      const absCellIY = baseCellIY + oy;
      const tilledKey = cellKeyFromAbsCell(absCellIX, absCellIY);
      // Tilling is a surface-only activity (cave floor isn't tillable). Gate the
      // overlay on depth 0 so surface farm plots don't bleed through onto the
      // underground levels directly below them (same GPS-mirrored cell coords).
      let isTilled = (scene.depth ?? 0) === 0 && scene.tilledSet && scene.tilledSet.has(tilledKey);
      // Self-heal: if a cell is marked tilled but its actual terrain is non-tillable
      // (e.g. an old save where a GPS jump tilled an unloaded-then-building cell),
      // silently drop it — UNLESS a planted crop still references this cell. Removing
      // the tilled flag from under a live plant produces an "occupied: crop" orphan.
      // Road-BAND cells heal away too: tilling now consults the roadMask
      // (app.js isTillableCell), so soil tilled in the middle of a street
      // under the old type-only rule shouldn't keep rendering there. The mask
      // lookup runs only for cells actually marked tilled — a handful at most.
      let _tilledUnderRoad = false;
      if (isTilled) {
        const N3 = scene.cellsPerTile;
        const t3x = Math.floor(absCellIX / N3), t3y = Math.floor(absCellIY / N3);
        const e3 = WorldGen.tileCache.get(WorldGen.tileKey(t3x, t3y));
        _tilledUnderRoad = !!(e3 && e3.roadMask
          && e3.roadMask[(absCellIY - t3y * N3) * N3 + (absCellIX - t3x * N3)]);
      }
      if (isTilled && (!isTillable(type) || _tilledUnderRoad)) {
        const cc = absCellCenterMeters(scene, absCellIX, absCellIY);
        const hasPlant = _plantedNear.some(pp =>
          Math.abs(pp.x - cc.x) < 0.1 && Math.abs(pp.y - cc.y) < 0.1);
        if (!hasPlant) {
          scene.tilledSet.delete(tilledKey);
          scene.save.tilled = [...scene.tilledSet];
          persistSave(scene.save);
          isTilled = false;
        }
      }
      let isWatered = false;
      if (isTilled) {
        const c = absCellCenterMeters(scene, absCellIX, absCellIY);
        for (const pp of _plantedNear) {
          if (pp.watered_t && Math.abs(pp.x - c.x) < 0.1 && Math.abs(pp.y - c.y) < 0.1) {
            isWatered = true; break;
          }
        }
      }

      // (No soil fill for a tilled cell: the `tilled_N` texture below is an
      // opaque, inset, rounded bed — see textures.js TILLED_INSET_PX — and the
      // terrain colour just painted is what shows in the ring around it.)

      // Procedural texture overlay for every ground cell.
      // All terrain types — including water and sand — use a procedural biome
      // texture (biome{type}_{variant}); transitions are handled by the wavy
      // dark border drawn in gb2 above.
      {
        const ns = scene.noisePool[noiseIdx++];
        const h = (absCellIX * 2246822519) ^ (absCellIY * 3266489917);
        let texKey = null;
        if (isTilled) {
          texKey = `tilled_${Math.abs(h) % TILLED_VARIANTS}`;
        } else {
          // PATH cells render the biome they were painted over (recorded in
          // worldgen's pathUnder) so a footpath reads as stepping-stones on the
          // existing ground rather than carving out a path-coloured patch. The
          // road overlay's band still draws on top (road_overlay.js). Falls
          // back to the path's own base if there's no record or the under-biome
          // has no texture (e.g. commercial/industrial concrete pads).
          let baseType = type;
          // Polygonal mode: the building cell wears the inherited zone's
          // texture (see polyGround above), so nothing under the polygon reads
          // as a floor.
          if (polyGround >= 0) baseType = polyGround;
          else if (type === T_PATH) {
            const N = scene.cellsPerTile;
            const txp = Math.floor(absCellIX / N);
            const typ = Math.floor(absCellIY / N);
            const lix = absCellIX - txp * N;
            const liy = absCellIY - typ * N;
            const e = WorldGen.tileCache.get(WorldGen.tileKey(txp, typ));
            const u = e && e.pathUnder && e.pathUnder[`${lix}_${liy}`];
            if (u != null && BIOME_TEX[u]) baseType = u;
          }
          const spec = BIOME_TEX[baseType];
          if (spec) {
            texKey = `biome${baseType}_${Math.abs(h) % spec.variants}`;
            // Animated biome (water/pier): pick the pre-baked phase frame from
            // the wall clock. setTexture already runs on this sprite every
            // frame, so a time-varying key costs nothing extra — the phases
            // were rasterized once at startup (textures.js makeBiomeTextures).
            // All cells share the clock, so the water drifts as one body.
            if (spec.animPhases) {
              const p = Math.floor(texNow / spec.animMs) % spec.animPhases;
              if (p) texKey += `p${p}`;
            }
          }
        }
        if (texKey) {
          ns.setTexture(texKey);
          // setTexture resets the sprite's intrinsic size; re-apply CELL_PX.
          ns.setDisplaySize(CELL_PX, CELL_PX)
            .setPosition(Math.round(sx), Math.round(sy))
            .setVisible(true);
          // Watered soil reads a shade darker (damp). The pad is an opaque
          // sprite now, so the tint goes on the sprite — a wash on the cell
          // graphics under it would be hidden, and one over it would darken
          // the ground ring too. The pool is reused every frame, so the tint
          // is set on every path, not only the watered one.
          ns.setTint(isWatered ? WATERED_TINT : 0xffffff);
        } else {
          ns.setVisible(false);
        }
      }

      // Road-name label — one compact whole-word text per anchor cell
      // (worldgen drops an anchor every ~12 road cells), laid along the road
      // direction like a map label. Replaced the old letter-per-cell trail,
      // which spelled the name out one glyph per cell and read as noise.
      {
        const lt = scene.letterPool[letterIdx++];
        // Anchors exist only on vehicle road tiers (a footpath is too narrow
        // to carry a label), so the isRoad gate also keeps lookups cheap.
        if (!isTilled && isRoadType(type)) {
          // Look up this cell's label anchor from its owning tile.
          const wcxL = pc.cx + ox + pc.tx * scene.cellsPerTile;
          const wcyL = pc.cy + oy + pc.ty * scene.cellsPerTile;
          const tx2 = Math.floor(wcxL / scene.cellsPerTile);
          const ty2 = Math.floor(wcyL / scene.cellsPerTile);
          const ix2 = Math.floor(wcxL - tx2 * scene.cellsPerTile);
          const iy2 = Math.floor(wcyL - ty2 * scene.cellsPerTile);
          const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx2, ty2));
          const info = entry && entry.roadLabels && entry.roadLabels[`${ix2}_${iy2}`];
          if (info) {
            // Anchored at the cell centre; the word overhangs neighbouring
            // cells along its rotation, which is fine — map labels do too.
            // worldgen pre-normalizes angle into (-90°, 90°] so the text is
            // never upside down.
            lt.setText(info.text).setPosition(sx + CELL_PX / 2, sy + CELL_PX / 2)
              .setRotation(info.angle).setVisible(true);
          } else {
            lt.setVisible(false);
          }
        } else {
          lt.setVisible(false);
        }
      }

      // The PIER plank — the only sprite left on the cobblePool. Road and
      // path stones used to share this slot; a street's paving is the road
      // band's own texture now (road_overlay.js), drawn per METRE at the
      // carriageway's real width instead of per cell.
      {
        const cs = scene.cobblePool[cobbleIdx++];
        // Cell size, no resize: the plank art tiles edge-to-edge across
        // adjacent pier cells (vertical OR horizontal runs) and any resize
        // opens a seam. Fully opaque — it's a solid walkway.
        if (type === PIER && !isTilled) {
          cs.setTexture('pier', PIER_FRAME);
          cs.setFrame(PIER_FRAME);
          cs.setDisplaySize(CELL_PX, CELL_PX)
            .setPosition(Math.round(sx + CELL_PX / 2), Math.round(sy + CELL_PX / 2))
            .setTint(0xffffff)
            .setAlpha(1)
            .setVisible(true);
        } else {
          cs.setVisible(false);
        }
      }

    }
  }
  // Building outline pass — runs AFTER all cells are filled so a neighbour
  // cell's fillRect can't overpaint the shared boundary. For each building cell,
  // stroke each side whose 4-neighbour isn't itself a building.
  const isB = isBuildingType;
  // Two building cells belong to DIFFERENT buildings when both are owned, sit in
  // the same tile (matching salt in the high bits), and carry different local
  // ids. Across a tile seam we can't compare local ids reliably, so we treat the
  // edge as merged (no seam) — avoids slicing a single building that was clipped
  // across two tiles.
  const seamBetween = (a, b) =>
    a !== 0 && b !== 0 && (a >>> 16) === (b >>> 16) && a !== b;
  // A building cell's edge is a "wall" — gets the tier's outline / extrusion —
  // when the 4-neighbour isn't a building at all, OR is a different building.
  // This makes abutting footprints that merged into one block each draw their
  // own silhouette, so they read as separate structures.
  //
  // ONE WALL PER SHARED EDGE. Where two DIFFERENT buildings of the SAME tier
  // abut, both cells used to draw the boundary and the two drawings don't
  // coincide: a castle's south wall hangs 6px BELOW the gridline (crest rising
  // back up into its own cell) while its neighbour's north wall rises 6px
  // ABOVE it (crest on top of that) — a ~16px-tall double rampart for one
  // shared edge, and side walls likewise stack two 4px bands into an 8px one.
  // So only one cell of the pair draws it: the NORTH cell of a horizontal
  // pair (its south wall) and the WEST cell of a vertical pair (its east
  // wall). The boundary then looks exactly like the same building's outer
  // wall, drawn once.
  //
  // Only same-tier neighbours dedupe. A castle abutting a palisade-fenced
  // mid-rise are two different structures in two different materials, and each
  // keeps its own wall — dropping one would leave that building without the
  // silhouette its tier is drawn with.
  const wallEdge = (col, row, dc, dr) => {
    const nb = T(col + dc, row + dr);
    if (!isB(nb)) return true;                                          // open ground → outer wall
    if (!seamBetween(OWN(col, row), OWN(col + dc, row + dr))) return false;   // same building → no wall
    if (nb === T(col, row) && (dc === -1 || dr === -1)) return false;   // partner already drew it
    return true;
  };
  // Pseudo-3D extrusion: see BUILDING_FACE_COLOR / BUILDING_FACE_PX at module
  // scope — the same wall the polygonal overlay extrudes its rings with.
  const SOUTH_FACE_COLOR = BUILDING_FACE_COLOR;
  const SOUTH_FACE_PX = BUILDING_FACE_PX;
  _washCells.length = 0;
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      const type = T(col, row);
      if (!isB(type)) continue;
      // POLYGONAL mode: the floor, the wash, the pickets, the extrusion, the
      // outline and the ramparts are all drawn from the source ring by
      // building_overlay.js. Nothing tiled here — leaving even the outline in
      // would trace the staircase silhouette the polygon exists to replace.
      if (POLY) continue;
      const ox = col - half, oy = row - half;
      const { x: sx, y: sy } = cellScreenXY(scene, ox, oy, fracX, fracY);
      // Note it for the unclaimed wash below, with the depth its south wall
      // extrudes into the row underneath so the wash covers the wall face too
      // (tier 11 pickets stand 5 px proud; 9 and 12 use their own face depth).
      // A castle takes no wash — it is DRAWN unclaimed (the palette pick in the
      // tier-12 branch below, the second turret texture, and the court floor's
      // own base colour above). Everything else gets the overlay.
      if (type !== 12 && UNCLAIMED(col, row)) {
        // How far this cell's art spills out of it — only where the south edge
        // actually carries a wall. Extending every cell upward banded the whole
        // footprint: an interior cell's rect overlapped its neighbour's, so the
        // shared pixels got washed twice and read as stripes.
        const face = wallEdge(col, row, 0, 1)
          ? (type === 11 ? 5 : (SOUTH_FACE_PX[type] || 4)) : 0;
        _washCells.push(sx, sy, face);
      }
      // Tier 11 (mid-rise) — palisade-fenced wood floor: pointed pickets along every
      // perimeter edge, no silhouette/extrusion. Drawn instead of tier 9/12 styling.
      if (type === 11) {
        const WOOD_BODY = 0xa67434, WOOD_SHADOW = 0x6b4520, WOOD_TIP = 0x3a240e;
        const PICKETS = 8, PW = 4;   // 8 pickets × 4px = 32px = CELL_PX
        // South: pickets stand below the cell, tips touching the cell edge.
        if (wallEdge(col, row, 0, 1)) {
          for (let i = 0; i < PICKETS; i++) {
            const px = sx + i * PW;
            g.fillStyle(WOOD_BODY, 1);   g.fillRect(px, sy + CELL_PX, 3, 5);
            g.fillStyle(WOOD_SHADOW, 1); g.fillRect(px + 2, sy + CELL_PX, 1, 5);
            g.fillStyle(WOOD_TIP, 1);    g.fillRect(px + 1, sy + CELL_PX - 1, 1, 1);
          }
        }
        // North/East/West: 3px palisade-top strip with dark stripes between pickets.
        const stripeH = (x, y) => {
          g.fillStyle(WOOD_BODY, 1);   g.fillRect(x, y, CELL_PX, 3);
          g.fillStyle(WOOD_SHADOW, 1); g.fillRect(x, y + 2, CELL_PX, 1);
          g.fillStyle(WOOD_TIP, 1);
          for (let i = 1; i < PICKETS; i++) g.fillRect(x + i * PW - 1, y, 1, 3);
        };
        const stripeV = (x, y) => {
          g.fillStyle(WOOD_BODY, 1);   g.fillRect(x, y, 3, CELL_PX);
          g.fillStyle(WOOD_SHADOW, 1); g.fillRect(x + 2, y, 1, CELL_PX);
          g.fillStyle(WOOD_TIP, 1);
          for (let i = 1; i < PICKETS; i++) g.fillRect(x, y + i * PW - 1, 3, 1);
        };
        if (wallEdge(col, row, 0, -1)) stripeH(sx, sy);
        if (wallEdge(col, row, -1, 0)) stripeV(sx, sy);
        if (wallEdge(col, row, 1, 0)) stripeV(sx + CELL_PX - 3, sy);
        continue;
      }
      // Tier 12 (castle) — STONE RAMPART. The front (south) and back (north)
      // walls carry bold merlons that rise UP from the wall line with clear
      // crenel gaps, aligned across cells. The side (east/west) walls aren't
      // toothed — they read as a dashed shadow line hugging the wall edge, its
      // dashes on the same merlon grid so they line up with the crests.
      // Drawn INSTEAD of the tier-9/12 extrusion + outline below.
      if (type === 12) {
        // Stone comes from the shared castle palette (textures.js
        // CASTLE_STONE) — the same six values the turret texture is drawn
        // from, so a tower reads as the same masonry as the wall it stands on.
        //   BODY  — lit battlement tops
        //   FACE  — the tall extruded N/S wall faces: darker than BODY so the
        //           wall mass reads with depth instead of looking washed out
        //           against the light castle floor
        //   SIDE  — the E/W side-wall crenel dashes: a soft mid-grey so the
        //           gaps between the side merlons aren't harshly dark
        // ...and in the SECOND palette when the castle isn't the player's:
        // CASTLE_STONE_UNCLAIMED is every one of those six stones put through
        // unclaimedShade(). Picked per cell, which is what makes it possible
        // for the castle across the road to be lit while this one isn't.
        const _claimedHere = !UNCLAIMED(col, row);
        const _CS = (typeof CASTLE_STONE === 'undefined') ? null
          : (_claimedHere || typeof CASTLE_STONE_UNCLAIMED === 'undefined'
              ? CASTLE_STONE : CASTLE_STONE_UNCLAIMED);
        // window.__RAMPART_DEBUG tints the three wall pieces apart (north blue,
        // south green, sides red) so corner stacking bugs are visible at a
        // glance — the stone greys are too close to eyeball draw order.
        const _DBG = (typeof window !== 'undefined') && window.__RAMPART_DEBUG;
        const _sh = (n) => (_claimedHere || typeof unclaimedShade === 'undefined')
          ? n : unclaimedShade(n);
        const STONE_LITE   = _CS ? _CS.LITE.n   : _sh(0xb9bcc2);
        const STONE_BODY   = _CS ? _CS.BODY.n   : _sh(0x8f9298);
        const STONE_SHADOW = _CS ? _CS.SHADOW.n : _sh(0x5a5d63);
        const STONE_DARK   = _CS ? _CS.DARK.n   : _sh(0x303134);
        const STONE_FACE   = _CS ? _CS.FACE.n   : _sh(0x7e8188);
        const STONE_SIDE   = _CS ? _CS.SIDE.n   : _sh(0x7a7d84);
        const MERLONS = 4, SPAN = CELL_PX / MERLONS;   // 8px span, divides the cell evenly so teeth tile
        const MW = 4, MOFF = (SPAN - MW) >> 1;         // 4px tooth centred → clear 4px crenel gaps
        const TOOTH_H = 4;       // merlon height ≈ tooth width (4px) — squat, proportioned crenel
        const CREN = 2;          // crenel-level wall (the gaps still show a low parapet)
        const WALL = 8;          // south wall-face height (the lit 3-D extrusion)
        // Ramparts split front vs back/side across two layers (gf above objects,
        // gb below) so towers sort per-edge. The wall stone is a light masonry
        // material that reads against the lighter castle floor.
        // Horizontal battlement crest: a low parapet at `baseY` with merlons
        // rising UP from it, drawn into the supplied graphics layer `gx`. Teeth
        // share the SPAN grid on every wall so front/back crenellations line up.
        const crestH = (gx, x, baseY, dbgTint) => {
          const body = dbgTint ?? STONE_BODY;
          gx.fillStyle(body, 1);   gx.fillRect(x, baseY - CREN, CELL_PX, CREN);
          gx.fillStyle(STONE_SHADOW, 1); gx.fillRect(x, baseY - 1, CELL_PX, 1);
          for (let i = 0; i < MERLONS; i++) {
            const mx = x + i * SPAN + MOFF;
            gx.fillStyle(body, 1);   gx.fillRect(mx, baseY - TOOTH_H, MW, TOOTH_H);
            gx.fillStyle(STONE_LITE, 1);   gx.fillRect(mx, baseY - TOOTH_H, MW, 1);
            gx.fillStyle(STONE_SHADOW, 1); gx.fillRect(mx + MW - 1, baseY - TOOTH_H + 1, 1, TOOTH_H - 1);
          }
        };
        // South / front wall → FRONT layer (above objects). Darker extruded face
        // hangs BELOW the cell, grounded by a 1px dark shadow line at its far
        // (bottom) edge; the lit battlement crest rises up from the bottom edge.
        if (wallEdge(col, row, 0, 1)) {
          // Anything parked in FRONT of (south of) this wall must occlude
          // it — a wall behind an object painting over its art reads
          // backwards. Route just this cell's front wall to the BACK layer
          // so the sprite (worldContainer, above gb) draws on top. Two
          // sources, both stamped by drawObjects last frame:
          //   • _rampartOccludedCells — the set of absolute cells hosting a
          //     world sprite (tree / chest / crop / creature …). One-cell
          //     sprites never cross their own south edge (QC rule), so only
          //     the immediate southern neighbour cell can reach the wall.
          //   • _homeTrailerRect — the Home trailer's screen rect (its house
          //     art is multi-cell + centroid-anchored, so cell membership
          //     alone can't place it). Strip spans crest top … face bottom
          //     (sy+CELL_PX+WALL).
          const occ = scene._rampartOccludedCells;
          const southHosted = occ &&
            occ.has((baseCellIX + ox) + '_' + (baseCellIY + oy + 1));
          const tr = scene._homeTrailerRect;
          const gw = (southHosted || (tr &&
            (tr.y0 + tr.y1) / 2 > sy + CELL_PX &&   // trailer's cell is south of the wall
            tr.y0 < sy + CELL_PX + WALL &&          // and its art reaches up into the strip
            tr.x1 > sx && tr.x0 < sx + CELL_PX)) ? gb : gf;
          gw.fillStyle(_DBG ? 0x30a030 : STONE_FACE, 1); gw.fillRect(sx, sy + CELL_PX, CELL_PX, WALL);
          gw.fillStyle(STONE_DARK, 1); gw.fillRect(sx, sy + CELL_PX + WALL - 1, CELL_PX, 1);
          crestH(gw, sx, sy + CELL_PX, _DBG ? 0x50c050 : undefined);
        }
        // North / back wall → BACK layer (below objects). Same tall extruded face
        // as the front, mirrored to rise ABOVE the cell's top edge, crest on top
        // so the back reads as tall as the front. No dark grounding line here: at
        // the TOP edge it read as an unwanted hard line, not a contact shadow.
        const SIDE_W = 5;
        if (wallEdge(col, row, 0, -1)) {
          // The lower-anchored piece paints in front (the game's painter rule:
          // lower centre of mass renders in front). This band belongs to THIS
          // cell and rises into the cell above — so it must also cover the FOOT
          // of any side band descending to the step from a diagonal-above
          // castle cell. Without the widening, that band's last 12px stuck out
          // beside the crest at every stepped top edge / notch: the top wall
          // did not paint over the side wall in the cell above.
          const extL = (T(col - 1, row - 1) === 12 && wallEdge(col - 1, row - 1, 1, 0)) ? SIDE_W : 0;
          const extR = (T(col + 1, row - 1) === 12 && wallEdge(col + 1, row - 1, -1, 0)) ? SIDE_W : 0;
          gb.fillStyle(_DBG ? 0x3060c0 : STONE_FACE, 1);
          gb.fillRect(sx - extL, sy - WALL, CELL_PX + extL + extR, WALL);
          crestH(gb, sx, sy - WALL, _DBG ? 0x5080e0 : undefined);
          // SOLID crest-height shoulders over the widened columns — the crest
          // rows there must be full stone, not tooth-and-gap, or the covered
          // side band's last pixels still show through beside the teeth. This
          // is what makes the descending band end flush at the band's TOP.
          const shoulder = (x, w) => {
            gb.fillStyle(_DBG ? 0x5080e0 : STONE_BODY, 1);
            gb.fillRect(x, sy - WALL - TOOTH_H, w, TOOTH_H);
            gb.fillStyle(STONE_LITE, 1);
            gb.fillRect(x, sy - WALL - TOOTH_H, w, 1);
          };
          if (extL) shoulder(sx - extL, extL);
          if (extR) shoulder(sx + CELL_PX, extR);
        }
        // Side walls → BACK layer (below objects). No protruding teeth; a light
        // stone edge hugs the wall with shadow dashes on the merlon span so they
        // align with the front/back crests. SIDE_W is the band thickness (5px).
        // WALL / SIDE_W set the wall's visible MASS; the merlon grid (SPAN /
        // MOFF / MW) is independent of both, so thickening the stone keeps the
        // teeth and side dashes on the same grid — still aligned cell to cell.
        // Corner joins follow the painter rule (lower centre of mass in
        // front): the SOUTH wall paints over the side band — the band stops
        // short of the front crest's tooth rows, so the crenel gaps show
        // courtyard floor, not side-wall stone, behind the front wall (by
        // geometry, so it holds even on cells the occlusion routing sends to
        // gb) — and the NORTH wall paints over side-band feet at stepped top
        // edges (the widened band above). At a plain top corner the band runs
        // to the cell top and the full-width north crest caps it.
        const bandY = sy;
        const bandBot = sy + (wallEdge(col, row, 0, 1) ? CELL_PX - TOOTH_H : CELL_PX);
        const sideShade = (x, innerX) => {
          gb.fillStyle(_DBG ? 0xc03030 : STONE_BODY, 1);   gb.fillRect(x, bandY, SIDE_W, bandBot - bandY);
          gb.fillStyle(_DBG ? 0xe06060 : STONE_SIDE, 1);
          // Crenel-grid dashes stay on the cell's own span; skip any dash the
          // shortened bottom would clip so a half-dash can't fray the band end.
          for (let i = 0; i < MERLONS; i++) {
            const dy = sy + i * SPAN + MOFF;
            if (dy + MW <= bandBot) gb.fillRect(x, dy, SIDE_W, MW);
          }
          // 1px darker line on the wall's INTERIOR edge so the side wall reads as
          // a distinct band instead of blurring into the adjacent floor / wall.
          gb.fillStyle(STONE_SHADOW, 1); gb.fillRect(innerX, bandY, 1, bandBot - bandY);
        };
        if (wallEdge(col, row, -1, 0)) sideShade(sx, sx + SIDE_W - 1);
        if (wallEdge(col, row, 1, 0)) sideShade(sx + CELL_PX - SIDE_W, sx + CELL_PX - SIDE_W);
        continue;
      }
      // South wall: tier-specific extrusion, a darker shade of the building
      // tier colour projected one cell downward.
      if (wallEdge(col, row, 0, 1)) {
        const hex = SOUTH_FACE_COLOR[type] || 0x444444;
        g.fillStyle(hex, 0.95);
        g.fillRect(sx, sy + CELL_PX, CELL_PX, SOUTH_FACE_PX[type] || 4);
      }
      // Outer border — fillRect for independent H (4 px) / V (2 px) thickness.
      // Vertical bars start below the top bar so corners are never double-painted
      // (double 50% alpha at the same pixel makes corners darker / look rounded).
      const B = 1;               // left / right border: 1 px
      const BT = type === 12 ? 2 : 1;  // top border: 2 px for LARGE (castle), 1 px otherwise
      g.fillStyle(0x000000, 0.5);
      if (wallEdge(col, row, 0, -1)) g.fillRect(sx,               sy, CELL_PX, BT);
      if (wallEdge(col, row, -1, 0)) g.fillRect(sx,               sy, B, CELL_PX);
      if (wallEdge(col, row, 1, 0)) g.fillRect(sx + CELL_PX - B, sy, B, CELL_PX);
    }
  }
  // ── Somebody else's ────────────────────────────────────────────────────
  // A building the player hasn't taken back is washed toward dark green, so
  // the map answers "what is mine" at a glance instead of one modal at a time.
  //
  // ONE PASS OVER THE FINISHED CELLS, not a tint threaded through the dozen
  // fills above. A 35% wash of a colour composites to exactly the same result
  // as mixing every one of those colours 35% toward it — 0.65·base + 0.35·green
  // either way — and this way it cannot miss a part: the floor, the south
  // extrusion, the silhouette outline, a fort's palisade pickets and a
  // castle's rampart stones are all already on the canvas underneath it.
  //
  // Runs after the whole building loop rather than inside it because the tier
  // 11 and 12 branches `continue` before the end, so a per-cell wash written
  // in the loop would be painted UNDER the palisade and the ramparts it is
  // supposed to cover.
  if (_washCells.length) {
    // ONTO THE RIGHT LAYER. This used to paint into `g`, the terrain graphics —
    // which is under a house's own extrusion and outline and under a fort's
    // pickets, so the wash reached the floor and nothing else. gb sits above
    // the terrain, so one pass there covers all three.
    //
    // It no longer needs a second pass on the front layer: that pass existed
    // for the castle's south rampart (drawn in gf, above the world sprites),
    // and the castle is baked now.
    const paint = (gx, colour, alpha) => {
      gx.fillStyle(colour, alpha);
      for (let i = 0; i < _washCells.length; i += 3) {
        gx.fillRect(_washCells[i], _washCells[i + 1], CELL_PX, CELL_PX + _washCells[i + 2]);
      }
    };
    const gbW = scene.rampartBackGfx || g;
    paint(gbW, UNCLAIMED_WASH, UNCLAIMED_WASH_A);
    paint(gbW, UNCLAIMED_MURK, UNCLAIMED_MURK_A);
    _washCells.length = 0;
  }
  // Reach indicator — subtle white outline tracing only the outer edge of the
  // reachable area. The origin is the PLAYER'S CURRENT CELL CENTRE, not their
  // feet, so reach depends only on which cell they're standing in (a fixed
  // number of cells in each cardinal direction — independent of intra-cell
  // position). For each reachable cell, draw only the sides whose neighbour is
  // NOT reachable. Result is the staircase silhouette of the reach region.
  // Visual reach: delegate to the shared cellInReach helper (coords.js)
  // so the lit area on screen and the tap-accept area in interact.js are
  // computed from the same integer-cell math. Earlier this path used a
  // local hypotenuse check against a separately computed feet-cell row,
  // and the user reported the leftmost lit cell occasionally flashing
  // "too far" — eliminating the duplicated math closes any way for the
  // two to drift (intra-cell fracY rounding, FP slop, basis mismatch).
  // cellInReach handles reach via coords.js reachRadiusM: 0 energy = no reach,
  // otherwise the radius is 2.5 cells growing to 5.5 via Inner Light upgrades,
  // then shrunk half a cell per level underground (floored at 1.5).
  //
  // Per-frame hoist: the four reach loops below call isReach ~1000 times a
  // frame (the outline pass probes each cell plus its four neighbours), and
  // cellInReach recomputes reachRadiusM (a Date.now()) and playerReachCell (a
  // fresh {cellIX, cellIY} allocation) on every call — ~60k throwaway objects
  // a second. Both are constant for the frame, so evaluate them once here and
  // inline cellInReach's distance test with the SAME expressions in the same
  // order, keeping the visual outline byte-identical to the tap-accept test
  // in interact.js (which still goes through cellInReach itself).
  const _reachM = reachRadiusM(scene);
  const _reachM2 = _reachM * _reachM;
  const _reachP = playerReachCell(scene);
  const isReach = (col, row) => {
    if (_reachM <= 0) return false;
    const absIX = baseCellIX + (col - half);
    const absIY = baseCellIY + (row - half);
    const dx = (absIX - _reachP.cellIX) * scene.cellM;
    const dy = (absIY - _reachP.cellIY) * scene.cellM;
    return dx * dx + dy * dy <= _reachM2;
  };
  // The DARKNESS is not painted here any more. Until Sep 2026 this block laid
  // the out-of-reach dim (a fillRect per unlit cell), the underground lit-dim,
  // the low-energy pink and ~100 cached falloff rings — all of it darkness,
  // which composes only one way (two dims overlap darker) and so could never
  // host a second light. The lightmap in src/lighting.js replaced the lot:
  // an ambient floor plus one additive cookie per light (the player, Home, a
  // restored building, a campfire), multiplied over the world from the
  // lightMap layer ABOVE the sprites. Its levels are DERIVED from the same
  // reachDimColor / reachDimAlpha this pass painted with, so the surface
  // with only the player lit looks as it did. See Lighting.profile.
  //
  // What stays on this layer is the per-cell work: the unmapped-tile reveal
  // and the white reach OUTLINE — the tap affordance, which must remain
  // cell-exact (cellInReach) where a cookie can only ever be a circle.
  const depth = scene.depth ?? 0;
  // Every pass from here to the reach outline paints onto reachGfx (app.js),
  // not the terrain graphics: in cellGfx — the bottom-most layer — the biome
  // seams, planks, road letters and pads drawn above it would cover the
  // outline. Falling back to `g` keeps a scene without the layer rendering
  // rather than throwing.
  const gr = scene.reachGfx || g;
  if (gr !== g) gr.clear();
  // Unmapped-tile reveal: fog fading off cells whose tile arrived within the
  // last UNMAPPED_REVEAL_MS (collected in the cell loop above). Painted first
  // on this layer so the reach outline reads on top of the reveal.
  for (let i = 0; i < _fadeRects.length; i += 3) {
    gr.fillStyle(COLORS[UNMAPPED_T], _fadeRects[i + 2]);
    gr.fillRect(_fadeRects[i], _fadeRects[i + 1], CELL_PX, CELL_PX);
  }
  // The reach outline stays LAST on this layer, so the white edge sits on top
  // of the dim band rather than under it — the relative order these passes
  // had inside cellGfx, preserved. Kept deliberately soft (thin, low alpha):
  // the dim step already marks the boundary, so the line only needs to hint
  // at the edge, not draw a hard white frame around the lit area.
  gr.lineStyle(2, 0xffffff, 0.15);
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      if (!isReach(col, row)) continue;
      const ox = col - half, oy = row - half;
      const { x: sx, y: sy } = cellScreenXY(scene, ox, oy, fracX, fracY);
      const top = !isReach(col, row - 1);
      const bot = !isReach(col, row + 1);
      const lft = !isReach(col - 1, row);
      const rgt = !isReach(col + 1, row);
      if (!top && !bot && !lft && !rgt) continue;   // interior: nothing to trace
      Render.reachOutlineCell(gr, sx, sy, top, bot, lft, rgt,
        isReach(col - 1, row - 1), isReach(col + 1, row - 1), isReach(col - 1, row + 1), isReach(col + 1, row + 1));
    }
  }

  // Atmosphere washes. Both are single, flat draws over the viewport — the cost
  // of the whole depth-layering effect is one fillRect per frame plus a rim
  // rebuild on the rare frame where the eased colour visibly moved.
  //
  // SURFACE ONLY, for the same reason the out-of-reach dim stays black
  // underground: down there the torch bubble's contrast against dead rock is
  // the entire readability budget, and laying more washes over it — however
  // atmospheric — spends what little is left. The caves already carry their own
  // (much heavier) atmosphere from the depth-scaled dim. Both layers are
  // cleared on the way down so a surface wash can't persist into the dark.
  if (atmos && (scene.depth ?? 0) === 0) {
    const ag = scene.atmosGroundGfx;
    if (ag) {
      ag.clear();
      ag.fillStyle(atmos.haze, ATMOS_GROUND_A);
      ag.fillRect(scene.viewLeft, scene.viewTop, scene.viewSize, scene.viewSize);
    }
    drawAtmosRim(scene, atmos.haze);
  } else if (atmos) {
    scene.atmosGroundGfx?.clear();
    scene.atmosRimGfx?.clear();
    scene._atmos.rimKey = -1;   // force a rebuild when we surface again
  }

  // Grid lines align with cell edges. Cells are positioned at
  //   sx = viewCenterX + (ox - fracX) * CELL_PX  (cell center)
  //   left edge = sx - CELL_PX/2 = viewLeft + CELL_PX/2 + (j - fracX) * CELL_PX
  // so grid lines need the same +CELL_PX/2 offset.
  // Dashed grid lines — cached in gridGfx, only rebuilt on cell crossing.
  // 1,300 lineBetween calls/frame at 60fps fills the GC nursery quickly;
  // the container scroll handles sub-cell movement between redraws.
  const gg = scene.gridGfx;
  const gridDirty = baseCellIX !== scene._lastGridIX || baseCellIY !== scene._lastGridIY;
  if (gridDirty) {
    gg.clear();
    scene._lastGridIX = baseCellIX;
    scene._lastGridIY = baseCellIY;
    gg.lineStyle(GRID_LINE.width, GRID_LINE.color, GRID_LINE.alpha);
    const DASH = GRID_LINE.dash, GAP = GRID_LINE.gap;
    const vTop = scene.viewTop, vLeft = scene.viewLeft, vSize = scene.viewSize;
    // Draw at integer-snapped positions (no fracX/fracY) — container handles scroll.
    for (let i = -1; i <= VIEW_CELLS + 1; i++) {
      const x = Math.round(vLeft + i * CELL_PX + CELL_PX / 2);
      const y = Math.round(vTop  + i * CELL_PX + CELL_PX / 2);
      for (let d = vTop; d < vTop + vSize; d += DASH + GAP)
        gg.lineBetween(x, d, x, Math.min(d + DASH, vTop + vSize));
      for (let d = vLeft; d < vLeft + vSize; d += DASH + GAP)
        gg.lineBetween(d, y, Math.min(d + DASH, vLeft + vSize), y);
    }
  }
  scene.gridContainer.setPosition(-fracX * CELL_PX, -fracY * CELL_PX);

  // Treasure marks — subtle X on the ground (unfound only). Drawn from the
  // camera anchor (they're marks on the ground, so they slide with a peek);
  // the 3×3 tile scan below stays on the PLAYER's tile, which covers the
  // peeked window many times over (a tile is hundreds of cells wide).
  const _anchor = viewAnchorWorldM(scene);
  const pWorldX = _anchor.x;
  const pWorldY = _anchor.y;
  const halfM = (VIEW_CELLS / 2 + 1) * scene.cellM;
  const found = setOf(scene.save.foundTreasures);
  g.lineStyle(2, 0x2a1d10, 0.55);
  const drawX = (tr) => {
    if (!tr || found.has(tr.id)) return;
    const dx = tr.x - pWorldX, dy = tr.y - pWorldY;
    if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) return;
    const cx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const cy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    const s = 5.1;   // 15% smaller than the old 6px; X is symmetric so the centroid (cx,cy) is unchanged.
    g.lineBetween(Math.round(cx - s), Math.round(cy - s), Math.round(cx + s), Math.round(cy + s));
    g.lineBetween(Math.round(cx + s), Math.round(cy - s), Math.round(cx - s), Math.round(cy + s));
  };
  // Treasure marks — only check the player's 3×3 tile neighbourhood. drawX
  // already culls by viewport, but iterating all cached tiles every frame
  // gets expensive once a session has visited many tiles.
  {
    const tpc = scene.playerToWorldCell();
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(tpc.tx + dtx, tpc.ty + dty));
        if (!entry) continue;
        drawX(entry.treasure);
        if (entry.parkingTreasures) for (const tr of entry.parkingTreasures) drawX(tr);
        if (entry.extraTreasures) for (const tr of entry.extraTreasures) drawX(tr);
      }
    }
  }

  // ── Fog of war ────────────────────────────────────────────────────────────
  // Land the player has never been to is washed FOG_ALPHA black. Three things
  // about this pass are load-bearing:
  //
  // 1. THE LAYER. It paints scene.fogTex, the canvas texture the fog image
  //    shows, and that image sits at the very top of the world display list —
  //    above the sprites, above the rim haze and the distance falloff, above
  //    the labels. Every darkening pass before it had to learn the same lesson
  //    the hard way: the out-of-reach dim started life in cellGfx and could
  //    only reach the base terrain fill (biome seams read as glowing lines in
  //    the dark), and the distance falloff had to move above the sprites for
  //    the same reason (objects at the rim stayed lit and read as stickers on
  //    dark ground). Fog is the strongest claim of the lot — "you have not been
  //    here" — so it covers everything the world draws, including the POI name
  //    tablets, which are otherwise crisp UI and would happily announce the
  //    name of a shop the player has never found.
  //
  // 2. THE DIRTY GATE. The fog image is identical frame to frame until the
  //    player crosses a cell (borderDirty — the same signal the biome-seam
  //    layer uses) or something is newly revealed (Fog.revision). Between
  //    crossings the container just SCROLLS by the sub-cell fraction, exactly
  //    as borderContainer does, so the texture is laid out in whole cells with
  //    no fracX baked in. That is what pays for everything below: the wash is
  //    computed and uploaded once per CELL CROSSING — one every seven metres of
  //    walking — against the 169-per-FRAME the out-of-reach dim spends a few
  //    layers down. The 1-cell halo the texture carries (-1..VIEW_CELLS) is
  //    what keeps the scroll from exposing an unfogged edge.
  //
  // 3. IT IS A TEXTURE, NOT RECTS. The wash used to be Graphics fills: three
  //    concentric shells of 32px rects with hashed corner bites. That softened
  //    the frontier but could not stop it being made of cells — the eye reads a
  //    32px alpha step as a UI element sitting on the world, and the bites just
  //    turned the staircase into chamfered tiles. Now the alpha is a continuous
  //    field (fogRampAlpha over a distance field, bent by world-keyed wisps),
  //    sampled at FOG_SUB per cell and smooth-upscaled to CELL_PX, so there is
  //    no step anywhere in it. What is NOT softened: ground the player has
  //    walked stays clear and the interior still lands on FOG_ALPHA exactly —
  //    the wisp taper (see fogAlphaAt) is what guarantees both.
  if (scene.fogTex && scene.fogImage && scene.fogContainer) {
    scene.fogContainer.setPosition(-fracX * CELL_PX, -fracY * CELL_PX);
    const fogRev = (typeof Fog !== 'undefined') ? Fog.revision : 0;
    // Underground has its own darkness (the torch bubble) and no persistent
    // map to explore, so fog is a surface feature. Hide it on descent rather
    // than leaving the last surface frame frozen over the cave.
    const fogOn = depth === 0;
    // ...and one more input: the UNMAPPED VEIL. A cell whose tile hasn't
    // arrived is already drawn as the animated survey-line fog that says
    // "loading", and stacking 80% black on that would smother the one thing it
    // exists to show. So a fully veiled cell is left alone and picked up as
    // ordinary fog the moment its tile lands. That handover happens mid-fade,
    // on no cell crossing of its own, so while anything on screen is still
    // veiled the pass stays dirty and rebuilds each frame — a few frames at
    // the loading frontier, which is exactly the window where the image is
    // genuinely changing.
    if (borderDirty || fogRev !== scene._fogRev || fogOn !== scene._fogWasOn
        || scene._fogVeiled) {
      scene._fogRev = fogRev;
      scene._fogWasOn = fogOn;
      let stillVeiled = false;
      scene.fogImage.setVisible(fogOn);
      if (fogOn) {
        // Cells whose tile is still fully veiled are left to the survey-line
        // shimmer, but the pass stays dirty while any of them is on screen.
        for (let row = -1; row <= VIEW_CELLS && !stillVeiled; row++) {
          for (let col = -1; col <= VIEW_CELLS; col++) {
            if (VEIL(col, row) > 0) { stillVeiled = true; break; }
          }
        }
        // The image is laid out in whole cells from the top-left of the halo;
        // the container above carries the sub-cell scroll.
        scene.fogImage.setPosition(scene.viewCenterX + (-1 - half) * CELL_PX,
                                   scene.viewCenterY + (-1 - half) * CELL_PX);
        // Only the actual repaint is timed — this whole block is already
        // gated by the dirty check above (crossing / reveal / veil), so the
        // tick only fires on the expensive path, never the frames it's
        // skipped for.
        const _fogB = window.__boot;
        if (_fogB) {
          const _t0 = performance.now();
          paintFogTexture(scene, VEIL, stillVeiled, baseCellIX, baseCellIY, half);
          _fogB.tick('fog paint', performance.now() - _t0);
        } else {
          paintFogTexture(scene, VEIL, stillVeiled, baseCellIX, baseCellIY, half);
        }
      }
      scene._fogVeiled = stillVeiled;
    }
  }
};

// Labels draw ABOVE the player (depth 50/51 against the player's 10), and a POI
// name anchors BELOW its sprite — so a label routinely lands on the cell the
// player is standing in and covers the character. QC_RULES §3 already says
// ground decals mustn't draw over the player; this is the same rule from the
// other side. Rather than reordering the layers (a label still needs to read
// over a building), any label whose box overlaps the player's fades back.
const LABEL_OVER_PLAYER_ALPHA = 0.3;
// The player's screen box, inset a little so a label merely touching the
// sprite's transparent margin doesn't trip it. Null when there's no player
// sprite yet (boot, or a stub scene in tests) — then nothing fades.
function playerScreenBox(scene) {
  const p = scene.player;
  if (!p || !p.visible) return null;
  const inset = 3;
  const w = p.displayWidth, h = p.displayHeight;
  return {
    x0: p.x - w * p.originX + inset, x1: p.x + w * (1 - p.originX) - inset,
    y0: p.y - h * p.originY + inset, y1: p.y + h * (1 - p.originY) - inset,
  };
}
// Dim `tx` when it overlaps `box`; restore it to full alpha when it doesn't.
function fadeLabelOverPlayer(tx, box) {
  if (!box) { tx.setAlpha(1); return; }
  let w = tx.width, h = tx.height;
  let x0 = tx.x - w * tx.originX, y0 = tx.y - h * tx.originY;
  // Quarter-turned labels (the vertical POI names) occupy a box that is the
  // transpose of the text's own: rotating by -90° maps the glyph run's width
  // onto screen Y and its line height onto screen X. Without this the fade
  // test used the unrotated box and let a vertical name sit right across the
  // character at full opacity.
  if (Math.abs(Math.abs(tx.rotation || 0) - Math.PI / 2) < 0.01) {
    const up = (tx.rotation || 0) < 0;   // -90° reads bottom-to-top
    x0 = tx.x - h * tx.originY;
    y0 = up ? tx.y - w * (1 - tx.originX) : tx.y - w * tx.originX;
    const t = w; w = h; h = t;
  }
  const hit = x0 < box.x1 && x0 + w > box.x0 && y0 < box.y1 && y0 + h > box.y0;
  tx.setAlpha(hit ? LABEL_OVER_PLAYER_ALPHA : 1);
}

Render.drawObjects = function drawObjects(scene) {
  // Canvas width, for keeping centred labels on screen (see clampTextX in
  // util.js). Same 352 the game canvas is sized to. Computed HERE, not at
  // script top level: VIEW_CELLS / CELL_PX come from app.js, which loads AFTER
  // render.js, so a top-level read threw at evaluation time and left
  // Render.drawObjects unassigned ("Render.drawObjects is not a function").
  const CANVAS_W = VIEW_CELLS * CELL_PX;
  // Resolve the starter shop id as soon as the spawn tile's houses have
  // loaded, so the trailer sprite + Home tint apply on first render (rather
  // than waiting for the player to tap a house). Runs every frame until it
  // locks in — not just while the id is unset — so a stale/far memo from an
  // older save repairs itself. Cheap once locked (the _starterShopOk early-
  // out inside ensureStarterShopId).
  if (scene.ensureStarterShopId) scene.ensureStarterShopId();
  // Re-inject the synthetic starter trailer (if any) into its owning tile —
  // worldgen never emits it, so it must be re-added after reloads / eviction.
  if (scene.ensureStarterTrailerObject) scene.ensureStarterTrailerObject();
  // Is drawCells drawing the TILED building art this frame? Only that path
  // (the tier-12 rampart pass) reads the two occlusion stamps below —
  // _homeTrailerRect and _rampartOccludedCells — so in the polygonal mode
  // (the shipping default, see polyBuildings) neither is computed at all.
  const TILED = !polyBuildings();
  // Screen-space rect of the Home trailer's sprite — re-stamped each frame by
  // the house spec's `after` hook when the trailer is on-screen, null when it
  // isn't. drawCells reads it to sort castle front walls BEHIND the trailer
  // (see the tier-12 rampart pass).
  scene._homeTrailerRect = null;
  const halfM = (VIEW_CELLS / 2 + 1) * scene.cellM;
  // Extra cull reach for house sprites — half the widest building art that can
  // be drawn (BUILDING_ART.fort.max: a fort tops out at 3.48 cells wide, so 2.2
  // cells of roof either side of the centroid covers it with margin). Pinned by
  // test/node/house_scale.test.js.
  const HOUSE_PAD_M = 2.2 * scene.cellM;
  // Both the cull and the projection measure from the CAMERA ANCHOR (normally
  // the player; offset from them while a peek drag is live), so a sprite that
  // slides into view at the leading edge of a peek is kept and drawn where the
  // ground under it went. The tile-neighbourhood scan below stays on the
  // player's own tile — a peek is a few cells, a tile is hundreds.
  const _anchor = viewAnchorWorldM(scene);
  const pWorldX = _anchor.x;
  const pWorldY = _anchor.y;
  // Per-object screen projection: world-meter delta (dx, dy from the anchor)
  // → screen pixels. Every sprite/label/diamond in this pass shares the exact
  // same projection, so define it once here (viewCenterX/Y, cellM, CELL_PX are
  // all in scope for the whole function).
  const project = (dx, dy) => ({
    sx: scene.viewCenterX + (dx / scene.cellM) * CELL_PX,
    sy: scene.viewCenterY + (dy / scene.cellM) * CELL_PX,
  });
  const objList = [], creatureList = [], plantedList = [], trapList = [];
  // The frame's light sources (src/lighting.js). Filled by the tile scan
  // below as it passes each restored building, then by the campfire list and
  // the player inside Lighting.draw at the end of this pass. Reset here so a
  // light whose owner left the scan (a house re-wrecked, a tile evicted)
  // can't linger.
  const LIGHTS = (typeof Lighting !== 'undefined') ? Lighting : null;
  if (LIGHTS) LIGHTS.beginFrame(scene);
  // Depth band for non-sprite overlays that share the world layer (crop timer
  // badges, pet hearts). World sprites take depths 0..n from the z-order pass
  // below, so anything at Z_OVERLAY is guaranteed to sit above all of them.
  const Z_OVERLAY = 10000;
  const pickedSet = setOf(scene.save.picked);
  // Traps the player has already sprung — the one bit of trap state that is
  // stored at all (see src/traps.js), and all the renderer needs to pick
  // between the two textures.
  const sprungSet = setOf(scene.save.sprungTraps);
  // Deterministic chest dedupe by game cell. A chest's id is already cell-snapped
  // (`c_<roundedCellX>_<roundedCellY>`), so the same POI duplicated across adjacent
  // tiles — and any two chests that land in the same 5 m cell — collapse to a single
  // crate. The key is derived from world position, so *which* copy survives no longer
  // depends on tile-iteration or load order: that order-dependence is what made crates
  // blink in and out as you walked (worst in dense areas like Seattle where many
  // same-named/same-class POIs sit close together). We intentionally no longer collapse
  // distinct POIs that merely share a name within ~40 m — those are different crates and
  // now both stay visible.
  const seenCell = new Set();
  const cellKey = (o) => Math.floor(o.x / scene.cellM) + '_' + Math.floor(o.y / scene.cellM);
  const isDupChest = (o) => {
    const k = cellKey(o);
    if (seenCell.has(k)) return true;
    seenCell.add(k);
    return false;
  };
  // Iterate only the player's 3×3 tile neighbourhood instead of every entry
  // in WorldGen.tileCache. The cache grows unboundedly as the player walks —
  // a long-running session can hold 50+ visited tiles with ~50k objects each,
  // so iterating-all here was a per-frame O(visited-items) cost (this caused
  // the random hangs the user reported). 9 tiles strictly cover the 11-cell
  // viewport (a tile is `cellsPerTile` cells, far bigger than VIEW_CELLS).
  // Save.caught is rebuilt to a Set once per frame for O(1) lookups.
  const caughtSet = setOf(scene.save.caught);
  // Opened chests: dropped from the sprite list below AND never offered to the
  // lightmap — an emptied POI is no longer a place that glows.
  const openedSet = setOf(scene.save.opened);
  const pc = scene.playerToWorldCell();
  // Counted alongside the loop below, not derived after it: "how much does
  // this walk touch" is the number the case for a spatial index needs, and
  // counting inline costs one increment per item instead of a second pass.
  // _boot_scanned is every object/creature/wildplant iterated across the
  // 3×3 tiles; _boot_kept is how many survived culling into the draw lists.
  let _boot_scanned = 0, _boot_kept = 0;
  for (let dty = -1; dty <= 1; dty++) {
    for (let dtx = -1; dtx <= 1; dtx++) {
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx + dtx, pc.ty + dty));
      if (!entry) continue;   // tile not loaded yet
      if (entry.objects) {
        for (const o of entry.objects) {
          _boot_scanned++;
          const dx = o.x - pWorldX, dy = o.y - pWorldY;
          // Houses are culled with extra margin. Every other object's art is
          // about a cell wide, so its anchor leaving the viewport means its
          // art has left too — but a house is CENTRED on its footprint
          // centroid, and a grown fort's roof spans several cells (see
          // _houseScale), so an anchor a little past the rim can still have
          // half its building on screen. Without the pad, walking onto a big
          // fort's footprint made the whole building vanish and left bare
          // brick. HOUSE_PAD_M is half the widest art the fort cap allows.
          const lim = o.kind === 'house' ? halfM + HOUSE_PAD_M : halfM;
          // A restored building (or Home) is a LIGHT as well as a sprite, and
          // its light reaches further than its art: offered to the lightmap
          // before the sprite cull, with its own radius as the margin, so a
          // lantern a cell off-screen still lights the edge it stands past.
          if (LIGHTS && (o.kind === 'house' || o.kind === 'tower' || o.kind === 'torch')) LIGHTS.consider(scene, o, dx, dy, halfM);
          if (Math.abs(dx) > lim || Math.abs(dy) > lim) continue;
          if (o.kind === 'chest' && isDupChest(o)) continue;
          // A live POI is a light too — offered AFTER the dedup (a per-frame
          // first-seen-wins on the cell, so it must see the copies in the
          // order the sprite pass does) and inside the sprite cull, which its
          // small radius makes near enough: a cell off-screen it shows a hand's
          // width of glow at most.
          if (LIGHTS && o.kind === 'chest' && !o.crate && !openedSet.has(o.id)) LIGHTS.consider(scene, o, dx, dy, halfM);
          // Anchor outside the ordinary viewport: the SPRITE (and its shadow)
          // still draw, but the label passes skip it — a sign or open/busy
          // plaque for an off-screen building would be clamped to the screen
          // edge, pointing at nothing.
          const wide = Math.abs(dx) > halfM || Math.abs(dy) > halfM;
          objList.push({ o, dx, dy, wide });
          _boot_kept++;
        }
      }
      if (entry.creatures) {
        for (const c of entry.creatures) {
          _boot_scanned++;
          if (caughtSet.has(c.id)) continue;
          const dx = c.x - pWorldX, dy = c.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          creatureList.push({ c, dx, dy });
          _boot_kept++;
        }
      }
      // Wild plants render as planted crops at the mature stage (col 4).
      if (entry.wildplants) {
        for (const wp of entry.wildplants) {
          _boot_scanned++;
          if (pickedSet.has(wp.id)) continue;
          const dx = wp.x - pWorldX, dy = wp.y - pWorldY;
          // A mushroom is a (faint) light as well as a sprite — offered before
          // the cull like a building, with its own radius as the margin. The
          // wildplant goes as itself: Lighting.sourceKind reads its crop.
          if (LIGHTS && wp.crop === 'mushroom') LIGHTS.consider(scene, wp, dx, dy, halfM);
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          // _biome is the terrain the rasterizer stamped on the plant (the flora
          // tint below reads it); _ix/_iy only survive on the wildplants the
          // occupancy pass never saw (cave mushrooms, the sandbox scatter), so
          // the id is what the per-cell variant hash actually keys off.
          plantedList.push({ p: { x: wp.x, y: wp.y, crop: wp.crop, stage: MAX_GROWTH_STAGE, wildId: wp.id,
                                  _cave: wp._cave, _biome: wp._biome, _ix: wp._ix, _iy: wp._iy }, dx, dy });
          _boot_kept++;
        }
      }
      // Traps (src/traps.js) — flat marks on the ground, so they take the same
      // 3×3 scan and the same cull as everything else, and go to their own
      // pool below. A trap is never dropped from the list: the hidden one is
      // drawn too (that faint scuff is the whole affordance), just in the
      // subtle texture. Which of the two it wears is the ONLY thing the save
      // decides — sprungSet, built once per frame like pickedSet.
      if (entry.traps) {
        for (const tr of entry.traps) {
          _boot_scanned++;
          const dx = tr.x - pWorldX, dy = tr.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          trapList.push({ tr, dx, dy, sprung: sprungSet.has(tr.id) });
          _boot_kept++;
        }
      }
    }
  }
  // B.count keeps n/sum/worst like B.tick, just printed without 'ms' — the
  // peak answers "how bad does the densest tile get", the average answers
  // "what does a typical frame pay".
  window.__boot?.count?.('drawObjects scanned', _boot_scanned);
  window.__boot?.count?.('drawObjects kept', _boot_kept);
  // Planted crops are tagged with the depth they were sown at (surface = 0 for
  // legacy saves). Only draw the ones that belong to the level you're standing
  // on, so surface farms don't render underground (and future cave crops won't
  // render on the surface).
  const _curDepth = scene.depth ?? 0;
  for (const p of scene.save.planted) {
    if (!PlacedFloor.onDepth(p, _curDepth)) continue;   // same-level crops only
    const dx = p.x - pWorldX, dy = p.y - pWorldY;
    if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
    plantedList.push({ p, dx, dy });
  }
  // Placed rockfruit stones — overlay the produce icon on each cell in placedRockSet
  // so the player can see what's there. The cell terrain is already rendered as rock
  // (type 10) by drawCells; this adds the visual icon on top.
  if (scene.placedRockSet && PlacedFloor.isSurface(_curDepth)) {
    for (const key of scene.placedRockSet) {
      const [ixStr, iyStr] = key.split('_');
      const absIX = parseInt(ixStr, 10), absIY = parseInt(iyStr, 10);
      const { x, y } = absCellCenterMeters(scene, absIX, absIY);
      const dx = x - pWorldX, dy = y - pWorldY;
      if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
      plantedList.push({ p: { x, y, crop: 'rockfruit', _placedRock: true }, dx, dy });
    }
  }
  // Placed scarecrows render as world objects — 3-cell-tall single image,
  // anchored at the base so it appears to stand on the cell. Pool reuses
  // objectPool slots so it integrates with depth-sort and viewport clip.
  const scarecrowList = PlacedFloor.forDepth(scene.save.scarecrows, _curDepth).map(sc => ({
    o: { kind: '_scarecrow', x: sc.x, y: sc.y, id: `scarecrow_${sc.x.toFixed(2)}_${sc.y.toFixed(2)}` },
    dx: sc.x - pWorldX, dy: sc.y - pWorldY,
  })).filter(item => Math.abs(item.dx) <= halfM && Math.abs(item.dy) <= halfM);
  // Placed campfires (burned from a coal) render like scarecrows — through the
  // shared object pool so they depth-sort and clip with everything else.
  const fireList = PlacedFloor.forDepth(scene.save.fires, _curDepth).map(fr => ({
    o: { kind: '_fire', x: fr.x, y: fr.y, id: `fire_${fr.x.toFixed(2)}_${fr.y.toFixed(2)}` },
    dx: fr.x - pWorldX, dy: fr.y - pWorldY,
  })).filter(item => Math.abs(item.dx) <= halfM && Math.abs(item.dy) <= halfM);

  // Filter out chopped trees and (already-)opened chests handled in inner loop above? Do it here.
  // Hide objects that are temporarily gone:
  //  - chopped trees
  //  - opened chests (the chest, its pad, label, and tier diamond all vanish
  //    until the chest refills — keyed by save.opened including o.id)
  // Trees flag o.chopped = true in-memory when the chop progress wheel completes
  // (cheap), AND now also persist into save.chopped so a tile re-rasterize
  // doesn't regrow them. Check both — save.chopped is the source of truth.
  const choppedSet = setOf(scene.save.chopped);
  const brokenRockSet = scene.brokenRockSet || new Set();
  // Lowtier chests (chestTier === 1) and starter supply crates render the
  // `box` sprite instead of the trunk chest.
  const _chestIsBox = (o) => {
    if (o.crate) return true;   // starter supply crates always use the box sprite
    const tier = (typeof chestTier === 'function') ? chestTier(o.poiClass, o.x, o.y, o.depth) : 2;
    return tier === 1;
  };
  // EVERY opened chest vanishes, crates included. A looted crate used to stay
  // put as an open-lid "already cracked this one" marker, but the empty-crate
  // sprite read as broken art wherever it sat, and an emptied crate is worth
  // less on the map than the clear cell it was standing on. Showing nothing is
  // also what a looted trunk chest has always done, so both tiers now behave
  // the same. (The tap target survives either way — interactables.js still
  // flashes "Picked clean already."; the pad + label persist via objList.)
  const filteredObj = objList.filter(({ o }) =>
    !(o.kind === 'chest' && openedSet.has(o.id)) &&
    !(o.kind === 'tree'  && (o.chopped || choppedSet.has(o.id))) &&
    // Mined-out mineralrocks vanish. Previously they hung around as a
    // dimmed sprite that flashed "spent" on tap — now they just clear,
    // matching how chopped trees and opened chests already disappear.
    // save.brokenRocks still tracks them so re-rasterizing the tile
    // (cache evict + walk back) doesn't respawn them.
    !(o.kind === 'mineralrock' && brokenRockSet.has(o.id)) &&
    // Ground stacks vanish once picked up. Same key (save.picked) as the
    // wildplant pickup tracking, so existing UIs / saves don't grow a new field.
    !(o.kind === 'groundstack' && pickedSet.has(o.id))
  );
  // Merge in placed scarecrows so they go through the same sprite pool +
  // depth sort as other world objects. Their RENDER_SPEC entry (kind
  // '_scarecrow') anchors the pole base on the placement cell.
  for (const sc of scarecrowList) filteredObj.push(sc);
  for (const fr of fireList) filteredObj.push(fr);
  filteredObj.sort((a, b) => a.dy - b.dy);
  // ── Screen-row z-order ──────────────────────────────────────────────────
  // Crops, world objects and creatures all live in ONE display layer
  // (scene.worldContainer — see app.js), so they can interleave: a sprite in a
  // LOWER screen cell row ALWAYS draws over one in a higher row, whatever kind
  // it is. A deer standing north of a house no longer floats in front of it,
  // and a crop in the front row no longer hides under the row behind it.
  // Inside a single cell row the previous hierarchy still decides: crops under
  // objects under creatures, and within one kind the old north-to-south (dy)
  // order. The stamped index becomes each sprite's Phaser depth; the container
  // is sorted by it at the end of this pass. Overlay badges in the same layer
  // (crop timers, pet hearts) sit at Z_OVERLAY, above every world sprite.
  const _cellRow = (dy) => Math.floor((pWorldY + dy) / scene.cellM);
  const zList = [];
  for (const it of plantedList)  zList.push({ it, rank: 0 });
  for (const it of filteredObj)  zList.push({ it, rank: 1 });
  for (const it of creatureList) zList.push({ it, rank: 2 });
  zList.sort((a, b) => (_cellRow(a.it.dy) - _cellRow(b.it.dy))
                    || (a.rank - b.rank)
                    || (a.it.dy - b.it.dy));
  for (let zi = 0; zi < zList.length; zi++) zList[zi].it._z = zi;
  // Absolute cells occupied by a world-layer sprite, for drawCells' castle-
  // rampart sorting (read next frame — drawCells runs first): a castle FRONT
  // (south) wall extrudes 8px down into its southern neighbour cell, and
  // rampartFrontGfx sits ABOVE the world sprites, so without this a tree /
  // chest / crop / animal standing in that cell — in FRONT of the wall — got
  // painted over by it. When the south cell hosts a sprite, drawCells drops
  // just that cell's front wall to the BACK layer so the sprite occludes it.
  // Keys are absolute "ix_iy" cells (coords.js basis), so the one-frame lag
  // can't misplace them the way screen rects would. Towers are excluded (they
  // stand ON the wall cell and live in towerContainer, above both rampart
  // layers) and houses are excluded (multi-cell centroid anchors don't map to
  // one cell — the Home trailer keeps its dedicated _homeTrailerRect path).
  // Tiled mode only: the polygonal path draws no rampart, so it never reads it.
  if (TILED) {
    const _rampOcc = new Set();
    for (const { it } of zList) {
      const kind = it.o && it.o.kind;
      if (kind === 'tower' || kind === 'house') continue;
      const c = worldMetersToAbsCell(scene, pWorldX + it.dx, pWorldY + it.dy);
      _rampOcc.add(c.cellIX + '_' + c.cellIY);
    }
    scene._rampartOccludedCells = _rampOcc;
  } else {
    scene._rampartOccludedCells = null;
  }
  // Per-kind render spec — `key` is the texture key (or fn(o) for variants),
  // `frame` (optional) picks a specific frame (literal | fn(o)), `origin`/`scale`
  // are passed straight to Phaser. Lookup-on-miss returns null and the sprite
  // hides — used for variants that haven't baked yet.
  // Coin-burst POIs (ATM + bicycle_parking): tapping them spills a burst of
  // collectible coins, so they render as a "pot of gold" instead of a chest.
  // A cave-level mirror of one (o.depth > 0, worldgen.js caveChestsFrom) is a
  // plain chest — the same gate interactables.js puts on the burst itself.
  const _isCoinBurst = (o) => (o.poiClass === 'atm' || o.poiClass === 'bicycle_parking') && !(o.depth > 0);
  // Which of the chest's three looks (produce stand / pot of gold / crate)
  // this object wears — resolved ONCE per object and cached on it, the same
  // way loot.js's produceStandFor caches its own answer in o._standCache.
  // Every input (poiClass, crate) is fixed at spawn and a rebuilt tile is a
  // new object, so the memo can't go stale; the chest spec below reads it
  // from seven fields per chest per frame.
  const _chestLook = (o) => o._chestLook
    || (o._chestLook = { stand: produceStandFor(o), coin: _isCoinBurst(o), box: _chestIsBox(o) });
  // Supply-crate / lowtier-chest sprite scale (the 16×16 `box` art).
  // 0.8 (down 20% from 1.0, Sep 2026 playtest) — 16 × 0.8 = ~13px inside the
  // 32px cell.
  const CRATE_SCALE = 0.8;
  // Pick the themed-sprite role for a 'house' object. 'plain' falls back
  // to the generic 'house' texture (the tinted shared sprite). Order
  // matters: starter wins over tier wins over shopType — so a tier-11
  // fort that happens to also be the starter shop renders as a trailer.
  //
  // 'wreck' is the universal pre-restoration role for tier-9 houses:
  // any non-restored, non-starter, non-fort house renders as the wreck
  // sprite. Once the player feeds it the right materials at
  // shopInteract, it goes into save.restoredHouses and reverts to its
  // "true" role (plain / blacksmith / etc.).
  const _restored = scene.save.restoredHouses || {};
  const _houseTrueRole = (o) => {
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) return 'trailer';
    if (o.tier === 11) return 'fort';
    // Frozen restore-order role: 'blacksmith' | 'trader' | 'market' | 'wizard',
    // or null → plain residential.
    const t = (typeof scene.houseShopRole === 'function') ? scene.houseShopRole(o) : null;
    return t || 'plain';
  };
  const _houseRole = (o) => {
    const trueRole = _houseTrueRole(o);
    // Forts (tier 11) and the starter trailer skip wreck status — forts
    // are civic structures, the trailer is the player's already-furnished
    // home. Everything else (plain residential + themed tier-9 shops) is
    // a wreck until restored.
    if (trueRole === 'fort' || trueRole === 'trailer') return trueRole;
    if (_restored[o.id]) return trueRole;
    return 'wreck';
  };
  // ── Tree size + fruit-tree growth helpers (shared by the specs below) ──
  // Four discrete in-game size tiers from the DeepForest crown size class —
  // the smallest ('bush') renders as a bush, the rest as trees. OSM trees carry
  // no size and draw their flat species scale; there is no continuous size in
  // between (see treeBaseScale in util.js for why the crown_m one went).
  // (Authoritative copy lives in util.js TREE_SIZE_MUL; treeScale() applies it.)
  // Fruit-tree life-cycle frames, in 32px-wide frame indices (sheets are sliced
  // 32×48 — see assets.js; each tree is a full 32px column, NOT 16). The Apple
  // and Peach sheets DON'T share a layout, so map each explicitly:
  //   apple (15 frames): 0 sprout, 2 young, 4 mature-green, 5 blossom.
  //   peach (13 frames): 0 sprout, 2 young, 3 mature-green, 4 blossom.
  // (Higher frames are seasonal / stump / white-matte cells — NOT live trees.)
  //
  // A BEARING tree keeps the mature frame and wears its fruit as a separate
  // sprite on the canopy (the fruit pass at the end of this function), so the
  // sheets' own fruiting cells — apple 7, peach 5 — are no longer drawn: a
  // pick removes a fruit rather than repainting the tree. That's why `grow`
  // ends on the mature frame it already passed through at stage 2: stage 3 is
  // blossom, and stage 4 is the same mature tree with fruit hung on it.
  const FRUIT_FRAMES = {
    apple: { grow: [0, 2, 4, 5, 4], mature: 4 },
    peach: { grow: [0, 2, 3, 4, 3], mature: 3 },
  };
  const _ftSpec = (o) => FRUIT_FRAMES[o.species === 'peach' ? 'peach' : 'apple'];
  const FRUIT_STAGE_MS = 24 * 60 * 60 * 1000;   // 1 day/stage → 4 days sprout→fruit
  const FRUIT_RESPAWN_MS = 24 * 60 * 60 * 1000;   // fruit yields once per 24h
  // Growth stage 0..4 of a planted sapling from elapsed real time.
  const _ftStage = (o) => Math.min(4,
    Math.floor((Date.now() - (o.planted_t || 0)) / FRUIT_STAGE_MS));
  const _ftPicked = (o) => {
    const fp = scene.save.fruitPicked;
    const at = fp && fp[o.id];
    return at && Date.now() - at < FRUIT_RESPAWN_MS;
  };
  // Is this tree carrying ripe fruit right now? Wild trees are mature from the
  // start; a planted sapling has to reach its fruiting stage first. Either way
  // a pick empties it until the fruit regrows. This is the ONE condition the
  // fruit overlay draws on (see the fruit pass) — the tree's own art doesn't
  // change either side of it.
  const _ftBearing = (o) => (!o.planted || _ftStage(o) >= 4) && !_ftPicked(o);
  // Gentle hue nudge: lighten the sampled crown colour halfway to white so the
  // multiplicative tint shifts the sprite's hue without darkening it to mud.
  const _crownTint = (hex) => {
    if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) return 0xffffff;
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return 0xffffff;
    r = (r + 255) >> 1; g = (g + 255) >> 1; b = (b + 255) >> 1;
    return (r << 16) | (g << 8) | b;
  };

  // Texture key + frame for a house, by role. Named (rather than inlined in
  // RENDER_SPEC) because the scale fit and the shadow pass both need to look
  // up the same art the sprite will actually draw.
  const _houseKey = (o) => {
    const role = _houseRole(o);
    if (role === 'plain')  return 'house';
    if (role === 'wizard') return 'shrine';   // wizard tower reuses wizard.png
    return `house_${role}`;
  };
  // Plain houses pick the 'front' sub-rect of the house tileset; wizard towers
  // pick the fully-restored top-row tower frame (frame 3) of the wizard sheet;
  // other themed PNGs are single-image (frame undefined).
  const _houseFrame = (o) => {
    const role = _houseRole(o);
    if (role === 'plain')  return 'front';
    if (role === 'wizard') return 3;
    return undefined;
  };
  // Every building is sized by ONE rule (BUILDING_ART / houseArtScale in
  // util.js): draw at your own footprint, clamped to a range stated in DRAWN
  // CELLS. All render.js does is read the art's real frame width and hand it
  // over — the width is what turns a cell count into a sprite scale, and it is
  // why a role's size is stated in cells rather than in scale (see the note on
  // the table). Frames that can't be measured come back as 0, which the rule
  // answers with 1; the sprite is already hidden by then.
  const _houseFrameW = (o) => {
    if (!scene.textures || !scene.textures.exists(_houseKey(o))) return 0;
    const fr = scene.textures.get(_houseKey(o)).get(_houseFrame(o));
    return (fr && fr.width) || 0;
  };
  const _houseBaseScale = (o) =>
    buildingBaseScale(_houseFrameW(o), _houseRole(o) === 'fort', CELL_PX);
  const _houseScale = (o) =>
    houseArtScale(o.area, _houseFrameW(o), _houseRole(o) === 'fort',
                  scene.cellM, CELL_PX);

  // Height in px from the house's ground point (sy) up to the MIDLINE of its
  // drawn art — where a tag hung ON the building's face sits. Mirrors the
  // placement the sprite pass uses: every role but the wizard is centred on sy
  // (origin y 0.5, no nudge), so its midline IS sy; the wizard tower is
  // foot-anchored half a cell lower and reaches its full scaled height up from
  // there, so its midline is half that height above the foot.
  // The open/busy plaque used to clear the TOP of the art by 3px instead. On
  // the plain house the frame's top rows are the tip of a steep gable (6px
  // wide at row 0 of 72), so "just above the roof" was a tag floating over a
  // peak, a full storey off the shopfront — and every role read as too high.
  // A sign belongs on the building, not over it.
  const _houseMidPx = (o) => {
    if (_houseRole(o) !== 'wizard') return 0;
    if (!scene.textures || !scene.textures.exists(_houseKey(o))) return 0;
    const fr = scene.textures.get(_houseKey(o)).get(_houseFrame(o));
    if (!fr || !fr.height) return 0;
    return (fr.height * _houseScale(o)) * 0.5 - CELL_PX * 0.5;
  };

  // Ripe fruit waiting to be drawn ON its tree — filled by the fruittree
  // `after` hook as each tree is configured, drained by the fruit pass after
  // the object pool has rendered. Rebuilt every frame, like everything else
  // in this pass.
  const fruitList = [];

  const RENDER_SPEC = {
    // Houses pick their texture by role — the generic 'house' frame stays
    // as the fallback for plain residential. Themed sprites (sliced top-
    // left from NPC house sheets, see Objects/Houses/):
    //   - starter shop  → trailer    (the player's home/RV)
    //   - blacksmith    → blacksmith (forge with chimney + sign)
    //   - trader        → trader     (Fishman-style awning house)
    //   - fort tier 11  → fort       (the school — big civic stone building)
    // The 'house' texture is a tileset with a registered 'front' sub-frame;
    // the themed PNGs are single-image, so frame must be undefined for them.
    // Tint is suppressed for themed houses (the sprite is already distinct)
    // in the post-config block further down — see the `themedHouse` flag.
    house:  {
      key: _houseKey,
      frame: _houseFrame,
      // Centre the sprite ON the building footprint's centroid (the house x/y
      // IS that centroid). A bottom-middle anchor used to seat the base at the
      // centroid and draw the whole body NORTH of it, which on any multi-cell
      // footprint left the southern cells bare and pushed the roof off the top
      // edge — the house read as shoved up, not centred on its tiles. A centred
      // anchor (origin 0.5,0.5 + no nudge) keeps the art over its footprint.
      // The wizard tower is the exception: it's a tall sprite that must
      // stand foot-seated at the cell's front edge, so it keeps the bottom
      // anchor + a downward nudge.
      origin: (o) => (_houseRole(o) === 'wizard' ? [0.5, 1.0] : [0.5, 0.5]),
      dyPx: (o) => (_houseRole(o) === 'wizard' ? CELL_PX * 0.5 : 0),
      scale: _houseScale,
      // Stamp the Home trailer's display rect for drawCells' castle-rampart
      // sorting: a front (south) wall the trailer is parked in front of must
      // not paint over it. Runs after position/origin/scale are final. Tiled
      // mode only — the polygonal path has no rampart pass to read it.
      after: (s, o) => {
        if (!TILED || _houseRole(o) !== 'trailer') return;
        const w = s.displayWidth, h = s.displayHeight;
        scene._homeTrailerRect = {
          x0: s.x - w * s.originX, x1: s.x + w * (1 - s.originX),
          y0: s.y - h * s.originY, y1: s.y + h * (1 - s.originY),
        };
      } },
    // Turret placement, exactly: the art is anchored by its frame's
    // bottom-centre (origin 0.5, 1.0) and dropped half a cell from the cell
    // CENTRE that sy gives us, so its grounding line lands ON the cell's
    // bottom edge — not the ~2px short of it the old 0.95 origin left. The
    // texture carries no bottom padding (see makeTowerTexture) so frame bottom
    // IS art bottom, and its art is symmetric about the frame's centre column,
    // so origin x 0.5 centres it on the cell. Towers draw in their own layer
    // above BOTH rampart layers (app.js towerContainer), so the turret always
    // reads as standing on top of the wall, never behind it.
    // A turret has TWO baked textures, not one texture and a tint: an unclaimed
    // castle's masonry is generated in the shaded palette (textures.js), and a
    // tower that took a multiply tint instead never quite landed on the wall
    // colour beneath it. Falls back to the lit key if the second bake is
    // missing, so a stale texture cache can't blank the turret.
    tower:  { key: (o, sc) => (sc && sc.isClaimedKey && !sc.isClaimedKey(o.castle)
                               && sc.textures.exists('tower_unclaimed'))
                              ? 'tower_unclaimed' : 'tower',
              origin: [0.5, 1.0], scale: 1.0, dyPx: CELL_PX * 0.5 },
    // Placed scarecrow — 48×48 image, centred in its cell (origin 0.5,0.5, no
    // foot nudge). The trimmed art is 43×39 (the PNG bakes a 39%-alpha shadow
    // ellipse under the feet; the figure itself is fully opaque), so scale 0.6
    // puts it at ~26×23px — about 0.73 of the 32px cell. Raised from 0.455
    // (~18px) which read too small; still fits inside its single cell (QC rule).
    _scarecrow: { key: 'scarecrow', origin: [0.5, 0.5], scale: 0.6, seat: true },
    // Cave staircase — Props Mine ladder art (32×32 each). 'down': ladder into
    // dark pit; 'up': bare standalone ladder. Texture picked by direction.
    staircase: { key: (o) => (o.dir === 'up' ? 'stair_up' : 'stair_down'),
                 origin: [0.5, 0.5], scale: 1.0 },
    // Placed campfire — 16×32 art, foot-anchored near the logs so the flame
    // rises up out of the cell (like a small tree). The 6-frame sheet is cycled
    // by `frame` each render (~130 ms/frame) for a continuous flicker. scale 1.1
    // → ~18px wide, comfortably inside one 32px cell (QC: one-cell interactable).
    // Seat off the logs (seatFrame 0) so the flickering flame doesn't bob the
    // sprite vertically frame-to-frame; the flame still rises out the top.
    _fire: { key: 'bonfire',
             frame: () => Math.floor(performance.now() / 130) % 6,
             origin: [0.5, 0.82], scale: 1.1, seat: true, seatFrame: 0 },
    // Cave torch — 16×32 like the campfire, same scale, same flicker cadence
    // (the 4 frames differ only in the flame, so seat off frame 0 and the
    // stake never bobs). Its light is Lighting.KINDS.torch — offered to the
    // lightmap in the object scan above the sprite cull.
    torch: { key: 'torch',
             frame: (o) => (Math.floor(performance.now() / 130) + ((o.x | 0) & 3)) % 4,
             origin: [0.5, 0.82], scale: 1.1, seat: true, seatFrame: 0 },
    // Per-polygon species — maple uses the original 32×48 sheet with the
    // variant->frame growth-stage pick. Pine/birch/mahogany use their own
    // sheets sliced 32×48 (see assets.js) so the WHOLE tree — canopy + trunk
    // + root base — fits in one frame and nothing from the sheet's lower band
    // leaks in under it. Column 3 is a full mature green tree on every
    // species sheet. Origin is only the no-SpriteLayout fallback: the seat
    // pass places the art from its trimmed bounds.
    tree:   { key: (o) => {
                // Smallest crown tier renders as a bush, not a tree.
                if (treeSizeClass(o) === 'bush') return 'bushes';
                if (o.species === 'pine')     return 'pine_tree';
                if (o.species === 'birch')    return 'birch_tree';
                if (o.species === 'mahogany') return 'mahogany_tree';
                return 'trees'; // maple (default)
              },
              frame: (o) => {
                // bushes.png frame 0 is the lush top-left green bush.
                if (treeSizeClass(o) === 'bush') return 0;
                if (o.species && o.species !== 'maple') return 3;
                // Maple sheet: frames 0 and 4 are STUMPS (cut/dead); only
                // 1=sprout, 2=young, 3=mature are live trees. Clamp to 1..3 so a
                // standing tree never renders as a stump. Detected trees carry a
                // real size class → always mature (frame 3); their variety comes
                // from the size-class scale, not the growth-stage frame.
                // treeGrowthStage (util.js) does the clamping, and treeSizeClass
                // reads the SAME stage back for a size-less maple's axe tier —
                // one function, so a sprout can't draw tiny and gate like a
                // mature canopy.
                if (o.size) return 3;
                return treeGrowthStage(o);
              },
              origin: (o) => {
                if (treeSizeClass(o) === 'bush') return [0.5, 0.9];
                return (o.species && o.species !== 'maple') ? [0.5, 0.92] : [0.5, 0.95];
              },
              // Shared with the harvest gating in interact.js (util.treeScale)
              // so a tree's visual size and the axe tier it demands stay in
              // lockstep — bigger sprite, sturdier axe, more wood. treeScale
              // honours the discrete o.size crown class too. (One deliberate
              // exception: maples render 10% smaller via MAPLE_VISUAL_MUL while
              // their size class keys off the un-shrunk treeBaseScale, so the
              // visual shrink doesn't change a maple's axe tier or wood yield.)
              // Bushes use the 48×32 bushes sheet at a FIXED scale, independent
              // of the species/canopy tree scale. A bush is one species at one
              // size — so a bush-tier tree must render the SAME size as a `shrub`
              // wildplant (the bushes a park scatters), not a smaller half-size
              // variant. Both pull from CROP_SPRITE.shrub.scale so they can't
              // drift apart. Larger tiers use treeScale.
              scale:  (o) => treeSizeClass(o) === 'bush'
                ? CROP_SPRITE.shrub.scale : treeScale(o),
              // Placement obeys the "one cell" rule via the seat pass (see the
              // render loop + src/sprite_layout.js): each tree is seated from
              // its trimmed art bounds so the trunk base sits 1px above the
              // cell's bottom edge (or centred when it fits) and the canopy
              // rises into the tiles above without spilling into the cell
              // below — automatically across species sheets (maple 32×48 vs
              // the 32×48 pine/birch/mahogany root padding) and size classes.
              seat: true,
              // Sampled crown colour → a subtle hue tint (DeepForest trees only).
              // Bushes are one uniform type — skip the per-tree crown tint so
              // every bush renders as the same plain green sprite (an odd
              // sampled colour otherwise made some bushes look broken).
              after: (s, o, scene) => {
                if (o.crown_color && treeSizeClass(o) !== 'bush') s.setTint(_crownTint(o.crown_color));
                // Out of reach of the current axe → half alpha (interactables.js
                // toolGatedAlpha reads the same gate the tap refuses on).
                s.setAlpha(toolGatedAlpha(o, scene.save));
              } },
    chest:  { key: (o) => { const L = _chestLook(o);
                            return L.coin ? 'potofgold'
                                 : (L.stand ? 'market_stand'
                                 // Opened chests never reach the renderer (they're
                                 // filtered out above), so there is no "looted" sprite
                                 // to pick — a crate is either closed or gone.
                                 : (L.box ? 'box' : 'chest')); },
              // box is a single-frame image; trunk.png is 2-frame.
              // Crates and coin-burst pots leave `frame` at 0.
              // Coin-burst POIs (ATM + bicycle_parking) render the procedural
              // 'potofgold' canvas texture (textures.js makePotOfGoldTexture),
              // which is single-frame — so leave `frame` undefined for them,
              // exactly like the themed-house sprites. The pot art is already
              // gold, so no tint is applied. Produce stands pick the market_stand
              // awning frame for their product family (see produceStandFor).
              frame: (o) => { const L = _chestLook(o);
                              return L.coin ? undefined : (L.stand ? L.stand.frame : 0); },
              // Stand: 80×80 stall art, foot-anchored like a small house so its
              // body rises north over the POI cell.
              origin: (o) => { const L = _chestLook(o);
                               return L.stand ? [0.5, 1.0] : (L.coin ? [0.5, 0.95] : [0.5, 0.9]); },
              // Every chest kind and the market stall were drawn 10% smaller
              // than they used to be (per playtest — they crowded their cell),
              // about the SAME centre: the seated kinds (trunk chest, crates)
              // are re-centred automatically by the seat pass, and the stall's
              // dxPx/dyPx below are re-derived for the new scale so its art
              // centre doesn't move. The actual CHESTS (trunk + crate) then
              // came down a further 20% (Sep 2026): crates (box, 16×16) sit at
              // CRATE_SCALE — 16 × 0.8 = ~13px inside the 32px cell, so a crate
              // reads as a small prop rather than filling its cell; trunk is
              // 32×32 so 0.72 is 72% of a cell. The stall and the pot of gold
              // are structures, not chests, and kept their scale.
              scale: (o) => { const L = _chestLook(o);
                              return L.stand ? 0.54 : (L.coin ? 1.4 : (L.box ? CRATE_SCALE : 0.72)); },
              // Produce stands are foot-anchored (not seated), so origin 0.5
              // centres the FRAME box — but market_stand.png's art is shifted
              // right (every frame's opaque pixels are x:[12,80] in the 80px
              // frame, i.e. 12px transparent padding on the left, 0 on the
              // right). -3.24 (= 6px frame offset × 0.54 scale) centres the
              // art; +3 on top of that per playtest so the stall reads centred
              // over its POI cell in situ. Both terms are re-derived whenever
              // the scale changes so shrinking the stall leaves its art centre
              // exactly where it was.
              dxPx: (o) => { const L = _chestLook(o); return L.stand ? -0.24 : (L.coin ? 4 : 0); },
              // The crate is foot-anchored (origin y 0.9) but must sit CENTRED in
              // its cell, so the anchor is pushed down by the distance from the
              // art's middle to that anchor: (0.9-0.5)·16·scale. This is only the
              // fallback — the seat pass below recomputes it from the trimmed art
              // bounds whenever they're tabulated (src/sprite_layout.js).
              // Stand: every market_stand frame has 10 transparent rows under
              // the art (y:[0,70) of 80), so the old +2 left the stall's feet
              // floating ~4px ABOVE the cell centre ("the food stand is about
              // 20px too high"). +22 seated the feet on the cell's bottom edge
              // at scale 0.6; at 0.54 the same art centre sits at 19.3
              // (= 45px art-centre-above-anchor × 0.54 - 5), which keeps the
              // stall exactly where it was, just 10% smaller.
              dyPx: (o) => { const L = _chestLook(o);
                             return L.stand ? 19.3 : (L.coin ? 8 : (L.box ? 0.4 * 16 * CRATE_SCALE : 0)); },
              // Plain chests + crates obey the "one cell" rule (centred); produce
              // stands and the pot-of-gold are structure-like and stay foot-anchored.
              seat: (o) => { const L = _chestLook(o); return !L.stand && !L.coin; } },
    fruittree: { key: (o) => `${o.species === 'peach' ? 'peach' : 'apple'}_tree`,
              frame: (o) => {
                const fr = _ftSpec(o);
                // A planted sapling still walks the sheet's life-cycle frames
                // as it grows; a wild (detected/orchard) tree is mature from
                // the start. Whether either is BEARING doesn't touch the frame
                // — the fruit is its own sprite (the fruit pass below), so the
                // tree's art is the same before and after a pick.
                return o.planted ? fr.grow[_ftStage(o)] : fr.mature;
              },
              origin: [0.5, 0.95],
              scale: (o) => {
                const base = 0.85;
                // Planted saplings start clearly visible (0.7) and grow to the
                // mature wild-tree size (1.0×base) over their 4 stages — a small
                // sprout was easy to lose against the ground, now that growth
                // spans days rather than minutes.
                if (o.planted) return base * (0.7 + 0.075 * _ftStage(o));  // 0.7→1.0
                // Wild fruit trees always render at full (mature) size — their
                // o.size crown class no longer shrinks them.
                return base;
              },
              // Fruit trees stand 10% taller than their width — stretch Y only.
              // The seat pass measures the stretched art so the trunk base
              // still lands 1px above the cell edge.
              scaleYMul: 1.10,
              // Placement obeys the "one cell" rule (seat pass, src/sprite_layout.js).
              seat: true,
              after: (s, o, scene) => {
                // Hand the fruit pass everything it needs to hang this tree's
                // fruit on it, measured off the sprite as it was just drawn:
                // position, origin and scale are all final by now, so the
                // fruit lands on the crown of the art actually on screen.
                // (A picked tree simply contributes nothing — its fruit is
                // gone, and nothing about the tree itself dimmed or changed.)
                if (!_ftBearing(o)) return;
                const src = inventoryIconSource(o.species);
                if (!src || !scene.textures.exists(src.sheet)) return;
                const SL = (typeof window !== 'undefined' && window.SpriteLayout) || null;
                const off = SL && SL.fruitCrownOffset
                  ? SL.fruitCrownOffset(s.texture.key, s.frame.name,
                                        s.originX, s.originY, s.scaleX, s.scaleY)
                  : null;
                if (!off) return;
                fruitList.push({
                  key: src.sheet, frame: src.frame ?? 0,
                  x: s.x + off.dxPx, y: s.y + off.dyPx,
                  // The fruit is drawn at the TREE's scale, so it stays in the
                  // same pixel scale as the art it hangs on however big that
                  // tree is drawn. (scaleX, not scaleY — the tree's 1.10 Y
                  // stretch is a tree thing; a stretched apple is an egg.)
                  scale: s.scaleX,
                  // Painter rule: immediately above its OWN tree, and still
                  // under anything in a lower screen row (see the z-order
                  // pass — world depths are the integers 0..n).
                  depth: s.depth + 0.5,
                });
              } },
    mineralrock: { key: 'mineralrock',
              // Sheet: 11 cols × 17 rows = 187 frames. We restrict ourselves
              // to the SMALL rock variants only — other rows have boulder-
              // sized art that visibly bleeds past the 16 × 16 frame at
              // rock scale. Two safe pickranges:
              //   PLAIN → row 15, cols 3..6 (the four "nice vanilla" rocks
              //           the user identified; 4 vars). Used by cave rock AND
              //           T1 ore — T1 shows no visible ore, it's just plain
              //           rock that happens to yield a little copper. The
              //           variant is NOT free cosmetics: col 3 draws a PAIR of
              //           stones and pays out one more rock for it, so the
              //           frame comes from SpriteLayout.PLAIN_ROCK_VARIANTS —
              //           the same table interactables.js rolls the yield off.
              //   ORE   → row 0, the ore-stone per yield tier. The top row is
              //           ore stones in tier order starting at copper — copper
              //           col 0 (T2), iron 1 (T3), gold 2 (T4), platinum 3
              //           (T5), col 4 unused, crimson 5 (T6), frost 6 (T7) —
              //           so the rock you see matches the bar it drops.
              frame: (o) => {
                const tier = o.yieldTier || o.requiredTier || 1;
                // Cave rock and T1 ore both render as a plain rock variant.
                if (o.caveVariant != null || tier <= 1) {
                  return SpriteLayout.plainRockFrame(o);   // row 15, cols 3..6
                }
                // T2-T7 → ore-stone column. Index by yieldTier; col 4 is
                // skipped in the art (copper 0, iron 1, gold 2, platinum 3,
                // crimson 5, frost 6).
                const ORE_COL_BY_TIER = [0, 0, 0, 1, 2, 3, 5, 6];
                return ORE_COL_BY_TIER[tier] ?? 0;   // row 0, so frame === col
              },
              // Origin (0.5, 0.5) — centre the sprite in its cell. The
              // previous (0.5, 0.9) foot-anchor was meant for standing
              // creatures; on a flat ground-resting rock it shoved the
              // 26-display-px sprite ~11 px into the cell ABOVE, so rocks
              // read as off-centre by almost a whole cell.
              // Seat per the "one cell" rule — centres the small rock art in
              // its cell (the art sits low in the 16px frame). origin/dyPx
              // below are the no-SpriteLayout fallback. scale 1.28 (down 20%
              // from 1.6, Sep 2026 playtest) draws the 16px frame at ~20px.
              origin: [0.5, 0.5], scale: 1.28, seat: true,
              // Ore the current pick can't mine → half alpha; plain rock is
              // ungated and always full (interactables.js toolGatedAlpha).
              after: (s, o, scene) => { s.setAlpha(toolGatedAlpha(o, scene.save)); } },
    // Stone pillar — decorative stand-in for OSM utility poles / posts.
    // Purely decorative: no interact.js branch matches 'pole', so taps fall
    // through.
    // pillar.png is authored at 16px-per-cell (a 16×32 frame = 1 cell wide × 2
    // tall in its native grid), but the game renders at 32px-per-cell (CELL_PX),
    // like every other object sheet (trees are 32×48, etc.). At scale 1.0 the
    // pole therefore drew at HALF size — a thin half-cell-wide stub — which read
    // as "only half the sprite rendered". scale 2.0 maps the 16px art onto the
    // 32px cell so it stands a full cell wide and ~2 cells tall (a proper pole);
    // the seat pass then seats the now-taller-than-a-cell sprite with its base
    // 1px above the cell's bottom edge (same as a tree).
    // pillar.png's column art is symmetric and frame-centred (the earlier
    // slice was cut off on the top and left; the art was redrawn complete),
    // so a plain frame-centred origin works — the seat pass refines the
    // final offsets from the trimmed bounds.
    pole:   { key: 'pillar', origin: [0.5, 0.95], scale: 2.0, seat: true },
    // Stone well — decorative landmark for OSM amenity=fountain points. Tap
    // refills the watering can (interact.js). scale 0.9 draws the 30px frame at
    // ~27px, inside its one cell (QC rule); the seat pass centres it there off
    // the art's real bounds, which is what the well's off-centre content
    // (x:[2..30) of a 30-wide frame) needs and what an origin cannot give it.
    // frame 0 is the well without the hoist arm (assets.js slices the sheet at
    // 30px); it is set explicitly because pool sprites are shared with
    // multi-frame sheets and would otherwise keep a stale frame index.
    well:   { key: 'well', frame: 0, origin: [0.5, 0.5], scale: 0.9, seat: true },
    // Ground stack — an item id + qty sitting on the map. Texture +
    // frame come from inventoryIconSource(itemId) so any item with an
    // inventory icon can sit on the ground without per-kind plumbing.
    // For wood (the 4-frame stack sheet) we override the frame to
    // visualise stack size: frame = clamp(qty - 1, 0, 3).
    groundstack: {
      key: (o) => (inventoryIconSource(o.itemId) || {}).sheet || 'wood',
      frame: (o) => {
        // Wood sheet is 3 frames (brown / grey / amber log variants); the
        // frame cycles with qty so the sprite changes as the stack grows.
        if (o.itemId === 'wood') return Math.min(2, Math.max(0, (o.qty || 1) - 1));
        return (inventoryIconSource(o.itemId) || {}).frame ?? 0;
      },
      // Centred in the cell (origin y 0.5), NOT foot-anchored. At 0.9 the
      // anchor sat at the cell centre with the art hanging above it, so a
      // dropped stack rendered ~12px high — better than a third of a cell up,
      // visibly spilling into the row behind. Ground stacks are flat props
      // lying ON the tile, so they centre like the wildplants do.
      //
      // Frame-box centring rather than the seat pass: this sprite's texture
      // and frame follow whatever item was dropped (inventoryIconSource), so
      // there's no fixed frame to tabulate in ART_BOUNDS. The art of the
      // sheets it actually uses is centred in its frame anyway — wood.png's
      // logs sit at y[1,14) of 16 once the near-white background is keyed out
      // (see its onLoad in assets.js), i.e. half a pixel off centre.
      origin: [0.5, 0.5], scale: 1.8,
    },
  };
  // Kinds that stand UP off the ground and therefore cast a contact shadow.
  // Buildings (house/tower) get the bespoke footprint math below; everything
  // listed here is a seated sprite (see the "one cell" rule) so its shadow is
  // derived from the same trimmed art bounds the seat pass uses — the shadow
  // then tracks the real art, not the frame box's transparent padding.
  // Deliberately excluded: `groundstack` (a pile already lying on the ground)
  // and `staircase` (a hole cut INTO the ground — a shadow under it reads as
  // a floating slab).
  const SEATED_SHADOW_KINDS = new Set([
    'tree', 'fruittree', 'chest', 'mineralrock', 'well', 'pole', '_scarecrow', '_fire',
    'torch',
  ]);
  // Ground geometry for a seated sprite: where its art actually meets the
  // cell, and how wide that contact is. Returns null — i.e. no shadow — when
  // the sprite isn't seated after all (a `chest` that resolved to a produce
  // stand or a pot of gold) or when its frame has no ART_BOUNDS entry. Better
  // no shadow than one placed by guesswork.
  const _seatedFoot = (o) => {
    const spec = RENDER_SPEC[o.kind];
    const SL = (typeof window !== 'undefined' && window.SpriteLayout) || null;
    if (!spec || !SL) return null;
    const wantSeat = typeof spec.seat === 'function' ? spec.seat(o) : spec.seat;
    if (!wantSeat) return null;
    const texKey = typeof spec.key === 'function' ? spec.key(o, scene) : spec.key;
    if (texKey == null || !scene.textures.exists(texKey)) return null;
    const frameVal = spec.frame === undefined ? 0
                   : (typeof spec.frame === 'function' ? spec.frame(o) : spec.frame);
    const bframe = spec.seatFrame !== undefined ? spec.seatFrame : (frameVal ?? 0);
    const bb = SL.ART_BOUNDS[`${texKey}:${bframe}`];
    if (!bb) return null;
    const scl = typeof spec.scale === 'function' ? spec.scale(o) : spec.scale;
    const scaleYMul = typeof spec.scaleYMul === 'function' ? spec.scaleYMul(o) : (spec.scaleYMul || 1);
    const artW = (bb.maxX - bb.minX) * scl;
    const artH = (bb.maxY - bb.minY) * scl * scaleYMul;
    // seatInCell centres art that fits and bottom-seats art that doesn't, so
    // the art's bottom edge relative to the cell centre is one of two values.
    const footFromCentre = artH <= CELL_PX ? artH / 2 : CELL_PX / 2 - 1;
    return { w: artW, footFromCentre };
  };
  // Soft contact shadows under everything that stands up off the ground —
  // buildings, trees, rocks, chests, wells, poles. Rendered into
  // shadowContainer — z-ordered just below objectsContainer — so each sprite
  // reads as resting on the ground rather than floating. The shadow is a
  // feathered dark ellipse placed at the sprite's ground foot, sized to what
  // actually touches the cell (forts widest, saplings slimmest).
  if (scene.shadowPool && scene.shadowContainer) {
    // _seatedFoot is measured once per object per frame here and carried on
    // the list entry — the configure callback below runs on the same entries,
    // so measuring again there would just repeat the work every frame.
    const shadowList = [];
    for (const item of filteredObj) {
      const k = item.o.kind;
      if (k === 'house' || k === 'tower') { shadowList.push(item); continue; }
      if (!SEATED_SHADOW_KINDS.has(k)) continue;
      const foot = _seatedFoot(item.o);
      if (foot) shadowList.push({ ...item, _foot: foot });
    }
    Render.renderPool(scene, scene.shadowPool, scene.shadowContainer, shadowList, (s, item) => {
      const { o, dx, dy } = item;
      const { sx, sy } = project(dx, dy);
      setTextureIfDifferent(s, 'bldg_shadow');
      // Non-building path: an ellipse centred on the art's base, so its top
      // half tucks behind the sprite and its bottom half spills onto the cell.
      // Only that bottom half is ever seen, and 'bldg_shadow' feathers toward
      // its rim, so the numbers are tuned for what SHOWS: a shadow narrower
      // than the art (0.9) but dense enough (0.45) to read against a dark
      // forest floor, without turning a copse into a grid of blobs.
      if (item._foot) {
        const foot = item._foot;
        const w = Math.max(8, foot.w * 0.9);
        s.setOrigin(0.5, 0.5)
         .setDisplaySize(w, w * 0.42)
         .setPosition(Math.round(sx), Math.round(sy + foot.footFromCentre))
         .setAlpha(0.45).setTint(0xffffff);
        return;
      }
      // The shadow ellipse is CENTRE-anchored (origin 0.5,0.5) and is placed at
      // the building's visual BASE so a thin contact crescent grounds it. The
      // base depends on how the sprite is anchored (see RENDER_SPEC):
      //   • tower / wizard house — foot-anchored, base ≈ the centroid cell.
      //   • every other house     — CENTRED on the centroid, so its base sits
      //     half the (scaled) sprite height SOUTH of the centroid. Read the
      //     sprite's frame height so the shadow tracks the real art, not a guess.
      // The small extra lift tucks the ellipse's bulk behind the building.
      const role = o.kind === 'house' ? _houseRole(o) : null;
      let w = CELL_PX * 1.5, footY = sy - 4;
      if (o.kind === 'tower') { w = CELL_PX * 1.1; footY = sy + 2; }
      else if (role === 'wizard') { footY = sy + CELL_PX * 0.5 - 4; }
      else if (o.kind === 'house') {
        if (role === 'fort') w = CELL_PX * 2.4;
        // Same art + scale the sprite pass will use, so a house shrunk to fit a
        // small footprint gets a shadow that shrinks with it — in width as well
        // as position, or a shrunk house would sit on an oversized ellipse.
        const hkey = _houseKey(o);
        const hscale = _houseScale(o);
        w *= hscale / _houseBaseScale(o);
        let fh = CELL_PX;
        if (scene.textures.exists(hkey)) {
          const fr = scene.textures.get(hkey).get(_houseFrame(o));
          if (fr && fr.height) fh = fr.height;
        }
        footY = sy + 0.5 * fh * hscale - 6;   // centred-house base, tucked up 6px
      }
      s.setOrigin(0.5, 0.5)
       .setDisplaySize(w, w * 0.42)
       .setPosition(Math.round(sx), Math.round(footY))
       .setAlpha(0.5).setTint(0xffffff);
    });
  }
  // One configure routine, two pools: turrets render into towerContainer
  // (added above BOTH rampart layers in app.js) so a tower always reads as
  // standing above the wall it's built on — including the south wall, which
  // draws above every other object and used to paint over the turret in front
  // of it. Everything else keeps objectsContainer and its existing sorting.
  const configureObject = (s, item) => {
    const { o, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    s.setDepth(item._z ?? 0);          // screen-row z-order (see the z-order pass)
    const spec = RENDER_SPEC[o.kind];
    if (!spec) return;
    const texKey = typeof spec.key === 'function' ? spec.key(o, scene) : spec.key;
    if (texKey == null || !scene.textures.exists(texKey)) { s.setVisible(false); return; }
    setTextureIfDifferent(s, texKey);
    let frameVal;
    if (spec.frame !== undefined) {
      frameVal = typeof spec.frame === 'function' ? spec.frame(o) : spec.frame;
      if (s.frame.name !== frameVal) s.setFrame(frameVal);
    }
    const tint = Render.spriteTint(o, scene);
    const scl = typeof spec.scale === 'function' ? spec.scale(o) : spec.scale;
    const origin = typeof spec.origin === 'function' ? spec.origin(o) : spec.origin;
    const scaleYMul = typeof spec.scaleYMul === 'function' ? spec.scaleYMul(o) : (spec.scaleYMul || 1);
    let dyPx = typeof spec.dyPx === 'function' ? spec.dyPx(o) : (spec.dyPx || 0);
    let dxPx = typeof spec.dxPx === 'function' ? spec.dxPx(o) : (spec.dxPx || 0);
    // "One cell" placement rule (single source of truth: src/sprite_layout.js).
    // Non-building world sprites are seated from their trimmed art bounds so
    // they sit centred in their cell — or, when taller than a cell, with the
    // bottom 1px above the cell's bottom edge — and never spill into the cell
    // below; horizontally always centred. seatFrame pins the bounds lookup to
    // a stable frame for animated sheets (e.g. the flickering bonfire) so the
    // art doesn't bob frame-to-frame.
    //
    // A seated spec therefore CANNOT carry a placement of its own. dxPx/dyPx
    // are overwritten outright, and the origin cancels: seatInCell measures the
    // art relative to the anchor and then subtracts exactly that, so the art
    // lands in the same place at origin [0.5,0.5], [0.406,0.62] or [0,1]. Both
    // survive only as the fallback for a frame with no ART_BOUNDS entry (a
    // mineralrock ore variant that hasn't been tabulated). Anything else is a
    // tuned number that does nothing — three of these shipped, with comments
    // explaining offsets that had not moved a sprite in months. If a seated
    // sprite sits wrong, its ART_BOUNDS row is wrong; regenerate the table.
    const wantSeat = typeof spec.seat === 'function' ? spec.seat(o) : spec.seat;
    const SL = (typeof window !== 'undefined' && window.SpriteLayout) || null;
    if (wantSeat && SL) {
      const bframe = spec.seatFrame !== undefined ? spec.seatFrame : (frameVal ?? 0);
      const bb = SL.ART_BOUNDS[`${texKey}:${bframe}`];
      if (bb) {
        const seat = SL.seatInCell(bb, origin[0], origin[1], scl, scl * scaleYMul);
        dxPx = seat.dxPx; dyPx = seat.dyPx;
      }
    }
    s.setOrigin(origin[0], origin[1])
     .setScale(scl, scl * scaleYMul)
     .setPosition(Math.round(sx) + dxPx, Math.round(sy) + dyPx)
     .setAlpha(1).setTint(tint);
    // Per-kind post-config hook — runs AFTER the generic alpha/tint reset so
    // hooks can override (the tool-gate fade on trees / rocks, the fruittree
    // picked-dim). Handed the scene so a hook can read the save (tool tiers).
    if (typeof spec.after === 'function') spec.after(s, o, scene);
  };
  const towerList = filteredObj.filter(({ o }) => o.kind === 'tower');
  const nonTowerObj = towerList.length ? filteredObj.filter(({ o }) => o.kind !== 'tower') : filteredObj;
  Render.renderPool(scene, scene.objectPool, scene.objectsContainer, nonTowerObj, configureObject);
  Render.renderPool(scene, scene.towerPool, scene.towerContainer, towerList, configureObject);
  // ── Ripe fruit ────────────────────────────────────────────────────────────
  // A bearing fruit tree wears its fruit: the same icon the fruit carries in
  // the inventory, drawn as its own small sprite on the tree's canopy. The
  // tree's art never changes — picking removes the fruit and leaves the tree
  // standing exactly as it was, so an orchard still reads as an orchard once
  // it's been worked, and what's ripe reads at a glance across the tile.
  // Every number here came off the tree sprite itself in the `after` hook
  // above (crown from SpriteLayout.CROWN_BOUNDS, scale and depth from the
  // sprite) — nothing about the fruit is placed by hand.
  Render.renderPool(scene, scene.fruitPool, scene.objectsContainer, fruitList, (s, item) => {
    setTextureIfDifferent(s, item.key);
    if (s.frame.name !== item.frame) s.setFrame(item.frame);
    s.setOrigin(0.5, 0.5)
     .setScale(item.scale)
     .setAlpha(1)
     .clearTint()
     .setDepth(item.depth)
     .setPosition(item.x, item.y);
  });
  // The banner over a CLAIMED castle. One per castle, not per turret: worldgen
  // marks exactly one of a footprint's towers `flagPost`, so a castle with six
  // turrets flies one flag rather than six.
  //
  // Seated on that turret's crown — the tower art is bottom-anchored at
  // sy + CELL_PX/2 and runs its full frame height upward, so the flag's own
  // bottom-anchored pole lands on the battlements. Read from the frame rather
  // than a copied number, so a retall of the turret can't leave the flag
  // floating. Same container as the turrets, so it clears both rampart layers.
  const flagList = scene.isCastleClaimed
    ? towerList.filter(({ o }) => o.flagPost && scene.isCastleClaimed(o))
    : [];
  const towerH = flagList.length ? (scene.textures.getFrame('tower')?.height ?? 42) : 0;
  Render.renderPool(scene, scene.castleFlagPool, scene.towerContainer, flagList, (s, item) => {
    const { dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    setTextureIfDifferent(s, 'castle_flag');
    s.setOrigin(0.5, 1)
     .setScale(1)
     .setAlpha(1)
     .clearTint()
     .setPosition(Math.round(sx), Math.round(sy + CELL_PX * 0.5 - towerH + 2));
  });

  // POI pads — one rounded, slightly-oversized concrete slab under every
  // pad-bearing chest. The pad image is anchored so its cell centre lines up
  // with the chest's ground point (the slab spills ~10% past the cell).
  // Minor/lowtier POIs (bus stops, intersections, fuel, ATMs, etc.) get a MINI
  // version of the same slab — smaller and dimmer, but still a marked place —
  // instead of skipping it outright. Genuine loose supply crates (o.crate,
  // no poiClass) get no pad at all: they're a transient pickup, not a place.
  // Pads persist even when the chest is opened — only the chest itself disappears.
  const padList = [];
  for (const item of objList) {
    const { o, dx, dy } = item;
    if (o.kind !== 'chest') continue;
    // Produce/food stands render their own 80×80 stall structure — a concrete
    // slab poking out from under the stall reads wrong, so they skip the pad.
    if (produceStandFor(o)) continue;
    const shapeKey = padShapeKeyForPoi(o.poiClass);
    if (!shapeKey) {
      if (o.crate) continue;
      padList.push({ o, dx, dy, texKey: 'pad_round1', shape: PAD_SHAPES.round1, mini: true });
      continue;
    }
    const shape = PAD_SHAPES[shapeKey];
    if (!shape) continue;
    padList.push({ o, dx, dy, texKey: `pad_${shapeKey}`, shape });
  }
  // ── Traps ─────────────────────────────────────────────────────────────────
  // One sprite per trap, centred on its cell, scale 1 — both textures are
  // baked exactly one cell square (textures.js TRAP_PX), so the mark lands on
  // the cell it belongs to and cannot spill onto a neighbour. No seat pass and
  // no shadow: these lie flat ON the ground, they don't stand up off it.
  // Drawn into trapContainer, which sits under the sprites AND under the
  // lightmap — a hidden trap in an unlit cave cell is genuinely unlit, which
  // is the difference between the two halves of this feature.
  if (scene.trapPool && scene.trapContainer) {
    Render.renderPool(scene, scene.trapPool, scene.trapContainer, trapList, (s, item) => {
      const { dx, dy, sprung } = item;
      const { sx, sy } = project(dx, dy);
      setTextureIfDifferent(s, sprung ? 'trap_open' : 'trap_hidden');
      s.setOrigin(0.5, 0.5)
       .setScale(1)
       .setPosition(Math.round(sx), Math.round(sy))
       .setAlpha(1).setTint(0xffffff);
    });
  }

  // The POI "ping" is not drawn here any more: a live POI is a LIGHT (kind
  // 'poi' in src/lighting.js), offered to the lightmap from the tile scan
  // above, so the place reads from across the map by its own slow breath in
  // the dark rather than by a ring under the pad.
  Render.renderPool(scene, scene.padPool, scene.padContainer, padList, (s, item) => {
    const { o, dx, dy, texKey, shape, mini } = item;
    const { sx, sy } = project(dx, dy);
    setTextureIfDifferent(s, texKey);
    // Origin = the chest cell's centre within the pad image, so that the
    // pad's chest cell sits exactly at the chest's ground point (sx, sy).
    const [cc, cr] = shape.chest;
    s.setOrigin((cc + 0.5) / shape.cols, (cr + 0.5) / shape.rows)
     .setScale(mini ? POI_PAD_MINI_SCALE : 1)
     .setPosition(Math.round(sx), Math.round(sy));
    // Pads persist even when the chest is opened — only the chest sprite + tier
    // diamond disappear. The pad always renders (objList includes opened chests).
    // 0.55 — the slab is a backdrop for the POI, so it lets the terrain it
    // sits on read through rather than stamping an opaque disc over it. Minis
    // sit a touch dimmer still (0.42), reading as a lesser landmark rather
    // than competing with a full POI's pad.
    s.setAlpha(mini ? 0.42 : 0.55);
    // Electric light blue — a punchier, more saturated tint than the baked
    // near-white texture (UI_TREASURE) carries on its own, so the pad reads
    // as an energised landmark rather than a plain grey slab. The texture is
    // near-white, so a multiply tint lands almost exactly on this hue.
    s.setTint(POI_PAD_TINT);
  });

  // POI name labels above chests. ONE style for every world label: pale glyphs
  // outlined in near-black with a soft drop shadow, floating straight over the
  // map — the same treatment the crate labels and the house shop-signs use, so
  // a POI name reads as part of the same map lettering rather than as a UI
  // element pasted on top. (POI names used to be royal blue on an opaque pale
  // stone tablet; the plank fought every other label on screen.) The only
  // difference between the two kinds is the ink: POI names take a subtle blue
  // tint to keep the "this is a place" cue the blue used to carry, crates stay
  // plain white. Fallback labels (unnamed POIs) render smaller, with tighter
  // padding, so they read as secondary descriptors.
  const LABEL_INK       = '#d8e6ff';   // white with a subtle cool-blue tint
  const CRATE_LABEL_INK = '#ffffff';
  // A 2px dark outline, not just a drop shadow: pale glyphs on their own
  // vanish against pale ground (the commercial zone's light ceramic tiling,
  // sand, concrete). The outline carries the lettering over any background;
  // the shadow adds the lift.
  const LABEL_STROKE    = '#14110c';
  const LABEL_STROKE_W  = 2;
  const LABEL_SHADOW    = 'rgba(0,0,0,0.75)';
  // One player box for every label pass below (chest names, shop signs, the
  // open/busy plaque) — they all fade where they'd cover the character.
  const _playerBox = playerScreenBox(scene);
  // Labels persist even on opened chests so the player can still read what the place is.
  const chestLabels = objList.filter(({ o }) =>
    o.kind === 'chest' && (o.name || POI_CLASS_FALLBACK[o.poiClass]));
  let li = 0;
  for (const item of chestLabels) {
    const { o, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    let tx = scene.chestLabelPool[li];
    if (!tx) {
      tx = scene.add.text(0, 0, '', {
        font: fontMono('bold 10px'),
        color: LABEL_INK,
        stroke: LABEL_STROKE, strokeThickness: LABEL_STROKE_W,
        padding: { x: 4, y: 3 },
      }).setOrigin(0.5, 0).setDepth(50);
      scene.labelContainer.add(tx);
      scene.chestLabelPool.push(tx);
    }
    // Named POIs get their rusticified name; unnamed POIs fall back to a
    // class-based descriptor in brackets (e.g. "(Chapel)", "(Tourney Grounds)").
    const isFallback = !o.name;
    const label = isFallback
      ? `(${POI_CLASS_FALLBACK[o.poiClass]})`
      : rusticifyName(o.name);
    // Anchored just BELOW the chest sprite. Chests and crates are seated
    // centred in their cell now (the one-cell rule), so their art runs to about
    // sy + 12 — the old +4 anchor cut the bottom third off every chest it
    // labelled. Crates are the smaller sprite, so they need less clearance.
    const labelY = sy + (_chestIsBox(o) ? 13 : 16);
    // Switch font size + padding live: fallback labels are smaller. Done
    // BEFORE the layout below, which measures the rendered text.
    tx.setText(label).setVisible(true);
    tx.setFontSize(isFallback ? 9 : 11);
    setPaddingOnce(tx, isFallback ? 'f' : 'n', isFallback ? 2 : 3, isFallback ? 1 : 2);
    // POI names hang VERTICALLY, reading bottom-to-top up the right-hand side
    // of the chest; every other label on the map is horizontal. On a dense
    // block the POI names, the shop signs and the crate labels all used to
    // stack into the same horizontal pile and the eye couldn't tell which
    // named what. A quarter turn separates them at a glance, and it costs no
    // horizontal room — the reason the long ones were being clamped and
    // sliced in the first place. Supply crates stay horizontal: they're
    // transient pickups, not places, and their labels are one short word.
    // The test is `o.crate` and NOT _chestIsBox: that helper also answers true
    // for every tier-1 POI (an ATM, a bike rack, a bus stop) because they
    // borrow the box SPRITE — but those are places and their names belong
    // with the other POI names.
    // The pool is shared, so BOTH branches set rotation/origin every frame.
    const vertical = !o.crate;
    if (vertical) {
      // origin (0, 0.5) + a -90° turn: the run starts at the anchor and
      // climbs, centred on the anchor's x. Anchor at the sprite's foot, one
      // half-cell right of centre, so the glyphs clear the chest art.
      tx.setRotation(-Math.PI / 2).setOrigin(0, 0.5);
      // Clamp with the label's HEIGHT — that's its on-screen width once
      // turned — so a name near the canvas edge still sits fully inside it.
      tx.setPosition(Math.round(clampTextX(sx + CELL_PX * 0.5, tx.height, CANVAS_W)),
                     Math.round(sy + 14));
    } else {
      tx.setRotation(0).setOrigin(0.5, 0);
      // Clamp x to the canvas: origin-0.5 text at the raw sx ran off the edge,
      // so long labels were sliced on every viewport size.
      tx.setPosition(Math.round(clampTextX(sx, tx.width, CANVAS_W)), Math.round(labelY));
    }
    // Same treatment either way — only the ink differs (blue-tinted for a named
    // POI, plain white for a supply crate). The test is `o.crate`, same as the
    // orientation branch above and for the same reason: a tier-1 POI (ATM,
    // bike rack, bus stop) borrows the box SPRITE via _chestIsBox but is still
    // a place, so its label carries the same "this is a place" blue cue as
    // every other POI name. Only a genuine loose supply crate stays plain
    // white. The pool is shared across both, and a pooled slot may have just
    // drawn the other kind, so set it every frame.
    setColorOnce(tx, o.crate ? CRATE_LABEL_INK : LABEL_INK);
    tx.setStroke(LABEL_STROKE, LABEL_STROKE_W);
    setShadowOnce(tx, 'poi', 1, 1, LABEL_SHADOW, 2, true, true);
    // Full opacity EXCEPT where the label would cover the player — opened
    // chests keep their label legible (per user: the dimmed-after-open look
    // made closed shops read as inactive), the opened/closed state is carried
    // by the chest sprite frame + the tier diamond instead.
    fadeLabelOverPlayer(tx, _playerBox);
    li++;
  }
  hidePoolFrom(scene.chestLabelPool, li);

  // Specialty-shop labels above small-house shops (produce shops / blacksmiths /
  // traders). Plain coloured glyphs with a dark stroke + hard drop shadow —
  // no background plank — so the lettering floats over the building art.
  // Lettering colour comes from Shops.shopInk so each shop type's signage
  // matches its house tint at a glance.
  const SHOP_STROKE    = '#2a1408';                  // near-black wood shadow around glyphs
  const SHOP_DROP      = 'rgba(0,0,0,0.65)';         // hard drop shadow under the sign
  // Starter shop labels as "Home" — it's no longer a shop, but the player
  // should still spot their base across the map. Shops.shopLabel() returns
  // null for non-shopType houses, so we wrap it here so the renderer can
  // also handle the starter case without changing the Shops module.
  // Display labels for the role-keyed shop signs come from Shops.roleLabel —
  // the one table app.js's restoration card and offer titles read too, so the
  // sign over a shop and the words inside its modal can't drift apart. NOT
  // Shops.shopLabel (deleted): that was address-derived, and restore-order
  // roles no longer track the street address, so it would mislabel them.
  //
  // The produce shop's sign follows its STOCK: the tutorial's first one carries
  // seeds, not produce, so it signs "Seed Shop" (see Shops.roleLabel). The
  // trader's sign follows its OFFER: it is named for the item it barters away
  // ("Rockfruit Trader" — scene.traderGoodsName reads the same seeded pick the
  // barter modal hands over), and carries no street numeral, since which house
  // number a trader occupies says nothing about what it sells.
  const _roleLabel = (role, o) => Shops.roleLabel(role,
    role === 'market' && typeof scene.isFirstMarket === 'function' && scene.isFirstMarket(o),
    role === 'trader' && typeof scene.traderGoodsName === 'function' ? scene.traderGoodsName(o) : null);
  const _houseSignText = (o) => {
    // Wrecks have no sign — their identity is hidden until the player
    // restores them. Once _houseRole stops returning 'wreck', the
    // sign re-emerges with the correct shop / house label.
    if (_houseRole(o) === 'wreck') return null;
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) return 'Home';
    // Forced scarecrow shop — signed only while it still has one to sell.
    // After the sale it reverts to its underlying role (handled below).
    if (scene.save.scarecrowShopId && scene.save.scarecrowShopId === o.id
        && !scene.save.scarecrowShopUsed) {
      return `Scarecrows ${Shops.toRoman((o.address ?? 0) + 1)}`;
    }
    // Frozen restore-order shop role (blacksmith / trader / market / wizard).
    const role = (typeof scene.houseShopRole === 'function') ? scene.houseShopRole(o) : null;
    const label = role ? _roleLabel(role, o) : null;
    if (label) {
      if (role === 'trader') return label;   // named for its goods, not its address
      return `${label} ${Shops.toRoman((o.address ?? 0) + 1)}`;
    }
    // No specialty? Still give the building a label so the map reads as a
    // populated street instead of rows of anonymous huts. Roman-numeral
    // suffix from address+1 keeps consistency with the shop labels above.
    const roman = Shops.toRoman((o.address ?? 0) + 1);
    if (o.tier === 12) return `Castle ${roman}`;
    if (o.tier === 11) return `Fort ${roman}`;
    if (o.tier === 9) {
      // Plain residential — the delivery callout (wishlist icons while hungry,
      // a happy face once fed) is drawn by the DOM produce-sign overlay below,
      // not as emoji text. Fall back to a plain "House III" label only for
      // non-host tier-9 buildings that have no callout to show.
      if (_houseIsHost(o)) return null;   // the roof bubble handles it
      return `House ${roman}`;
    }
    return null;
  };
  // True if this house is a residential delivery host — a plain tier-9 home
  // (not a wreck, the player's own home, the starter smithy, a scarecrow shop,
  // or any specialty shop) that asks for produce bundles. Hosts always show a
  // roof callout: a wishlist while hungry, a happy face once fed for the day.
  const _houseIsHost = (o) => {
    if (!o || o.kind !== 'house' || o.tier !== 9) return false;
    if (_houseRole(o) === 'wreck') return false;                          // hidden until restored
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) return false;             // Home
    if (scene.save.scarecrowShopId && scene.save.scarecrowShopId === o.id
        && !scene.save.scarecrowShopUsed) return false;                   // active scarecrow shop (text sign instead)
    // Any frozen shop role (blacksmith / trader / market / wizard, incl. the
    // starter smithy) is a storefront, not a residential delivery host.
    if (typeof scene.houseShopRole === 'function' && scene.houseShopRole(o)) return false;
    const wanted = (typeof scene.wantedProduce === 'function') ? scene.wantedProduce(o) : [];
    return wanted.length > 0;
  };
  // Has this host already been fed today (so it shows a happy face, not a
  // wishlist)? The interact handler stamps it on delivery; both reset at the
  // UTC day boundary.
  const _houseSatisfied = (o) =>
    (typeof scene.isHouseSatisfied === 'function') && scene.isHouseSatisfied(o);
  // The residential wishlist a house should show as an ICON plaque, or null —
  // a host that's still hungry today. A satisfied host returns null here and
  // shows the happy bubble instead (see the produce-sign block below).
  const _houseProduceWanted = (o) =>
    (_houseIsHost(o) && !_houseSatisfied(o)) ? scene.wantedProduce(o) : null;
  // Sign ink for themed houses → matches the role's primary colour (same
  // hue we mix into the brick base under each one), so the label and the
  // foundation read as the same "house identity" at a glance. Plain houses /
  // forts / castles fall back to neutral inks below.
  const _ROLE_INK = {
    trailer:    '#a8b0c0',
    blacksmith: '#c25a3a',
    trader:     '#ffae5c',
    market:     '#5ddcc0',
    wizard:     '#b98cff',   // arcane violet
  };
  // Fallback inks for the non-specialty building kinds.
  const _CASTLE_INK = '#e0c060';   // gold — fits the "vault" flavor
  const _FORT_INK   = '#9aa49a';   // mossy stone — military
  const _HOUSE_INK  = '#d6c9a8';   // warm parchment — plain residential
  const _houseSignInk = (o) => {
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) return _ROLE_INK.trailer;
    if (scene.save.scarecrowShopId && scene.save.scarecrowShopId === o.id
        && !scene.save.scarecrowShopUsed) return '#cdb07a';   // straw-gold scarecrow sign
    const t = (typeof scene.houseShopRole === 'function') ? scene.houseShopRole(o) : null;
    if (t && _ROLE_INK[t]) return _ROLE_INK[t];
    if (o.tier === 12) return _CASTLE_INK;
    if (o.tier === 11) return _FORT_INK;
    if (o.tier === 9)  return _HOUSE_INK;
    return Shops.shopInk(o);
  };
  // Lighten any #rgb / #rrggbb sign colour 30% toward white. Applied to every
  // house label so the whole set of signs reads a shade brighter against the
  // building art. Non-hex inputs pass through unchanged.
  const _lighten30 = (col) => {
    if (typeof col !== 'string' || col[0] !== '#') return col;
    let h = col.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return col;
    const n = parseInt(h, 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const lr = Math.round(r + (255 - r) * 0.30);
    const lg = Math.round(g + (255 - g) * 0.30);
    const lb = Math.round(b + (255 - b) * 0.30);
    return '#' + ((1 << 24) | (lr << 16) | (lg << 8) | lb).toString(16).slice(1);
  };
  // `wide` entries are buildings whose centroid sits outside the viewport
  // (kept in the list so their roof still draws — see the cull pad). Their
  // signs and pips are dropped: clampTextX would pin the label to the screen
  // edge with no building under it.
  const shopHouses = filteredObj.filter(({ o, wide }) => !wide && o.kind === 'house' && _houseSignText(o));
  let sli = 0;
  for (const item of shopHouses) {
    const { o, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    let tx = scene.shopLabelPool[sli];
    if (!tx) {
      tx = scene.add.text(0, 0, '', {
        font: fontMono('bold 9px'),
        stroke: SHOP_STROKE, strokeThickness: 2,
      }).setOrigin(0.5, 0).setDepth(50);
      // Drop-shadow offset down-right with no blur so the sign reads as a
      // hung wooden plank, not a glowing rune. shadowFill=true paints the
      // shadow onto the glyph fill (and the wider stroke extends the
      // silhouette so the shadow visually sits behind the whole letter).
      tx.setShadow(1, 2, SHOP_DROP, 0, true, true);
      scene.labelContainer.add(tx);
      scene.shopLabelPool.push(tx);
    }
    // House sprite origin is [0.5, 0.9] — sy is roughly the building's foot.
    // Anchor the label TOP just below sy so the sign tucks under the
    // building, almost touching the doorstep (origin set to [0.5, 0] at
    // pool creation so position y = label top). +5 follows the house
    // sprite's own dyPx so the sign stays glued to the doorstep.
    tx.setText(_houseSignText(o)).setVisible(true);
    setColorOnce(tx, _lighten30(_houseSignInk(o)));
    tx.setPosition(Math.round(clampTextX(sx, tx.width, CANVAS_W)), Math.round(sy + 7) + 5);
    fadeLabelOverPlayer(tx, _playerBox);
    sli++;
  }
  hidePoolFrom(scene.shopLabelPool, sli);

  // Residential delivery plaques — the wanted-produce wishlist drawn as real
  // item ICONS instead of emoji text. Uses the same mechanism as flashLoot's
  // loot icon: pooled <div>s appended to <body> (NOT #game, whose CSS
  // transform would become the containing block for position:fixed) and
  // projected over each house foot every frame against #game's scaled rect.
  // Icon contents are (re)built only when a house's wishlist or the display
  // scale changes; thereafter we just reposition. Cheap per frame.
  {
    const gameEl = document.getElementById('game');
    scene._produceSignPool = scene._produceSignPool || [];
    const pool = scene._produceSignPool;
    // Remove the DOM nodes when the scene tears down (Phaser pools die with
    // the scene, but these live in <body>, so clean them up explicitly).
    if (gameEl && !scene._produceSignCleanup) {
      scene._produceSignCleanup = true;
      // Reset the guard on teardown so the listeners re-register if the scene
      // is ever soft-restarted (no such path today, but cheap insurance —
      // otherwise a restarted scene would leak its <body> overlays).
      const drop = () => { for (const s of pool) s.el && s.el.remove(); pool.length = 0; scene._produceSignCleanup = false; };
      scene.events.once('shutdown', drop);
      scene.events.once('destroy', drop);
    }
    // While a full-screen dialog is open, suppress the wishlist callouts.
    // They live in <body> (z-index 4), but every modal is appended inside
    // #game, whose CSS transform makes it a stacking context with effective
    // z-index:auto — so the modal's higher internal z-index can NOT paint
    // over a positive-z-index body child, and the bubble pokes through the
    // dim. A correctly layered callout would sit under the modal dim
    // (invisible) anyway, so just hide them. Skipping the build loop leaves
    // psi at 0, so the hide-tail below collapses the whole pool. Add new
    // full-screen modal ids here if more are introduced.
    const MODAL_IDS = ['offer-modal', 'chest-reward-modal', 'message-modal', 'stats-modal'];
    const dialogOpen = MODAL_IDS.some((id) => document.getElementById(id));
    let psi = 0;
    const gameRect = (gameEl && !dialogOpen) ? gameScreenRect() : null;
    if (gameRect) {
      const rect = gameRect;
      const scale = rect.width / W;            // uniform CSS scale (W = game px width)
      const ICON_GAME = 16;                    // per-icon side in game px (callout bubble)
      const sizePx = Math.max(8, Math.round(ICON_GAME * scale));  // displayed px
      for (const it of filteredObj) {
        // Every delivery host gets a roof callout. While hungry it's the
        // wishlist of produce icons; once a bundle's been delivered today the
        // house is happy and shows a smiling face instead (it'll want a fresh
        // bundle tomorrow). Non-host buildings get nothing here.
        if (it.wide || !_houseIsHost(it.o)) continue;
        const happy = _houseSatisfied(it.o);
        const wanted = happy ? null : scene.wantedProduce(it.o);
        const { sx, sy } = project(it.dx, it.dy);
        let slot = pool[psi];
        if (!slot) {
          const el = document.createElement('div');
          // White rounded callout — a little speech bubble that floats above the
          // house roof (where the old open/busy pip used to sit). The downward
          // tail is a separate child triangle added during the icon rebuild.
          el.style.cssText = 'position:fixed;left:0;top:0;display:flex;gap:3px;'
            + 'align-items:center;padding:3px 5px;background:#fff;border-radius:7px;'
            + 'border:1px solid rgba(0,0,0,0.18);box-shadow:0 1px 3px rgba(0,0,0,0.4);'
            + 'pointer-events:none;z-index:4;will-change:transform;';
          document.body.appendChild(el);
          slot = { el, key: null };
          pool.push(slot);
        }
        // Rebuild contents only when the wishlist / happy state / icon size
        // changes — the produce set is memoized per house, so this is normally
        // a no-op. The 'happy' sentinel in the key flips the bubble on delivery.
        const key = it.o.id + '|' + (happy ? 'happy' : wanted.join(',')) + '|' + sizePx;
        if (slot.key !== key) {
          slot.el.replaceChildren();
          if (happy) {
            // Smiling face — non-item UI, so emoji is allowed here (see QC §1).
            const face = document.createElement('div');
            face.textContent = '😊';
            face.style.cssText = `font-size:${sizePx}px;line-height:1;`;
            slot.el.appendChild(face);
          } else for (const id of wanted) {
            const ic = scene.renderItemIcon ? scene.renderItemIcon(id, sizePx, 'block') : null;
            if (ic) slot.el.appendChild(ic);
          }
          // Downward tail — a CSS triangle absolutely positioned at the bubble's
          // bottom centre so it points at the house. position:absolute keeps it
          // out of the flex flow, so it doesn't shift the icon row.
          const tail = document.createElement('div');
          tail.style.cssText = 'position:absolute;left:50%;bottom:-5px;width:0;height:0;'
            + 'border-left:5px solid transparent;border-right:5px solid transparent;'
            + 'border-top:6px solid #fff;transform:translateX(-50%);'
            + 'filter:drop-shadow(0 1px 0 rgba(0,0,0,0.18));';
          slot.el.appendChild(tail);
          slot.key = key;
        }
        // Float the bubble ABOVE the house roof: translate(-50%,-100%) anchors it
        // by its bottom-centre at sy-18 — where the old open pip tucked — so the
        // bubble and its tail rise above the building like a callout.
        const px = rect.left + sx * scale;
        const py = rect.top  + (sy - 18) * scale;
        slot.el.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px) translate(-50%, -100%)`;
        slot.el.style.display = 'flex';
        psi++;
      }
    }
    for (; psi < pool.length; psi++) pool[psi].el.style.display = 'none';
  }

  // Per-house readiness pip — sits just above each house / tower sprite and
  // shows either "✓ open" (this shop can take a deal right now) or "Xm"
  // (the wall-clock minutes until the hour bucket rolls over). Skipped for:
  //   • Castles + the starter blacksmith (dealCap=Infinity) — no busy state
  //     to communicate, so absence of a pip means "always open".
  //   • Unrestored wreck houses — they have no shop function until rebuilt,
  //     so the pip would read as a lie ("open" for a building you can't
  //     trade with). The restore modal is the affordance instead.
  // Styling: green ink on white plaque with a hard black border so the pip
  // reads against any biome colour, anchored top-left and offset 10 px
  // further left from the house's foot point.
  const houseObjs = filteredObj.filter(({ o, wide }) => !wide && (o.kind === 'house' || o.kind === 'tower'));
  let hri = 0;
  for (const item of houseObjs) {
    const { o, dx, dy } = item;
    if (typeof scene.shopReadiness !== 'function') break;
    const info = scene.shopReadiness(o);
    // Unlimited-deal shops never need a "busy" badge; the absence of a pip
    // is itself the signal that they're always open. (Castles/towers and the
    // starter blacksmith report dealCap === Infinity here.)
    if (info.dealCap === Infinity) continue;
    // The player's own starting building (home / trailer) isn't a timed shop
    // to the player — no open/busy pip on your own house.
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) continue;
    // Wrecks aren't shops yet — the pip would read as a contradiction.
    if (typeof scene._isHouseWreck === 'function' && scene._isHouseWreck(o)) continue;
    // Sealed castles (delivery gate not yet met) aren't open for business —
    // a "ready" pip would lie about the lock. (Castles report dealCap Infinity
    // and bail above, but keep this for safety.)
    if (typeof scene._isBuildingSealed === 'function' && scene._isBuildingSealed(o)) continue;
    // Locked forts (not yet unsealed with wood) aren't trading either — skip
    // the pip until the player pays the quartermaster.
    if (typeof scene._isFortLocked === 'function' && scene._isFortLocked(o)) continue;
    // Hosts (residential delivery houses) show their roof callout — wishlist
    // or happy face — where this pip would sit (see the produce-sign block
    // above), so they skip the separate open/busy pip entirely.
    if (_houseIsHost(o)) continue;
    const { sx, sy } = project(dx, dy);
    let tx = scene.shopReadyPool[hri];
    if (!tx) {
      // Small, quiet label — italic sans-serif at 8 px on a parchment-cream
      // plaque. Deliberately a different visual family from the house's
      // bold-monospace wooden sign hanging below it, so the two don't
      // compete: the name sign owns the building's identity, this label is
      // a secondary "open/closed" tag.
      tx = scene.add.text(0, 0, '', {
        font: fontSerif('italic 8px'),
        padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 1).setDepth(51);
      scene.labelContainer.add(tx);
      scene.shopReadyPool.push(tx);
    }
    const label = info.ready ? 'open' : shortDuration(info.waitMs);
    // Sepia ink on cream parchment for "open"; dim rust on cream for
    // "busy". Muted to read as a tag, not a callout.
    const ink = info.ready ? '#27521e' : '#5f2a2a';
    tx.setText(label).setVisible(true);
    setColorOnce(tx, ink);
    setBgColorOnce(tx, '#f3e9c6');
    // Origin (0.5, 1): y is the plaque's bottom. It hangs ON the shopfront:
    // bottom edge 2px below the art's midline (_houseMidPx — sy itself for
    // every centred role), so the tag sits at the eaves over the door, above
    // the name sign that hangs from the doorstep (sy + 12 and down), and
    // never over the roof. It sat 3px above the art's TOP until Sep 2026 and
    // read as floating off the building — see _houseMidPx. -10 on x nudges
    // it off-centre so it reads as hanging from a bracket on the left rather
    // than dead-centred over the door.
    tx.setPosition(Math.round(clampTextX(sx - 10, tx.width, CANVAS_W)),
                   Math.round(sy) - Math.round(_houseMidPx(o)) + 2);
    // Soft, low-opacity drop shadow so the tag looks like it hangs in
    // front of the building rather than being painted onto it. NOT the
    // hard 1-px outline of the previous version — that competed too
    // hard with the house sign's stroked block lettering.
    setShadowOnce(tx, 'pip', 1, 1, 'rgba(0,0,0,0.45)', 0, true, true);
    fadeLabelOverPlayer(tx, _playerBox);
    hri++;
  }
  hidePoolFrom(scene.shopReadyPool, hri);

  // Chest tier indicators: chunky bordered diamond above each unopened chest.
  // Drawn into the top-most tierGfx layer so it ALWAYS reads above the chest sprite,
  // labels, and pads — never gets occluded.
  // Crates (the `box` sprite — starter supply crates and tier-1 chests) are
  // excluded: the gem is a treasure-chest cue, so it shouldn't float over a crate.
  const chestObjs = filteredObj.filter(({ o }) => o.kind === 'chest' && !_chestIsBox(o));
  const g = scene.tierGfx;
  g.clear();
  for (const item of chestObjs) {
    const { o, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    const tier = chestTier(o.poiClass, o.x, o.y, o.depth);
    const color = CHEST_TIER_COLOR[tier];
    if (color == null) continue;   // tier 1 → no gem
    const cx = Math.round(sx + 1);   // +2px right (was sx - 1)
    const cy = Math.round(sy - 15);  // +3px down (was sy - 18)
    const r = 4.8;   // 20% smaller (was 6)
    // 1) Outer dark halo — fattens the diamond so it stands out on any bg.
    g.fillStyle(0x000000, 0.55);
    g.fillTriangle(cx, cy - (r + 2), cx + (r + 2), cy, cx, cy + (r + 2));
    g.fillStyle(0x000000, 0.55);
    g.fillTriangle(cx, cy - (r + 2), cx - (r + 2), cy, cx, cy + (r + 2));
    // 2) Filled coloured diamond — re-set fillStyle before each fillTriangle to
    // dodge a Phaser quirk where the state can be reset between calls.
    g.fillStyle(color, 1);
    g.fillTriangle(cx, cy - r, cx + r, cy, cx, cy + r);
    g.fillStyle(color, 1);
    g.fillTriangle(cx, cy - r, cx - r, cy, cx, cy + r);
    // 3) Thin black outline (1 px — was 2)
    g.lineStyle(1, 0x000000, 1);
    g.beginPath();
    g.moveTo(cx, cy - r); g.lineTo(cx + r, cy);
    g.lineTo(cx, cy + r); g.lineTo(cx - r, cy);
    g.closePath();
    g.strokePath();
  }

  // ── Coin drops (ATM / bicycle_parking burst). Walked across the same
  // 3×3-tile neighbourhood as objects/wildplants above. Expired coins
  // (now >= expiresAt) are spliced out of the in-memory entry.coinDrops
  // array right here at render time — they're ephemeral so we don't need
  // a separate sweep timer.
  const coinList = [];
  const _coinNow = Date.now();
  for (let dty = -1; dty <= 1; dty++) {
    for (let dtx = -1; dtx <= 1; dtx++) {
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx + dtx, pc.ty + dty));
      if (!entry || !entry.coinDrops || entry.coinDrops.length === 0) continue;
      // Filter-out expired coins by rewriting the array in place.
      let w = 0;
      for (let r = 0; r < entry.coinDrops.length; r++) {
        const c = entry.coinDrops[r];
        if (c.expiresAt && c.expiresAt <= _coinNow) continue;
        entry.coinDrops[w++] = c;
        const dx = c.x - pWorldX, dy = c.y - pWorldY;
        if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
        coinList.push({ c, dx, dy });
      }
      entry.coinDrops.length = w;
    }
  }
  if (scene.coinPool && scene.coinContainer) {
    Render.renderPool(scene, scene.coinPool, scene.coinContainer, coinList, (s, item) => {
      const { c, dx, dy } = item;
      const { sx, sy } = project(dx, dy);
      setTextureIfDifferent(s, 'coin_drop');
      // Tiny pulse: scale oscillates ~0.9..1.1 over ~800ms based on now+id-hash
      // so each coin breathes out of phase with its neighbours.
      const idH = (c.id || '').length * 2654435761;
      const phase = ((_coinNow + idH) % 800) / 800;     // 0..1
      const pulse = 1.0 + 0.12 * Math.sin(phase * Math.PI * 2);
      s.setOrigin(0.5, 0.5)
       .setScale(1.5 * pulse)
       .setPosition(Math.round(sx), Math.round(sy))
       .setAlpha(1).setTint(0xffffff);
    });
  }

  const _shinyNow = Date.now();
  Render.renderPool(scene, scene.plantedPool, scene.plantedContainer, plantedList, (s, item) => {
    const { p, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    s.setDepth(item._z ?? 0);          // screen-row z-order (see the z-order pass)
    // Rare shiny wild flora gets the warm sheen; everything else (farmed crops,
    // placed rocks) renders untinted. Pooled sprites keep their last tint, so
    // set it explicitly every frame. A flat gold multiply on already-green
    // flora reads too subtly (the player can't spot a shiny harvest), so a
    // shiny plant also TWINKLES: its tint shimmers between warm gold and a
    // pale near-white gold while it gently pulses in scale. Motion + brightness
    // are renderer-agnostic (Phaser.AUTO may fall back to canvas, so a WebGL
    // glow FX wouldn't be reliable) and make a shiny plant unmistakable.
    const isShinyFlora = !!(p.wildId && isShiny(p.wildId, SHINY_RATE.flora));
    let shinyScale = 1;
    if (isShinyFlora) {
      // Desync each plant's twinkle off a stable per-id phase so a field of
      // shinys shimmers out of step rather than blinking in unison. The id is
      // hashed as a STRING (util.js's one fnv1a): its LENGTH is the same
      // number for every wildplant in a tile, so hashing that put the whole
      // field back in unison — the same slip that emptied the beaches, see
      // items.js's wildplantFrame.
      const idH = fnv1a(p.wildId || '') >>> 0;
      const phase = ((_shinyNow + idH) % 1100) / 1100;          // 0..1
      const wave = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);  // 0..1
      shinyScale = 1.0 + 0.12 * wave;                           // 1.00..1.12 size pulse
      // Lerp the tint between deep gold and a bright pale gold (toward white,
      // which under a multiply tint brightens the sprite back up — a glint).
      const lo = SHINY_TINT, hi = 0xfff6cc;
      const lr = (lo >> 16) & 0xff, lg = (lo >> 8) & 0xff, lb = lo & 0xff;
      const hr = (hi >> 16) & 0xff, hg = (hi >> 8) & 0xff, hb = hi & 0xff;
      const r = Math.round(lr + (hr - lr) * wave);
      const g = Math.round(lg + (hg - lg) * wave);
      const b = Math.round(lb + (hb - lb) * wave);
      s.setTint((r << 16) | (g << 8) | b);
    } else {
      // Per-biome flora tint (golden field grass, swampy reeds, …) — the cell's
      // terrain was stamped onto the wildplant at worldgen time (`_biome`). Falls
      // back to no tint (0xffffff) when the biome has no tint for this crop.
      const bt = (typeof BiomeProfiles !== 'undefined' && p._biome != null)
        ? BiomeProfiles.tint(p._biome, p.crop) : null;
      s.setTint(bt || 0xffffff);
    }
    // Placed rockfruit stones use the produce-icon frame directly (col PRODUCE_COL)
    // rather than the in-world growth art. Stage clamping is skipped.
    if (p._placedRock) {
      const frame = (CROP_ROW['rockfruit'] ?? 4) * CROPS_SHEET_COLS + PRODUCE_COL;
      setTextureIfDifferent(s, 'crops');
      s.setFrame(frame);
      // Centre on the rock cell (0.5, 0.5) — this is the produce icon, not a
      // bottom-weighted stage-0 seed frame, so the foot-anchor (0.5, 0.85)
      // used to float it ~11px above the cell centre (same fix as the planted
      // sprites below).
      s.setOrigin(0.5, 0.5).setScale(2).setPosition(Math.round(sx), Math.round(sy));
      return;
    }
    const stage = Math.min(MAX_GROWTH_STAGE, p.stage ?? 0);
    const ov = CROP_SPRITE[p.crop];
    if (ov && ov.custom) {
      // Custom-sheet wildplants. Some are one frame (longgrass, the flowers),
      // others vary per cell — the shell's three cowries, the mushroom's two
      // cave caps — so the same world cell always draws the same art while the
      // field reads as varied. WHICH frame is items.js' call, not this pass's:
      // wildplantFrame owns both the hash and the crop's declared frame list,
      // so a frame the sheet doesn't carry can't be drawn here (this branch
      // used to roll a hash over ov.variants, a COUNT of the sheet's cells,
      // and the shell's count ran off the end of its art — see
      // CROP_SPRITE.shell).
      setTextureIfDifferent(s, ov.sheet);
      s.setFrame(wildplantFrame(p));
    } else if (ov && ov.sheet === 'springcrops') {
      // Spring Crops: col 0 = seed (stage 0), cols 1..4 = growth (4 = mature).
      const frame = ov.row * SPRING_CROPS_COLS + stage;
      setTextureIfDifferent(s, 'springcrops');
      s.setFrame(frame);
    } else {
      const row = CROP_ROW[p.crop] ?? 1;
      // In-world growth uses cols 0..5 of the crop's row.
      const frame = row * CROPS_SHEET_COLS + stage;
      setTextureIfDifferent(s, 'crops');
      s.setFrame(frame);
    }
    // 16×16 frame, scale 2 = 32×32 display. Centre the sprite in its cell
    // (origin 0.5, 0.5) — the earlier (0.5, 0.85) "foot-anchor" was meant
    // for character-like sprites but on flat ground tiles (longgrass,
    // flowers, wildplants) it shifted the sprite 11 px above the cell
    // centre, which the user spotted as "not centered in tiles".
    //
    // Exception: Crops.png seed frames (stage 0, default crops sheet) only
    // have pixels in the bottom half of their 16×16 cell — Crops.png draws
    // the seed sitting "on the ground". Centering that frame visually puts
    // the seed at the bottom of the tile. Stage 0 only: use the old
    // foot-anchor (0.5, 0.85) so the visible seed lands near the cell
    // centre. Stages 1+ grow upward and look right centered.
    const isCropsSheet = !ov || (!ov.custom && ov.sheet !== 'springcrops');
    const oy = (stage === 0 && isCropsSheet) ? 0.85 : 0.5;
    const cropScl = ((ov && ov.scale != null) ? ov.scale : 2) * shinyScale;
    s.setOrigin(0.5, oy).setScale(cropScl).setPosition(Math.round(sx), Math.round(sy));
  });

  // Growth-timer corner badges: for a watered, still-growing crop, render the
  // minutes-until-next-stage in the top-left of its cell. ✓ when the timer
  // has expired (player just needs to tap to advance). Hidden for wildplants
  // (no watered_t), seeds (stage 0 + unwatered), and mature crops.
  // Uses a parallel Phaser.Text pool — Render.renderPool only creates sprites.
  const STAGE_HOLD_MS = Crops.STAGE_HOLD_MS;   // single source of truth in crops.js
  const now = Date.now();
  const timerList = plantedList.filter(({ p }) =>
    !p.wildId && (p.stage ?? 0) < MAX_GROWTH_STAGE && p.watered_t);
  let ti = 0;
  for (const { p, dx, dy } of timerList) {
    let t = scene.plantedTimerPool[ti];
    if (!t) {
      // Origin (1,1) anchors the badge at its bottom-right — set once at pool
      // creation rather than every frame (it doesn't vary by item).
      t = scene.add.text(0, 0, '', {
        font: fontMono('bold 9px'),
        color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.7)',
        padding: { x: 2, y: 1 },
      }).setOrigin(1, 1).setDepth(Z_OVERLAY);
      scene.plantedContainer.add(t);
      scene.plantedTimerPool.push(t);
    }
    const { sx, sy } = project(dx, dy);
    const remaining = STAGE_HOLD_MS - (now - p.watered_t);
    // Largest-unit notation (util.js shortDuration) — the badge used to print
    // a BARE minutes number, the one timer in the game with no unit on it, so
    // "7" over a crop and "7m" over a house meant the same thing and didn't
    // look like it. ✓ once the hold has elapsed (tap to advance).
    const label = remaining <= 0 ? '✓' : shortDuration(remaining);
    // Bottom-right of the tile, inset 1px so the badge sits just inside the
    // cell border (origin (1,1) was set at pool creation).
    t.setText(label)
     .setPosition(Math.round(sx + CELL_PX / 2), Math.round(sy + CELL_PX / 2))
     .setAlpha(0.8)
     .setVisible(true);
    setColorOnce(t, remaining <= 0 ? '#a7ffb0' : '#ffffff');
    ti++;
  }
  hidePoolFrom(scene.plantedTimerPool, ti);

  // Heart overlay — a small 💗 floats above every tame (released_) creature
  // so the player can spot their pets at a glance. Pool is created lazily.
  scene._petHeartPool = scene._petHeartPool || [];
  const tameList = creatureList.filter(item => typeof item.c.id === 'string' && item.c.id.startsWith('released_'));
  let hi = 0;
  for (const item of tameList) {
    const { c, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    let t = scene._petHeartPool[hi];
    if (!t) {
      t = scene.add.text(0, 0, '💗', { font: fontMono('10px') })
        .setOrigin(0.5, 1).setDepth(Z_OVERLAY);
      scene.creaturesContainer.add(t);
      scene._petHeartPool.push(t);
    }
    // Float the heart ~16 px above the creature's anchor point. Tame creatures
    // sit at origin (0.5, 0.9) so anchor.y is roughly the ground; the heart
    // hovers just above the body.
    t.setPosition(Math.round(sx), Math.round(sy) - 22).setVisible(true);
    hi++;
  }
  hidePoolFrom(scene._petHeartPool, hi);

  // Creature draw geometry — scale, foot origin and constant float — comes
  // from ONE table, src/sprite_layout.js › CREATURE_ART, which the
  // work-progress wheel reads too (SpriteLayout.creatureWheelDy) and
  // tools/sprite_audit.js checks against the real PNGs. Keeping the numbers
  // there rather than inline here is what stops a rescaled sprite from
  // silently leaving its wheel (or its shadow) behind.
  //
  // `foot` is where a creature's ART bottom sits inside its FRAME, as a
  // fraction of frame height — the origin that puts its feet on the ground.
  // Creature sheets are padded differently: the slime blob ends at row 21 of
  // 32 while a cow fills its frame to the last row, so the blanket 0.9 every
  // kind used to share left the slime hanging 11px above its own contact
  // shadow (it read as flying) and sank the cow 3px into hers. A kind with no
  // entry keeps 0.9.
  const SL = (typeof SpriteLayout !== 'undefined') ? SpriteLayout : null;
  const creatureFoot = (SL && SL.creatureFoot) || ((kind) => 0.9);
  // Every kind drawn below has a CREATURE_ART entry (pinned by
  // test/node/creature_wheel.test.js), so the scale is the table's — resolved
  // through SpriteLayout.creatureArt so a GIANT monster draws its base kind's
  // sheet at GIANT_ART_SCALE; the `?? 1` only covers a bare harness with no
  // SpriteLayout loaded.
  const creatureScale = (SL && SL.creatureScale) || ((kind) => 1);
  const creatureFloat = (SL && SL.creatureFloat) || ((kind) => 0);
  // A giant's sheet, frame count and shadow are its base kind's.
  const baseKind = (SL && SL.baseKind) || ((kind) => kind);
  const giantMul = (kind) => (SL && SL.isGiantKind && SL.isGiantKind(kind)) ? SL.GIANT_ART_SCALE : 1;
  // The ground line a creature stands on, relative to its cell centre. Shared
  // with the shadow pass below so the sprite and its shadow can never drift:
  // with the origin above, placing the sprite at sy + this lands the art's
  // bottom edge exactly on the shadow's centre.
  const CREATURE_GROUND_DY = (typeof SpriteLayout !== 'undefined'
    && SpriteLayout.CREATURE_GROUND_DY != null) ? SpriteLayout.CREATURE_GROUND_DY : 2;

  Render.renderPool(scene, scene.creaturePool, scene.creaturesContainer, creatureList, (s, item) => {
    const { c, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    s.setDepth(item._z ?? 0);          // screen-row z-order (see the z-order pass)
    if (c.kind === 'cow') {
      if (setTextureIfDifferent(s, 'cow')) s.play('cow-idle');
      // Cow is the biggest farm animal — needs to read larger than the
      // 32×32 cat/dog/deer/crow which all sit at 1.30. Bumped to 1.50
      // (48 px effective) so the cow visibly dwarfs the pets.
      s.setOrigin(0.5, creatureFoot(c.kind)).setScale(creatureScale(c.kind))
       .setPosition(Math.round(sx), Math.round(sy) + CREATURE_GROUND_DY);
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'cat' || c.kind === 'dog') {
      // 32×32 RPG-Maker pet body sheet. Row 0 (frames 0..3) is the idle
      // cycle defined in app.js. Both pets at 1.3 — the dog sheet's frame
      // fills more of its 32×32 cell than the cat's does, so they read as
      // visually similar despite sharing the scalar.
      const animKey = c.kind === 'cat' ? 'cat-idle' : 'dog-idle';
      const sc = creatureScale(c.kind);
      if (setTextureIfDifferent(s, c.kind)) s.play(animKey);
      s.setOrigin(0.5, creatureFoot(c.kind)).setScale(sc)
       .setPosition(Math.round(sx), Math.round(sy) + CREATURE_GROUND_DY);
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'deer') {
      // 32×32 sheet (see assets.js comment) → scale 1.3, a touch under cow.
      // Row 0 frames 0-1 are the side-view idle pose.
      if (s.texture.key !== 'deer') { s.anims?.stop(); s.setTexture('deer', 0); }
      s.setFrame(0);
      s.setOrigin(0.5, creatureFoot(c.kind)).setScale(creatureScale(c.kind))
       .setPosition(Math.round(sx), Math.round(sy) + CREATURE_GROUND_DY);
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'rabbit') {
      // 16×16 sheet → 1.5× (per user). Reads a touch smaller than the
      // chicken's 1.20 + cow's 1.20 because the rabbit's per-frame footprint
      // fills less of its 16×16 cell.
      if (s.texture.key !== 'rabbit') { s.anims?.stop(); s.setTexture('rabbit', 0); }
      s.setFrame(0);
      s.setOrigin(0.5, creatureFoot(c.kind)).setScale(creatureScale(c.kind))
       .setPosition(Math.round(sx), Math.round(sy) + CREATURE_GROUND_DY);
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'crow') {
      // 32×32 sheet (see assets.js comment). Row 0 frames 0-4 are the ground
      // strut; row 1 is intentionally empty in the source PNG; row 2 is the
      // take-off flap. Float 14 px above the ground tile. Scale 1.3 reads as
      // a proper bird next to the cow rather than a tiny pebble.
      if (s.texture.key !== 'crow') { s.anims?.stop(); s.setTexture('crow', 0); }
      s.setFrame(0);
      s.setOrigin(0.5, creatureFoot(c.kind)).setScale(creatureScale(c.kind))
       .setPosition(Math.round(sx), Math.round(sy) + CREATURE_GROUND_DY - creatureFloat(c.kind));
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'butterfly') {
      // 16×16 7-frame sheet → 2.0×, ~100 ms/frame.
      if (s.texture.key !== 'butterfly') { s.anims?.stop(); s.setTexture('butterfly', 0); }
      s.setFrame(Math.floor(performance.now() / 100) % 7);
      s.setOrigin(0.5, creatureFoot(c.kind)).setScale(creatureScale(c.kind))
       .setPosition(Math.round(sx), Math.round(sy) + CREATURE_GROUND_DY - creatureFloat(c.kind));
      s.setFlipX(!!c._faceFlip);
    } else if (isMonster(c.kind)) {
      const m = MONSTERS[c.kind];
      // A giant (giant_goblin …) is drawn on its base kind's sheet; the size
      // comes from creatureScale via SpriteLayout.creatureArt.
      const bk = baseKind(c.kind);
      const texKey = bk === 'purple_slime' ? 'purple_slime'
                   : bk === 'goblin' ? 'goblin'
                   : bk === 'goblin_archer' ? 'goblin_archer'
                   : 'slime';
      const frameCount = (bk === 'goblin' || bk === 'goblin_archer') ? 6 : 4;
      if (s.texture.key !== texKey) { s.anims?.stop(); s.setTexture(texKey, 0); }
      s.setFrame(Math.floor(performance.now() / 160) % frameCount);
      if (c._hopSeed == null) {
        let h = 0; const id = c.id || '';
        for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
        c._hopSeed = h % 600;
      }
      const period = m.fly ? 320 : 600;
      const ph = ((performance.now() + c._hopSeed) % period) / period;
      const hopPx = Math.abs(Math.sin(ph * Math.PI)) * (m.fly ? 10 : 6);
      const floatPx = creatureFloat(c.kind);   // fliers hover off the floor
      s.setOrigin(0.5, creatureFoot(c.kind)).setScale(creatureScale(c.kind))
       .setPosition(Math.round(sx),
                    Math.round(sy) + CREATURE_GROUND_DY - Math.round(hopPx) - floatPx);
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'slime') {
      // 32×32 sheet; row 0 (frames 0-3) is the idle squish loop. A continuous
      // vertical hop — phase-offset per slime via a cached id hash — gives the
      // chicken-like bounce even while idle; slimes are always jiggling.
      if (s.texture.key !== 'slime') { s.anims?.stop(); s.setTexture('slime', 0); }
      s.setFrame(Math.floor(performance.now() / 160) % 4);
      if (c._hopSeed == null) {
        let h = 0; const id = c.id || '';
        for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
        c._hopSeed = h % 600;
      }
      const ph = ((performance.now() + c._hopSeed) % 600) / 600;   // 0..1 per hop
      const hopPx = Math.abs(Math.sin(ph * Math.PI)) * 6;          // arc up to 6 px
      // Anchored on the blob's own bottom row, so the hop lifts it OFF the
      // shadow instead of starting 11px above it ("the slime is flying").
      s.setOrigin(0.5, creatureFoot(c.kind)).setScale(creatureScale(c.kind))
       .setPosition(Math.round(sx), Math.round(sy) + CREATURE_GROUND_DY - Math.round(hopPx));
      s.setFlipX(!!c._faceFlip);
    } else {
      // Chicken sheet is 16×16 (see assets.js note). Per user: +20% from the
      // Per user → 1.20 (still well under the cow's 1.20 because the chicken
      // sheet is 16×16 while the cow is 32×32 — same scalar, half the size).
      if (setTextureIfDifferent(s, 'chicken')) s.play('chicken-idle');
      s.setOrigin(0.5, creatureFoot(c.kind)).setScale(creatureScale(c.kind))
       .setPosition(Math.round(sx), Math.round(sy) + CREATURE_GROUND_DY);
      s.setFlipX(!!c._faceFlip);
    }
    // Rare shiny animals — and ELITE monsters, the same flag — wear the warm
    // sheen. Pooled sprites keep their last tint, so set an explicit colour
    // every frame (white for the common, plain case). A foe the Frost Powder
    // froze (c._frozenUntil, app.js useFrostPowder) wears ice over either.
    const frozen = c._frozenUntil != null && Date.now() < c._frozenUntil;
    s.setTint(frozen ? FROZEN_TINT : c.shiny ? SHINY_TINT : 0xffffff);
  });


  // Contact shadows under creatures. Unlike the sprite, the shadow stays
  // pinned to the CELL — it never rides the hop/hover offset — so a bouncing
  // slime or a hovering bat reads as leaving the ground instead of sliding
  // along it. Width is per-kind rather than measured, because creature sheets
  // animate (a measured shadow would pulse frame to frame).
  if (scene.creatureShadowPool && scene.shadowContainer) {
    const CRITTER_SHADOW_W = {
      cow: 30, deer: 26, dog: 22, cat: 20, crow: 18, rabbit: 14, chicken: 14,
      butterfly: 9, slime: 22, cave_slime: 22, purple_slime: 22, goblin: 22, goblin_archer: 22,
    };
    Render.renderPool(scene, scene.creatureShadowPool, scene.shadowContainer, creatureList, (s, item) => {
      const { c, dx, dy } = item;
      const { sx, sy } = project(dx, dy);
      setTextureIfDifferent(s, 'bldg_shadow');
      const w = (CRITTER_SHADOW_W[baseKind(c.kind)] || 18) * giantMul(c.kind);
      // Airborne kinds sit higher off the ground, so their shadow reads
      // smaller and fainter — the standard "how high is it" cue.
      const airborne = c.kind === 'butterfly' || c.kind === 'crow';
      s.setOrigin(0.5, 0.5)
       .setDisplaySize(w, w * 0.34)
       .setPosition(Math.round(sx), Math.round(sy) + CREATURE_GROUND_DY)
       .setAlpha(airborne ? 0.20 : 0.32).setTint(0xffffff);
    });
  }

  // Renderer-AGNOSTIC shiny markers. The gold setTint() above (and on trees /
  // wild flora) is a WebGL multiply that silently does NOTHING under Phaser's
  // Canvas fallback, so on those devices a shiny animal/plant looked identical
  // to a plain one — players reported never seeing shinies. Float a baked-gold
  // sparkle above every shiny entity instead: its colour is in the texture and
  // it animates with pure transforms (scale / alpha / rotation + a small bob),
  // both of which render under WebGL and Canvas alike. The existing tint/twinkle
  // stays as an extra flourish where WebGL is available.
  const sparkList = [];
  const pushSpark = (it, id) => sparkList.push({ dx: it.dx, dy: it.dy, id: id || '' });
  for (const it of creatureList) if (it.c.shiny) pushSpark(it, it.c.id);
  for (const it of plantedList) {
    if (it.p.wildId && isShiny(it.p.wildId, SHINY_RATE.flora)) pushSpark(it, it.p.wildId);
  }
  // Iterate filteredObj, NOT objList: a chopped shiny tree is still in objList
  // (so it depth-sorts / tracks state) but is dropped from filteredObj and so
  // renders no sprite. Sparking off objList left a gold sparkle hovering over
  // the now-empty cell — the "sparkle on the road with nothing under it" bug.
  for (const it of filteredObj) {
    if ((it.o.kind === 'tree' || it.o.kind === 'fruittree') && isShiny(it.o.id, SHINY_RATE.tree)) {
      pushSpark(it, it.o.id);
    }
  }
  const _sparkNow = Date.now();
  Render.renderPool(scene, scene.sparkPool, scene.sparkContainer, sparkList, (s, item) => {
    setTextureIfDifferent(s, 'shiny_spark');
    const { sx, sy } = project(item.dx, item.dy);
    // Desync each marker's twinkle off a stable per-id phase so a cluster of
    // shinies shimmers out of step rather than blinking in unison.
    let h = 0; const id = item.id;
    for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
    const phase = ((_sparkNow + (h % 2600)) % 2600) / 2600;        // 0..1
    const wave = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);        // 0..1
    const bob = Math.round(2 * Math.sin(phase * Math.PI * 2));     // -2..2 px
    const scl = 0.5 + 0.30 * wave;                                 // ~16..~26px from 32px tex
    // Pin the sparkle's TOP to the cell's top edge (origin is centred, so add
    // half the scaled height) so it sits AT THE TOP of, but INSIDE, the cell —
    // growing downward as it twinkles instead of floating above the cell.
    const halfH = 16 * scl;                                        // half the scaled 32px texture
    const yTop = sy - CELL_PX / 2 + 1;                             // cell top, 1px inset
    s.setOrigin(0.5, 0.5)
     .setScale(scl)
     .setAlpha(0.55 + 0.45 * wave)
     .setAngle(phase * 360)                                        // slow shimmer spin
     .setTint(0xffffff)
     .setPosition(Math.round(sx), Math.round(yTop + halfH + bob));
  });

  // Apply the screen-row z-order stamped above. Phaser renders a container's
  // children in list order, so the shared world layer has to be re-sorted by
  // depth once every sprite has been positioned. StableSort, so pooled slots
  // that share a depth (all the hidden ones) keep a fixed relative order.
  if (scene.worldContainer && scene.worldContainer.sort) scene.worldContainer.sort('depth');

  // ── The lightmap ──────────────────────────────────────────────────────────
  // Last, once every light is known: the campfires on this depth, the
  // buildings the scan offered above, and the player. Anchored like every
  // sprite in this pass (metres from the camera anchor), so the lights slide
  // with a peek and stay on the ground they belong to.
  if (LIGHTS) LIGHTS.draw(scene, pWorldX, pWorldY, halfM);
};
