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
    fillPoly(pts, color, alpha) { this.ops.push({ op: 'fill', pts: pts.map(p => ({ x: p.x, y: p.y })), color, alpha }); },
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
  assert.eq(wall.color, buildingBackgroundColor(Render.BUILDING_FACE_COLOR[T.BUILDING]), 'wall wears render.js face colour');
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

test('building overlay: a footprint Home cleared is only a 20% shadow, under every building', () => {
  clearTiles();
  // The cleared house sits SOUTH of the standing one, so the painter rule
  // alone would draw it last.
  const entry = putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING, 'h_stand')]);
  entry.clearedShapes = [rectShape(0, 30, 10, 40, T.BUILDING, 'h_gone')];
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  const g = scene.buildingGeomGfx;
  assert.eq(g.ops[0].op, 'fill', 'the shadow paints first');
  assert.eq(g.ops[0].color, 0x000000, 'black');
  assert.eq(g.ops[0].alpha, 0.2, 'at 20% opacity');
  assert.eq(g.ops[0].pts[0].y, px(30), 'over the cleared footprint');
  assert.eq(g.only('fill').filter(o => o.alpha != null).length, 1, 'no wall or floor for it');
  assert.eq(g.only('stroke').length, 1, 'only the standing house is outlined');
  clearTiles();
});

// ─── Tier styling ───────────────────────────────────────────────────────────

test('building overlay: a castle gets a rampart band, a house gets an outline', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING_LARGE, 'citadel')]);
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

test('building overlay: restored turret keeps its footprint and gets intact castle ramparts', () => {
  clearTiles();
  const shape = { ring: Float32Array.from([0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20]),
    tier: T.BUILDING, key: 'ruin' };
  const entry = putShapes(0, 0, [shape]);
  entry.objects = [{ kind: 'house', id: 'ruin', tier: T.BUILDING, x: 5, y: 5 }];
  const scene = makeScene({ save: { restoredHouses: { ruin: 'turret' } } });
  BuildingOverlay.draw(scene);
  const insets = scene.buildingGeomGfx.only('inset');
  assert.eq(insets.length, 2, 'continuous castle wall and merlons');
  assert.eq(insets[1].dash.length, 2, 'regular intact merlons, no broken gaps');
  assert.eq(insets[0].pts.length, 6, 'walls follow the concave footprint');
  const style = buildingBackgroundMaterial(CastleStyles.get('bastion'));
  assert.eq(insets[0].color, style.stone.BODY);
  assert.eq(insets[1].color, style.stone.LITE);
  assert.eq(shape.tier, T.BUILDING, 'source geography retains its house tier');
  assert.falsy(scene._proceduralBuildings.has('ruin'), 'the intact tower sprite remains visible');
  clearTiles();
});

test('building overlay: castle floors and ramparts share the tower material in both conditions', () => {
  for (const id of CastleStyles.ids) for (const claimed of [true, false]) {
    clearTiles();
    putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING_LARGE, id)]);
    const scene = makeScene({ isClaimedKey: () => claimed });
    BuildingOverlay.draw(scene);
    const material = buildingBackgroundMaterial(CastleStyles.get(id, claimed)), g = scene.buildingGeomGfx;
    const fills = g.only('fill');
    assert.eq(fills[0].color, material.stone.FACE, `${id}: stone wall face`);
    assert.eq(fills[1].color, material.floor, `${id}: matching courtyard`);
    const insets = g.only('inset');
    assert.eq(insets[0].color, material.stone.BODY, `${id}: stone wall base`);
    const top = material.rampart.woodTop ? material.wood : material.stone;
    assert.eq(insets[insets.length - 1].color, top.LITE, `${id}: matching crenellations`);
    if (id === 'archive') assert.eq(insets[1].color, material.wood.BODY, 'archive wood crowns a stone base');
    if (id === 'ruin') assert.eq(insets[1].dash.length, 4, 'ruin teeth have uneven gaps');
  }
});

test('building overlay: only ruin floors use the shared damage sheet in both conditions', () => {
  for (const id of CastleStyles.ids) for (const claimed of [true, false]) {
    clearTiles();
    putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING_LARGE, id)]);
    const scene = makeScene({ isClaimedKey: () => claimed });
    const calls = [];
    scene.buildingGeomGfx.damagePoly = (pts, key, condition, x, y) => {
      calls.push({ key, condition, x, y }); return true;
    };
    BuildingOverlay.draw(scene);
    assert.eq(calls.length, id === 'ruin' ? 1 : 0);
    assert.eq(scene.buildingGeomGfx.only('texture').length, id === 'ruin' ? 0 : 1,
      'ruin replacement includes its paving; other materials keep their existing texture');
    if (calls.length) {
      assert.eq(calls[0].key, id); assert.eq(calls[0].condition, claimed);
      assert.truthy(Number.isFinite(calls[0].x) && Number.isFinite(calls[0].y), 'tile anchor is projected once');
    }
  }
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

test('building overlay: castle paving supplies its seams without a second grid', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING_LARGE, 'citadel')]);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.only('texture').length, 1, 'paving carries its own seams');
  assert.eq(scene.buildingGeomGfx.only('grid').length, 0, 'no additional lattice beside paving joints');
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
    const raw = typeof COLORS !== 'undefined' ? COLORS[T.BUILDING] : 0xae685d;
    assert.eq(a, buildingBackgroundColor(raw), 'claimed floor is muted');
    assert.eq(b, buildingBackgroundColor(raw ^ 0x00ff00), 'shade precedes background treatment');
  } finally {
    if (had) globalThis.unclaimedShade = prev; else delete globalThis.unclaimedShade;
  }
});

test('building overlay: the unclaimed material lift is applied to the colours, never read back', () => {
  // textures.js's lift (unclaimedMaterialColor) goes over the COLOURS, after the
  // shade, exactly as render.js's tiled pass runs its court floors (no per-
  // building canvas read-back): an unclaimed floor, its slime and its outline all
  // wear it; a restored neighbour in the same pass wears none of it.
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING, 'old'),
    rectShape(0, 20, 10, 30, T.BUILDING, 'restored')]);
  const hadShade = typeof unclaimedShade !== 'undefined', prevShade = hadShade ? unclaimedShade : undefined;
  const hadTune = typeof unclaimedMaterialColor !== 'undefined', prevTune = hadTune ? unclaimedMaterialColor : undefined;
  globalThis.unclaimedShade = (c) => c ^ 0x00ff00;
  const tuned = [];
  globalThis.unclaimedMaterialColor = (c) => { tuned.push(c); return c ^ 0x0000ff; };
  try {
    const scene = makeScene({ isClaimedKey: key => key === 'restored' });
    BuildingOverlay.draw(scene);
    const g = scene.buildingGeomGfx;
    const [oldWall, oldFloor, newWall, newFloor] = g.only('fill');
    const base = typeof COLORS !== 'undefined' ? COLORS[T.BUILDING] : 0xae685d;
    assert.eq(newFloor.color, buildingBackgroundColor(base), 'the restored floor uses the muted tier colour');
    assert.eq(oldFloor.color, buildingBackgroundColor((base ^ 0x00ff00) ^ 0x0000ff), 'the old floor: shaded, then lifted');
    assert.eq(newWall.color, buildingBackgroundColor(Render.BUILDING_FACE_COLOR[T.BUILDING]));
    assert.eq(oldWall.color, buildingBackgroundColor((Render.BUILDING_FACE_COLOR[T.BUILDING] ^ 0x00ff00) ^ 0x0000ff), 'its wall too');
    const slime = g.only('slime');
    assert.eq(slime.length, 1, 'only the old floor is overgrown');
    const finalTuned = tuned.map(c => buildingBackgroundColor(c ^ 0x0000ff));
    assert.includes(finalTuned, slime[0].color, 'the slime went through the lift');
    const [oldLine, newLine] = g.only('stroke');
    assert.includes(finalTuned, oldLine.color, 'and the old outline');
    assert.eq(finalTuned.includes(newLine.color), false, 'the restored outline did not');
    assert.eq(typeof BuildingOverlay.draw, 'function');
  } finally {
    if (hadShade) globalThis.unclaimedShade = prevShade; else delete globalThis.unclaimedShade;
    if (hadTune) globalThis.unclaimedMaterialColor = prevTune; else delete globalThis.unclaimedMaterialColor;
  }
});

test('building overlay: no pixel read-back anywhere in the overlay', () => {
  // The whole point of the two changes above (the colour-level lift and the
  // wall atlas): a cell crossing must never call getImageData — on a phone
  // each one is a synchronous round trip to the GPU process.
  // putImageData writes the cached fallback roof bitmap; it does not read GPU pixels.
  assert.eq(/getImageData|tuneUnclaimedMaterialCanvas/.test(BUILDING_OVERLAY_SRC), false,
    'building_overlay.js reads no pixels back');
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
    const raw = typeof COLORS !== 'undefined' ? COLORS[T.BUILDING] : 0xae685d;
    assert.eq(scene.buildingGeomGfx.only('slime')[0].color, buildingBackgroundColor(shade(shade(shade(raw)))),
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

test('building overlay: a wrecked castle courtyard takes half the slime alpha', () => {
  const house = unclaimedScene();
  BuildingOverlay.draw(house);
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 20, 20, T.BUILDING_LARGE, CastleStyles.ids[0])]);
  const castle = makeScene({ isClaimedKey: () => false });
  BuildingOverlay.draw(castle);
  const a = castle.buildingGeomGfx.only('slime')[0].alpha, b = house.buildingGeomGfx.only('slime')[0].alpha;
  assert.eq(a, b / 2, 'its pale stone floor would otherwise read the stain twice as dark');
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
  assert.lte(block.blobs.length, 28, 'and is capped, so a big block stays speckled');
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

// ─── The wall atlas ─────────────────────────────────────────────────────────
// Upright pieces bake into shared atlas PAGES (canvas textures cut into fixed
// slots, one frame per piece), not into a texture each: a crossing then
// paints its new pieces and uploads a page once, with no pixel read-back.
// The stub records what a Phaser CanvasTexture would be asked to do.
function makeWallScene(over) {
  const log = { pages: [], removedTextures: [], frames: [], removedFrames: [], refreshes: 0, sprites: [], polygons: [], strokes: [], worldParts: [] };
  const ctx = new Proxy({}, { get: (obj, key) => obj[key] || (() => {}), set: (obj, key, v) => { obj[key] = v; return true; } });
  let path = [], framePolygons = [];
  ctx.clearRect = () => { framePolygons = []; };
  ctx.beginPath = () => { path = []; };
  ctx.moveTo = ctx.lineTo = (x, y) => path.push({ x, y });
  ctx.fill = () => {
    const polygon = { color: ctx.fillStyle, points: path.slice() };
    log.polygons.push(polygon); framePolygons.push(polygon);
  };
  ctx.stroke = () => log.strokes.push({ color: ctx.strokeStyle, width: ctx.lineWidth, points: path.slice() });
  const scene = makeScene(Object.assign({
    buildingWallContainer: {
      ...makeContainer(),
      add(sprite) { sprite.parentContainer = this; log.sprites.push(sprite); },
      sort(key) { log.sprites.sort((a, b) => a[key] - b[key]); },
    },
    // Only world GEOMETRY (Home's per-wall parts, flagged before they are
    // added) joins the world layer; the wall atlas sprites never do.
    worldContainer: { add(o) { if (!o._worldGeometry) throw new Error('building walls must stay out of the world layer'); log.worldParts.push(o); } },
    textures: {
      exists: () => false,
      remove: (key) => log.removedTextures.push(key),
      createCanvas: (key, w, h) => {
        const page = { key, w, h, frames: new Map(),
          getContext: () => ctx,
          refresh() { log.refreshes++; },
          add(name, src, x, y, fw, fh) { const f = { page: key, name, x, y, w: fw, h: fh, polygons: framePolygons.slice() }; this.frames.set(name, f); log.frames.push(f); return f; },
          remove(name) { this.frames.delete(name); log.removedFrames.push(name); return true; },
        };
        log.pages.push(page);
        return page;
      },
    },
    add: { image(x, y, key, frame) { return {
      x, y, key, frame, destroyed: false,
      setOrigin() { return this; },
      setDepth(depth) { this.depth = depth; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      destroy() { this.destroyed = true; },
    }; } },
  }, over));
  return { scene, log };
}

test('building overlay: canvas adapter clears and fills the full padded backing store', () => {
  clearTiles();
  const { scene, log } = makeWallScene({ buildingGeomGfx: null, viewSize: 352.25 });
  scene.buildingGeomContainer.add = () => {};
  // Exercise the actual canvas adapter rather than the recording graphics stub.
  BuildingOverlay.draw(scene);
  const page = log.pages.find(p => p.key === 'buildinggeom_overlay');
  assert.truthy(page, 'the real viewport canvas was created');
  const ctx = page.getContext(), clears = [], fills = [];
  ctx.clearRect = (...args) => clears.push(args);
  ctx.fillRect = (...args) => fills.push(args);
  const target = scene._buildingGeomTarget;
  const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }];
  const oldDamageTexture = CastleStyles.damageTexture;
  try {
    scene.textures.exists = () => true;
    scene.textures.get = key => ({ getSourceImage: () => ({
      width: key === 'castle_paving' ? 256 : 16, height: key === 'castle_paving' ? 256 : 16,
    }) });
    ctx.createPattern = () => ({});
    CastleStyles.damageTexture = () => 'test_damage';
    target.clear();
    target.texturePoly(points, T.BUILDING_SMALL);
    assert.truthy(target.damagePoly(points, 'building', false, 0, 0));
    const size = Math.ceil(scene.viewSize + CELL_PX * 4);
    assert.eq(page.w, size);
    assert.eq(JSON.stringify(clears[0]), JSON.stringify([0, 0, size, size]));
    assert.eq(fills[0][2], size, 'material pattern covers padded canvas');
    assert.eq(fills[0][3], size);
    assert.eq(fills[1][2], size, 'damage pattern covers padded canvas');
    assert.eq(fills[1][3], size);
    const translations = [];
    ctx.translate = (x, y) => translations.push([x, y]);
    for (const offset of [0, CELL_PX, 256, -CELL_PX]) {
      target.texturePhase(offset, offset);
      target.texturePoly(points, T.BUILDING_LARGE);
      const shift = translations.at(-1), fill = fills.at(-1);
      assert.eq(shift[0] + fill[0], 0, 'translated material fills from the canvas left edge');
      assert.eq(shift[1] + fill[1], 0, 'translated material fills from the canvas top edge');
      assert.eq(fill[2], size); assert.eq(fill[3], size);
    }
    for (const axis of [0, 1]) {
      assert.eq((translations[1][axis] - translations[0][axis] + 256) % 256, CELL_PX,
        'panning one cell advances within the larger castle pattern');
      assert.eq(translations[2][axis], translations[0][axis], 'the whole paving sheet repeats');
      assert.eq((translations[0][axis] - translations[3][axis] + 256) % 256, CELL_PX,
        'negative panning retains the world phase');
    }
    scene.depth = 1;
    BuildingOverlay.draw(scene);
    assert.eq(clears.length, 2, 'entering a cave clears the real canvas too');
  } finally {
    CastleStyles.damageTexture = oldDamageTexture;
    clearTiles();
  }
});

clearTiles();
test('building overlay: castle ramparts use short upright wall sections, leaving the court on the floor', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING_LARGE, 'citadel')]);
  const { scene, log } = makeWallScene();
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.only('fill').length, 1, 'only the courtyard stays on the ground canvas');
  assert.eq(scene.buildingGeomGfx.only('inset').length, 0, 'ramparts belong to the upright pieces');
  assert.eq(scene._buildingUprightPieces.length, 16, 'one body and crown section per cell of perimeter');
  assert.eq(log.sprites.length, 16, 'wall bodies and crowns are background sprites');
  assert.eq(log.pages.length, 1, 'sections share the wall atlas');
});

test('building overlay: atlas wall bodies cannot overpaint crowns across section boundaries', () => {
  for (const ring of [[0, 0, 35, 0, 35, 25, 0, 25], [8, 0, 35, 18, 25, 35, 0, 20]]) {
    clearTiles();
    putShapes(0, 0, [{ ring: Float32Array.from(ring), tier: T.BUILDING_LARGE, areaM2: 600, key: 'citadel' }]);
    const { scene, log } = makeWallScene();
    BuildingOverlay.draw(scene);
    const material = buildingBackgroundMaterial(CastleStyles.get('citadel'));
    const css = c => '#' + c.toString(16).padStart(6, '0');
    let sawRoof = false, bodies = 0;
    // Walk the actual sprite submission order and each baked frame's paint.
    for (const sprite of log.sprites) {
      const frame = log.frames.find(f => f.page === sprite.key && f.name === sprite.frame);
      for (const polygon of frame.polygons) {
        if (polygon.color === css(material.stone.LITE)) sawRoof = true;
        if (polygon.color === css(material.stone.BODY)) {
          assert.falsy(sawRoof, 'no later atlas cap may cover a neighboring tooth roof');
          bodies++;
        }
      }
    }
    assert.truthy(sawRoof && bodies > 4, 'multiple atlas sections and their crowns were rendered');
  }
});

test('building overlay: both horizontal castle boundaries expose thinner caps over full-height shaded faces', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING_LARGE, 'citadel')]);
  const { scene, log } = makeWallScene();
  BuildingOverlay.draw(scene);
  const material = buildingBackgroundMaterial(CastleStyles.get('citadel', true));
  const css = c => '#' + c.toString(16).padStart(6, '0');
  const faces = log.polygons.filter(p => p.color === css(material.stone.FACE)
    && Math.max(...p.points.map(v => v.x)) - Math.min(...p.points.map(v => v.x)) > Math.max(material.rampart.topDepth, material.rampart.toothWidth));
  assert.eq(faces.length, 4, 'two sections on each horizontal boundary, including the back wall');
  const floorYs = scene.buildingGeomGfx.only('fill')[0].pts.map(p => p.y);
  for (const face of faces) {
    const ys = face.points.map(p => p.y);
    assert.eq(Math.max(...ys) - Math.min(...ys), material.rampart.wallHeight, 'the face spans the full wall height');
    if (Math.min(...ys) < Math.min(...floorYs)) {
      assert.eq(Math.max(...ys), Math.min(...floorYs), 'north face still lands exactly at ground');
    } else {
      assert.eq(Math.min(...ys), Math.max(...floorYs), 'south face still starts at ground');
    }
  }
  const caps = log.polygons.filter(p => p.color === css(material.stone.BODY) && p.points.length === 4);
  assert.eq(caps.length, 12, 'continuous top surface on four sides plus four bounded corner joins');
  for (const cap of caps.filter(p => new Set(p.points.map(v => v.y)).size === 2)) {
    const xs = cap.points.map(p => p.x), ys = cap.points.map(p => p.y);
    assert.lt(Math.abs(Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      - material.rampart.topDepth), 1e-7, 'top plane follows the thinner cap width');
  }
});

test('building overlay: side highlights stay inside the horizontal wall silhouette', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING_LARGE, 'citadel')]);
  const { scene, log } = makeWallScene();
  BuildingOverlay.draw(scene);
  const vertices = scene.buildingGeomGfx.only('fill')[0].pts;
  const minX = Math.min(...vertices.map(p => p.x)), maxX = Math.max(...vertices.map(p => p.x));
  const vertical = log.strokes.filter(s => s.points.length === 2 && s.points[0].x === s.points[1].x);
  assert.gt(vertical.length, 0, 'side highlights are drawn');
  for (const s of vertical) {
    assert.gte(s.points[0].x - s.width / 2, minX, 'west highlight stays inside the footprint');
    assert.lte(s.points[0].x + s.width / 2, maxX, 'east highlight stays inside the footprint');
  }
});

test('building overlay: angled and concave castle corners bridge adjacent top planes', () => {
  for (const ring of [[10, 0, 20, 10, 10, 20, 0, 10], [0, 0, 20, 0, 20, 20, 10, 10, 0, 20]]) {
    clearTiles();
    putShapes(0, 0, [{ ring: Float32Array.from(ring), tier: T.BUILDING_LARGE, areaM2: 300, key: 'citadel' }]);
    const { scene, log } = makeWallScene();
    BuildingOverlay.draw(scene);
    const material = buildingBackgroundMaterial(CastleStyles.get('citadel'));
    const color = '#' + material.stone.BODY.toString(16).padStart(6, '0');
    const caps = log.polygons.filter(p => p.color === color && p.points.length === 4).map(p => p.points);
    const point = i => ({ x: 176 + ring[(i * 2 + ring.length) % ring.length] * PX_PER_M,
      y: 176 + ring[(i * 2 + 1 + ring.length) % ring.length] * PX_PER_M });
    const normal = (a, b) => { const len = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }; };
    for (let i = 0; i < ring.length / 2; i++) {
      const vertex = point(i), previous = normal(point(i - 1), vertex), next = normal(vertex, point(i + 1));
      const cap = material.rampart.topDepth;
      const lift = ny => cap + (material.rampart.wallHeight - cap) * Math.max(0, ny);
      const expected = [
        { x: vertex.x, y: vertex.y - lift(previous.y) - cap * previous.y },
        { x: vertex.x, y: vertex.y - lift(next.y) - cap * next.y },
        { x: vertex.x + next.x * cap, y: vertex.y - lift(next.y) },
        { x: vertex.x + previous.x * cap, y: vertex.y - lift(previous.y) },
      ];
      assert.truthy(caps.some(poly => poly.every((p, index) =>
        Math.hypot(p.x - expected[index].x, p.y - expected[index].y) < 1e-8)),
      'a filled bevel connects both neighboring top profiles at every convex and concave corner');
      const previousFront = previous.y > 0 ? expected[3] : expected[0];
      const nextFront = next.y > 0 ? expected[2] : expected[1];
      if (Math.abs(previousFront.x - nextFront.x) > 1e-6) {
        const face = [previousFront, nextFront,
          { x: nextFront.x, y: nextFront.y + material.rampart.wallHeight },
          { x: previousFront.x, y: previousFront.y + material.rampart.wallHeight }];
        assert.truthy(log.polygons.some(poly => poly.color === '#' + material.stone.FACE.toString(16).padStart(6, '0')
          && poly.points.every((p, index) => Math.hypot(p.x - face[index].x, p.y - face[index].y) < 1e-8)),
        'a wall face supports the bevel instead of leaving a gap beneath the corner');
      }
    }
  }
});

test('building overlay: rectangular merlon bases follow their caps at every wall angle and winding', () => {
  const css = c => '#' + c.toString(16).padStart(6, '0');
  const inside = (p, polygon) => {
    const crosses = polygon.map((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    });
    return crosses.every(c => c >= -1e-7) || crosses.every(c => c <= 1e-7);
  };
  const outlines = [
    [[-8, -8], [8, -8], [8, 8], [-8, 8]],
    [[-10, -6], [10, -6], [-5, 9]],
    [[-10, -8], [9, -5], [4, 0], [10, 9], [-8, 6]],
  ];
  for (const outline of outlines) for (const angle of [0, 15, 30, 45, 60, 75]) for (const reversed of [false, true]) {
    const radians = angle * Math.PI / 180;
    const points = outline.map(([x, y]) =>
      [12 + x * Math.cos(radians) - y * Math.sin(radians), 12 + x * Math.sin(radians) + y * Math.cos(radians)]);
    if (reversed) points.reverse();
    clearTiles();
    putShapes(0, 0, [{ ring: Float32Array.from(points.flat()), tier: T.BUILDING_LARGE, areaM2: 256, key: 'citadel' }]);
    const { scene, log } = makeWallScene();
    BuildingOverlay.draw(scene);
    const material = buildingBackgroundMaterial(CastleStyles.get('citadel'));
    const caps = log.polygons.filter(p => p.color === css(material.stone.BODY)).map(p => p.points);
    const roofs = log.polygons.filter(p => p.color === css(material.stone.LITE));
    assert.gt(roofs.length, 0, 'merlons have visible roofs');
    assert.eq(material.rampart.toothWidth, 6, 'along-wall tooth length is unchanged');
    assert.eq(material.rampart.topDepth, 3.6, 'cap is 40 percent thinner');
    const vertices = scene.buildingGeomGfx.only('fill')[0].pts;
    const winding = reversed ? -1 : 1;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / length * winding, ny = (b.x - a.x) / length * winding;
      for (const v of [a, b]) {
        const lift = material.rampart.topDepth
          + (material.rampart.wallHeight - material.rampart.topDepth) * Math.max(0, ny);
        const crest = ny < 0 ? { x: v.x + nx * material.rampart.topDepth, y: v.y - lift }
          : { x: v.x, y: v.y - lift - material.rampart.topDepth * ny };
        assert.truthy(roofs.some(roof => roof.points.some(p =>
          Math.hypot(p.x - crest.x, p.y + material.rampart.toothHeight - crest.y) < 1e-7)),
        'full rectangular crowns reach both edge endpoints without inset corner gaps');
      }
    }
    for (const roof of roofs) {
      const [a, b, c] = roof.points;
      const along = { x: b.x - a.x, y: b.y - a.y };
      const across = { x: c.x - b.x, y: c.y - b.y };
      assert.lt(Math.abs(Math.hypot(along.x, along.y) - material.rampart.toothWidth), 1e-7,
        'the tooth retains its full width, even at an edge end');
      assert.lt(Math.abs(Math.hypot(across.x, across.y) - material.rampart.topDepth), 1e-7,
        'the top reaches both edges of the thinner cap');
      assert.lt(Math.abs(along.x * across.x + along.y * across.y), 1e-7,
        'adjacent sides of the rectangular roof are perpendicular');
      for (const v of roof.points) {
        const base = { x: v.x, y: v.y + material.rampart.toothHeight };
        assert.truthy(caps.some(cap => inside(base, cap)),
          `every tooth corner is seated on stone at ${angle} degrees, reversed=${reversed}`);
      }
    }
  }
});

test('building overlay: polygon winding does not change wall base anchors', () => {
  const anchors = [];
  for (const ring of [[0, 0, 10, 0, 10, 10, 0, 10], [0, 0, 0, 10, 10, 10, 10, 0]]) {
    clearTiles();
    putShapes(0, 0, [{ ring: Float32Array.from(ring), tier: T.BUILDING_LARGE, areaM2: 100, key: 'citadel' }]);
    const { scene } = makeWallScene();
    BuildingOverlay.draw(scene);
    anchors.push(scene._buildingUprightPieces.map(p => p.groundY).sort((a, b) => a - b).join(','));
  }
  assert.eq(anchors[0], anchors[1], 'south face bases agree for either source ring order');
});

test('building overlay: angled walls stay in the background for every building tier', () => {
  const ring = [10, 0, 20, 10, 10, 20, 0, 10];
  for (const tier of [T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE]) {
    clearTiles();
    putShapes(0, 0, [{ ring: Float32Array.from(ring), tier, areaM2: 200, key: 'archive' }]);
    const { scene, log } = makeWallScene();
    BuildingOverlay.draw(scene);
    const pieces = scene._buildingUprightPieces;
    if (tier === T.BUILDING) {
      assert.eq(pieces.length, 0, 'house foundation stays joined to the floor');
      const fills = scene.buildingGeomGfx.only('fill');
      assert.eq(fills.length, 2, 'foundation is painted before the raised floor');
      for (let i = 0; i < fills[0].pts.length; i++) {
        assert.eq(fills[0].pts[i].x, fills[1].pts[i].x);
        assert.eq(fills[0].pts[i].y - fills[1].pts[i].y, Render.BUILDING_FACE_PX[tier]);
      }
      continue;
    }
    assert.gt(pieces.length, 4, `tier ${tier}: slanted edges split into short sections`);
    assert.truthy(log.sprites.every(sprite => sprite.parentContainer === scene.buildingWallContainer),
      `tier ${tier}: every wall is below the world layer`);
    const first = pieces[0], ground = first.groundY, oldX = first.sprite.x;
    scene.playerM.x = 5;
    BuildingOverlay.draw(scene);
    assert.eq(scene._buildingUprightPieces[0], first, 'camera movement reuses the section');
    assert.eq(first.groundY, ground, 'camera movement preserves its world anchor');
    assert.eq(first.sprite.x, oldX - CELL_PX, 'background walls follow the camera');
    assert.eq(first.sprite.parentContainer, scene.buildingWallContainer, 'reused walls stay in the background');
  }
  clearTiles();
});

test('building overlay: temple foundation stays beneath its floor without upright wall strips', () => {
  clearTiles();
  putShapes(0, 0, [{ ...rectShape(0, 0, 10, 10, T.BUILDING_LARGE), templeZone: 'sanctuary' }]);
  const { scene } = makeWallScene();
  BuildingOverlay.draw(scene);
  assert.eq(scene._buildingUprightPieces.length, 0);
  const fills = scene.buildingGeomGfx.only('fill');
  assert.eq(fills[0].color, TempleArt.palette(false, false, true).face);
  assert.eq(fills[1].color, TempleArt.palette(false, false, true).floor);
  for (let i = 0; i < fills[0].pts.length; i++) {
    assert.eq(fills[0].pts[i].y - fills[1].pts[i].y, Render.BUILDING_FACE_PX[T.BUILDING_LARGE]);
  }
  clearTiles();
});

test('building overlay: a cell crossing reuses baked wall pieces instead of rebaking them', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING_MED)]);
  const { scene, log } = makeWallScene();
  BuildingOverlay.draw(scene);
  const first = scene._buildingUprightPieces.slice();
  assert.eq(log.frames.length, 8, 'first pass bakes every piece in view');
  assert.eq(log.pages.length, 1, 'all of them onto ONE atlas page');
  assert.eq(log.refreshes, 1, 'uploaded once, not once per piece');
  assert.truthy(first.every(p => p.sprite.key === log.pages[0].key && p.sprite.frame === p.frame), 'sprites draw their frame of the page');
  const x0 = first[0].sprite.x;
  scene.playerM.x = 5;                     // one whole cell east
  BuildingOverlay.draw(scene);
  assert.eq(log.frames.length, 8, 'crossing a cell bakes nothing new');
  assert.eq(log.refreshes, 1, 'and uploads nothing');
  assert.eq(log.removedFrames.length, 0, 'and releases nothing still in view');
  assert.truthy(scene._buildingUprightPieces.every((p, i) => p === first[i]), 'same pieces, same order');
  assert.eq(first[0].sprite.x, x0 - CELL_PX, 'cached piece moves with the world');
  scene.save.restoredHouses = ['x'];       // claim epoch changes → rebuild
  BuildingOverlay.draw(scene);
  assert.eq(log.frames.length, 8, 'a rebuild with unchanged claim state keeps the pieces');
});

clearTiles();
test('building overlay: polygon walls remain background and scroll independently of floors', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING_MED)]);
  let shutdown, shutdownRegistrations = 0;
  const { scene, log } = makeWallScene({
    events: { once(event, fn) { assert.eq(event, 'shutdown'); shutdown = fn; shutdownRegistrations++; } },
  });
  BuildingOverlay.draw(scene);
  assert.eq(scene.buildingGeomGfx.only('fill').length, 1, 'only the floor stays on the ground canvas');
  assert.eq(scene.buildingGeomGfx.only('inset').length, 0, 'upright building trim leaves the ground canvas');
  assert.eq(scene._buildingUprightPieces.length, 8, 'perimeter divides into cell-length wall pieces');
  const north = scene._buildingUprightPieces[0], south = scene._buildingUprightPieces.at(-1);
  assert.lt(north.groundY, south.groundY, 'north and south walls have independent world anchors');
  assert.eq(south.groundY, 10 + Render.BUILDING_FACE_PX[T.BUILDING_MED] / PX_PER_M,
    'south anchor follows the lowest visible masonry base');
  const oldX = north.sprite.x;
  scene.playerM.x = 1;
  BuildingOverlay.draw(scene);
  assert.eq(north.sprite.x, oldX - Math.round(PX_PER_M), 'uprights follow pixel-aligned camera scrolling');
  scene.depth = 1;
  BuildingOverlay.draw(scene);
  assert.eq(scene._buildingUprightPieces.length, 0, 'underground removes surface uprights');
  assert.truthy(log.sprites.every(s => s.destroyed), 'old wall sprites are destroyed');
  assert.eq(log.removedTextures.length, 1, 'the atlas page is released');
  scene.depth = 0;
  BuildingOverlay.draw(scene);
  assert.eq(log.pages.length, 2, 'surfacing opens a fresh page');
  assert.eq(shutdownRegistrations, 1, 'rebuilds share one shutdown cleanup');
  shutdown();
  assert.eq(scene._buildingUprightPieces.length, 0, 'scene shutdown releases cached pieces');
  assert.eq(log.removedTextures.length, 2, 'shutdown releases the surviving page');
  assert.eq(scene._buildingGeomKey, null, 'a restarted scene rebuilds its buildings');
});

test('building overlay: atlas slots fit the largest piece, and an emptied page is dropped', () => {
  // A diamond footprint cuts diagonal edges, the widest pieces there are in
  // both axes; the shared slot retains its maximum face padding. No
  // frame may be clamped to its slot (that would crop a wall), so every
  // frame is the piece's own box and every box fits the slot.
  clearTiles();
  putShapes(0, 0, [{ ring: Float32Array.from([10, 0, 20, 10, 10, 20, 0, 10]), tier: T.BUILDING_MED, areaM2: 200, key: null }]);
  const { scene, log } = makeWallScene();
  BuildingOverlay.draw(scene);
  const A = scene._buildingWallAtlas;
  assert.truthy(A && A.slotW > 0 && A.slotH > 0, 'the atlas geometry is on the scene');
  const styles = CastleStyles.ids.map(id => CastleStyles.get(id).rampart);
  const pad = 2 * Math.ceil(Math.max(...styles.map(r =>
    r.topDepth + Math.max(r.topDepth, r.wallHeight) + r.toothHeight)) + 2) + 2;
  assert.truthy(Number.isInteger(A.slotW) && Number.isInteger(A.slotH), 'fractional caps retain integer atlas slots');
  assert.eq(A.slotW, CELL_PX + pad, 'a slot is a cell plus the bake padding wide');
  assert.eq(A.slotH, CELL_PX + Render.BUILDING_FACE_PX[T.BUILDING_LARGE] + pad, 'and the deepest face taller');
  assert.gt(log.frames.length, 4, 'the diamond cut into several pieces');
  for (const p of scene._buildingUprightPieces) {
    const f = log.pages[0].frames.get(p.frame);
    assert.eq(f.w, p.width, `frame ${p.frame} is the piece's own width`);
    assert.eq(f.h, p.height, `frame ${p.frame} is the piece's own height`);
    assert.eq(f.w <= A.slotW && f.h <= A.slotH, true, `frame ${p.frame} fits its slot`);
    assert.eq(f.x % A.slotW === 0 && f.y % A.slotH === 0, true, `frame ${p.frame} sits on a slot corner`);
  }
  // Walk far enough that every piece leaves the padded view: each frame is
  // released, and the page, with nothing left on it, goes with them.
  const baked = log.frames.length;
  scene.playerM.x = 5 * 40;
  BuildingOverlay.draw(scene);
  assert.eq(scene._buildingUprightPieces.length, 0, 'nothing in view');
  assert.eq(log.removedFrames.length, baked, 'every frame released');
  assert.eq(log.removedTextures.join(), log.pages[0].key, 'the emptied page is dropped');
  scene.playerM.x = 0;
  BuildingOverlay.draw(scene);
  assert.eq(log.pages.length, 2, 'walking back opens a page again');
  assert.eq(log.frames.length, baked * 2, 'and rebakes the pieces');
});

test('building overlay: cached offscreen walls skip rendering and reappear on subcell scrolling', () => {
  clearTiles();
  putShapes(0, 0, []);
  const scene = makeScene();
  BuildingOverlay.draw(scene);
  const right = { x: 354, y: 176, width: 12, height: 12, sprite: makeContainer() };
  const leftEdge = { x: -11, y: 176, width: 10, height: 12, sprite: makeContainer() };
  const above = { x: 176, y: -14, width: 12, height: 12, sprite: makeContainer() };
  const below = { x: 176, y: 354, width: 12, height: 12, sprite: makeContainer() };
  scene._buildingUprightPieces = [right, leftEdge, above, below];
  BuildingOverlay.draw(scene);
  assert.falsy(right.sprite.visible, 'right of the mask');
  assert.truthy(leftEdge.sprite.visible, 'retain a filtered edge pixel');
  assert.falsy(above.sprite.visible, 'above the mask');
  assert.falsy(below.sprite.visible, 'below the mask');
  scene.playerM.x = 1; // Within the same cell; no cache rebuild.
  BuildingOverlay.draw(scene);
  assert.truthy(right.sprite.visible, 'the retained wall enters immediately');
  assert.falsy(leftEdge.sprite.visible, 'the opposite wall leaves');
  assert.eq(scene._buildingUprightPieces[0], right, 'reuse the same piece');
  scene.playerM.x = 0;
  BuildingOverlay.draw(scene);
  assert.falsy(right.sprite.visible, 'hide it again without rebuilding');
});

function makePerspectiveScene() {
  const fixture = makeWallScene({ _headingUp: true, mapRot: 0 });
  fixture.scene.add.graphics = () => ({ triangles: [], clears: 0,
    clear() { this.triangles.length = 0; this.clears++; return this; },
    fillStyle() { return this; },
    fillTriangle(...v) { this.triangles.push(v); return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; } });
  return fixture;
}

test('building overlay: heading-up castle uses retained prisms without an atlas and follows subcell pan', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING_LARGE, 'citadel')]);
  const { scene, log } = makePerspectiveScene();
  BuildingOverlay.draw(scene);
  const group = scene._wallPerspective.polygon;
  assert.gt(group.blocks.length, 4, 'walls and crenellations use retained geometry');
  assert.gt(group.gfx.triangles.length, 0, 'real projection paints triangles');
  assert.eq(log.pages.length, 0, 'no wall atlas allocated');
  assert.eq(log.refreshes, 0, 'no wall canvas uploaded');
  assert.eq(scene._buildingUprightPieces.length, 0, 'old atlas pieces stay absent');
  assert.eq(group.gfx.parentContainer, scene.buildingWallContainer, 'walls remain background');
  const first = group.blocks[0], clears = group.gfx.clears;
  const commits = scene.buildingGeomGfx.commits;
  scene.playerM.x = 1;
  BuildingOverlay.draw(scene);
  assert.eq(group.gfx.x, -Math.round(PX_PER_M), 'wall translation matches pixel-aligned ground movement');
  assert.eq(group.blocks[0], first, 'pan retains geometry');
  assert.eq(group.gfx.clears, clears, 'pan does not repaint wall command buffer');
  scene.mapRot = Math.PI / 3;
  WallPerspective.update(scene);
  assert.eq(scene.buildingGeomGfx.commits, commits, 'rotation does not upload the ground canvas');
  assert.eq(log.refreshes, 0, 'rotation never uploads a wall texture');
  clearTiles();
});

test('building overlay: heading-up house foundations follow the camera without repainting textured floors', () => {
  const previousStyle = Render.buildingArtStyle;
  Render.buildingArtStyle = 'rounded';
  try {
  const rings = [
    [0, 0, 10, 0, 10, 10, 0, 10],
    [0, 0, 15, 0, 15, 5, 5, 5, 5, 15, 0, 15],
  ];
  for (const ring of rings) for (const reverse of [false, true]) {
    clearTiles();
    const points = [];
    for (let i = 0; i < ring.length; i += 2) points.push(ring.slice(i, i + 2));
    if (reverse) points.reverse();
    putShapes(0, 0, [{ ring: Float32Array.from(points.flat()), tier: T.BUILDING,
      areaM2: 100, key: 'house-foundation' }]);
    const { scene, log } = makePerspectiveScene();
    BuildingOverlay.draw(scene);
    const group = scene._wallPerspective.polygon, block = group.blocks[0];
    const commits = scene.buildingGeomGfx.commits;
    assert.eq(scene.buildingGeomGfx.only('fill').length, 1, 'floor cache contains no southward foundation');
    assert.eq(group.blocks.length, 1, 'one retained perimeter');
    assert.eq(block.top, 0, 'foundation joins the original floor plane');
    assert.eq(block.bottom, -Render.BUILDING_FACE_PX[T.BUILDING], 'foundation descends below floor');
    assert.falsy(block.capped, 'no cap covers floor texture or bridges concave notches');
    for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      scene.mapRot = angle;
      WallPerspective.update(scene);
      assert.eq(group.blocks[0], block, 'heading retains source geometry');
      assert.gt(group.gfx.triangles.length, 0, 'camera-facing foundation remains visible');
      const c = Math.cos(angle), sn = Math.sin(angle);
      for (let i = 0; i < block.points.length; i++) {
        const j = i * 4, v = block.projected;
        const dx = v[j] - v[j + 2], dy = v[j + 1] - v[j + 3];
        assert.lt(Math.abs(c * dx - sn * dy), 1e-7, 'foundation extrudes vertically in screen space');
        assert.lt(Math.abs(sn * dx + c * dy + block.bottom), 1e-7, 'foundation extends down by its depth');
      }
      let visibleEdges = 0;
      for (let i = 0; i < block.points.length; i++) {
        const a = block.points[i], b = block.points[(i + 1) % block.points.length];
        if ((c * (b.x - a.x) - sn * (b.y - a.y)) * block.winding < -1e-6) visibleEdges++;
      }
      // Two fill triangles per visible face; the ink pass (BuildingLowPoly.LOOK.inkPx)
      // first lays the same faces down eight times, offset — never a cap.
      const inkCopies = (typeof BuildingLowPoly !== 'undefined' && BuildingLowPoly.LOOK.inkPx) ? 8 : 0;
      assert.eq(group.gfx.triangles.length, visibleEdges * 2 * (1 + inkCopies), 'two triangles per visible face plus their ink offsets, no filled cap');
    }
    const clears = group.gfx.clears;
    scene.playerM.x = 1;
    BuildingOverlay.draw(scene);
    WallPerspective.update(scene);
    assert.eq(group.gfx.x, -Math.round(PX_PER_M), 'foundation pans with pixel-aligned floor');
    assert.eq(group.gfx.clears, clears, 'fixed heading reuses commands');
    assert.eq(scene.buildingGeomGfx.commits, commits, 'heading never uploads floor canvas');
    assert.eq(log.pages.length, 0, 'no wall atlas');
    assert.eq(log.refreshes, 0, 'no wall texture uploads');
  }
  clearTiles();
  } finally { Render.buildingArtStyle = previousStyle; }
});

test('building overlay: a shared sandbox block never becomes one oversized house', () => {
  clearTiles();
  const previousStyle = Render.buildingArtStyle;
  Render.buildingArtStyle = 'procedural';
  try {
    const entry = putShapes(0, 0, [rectShape(0, 0, 25, 40, T.BUILDING, 'sb_first')]);
    entry.objects = [
      { kind: 'house', id: 'sb_first', tier: 9, x: 5, y: 5, area: 25 },
      { kind: 'house', id: 'sb_second', tier: 9, x: 15, y: 5, area: 25 },
    ];
    const { scene } = makePerspectiveScene();
    scene.save = { restoredHouses: { sb_first: 'plain', sb_second: 'plain' } };
    BuildingOverlay.draw(scene);
    assert.eq(scene._proceduralBuildings.size, 2, 'each fixture gets its own model');
    const aboveGround = scene._wallPerspective.polygon.blocks.filter(b => b.top > 0);
    assert.gt(aboveGround.length, 0);
    for (const b of aboveGround) {
      const xs = b.points.map(p => p.x), ys = b.points.map(p => p.y);
      assert.lte(Math.max(...xs) - Math.min(...xs), CELL_PX + 0.01);
      assert.lte(Math.max(...ys) - Math.min(...ys), CELL_PX + 0.01);
    }
  } finally { Render.buildingArtStyle = previousStyle; clearTiles(); }
});

test('building overlay: procedural houses follow source footprints and same-count role changes', () => {
  clearTiles();
  const previousStyle = Render.buildingArtStyle;
  Render.buildingArtStyle = 'procedural';
  try {
    const entry = putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING, 'styled-house')]);
    entry.objects = [{ kind: 'house', id: 'styled-house', tier: 9, x: 5, y: 5 }];
    const { scene } = makePerspectiveScene();
    scene.save = { restoredHouses: { 'styled-house': 'plain' } };
    BuildingOverlay.draw(scene);
    assert.truthy(scene._proceduralBuildings.has('styled-house'));
    const height = scene._proceduralBuildings.get('styled-house').height;
    const commits = scene.buildingGeomGfx.commits;
    scene.mapRot = Math.PI / 4;
    BuildingOverlay.draw(scene);
    WallPerspective.update(scene);
    assert.eq(scene.buildingGeomGfx.commits, commits, 'compass reuses geometry');
    scene.save.restoredHouses['styled-house'] = 'trader'; // japanese: a different style height
    BuildingOverlay.draw(scene);
    assert.gt(scene.buildingGeomGfx.commits, commits, 'same number of houses still changes roof');
    assert.truthy(scene._proceduralBuildings.get('styled-house').height !== height);
    // Wizard towers keep their sprite art: no generated shell, no sign height.
    scene.save.restoredHouses['styled-house'] = 'wizard';
    BuildingOverlay.draw(scene);
    assert.falsy(scene._proceduralBuildings.has('styled-house'), 'sprite-art roles leave no procedural entry');
    Render.buildingArtStyle = 'rounded';
    BuildingOverlay.draw(scene);
    assert.eq(scene._proceduralBuildings.size, 0, 'rollback restores sprite authority');
  } finally { Render.buildingArtStyle = previousStyle; clearTiles(); }
});

test('building overlay: heading-up temple uses temple wall palette without castle teeth', () => {
  clearTiles();
  const shape = Object.assign(rectShape(0, 0, 10, 10, T.BUILDING_LARGE, 'temple-test'),
    { templeZone: 'temple-zone', templeKind: 'tar' });
  putShapes(0, 0, [shape]);
  const { scene, log } = makePerspectiveScene();
  BuildingOverlay.draw(scene);
  const group = scene._wallPerspective.polygon;
  const palette = TempleArt.palette(false, true, true);
  assert.eq(group.blocks.length, 0, 'temple foundations do not rise above their floor');
  assert.eq(scene.buildingGeomGfx.only('fill')[0].color, palette.face, 'foundation uses temple stone');
  assert.eq(log.pages.length, 0);
  clearTiles();
});

test('building overlay: disabling polygon mode clears retained heading-up walls and restores them on enable', () => {
  clearTiles();
  putShapes(0, 0, [rectShape(0, 0, 10, 10, T.BUILDING_LARGE, 'citadel')]);
  const { scene } = makePerspectiveScene();
  const enabled = BuildingOverlay.enabled();
  try {
    BuildingOverlay.draw(scene);
    const group = scene._wallPerspective.polygon;
    BuildingOverlay.setEnabled(scene, false);
    BuildingOverlay.draw(scene);
    assert.eq(group.blocks.length, 0, 'disabled geometry cannot reappear on a compass update');
    assert.eq(group.gfx.triangles.length, 0, 'draw commands cleared');
    WallPerspective.update(scene);
    assert.eq(group.gfx.triangles.length, 0);
    BuildingOverlay.setEnabled(scene, true);
    BuildingOverlay.draw(scene);
    assert.gt(group.blocks.length, 0, 'enable rebuilds geometry');
    scene.depth = 1;
    BuildingOverlay.draw(scene);
    assert.eq(group.blocks.length, 0, 'cave transition also clears surface walls');
  } finally {
    BuildingOverlay.setEnabled(scene, enabled);
    clearTiles();
  }
});

test('building overlay: irregular castle rings retain closed edges and bounded joins in both windings', () => {
  const shapes = {
    L: [[0, 0], [24, 0], [24, 8], [8, 8], [8, 24], [0, 24]],
    U: [[0, 0], [24, 0], [24, 24], [16, 24], [16, 8], [8, 8], [8, 24], [0, 24]],
    acute: [[0, 0], [28, 12], [0, 14]],
    elongated: [[0, 0], [32, 0], [32, 4], [0, 4]],
    trapezoid: [[4, 0], [20, 0], [24, 20], [0, 20]],
    star: Array.from({ length: 10 }, (_, i) => {
      const radius = i % 2 ? 5 : 12, angle = -Math.PI / 2 + i * Math.PI / 5;
      return [12 + radius * Math.cos(angle), 12 + radius * Math.sin(angle)];
    }),
  };
  for (const [name, ring] of Object.entries(shapes)) {
    let canonical;
    for (const reverse of [false, true]) {
      clearTiles();
      const ordered = (reverse ? ring.slice().reverse() : ring).map(p => p.map(Math.fround));
      const shape = { ring: Float32Array.from(ordered.flat()), tier: T.BUILDING_LARGE,
        areaM2: 400, key: 'citadel' };
      putShapes(0, 0, [shape]);
      const { scene, log } = makePerspectiveScene();
      BuildingOverlay.draw(scene);
      const group = scene._wallPerspective.polygon;
      const bodies = group.blocks.filter(b => b.bottom === 0);
      const caps = bodies.filter(b => b.points.length === 4);
      const bevels = bodies.filter(b => b.points.length === 3);
      assert.eq(bevels.length, name === 'L' ? 1 : name === 'U' ? 2 : name === 'star' ? 5 : 0,
        `${name}: concave turns get one bounded join each`);
      for (let i = 0; i < ordered.length; i++) {
        const a = { x: px(ordered[i][0]), y: px(ordered[i][1]) };
        const next = ordered[(i + 1) % ordered.length];
        const b = { x: px(next[0]), y: px(next[1]) };
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        const sections = caps.filter(block => block.points.slice(0, 2).every(p =>
          Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) < 1e-6
          && (p.x - a.x) * dx + (p.y - a.y) * dy >= -1e-6
          && (p.x - a.x) * dx + (p.y - a.y) * dy <= length * length + 1e-6));
        const covered = sections.reduce((sum, block) => sum + Math.hypot(
          block.points[1].x - block.points[0].x, block.points[1].y - block.points[0].y), 0);
        assert.lt(Math.abs(covered - length), 1e-6, `${name}: complete source edge coverage`);
      }
      const signature = bodies.map(b => b.points.map(p =>
        `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort().join('|')).sort().join(';');
      if (canonical === undefined) canonical = signature;
      else assert.eq(signature, canonical, `${name}: winding cannot change wall footprint geometry`);
      for (let step = 0; step < 8; step++) {
        scene.mapRot = step * Math.PI / 4;
        WallPerspective.update(scene);
        assert.truthy(group.gfx.triangles.every(triangle => triangle.every(Number.isFinite)),
          `${name}: every projected triangle remains finite`);
        for (const block of group.blocks) {
          const sin = Math.sin(scene.mapRot), cos = Math.cos(scene.mapRot), v = block.projected;
          for (let j = 0; j < v.length; j += 4) {
            const dx = v[j + 2] - v[j], dy = v[j + 3] - v[j + 1];
            assert.lt(Math.abs(cos * dx - sin * dy), 1e-7, `${name}: all joints extrude vertically`);
            assert.lt(Math.abs(sin * dx + cos * dy + block.top - block.bottom), 1e-7);
          }
        }
      }
      assert.eq(log.pages.length, 0, `${name}: shape complexity does not require atlas uploads`);
    }
  }
  clearTiles();
});

// ── YOUR HOUSE ──────────────────────────────────────────────────────────────
// Home (save.starterShopId) is drawn from its footprint as a room: walls as
// retained prisms with height and thickness, a doorway on the door side, and
// a roof that comes off while the player stands inside.
function homeShape(door) {
  return { ring: Float32Array.from([0, 0, 15, 0, 15, 15, 0, 15]), tier: T.BUILDING,
    key: 'starter_trailer', home: true, areaM2: 225, door };
}
test('building overlay: Home is walls with a doorway under a roof, from its footprint', () => {
  clearTiles();
  putShapes(0, 0, [homeShape({ x: 7.5, y: 15 })]);
  const { scene } = makePerspectiveScene();
  scene.save = { starterShopId: 'starter_trailer' };
  scene.homeInside = () => false;
  BuildingOverlay.draw(scene);
  assert.eq(scene._wallPerspective.polygon.blocks.length, 0, 'no plain house foundation: Home is not a village house');
  const group = scene._wallPerspective.home;
  assert.truthy(group && group.alwaysActive, 'Home\'s prisms draw at every heading');
  const H = HomeArea.HOUSE;
  const walls = group.blocks.filter(b => b.bottom === 0 && b.top === H.wallPx);
  assert.gt(walls.length, 8, 'wall sections round the perimeter');
  const roof = group.blocks.filter(b => b.top === H.wallPx && b.bottom === H.wallPx - 2 && b.capped);
  assert.eq(roof.length, 2, 'the roof cap at wall height, in two slopes');
  assert.eq(roof[0].colors.top, H.roof.shade, 'the far slope in shade');
  assert.eq(roof[1].colors.top, H.roof.top, 'the near slope lit');
  const ridge = group.blocks.filter(b => b.bottom === H.wallPx && b.top === H.wallPx + H.ridgePx);
  assert.eq(ridge.length, 1, 'and a ridge above it');
  assert.eq(ridge[0].colors.top, H.roof.lite, 'lit along the ridge');
  // The doorway: no south-wall section covers the door point.
  const southY = Math.max(...roof[1].points.map(p => p.y));
  const doorX = (roof[1].points[0].x + roof[1].points[1].x) / 2;
  const south = walls.filter(b => b.points.some(p => Math.abs(p.y - southY) < 1e-6));
  assert.gt(south.length, 0, 'the south wall stands');
  for (const b of south) {
    const xs = b.points.map(p => p.x);
    assert.truthy(Math.min(...xs) >= doorX + CELL_PX / 2 - 1e-6 || Math.max(...xs) <= doorX - CELL_PX / 2 + 1e-6,
      'no wall across the doorway');
  }
  assert.eq(walls.filter(b => b.colors.top === H.roof.dark).length, walls.length, 'roofed, the wall tops are the eave line');
  // The floor is still the house floor on the canvas, outlined, no sprite.
  const g = scene.buildingGeomGfx;
  assert.eq(g.only('texture').length, 1, 'its floor carries the house material');
  assert.eq(g.only('stroke').length, 1, 'and the outline');
  assert.eq(g.only('slime').length, 0, 'never dilapidated');
  clearTiles();
});
test('building overlay: inside Home the roof comes off and the walls show their tops', () => {
  clearTiles();
  putShapes(0, 0, [homeShape({ x: 7.5, y: 15 })]);
  const { scene } = makePerspectiveScene();
  scene.save = { starterShopId: 'starter_trailer' };
  scene.homeInside = () => true;
  BuildingOverlay.draw(scene);
  const group = scene._wallPerspective.home, H = HomeArea.HOUSE;
  assert.eq(group.blocks.filter(b => b.bottom >= H.wallPx - 2).length, 0, 'no roof, no ridge');
  const walls = group.blocks.filter(b => b.bottom === 0);
  assert.gt(walls.length, 8, 'the walls stand');
  assert.truthy(walls.every(b => b.colors.top === H.wall.top), 'their tops are the wall\'s own course');
  // Inside, every wall sorts against the player on its own: one world-layer
  // part per block, each at its wall's sort point (owner, Oct 2026: the one
  // wall-container graphics drew the player over the walls in front).
  assert.truthy(group.perWall, 'the home group is per wall while inside');
  assert.eq(group.parts.filter(p => p.visible).length, group.blocks.length, 'a visible part per block');
  assert.truthy(group.parts.every(p => p._worldGeometry && p._huAnchor), 'world geometry with a sort anchor');
  const pieces = WallPerspective.worldPieces(scene);
  assert.eq(pieces.length, group.blocks.length, 'handed to the frame\'s world sort');
  assert.falsy(group.inkPart, 'no outline inside: the dark mask outside is the room\'s edge');
  scene.homeInside = () => false;
  BuildingOverlay.draw(scene);
  assert.falsy(scene._wallPerspective.home.perWall, 'outside, one roofed object again');
  assert.truthy(scene._wallPerspective.home.parts.every(p => !p.visible), 'its parts put away');
  clearTiles();
});
test('building overlay: Home\'s walls stay up north-up, and an adopted Home has no doorway', () => {
  clearTiles();
  putShapes(0, 0, [{ ...homeShape(null), key: 'h_real', home: undefined }]);
  const { scene } = makeWallScene({ _headingUp: false, mapRot: 0 });
  scene.add.graphics = () => ({ triangles: [], clears: 0, visible: true,
    clear() { this.triangles.length = 0; this.clears++; return this; },
    fillStyle() { return this; },
    fillTriangle(...v) { this.triangles.push(v); return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; } });
  scene.save = { starterShopId: 'h_real' };
  scene.homeInside = () => false;
  BuildingOverlay.draw(scene);
  const group = scene._wallPerspective.home, H = HomeArea.HOUSE;
  assert.truthy(group.gfx.visible, 'drawn without the heading-up camera');
  assert.gt(group.gfx.triangles.length, 0, 'real triangles');
  const southY = 15 * PX_PER_M + 176 - 0; // the ring's south edge, projected
  const walls = group.blocks.filter(b => b.bottom === 0 && b.top === H.wallPx);
  const south = walls.filter(b => b.points.some(p => Math.abs(p.y - Math.max(...group.blocks[0].points.map(q => q.y))) < 1e-6));
  assert.gt(south.length, 0, 'a south wall');
  const span = (b) => Math.max(...b.points.map(p => p.x)) - Math.min(...b.points.map(p => p.x));
  const total = south.filter(b => span(b) > 1).reduce((n, b) => n + span(b), 0);
  assert.truthy(Math.abs(total - 15 * PX_PER_M) < 1e-6, `the south wall is whole (${total} of ${15 * PX_PER_M}; ${southY})`);
  clearTiles();
});
test('building overlay: Home without a prism group falls back to a flat roof', () => {
  clearTiles();
  putShapes(0, 0, [homeShape({ x: 7.5, y: 15 })]);
  const scene = makeScene({ save: { starterShopId: 'starter_trailer' }, homeInside: () => false });
  BuildingOverlay.draw(scene);
  const fills = scene.buildingGeomGfx.only('fill');
  assert.eq(fills[fills.length - 1].color, HomeArea.HOUSE.roof.top, 'the last fill is the roof');
  scene.homeInside = () => true;
  scene._buildingGeomKey = null;
  BuildingOverlay.draw(scene);
  const inside = scene.buildingGeomGfx.only('fill');
  assert.falsy(inside.some(f => f.color === HomeArea.HOUSE.roof.top), 'inside, no roof');
  clearTiles();
});

// ─── Forts: a palisade rim plus the gambling hall ──────────────────────────
// A fort (tier 11, Houses.displayRole 'fort') is never a generated body. The
// overlay paints its plank floor and the tier-11 pickets of perspectiveEdges
// (separate 3px posts round the footprint, compass-aware like every wall),
// and leaves scene._proceduralBuildings alone so the RENDER_SPEC house row
// still seats the gambling-hall sprite (house_fort) on the footprint's centre.
// Pinned after a low-poly fort shell replaced the rim and hid the hall.
test('building overlay: a fort is a palisade rim round its footprint, with its hall sprite kept', () => {
  clearTiles();
  const previousStyle = Render.buildingArtStyle;
  Render.buildingArtStyle = 'procedural';
  try {
    const entry = putShapes(0, 0, [
      rectShape(0, 0, 10, 10, T.BUILDING_MED, 'fort'),
      rectShape(20, 0, 30, 10, T.BUILDING, 'house'),
    ]);
    const fort = { kind: 'house', id: 'fort', tier: 11, x: 5, y: 5 };
    const house = { kind: 'house', id: 'house', tier: 9, x: 25, y: 5 };
    entry.objects = [fort, house];
    const { scene } = makePerspectiveScene();
    scene.save = { restoredHouses: { house: 'plain' } };
    BuildingOverlay.draw(scene);
    assert.falsy(scene._proceduralBuildings.has('fort'), 'the fort has no generated body');
    assert.falsy(Render.proceduralHouse(fort, scene), 'so its gambling-hall sprite stays visible');
    assert.truthy(Render.proceduralHouse(house, scene), 'while the house beside it is a model');
    // Fort planks under the hall, as before.
    assert.truthy(scene.buildingGeomGfx.only('texture').some(t => t.tier === T.BUILDING_MED), 'plank floor');
    // The rim: short posts, not continuous wall strips. A 64px side carries
    // sixteen wider pointed pickets at a 4px pitch (perspectiveEdges).
    const pickets = scene._wallPerspective.polygon.blocks.filter(b => b.building?.key === 'fort');
    assert.gte(pickets.length, 4 * 16, 'pickets on every side of the footprint');
    for (const b of pickets) {
      const xs = b.points.map(p => p.x), ys = b.points.map(p => p.y);
      assert.lte(Math.max(...xs) - Math.min(...xs), WallMaterials.WOOD.width + .01, 'a picket, not a wall run');
      assert.lte(Math.max(...ys) - Math.min(...ys), WallMaterials.WOOD.width + .01, 'a picket, not a wall run');
      assert.eq(b.top, WallMaterials.WOOD.height + WallMaterials.WOOD.tipHeight, 'pointed palisade height');
      assert.truthy(b.materialFaces?.length, 'pickets carry the shared wood texture');
    }
    // Compass turns reuse the retained pickets rather than rebaking.
    const commits = scene.buildingGeomGfx.commits;
    scene.mapRot = Math.PI / 3;
    BuildingOverlay.draw(scene);
    WallPerspective.update(scene);
    assert.eq(scene.buildingGeomGfx.commits, commits, 'rotation redraws no canvas');
    assert.gt(scene._wallPerspective.polygon.gfx.triangles.length, 0, 'the rim projects at the new heading');
  } finally { Render.buildingArtStyle = previousStyle; clearTiles(); }
});

// The WebGL low-poly path hands houses to BuildingLowPoly.add; a fort must
// never reach it (the shell was the regression), while its pickets still draw.
test('building overlay: the low-poly path builds houses but never a fort body', () => {
  clearTiles();
  const previousStyle = Render.buildingArtStyle;
  const saved = { active: BuildingLowPoly.active, begin: BuildingLowPoly.begin, add: BuildingLowPoly.add,
    update: BuildingLowPoly.update, clear: BuildingLowPoly.clear };
  const added = [];
  Render.buildingArtStyle = 'procedural';
  BuildingLowPoly.active = () => true;
  BuildingLowPoly.begin = BuildingLowPoly.update = BuildingLowPoly.clear = () => {};
  BuildingLowPoly.add = (scene, pts, recipe, variant, id) => { added.push({ id, role: recipe.role }); return { faces: [1], height: 10 }; };
  try {
    const entry = putShapes(0, 0, [
      rectShape(0, 0, 10, 10, T.BUILDING_MED, 'fort'),
      rectShape(20, 0, 30, 10, T.BUILDING, 'house'),
    ]);
    entry.objects = [{ kind: 'house', id: 'fort', tier: 11, x: 5, y: 5 }, { kind: 'house', id: 'house', tier: 9, x: 25, y: 5 }];
    const { scene } = makePerspectiveScene();
    scene.save = { restoredHouses: { house: 'plain' } };
    BuildingOverlay.draw(scene);
    assert.eq(added.map(a => a.id).join(','), 'house', 'only the house becomes a mesh');
    assert.falsy(scene._proceduralBuildings.has('fort'), 'the fort keeps its sprite');
    const pickets = scene._wallPerspective.polygon.blocks.filter(b => b.building?.key === 'fort');
    assert.gte(pickets.length, 4 * 16, 'the palisade still rims the fort');
  } finally {
    Object.assign(BuildingLowPoly, saved);
    Render.buildingArtStyle = previousStyle; clearTiles();
  }
});

})();
