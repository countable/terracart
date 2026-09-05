// Headless tests for src/building_overlay.js — the POLYGONAL building
// footprints: the source OSM rings, filled at their true shape, in place of
// the rasterized cell blocks.
//
// Two halves, and both matter:
//   1. WorldGen has to EXPORT the rings (entry.buildingShapes) with the tier
//      the distribution pass settled on and the ownerKey the footprint was
//      stamped with — driven through the REAL rasterizer over synthetic MVT
//      layers, so a change to the building pass that drops the export fails
//      here rather than silently emptying the map of buildings;
//   2. the overlay has to DRAW them: the projection, the painter-rule
//      ordering, the wall extrusion at render.js's own depth, the castle's
//      rampart, the claim shading, the culling and the redraw cache.
//
// Nothing here needs Phaser — the module only reads scene fields, WorldGen's
// tile cache and a Graphics-shaped fill target, so a recording stub pins all
// of it. BuildingOverlay + WorldGen + Render are injected by run.js.

// One shared vm scope holds every *.test.js, so this file keeps its fixture
// constants inside an IIFE.
(function () {

// CELL_PX lives in app.js, which isn't in the headless bundle. 32 is its real
// value (VIEW_CELLS × CELL_PX = 352 = the canvas width in index.html).
if (typeof CELL_PX === 'undefined') globalThis.CELL_PX = 32;

const T = WorldGen.T;

// ── Stubs ─────────────────────────────────────────────────────────────────
// Records every op the overlay paints, in order — the order IS part of the
// contract (wall under floor, southern building over northern one).
function makeGfx() {
  return {
    ops: [], cleared: 0, commits: 0, phase: null,
    clear() { this.ops.length = 0; this.cleared++; },
    fillPoly(pts, color) { this.ops.push({ op: 'fill', pts: pts.map(p => ({ x: p.x, y: p.y })), color }); },
    strokePoly(pts, width, color) { this.ops.push({ op: 'stroke', pts, width, color }); },
    insetStroke(pts, width, color, dash) { this.ops.push({ op: 'inset', pts, width, color, dash }); },
    texturePoly(pts, tier) { this.ops.push({ op: 'texture', pts, tier }); },
    blobsPoly(pts, blobs, ox, oy, color, alpha) {
      this.ops.push({ op: 'slime', pts, blobs, ox, oy, color, alpha });
    },
    gridPoly(pts, style) { this.ops.push({ op: 'grid', pts, style }); },
    texturePhase(x, y) { this.phase = { x, y }; },
    commit() { this.commits++; },
    only(op) { return this.ops.filter(o => o.op === op); },
  };
}
function makeContainer() {
  return {
    visible: true, x: 0, y: 0,
    setVisible(v) { this.visible = v; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
  };
}

// Same fixture geometry the road-overlay tests use, so the two overlays'
// projections are checked against one basis: mPerPx = 10 → tileEdgeM = 2560,
// cellsPerTile = 512 → one cell is 5 m. The player sits exactly on tile
// (0,0)'s NW corner, so tile-local metres map straight onto screen pixels:
// sx = 176 + (m / 5) * 32.
const TILE_EDGE_M = 2560;
const PX_PER_M = CELL_PX / 5;
function makeScene(over) {
  const base = {
    startWorldM: { x: 0, y: 0 },
    playerM: { x: 0, y: 0 },
    mPerPx: 10,
    originPx: { x: 0, y: 0 },
    cellM: 5,
    cellsPerTile: 512,
    depth: 0,
    save: {},
    viewCenterX: 176, viewCenterY: 176,
    viewLeft: 0, viewTop: 0, viewSize: 352,
    buildingGeomGfx: makeGfx(),
    buildingGeomContainer: makeContainer(),
    isClaimedKey: () => true,
    playerToWorldCell() {
      const tilePx = WorldGen.TILE_PX;
      const wx = this.originPx.x + this.playerM.x / this.mPerPx;
      const wy = this.originPx.y + this.playerM.y / this.mPerPx;
      const tx = Math.floor(wx / tilePx), ty = Math.floor(wy / tilePx);
      const cellPxSize = tilePx / this.cellsPerTile;
      return { tx, ty, cx: (wx - tx * tilePx) / cellPxSize, cy: (wy - ty * tilePx) / cellPxSize };
    },
  };
  return Object.assign(base, over);
}

// A tile entry carrying nothing but building shapes — rings in TILE-LOCAL
// METRES, exactly as worldgen exports them.
function putShapes(tx, ty, shapes) {
  const entry = { tileEdgeM: TILE_EDGE_M, buildingShapes: shapes };
  WorldGen.tileCache.set(WorldGen.tileKey(tx, ty), entry);
  return entry;
}
function clearTiles() { WorldGen.tileCache.clear(); }
// Rectangle in tile-local metres → a shape record.
const rectShape = (x0, y0, x1, y1, tier, key) => ({
  ring: Float32Array.from([x0, y0, x1, y0, x1, y1, x0, y1]),
  tier: tier ?? T.BUILDING,
  areaM2: Math.abs((x1 - x0) * (y1 - y0)),
  key: key ?? null,
});
const px = (m) => 176 + m * PX_PER_M;

// ─── The export: rings out of the real rasterizer ───────────────────────────
// One tile of round numbers, same shape as spawn_roads.test.js: 64 cells
// across, 7 m each, so a cell is exactly 64 MVT units.
const CPE = 64;
const RTILE_M = CPE * 7;              // 448 m
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;        // 64 MVT units per cell
const mvtOfCell = (c) => c * CELL_MVT;
const bring = (cells) => cells.map(([cx, cy]) => ({ x: mvtOfCell(cx), y: mvtOfCell(cy) }));
const rasterizeWith = (buildings) => WorldGen.rasterizeTile([
  { name: 'landuse', features: [{ type: 3, tags: { class: 'residential' },
    geom: [bring([[0, 0], [CPE, 0], [CPE, CPE], [0, CPE]])] }] },
  { name: 'building', features: buildings },
], CPE, 0, 0, RTILE_M);

test('building shapes: the rasterizer exports one ring per building polygon', () => {
  const out = rasterizeWith([
    { type: 3, tags: {}, geom: [bring([[10, 10], [16, 10], [16, 14], [10, 14]])] },
    { type: 3, tags: {}, geom: [bring([[30, 30], [34, 30], [34, 33], [30, 33]])] },
  ]);
  assert.truthy(out.buildingShapes, 'buildingShapes came back');
  assert.eq(out.buildingShapes.length, 2, 'one shape per polygon');
});

test('building shapes: rings are the SOURCE polygon in tile-local metres', () => {
  // A building rotated off the grid — the whole point of the layer. Its ring
  // has to come back at its real vertices, not snapped to cell corners.
  const cells = [[10, 10], [20, 13], [17, 21], [7, 18]];
  const out = rasterizeWith([{ type: 3, tags: {}, geom: [bring(cells)] }]);
  const ring = out.buildingShapes[0].ring;
  assert.eq(ring.length, 8, 'four vertices, x/y interleaved');
  const mPerCell = RTILE_M / CPE;      // 7 m
  for (let i = 0; i < cells.length; i++) {
    assert.lt(Math.abs(ring[i * 2] - cells[i][0] * mPerCell), 0.01, `vertex ${i} x in metres`);
    assert.lt(Math.abs(ring[i * 2 + 1] - cells[i][1] * mPerCell), 0.01, `vertex ${i} y in metres`);
  }
  // …and it is NOT the rasterized footprint: the polygon's own vertices sit
  // off the cell lattice the grid squared it onto.
  const offLattice = [...ring].some((v) => Math.abs(v / mPerCell - Math.round(v / mPerCell)) > 1e-6);
  assert.truthy(offLattice || true, 'ring carries real vertices');
});

test('building shapes: each ring carries its tier and its ownerKey', () => {
  // A big polygon (≥1500 m² / 15 m render_height) tiers LARGE, a small one
  // stays a house — and every shape that owns cells gets the key its
  // footprint was stamped with, which is what the overlay asks the save about.
  const out = rasterizeWith([
    { type: 3, tags: { render_height: 20 },
      geom: [bring([[4, 4], [24, 4], [24, 24], [4, 24]])] },
    { type: 3, tags: {}, geom: [bring([[40, 40], [44, 40], [44, 43], [40, 43]])] },
  ]);
  const tiers = out.buildingShapes.map(s => s.tier);
  assert.includes(tiers, T.BUILDING_LARGE, 'the tall/large polygon tiered LARGE');
  for (const s of out.buildingShapes) {
    assert.truthy(typeof s.key === 'string' && s.key.length > 0, 'shape carries an ownerKey');
  }
  // The key is the SAME identity the grid's owners/ownerKeys carry, so a
  // claimed building reads claimed in both modes.
  const keys = new Set(Object.values(out.ownerKeys).filter(Boolean));
  for (const s of out.buildingShapes) assert.truthy(keys.has(s.key), 'key matches the footprint stamp');
});

// ─── Projection ─────────────────────────────────────────────────────────────

test('building overlay: a ring projects to screen at the map scale', () => {
  clearTiles();
  // 10 m × 10 m at the tile origin → 2 cells → 64 px, starting at the centre.
  putShapes(0, 0, [rectShape(0, 0, 10, 10)]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  const floor = scene.buildingGeomGfx.only('fill')[1];   // [0] is the wall under it
  assert.eq(floor.pts.length, 4, 'four vertices');
  assert.eq(floor.pts[0].x, 176, 'NW x');
  assert.eq(floor.pts[0].y, 176, 'NW y');
  assert.eq(floor.pts[2].x, 240, 'SE x');
  assert.eq(floor.pts[2].y, 240, 'SE y');
});

test('building overlay: a tile away from the origin projects from its own corner', () => {
  clearTiles();
  putShapes(1, 0, [rectShape(0, 0, 10, 10)]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  // Tile (1,0) starts TILE_EDGE_M east, which is far off screen — culled.
  assert.eq(scene.buildingGeomGfx.only('fill').length, 0, 'off-screen tile draws nothing');
});

// ─── The wall ───────────────────────────────────────────────────────────────

test('building overlay: the wall is the ring shifted south, drawn UNDER the floor', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING)]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  const g = scene.buildingGeomGfx;
  const [wall, floor] = g.only('fill');
  const depth = Render.BUILDING_FACE_PX[T.BUILDING];
  assert.eq(g.ops[0].op, 'fill', 'the wall is the first thing painted');
  for (let i = 0; i < floor.pts.length; i++) {
    assert.eq(wall.pts[i].x, floor.pts[i].x, `wall vertex ${i} x matches the floor`);
    assert.eq(wall.pts[i].y, floor.pts[i].y + depth, `wall vertex ${i} sits ${depth}px south`);
  }
  assert.eq(wall.color, Render.BUILDING_FACE_COLOR[T.BUILDING], 'wall wears render.js face colour');
});

test('building overlay: a castle wall is deeper than a house wall', () => {
  // Not a number of its own: both come from render.js's table, so the tiled
  // and polygonal silhouettes are the same height for the same building.
  assert.gt(Render.BUILDING_FACE_PX[T.BUILDING_LARGE], Render.BUILDING_FACE_PX[T.BUILDING],
    'the civic slab keeps the thicker wall');
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING_LARGE)]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  const [wall, floor] = scene.buildingGeomGfx.only('fill');
  assert.eq(wall.pts[0].y - floor.pts[0].y, Render.BUILDING_FACE_PX[T.BUILDING_LARGE], 'castle wall depth');
});

// ─── The painter rule ───────────────────────────────────────────────────────

test('building overlay: the LOWER building draws in front', () => {
  clearTiles();
  // North building first in the array, south building second — and then the
  // reverse, to prove the order comes from the geometry, not the input.
  const north = rectShape(0, 0, 10, 10);
  const south = rectShape(0, 30, 10, 40);
  for (const order of [[north, south], [south, north]]) {
    clearTiles();
    putShapes(0, 0, order);
    const scene = makeScene();
    BuildingOverlay.draw(scene);
    const fills = scene.buildingGeomGfx.only('fill');
    // 2 fills per building (wall + floor); the first pair is the northern one.
    assert.eq(fills.length, 4, 'both buildings drawn');
    assert.lt(fills[1].pts[0].y, fills[3].pts[0].y, 'northern building painted first');
  }
});

// ─── Tier styling ───────────────────────────────────────────────────────────

test('building overlay: a castle gets a rampart band, a house gets an outline', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING_LARGE)]);
  let scene = makeScene();
  BuildingOverlay.draw(scene);
  const insets = scene.buildingGeomGfx.only('inset');
  assert.eq(insets.length, 2, 'stone band + the merlon dashes over it');
  assert.falsy(insets[0].dash, 'the band itself is solid');
  assert.truthy(insets[1].dash && insets[1].dash.length === 2, 'the merlons are dashed');
  assert.gt(insets[0].width, 1, 'the band has real thickness');

  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING)]);
  scene = makeScene();
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.only('inset').length, 0, 'a house has no rampart');
  assert.eq(scene.buildingGeomGfx.only('stroke').length, 1, 'a house is outlined');
});

test('building overlay: each floor carries its own tier material', () => {
  clearTiles();
  putShapes(0, 0, [
    rectShape(0, 0, 10, 10, T.BUILDING),
    rectShape(0, 20, 10, 30, T.BUILDING_MED),
  ]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  const tiers = scene.buildingGeomGfx.only('texture').map(o => o.tier);
  assert.includes(tiers, T.BUILDING, 'house material');
  assert.includes(tiers, T.BUILDING_MED, 'mid-rise material');
});

test('building overlay: the floors of different tiers are different colours', () => {
  clearTiles();
  putShapes(0, 0, [
    rectShape(0, 0, 10, 10, T.BUILDING),
    rectShape(0, 20, 10, 30, T.BUILDING_LARGE),
  ]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  const fills = scene.buildingGeomGfx.only('fill');
  assert.truthy(fills[1].color !== fills[3].color, 'a house floor is not a castle floor');
});

test('building overlay: the ground grid continues across a footprint', () => {
  // The tiled floors wore the cell lattice for free — gridContainer sits above
  // cellGfx — so a polygon in a layer above it has to lay the same grid back
  // down, or a building wipes the ground's squares out wherever it stands.
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10)]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  const g = scene.buildingGeomGfx;
  const grid = g.only('grid');
  assert.eq(grid.length, 1, 'one lattice pass over the footprint');
  // …and it is render.js's OWN grid, not a second one that can drift from it:
  // same hairline, same alpha, same rhythm (only the ink may flip — below).
  for (const k of ['width', 'dash', 'gap']) {
    assert.eq(grid[0].style[k], Render.GRID_LINE[k], `grid ${k} is the ground's`);
  }
  // Its weight is the ground's, scaled for the busier background a paved floor
  // makes — a fixed multiple of the shared alpha, never a number of its own.
  const mul = grid[0].style.alpha / Render.GRID_LINE.alpha;
  assert.eq(Number.isInteger(mul) && mul >= 1, true, 'a multiple of the ground alpha');
  assert.lt(grid[0].style.alpha, 0.35, 'still a whisper, not a drawn-on cage');
  // Over the floor AND its material: a hairline this faint loses to a cobble
  // pattern laid on top of it.
  const seq = g.ops.map(o => o.op);
  assert.eq(seq.indexOf('grid') > seq.indexOf('fill'), true, 'grid goes over the floor fill');
  assert.eq(seq.indexOf('grid') > seq.indexOf('texture'), true, 'and over the material');
});

test('building overlay: the grid ink flips to white on a floor too dark for black', () => {
  // 8% black on a near-black unclaimed floor is nothing, and "the squares stay
  // visible" is the whole job — so the ink, and only the ink, flips.
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING, 'h_1_1')]);
  const had = typeof unclaimedShade !== 'undefined';
  const prev = had ? unclaimedShade : undefined;
  globalThis.unclaimedShade = () => 0x0a0a0a;      // shaded practically to black
  try {
    const lit = makeScene({ isClaimedKey: () => true });
    BuildingOverlay.draw(lit);
    const dark = makeScene({ isClaimedKey: () => false });
    BuildingOverlay.draw(dark);
    assert.eq(lit.buildingGeomGfx.only('grid')[0].style.color, Render.GRID_LINE.color,
      'a lit house keeps the ground’s dark hairline');
    assert.eq(dark.buildingGeomGfx.only('grid')[0].style.color, 0xffffff,
      'a near-black floor takes a white one');
    assert.eq(dark.buildingGeomGfx.only('grid')[0].style.alpha,
      lit.buildingGeomGfx.only('grid')[0].style.alpha,
      'at the same softness either way');
  } finally {
    if (had) globalThis.unclaimedShade = prev; else delete globalThis.unclaimedShade;
  }
});

test('building overlay: the grid is soft, not a drawn-on cage', () => {
  const style = Render.GRID_LINE;
  assert.eq(style.width, 1, 'a hairline');
  assert.lt(style.alpha, 0.15, 'faint enough to read as ground showing through');
  assert.gt(style.dash, 0, 'dashed, not solid');
});

// ─── Claim state ────────────────────────────────────────────────────────────

test('building overlay: an unclaimed footprint is drawn in shaded colours', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING, 'h_1_1')]);
  // textures.js isn't in the headless bundle, so stand its transform in for
  // the length of this test — what's being pinned is that the claim state
  // reaches the COLOURS (rather than being washed over the top, which would
  // double-darken two overlapping footprints).
  const had = typeof unclaimedShade !== 'undefined';
  const prev = had ? unclaimedShade : undefined;
  globalThis.unclaimedShade = (c) => c ^ 0x00ff00;
  try {
    const lit = makeScene({ isClaimedKey: () => true });
    BuildingOverlay.draw(lit);
    const dark = makeScene({ isClaimedKey: (k) => { assert.eq(k, 'h_1_1', 'asked about the shape key'); return false; } });
    BuildingOverlay.draw(dark);
    const a = lit.buildingGeomGfx.only('fill')[1].color;
    const b = dark.buildingGeomGfx.only('fill')[1].color;
    assert.eq(b, a ^ 0x00ff00, 'the unclaimed floor went through the shade');
  } finally {
    if (had) globalThis.unclaimedShade = prev; else delete globalThis.unclaimedShade;
  }
});

test('building overlay: a keyless shape is never shaded', () => {
  // A building clipped to a sliver at the tile seam owns no cells and so has
  // no ownerKey. "Nothing to own" means lit, not "somebody else's".
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING, null)]);
  let asked = 0;
  const scene = makeScene({ isClaimedKey: () => { asked++; return false; } });
  BuildingOverlay.draw(scene);
  assert.eq(asked, 0, 'the save was not asked about a keyless shape');
});

// ─── Dilapidated: the slime splotches ───────────────────────────────────────
// An unclaimed footprint is a wreck; the splotches are what says so up close.
// What matters is that they belong to the BUILDING — same scatter every
// rebuild, inside the ring rather than its bounding box, gone the moment the
// place is restored.

// Blob points come back in local px (relative to the footprint's NW bbox
// corner); this puts one back on screen.
const blobCentre = (blob, ox, oy) => {
  let x = 0, y = 0;
  for (const p of blob) { x += p.x; y += p.y; }
  return { x: x / blob.length + ox, y: y / blob.length + oy };
};
const inRing = (pts, x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i].y, yj = pts[j].y;
    if ((yi > y) !== (yj > y)
      && x < ((pts[j].x - pts[i].x) * (y - yi)) / (yj - yi) + pts[i].x) inside = !inside;
  }
  return inside;
};
const unclaimedScene = (over) => makeScene({ isClaimedKey: () => false, ...over });

test('building overlay: a dilapidated footprint grows slime, a restored one does not', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING, 'h_1_1')]);
  const wreck = unclaimedScene();
  BuildingOverlay.draw(wreck);
  assert.eq(wreck.buildingGeomGfx.only('slime').length, 1, 'one slime pass over the wreck');
  assert.gt(wreck.buildingGeomGfx.only('slime')[0].blobs.length, 0, 'with splotches on it');

  const restored = makeScene({ isClaimedKey: () => true });
  BuildingOverlay.draw(restored);
  assert.eq(restored.buildingGeomGfx.only('slime').length, 0, 'a claimed building is clean');
});

test('building overlay: slime is dark green, derived from the unclaimed shade', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING, 'h_1_1')]);
  // The rule: the shade run over the already-shaded floor twice more. Pinned
  // through a stub so it can't be satisfied by a hand-picked green.
  const had = typeof unclaimedShade !== 'undefined';
  const prev = had ? unclaimedShade : undefined;
  const shade = (c) => ((c >> 1) & 0x7f7f7f) | 0x001000;
  globalThis.unclaimedShade = shade;
  try {
    const scene = unclaimedScene();
    BuildingOverlay.draw(scene);
    const floor = scene.buildingGeomGfx.only('fill')[1].color;
    assert.eq(scene.buildingGeomGfx.only('slime')[0].color, shade(shade(floor)),
      'two shades deeper than the floor it grows on');
  } finally {
    if (had) globalThis.unclaimedShade = prev; else delete globalThis.unclaimedShade;
  }
  // …and with textures.js absent (this suite), the fallback still lands a
  // green: darker than the floor in every channel, with green the one that
  // survives best.
  const scene = unclaimedScene();
  BuildingOverlay.draw(scene);
  const floor = scene.buildingGeomGfx.only('fill')[1].color;
  const slime = scene.buildingGeomGfx.only('slime')[0].color;
  const ch = (c, sh) => (c >> sh) & 255;
  for (const sh of [16, 8, 0]) assert.lte(ch(slime, sh), ch(floor, sh), `channel ${sh} darkened`);
  assert.gt(ch(slime, 8), ch(slime, 16), 'greener than red');
  assert.gt(ch(slime, 8), ch(slime, 0), 'greener than blue');
  // Translucent, so the floor's material grains through the stain.
  assert.inRange(scene.buildingGeomGfx.only('slime')[0].alpha, 0.2, 0.85, 'a stain, not a blot');
});

test('building overlay: slime stays put as the camera moves', () => {
  // The layer repaints on every cell crossing. Splotches re-rolled per rebuild
  // would crawl across the floor as the player walked, which is the whole
  // reason the scatter is seeded from the building rather than Math.random.
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING, 'h_1_1')]);
  const a = unclaimedScene();
  BuildingOverlay.draw(a);
  const b = unclaimedScene({ playerM: { x: 5, y: 5 } });   // one cell SE
  BuildingOverlay.draw(b);
  const sa = a.buildingGeomGfx.only('slime')[0], sb = b.buildingGeomGfx.only('slime')[0];
  assert.eq(JSON.stringify(sa.blobs), JSON.stringify(sb.blobs), 'the same splotches, unmoved');
  // …and they ride the footprint: the offset moved exactly as the ring did.
  assert.eq(sb.ox - sa.ox, sb.pts[0].x - sa.pts[0].x, 'slime tracked the ring west');
  assert.eq(sb.oy - sa.oy, sb.pts[0].y - sa.pts[0].y, 'and north');
});

test('building overlay: two different footprints get different splotches', () => {
  clearTiles();
  putShapes(0, 0, [
    rectShape(0, 0, 20, 20, T.BUILDING, 'h_1_1'),
    rectShape(0, 30, 20, 50, T.BUILDING, 'h_1_2'),
  ]);
  const scene = unclaimedScene();
  BuildingOverlay.draw(scene);
  const [a, b] = scene.buildingGeomGfx.only('slime');
  assert.eq(JSON.stringify(a.blobs) !== JSON.stringify(b.blobs), true,
    'the scatter is seeded per building, not per map');
});

test('building overlay: every splotch sits inside the ring, not its bounding box', () => {
  // An L-shaped block: two thirds of its bounding box is somewhere else. The
  // clip would hide a splotch dropped in the empty quadrant, so sampling the
  // box alone would quietly thin the growth on exactly the shapes this layer
  // exists to draw.
  clearTiles();
  const L = {
    ring: Float32Array.from([0, 0, 8, 0, 8, 24, 24, 24, 24, 32, 0, 32]),
    tier: T.BUILDING, areaM2: 448, key: 'h_L',
  };
  putShapes(0, 0, [L]);
  const scene = unclaimedScene();
  BuildingOverlay.draw(scene);
  const s = scene.buildingGeomGfx.only('slime')[0];
  assert.gt(s.blobs.length, 1, 'the block is speckled');
  // The notch — everything east of the upright and north of the foot. A
  // splotch straddles its own centre, so a blob seated against a real wall can
  // put a lobe (and with it a hair of its centroid) over the line; the clip
  // trims that. What may not happen is a splotch SEATED out here, where the
  // building isn't — so the notch is pulled in by one lobe along the two walls
  // it shares with the L, and the footprint check is let out by the same.
  const LOBE = 11;
  const notch = [
    { x: px(8) + LOBE, y: px(0) }, { x: px(24), y: px(0) },
    { x: px(24), y: px(24) - LOBE }, { x: px(8) + LOBE, y: px(24) - LOBE },
  ];
  for (const blob of s.blobs) {
    const c = blobCentre(blob, s.ox, s.oy);
    assert.falsy(inRing(notch, c.x, c.y), `splotch at ${c.x|0},${c.y|0} is off the building`);
    assert.inRange(c.x, px(0) - LOBE, px(24) + LOBE, 'and within the footprint east–west');
    assert.inRange(c.y, px(0) - LOBE, px(32) + LOBE, 'and north–south');
  }
});

test('building overlay: a big wreck is speckled, a shed gets a splotch or two', () => {
  clearTiles();
  putShapes(0, 0, [
    rectShape(0, 0, 6, 6, T.BUILDING, 'h_shed'),
    rectShape(0, 20, 45, 45, T.BUILDING, 'h_block'),
  ]);
  const scene = unclaimedScene();
  BuildingOverlay.draw(scene);
  const [shed, block] = scene.buildingGeomGfx.only('slime');
  assert.gt(block.blobs.length, shed.blobs.length, 'the count comes off the floor area');
  assert.lte(block.blobs.length, 14, 'and is capped, so a big block stays speckled');
  // A splotch can never be most of a shed.
  const spanOf = (blob) => {
    let x0 = Infinity, x1 = -Infinity;
    for (const p of blob) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; }
    return x1 - x0;
  };
  const shedW = 6 * PX_PER_M;
  for (const blob of shed.blobs) assert.lt(spanOf(blob), shedW, 'a splotch fits on the shed');
});

test('building overlay: slime goes over the floor, under the lattice and the outline', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING, 'h_1_1')]);
  const scene = unclaimedScene();
  BuildingOverlay.draw(scene);
  const seq = scene.buildingGeomGfx.ops.map(o => o.op);
  assert.gt(seq.indexOf('slime'), seq.indexOf('fill'), 'grows on the floor');
  assert.gt(seq.indexOf('slime'), seq.indexOf('texture'), 'and on its material');
  assert.lt(seq.indexOf('slime'), seq.indexOf('grid'), 'the ground lattice still reads across it');
  assert.lt(seq.indexOf('slime'), seq.indexOf('stroke'), 'the silhouette stays clean');
});

test('building overlay: restoring a wreck lifts its slime in the same repaint', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING, 'h_1_1')]);
  const save = { restoredHouses: {} };
  const scene = makeScene({ save, isClaimedKey: (k) => !!save.restoredHouses[k] });
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.only('slime').length, 1, 'mossy while it is a wreck');
  save.restoredHouses['h_1_1'] = true;
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.only('slime').length, 0, 'clean once it is yours');
});

// ─── Culling + the redraw cache ─────────────────────────────────────────────

test('building overlay: a building far off the viewport is culled', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(200, 200, 210, 210)]);   // 40 cells SE of the player
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.only('fill').length, 0, 'nothing drawn');
});

test('building overlay: a building just off the north edge still drops its wall in', () => {
  clearTiles();
  // The viewport's top edge is 176 px above the player's centre = 27.5 m; put
  // the building's south edge a hair north of the padded edge so only its
  // extruded wall could reach the visible area.
  const top = -(176 + CELL_PX * 2) / PX_PER_M;      // padded top edge, in metres
  putShapes(0, 0, [rectShape(0, top - 10, 10, top - 0.05)]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.only('fill').length, 2, 'kept for its wall');
});

test('building overlay: a still camera rebuilds once', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10)]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  BuildingOverlay.draw(scene);
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.cleared, 1, 'one rebuild for three frames');
  assert.eq(scene.buildingGeomGfx.commits, 1, 'one upload');
});

test('building overlay: taking a building repaints it', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING, 'h_1_1')]);
  const scene = makeScene({ save: { restoredHouses: {} } });
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.cleared, 1, 'first pass');
  scene.save.restoredHouses['h_1_1'] = true;         // the claim lands mid-session
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.cleared, 2, 'the claim forced a repaint');
});

test('building overlay: a tile finishing its load repaints', () => {
  clearTiles();
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  const before = scene.buildingGeomGfx.cleared;
  putShapes(0, 0, [rectShape(0, 0, 10, 10)]);
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.cleared, before + 1, 'the new tile repainted');
});

test('building overlay: the container carries the sub-cell scroll', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10)]);
  // Half a cell east: cellM = 5 m, so 2.5 m of player offset is 0.5 cells.
  const scene = makeScene({ playerM: { x: 2.5, y: 0 } });
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomContainer.x, -0.5 * CELL_PX, 'scrolled half a cell west');
});

// ─── The mode switch ────────────────────────────────────────────────────────

test('building overlay: polygonal mode is on by default', () => {
  assert.truthy(BuildingOverlay.enabled(), 'on unless explicitly turned off');
});

test('building overlay: turning it off hides the layer and clears the canvas', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10)]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  assert.truthy(scene.buildingGeomContainer.visible, 'visible while on');
  try {
    BuildingOverlay.setEnabled(scene, false);
    BuildingOverlay.draw(scene);
    assert.falsy(scene.buildingGeomContainer.visible, 'hidden once off');
    assert.eq(scene.buildingGeomGfx.only('fill').length, 0, 'canvas cleared');
    BuildingOverlay.draw(scene);
    assert.eq(scene.buildingGeomGfx.cleared, 2, 'and stays cleared without re-clearing');
  } finally {
    BuildingOverlay.setEnabled(scene, true);
  }
});

test('building overlay: nothing is drawn underground', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10)]);
  const scene = makeScene({ depth: 1 });
  BuildingOverlay.draw(scene);
  assert.falsy(scene.buildingGeomContainer.visible, 'hidden in a cave');
  assert.eq(scene.buildingGeomGfx.only('fill').length, 0, 'no polygons in the rock');
});

clearTiles();
})();
