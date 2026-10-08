// Traps: where they are, what they cost, and what is (not) stored.
//
// The three things this file exists to hold still:
//
//  1. NOTHING SPAWNS ON — OR BY — A ROAD (CLAUDE.md, and the owner's safety
//     pass, Sep 2026). A trap lies BESIDE A FOOTPATH or on a PARK'S EDGE,
//     never within TRAP_ROAD_CLEAR_CELLS of any road and never inside the
//     major roads' kerb buffer. The terrain grid under-reports the road, so
//     the test drives the REAL rasterizer over synthetic MVT layers and
//     judges every trap against `roadMask` and `roadClass`.
//
//  2. NOTHING IS STORED UNTIL IT IS SPRUNG. Placement is a pure function of the
//     tile's coordinates: the same tile rasterized twice lays the same traps in
//     the same cells with the same ids, and the save stays empty until the
//     player steps on one. That is what lets a trap survive tile eviction, a
//     rebuild, and a reload without a byte of world state on disk.
//
//  3. THE BLEED IS FASTER THAN THE REST. Standing on a sprung trap has to cost
//     more per second than the fastest passive refill in the game, or "wait it
//     out" becomes a strategy and stepping off stops being the answer.

(function () {
const T = WorldGen.T;

// One tile of round numbers, same shape as spawn_roads.test.js: 64 cells
// across, 7 m each, so a cell is exactly 64 MVT units.
const CPE = 64;
const TILE_EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const cellToMvt = (c) => c * CELL_MVT + CELL_MVT / 2;
const ROAD_TIERS = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG]);

const ring = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
const line = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
const wholeTile = () => ring([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]]);

// Public grass (parks become authored Grove Nexus areas), crossed by a
// motorway down col 32 and an ordinary street along row 10,
// with three footpaths: one along row 50 in the left field, one down
// col 50 in the open grass, and one down col 36 hard by the motorway's kerb.
function roadyLayers() {
  return [
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'grass' }, geom: [ring([[0, 0], [24, 0], [24, CPE - 1], [0, CPE - 1]])] },
    ] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'motorway' }, geom: [line([[32, 0], [32, CPE - 1]])] },
      { type: 2, tags: { class: 'minor' }, geom: [line([[0, 10], [CPE - 1, 10]])] },
      { type: 2, tags: { class: 'path' }, geom: [line([[0, 50], [20, 50]])] },
      { type: 2, tags: { class: 'path' }, geom: [line([[50, 20], [50, 60]])] },
      { type: 2, tags: { class: 'path' }, geom: [line([[36, 20], [36, 60]])] },
    ] },
  ];
}
// Plain ground with no ways and no park at all.
function roadlessLayers() {
  return [{ name: 'landuse', features: [] }];
}

const rasterize = (layers, tx = 0, ty = 0) =>
  WorldGen.rasterizeTile(layers, CPE, tx, ty, TILE_EDGE_M);

// What app.js's spawnInTile hands every spawner — the shared options object.
const optsFor = (r) => ({ roadMask: r.roadMask, pois: [] });

const spawnFor = (r, tx = 0, ty = 0) =>
  Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, tx, ty, TILE_EDGE_M, optsFor(r));
const kindAt = (r, x, y) => Traps.trapGroundKind(r.grid, r.roadClass, CPE, CPE, x, y, null, r.roadMask);

// Trap world-metres → this tile's local cell index.
const cellOf = (v) => Math.floor(v / (TILE_EDGE_M / CPE));

// Is any road cell (a road tier, or the drawn band) within R cells?
const roadWithin = (r, x0, y0, R) => {
  for (let y = y0 - R; y <= y0 + R; y++) for (let x = x0 - R; x <= x0 + R; x++) {
    if (x < 0 || y < 0 || x >= CPE || y >= CPE) continue;
    if (ROAD_TIERS.has(r.grid[y * CPE + x]) || r.roadMask[y * CPE + x]) return true;
  }
  return false;
};

// ─── Surface placement ───────────────────────────────────────────────────────

test('traps: a tile with paths lays some, and every one is clear of every road', () => {
  const r = rasterize(roadyLayers());
  for (const mul of [undefined, 25, 100]) {
    const traps = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 0, 0, TILE_EDGE_M, optsFor(r), mul);
    assert.gt(traps.length, 0, 'the fixture produced traps to check');
    for (const tp of traps) {
      const ix = cellOf(tp.x), iy = cellOf(tp.y), i = iy * CPE + ix;
      assert.falsy(ROAD_TIERS.has(r.grid[i]), `trap on road terrain at ${ix},${iy}`);
      assert.eq(r.roadMask[i], 0, `trap under the drawn road band at ${ix},${iy}`);
      assert.falsy(roadWithin(r, ix, iy, Traps.TRAP_ROAD_CLEAR_CELLS),
        `trap at ${ix},${iy} is within ${Traps.TRAP_ROAD_CLEAR_CELLS} cells of a road`);
      assert.falsy(r.roadClass[i] & WorldGen.ROAD_CLASS_MAJOR_VERGE, `trap at ${ix},${iy} on a major verge`);
      assert.falsy(WorldGen.inMajorBuffer(r.roadClass, CPE, ix, iy), `trap at ${ix},${iy} inside the kerb buffer`);
    }
  }
});

test('traps: every trap passes the SHARED spawn rule, not a copy of it', () => {
  const r = rasterize(roadyLayers());
  for (const tp of spawnFor(r)) {
    assert.truthy(
      WorldGen.isSpawnCell(r.grid, CPE, CPE, cellOf(tp.x), cellOf(tp.y), optsFor(r)),
      `trap at ${cellOf(tp.x)},${cellOf(tp.y)} fails WorldGen.isSpawnCell`);
  }
});

test('traps: opts.occupied keeps a trap off a cell an object already holds', () => {
  // Every trap-ground cell the reservoir sample would ever pick is pre-claimed,
  // exactly as if worldgen had already put a tree or a rock on it. No occupied
  // cell may host a trap, so the whole surface pass comes back empty rather
  // than spawning through the claim.
  const r = rasterize(roadyLayers());
  const occupied = new Set();
  for (let cy = 0; cy < CPE; cy++) {
    for (let cx = 0; cx < CPE; cx++) {
      if (kindAt(r, cx, cy)) occupied.add(cy * CPE + cx);
    }
  }
  const opts = { roadMask: r.roadMask, pois: [], occupied };
  const traps = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 0, 0, TILE_EDGE_M, opts);
  assert.eq(traps.length, 0, 'every trap-ground cell was claimed, so nothing could seat');
  // Free every other claimed cell: traps come back, only on freed cells.
  [...occupied].forEach((idx, n) => { if (n % 2 === 0) occupied.delete(idx); });
  const partial = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 0, 0, TILE_EDGE_M, opts);
  assert.gt(partial.length, 0, 'freeing half the ground lets traps back in');
  for (const tp of partial) {
    const idx = cellOf(tp.y) * CPE + cellOf(tp.x);
    assert.falsy(occupied.has(idx), `trap at ${idx} landed on a cell still marked occupied`);
  }
});

test('traps: BESIDE the path, never on it', () => {
  const r = rasterize(roadyLayers());
  const traps = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 0, 0, TILE_EDGE_M, optsFor(r), 25);
  let path = 0, park = 0;
  for (const tp of traps) {
    const ix = tp._ix, iy = tp._iy, i = iy * CPE + ix;
    // Pinned against the SHIPPING predicate, and then its meaning checked.
    const k = kindAt(r, ix, iy);
    assert.truthy(k === 1 || k === 2, `trap at ${ix},${iy} is on trap ground`);
    assert.truthy(r.grid[i] !== T.PATH, `trap at ${ix},${iy} is ON the path — it would force a detour`);
    let besidePath = false, besideOther = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = ix + dx, y = iy + dy;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= CPE || y >= CPE) continue;
      if (r.grid[y * CPE + x] === T.PATH) besidePath = true;
      if (r.grid[y * CPE + x] !== T.PARK) besideOther = true;
    }
    if (k === 1) { path++; assert.truthy(besidePath, `${tp.id} is 8-adjacent to a footpath`); }
    else { park++; assert.eq(r.grid[i], T.PARK, `${tp.id} is park`); assert.truthy(besideOther, `${tp.id} is on the park's edge`); }
  }
  assert.gt(path, 0, 'the footpaths carry traps');
  assert.eq(park, 0, 'generic grass fixture has only path trap ground');
  // The predicate itself: the open park interior and plain grass are not
  // trap ground; the footpath cell never is.
  assert.eq(kindAt(r, 12, 30), 0, 'the park interior');
  assert.eq(kindAt(r, 58, 5), 0, 'open grass');
  for (let y = 22; y < 58; y++) if (r.grid[y * CPE + 50] === T.PATH) assert.eq(kindAt(r, 50, y), 0, 'the path cell itself');
  assert.eq(kindAt(r, 51, 40), 1, 'beside the grass footpath');
  assert.eq(kindAt(r, 24, 40) || kindAt(r, 23, 40), 0, 'ordinary grass edge is not trap ground');
});

test('traps: raw park ground predicate keeps its edge rule before Nexus conversion', () => {
  const N = 8, grid = new Uint8Array(N * N).fill(T.GRASS);
  for (let y = 0; y < N; y++) for (let x = 0; x < 4; x++) grid[y * N + x] = T.PARK;
  assert.eq(Traps.trapGroundKind(grid,null,N,N,3,4),2,'raw park edge');
  assert.eq(Traps.trapGroundKind(grid,null,N,N,2,4),0,'raw park interior');
  assert.eq(Traps.trapGroundKind(grid,null,N,N,4,4),0,'outside the park');
});

test('traps: a footpath hard by a major road carries none — the kerb buffer and the road clearance win', () => {
  const r = rasterize(roadyLayers());
  for (let y = 0; y < CPE; y++) for (let x = 0; x < CPE; x++) {
    const k = kindAt(r, x, y);
    if (WorldGen.inMajorBuffer(r.roadClass, CPE, x, y)) assert.eq(k, 0, `buffer cell ${x},${y} is no trap ground`);
    if (roadWithin(r, x, y, Traps.TRAP_ROAD_CLEAR_CELLS)) assert.eq(k, 0, `cell ${x},${y} by a road is no trap ground`);
  }
  // The minor street across the park: its park-edge cells are cleared too.
  for (const y of [8, 9, 10, 11, 12]) assert.eq(kindAt(r, 5, y), 0, `row ${y} by the street`);
  // No roadClass / no bandit bit is read any more: the old trade road's
  // stretches are no trap ground at all.
  assert.eq(Traps.isRoadside, undefined, 'the verge predicate is gone');
  assert.eq(Traps.isBanditVerge, undefined, 'and the bandit lane with it');
  assert.falsy(/ROAD_CLASS_BANDIT_VERGE|ROAD_CLASS_MAJOR_VERGE/.test(ALL_SRC['traps.js'].replace(/\/\/.*$/gm, '')),
    'traps.js reads neither verge bit in code');
});

test('traps: wasteland is no longer trap ground (only paths and park edges)', () => {
  const layers = [
    { name: 'landuse', features: [{ type: 3, tags: { class: 'railway' }, geom: [wholeTile()] }] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'minor' }, geom: [line([[0, 10], [CPE - 1, 10]])] }] },
  ];
  const r = rasterize(layers);
  let waste = 0;
  for (let i = 0; i < r.grid.length; i++) if (r.grid[i] === T.WASTELAND) waste++;
  assert.gt(waste, 0, 'the fixture is waste ground');
  assert.eq(Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 0, 0, TILE_EDGE_M, optsFor(r), 25).length, 0,
    'waste ground holds no traps');
});

test('traps: the count is capped at a share of the trap ground that scales with the mode', () => {
  const r = rasterize(roadyLayers());
  let ground = 0;
  for (let y = 0; y < CPE; y++) for (let x = 0; x < CPE; x++) if (kindAt(r, x, y)) ground++;
  assert.gt(ground, 0, 'the fixture has trap ground');
  for (const mul of [10, 25]) {
    const n = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 0, 0, TILE_EDGE_M, optsFor(r), mul).length;
    const m = mul * Traps.tileDanger(0, 0);
    const cap = Math.max(1, Math.floor(ground * Traps.TRAP_GROUND_SHARE_PER_MUL * m * Traps.TRAP_GROUND_DENSITY_MUL) + 1);
    assert.truthy(n <= cap, `at ${mul}x: ${n} traps over the cap ${cap}`);
  }
  assert.truthy(/const share = TRAP_GROUND_SHARE_PER_MUL \* mul \* TRAP_GROUND_DENSITY_MUL;/.test(ALL_SRC['traps.js'])
    && /n = Math\.min\(n, Math\.max\(1, Math\.floor\(capPath \+ capPark\)\)\);/.test(ALL_SRC['traps.js']),
    'the cap reads the pool sizes, never a draw');
});

test('traps: a named street\'s stretch is the same from either side of a seam', () => {
  // The squares are tile-aligned global MVT squares and the key is the
  // street's name + parish, so two neighbours agree without seeing each other.
  // (The stretches no longer carry traps — they key the burned row's slime.)
  const U = StreetVariants.BANDIT_STRETCH_UNITS;
  assert.eq(EXTENT % U, 0, 'a square never straddles a tile edge');
  const key = StreetVariants.streetKey('Seam Street', 3, 7);
  assert.eq(key, StreetVariants.streetKey('Seam Street', 4, 7), 'same key both sides (same parish)');
  const a = StreetVariants.stretchOf(4 * EXTENT - 1, 7 * EXTENT + 100);
  const b = StreetVariants.stretchOf(4 * EXTENT, 7 * EXTENT + 100);
  assert.eq(b.sx - a.sx, 1, 'the seam is a square edge');
});

test('traps: the trap-ground sample is uniform over the whole ground, and bounded', () => {
  const r = rasterize(roadyLayers());
  let ground = 0;
  for (let y = 0; y < CPE; y++) {
    for (let x = 0; x < CPE; x++) if (kindAt(r, x, y)) ground++;
  }
  const K = 48;
  assert.gt(ground, K * 2, 'the fixture has more ground than the reservoir holds — the sampling path is exercised');
  const rng = WorldGen.makeRng(12345);
  const smp = Traps.sampleTrapCells(r.grid, r.roadClass, CPE, CPE, rng, K, null, r.roadMask);
  assert.eq(smp.path.cells.length, Math.min(K, smp.path.seen), 'the path reservoir fills, never past its size');
  assert.eq(smp.park.cells.length, Math.min(K, smp.park.seen), 'the park reservoir too');
  assert.eq(smp.seen, ground, 'seen counts all the ground');
  for (const idx of smp.cells) {
    assert.truthy(kindAt(r, idx % CPE, (idx / CPE) | 0), 'every sampled cell is trap ground');
  }
  // Uniform, not "the first K cells in scan order": the reservoir must reach
  // the bottom of the tile, which a plain head-of-list take never would.
  assert.gt(Math.max(...smp.path.cells.map((i) => (i / CPE) | 0)), CPE / 2,
    'the sample reaches past halfway down the tile');
});

test('traps: the local cell indices agree with the world metres they carry', () => {
  const r = rasterize(roadyLayers(), 3, -2);
  for (const tp of Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 3, -2, TILE_EDGE_M, optsFor(r))) {
    const mPerCell = TILE_EDGE_M / CPE;
    assert.eq(Math.floor((tp.x - 3 * TILE_EDGE_M) / mPerCell), tp._ix, 'x → _ix');
    assert.eq(Math.floor((tp.y - -2 * TILE_EDGE_M) / mPerCell), tp._iy, 'y → _iy');
  }
});

test('traps: no two traps share a cell', () => {
  const r = rasterize(roadyLayers());
  const seen = new Set();
  for (const tp of spawnFor(r)) {
    const k = `${tp._ix}_${tp._iy}`;
    assert.falsy(seen.has(k), `two traps stacked on ${k}`);
    seen.add(k);
  }
});

test('traps: a tile with no footpath and no park has no trap ground, so it has no traps', () => {
  const r = rasterize(roadlessLayers());
  assert.eq(spawnFor(r).length, 0, 'no traps');
  assert.eq(Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 0, 0, TILE_EDGE_M, optsFor(r), 100).length, 0,
    'not even at 100x');
});

test('traps: a goblin trapper\'s snare refuses the kerb buffer (canLay reads entry.roadClass)', () => {
  const r = rasterize(roadyLayers());
  const entry = { grid: r.grid, cellsPerEdge: CPE, roadMask: r.roadMask, roadClass: r.roadClass,
    _spawnOpts: { occupied: new Set() }, traps: [] };
  let inBuf = 0, outside = 0;
  for (let y = 0; y < CPE; y++) for (let x = 0; x < CPE; x++) {
    if (!WorldGen.isWalkable(r.grid[y * CPE + x]) || r.roadMask[y * CPE + x]) continue;
    if (WorldGen.inMajorBuffer(r.roadClass, CPE, x, y)) {
      inBuf++;
      assert.falsy(Traps.canLay(entry, x, y), `no snare in the buffer at ${x},${y}`);
    } else if (Traps.canLay(entry, x, y)) outside++;
  }
  assert.gt(inBuf, 0, 'the fixture has walkable buffer cells');
  assert.gt(outside, 0, 'and a snare still goes down beyond it');
});

test('traps: countMul scales the surface density, and every extra trap still obeys the rules', () => {
  const r = rasterize(roadyLayers());
  // A dangerous tile, so the ground cap (a share scaled by the same
  // multiplier) leaves room at 1x vs 10x on this small fixture's verge.
  let TX = 0;
  while (Traps.tileDanger(TX, 0) < 1.5) TX++;
  const base = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, TX, 0, TILE_EDGE_M, optsFor(r));
  const mul10 = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, TX, 0, TILE_EDGE_M, optsFor(r), 10);
  const mul100 = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, TX, 0, TILE_EDGE_M, optsFor(r), 100);
  assert.gt(mul10.length, base.length, '10x lays more traps than the base rate');
  assert.gt(mul100.length, mul10.length, '100x lays more again than 10x');
  const seen = new Set();
  for (const tp of mul100) {
    const k = `${tp._ix}_${tp._iy}`;
    assert.falsy(seen.has(k), `two traps stacked on ${k} even at high density`);
    seen.add(k);
    assert.truthy(
      WorldGen.isSpawnCell(r.grid, CPE, CPE, tp._ix, tp._iy, optsFor(r)),
      `trap at ${tp._ix},${tp._iy} fails isSpawnCell at 100x`);
    assert.eq(r.roadMask[tp._iy * CPE + tp._ix], 0, `trap under the road band at 100x`);
  }
  // No multiplier passed (undefined, as every existing call site pre-dating
  // countMul does) must reproduce the exact base-rate rng draw — the reservoir
  // stays at TRAP_GROUND_SAMPLE rather than widening.
  const implicit = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, TX, 0, TILE_EDGE_M, optsFor(r), undefined);
  assert.eq(JSON.stringify(implicit.map((t) => t.id)), JSON.stringify(base.map((t) => t.id)),
    'an omitted countMul is identical to the pre-multiplier behaviour');
});

test('traps: the danger roll reaches the count, on its own stream', () => {
  const r = rasterize(roadyLayers());
  // Find a calm tile and a dangerous one with the same verge (the fixture is
  // the same grid wherever it is called for) — the count follows the danger.
  let calm = null, bad = null;
  for (let t = 0; t < 400 && !(calm && bad); t++) {
    const d = Traps.tileDanger(t, 3);
    if (d < 0.5 && !calm) calm = t;
    if (d > 1.5 && !bad) bad = t;
  }
  assert.truthy(calm != null && bad != null, 'found both kinds of tile');
  const n = (tx) => Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, tx, 3, TILE_EDGE_M, optsFor(r), 10).length;
  assert.gt(n(bad), n(calm) * 2, 'a dangerous tile lays well over twice a calm one\'s traps');
  assert.truthy(/const mul = \(countMul > 0 \? countMul : 1\) \* tileDanger\(tx, ty\);/.test(ALL_SRC["traps.js"]),
    'the danger multiplies the mode, not the placement rng');
});

test('traps: countMul scales cave density the same way', () => {
  const g = caveGrid(CAVE_N);
  const base = Traps.spawnCave(g, CAVE_N, 0, 0, TILE_EDGE_M, 1, ANCHORS, new Set());
  const mul100 = Traps.spawnCave(g, CAVE_N, 0, 0, TILE_EDGE_M, 1, ANCHORS, new Set(), Traps.DUNGEON_DENSITY_MUL);
  assert.gt(mul100.length, base.length, 'DUNGEON_DENSITY_MUL lays far more cave traps');
});

// ─── Seed-generated, never stored ────────────────────────────────────────────

test('traps: the same tile lays the same traps every time it is built', () => {
  const a = spawnFor(rasterize(roadyLayers()));
  const b = spawnFor(rasterize(roadyLayers()));
  assert.eq(b.length, a.length, 'same count');
  assert.eq(JSON.stringify(b.map((t) => t.id)), JSON.stringify(a.map((t) => t.id)),
    'same ids, in the same order — a rebuilt or re-rasterized tile is identical');
});

test('traps: a different tile lays a different set', () => {
  const r = rasterize(roadyLayers());
  const here = spawnFor(r, 0, 0).map((t) => t.id);
  const there = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 7, 11, TILE_EDGE_M, optsFor(r))
    .map((t) => t.id);
  assert.falsy(here.length === there.length && here.every((id, i) => id === there[i]),
    'the tile coordinates are actually in the seed');
});

test('traps: the id carries the tile and cell, so it is stable across a reload', () => {
  const r = rasterize(roadyLayers(), 5, 6);
  for (const tp of Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, 5, 6, TILE_EDGE_M, optsFor(r))) {
    assert.eq(tp.id, `trap_5_6_${tp._ix}_${tp._iy}`, 'id is derived, not counted');
  }
});

test('traps: spawning writes nothing to the save — only springing does', () => {
  const save = {};
  spawnFor(rasterize(roadyLayers()));
  assert.eq(save.sprungTraps, undefined, 'placement touched no save state');
  assert.falsy(Traps.isSprung(save, 'trap_0_0_1_1'), 'and nothing reads as sprung');
  assert.truthy(Traps.spring(save, 'trap_0_0_1_1'), 'first step springs it');
  assert.eq(JSON.stringify(save.sprungTraps), '["trap_0_0_1_1"]',
    'the id is the ONLY thing stored — no coordinates, no tile');
  assert.falsy(Traps.spring(save, 'trap_0_0_1_1'),
    'a second step is not a fresh spring (that is what stops the bite repeating)');
  assert.truthy(Traps.isSprung(save, 'trap_0_0_1_1'), 'and it stays revealed');
});

test('traps: disarming is its own record, independent of sprung', () => {
  const save = {};
  assert.falsy(Traps.isDisarmed(save, 'trap_0_0_1_1'), 'nothing reads as disarmed yet');
  assert.truthy(Traps.disarm(save, 'trap_0_0_1_1'), 'the kit removes it');
  assert.eq(JSON.stringify(save.disarmedTraps), '["trap_0_0_1_1"]',
    'the id is the ONLY thing stored, in its own array from sprungTraps');
  assert.eq(save.sprungTraps, undefined, 'disarming a hidden trap never springs it');
  assert.falsy(Traps.disarm(save, 'trap_0_0_1_1'),
    'a second kit on the same trap is nothing to spend — already gone');
  assert.truthy(Traps.isDisarmed(save, 'trap_0_0_1_1'), 'and it stays gone');
  // A trap that already bit the player can still be disarmed afterwards —
  // the two records don't gate each other either way.
  assert.truthy(Traps.spring(save, 'trap_5_5_2_2'), 'stepped on a different one');
  assert.truthy(Traps.disarm(save, 'trap_5_5_2_2'), 'and it can still be disarmed after');
  assert.truthy(Traps.isSprung(save, 'trap_5_5_2_2') && Traps.isDisarmed(save, 'trap_5_5_2_2'),
    'both records hold at once');
});

// ─── Lookup ──────────────────────────────────────────────────────────────────

test('traps: trapAt finds the trap on a cell, and nothing on the others', () => {
  const r = rasterize(roadyLayers());
  const traps = spawnFor(r);
  const entry = { traps };
  const tp = traps[0];
  assert.eq(Traps.trapAt(entry, tp._ix, tp._iy), tp, 'the cell it is on');
  assert.eq(Traps.trapAt(entry, tp._ix + 40, tp._iy + 40), null, 'a cell it is not on');
  assert.eq(Traps.trapAt({}, 0, 0), null, 'a tile with no trap list');
});

// ─── Caves ───────────────────────────────────────────────────────────────────

// A synthetic cave level: all floor, with a block of wall in one corner.
function caveGrid(N) {
  const g = new Uint8Array(N * N).fill(T.CAVE_FLOOR);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g[y * N + x] = T.CAVE_WALL;
  return g;
}
const CAVE_N = 64;
const ANCHORS = [{ lix: 30, liy: 30 }];

test('traps: cave traps land on floor, off the walls, and around the way in', () => {
  const grid = caveGrid(CAVE_N);
  const traps = Traps.spawnCave(grid, CAVE_N, 0, 0, TILE_EDGE_M, 1, ANCHORS, new Set());
  assert.gt(traps.length, 0, 'a level lays traps');
  for (const tp of traps) {
    assert.eq(grid[tp._iy * CAVE_N + tp._ix], T.CAVE_FLOOR, 'on cave floor');
    const d = Math.max(Math.abs(tp._ix - 30), Math.abs(tp._iy - 30));
    assert.lte(d, Traps.CAVE_SPAWN_R,
      'within the entrance spread — a trap across the level meets nobody');
  }
});

test('traps: a cave trap is never laid under an object sprite', () => {
  const grid = caveGrid(CAVE_N);
  // Claim every cell in the anchor's spread but one, so the spawner has a
  // single legal seat and must find exactly it.
  const occupied = new Set();
  const R = Traps.CAVE_SPAWN_R;
  for (let y = 30 - R; y <= 30 + R; y++) {
    for (let x = 30 - R; x <= 30 + R; x++) {
      if (x < 0 || y < 0 || x >= CAVE_N || y >= CAVE_N) continue;
      if (x === 33 && y === 27) continue;                 // the one free cell
      occupied.add(y * CAVE_N + x);
    }
  }
  const traps = Traps.spawnCave(grid, CAVE_N, 0, 0, TILE_EDGE_M, 1, ANCHORS, occupied);
  for (const tp of traps) {
    assert.falsy(occupied.has(tp._iy * CAVE_N + tp._ix),
      `trap at ${tp._ix},${tp._iy} sits under an object — its art would be painted over`);
  }
  assert.lte(traps.length, 1, 'one free cell can hold at most one trap');
});

test('traps: a cave level is deterministic per (tile, depth)', () => {
  const g = caveGrid(CAVE_N);
  const a = Traps.spawnCave(g, CAVE_N, 2, 3, TILE_EDGE_M, 2, ANCHORS, new Set());
  const b = Traps.spawnCave(g, CAVE_N, 2, 3, TILE_EDGE_M, 2, ANCHORS, new Set());
  assert.eq(JSON.stringify(b.map((t) => t.id)), JSON.stringify(a.map((t) => t.id)),
    'same level, same traps');
  const deeper = Traps.spawnCave(g, CAVE_N, 2, 3, TILE_EDGE_M, 3, ANCHORS, new Set());
  assert.falsy(JSON.stringify(deeper.map((t) => t.id)) === JSON.stringify(a.map((t) => t.id)),
    'the depth is in the seed — a level is not a copy of the one above it');
  assert.truthy(deeper.every((t) => /^trap_d3_2_3_/.test(t.id)),
    'and the depth is in the id, so two levels record their springs apart');
});

test('traps: the deeper you go the more of them there are', () => {
  const g = caveGrid(CAVE_N);
  const n = (depth) => Traps.CAVE_TRAP_MIN
    + Math.min(depth, Traps.CAVE_TRAP_DEPTH_CAP) * Traps.CAVE_TRAP_PER_DEPTH;
  assert.gt(n(6), n(1), 'the depth bonus actually climbs');
  assert.eq(n(20), n(Traps.CAVE_TRAP_DEPTH_CAP), 'and stops climbing at the cap');
  // …and the spawner really lays that many when there is room for them.
  const deep = Traps.spawnCave(g, CAVE_N, 0, 0, TILE_EDGE_M, 8, ANCHORS, new Set());
  assert.gte(deep.length, Traps.CAVE_TRAP_MIN, 'a deep level is at least the floor count');
});

// ─── The costs ───────────────────────────────────────────────────────────────

test('traps: the bite is a tenth of a full bar and the bleed is 3⚡/s', () => {
  assert.eq(Traps.STEP_ENERGY, 10, 'stepping on a hidden trap');
  assert.eq(Traps.STAND_ENERGY_PER_S, 3, 'standing on the sprung one');
  assert.eq(Traps.STEP_ENERGY, STARTING_ENERGY / 10,
    'the bite is stated against the bar it comes out of');
});

test('traps: hard mode penalizes the player after boots mitigate the shared bite', () => {
  assert.eq(Difficulty.PROFILES.easy.trapBiteMul, 1, 'shared raw bite');
  assert.eq(Difficulty.PROFILES.hard.trapBiteMul, 1, 'no enemy-side multiplier');
  assert.eq(Combat.playerDamage(Traps.STEP_ENERGY, 0, 1, 'hard'), 25,
    'unarmoured player takes 2.5 times the shared bite');
  const bootsPool = 3;
  assert.eq(Combat.playerDamage(Traps.STEP_ENERGY, bootsPool, 1, 'hard'),
    Combat.playerDamage(Traps.STEP_ENERGY, bootsPool, 1, 'easy') * 2.5,
    'penalty follows mitigation');
  assert.eq(Combat.playerDamage(Traps.STAND_ENERGY_PER_S, 0, 1, 'hard'), 7.5,
    'the receiving player also takes the penalty on bleed');
});

test('traps: standing on one out-drains the fastest passive rest in the game', () => {
  // Lifted from app.js, not restated: the Home rest is maxE over
  // HOME_FULL_REST_S, which is the quickest energy comes back without eating.
  const m = SCENE_SRC.match(/const HOME_FULL_REST_S = (\d+);/);
  assert.truthy(m, 'HOME_FULL_REST_S is a plain literal');
  const homeRestPerS = STARTING_ENERGY / Number(m[1]);
  assert.gt(Traps.STAND_ENERGY_PER_S, homeRestPerS,
    `the bleed (${Traps.STAND_ENERGY_PER_S}⚡/s) must beat the Home rest `
    + `(${homeRestPerS.toFixed(2)}⚡/s) — otherwise standing still is a way to win`);
});

// ─── The call sites (app.js / scene_creatures.js / render.js can't load headlessly) ─

test('traps: the surface spawn passes the SHARED spawn options, mask and all', () => {
  assert.truthy(
    /Traps\.spawnSurface(?:Steps)?\(genGrid, entry\.roadClass, N, N, tx, ty, this\.tileEdgeM, ambientSpawnOpts,/
      .test(SCENE_SRC),
    'surface traps retain the shared mask and generated grid while respecting authored coverage');
  assert.truthy(/const ambientSpawnOpts = \{ \.\.\._spawnOpts, occupied: ambientOccupied \}/.test(SCENE_SRC),
    'ambient placement retains all shared spawn-gate options');
  assert.truthy(/Traps\.spawnSurface(?:Steps)?\([^;]*Difficulty\.get\(\)\.trapCountMul/.test(SCENE_SRC),
    'the surface density scales with the game mode, not a fixed rate');
});

test('traps: _spawnOpts carries opts.occupied, built from the tile\'s own objects and wild plants', () => {
  // spawnInTile can't run headlessly (needs a live scene), so this pins the
  // construction as source text — the same way the mask/mul wiring above is
  // pinned. Traps.spawnSurface inherits `occupied` for free once _spawnOpts
  // carries it (it just forwards `spawnOpts` to WorldGen.isSpawnCell); the
  // one thing worth pinning is that the set is actually built and actually on
  // the object every spawner in this method shares.
  // spawnInTile is the SceneCreatures mixin's (scene_creatures.js).
  const block = (() => {
    const a = SCENE_SRC.indexOf('  *spawnInTileSteps(entry, tx, ty) {');
    const b = SCENE_SRC.indexOf('\n  }\n', a);
    assert.truthy(a > 0 && b > a, 'found spawnInTile in scene_creatures.js');
    return SCENE_SRC.slice(a, b);
  })();
  // From the tile's GENERATED objects (entry.genObjects, falling back to
  // entry.objects): what an Overpass bin or this player's starter kit put on
  // the live entry is culled after the draws, never fed into them.
  assert.truthy(/const genObjects = entry\.genObjects \|\| entry\.objects \|\| \[\];/.test(block),
    'the generated object list falls back to entry.objects');
  assert.truthy(/for \(const records of \[genObjects, entry\.wildplants \|\| \[\]\]\) for \(const o of records\)/.test(block),
    'both generated objects and wild plants contribute occupancy');
  assert.truthy(/SpawnOwnership\.tileCells\(this, entry, o, tx, ty\)\) _occupiedIdx\.add/.test(block),
    'every declared footprint cell is reserved');
  assert.truthy(/occupied: _occupiedIdx,/.test(block),
    'and the set actually reaches _spawnOpts, not just a local variable nothing reads');
});

test('traps: answering the how-to card re-lays the traps at that mode\'s density', () => {
  // THE BUG: the card that picks easy/hard is answered AFTER boot, and a save
  // with no mode yet reads as easy (difficulty.js). So the starter tile — the
  // one a new save spends its first minutes on — was laid at trapCountMul 10
  // when the player had just asked for hard's 25. Under half the verge, on the only
  // ground they can see. chooseMode already repairs the purse, the ladder, the
  // crates and the doorstep greeter for exactly this race; the traps were the
  // one thing on that list nobody had put there.
  assert.gt(Difficulty.PROFILES.hard.trapCountMul, Difficulty.PROFILES.easy.trapCountMul,
    'the two modes really do differ on density — otherwise there is no race to fix');

  const block = (() => {
    const a = SCENE_SRC.indexOf('  chooseMode(mode) {');
    const b = SCENE_SRC.indexOf('\n  }\n', a);
    assert.truthy(a > 0 && b > a, 'found chooseMode in app.js');
    return SCENE_SRC.slice(a, b);
  })();
  assert.truthy(/this\._relayTrapsForMode\(\)/.test(block),
    'chooseMode re-lays the traps, beside the crate strip and the greeter swap');

  const relay = (() => {
    const a = SCENE_SRC.indexOf('  _relayTrapsForMode() {');
    const b = SCENE_SRC.indexOf('\n  }\n', a);
    assert.truthy(a > 0 && b > a, 'found _relayTrapsForMode in app.js');
    return SCENE_SRC.slice(a, b);
  })();
  assert.truthy(/Difficulty\.get\(\)\.trapCountMul/.test(relay),
    're-laid at the mode that was just chosen, not a retyped number');
  assert.truthy(/entry\._spawnOpts/.test(relay),
    'through the tile\'s OWN shared spawn options — a second copy of the road '
    + 'rule here is how drawn-as-road and no-spawn-here drift apart');
  assert.truthy(/entry\.roadClass/.test(relay),
    'and the road class (the major verge) itself, never the terrain grid');
  assert.truthy(/\(this\.depth \|\| 0\) !== 0/.test(relay),
    'surface only: cave traps are flat-scaled by DUNGEON_DENSITY_MUL, and '
    + 'WorldGen.tileCache is repointed underground');
  assert.truthy(/entry\._spawned/.test(relay),
    'only tiles that have already spawned — the gate a rebuild drops');
  assert.truthy(/sprung\.has\(t\.id\)/.test(relay),
    'a trap the player has already sprung is carried across: the new roll draws '
    + 'a different sequence, and a trap that has bitten you must not blink out');
  // And the entry has to be CARRYING those options for any of that to work.
  assert.truthy(/entry\._spawnOpts = _spawnOpts;/.test(SCENE_SRC),
    'spawnInTile keeps the tile\'s spawn options on the entry for the re-lay');
});

test('traps: the tick asks where the PLAYER is, never where the camera is', () => {
  const block = (() => {
    const a = SCENE_SRC.indexOf('  _tickTraps(dt) {');
    const b = SCENE_SRC.indexOf('\n  }\n', a);
    assert.truthy(a > 0 && b > a, 'found _tickTraps in app.js');
    return SCENE_SRC.slice(a, b);
  })();
  assert.truthy(/this\.playerToWorldCell\(\)/.test(block),
    'the cell under the feet comes from playerToWorldCell');
  assert.falsy(/viewAnchorCell|viewAnchorWorldM|viewCenterX/.test(block),
    'a peek drag must not spring a trap the body is nowhere near (CLAUDE.md: '
    + 'the camera is not the player)');
  // springTrap: Traps.spring for a generated trap (the save id), the record's
  // own flag for a goblin's laid snare — either way the one-shot gate.
  assert.truthy(/Traps\.springTrap\(this\.save, trap\)/.test(block),
    'the reveal goes through Traps.springTrap, which is what makes the bite land once');
  assert.truthy(/persistSave\(this\.save\)/.test(block),
    'and it is written straight away, so a discovered trap stays discovered');
  assert.truthy(/this\._painFlash\(spent\)/.test(block), 'the bite carries the pain effect');
  assert.truthy(/Combat\.playerDamage\(Traps\.STAND_ENERGY_PER_S \* Traps\.trapPower\(trap\), \{ boots: this\.save\.armor\?\.boots \}\) \* dt/.test(block),
    'the bleed is per SECOND, accumulated off the frame delta');
});

test('traps: a downed player springs nothing — the whole tick stands down', () => {
  // NOTHING HUNTS A BODY, and a body does not step. At zero energy the reach is
  // 0, no hostile takes an interest and every damage path refuses the bar; a
  // snare is the same state one lane over. Springing one would spend it FOR
  // GOOD (save.sprungTraps is written the instant it fires) on a player who can
  // be charged nothing for it, and on hard — where only Home lifts the bar off
  // zero — the walk home would clear every trap it crossed for free.
  const block = (() => {
    const a = SCENE_SRC.indexOf('  _tickTraps(dt) {');
    const b = SCENE_SRC.indexOf('\n  }\n', a);
    assert.truthy(a > 0 && b > a, 'found _tickTraps in app.js');
    return SCENE_SRC.slice(a, b);
  })();
  assert.truthy(/if \(Combat\.playerDowned\(this\.save\.energy\)(?: \|\| Conditions\.flying\(this\.save\))?\) \{/.test(block),
    'the tick reads the SAME expression the pursuit gate and the damage guards do');
  // …and it reads it before anything can fire: the gate must sit above the
  // cell lookup, not between the bite and the bleed.
  const gate = block.indexOf('Combat.playerDowned(this.save.energy)');
  assert.truthy(gate > 0 && gate < block.indexOf('this.playerToWorldCell()'),
    'the stand-down comes before the cell is even resolved');
  // NOT isUnnoticed(): a Shadow Powder hides you from what takes an INTEREST in
  // you, and iron jaws take none — a powder must not walk you through a
  // minefield.
  assert.falsy(/isUnnoticed|isShadowActive/.test(block),
    'the trap ward is the collapse alone, never the Shadow Powder');
  // The memo goes down with it, or a player revived on top of a hidden trap
  // would stand on it forever without ever stepping on it.
  assert.truthy(/this\._trapCellKey = null;/.test(block.slice(gate)),
    'the cell memo is dropped so the trap under a revived player is re-read');
});

test('traps: the numbers land on the trap\'s own cell, through _popEnergy', () => {
  const block = SCENE_SRC.slice(SCENE_SRC.indexOf('  _tickTraps(dt) {'));
  const head = block.slice(0, block.indexOf('\n  }\n'));
  // The bite pops at once; the bleed banks into the drain roll-up (_bankDrain),
  // which pops it on the same cell once per window.
  const pops = [...(head.match(/this\._popEnergy\([^)]*\)/g) || []), ...(head.match(/this\._bankDrain\('trap', [^)]*\)[^)]*\)/g) || [])];
  assert.gte(pops.length, 2, 'both the bite and the bleed pop a number');
  for (const p of pops) {
    assert.truthy(/\{ ix, iy/.test(p),
      `${p} must name the cell — a bare ⚡ flash at the viewport centre is the bug`);
  }
});

test('traps: the renderer picks its texture from the sprung set alone', () => {
  assert.truthy(/const sprungSet = setOf\(scene\.save\.sprungTraps\);/.test(RENDER_SRC),
    'the sprung ids are read once per frame, like pickedSet');
  assert.truthy(/setTextureIfDifferent\(s, sprung \? 'trap_open' : 'trap_hidden'\)/.test(RENDER_SRC),
    'sprung → the iron jaw, otherwise → the subtle scuff');
});

test('traps: a disarmed trap is dropped from the render list, not retextured', () => {
  assert.truthy(/const disarmedSet = setOf\(scene\.save\.disarmedTraps\);/.test(RENDER_SRC),
    'the disarmed ids are read once per frame, like sprungSet');
  const block = RENDER_SRC.slice(RENDER_SRC.indexOf('if (entry.traps) {'));
  assert.truthy(/if \(disarmedSet\.has\(tr\.id\)\) return;/.test(block.slice(0, 500)),
    'the indexed callback drops a disarmed trap before it reaches either texture');
});

test('traps: the tick treats a disarmed trap as no trap at all', () => {
  const block = SCENE_SRC.slice(SCENE_SRC.indexOf('  _tickTraps(dt) {'));
  assert.truthy(/Traps\.isTrapDisarmed\(this\.save, found\)/.test(block.slice(0, 2400)),
    'the disarmed check runs before the bite/bleed logic below it');
});

// ─── The art (run against a recording 2D context, like tilled_bed.test.js) ───

// A stub scene whose createCanvas hands back a recording context, so the real
// maker draws its real geometry and we can measure it.
function bake(maker) {
  const ops = [];
  const c2d = new Proxy({}, {
    get: (_, k) => (...a) => { ops.push([k, ...a]); },
    set: (_, k, v) => { ops.push(['set:' + k, v]); return true; },
  });
  let size = null;
  const scene = { textures: {
    exists: () => false,
    createCanvas: (key, w, h) => { size = { key, w, h }; return { getContext: () => c2d, refresh() {} }; },
  } };
  maker(scene);
  return { ops, size };
}
// Every coordinate the drawing touches, as {x, y} pairs, so "does the art stay
// inside its cell" is a question we can actually answer.
function points(ops, S) {
  const pts = [];
  for (const [k, ...a] of ops) {
    if (k === 'moveTo' || k === 'lineTo') pts.push({ x: a[0], y: a[1] });
    else if (k === 'fillRect') pts.push({ x: a[0], y: a[1] }, { x: a[0] + a[2], y: a[1] + a[3] });
    else if (k === 'ellipse') {
      // (cx, cy, rx, ry, …) — the bounding box, ignoring rotation (every
      // ellipse here is axis-aligned or near enough that the box is a bound).
      pts.push({ x: a[0] - a[2], y: a[1] - a[3] }, { x: a[0] + a[2], y: a[1] + a[3] });
    } else if (k === 'clearRect') continue;   // that IS the canvas
  }
  return pts;
}

test('traps: both textures bake one cell square, under the key the renderer names', () => {
  assert.eq(TRAP_TEX.TRAP_PX, 32, 'the trap art is authored at the cell size (CELL_PX)');
  for (const [maker, key] of [[TRAP_TEX.makeHiddenTrapTexture, 'trap_hidden'],
                              [TRAP_TEX.makeSprungTrapTexture, 'trap_open']]) {
    const { size } = bake(maker);
    assert.eq(size.key, key, 'the key the renderer asks for');
    assert.eq(size.w, TRAP_TEX.TRAP_PX, `${key} width is one cell`);
    assert.eq(size.h, TRAP_TEX.TRAP_PX, `${key} height is one cell`);
  }
  assert.truthy(/makeTrapTextures\(this\);/.test(SCENE_SRC), 'and they are baked at boot');
});

test('traps: neither texture draws outside its own cell', () => {
  const S = TRAP_TEX.TRAP_PX;
  for (const [maker, key] of [[TRAP_TEX.makeHiddenTrapTexture, 'trap_hidden'],
                              [TRAP_TEX.makeSprungTrapTexture, 'trap_open']]) {
    const { ops } = bake(maker);
    const pts = points(ops, S);
    assert.gt(pts.length, 8, `${key}: the maker actually drew something`);
    for (const p of pts) {
      assert.inRange(p.x, 0, S, `${key}: x ${p.x} leaves the cell`);
      assert.inRange(p.y, 0, S, `${key}: y ${p.y} leaves the cell`);
    }
  }
});

test('traps: the hidden one is SUBTLE and the sprung one is not', () => {
  // The whole premise: a hidden trap can be spotted by a player who is
  // looking and missed by one who isn't, and a sprung one shouts. That is a
  // property of the paint, so measure the paint: every colour the hidden
  // texture sets is translucent, and the sprung one lays down opaque ink.
  const alphaOf = (v) => {
    const m = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(String(v));
    return m ? Number(m[1]) : 1;      // a hex/# colour is fully opaque
  };
  const styles = (ops) => ops
    .filter(([k]) => k === 'set:fillStyle' || k === 'set:strokeStyle')
    .map(([, v]) => v);

  const hidden = styles(bake(TRAP_TEX.makeHiddenTrapTexture).ops);
  assert.gt(hidden.length, 3, 'the hidden trap paints in several passes');
  for (const s of hidden) {
    assert.lte(alphaOf(s), 0.4,
      `a hidden trap must never paint above 0.4 alpha — ${s} would sign-post it`);
  }

  const sprung = styles(bake(TRAP_TEX.makeSprungTrapTexture).ops);
  assert.truthy(sprung.some((s) => alphaOf(s) === 1),
    'a sprung trap paints opaque — once it has bitten you it has to be unmissable');
});
})();

test('traps: a trapper\'s snare bites at its trapper\'s power — the Home nerf reaches it', () => {
  const entry = { cellsPerEdge: 40 };
  const soft = Traps.layTrap(entry, 0, 0, 280, 3, 4, 'lair_x_0', 0, 0, 0.2);
  assert.eq(Traps.trapPower(soft), 0.2, 'a trapper by Home lays a softened snare');
  const plain = Traps.layTrap(entry, 0, 0, 280, 5, 6, 'lair_x_1', 0, 0);
  assert.eq(Traps.trapPower(plain), 1, 'no power given → full strength');
  assert.eq(Traps.trapPower({}), 1, 'a generated trap is the world\'s own, at 1');
  assert.truthy(/Traps\.layTrap\([\s\S]*?Combat\.powerMul\(c\)\);/.test(SCENE_SRC), 'the trapper hands over its powerMul');
  assert.truthy(/Traps\.STEP_ENERGY \* Difficulty\.get\(\)\.trapBiteMul \* Traps\.trapPower\(trap\)/.test(SCENE_SRC),
    'the bite scales by it');
  assert.truthy(/Combat\.playerDamage\(Traps\.STAND_ENERGY_PER_S \* Traps\.trapPower\(trap\), \{ boots: this\.save\.armor\?\.boots \}\) \* dt/.test(SCENE_SRC), 'and the bleed');
});

// ── Danger: the per-tile spread ─────────────────────────────────────────────
test('traps: every tile rolls its own danger — a fact of the place, mean 1', () => {
  assert.eq(Traps.tileDanger(12, -7), Traps.tileDanger(12, -7), 'deterministic per tile');
  let sum = 0, lo = Infinity, hi = -Infinity;
  const K = 4000;
  for (let i = 0; i < K; i++) {
    const d = Traps.tileDanger(i % 97 - 40, Math.floor(i / 97) - 20);
    assert.gte(d, Traps.DANGER_MIN, 'never under the floor');
    assert.lt(d, Traps.DANGER_MAX, 'never over the ceiling');
    sum += d; lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  assert.lte(Math.abs(sum / K - 1), 0.03, `mean ~1, so trapCountMul stays the mode's average (got ${(sum / K).toFixed(3)})`);
  assert.gt(hi / lo, 4, 'and a real spread: the worst tile several times the calmest');
  assert.lte(Math.abs((Traps.DANGER_MIN + Traps.DANGER_MAX) / 2 - 1), 1e-9, 'the band is centred on 1');
});
