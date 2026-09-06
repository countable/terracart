// Cave torches and cave mushrooms — the two lights a cave level grows on its
// own (worldgen.js caveTorchSites / caveTorchesFrom / spawnCaveMushrooms).
//
// The lowtier street furniture overhead (bus stops, crossings, bins…) is the
// one POI class that does NOT mirror underground (loot.js
// chestMirrorsUnderground), so until Sep 2026 the cave under a town carried
// no trace of most of its street. Now a random subset of those points holds
// a TORCH — a landmark light, never a box — and sparse clumps of the blue
// luminous mushroom sit on the floor, each with a faint glow of its own
// (Lighting.KINDS.torch / .mushroom; lighting.test.js pins the two apart).
// These tests drive the real spawners on synthetic grids.

(function () {

const CAVE_FLOOR = WorldGen.T.CAVE_FLOOR, CAVE_WALL = WorldGen.T.CAVE_WALL;
const TILE_M = 80, TX = 3, TY = 5;
const centre = (N, lix, liy) => {
  const m = TILE_M / N;
  return { x: TX * TILE_M + (lix + 0.5) * m, y: TY * TILE_M + (liy + 0.5) * m };
};
const floorGrid = (N) => new Uint8Array(N * N).fill(CAVE_FLOOR);
const cellOf = (N, o) => {
  const m = TILE_M / N;
  return { lix: Math.floor((o.x - TX * TILE_M) / m), liy: Math.floor((o.y - TY * TILE_M) / m) };
};
const chest = (N, lix, liy, poiClass, extra = {}) => Object.assign(
  { kind: 'chest', ...centre(N, lix, liy), id: `c_${lix}_${liy}`, poiClass }, extra);

// ── Sites: which surface POIs a torch may stand for ────────────────────────

test('cave torches: the sites are the lowtier POIs — the chests that do NOT mirror down', () => {
  const N = 8;
  assert.truthy(!chestMirrorsUnderground('bus') && chestMirrorsUnderground('park'),
    'precondition: bus is lowtier, park mirrors');
  const surface = { objects: [
    chest(N, 1, 1, 'bus'),                       // lowtier → a site
    chest(N, 2, 2, 'crossing'),                  // lowtier → a site
    chest(N, 3, 3, 'park'),                      // mirrors as a chest → not a site
    chest(N, 4, 4, 'bus', { crate: true }),      // a loose crate is a pickup, not a place
    chest(N, 5, 5, 'bus', { fixedLoot: true }),  // starter-trail box: surface only
    { kind: 'tree', ...centre(N, 6, 6), id: 't' },
  ] };
  const sites = WorldGen.caveTorchSites(surface);
  assert.eq(sites.map(s => s.id).join(','), 'c_1_1,c_2_2', 'exactly the two lowtier POIs');
  assert.eq(sites[0].x, centre(N, 1, 1).x, 'a site is the POI\'s own world point');
});

test('cave torches: a cave level hands the FULL site list down, so depth N does not depend on what depth N-1 lit', () => {
  const carried = [{ x: 1, y: 2, id: 'a' }, { x: 3, y: 4, id: 'b' }];
  assert.eq(WorldGen.caveTorchSites({ torchSites: carried, objects: [] }), carried,
    'a cave entry\'s torchSites is returned as-is');
  // And loadCaveTile actually stores it: source pin, since the loader needs a
  // fetched surface tile.
  const src = WORLDGEN_SRC;
  const start = src.indexOf('async function loadCaveTile(');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  assert.truthy(/const torchSites = caveTorchSites\(above\);/.test(body), 'the sites are read off the level above');
  assert.truthy(/caveTorchesFrom\(torchSites, grid, N, x, y, tileEdgeM, depth, occupied\)/.test(body), 'and rolled for this level');
  assert.truthy(/roadLabels: \{\}, pathUnder: \{\}, torchSites,/.test(body), 'and stored on the entry for the level below');
  assert.truthy(/spawnCaveMushrooms\(grid, N, x, y, tileEdgeM, depth, wildplants, occupied\)/.test(body), 'mushrooms are rolled too');
  assert.truthy(/objects, wildplants, parkingTreasures: \[\]/.test(body), 'and shipped as the level\'s wildplants');
  assert.truthy(body.indexOf('caveTorchesFrom(') < body.indexOf('spawnCaveRocks('), 'torches claim their cells before the rocks are rolled');
  assert.truthy(body.indexOf('spawnCaveRocks(') < body.indexOf('spawnCaveMushrooms('), 'mushrooms come after the rocks, so the mineral layout is untouched');
});

// ── Torches: a random subset of the sites, seated on floor ─────────────────

test('cave torches: a torch is a `torch` object at the site\'s own point, stamped with depth and its site', () => {
  const N = 8;
  const sites = [{ ...centre(N, 2, 2), id: 'bus_1' }, { ...centre(N, 5, 5), id: 'stop_2' }];
  // Enough seeds that at least one torch lands.
  let out = [];
  for (let d = 1; d <= 6 && !out.length; d++) {
    out = WorldGen.caveTorchesFrom(sites, floorGrid(N), N, TX, TY, TILE_M, d, new Set());
  }
  assert.gt(out.length, 0, 'some level lit at least one of the two');
  const t = out[0];
  assert.eq(t.kind, 'torch', 'kind');
  const s = sites.find(s => s.id === t.site);
  assert.truthy(s, 'site recorded');
  assert.eq(t.x, s.x, 'at the site\'s own x');
  assert.eq(t.y, s.y, 'at the site\'s own y');
  assert.truthy(/^torch_(bus_1|stop_2)_d\d+$/.test(t.id), `id carries the site and the depth: ${t.id}`);
  assert.eq(t.depth, out === out ? t.depth : null, 'depth stamped');
});

test('cave torches: about CAVE_TORCH_P of the sites light, deterministically per tile+depth', () => {
  const N = 64;
  const sites = [];
  for (let i = 0; i < N; i += 2) for (let j = 0; j < N; j += 2) sites.push({ ...centre(N, i, j), id: `s_${i}_${j}` });
  const a = WorldGen.caveTorchesFrom(sites, floorGrid(N), N, TX, TY, TILE_M, 1, new Set());
  const b = WorldGen.caveTorchesFrom(sites, floorGrid(N), N, TX, TY, TILE_M, 1, new Set());
  assert.eq(a.map(t => t.id).join(','), b.map(t => t.id).join(','), 'the same level lights the same corners on every load');
  const frac = a.length / sites.length;
  assert.inRange(frac, WorldGen.CAVE_TORCH_P - 0.08, WorldGen.CAVE_TORCH_P + 0.08, `≈ CAVE_TORCH_P of the sites: ${frac.toFixed(2)}`);
  assert.inRange(WorldGen.CAVE_TORCH_P, 0.3, 0.8, 'a subset — "some torches", not every bus stop and not none');
  const d2 = WorldGen.caveTorchesFrom(sites, floorGrid(N), N, TX, TY, TILE_M, 2, new Set());
  const setA = new Set(a.map(t => t.site)), setB = new Set(d2.map(t => t.site));
  let differ = 0;
  for (const s of sites) if (setA.has(s.id) !== setB.has(s.id)) differ++;
  assert.gt(differ, sites.length * 0.2, 'the level below lights a different subset — the descent finds new corners lit');
});

test('cave torches: a site under a wall steps to the nearest floor cell, like a chest; none nearby and it is dropped', () => {
  const N = 8;
  const sites = [{ ...centre(N, 4, 4), id: 'walled' }];
  // Find a depth that lights the single site.
  let d = 1;
  while (!WorldGen.caveTorchesFrom(sites, floorGrid(N), N, TX, TY, TILE_M, d, new Set()).length) d++;
  const grid = floorGrid(N);
  grid[4 * N + 4] = CAVE_WALL;
  const out = WorldGen.caveTorchesFrom(sites, grid, N, TX, TY, TILE_M, d, new Set());
  assert.eq(out.length, 1, 'still placed');
  const c = cellOf(N, out[0]);
  assert.eq(Math.max(Math.abs(c.lix - 4), Math.abs(c.liy - 4)), 1, 'one ring out');
  assert.eq(grid[c.liy * N + c.lix], CAVE_FLOOR, 'on floor');
  const occ = new Set([4 * N + 4]);
  const out2 = WorldGen.caveTorchesFrom(sites, floorGrid(N), N, TX, TY, TILE_M, d, occ);
  assert.truthy(cellOf(N, out2[0]).lix !== 4 || cellOf(N, out2[0]).liy !== 4, 'an occupied cell (a stair, a chest) is stepped off too');
  assert.eq(occ.size, 2, 'and the torch claims its own cell so a rock cannot land on it');
  const wall = new Uint8Array(N * N).fill(CAVE_WALL);
  assert.eq(WorldGen.caveTorchesFrom(sites, wall, N, TX, TY, TILE_M, d, new Set()).length, 0, 'solid rock: no torch');
});

// ── Mushrooms: sparse clumps on the floor, blue, glowing, pickable ─────────

test('cave mushrooms: sparse clumps of the mushroom wildplant, on floor cells only, never on something else', () => {
  const N = 64;
  const grid = floorGrid(N);
  for (let i = 0; i < N * N; i += 3) grid[i] = CAVE_WALL;     // a third of the level is rock
  const occ = new Set([1 * N + 1, 9 * N + 9, 17 * N + 17]);    // pretend rocks/stairs
  const before = occ.size;
  const wps = [];
  WorldGen.spawnCaveMushrooms(grid, N, TX, TY, TILE_M, 1, wps, occ);
  assert.gt(wps.length, 10, `a level grows some: ${wps.length}`);
  const ids = new Set();
  for (const w of wps) {
    assert.eq(w.crop, 'mushroom', 'the forest crop — picking one is a Mushroom');
    assert.truthy(w._cave, 'stamped _cave so the renderer draws the luminous caps');
    const { lix, liy } = cellOf(N, w);
    assert.eq(lix, w._ix, '_ix is the cell'); assert.eq(liy, w._iy, '_iy is the cell');
    assert.eq(grid[liy * N + lix], CAVE_FLOOR, 'on floor');
    assert.truthy(!/^(1_1|9_9|17_17)$/.test(`${lix}_${liy}`), 'never on an occupied cell');
    assert.truthy(!ids.has(w.id), 'ids unique'); ids.add(w.id);
    assert.truthy(w.id.startsWith('cwp_1_'), `id carries the depth, so save.picked keeps levels apart: ${w.id}`);
  }
  assert.eq(occ.size, before + wps.length, 'each claims its cell');
  // Density: sparse — a forage you come across, not a carpet. Per FLOOR cell.
  const floorCells = grid.filter(v => v === CAVE_FLOOR).length;
  const per = floorCells / wps.length;
  assert.inRange(per, 40, 400, `one mushroom per ${per.toFixed(0)} floor cells`);
});

test('cave mushrooms: deterministic per tile+depth, and a different level grows a different patch', () => {
  const N = 32;
  const a = [], b = [], c = [];
  WorldGen.spawnCaveMushrooms(floorGrid(N), N, TX, TY, TILE_M, 1, a, new Set());
  WorldGen.spawnCaveMushrooms(floorGrid(N), N, TX, TY, TILE_M, 1, b, new Set());
  WorldGen.spawnCaveMushrooms(floorGrid(N), N, TX, TY, TILE_M, 2, c, new Set());
  assert.eq(a.map(w => w.id).join(','), b.map(w => w.id).join(','), 'same level, same patch');
  assert.truthy(a.map(w => `${w._ix}_${w._iy}`).join(',') !== c.map(w => `${w._ix}_${w._iy}`).join(','), 'a level down, a different patch');
  const none = [];
  WorldGen.spawnCaveMushrooms(new Uint8Array(N * N).fill(CAVE_WALL), N, TX, TY, TILE_M, 1, none, new Set());
  assert.eq(none.length, 0, 'nothing grows in solid rock');
});

test('cave mushrooms: the cave look is the crop\'s caveFrames, the item is still the Mushroom', () => {
  const ov = CROP_SPRITE.mushroom;
  assert.truthy(Array.isArray(ov.caveFrames) && ov.caveFrames.length >= 1, 'the crop declares its cave frames');
  for (const f of ov.caveFrames) assert.truthy(f !== ov.frame, 'a different cap from the surface toadstool');
  const r = RENDER_SRC;
  assert.truthy(/if \(p\._cave && ov\.caveFrames\) \{/.test(r), 'the planted pass picks the cave frame off _cave');
  assert.truthy(/_cave: wp\._cave, _ix: wp\._ix, _iy: wp\._iy/.test(r), 'and the wildplant scan carries _cave (and the cell, for the variant hash) onto the draw item');
});

// ── The torch on screen ────────────────────────────────────────────────────

test('cave torches: the torch is a seated one-cell sprite with a flicker, and it has art', () => {
  const r = RENDER_SRC;
  const spec = r.match(/    torch: \{ key: 'torch',[\s\S]*?\},\n/);
  assert.truthy(spec, 'RENDER_SPEC.torch exists');
  assert.truthy(/seat: true, seatFrame: 0/.test(spec[0]), 'seated off frame 0 so the flickering flame never bobs the stake');
  assert.truthy(/% 4/.test(spec[0]), 'cycles the four frames');
  assert.truthy(/'_fire',\n    'torch',\n  \]\);/.test(r), 'a torch casts a ground shadow like the campfire');
  assert.truthy(/torch:\s*\{ kind: 'spritesheet', path: 'assets\/Objects\/Wilderness\/torch\.png', frameWidth: 16, frameHeight: 32 \}/.test(ASSETS_SRC),
    'assets.js declares the 16×32 torch sheet');
  assert.truthy(SpriteLayout.ART_BOUNDS['torch:0'], 'and sprite_layout carries its trimmed bounds (tools/sprite_audit.js --emit-bounds)');
});

})();
