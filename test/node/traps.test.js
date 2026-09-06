// Traps: where they are, what they cost, and what is (not) stored.
//
// The three things this file exists to hold still:
//
//  1. NOTHING SPAWNS ON A ROAD (CLAUDE.md). A trap goes ALONGSIDE the band, on
//     the verge it stops at — never under it. The terrain grid under-reports
//     the road, so the test drives the REAL rasterizer over synthetic MVT
//     layers and judges every trap against `roadMask`, exactly as the roadside
//     collector does. A trap on drawn asphalt is the bug this pins.
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

// Open parkland (so the private-yard frontage rule isn't what's under test
// here) crossed by a motorway and an ordinary street.
function roadyLayers() {
  return [
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'park' }, geom: [wholeTile()] },
    ] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'motorway' },
        geom: [line([[32, 0], [32, CPE - 1]])] },
      { type: 2, tags: { class: 'minor' },
        geom: [line([[0, 10], [CPE - 1, 10]])] },
    ] },
  ];
}
// The same parkland with no ways at all.
function roadlessLayers() {
  return [
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'park' }, geom: [wholeTile()] },
    ] },
  ];
}

const rasterize = (layers, tx = 0, ty = 0) =>
  WorldGen.rasterizeTile(layers, CPE, tx, ty, TILE_EDGE_M);

// What app.js's spawnInTile hands every spawner — the shared options object.
const optsFor = (r) => ({ roadMask: r.roadMask, pois: [] });

const spawnFor = (r, tx = 0, ty = 0) =>
  Traps.spawnSurface(r.grid, r.roadMask, CPE, CPE, tx, ty, TILE_EDGE_M, optsFor(r));

// Trap world-metres → this tile's local cell index.
const cellOf = (v) => Math.floor(v / (TILE_EDGE_M / CPE));

// ─── Surface placement ───────────────────────────────────────────────────────

test('traps: a tile with roads lays some, and every one is off the road band', () => {
  const r = rasterize(roadyLayers());
  const traps = spawnFor(r);
  assert.gt(traps.length, 0, 'the fixture produced traps to check');
  for (const tp of traps) {
    const ix = cellOf(tp.x), iy = cellOf(tp.y);
    assert.inRange(ix, 0, CPE - 1, 'trap x inside the tile');
    assert.inRange(iy, 0, CPE - 1, 'trap y inside the tile');
    assert.falsy(ROAD_TIERS.has(r.grid[iy * CPE + ix]),
      `trap on road terrain at ${ix},${iy}`);
    assert.eq(r.roadMask[iy * CPE + ix], 0,
      `trap under the drawn road band at ${ix},${iy}`);
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

test('traps: "along the road" means it — every trap is on the verge of a band', () => {
  const r = rasterize(roadyLayers());
  const traps = spawnFor(r);
  assert.gt(traps.length, 0, 'there are traps to check');
  for (const tp of traps) {
    const ix = cellOf(tp.x), iy = cellOf(tp.y);
    // Pinned against the SHIPPING predicate, not a restatement of it: if the
    // definition of "roadside" is ever widened, this asks the new question.
    assert.truthy(Traps.isRoadside(r.roadMask, CPE, CPE, ix, iy),
      `trap at ${ix},${iy} is not on the verge of any road band`);
  }
});

test('traps: the verge is the band\'s EDGE neighbours, and never the band itself', () => {
  const r = rasterize(roadyLayers());
  // The ordinary street runs along row 10; its shoulders are rows 9 and 11.
  const col = 12;                               // clear of the motorway at col 32
  assert.eq(r.roadMask[10 * CPE + col], 1, 'the street cell is masked');
  assert.falsy(Traps.isRoadside(r.roadMask, CPE, CPE, col, 10),
    'a masked cell is never roadside — that IS the road');
  assert.truthy(Traps.isRoadside(r.roadMask, CPE, CPE, col, 9), 'north shoulder');
  assert.truthy(Traps.isRoadside(r.roadMask, CPE, CPE, col, 11), 'south shoulder');
  assert.falsy(Traps.isRoadside(r.roadMask, CPE, CPE, col, 8), 'two cells out is not');
});

test('traps: the roadside sample is uniform over the whole verge, and bounded', () => {
  const r = rasterize(roadyLayers());
  let verge = 0;
  for (let y = 0; y < CPE; y++) {
    for (let x = 0; x < CPE; x++) if (Traps.isRoadside(r.roadMask, CPE, CPE, x, y)) verge++;
  }
  assert.gt(verge, Traps.ROADSIDE_SAMPLE,
    'the fixture has more verge than the reservoir holds — the sampling path is exercised');
  const rng = WorldGen.makeRng(12345);
  const s = Traps.sampleRoadsideCells(r.roadMask, CPE, CPE, rng, Traps.ROADSIDE_SAMPLE);
  assert.eq(s.length, Traps.ROADSIDE_SAMPLE,
    'the reservoir fills, and never grows past its size however big the tile');
  for (const idx of s) {
    assert.truthy(Traps.isRoadside(r.roadMask, CPE, CPE, idx % CPE, (idx / CPE) | 0),
      'every sampled cell is on the verge');
  }
  // Uniform, not "the first 96 cells in scan order": the reservoir must reach
  // the bottom of the tile, which a plain head-of-list take never would.
  assert.gt(Math.max(...s.map((i) => (i / CPE) | 0)), CPE / 2,
    'the sample reaches past halfway down the tile');
});

test('traps: the local cell indices agree with the world metres they carry', () => {
  const r = rasterize(roadyLayers(), 3, -2);
  for (const tp of Traps.spawnSurface(r.grid, r.roadMask, CPE, CPE, 3, -2, TILE_EDGE_M, optsFor(r))) {
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

test('traps: a tile with no charted road has no roadside, so it has no traps', () => {
  const r = rasterize(roadlessLayers());
  assert.eq(r.roadMask.reduce((a, b) => a + b, 0), 0, 'fixture really has no band');
  assert.eq(spawnFor(r).length, 0, 'and therefore no traps');
});

test('traps: countMul scales the surface density, and every extra trap still obeys the rules', () => {
  const r = rasterize(roadyLayers());
  const base = spawnFor(r);
  const mul10 = Traps.spawnSurface(r.grid, r.roadMask, CPE, CPE, 0, 0, TILE_EDGE_M, optsFor(r), 10);
  const mul100 = Traps.spawnSurface(r.grid, r.roadMask, CPE, CPE, 0, 0, TILE_EDGE_M, optsFor(r), 100);
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
  // stays at ROADSIDE_SAMPLE rather than widening.
  const implicit = Traps.spawnSurface(r.grid, r.roadMask, CPE, CPE, 0, 0, TILE_EDGE_M, optsFor(r));
  assert.eq(JSON.stringify(implicit.map((t) => t.id)), JSON.stringify(base.map((t) => t.id)),
    'an omitted countMul is identical to the pre-multiplier behaviour');
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
  const there = Traps.spawnSurface(r.grid, r.roadMask, CPE, CPE, 7, 11, TILE_EDGE_M, optsFor(r))
    .map((t) => t.id);
  assert.falsy(here.length === there.length && here.every((id, i) => id === there[i]),
    'the tile coordinates are actually in the seed');
});

test('traps: the id carries the tile and cell, so it is stable across a reload', () => {
  const r = rasterize(roadyLayers(), 5, 6);
  for (const tp of Traps.spawnSurface(r.grid, r.roadMask, CPE, CPE, 5, 6, TILE_EDGE_M, optsFor(r))) {
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

test('traps: the bite is a tenth of a full bar and the bleed is 2⚡/s', () => {
  assert.eq(Traps.STEP_ENERGY, 10, 'stepping on a hidden trap');
  assert.eq(Traps.STAND_ENERGY_PER_S, 2, 'standing on the sprung one');
  assert.eq(Traps.STEP_ENERGY, STARTING_ENERGY / 10,
    'the bite is stated against the bar it comes out of');
});

test('traps: hard mode bites 25⚡ on first contact, the bleed rate is untouched', () => {
  assert.eq(Difficulty.PROFILES.easy.trapBiteMul, 1, 'easy is the base 10⚡ bite');
  assert.eq(Traps.STEP_ENERGY * Difficulty.PROFILES.hard.trapBiteMul, 25,
    'hard scales the base bite to 25⚡');
  const block = (() => {
    const a = APP_JS_SRC.indexOf('  _tickTraps(dt) {');
    const b = APP_JS_SRC.indexOf('\n  }\n', a);
    return APP_JS_SRC.slice(a, b);
  })();
  assert.truthy(/Traps\.STEP_ENERGY \* Difficulty\.get\(\)\.trapBiteMul/.test(block),
    'the bite reads the mode multiplier, not the bare constant');
  assert.falsy(/STAND_ENERGY_PER_S \* Difficulty/.test(block),
    'the bleed rate must not scale with mode');
});

test('traps: standing on one out-drains the fastest passive rest in the game', () => {
  // Lifted from app.js, not restated: the Home rest is maxE over
  // HOME_FULL_REST_S, which is the quickest energy comes back without eating.
  const m = APP_JS_SRC.match(/const HOME_FULL_REST_S = (\d+);/);
  assert.truthy(m, 'HOME_FULL_REST_S is a plain literal');
  const homeRestPerS = STARTING_ENERGY / Number(m[1]);
  assert.gt(Traps.STAND_ENERGY_PER_S, homeRestPerS,
    `the bleed (${Traps.STAND_ENERGY_PER_S}⚡/s) must beat the Home rest `
    + `(${homeRestPerS.toFixed(2)}⚡/s) — otherwise standing still is a way to win`);
});

// ─── The call sites (app.js / render.js can't load headlessly) ───────────────

test('traps: the surface spawn passes the SHARED spawn options, mask and all', () => {
  assert.truthy(
    /Traps\.spawnSurface\(entry\.grid, entry\.roadMask, N, N, tx, ty, this\.tileEdgeM, _spawnOpts,/
      .test(APP_JS_SRC),
    'spawnInTile hands Traps.spawnSurface entry.roadMask and _spawnOpts — the same '
    + 'options every other spawner in that method uses');
  assert.truthy(/Traps\.spawnSurface\([^;]*Difficulty\.get\(\)\.trapCountMul/.test(APP_JS_SRC),
    'the surface density scales with the game mode, not a fixed rate');
});

test('traps: the tick asks where the PLAYER is, never where the camera is', () => {
  const block = (() => {
    const a = APP_JS_SRC.indexOf('  _tickTraps(dt) {');
    const b = APP_JS_SRC.indexOf('\n  }\n', a);
    assert.truthy(a > 0 && b > a, 'found _tickTraps in app.js');
    return APP_JS_SRC.slice(a, b);
  })();
  assert.truthy(/this\.playerToWorldCell\(\)/.test(block),
    'the cell under the feet comes from playerToWorldCell');
  assert.falsy(/viewAnchorCell|viewAnchorWorldM|viewCenterX/.test(block),
    'a peek drag must not spring a trap the body is nowhere near (CLAUDE.md: '
    + 'the camera is not the player)');
  assert.truthy(/Traps\.spring\(this\.save, trap\.id\)/.test(block),
    'the reveal goes through Traps.spring, which is what makes the bite land once');
  assert.truthy(/persistSave\(this\.save\)/.test(block),
    'and it is written straight away, so a discovered trap stays discovered');
  assert.truthy(/this\._painFlash\(\)/.test(block), 'the bite carries the pain effect');
  assert.truthy(/Traps\.STAND_ENERGY_PER_S \* dt/.test(block),
    'the bleed is per SECOND, accumulated off the frame delta');
});

test('traps: the numbers land on the trap\'s own cell, through _popEnergy', () => {
  const block = APP_JS_SRC.slice(APP_JS_SRC.indexOf('  _tickTraps(dt) {'));
  const head = block.slice(0, block.indexOf('\n  }\n'));
  const pops = head.match(/this\._popEnergy\([^)]*\)/g) || [];
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
  assert.truthy(/makeTrapTextures\(this\);/.test(APP_JS_SRC), 'and they are baked at boot');
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
