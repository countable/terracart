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
const ROCKS_BEFORE = { n: 395, hash: 3517605594 };
const OLDER_PLANTS_BEFORE = { n: 32, hash: 2568163975 };

test('residential yard flora: rocks and older wild plants are exactly where they were', () => {
  const r = rasterize();
  const rocks = r.objects.filter((o) => o.kind === 'mineralrock').map((o) => o.id).sort();
  assert.eq(rocks.length, ROCKS_BEFORE.n, 'residential rock count');
  assert.eq(fnv1a(rocks.join('|')), ROCKS_BEFORE.hash, 'residential rock ids');
  const older = r.wildplants.filter((p) => !isYard(p)).map((p) => p.id).sort();
  assert.eq(older.length, OLDER_PLANTS_BEFORE.n, 'older wild plant count');
  assert.eq(fnv1a(older.join('|')), OLDER_PLANTS_BEFORE.hash, 'older wild plant ids');
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

test('residential yard flora: about as common as the rocks, roughly half grass half scrub', () => {
  const { wildplants, objects } = rasterize();
  const rocks = objects.filter((o) => o.kind === 'mineralrock').length;
  const yard = wildplants.filter(isYard);
  const grass = yard.filter((p) => p.crop === 'longgrass').length;
  assert.inRange(yard.length / rocks, 0.6, 1.4, 'yard flora per residential rock');
  assert.inRange(grass / yard.length, 0.35, 0.65, 'long grass share of the yard flora');
});

test('residential yard flora: grows AMONG the rocks — nearly every plant is near a rock', () => {
  // Not every one: the flora rings a pivot wider than its rocks, so where the
  // frontage rule culls a cluster's back-yard core the road-side fringe of
  // grass can outlive every rock of it.
  const { wildplants, objects } = rasterize();
  const rockCells = new Set(objects.filter((o) => o.kind === 'mineralrock').map(cellIdx));
  const yard = wildplants.filter(isYard);
  let nearN = 0;
  for (const p of yard) {
    const cx = cellX(p.x), cy = cellY(p.y);
    let near = false;
    for (let dy = -3; dy <= 3 && !near; dy++) {
      for (let dx = -3; dx <= 3 && !near; dx++) near = rockCells.has((cy + dy) * CPE + cx + dx);
    }
    if (near) nearN++;
  }
  assert.gte(nearN / yard.length, 0.9, 'share of yard plants with a rock within three cells');
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
})();
