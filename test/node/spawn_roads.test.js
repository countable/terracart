// Regression guard: NOTHING SPAWNS ON A ROAD.
//
// This has come back several times, and the reason it kept coming back is that
// every fix checked the wrong thing. The terrain grid is a lossy record of
// where the roads are:
//   • every way rasterizes exactly ONE cell wide whatever its class, while the
//     road-geometry overlay draws it at its real carriageway width — so a
//     motorway's band covers a full cell past its ROAD_LG cells on both sides,
//     and anything seated there is drawn sitting in the traffic;
//   • parking aisles are not roads at all (WorldGen.isParkingAisle): no
//     terrain cell, no overlay band, no mask — a lot is open ground, and
//     things may legitimately spawn all over it.
// A filter that reads grid[] alone says "grass" for both. WorldGen.rasterizeTile
// therefore also builds `roadMask` — the ground the overlay actually covers,
// measured from the same width function the overlay strokes with
// (roadOverlayWidthM) — and every spawn filter consults it.
//
// "Road ground" is a cell the UNION of the drawn bands covers at least
// WorldGen.ROAD_MASK_MIN_COVER (a half) of. It used to be ANY overlap; since
// Sep 2026 a cell with a sliver of band across its edge is ground again, and
// may host a spawn. The invariant tests below restate that rule on their own
// (bandCover: a fine sample of the fixture's bands) rather than trusting the
// mask to police itself.
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
      // -yard frontage rule is a separate test's business. Its store (the
      // shop POI below) is the nearest POI, so the lot is open ground
      // (COMMERCIAL_GROUND: commercial ground takes its nearest POI's kind).
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
      // An ordinary street — 5.5 m, 79 % of the cell it runs down the
      // middle of, so mask === paint.
      { type: 2, tags: { class: 'minor' },
        geom: [line([[0, 10], [CPE - 1, 10]])] },
      // Parking aisles: dropped ENTIRELY (WorldGen.isParkingAisle) — no
      // terrain, no band, no mask. The lot is open ground with an X on it.
      { type: 2, tags: { class: 'service', service: 'parking_aisle' },
        geom: [line([[44, 20], [56, 20]]), line([[44, 24], [56, 24]])] },
    ] },
    { name: 'poi', features: [
      { type: 1, tags: { class: 'parking' },
        geom: [[{ x: cellToMvt(50), y: cellToMvt(20) }]] },   // anchor ON an aisle
      { type: 1, tags: { class: 'shop', subclass: 'supermarket' },
        geom: [[{ x: cellToMvt(50), y: cellToMvt(29) }]] },   // the store
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

// The band is a CONTINUOUS stroke, not a run of whole cells — and a cell is
// road only once the drawn band covers HALF of it. A band that clips a cell's
// edge leaves it ground.
// A tile with one landuse under a list of [class, x-in-cells] vertical ways.
function verticalWays(ways) {
  return [
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'residential' }, geom: [wholeTile()] },
    ] },
    { name: 'transportation', features: ways.map(([cls, x]) => (
      { type: 2, tags: { class: cls },
        geom: [[{ x: x * CELL_MVT, y: 0 }, { x: x * CELL_MVT, y: EXTENT }]] })) },
  ];
}
// The band's width in cells (the fixture's cells are exactly CELL_M = 7 m).
const bandCells = (cls) => WorldGen.roadOverlayWidthM({ class: cls }) / 7;
// Centre a way of class `cls` so its band spans [x0, x0 + width] in cells.
const wayFrom = (cls, x0) => [cls, x0 + bandCells(cls) / 2];

test('roadMask: the threshold is half the cell', () => {
  assert.eq(WorldGen.ROAD_MASK_MIN_COVER, 0.5, 'a cell is road once the band covers half of it');
});

test('roadMask: a band covering ~30% of a cell leaves it ground', () => {
  // A 2.5 m cycleway band from x = 19.943 to 20.3: 30 % of column 20.
  const x0 = 20.3 - bandCells('cycleway');
  const { roadMask } = WorldGen.rasterizeTile(verticalWays([wayFrom('cycleway', x0)]), CPE, 0, 0, TILE_EDGE_M);
  assert.eq(roadMask[30 * CPE + 20], 0, 'a 30 % sliver is not road ground');
  assert.eq(roadMask[30 * CPE + 19], 0, 'nor the 6 % the band leaves in the west neighbour');
});

test('roadMask: a band covering ~70% of a cell masks it', () => {
  // A 6 m pedestrian band from x = 19.843 to 20.7: 70 % of column 20.
  const x0 = 20.7 - bandCells('pedestrian');
  const { roadMask } = WorldGen.rasterizeTile(verticalWays([wayFrom('pedestrian', x0)]), CPE, 0, 0, TILE_EDGE_M);
  assert.eq(roadMask[30 * CPE + 20], 1, '70 % is road ground');
  assert.eq(roadMask[30 * CPE + 19], 0, 'the 16 % spill west is not');
  assert.eq(roadMask[30 * CPE + 21], 0, 'nor anything east of the band');
});

test('roadMask: two parallel bands, each under half, mask the cell their UNION half-covers', () => {
  // Two 2.5 m cycleways side by side across column 20: [20.02, 20.377] and
  // [20.35, 20.707]. Each alone covers ~36 %; together ~69 %.
  const a = wayFrom('cycleway', 20.02), b = wayFrom('cycleway', 20.35);
  const at = (ways) => WorldGen.rasterizeTile(verticalWays(ways), CPE, 0, 0, TILE_EDGE_M).roadMask[30 * CPE + 20];
  assert.eq(at([a]), 0, 'the first band alone is under half');
  assert.eq(at([b]), 0, 'the second band alone is under half');
  assert.eq(at([a, b]), 1, 'their union is over half — coverage is summed across bands');
  // …as a UNION: the same ground drawn twice is still the same ground.
  assert.eq(at([a, a]), 0, 'one band stamped twice does not count double');
});

test('roadMask: a 5.5 m street straddling a cell boundary masks neither side', () => {
  // The band runs down the boundary between columns 19 and 20 → 2.75 m of
  // asphalt in each 7 m cell, 39 %. Neither is MOSTLY road. (One of them is
  // still painted ROAD terrain by the rasterizer, and that cell is refused on
  // walkability — the mask is only the half of the rule the grid can't see.)
  const { grid, roadMask } = WorldGen.rasterizeTile(verticalWays([['minor', 20]]), CPE, 0, 0, TILE_EDGE_M);
  const row = 30;
  assert.eq(roadMask[row * CPE + 19], 0, 'west side: 39 % is not road ground');
  assert.eq(roadMask[row * CPE + 20], 0, 'east side neither');
  assert.truthy(ROAD_TIERS.has(grid[row * CPE + 19]) || ROAD_TIERS.has(grid[row * CPE + 20]),
    'the way still paints one of the two as road terrain');
});

test('roadMask: a 9 m street straddling a cell boundary masks both sides', () => {
  // 4.5 m of a secondary's band in each 7 m cell, 64 %: both mostly road.
  const { roadMask } = WorldGen.rasterizeTile(verticalWays([['secondary', 20]]), CPE, 0, 0, TILE_EDGE_M);
  const row = 30;
  assert.eq(roadMask[row * CPE + 19], 1, 'west side masked');
  assert.eq(roadMask[row * CPE + 20], 1, 'east side masked');
  assert.eq(roadMask[row * CPE + 18], 0, 'one cell further west is open ground');
  assert.eq(roadMask[row * CPE + 21], 0, 'one cell further east too');
});

test('roadMask: a 2 m footpath never makes road ground on its own', () => {
  // A 2 m band is 29 % of a 7 m cell wherever it runs — a footpath's cells
  // are PATH terrain (walkable), and with the half rule the mask no longer
  // claims them. What lies next to a footpath is ground.
  const wayX = 41 - 0.5 / 7;   // hugging the 40|41 boundary, spilling 0.5 m east
  const { roadMask } = WorldGen.rasterizeTile(verticalWays([['footway', wayX]]), CPE, 0, 0, TILE_EDGE_M);
  const row = 30;
  for (const cx of [39, 40, 41, 42]) assert.eq(roadMask[row * CPE + cx], 0, `column ${cx} is not road ground`);
});

test('roadMask: parking aisles are not roads — masked nowhere on the lot', () => {
  const { grid, roadMask } = rasterize();
  for (const row of [20, 24]) {
    for (let cx = 44; cx <= 56; cx++) {
      const i = row * CPE + cx;
      assert.falsy(ROAD_TIERS.has(grid[i]), 'aisle paints no road cell (by design)');
      assert.eq(roadMask[i], 0, 'aisle draws no band, so the lot is open ground');
    }
  }
});

// ─── The invariant ───────────────────────────────────────────────────────────
//
// bandCover(cx, cy): how much of cell (cx, cy) the fixture's drawn bands cover,
// measured here on a fine 32 × 32 grid — an independent restatement of the
// rule, not a read of the mask. Every fixture way is axis-aligned, which is
// where the mask's 16-sample lattice is exact to a sixteenth, so a spawn must
// sit on a cell covered under half plus that sixteenth.
function bandsOf(layers) {
  const out = [];
  for (const f of layers.find((l) => l.name === 'transportation').features) {
    if (WorldGen.isParkingAisle(f.tags)) continue;   // aisles draw no band
    const halfW = WorldGen.roadOverlayWidthM(f.tags) / 7 / 2;
    for (const ln of f.geom) {
      for (let i = 1; i < ln.length; i++) {
        out.push({ ax: ln[i - 1].x / CELL_MVT, ay: ln[i - 1].y / CELL_MVT,
                   bx: ln[i].x / CELL_MVT,     by: ln[i].y / CELL_MVT, r2: halfW * halfW });
      }
    }
  }
  return out;
}
const FIXTURE_BANDS = bandsOf(fixtureLayers());
function bandCover(cx, cy, bands = FIXTURE_BANDS) {
  const S = 32;
  let hit = 0;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const px = cx + (i + 0.5) / S, py = cy + (j + 0.5) / S;
    for (const b of bands) {
      const dx = b.bx - b.ax, dy = b.by - b.ay, l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((px - b.ax) * dx + (py - b.ay) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = b.ax + t * dx - px, qy = b.ay + t * dy - py;
      if (qx * qx + qy * qy < b.r2) { hit++; break; }
    }
  }
  return hit / (S * S);
}
const SPAWN_COVER_MAX = WorldGen.ROAD_MASK_MIN_COVER + 1 / 16;

// The mask against the fine restatement, cell by cell: the fixture (bands
// centred in their cells) and a layout of ways that CLIP cells — edges at
// awkward offsets, two bands sharing a cell — so both sides of the line get
// exercised. Axis-aligned, where the mask's lattice is good to a sixteenth.
function assertMaskAgrees(layers, label) {
  const { roadMask } = WorldGen.rasterizeTile(layers, CPE, 0, 0, TILE_EDGE_M);
  const bands = bandsOf(layers);
  let over = 0, under = 0;
  for (let cy = 0; cy < CPE; cy++) for (let cx = 0; cx < CPE; cx++) {
    const c = bandCover(cx, cy, bands);
    if (c >= SPAWN_COVER_MAX) { over++; assert.eq(roadMask[cy * CPE + cx], 1, `${label} ${cx},${cy} is ${Math.round(c * 100)}% band, unmasked`); }
    else if (c > 0 && c <= WorldGen.ROAD_MASK_MIN_COVER - 1 / 16) { under++; assert.eq(roadMask[cy * CPE + cx], 0, `${label} ${cx},${cy} is ${Math.round(c * 100)}% band, masked`); }
  }
  return { over, under };
}
test('roadMask agrees with the drawn bands: mostly covered is masked, clipped is not', () => {
  const fx = assertMaskAgrees(fixtureLayers(), 'fixture');
  assert.gt(fx.over, 0, 'fixture has cells mostly under a band');
  const clip = assertMaskAgrees(verticalWays([
    wayFrom('cycleway', 10.3 - bandCells('cycleway')),   // 30 % of column 10
    wayFrom('pedestrian', 15.1),                          // 86 % of 15
    ['minor', 20], ['secondary', 26],                     // straddling boundaries
    wayFrom('track', 33.6), wayFrom('cycleway', 33.2),    // two bands sharing column 33
    ['tertiary', 40.8],
  ]), 'clip');
  assert.gt(clip.over, 0, 'clip layout has cells mostly under a band');
  assert.gt(clip.under, 0, 'clip layout has cells a band only clips');
});

test('no scatter object survives on a road cell or on ground mostly under a road band', () => {
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
    assert.lt(bandCover(ix, iy), SPAWN_COVER_MAX,
      `${o.kind} on a cell mostly under a drawn band at ${ix},${iy}`);
  }
  assert.gt(checked, 0, 'fixture produced scatter objects to check');
});

test('no wild plant survives on a road cell or on ground mostly under a road band', () => {
  const { grid, wildplants, roadMask } = rasterize();
  assert.gt(wildplants.length, 0, 'fixture produced wild plants to check');
  for (const wp of wildplants) {
    const ix = cellOf(wp.x), iy = cellOf(wp.y);
    if (ix < 0 || iy < 0 || ix >= CPE || iy >= CPE) continue;
    assert.falsy(ROAD_TIERS.has(grid[iy * CPE + ix]),
      `${wp.crop} on road terrain at ${ix},${iy}`);
    assert.eq(roadMask[iy * CPE + ix], 0,
      `${wp.crop} under the road band at ${ix},${iy}`);
    assert.lt(bandCover(ix, iy), SPAWN_COVER_MAX,
      `${wp.crop} on a cell mostly under a drawn band at ${ix},${iy}`);
  }
});

test('a parking X anchored on an aisle stays there — an aisle is open ground', () => {
  const { grid, parkingTreasures, roadMask } = rasterize();
  assert.eq(parkingTreasures.length, 1, 'the lot still gets its treasure');
  const t = parkingTreasures[0];
  const ix = cellOf(t.x), iy = cellOf(t.y);
  // The anchor cell is ON an aisle, and an aisle is no longer road: the X is
  // not walked anywhere, and its own cell is a legitimate spawn cell as-is.
  assert.eq(ix, 50, 'X kept its anchor column');
  assert.eq(iy, 20, 'X kept its anchor row');
  assert.eq(roadMask[iy * CPE + ix], 0, 'no band under the aisle');
  assert.truthy(WorldGen.isSpawnCell(grid, CPE, CPE, ix, iy, { roadMask }),
    'X sits on a legitimate spawn cell');
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

test('isSpawnCell: opts.occupied refuses a cell an object or wild plant already holds', () => {
  const w = 5, h = 5;
  const grid = new Uint8Array(w * h);          // all GRASS, all walkable
  const occupied = new Set([2 * w + 2]);       // a rock, a tree, a tuft of grass — any of them
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'unoccupied by default');
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 2, 2, { occupied }), 'refused once claimed');
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 1, 2, { occupied }), 'neighbour unaffected');
  // Stacks with the road mask rather than replacing it — both halves of "don't
  // spawn here" apply at once.
  const roadMask = new Uint8Array(w * h);
  roadMask[3 * w + 3] = 1;
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 2, 2, { occupied, roadMask }), 'still refused: occupied');
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 3, 3, { occupied, roadMask }), 'still refused: road');
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 0, 0, { occupied, roadMask }), 'clear cell passes both');
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

// ─── Cave entrances (staircases) ─────────────────────────────────────────────
//
// maybePlaceCaveEntrance runs AFTER rasterizeTile, inside loadTile
// (worldgen.js:3294) — the "descend" staircase it drops is a spawn like any
// other, but its gate (stairCellOK) re-implements the occupancy/building/
// chest checks by hand instead of calling isSpawnCell, and until now it
// forgot the one this whole file is about: entry.roadMask. Both of its
// placement paths could land a ladder under a drawn road band the terrain
// grid never records:
//   • placeRandomWalkable (the per-tile guarantee on a tile with no cave
//     rock) scans EVERY walkable cell with no mask check at all — worst
//     case, dead centre of a parking lot, which paints no road cell to
//     begin with;
//   • placeBeside (anchored to a residential rock cluster) picks the first
//     of the 8 cells touching the rock that passes stairCellOK, which could
//     be a cell a motorway's band covers without ever painting ROAD terrain
//     there.
// rasterizeTile alone can't reproduce this — staircases don't exist until
// maybePlaceCaveEntrance runs — so these tests call it directly the same way
// loadTile does, off entry shapes either hand-built (to force each path
// deterministically) or taken straight from the real rasterizer.

test('maybePlaceCaveEntrance: placeRandomWalkable never seats a stair under the road band', () => {
  // No cave rock anywhere -> the per-tile guarantee falls through to
  // placeRandomWalkable. Mask every cell but one; a working gate MUST place
  // the guaranteed entrance on that one survivor, every time.
  const N = 8, cellM = 7, edgeM = N * cellM;
  for (let tx = 0; tx < 12; tx++) {
    const grid = new Uint8Array(N * N).fill(T.GRASS);
    const roadMask = new Uint8Array(N * N).fill(1);
    roadMask[0] = 0;   // cell (0,0) is the only legal spawn on the whole tile
    const entry = { cellsPerEdge: N, grid, roadMask, objects: [], poiPadCells: null };
    WorldGen.maybePlaceCaveEntrance(entry, tx, 9, edgeM);
    const stairs = entry.objects.filter(o => o.kind === 'staircase');
    assert.eq(stairs.length, 1, `tx=${tx}: the per-tile guarantee still fires`);
    const lix = Math.floor((stairs[0].x - tx * edgeM) / cellM);
    const liy = Math.floor((stairs[0].y - 9 * edgeM) / cellM);
    assert.eq(roadMask[liy * N + lix], 0, `tx=${tx}: stair landed on a masked cell`);
    assert.eq(lix, 0); assert.eq(liy, 0);
  }
});

test('maybePlaceCaveEntrance: placeBeside never seats a stair under the road band', () => {
  // One cave-rock cluster of one rock; mask 7 of its 8 neighbours, leaving
  // exactly one legal cell beside it. Sweep tx so both the 30% roll and the
  // "placed === 0" guarantee get exercised across many seeds — any hit on a
  // masked neighbour is the bug.
  const N = 8, cellM = 7, edgeM = N * cellM;
  const rlix = 4, rliy = 4;
  // placeBeside's dirs list tries [1,0] first — pick the LAST candidate it
  // tries ([-1,1]) as the one open neighbour, so a gate that ignores the mask
  // still finds a "legal" cell (the masked [1,0]) before ever reaching this
  // one, and the test can tell "ignored the mask" apart from "got lucky".
  const openDx = -1, openDy = 1;
  let anyPlaced = false;
  for (let tx = 0; tx < 200; tx++) {
    const grid = new Uint8Array(N * N).fill(T.GRASS);
    const roadMask = new Uint8Array(N * N);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (dx === openDx && dy === openDy) continue;
      roadMask[(rliy + dy) * N + (rlix + dx)] = 1;
    }
    const rockX = tx * edgeM + (rlix + 0.5) * cellM;
    const rockY = 1 * edgeM + (rliy + 0.5) * cellM;
    const objects = [{ kind: 'mineralrock', x: rockX, y: rockY, caveVariant: 0, _clusterId: 'c1' }];
    const entry = { cellsPerEdge: N, grid, roadMask, objects, poiPadCells: null };
    WorldGen.maybePlaceCaveEntrance(entry, tx, 1, edgeM);
    for (const o of entry.objects) {
      if (o.kind !== 'staircase') continue;
      anyPlaced = true;
      const lix = Math.floor((o.x - tx * edgeM) / cellM);
      const liy = Math.floor((o.y - 1 * edgeM) / cellM);
      assert.eq(roadMask[liy * N + lix], 0, `tx=${tx}: stair landed on a masked cell beside the rock`);
      assert.eq(lix, rlix + openDx); assert.eq(liy, rliy + openDy);
    }
  }
  assert.truthy(anyPlaced, 'fixture actually exercised placeBeside at least once across the sweep');
});

test('maybePlaceCaveEntrance: over the real rasterizer + road fixture, no stair lands on road terrain or under the mask', () => {
  // End-to-end version, off the real rasterizeTile output (residential block
  // + a motorway + a street, same fixture the rest of this file uses) —
  // swept across many tile coordinates so different rng draws hit both
  // placeBeside (residential cave rocks near the motorway) and the
  // placeRandomWalkable guarantee.
  let checked = 0;
  for (let tx = 0; tx < 20; tx++) {
    for (let ty = 0; ty < 3; ty++) {
      const { grid, roadMask, objects, poiPadCells } = WorldGen.rasterizeTile(fixtureLayers(), CPE, tx, ty, TILE_EDGE_M);
      const entry = { cellsPerEdge: CPE, grid, roadMask, objects: objects.slice(), poiPadCells };
      WorldGen.maybePlaceCaveEntrance(entry, tx, ty, TILE_EDGE_M);
      for (const o of entry.objects) {
        if (o.kind !== 'staircase') continue;
        checked++;
        const lix = Math.floor((o.x - tx * TILE_EDGE_M) / (TILE_EDGE_M / CPE));
        const liy = Math.floor((o.y - ty * TILE_EDGE_M) / (TILE_EDGE_M / CPE));
        assert.falsy(ROAD_TIERS.has(grid[liy * CPE + lix]),
          `tx=${tx},ty=${ty}: staircase on road terrain at ${lix},${liy}`);
        assert.eq(roadMask[liy * CPE + lix], 0,
          `tx=${tx},ty=${ty}: staircase under the road band at ${lix},${liy}`);
      }
    }
  }
  assert.gt(checked, 0, 'sweep produced staircases to check');
});
})();
