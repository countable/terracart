// Regression guard: NOTHING SPAWNS ON A ROAD.
//
// This has come back several times, and the reason it kept coming back is that
// every fix checked the wrong thing. The terrain grid is a lossy record of
// where the roads are:
//   • every way rasterizes exactly ONE cell wide whatever its class, while the
//     road-geometry overlay draws it at its real carriageway width — so a
//     motorway's band covers a full cell past its ROAD_LG cells on both sides,
//     and anything seated there is drawn sitting in the traffic;
//   • parking aisles are skipped by the rasterizer entirely, so a lot the
//     overlay carpets in asphalt is, to the grid, plain landuse — and rocks,
//     shrubs and buried-X marks scattered all over it.
// A filter that reads grid[] alone says "grass" for both. WorldGen.rasterizeTile
// therefore also builds `roadMask` — the ground the overlay actually covers,
// stamped from the same width function the overlay strokes with
// (roadOverlayWidthM) — and every spawn filter consults it.
//
// These tests drive the REAL rasterizer over synthetic MVT layers, so they fail
// if any future spawner is added that checks terrain and forgets the mask.

// One shared vm scope holds every *.test.js, so this file keeps its fixture
// constants inside an IIFE rather than colliding with the next file's `T`.
(function () {
const T = WorldGen.T;

// One tile of round numbers: 64 cells across, 7 m each, so a cell is exactly
// 64 MVT units and cell↔MVT arithmetic in the fixtures stays readable.
const CPE = 64;
const TILE_EDGE_M = CPE * 7;          // 448 m — cellWidthM === 7 exactly
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;        // 64 MVT units per cell
const cellToMvt = (c) => c * CELL_MVT + CELL_MVT / 2;   // cell index → its centre

const ROAD_TIERS = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG]);

function ring(cells) {   // [[cx,cy],…] cell coords → a closed MVT ring
  return cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
}
function line(cells) {
  return cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
}
// A polygon covering the whole tile.
const wholeTile = () => ring([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]]);

// The fixture world: a residential block (rock clusters + flora) with a wooded
// strip (trees), crossed by a motorway and a street, plus a parking lot whose
// aisles rasterize to nothing and whose POI drops a buried-X.
function fixtureLayers() {
  return [
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'residential' }, geom: [wholeTile()] },
      // The store lot the parking POI belongs to. Commercial, not residential,
      // so the buried-X below is judged on the ROAD rule alone — the private
      // -yard frontage rule is a separate test's business.
      { type: 3, tags: { class: 'commercial' },
        geom: [ring([[42, 16], [58, 16], [58, 30], [42, 30]])] },
    ] },
    { name: 'landcover', features: [
      { type: 3, tags: { class: 'wood' },
        geom: [ring([[4, 40], [58, 40], [58, 58], [4, 58]])] },
    ] },
    { name: 'transportation', features: [
      // Motorway straight down the middle: 12 m × 1.5 = 18 m of band over 7 m
      // cells, so the mask is 3 cells wide where the paint is 1.
      { type: 2, tags: { class: 'motorway' },
        geom: [line([[32, 0], [32, CPE - 1]])] },
      // An ordinary street — 5 m, narrower than a cell, so mask === paint.
      { type: 2, tags: { class: 'minor' },
        geom: [line([[0, 10], [CPE - 1, 10]])] },
      // Parking aisles: skipped by the rasterizer (they'd weld the lot into an
      // asphalt blob) but drawn by the overlay all the same.
      { type: 2, tags: { class: 'service', service: 'parking_aisle' },
        geom: [line([[44, 20], [56, 20]]), line([[44, 24], [56, 24]])] },
    ] },
    { name: 'poi', features: [
      { type: 1, tags: { class: 'parking' },
        geom: [[{ x: cellToMvt(50), y: cellToMvt(20) }]] },   // anchor ON an aisle
    ] },
  ];
}

function rasterize() {
  return WorldGen.rasterizeTile(fixtureLayers(), CPE, 0, 0, TILE_EDGE_M);
}
// Object world-metres → this tile's local cell index (the basis the grid was
// painted in: tileEdgeM / cellsPerEdge, NOT the nominal CELL_M).
const cellOf = (v) => Math.floor(v / (TILE_EDGE_M / CPE));

// ─── The mask itself ─────────────────────────────────────────────────────────

test('roadMask: a motorway masks a cell either side of the one it paints', () => {
  const { grid, roadMask } = rasterize();
  const row = 30;                       // clear of the street at row 10
  const i = (cx) => row * CPE + cx;
  assert.truthy(ROAD_TIERS.has(grid[i(32)]), 'motorway paints its own cell');
  assert.falsy(ROAD_TIERS.has(grid[i(31)]), 'and only its own cell');
  assert.eq(roadMask[i(32)], 1, 'centre cell masked');
  assert.eq(roadMask[i(31)], 1, 'west flank masked — the band covers it');
  assert.eq(roadMask[i(33)], 1, 'east flank masked');
  assert.eq(roadMask[i(29)], 0, 'two cells out is open ground again');
});

test('roadMask: a 5 m street masks no more than the cell it paints', () => {
  const { roadMask } = rasterize();
  const col = 12;                       // clear of the motorway at column 32
  assert.eq(roadMask[10 * CPE + col], 1, 'the street cell is masked');
  assert.eq(roadMask[9 * CPE + col], 0, 'its shoulder is still spawnable');
  assert.eq(roadMask[11 * CPE + col], 0, 'both shoulders');
});

// The band is a CONTINUOUS stroke, not a run of whole cells — a way running
// near a cell boundary draws asphalt into a cell its centerline never enters.
// Those partially-covered cells must mask too (they're what made "tilled soil
// overlapping the road" possible: underRoad is read straight off this mask).
test('roadMask: a street straddling a cell boundary masks both cells it draws over', () => {
  // 5 m band down the boundary between columns 19 and 20 → 2.5 m of asphalt
  // in each. Only one of them can ever be PAINTED road; both must be masked.
  const layers = [
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'residential' }, geom: [wholeTile()] },
    ] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'minor' },
        geom: [[{ x: 20 * CELL_MVT, y: 0 }, { x: 20 * CELL_MVT, y: EXTENT }]] },
    ] },
  ];
  const { roadMask } = WorldGen.rasterizeTile(layers, CPE, 0, 0, TILE_EDGE_M);
  const row = 30;
  assert.eq(roadMask[row * CPE + 19], 1, 'west side of the boundary masked');
  assert.eq(roadMask[row * CPE + 20], 1, 'east side masked — the band covers 2.5 m of it');
  assert.eq(roadMask[row * CPE + 18], 0, 'one cell further west is open ground');
  assert.eq(roadMask[row * CPE + 21], 0, 'one cell further east too');
});

test('roadMask: a footpath hugging a cell edge masks the neighbour its band spills into', () => {
  // 2 m footway centred half a metre west of the boundary between columns 40
  // and 41: its band reaches 0.5 m across the line, so column 41 shows drawn
  // path and must refuse tilling/spawns even though the way never enters it.
  const wayX = (41 - 0.5 / 7) * CELL_MVT;
  const layers = [
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'residential' }, geom: [wholeTile()] },
    ] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'footway' },
        geom: [[{ x: wayX, y: 0 }, { x: wayX, y: EXTENT }]] },
    ] },
  ];
  const { roadMask } = WorldGen.rasterizeTile(layers, CPE, 0, 0, TILE_EDGE_M);
  const row = 30;
  assert.eq(roadMask[row * CPE + 40], 1, 'the cell carrying the way is masked');
  assert.eq(roadMask[row * CPE + 41], 1, 'the neighbour the band spills into is masked');
  assert.eq(roadMask[row * CPE + 39], 0, 'the band stops 1 m short of the west neighbour');
  assert.eq(roadMask[row * CPE + 42], 0, 'two cells east is open ground');
});

test('roadMask: parking aisles are masked even though they paint no terrain', () => {
  const { grid, roadMask } = rasterize();
  const i = 20 * CPE + 50;
  assert.falsy(ROAD_TIERS.has(grid[i]), 'aisle paints no road cell (by design)');
  assert.eq(roadMask[i], 1, 'but the overlay draws it, so nothing spawns there');
});

// ─── The invariant ───────────────────────────────────────────────────────────

test('no scatter object survives on a road cell or under a road band', () => {
  const { grid, objects, roadMask } = rasterize();
  let checked = 0;
  for (const o of objects) {
    // Chests are real-world destinations placed at their coordinates, and a
    // house/tower sprite IS the building — both are exempt by design.
    if (o.kind === 'chest' || o.kind === 'house' || o.kind === 'tower') continue;
    const ix = cellOf(o.x), iy = cellOf(o.y);
    if (ix < 0 || iy < 0 || ix >= CPE || iy >= CPE) continue;
    checked++;
    assert.falsy(ROAD_TIERS.has(grid[iy * CPE + ix]),
      `${o.kind} on road terrain at ${ix},${iy}`);
    assert.eq(roadMask[iy * CPE + ix], 0,
      `${o.kind} under the road band at ${ix},${iy}`);
  }
  assert.gt(checked, 0, 'fixture produced scatter objects to check');
});

test('no wild plant survives on a road cell or under a road band', () => {
  const { grid, wildplants, roadMask } = rasterize();
  assert.gt(wildplants.length, 0, 'fixture produced wild plants to check');
  for (const wp of wildplants) {
    const ix = cellOf(wp.x), iy = cellOf(wp.y);
    if (ix < 0 || iy < 0 || ix >= CPE || iy >= CPE) continue;
    assert.falsy(ROAD_TIERS.has(grid[iy * CPE + ix]),
      `${wp.crop} on road terrain at ${ix},${iy}`);
    assert.eq(roadMask[iy * CPE + ix], 0,
      `${wp.crop} under the road band at ${ix},${iy}`);
  }
});

test('a parking X anchored on an aisle is walked off it, not left buried in tarmac', () => {
  const { grid, parkingTreasures, roadMask } = rasterize();
  assert.eq(parkingTreasures.length, 1, 'the lot still gets its treasure');
  const t = parkingTreasures[0];
  const ix = cellOf(t.x), iy = cellOf(t.y);
  assert.eq(roadMask[iy * CPE + ix], 0, 'X is off the aisle band');
  assert.truthy(WorldGen.isSpawnCell(grid, CPE, CPE, ix, iy, { roadMask }),
    'X sits on a legitimate spawn cell');
  // It moved off its anchor, but only just — the reward stays on its own lot.
  assert.lt(Math.max(Math.abs(ix - 50), Math.abs(iy - 20)), 5, 'X stayed on the lot');
});

// ─── The shared rule ─────────────────────────────────────────────────────────

test('isSpawnCell: opts.roadMask refuses a cell the terrain calls grass', () => {
  const w = 5, h = 5;
  const grid = new Uint8Array(w * h);          // all GRASS
  const roadMask = new Uint8Array(w * h);
  roadMask[2 * w + 2] = 1;
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'grass without the mask');
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 2, 2, { roadMask }), 'refused with it');
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 1, 2, { roadMask }), 'neighbour unaffected');
});

test('relocateToSpawnCell: walks out to the nearest legal cell, or gives up', () => {
  const w = 7, h = 7;
  const grid = new Uint8Array(w * h);
  const roadMask = new Uint8Array(w * h);
  roadMask[3 * w + 3] = 1;
  const moved = WorldGen.relocateToSpawnCell(grid, w, h, 3, 3, { roadMask });
  assert.truthy(moved, 'found somewhere to go');
  assert.eq(Math.max(Math.abs(moved.ix - 3), Math.abs(moved.iy - 3)), 1, 'one cell out');
  // A cell already good is returned untouched.
  const stay = WorldGen.relocateToSpawnCell(grid, w, h, 1, 1, { roadMask });
  assert.eq(stay.ix, 1, 'good cell keeps its column');
  assert.eq(stay.iy, 1, 'good cell keeps its row');
  // Nowhere to go → null, so the caller drops the item instead of placing it.
  roadMask.fill(1);
  assert.falsy(WorldGen.relocateToSpawnCell(grid, w, h, 3, 3, { roadMask }), 'gives up');
});

// ─── One number, two consumers ───────────────────────────────────────────────

test('roadOverlayWidthM: the large tier carries its extra weight, others do not', () => {
  const wide = WorldGen.roadOverlayWidthM({ class: 'motorway' });
  assert.eq(wide, WorldGen.roadWidthM({ class: 'motorway' }) * 1.5, 'motorway weighted');
  assert.eq(WorldGen.roadOverlayWidthM({ class: 'primary' }),
    WorldGen.roadWidthM({ class: 'primary' }) * 1.5, 'primary weighted');
  for (const c of ['secondary', 'minor', 'service', 'footway', 'track']) {
    assert.eq(WorldGen.roadOverlayWidthM({ class: c }), WorldGen.roadWidthM({ class: c }),
      `${c} keeps its true width`);
  }
  assert.eq(WorldGen.roadOverlayWidthM(), WorldGen.roadWidthM({}), 'no tags is not a crash');
});

test('road_overlay.js strokes with roadOverlayWidthM, not its own copy of it', () => {
  // The mask and the band have to be derived from ONE number. If the overlay
  // ever reintroduces a local width table, a way can be drawn wider than the
  // ground the spawners are keeping clear — which is the bug, exactly.
  const src = ROAD_OVERLAY_SRC;   // lifted by run.js — the vm has no require()
  assert.truthy(/WorldGen\.roadOverlayWidthM/.test(src),
    'overlay reads WorldGen.roadOverlayWidthM');
  assert.falsy(/LARGE_SCALE|LARGE_CLASSES/.test(src),
    'overlay keeps no private large-tier scale');
});
})();
