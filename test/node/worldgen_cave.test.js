// Headless unit tests for src/worldgen.js — pure exported surface only.
// Covers: makeRng, isWalkable, isSpawnCell, metersPerPixel, tileEdgeMeters,
// cellsPerEdgeForLat, lonLatToWorldPx, tileXYForLonLat, setDepth, forEachItem.
//
// Cave clustering, ore-vein zone logic, and auto-mine pathfinding live
// inside rasterizeTile / spawnCaveRocks / loadCaveTile in src/worldgen.js
// and src/app.js respectively.  Those paths require real MVT tile bytes,
// the fetch() network stack, IndexedDB, and (for auto-mine) full Phaser
// scene context — none of which are available headlessly.  They are NOT
// tested here; see the browser harness (test/harness.html + run_tests.py).
//
// Patch-history motivation:
//   7367f88 — rock-cluster jitter ±1 (RNG sequencing)
//   19e24e8 — vein zones / depth-scaled rarity (caveRockP curve)
//   4a8ed80 — cave auto-mine detours (browser-only, not covered here)

// ─── makeRng ─────────────────────────────────────────────────────────────────

test('makeRng: same seed reproduces identical first value', () => {
  const rng1 = WorldGen.makeRng(42);
  const rng2 = WorldGen.makeRng(42);
  assert.eq(rng1(), rng2(), 'first value matches');
});

test('makeRng: same seed reproduces identical 10-value sequence', () => {
  const rng1 = WorldGen.makeRng(12345);
  const rng2 = WorldGen.makeRng(12345);
  for (let i = 0; i < 10; i++) {
    assert.eq(rng1(), rng2(), 'value ' + i + ' matches');
  }
});

test('makeRng: different seeds produce divergent sequences', () => {
  const rng1 = WorldGen.makeRng(42);
  const rng2 = WorldGen.makeRng(99);
  // At least the first value must differ (mulberry32 with 57-apart seeds diverges immediately)
  const v1 = rng1(), v2 = rng2();
  assert.truthy(v1 !== v2, 'seeds 42 and 99 diverge on first draw');
});

test('makeRng: outputs in [0, 1)', () => {
  const rng = WorldGen.makeRng(0);
  for (let i = 0; i < 100; i++) {
    const v = rng();
    assert.gte(v, 0, 'value >= 0');
    assert.lt(v, 1, 'value < 1');
  }
});

test('makeRng: seed 0 produces a valid sequence', () => {
  const rng = WorldGen.makeRng(0);
  // Pin the first output so regressions in the PRNG algorithm are caught.
  // Computed from the mulberry32 implementation in worldgen.js.
  const first = rng();
  assert.inRange(first, 0, 1, 'first draw in [0,1)');
  // The specific value from mulberry32 with seed=0 (0x6d2b79f5 first step)
  assert.eq(first, 0.26642920868471265, 'mulberry32 seed=0 first value pinned');
});

test('makeRng: seed 0xFFFFFFFF (max uint32) stays in [0,1)', () => {
  const rng = WorldGen.makeRng(0xFFFFFFFF);
  for (let i = 0; i < 20; i++) {
    const v = rng();
    assert.gte(v, 0, 'seed max, draw ' + i + ' >= 0');
    assert.lt(v, 1, 'seed max, draw ' + i + ' < 1');
  }
});

test('makeRng: large seed treated as uint32 (seed > 2^31)', () => {
  // Should not throw or produce NaN — >>> 0 truncates to uint32.
  const rng = WorldGen.makeRng(0xDEADBEEF);
  const v = rng();
  assert.gte(v, 0, '>= 0');
  assert.lt(v, 1, '< 1');
});

// ─── isWalkable ──────────────────────────────────────────────────────────────

test('isWalkable: WATER is not walkable', () => {
  assert.falsy(WorldGen.isWalkable(WorldGen.T.WATER), 'WATER blocked');
});

test('isWalkable: ROAD is not walkable', () => {
  assert.falsy(WorldGen.isWalkable(WorldGen.T.ROAD), 'ROAD blocked');
});

test('isWalkable: ROAD_MD is not walkable', () => {
  assert.falsy(WorldGen.isWalkable(WorldGen.T.ROAD_MD), 'ROAD_MD blocked');
});

test('isWalkable: ROAD_LG is not walkable', () => {
  assert.falsy(WorldGen.isWalkable(WorldGen.T.ROAD_LG), 'ROAD_LG blocked');
});

test('isWalkable: BUILDING is not walkable', () => {
  assert.falsy(WorldGen.isWalkable(WorldGen.T.BUILDING), 'BUILDING blocked');
});

test('isWalkable: BUILDING_MED is not walkable', () => {
  assert.falsy(WorldGen.isWalkable(WorldGen.T.BUILDING_MED), 'BUILDING_MED blocked');
});

test('isWalkable: BUILDING_LARGE is not walkable', () => {
  assert.falsy(WorldGen.isWalkable(WorldGen.T.BUILDING_LARGE), 'BUILDING_LARGE blocked');
});

test('isWalkable: CAVE_WALL is not walkable', () => {
  assert.falsy(WorldGen.isWalkable(WorldGen.T.CAVE_WALL), 'CAVE_WALL blocked');
});

test('isWalkable: GRASS is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.GRASS), 'GRASS walkable');
});

test('isWalkable: FOREST is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.FOREST), 'FOREST walkable');
});

test('isWalkable: SAND is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.SAND), 'SAND walkable');
});

test('isWalkable: FARMLAND is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.FARMLAND), 'FARMLAND walkable');
});

test('isWalkable: RESIDENTIAL is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.RESIDENTIAL), 'RESIDENTIAL walkable');
});

test('isWalkable: PARK is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.PARK), 'PARK walkable');
});

test('isWalkable: PATH is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.PATH), 'PATH walkable');
});

test('isWalkable: ROCK is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.ROCK), 'ROCK walkable');
});

test('isWalkable: COMMERCIAL is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.COMMERCIAL), 'COMMERCIAL walkable');
});

test('isWalkable: INDUSTRIAL is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.INDUSTRIAL), 'INDUSTRIAL walkable');
});

test('isWalkable: PIER is walkable (wooden walkway over water)', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.PIER), 'PIER walkable');
});

test('isWalkable: CAVE_FLOOR is walkable', () => {
  assert.truthy(WorldGen.isWalkable(WorldGen.T.CAVE_FLOOR), 'CAVE_FLOOR walkable');
});

test('isWalkable: all terrain types either walkable or not (no type missing)', () => {
  // Every value in T.* should return a boolean from isWalkable, not throw.
  const T = WorldGen.T;
  const allTypes = Object.values(T);
  assert.truthy(allTypes.length > 0, 'T has entries');
  for (const t of allTypes) {
    const result = WorldGen.isWalkable(t);
    assert.truthy(result === true || result === false, 'isWalkable(' + t + ') returns boolean');
  }
});

// ─── isSpawnCell ─────────────────────────────────────────────────────────────

test('isSpawnCell: returns false for out-of-bounds cell', () => {
  const w = 5, h = 5;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.GRASS);
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, -1, 0, null), 'cx=-1 oob');
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 0, -1, null), 'cy=-1 oob');
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 5, 0, null), 'cx=w oob');
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 0, 5, null), 'cy=h oob');
});

test('isSpawnCell: WATER cell returns false (non-walkable)', () => {
  const w = 5, h = 5;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.GRASS);
  grid[2 * w + 2] = WorldGen.T.WATER;
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'water not spawnable');
});

test('isSpawnCell: ROAD cell returns false (non-walkable)', () => {
  const w = 5, h = 5;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.GRASS);
  grid[1 * w + 1] = WorldGen.T.ROAD;
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 1, 1, null), 'road not spawnable');
});

test('isSpawnCell: BUILDING cell returns false (non-walkable)', () => {
  const w = 5, h = 5;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.GRASS);
  grid[0] = WorldGen.T.BUILDING;
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 0, 0, null), 'building not spawnable');
});

test('isSpawnCell: GRASS cell returns true (open ground, always ok)', () => {
  const w = 5, h = 5;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.GRASS);
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'grass always spawnable');
});

test('isSpawnCell: PARK cell returns true (public open ground)', () => {
  const w = 5, h = 5;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.PARK);
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'park always spawnable');
});

test('isSpawnCell: CAVE_FLOOR returns true', () => {
  const w = 4, h = 4;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.CAVE_FLOOR);
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 1, 1, null), 'cave floor spawnable');
});

test('isSpawnCell: RESIDENTIAL cell in isolation (no road) returns false', () => {
  const w = 5, h = 5;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  // Cell (2,2) — all neighbours are also RESIDENTIAL, no road within frontage=3
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'isolated residential blocked');
});

test('isSpawnCell: RESIDENTIAL near ROAD (Chebyshev <= 3) returns true', () => {
  const w = 7, h = 7;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  grid[0] = WorldGen.T.ROAD;  // at (0,0)
  // (2,2): Chebyshev dist to (0,0) = max(2,2) = 2 <= 3 → spawnable
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'residential within 2 cells of road');
});

test('isSpawnCell: RESIDENTIAL too far from road (Chebyshev = 4) returns false', () => {
  const w = 9, h = 9;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  grid[0] = WorldGen.T.ROAD;  // at (0,0)
  // (4,4): Chebyshev dist = max(4,4) = 4 > 3 → not spawnable
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 4, 4, null), 'residential 4 cells from road blocked');
});

test('isSpawnCell: RESIDENTIAL exactly at frontage edge (Chebyshev = 3) returns true', () => {
  const w = 9, h = 9;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  grid[0] = WorldGen.T.ROAD;  // at (0,0)
  // (3,3): Chebyshev dist = max(3,3) = 3 == frontage → should include (inclusive check)
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 3, 3, null), 'residential at exact frontage=3 ok');
});

test('isSpawnCell: RESIDENTIAL near PATH (counted as public anchor) returns true', () => {
  const w = 7, h = 7;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  grid[1] = WorldGen.T.PATH;  // at (1,0)
  // (2,2): Chebyshev to (1,0) = max(1,2) = 2 <= 3 → spawnable
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'residential near path spawnable');
});

test('isSpawnCell: RESIDENTIAL near PARK (counted as public anchor) returns true', () => {
  const w = 7, h = 7;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  grid[0] = WorldGen.T.PARK;  // at (0,0)
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'residential near park spawnable');
});

test('isSpawnCell: RESIDENTIAL near SAND (counted as public anchor) returns true', () => {
  const w = 7, h = 7;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  grid[0] = WorldGen.T.SAND;
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'residential near sand spawnable');
});

test('isSpawnCell: RESIDENTIAL near PIER (counted as public anchor) returns true', () => {
  const w = 7, h = 7;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  grid[0] = WorldGen.T.PIER;
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 2, 2, null), 'residential near pier spawnable');
});

test('isSpawnCell: RESIDENTIAL with POI at Chebyshev <= 3 returns true', () => {
  const w = 9, h = 9;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  // No road anywhere; a POI at (1,1) — Chebyshev to (4,4) = 3 → spawnable
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 4, 4, { pois: [{ ix: 1, iy: 1 }] }),
    'residential within 3 of POI spawnable');
});

test('isSpawnCell: RESIDENTIAL with POI at Chebyshev = 4 returns false', () => {
  const w = 9, h = 9;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  // POI at (0,0), cell (4,4): Chebyshev = 4 > 3 → not spawnable
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 4, 4, { pois: [{ ix: 0, iy: 0 }] }),
    'residential with far POI blocked');
});

test('isSpawnCell: opts.frontage override is respected', () => {
  const w = 9, h = 9;
  const grid = new Uint8Array(w * h).fill(WorldGen.T.RESIDENTIAL);
  grid[0] = WorldGen.T.ROAD;  // at (0,0)
  // (4,4) is Chebyshev 4 from (0,0); default frontage=3 → blocked, but frontage=5 → ok
  assert.falsy(WorldGen.isSpawnCell(grid, w, h, 4, 4, { frontage: 3 }), 'frontage=3 blocked');
  assert.truthy(WorldGen.isSpawnCell(grid, w, h, 4, 4, { frontage: 5 }), 'frontage=5 allows');
});

// ─── metersPerPixel ───────────────────────────────────────────────────────────

test('metersPerPixel: returns positive value at equator', () => {
  const mpp = WorldGen.metersPerPixel(0, 14);
  assert.gt(mpp, 0, 'positive at equator');
});

test('metersPerPixel: pinned value at equator z14', () => {
  // 156543.03392 * cos(0) / (1<<14) = 156543.03392 / 16384 = 9.55462853515625
  const mpp = WorldGen.metersPerPixel(0, 14);
  assert.eq(mpp, 9.55462853515625, 'pinned equator z14');
});

test('metersPerPixel: decreases toward poles (cos relationship)', () => {
  const m0  = WorldGen.metersPerPixel(0,  14);
  const m30 = WorldGen.metersPerPixel(30, 14);
  const m60 = WorldGen.metersPerPixel(60, 14);
  const m80 = WorldGen.metersPerPixel(80, 14);
  assert.gt(m0,  m30, 'm(0) > m(30)');
  assert.gt(m30, m60, 'm(30) > m(60)');
  assert.gt(m60, m80, 'm(60) > m(80)');
});

test('metersPerPixel: at 60° lat is half the equatorial value (cos 60° = 0.5)', () => {
  const m0  = WorldGen.metersPerPixel(0,  14);
  const m60 = WorldGen.metersPerPixel(60, 14);
  // cos(60°) = 0.5 exactly in theory; float arithmetic produces a sub-ULP
  // difference (~4.4e-16 relative), so we allow 1e-9 absolute tolerance.
  const diff = Math.abs(m60 - m0 * 0.5);
  assert.lt(diff, 1e-9, 'mpp(60) ≈ 0.5 * mpp(0) within 1e-9');
});

test('metersPerPixel: scales with zoom (halves per zoom step)', () => {
  const mZ14 = WorldGen.metersPerPixel(0, 14);
  const mZ15 = WorldGen.metersPerPixel(0, 15);
  // 1<<15 = 2*(1<<14), so mpp halves at each zoom increase
  assert.eq(mZ15, mZ14 / 2, 'mpp halves per zoom step');
});

// ─── tileEdgeMeters ──────────────────────────────────────────────────────────

test('tileEdgeMeters: positive at equator', () => {
  const tem = WorldGen.tileEdgeMeters(0);
  assert.gt(tem, 0, 'positive');
});

test('tileEdgeMeters: pinned equator value', () => {
  // metersPerPixel(0, 14) * 256 = 9.55462853515625 * 256 = 2445.984905
  const tem = WorldGen.tileEdgeMeters(0);
  assert.eq(tem, 2445.984905, 'equator pinned');
});

test('tileEdgeMeters: decreases monotonically toward poles', () => {
  const t0  = WorldGen.tileEdgeMeters(0);
  const t30 = WorldGen.tileEdgeMeters(30);
  const t60 = WorldGen.tileEdgeMeters(60);
  const t80 = WorldGen.tileEdgeMeters(80);
  assert.gt(t0,  t30, 't(0) > t(30)');
  assert.gt(t30, t60, 't(30) > t(60)');
  assert.gt(t60, t80, 't(60) > t(80)');
});

test('tileEdgeMeters: proportional to metersPerPixel (= mpp * 256)', () => {
  const lat = 51.5;
  const tem = WorldGen.tileEdgeMeters(lat);
  const mpp = WorldGen.metersPerPixel(lat, 14);
  assert.eq(tem, mpp * 256, 'tileEdgeMeters = mpp * TILE_PX');
});

// ─── cellsPerEdgeForLat ───────────────────────────────────────────────────────

test('cellsPerEdgeForLat: returns positive integer at equator', () => {
  const cpe = WorldGen.cellsPerEdgeForLat(0);
  assert.gt(cpe, 0, 'positive');
  assert.eq(cpe, Math.round(cpe), 'integer (Math.round applied)');
});

test('cellsPerEdgeForLat: pinned equator value (2445.98/5 ≈ 489)', () => {
  const cpe = WorldGen.cellsPerEdgeForLat(0);
  assert.eq(cpe, 489, 'equator = 489 cells');
});

test('cellsPerEdgeForLat: decreases toward poles', () => {
  const c0  = WorldGen.cellsPerEdgeForLat(0);
  const c20 = WorldGen.cellsPerEdgeForLat(20);
  const c40 = WorldGen.cellsPerEdgeForLat(40);
  const c60 = WorldGen.cellsPerEdgeForLat(60);
  const c80 = WorldGen.cellsPerEdgeForLat(80);
  assert.gt(c0, c20,  'c(0) > c(20)');
  assert.gt(c20, c40, 'c(20) > c(40)');
  assert.gt(c40, c60, 'c(40) > c(60)');
  assert.gt(c60, c80, 'c(60) > c(80)');
});

test('cellsPerEdgeForLat: at 60 lat is ~245 cells', () => {
  // tileEdgeMeters(60) = mpp(60,14)*256 = 4.777...*256 = 1222.99... / 5 = 244.6 -> round = 245
  const cpe = WorldGen.cellsPerEdgeForLat(60);
  assert.eq(cpe, 245, '60° lat = 245 cells');
});

// ─── lonLatToWorldPx ─────────────────────────────────────────────────────────

test('lonLatToWorldPx: lon=-180 gives x=0 (left edge of world)', () => {
  const { x } = WorldGen.lonLatToWorldPx(-180, 0, 14);
  assert.eq(x, 0, 'left edge x=0');
});

test('lonLatToWorldPx: lon=0, lat=0 gives x = n/2 (prime meridian at centre)', () => {
  // n = (1<<14)*256 = 4194304; x = 180/360*n = n/2 = 2097152
  const { x } = WorldGen.lonLatToWorldPx(0, 0, 14);
  assert.eq(x, 2097152, 'prime meridian x = 2097152');
});

test('lonLatToWorldPx: lat=0 gives y = n/2 (equator at centre)', () => {
  // sin(0)=0; y = (0.5 - log(1/1)/(4π)) * n = 0.5*n = 2097152
  const { y } = WorldGen.lonLatToWorldPx(0, 0, 14);
  assert.eq(y, 2097152, 'equator y = 2097152');
});

test('lonLatToWorldPx: pixel coords match tile*TILE_PX for a real-world point (NYC)', () => {
  // NYC: lon≈-74.006, lat≈40.7128; expected tile (4823,6160) at z14
  const px = WorldGen.lonLatToWorldPx(-74.006, 40.7128, 14);
  const TILE_PX = 256;
  assert.eq(Math.floor(px.x / TILE_PX), 4823, 'NYC tile x = 4823');
  assert.eq(Math.floor(px.y / TILE_PX), 6160, 'NYC tile y = 6160');
});

test('lonLatToWorldPx: x increases eastward (lon increases → x increases)', () => {
  const p1 = WorldGen.lonLatToWorldPx(0,   0, 14);
  const p2 = WorldGen.lonLatToWorldPx(10,  0, 14);
  assert.gt(p2.x, p1.x, 'x increases eastward');
});

test('lonLatToWorldPx: y increases southward (Web Mercator, higher lat → smaller y)', () => {
  // In web mercator, y=0 is top (north), so lat=50 has SMALLER y than lat=0
  const p_north = WorldGen.lonLatToWorldPx(0, 50, 14);
  const p_south = WorldGen.lonLatToWorldPx(0,  0, 14);
  assert.lt(p_north.y, p_south.y, 'northern lat gives smaller y (top of screen)');
});

// ─── tileXYForLonLat ─────────────────────────────────────────────────────────

test('tileXYForLonLat: lon=0, lat=0 gives tile (8192, 8192) at z14', () => {
  // n = 1<<14 = 16384 tiles; (0+180)/360*16384 = 8192; equator y = 8192
  const { x, y } = WorldGen.tileXYForLonLat(0, 0);
  assert.eq(x, 8192, 'tile x = 8192');
  assert.eq(y, 8192, 'tile y = 8192');
});

test('tileXYForLonLat: result matches floor(worldPx / TILE_PX)', () => {
  const lon = -74.006, lat = 40.7128;
  const tile = WorldGen.tileXYForLonLat(lon, lat);
  const px   = WorldGen.lonLatToWorldPx(lon, lat, 14);
  assert.eq(tile.x, Math.floor(px.x / 256), 'tile x = floor(px.x/256)');
  assert.eq(tile.y, Math.floor(px.y / 256), 'tile y = floor(px.y/256)');
});

test('tileXYForLonLat: NYC maps to tile (4823, 6160)', () => {
  const { x, y } = WorldGen.tileXYForLonLat(-74.006, 40.7128);
  assert.eq(x, 4823, 'NYC tile x = 4823');
  assert.eq(y, 6160, 'NYC tile y = 6160');
});

test('tileXYForLonLat: London maps to tile (8186, 5448)', () => {
  const { x, y } = WorldGen.tileXYForLonLat(-0.1278, 51.5074);
  assert.eq(x, 8186, 'London tile x = 8186');
  assert.eq(y, 5448, 'London tile y = 5448');
});

test('tileXYForLonLat: returns integer tile coords (no fractional parts)', () => {
  const { x, y } = WorldGen.tileXYForLonLat(10.5, 48.3);
  assert.eq(x, Math.floor(x), 'x is integer');
  assert.eq(y, Math.floor(y), 'y is integer');
});

test('tileXYForLonLat: tile x increases eastward', () => {
  const t1 = WorldGen.tileXYForLonLat(0,  0);
  const t2 = WorldGen.tileXYForLonLat(10, 0);
  assert.gt(t2.x, t1.x, 'tile x increases eastward');
});

test('tileXYForLonLat: tile y decreases northward (y=0 at north pole)', () => {
  const t_north = WorldGen.tileXYForLonLat(0, 50);
  const t_south = WorldGen.tileXYForLonLat(0,  0);
  assert.lt(t_north.y, t_south.y, 'higher lat → smaller tile y (more northward)');
});

// ─── setDepth / forEachItem ───────────────────────────────────────────────────

test('setDepth: returns a Map', () => {
  const cache = WorldGen.setDepth(0);
  assert.truthy(cache instanceof Map, 'setDepth(0) returns a Map');
  // Restore to depth 0 (clean up)
  WorldGen.setDepth(0);
});

test('setDepth: depth 0 and depth 1 return distinct Map instances', () => {
  const c0 = WorldGen.setDepth(0);
  const c1 = WorldGen.setDepth(1);
  assert.truthy(c0 !== c1, 'different Map per depth');
  WorldGen.setDepth(0);
});

test('setDepth: round-trip back to depth 0 restores the same cache object', () => {
  const c0a = WorldGen.setDepth(0);
  WorldGen.setDepth(1);
  const c0b = WorldGen.setDepth(0);
  assert.truthy(c0a === c0b, 'round-trip restores same depth-0 Map');
});

test('setDepth: WorldGen.tileCache is repointed after setDepth call', () => {
  const c = WorldGen.setDepth(0);
  assert.truthy(WorldGen.tileCache === c, 'WorldGen.tileCache === returned cache');
  WorldGen.setDepth(0);
});

test('forEachItem: does not throw on empty cache', () => {
  WorldGen.setDepth(0);
  // Clear any stray state from other tests
  WorldGen.tileCache.clear();
  let called = false;
  WorldGen.forEachItem('objects', () => { called = true; });
  assert.falsy(called, 'no items iterated in empty cache');
});

test('forEachItem: iterates items from populated cache entry', () => {
  WorldGen.setDepth(0);
  WorldGen.tileCache.clear();
  const fakeEntry = {
    objects: [
      { kind: 'tree',  x: 10, y: 20 },
      { kind: 'chest', x: 30, y: 40 },
    ],
  };
  WorldGen.tileCache.set('14/100/200', fakeEntry);

  const seen = [];
  WorldGen.forEachItem('objects', (item) => { seen.push(item.kind); });

  assert.eq(seen.length, 2, 'two items visited');
  assert.includes(seen, 'tree',  'tree item visited');
  assert.includes(seen, 'chest', 'chest item visited');

  WorldGen.tileCache.clear();
});

test('forEachItem: early-exit works when callback returns truthy', () => {
  WorldGen.setDepth(0);
  WorldGen.tileCache.clear();
  const fakeEntry = {
    objects: [
      { kind: 'tree',  x: 1, y: 1 },
      { kind: 'rock',  x: 2, y: 2 },
      { kind: 'chest', x: 3, y: 3 },
    ],
  };
  WorldGen.tileCache.set('14/101/201', fakeEntry);

  let count = 0;
  const result = WorldGen.forEachItem('objects', (item) => {
    count++;
    if (item.kind === 'rock') return true;  // short-circuit
  });

  assert.truthy(result, 'truthy return value propagated');
  assert.eq(count, 2, 'stopped after finding rock (visited tree + rock)');

  WorldGen.tileCache.clear();
});

test('forEachItem: skips entries that lack the requested prop', () => {
  WorldGen.setDepth(0);
  WorldGen.tileCache.clear();
  WorldGen.tileCache.set('14/10/10', { wildplants: [{ crop: 'shrub' }] }); // no 'objects'
  WorldGen.tileCache.set('14/10/11', { objects: [{ kind: 'chest' }] });

  const seen = [];
  WorldGen.forEachItem('objects', (item) => { seen.push(item.kind); });
  assert.eq(seen.length, 1, 'only entry with objects prop yields items');
  assert.eq(seen[0], 'chest', 'correct item');

  WorldGen.tileCache.clear();
});
