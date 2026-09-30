// Residential yards grow a little long grass and scrub, MIXED IN WITH THE
// RUBBLE: the same yard-rock cluster lane places both (worldgen.js ›
// _spawnRockClustersSteps records each fired residential pivot; the yard flora
// scatters around those pivots from its OWN salted stream) and the same
// post-pass rule culls both (`_mrDrop` — road/band, one-cell building moat,
// POI plaza/frontage, the residential frontage rule via isSpawnCell).
//
// Drives the REAL rasterizer over a synthetic suburb, like spawn_roads.test.js.
(function () {
const T = WorldGen.T;
const CPE = 64;
const TILE_EDGE_M = CPE * 7;          // cellWidthM === 7 exactly
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const cellToMvt = (c) => c * CELL_MVT + CELL_MVT / 2;
const ring = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
const line = ring;
const ROAD_TIERS = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG]);
const TX = 3, TY = 5;                 // off the origin, so world ≠ tile-local metres
// World metres → this tile's local cell (x and y each carry their tile origin).
const cellX = (x) => Math.floor((x - TX * TILE_EDGE_M) / (TILE_EDGE_M / CPE));
const cellY = (y) => Math.floor((y - TY * TILE_EDGE_M) / (TILE_EDGE_M / CPE));

// A whole-tile residential block on a street grid, with a scatter of 2×2
// houses so the building moat has something to refuse.
function suburb() {
  const streets = [];
  for (const k of [8, 24, 40, 56]) {
    streets.push({ type: 2, tags: { class: 'minor' }, geom: [line([[0, k], [CPE - 1, k]])] });
    streets.push({ type: 2, tags: { class: 'minor' }, geom: [line([[k, 0], [k, CPE - 1]])] });
  }
  const houses = [];
  for (const [hx, hy] of [[12, 12], [28, 12], [44, 28], [12, 44], [48, 48], [30, 30]]) {
    houses.push({ type: 3, tags: {}, geom: [ring([[hx, hy], [hx + 2, hy], [hx + 2, hy + 2], [hx, hy + 2]])] });
  }
  return [
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'residential' },
        geom: [ring([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]])] },
    ] },
    { name: 'building', features: houses },
    { name: 'transportation', features: streets },
  ];
}
const rasterize = () => WorldGen.rasterizeTile(suburb(), CPE, TX, TY, TILE_EDGE_M);

const isYard = (wp) => /_ry$/.test(wp.id);
const cellIdx = (p) => cellY(p.y) * CPE + cellX(p.x);

// Measured on this fixture BEFORE the yard lane existed. The yard flora draws
// from its own salted stream and only joins `wildplants` after every older
// plant, so neither the rocks nor the older plants may move by one cell.
// (The rock hash was re-pinned when ids moved from frame metres to tile +
// local cell, `mr_${tx}_${ty}_${ix}_${iy}`: the same 395 rocks on the same
// cells — the old-format ids rebuilt from these positions still hash to the
// old 3517605594.)
// MOVED (Sep 2026, street variants): residential rubble no longer scatters
// through the lots — the lot walk runs DRY (every draw, no rock) so the yard
// flora around its fired pivots is exactly what it was, and the rocks now
// line a quarter of the minor streets (worldgen spawnStreetRocksSteps, off
// StreetVariants.rocksFor). The 395 lot rocks this fixture pinned are gone.
// RE-PINNED with the move: 32 → 40 older plants, because cells the lot rubble
// used to hold (the occupancy pass: a rock claimed its cell first) are free.
// RE-PINNED (Sep 2026, denser street rocks — STREET_ROCK_PIVOT_M 20 → 10):
// 40 → 39, one older plant's cell now holds a street rock (occupancy).
// The biome stream's pre-ownership source remains stable; special street
// corridors now remove only plants inside their claimed area.
const OLDER_PLANTS_BEFORE = { n: 39, hash: 3112412394 };

test('residential yard flora: street ownership only removes older plants inside its corridor', () => {
  const r = rasterize();
  const rocks = r.objects.filter((o) => o.kind === 'mineralrock');
  for (const o of rocks) assert.truthy(o._street, `${o.id} is a street rock, not lot rubble`);
  const source = r.caveSource.wildplants.filter((p) => !isYard(p));
  const sourceIds = source.map((p) => p.id).sort();
  assert.eq(fnv1a(sourceIds.join('|')), OLDER_PLANTS_BEFORE.hash, 'the older plant stream did not reroll');
  assert.eq(sourceIds.length, OLDER_PLANTS_BEFORE.n);
  const expected = source.filter((p) => !r.streetArea[cellIdx(p)]).map((p) => p.id).sort();
  const older = r.wildplants.filter((p) => !isYard(p)).map((p) => p.id).sort();
  assert.eq(older.join('|'), expected.join('|'), 'only owned corridor plants are cleared');
});

test('residential yard flora: both long grass and shrubs grow on residential cells', () => {
  const { wildplants, grid } = rasterize();
  const yard = wildplants.filter(isYard);
  const onRes = (crop) => yard.filter((p) => p.crop === crop && grid[cellIdx(p)] === T.RESIDENTIAL).length;
  assert.gt(onRes('longgrass'), 0, 'long grass grows in the yards');
  assert.gt(onRes('shrub'), 0, 'shrubs grow in the yards');
  for (const p of yard) {
    // A try at the polygon's rim can land on a cell painted as something
    // else (the rocks spill the same way); it then lives by that cell's rule.
    assert.eq(p._biome, grid[cellIdx(p)], `${p.id} stamped with its cell's biome`);
    assert.eq(p._yard, undefined, `${p.id}: the lane flag does not leak`);
    assert.eq(p._ix, undefined, `${p.id}: scratch cell does not leak`);
  }
});

test('residential yard flora: still grows, roughly half grass half scrub', () => {
  const { wildplants } = rasterize();
  const yard = wildplants.filter(isYard);
  const grass = yard.filter((p) => p.crop === 'longgrass').length;
  assert.gt(yard.length, 50, 'the yards still grow (the dry lot walk keeps its pivots)');
  assert.inRange(grass / yard.length, 0.35, 0.65, 'long grass share of the yard flora');
});

test('residential yard flora: the rocks that remain sit on a kerb — within four cells of a road band', () => {
  // (MOVED: this used to pin the flora growing among the lot rubble.)
  const { objects, roadMask } = rasterize();
  for (const o of objects.filter((q) => q.kind === 'mineralrock')) {
    const cx = cellX(o.x), cy = cellY(o.y);
    let near = false;
    for (let dy = -4; dy <= 4 && !near; dy++) {
      for (let dx = -4; dx <= 4 && !near; dx++) {
        const x = cx + dx, y = cy + dy;
        near = x >= 0 && y >= 0 && x < CPE && y < CPE && roadMask[y * CPE + x] === 1;
      }
    }
    assert.truthy(near, `${o.id} is on a street verge`);
  }
});

test('residential yard flora: never on a road, a road band, a building or its moat, nor an occupied cell', () => {
  const { wildplants, objects, grid, roadMask } = rasterize();
  const taken = new Map();
  for (const o of objects) taken.set(cellIdx(o), o.id);
  for (const p of wildplants) {
    const i = cellIdx(p);
    assert.falsy(taken.has(i), `${p.id} shares a cell with ${taken.get(i)}`);
    taken.set(i, p.id);
  }
  for (const p of wildplants.filter(isYard)) {
    const cx = cellX(p.x), cy = cellY(p.y);
    assert.falsy(ROAD_TIERS.has(grid[cy * CPE + cx]), `${p.id} on road terrain`);
    assert.eq(roadMask[cy * CPE + cx], 0, `${p.id} under the road band`);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = grid[(cy + dy) * CPE + cx + dx];
      assert.falsy(t === T.BUILDING || t === T.BUILDING_MED || t === T.BUILDING_LARGE,
        `${p.id} inside a building's one-cell moat`);
    }
    // The residential frontage rule the rocks obey (near a road/public ground).
    assert.truthy(WorldGen.isSpawnCell(grid, CPE, CPE, cx, cy, { roadMask }),
      `${p.id} fails the shared spawn rule`);
  }
});

test('residential yard flora: ids are position-derived and reproduce exactly', () => {
  const a = rasterize().wildplants.filter(isYard).map((p) => `${p.id}:${p.crop}`).sort();
  const b = rasterize().wildplants.filter(isYard).map((p) => `${p.id}:${p.crop}`).sort();
  assert.eq(a.join('|'), b.join('|'), 'same tile, same yard flora');
  for (const s of a) {
    const [id] = s.split(':');
    assert.truthy(/^wp_3_5_\d+_\d+_ry$/.test(id), `${id} is a position id with the yard suffix`);
  }
});

test('residential yard flora: a lawn-wide grass scatter still dies on residential cells', () => {
  // A grass landcover under the suburb scatters long grass tile-wide; only
  // the yard lane (and the urban profile's mushrooms) may grow on a cell that
  // ends up residential — the yard is not a licence for lawn spill.
  const layers = suburb();
  layers.unshift({ name: 'landcover', features: [
    { type: 3, tags: { class: 'grass' },
      geom: [ring([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]])] },
  ] });
  const { wildplants, grid } = WorldGen.rasterizeTile(layers, CPE, TX, TY, TILE_EDGE_M);
  for (const p of wildplants) {
    if (grid[cellIdx(p)] !== T.RESIDENTIAL) continue;
    assert.truthy(isYard(p) || p.crop === 'mushroom', `${p.id} (${p.crop}) spilled onto a residential cell`);
  }
});

test('waste ground keeps its rubble: the lot scatter runs dry on RESIDENTIAL only', () => {
  // The same street grid over an unclassified landuse (railway → WASTELAND):
  // the old lot scatter lays its rock clusters there, same generator, same
  // stream shape, where the residential version of the block holds none.
  assert.truthy(WorldGen.LOT_ROCK_DRY.has(T.RESIDENTIAL), 'residential yards are dry');
  assert.falsy(WorldGen.LOT_ROCK_DRY.has(T.WASTELAND), 'waste ground is not');
  const layers = suburb();
  layers[0] = { name: 'landuse', features: [
    { type: 3, tags: { class: 'brownfield' }, geom: [ring([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]])] }] };
  const w = WorldGen.rasterizeTile(layers, CPE, TX, TY, TILE_EDGE_M);
  const lotRocks = w.objects.filter((o) => o.kind === 'mineralrock' && !o._street
    && w.grid[cellIdx(o)] === T.WASTELAND);
  assert.gt(lotRocks.length, 10, `waste lots hold rubble (${lotRocks.length})`);
  for (const o of lotRocks) {
    assert.truthy(WorldGen.isSpawnCell(w.grid, CPE, CPE, cellX(o.x), cellY(o.y), { roadMask: w.roadMask, pois: [] }),
      `${o.id} passes the shared lot rule`);
  }
  const res = rasterize().objects.filter((o) => o.kind === 'mineralrock' && !o._street);
  assert.eq(res.length, 0, 'the residential block holds none');
});
})();
