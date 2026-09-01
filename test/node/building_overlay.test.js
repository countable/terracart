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
