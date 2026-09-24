// A cave level's OWN extras — the wall torches, the mushroom fairy rings round
// some chests, the seeded gold and the X marks (worldgen.js caveWallTorches /
// caveChestRings / caveCoins / caveTreasureMarks), plus the level-wide monster
// roamers in app.js spawnCaveCreatures.
//
// Until Sep 2026 everything on a cave level hung off something else: torches
// stood only where the street furniture overhead was, monsters, coins and
// traps crowded the up-staircases, and a level under a quiet suburb — or the
// stretch of one a rope or a portal dropped you into — had no light, no foe
// and no find in it at all. These fill the whole floor, each off its own
// seeded stream, rolled AFTER the rocks so no existing cave rearranges.

(function () {

const CAVE_FLOOR = WorldGen.T.CAVE_FLOOR, CAVE_WALL = WorldGen.T.CAVE_WALL;
const TILE_M = 1600, TX = 3, TY = 5, N = 229;
const cellM = TILE_M / N;
const cellOf = (o) => ({
  lix: Math.floor((o.x - TX * TILE_M) / cellM),
  liy: Math.floor((o.y - TY * TILE_M) / cellM),
});
const at = (lix, liy) => ({ x: TX * TILE_M + (lix + 0.5) * cellM, y: TY * TILE_M + (liy + 0.5) * cellM });
// A town-shaped level: floor, with a wall band every 12 cells (the buildings
// and roads overhead) — so a sconce always has a wall within reach.
const townGrid = () => {
  const g = new Uint8Array(N * N).fill(CAVE_FLOOR);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (x % 12 < 3 && y % 20 < 14) g[y * N + x] = CAVE_WALL;
  }
  return g;
};
const quadrantsHit = (list) => {
  const q = new Set();
  for (const o of list) { const { lix, liy } = cellOf(o); q.add(`${lix < N / 2 ? 0 : 1}${liy < N / 2 ? 0 : 1}`); }
  return q.size;
};

// ── Wall torches ───────────────────────────────────────────────────────────

test('cave extras: wall torches light the whole level with no street overhead at all', () => {
  const grid = townGrid();
  const out = WorldGen.caveWallTorches(grid, N, TX, TY, TILE_M, 1, new Set());
  assert.gt(out.length, 20, 'a level of a tile carries a few dozen');
  assert.eq(quadrantsHit(out), 4, 'spread across the level, not bunched');
  for (const t of out) {
    assert.eq(t.kind, 'torch', 'the same kind as a street-furniture torch — one light row, one sprite');
    const { lix, liy } = cellOf(t);
    assert.eq(grid[liy * N + lix], CAVE_FLOOR, 'stands on floor');
    const wallBeside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
      grid[(liy + dy) * N + lix + dx] === CAVE_WALL);
    assert.truthy(wallBeside, 'beside a wall, like a sconce');
    assert.truthy(t.id.startsWith(`torch_w_1_${TX}_${TY}_${lix}_${liy}`), 'id is positional + carries the depth');
  }
});

test('cave extras: wall torches are deterministic per tile+depth and respect occupied cells', () => {
  const a = WorldGen.caveWallTorches(townGrid(), N, TX, TY, TILE_M, 2, new Set()).map(t => t.id).join();
  const b = WorldGen.caveWallTorches(townGrid(), N, TX, TY, TILE_M, 2, new Set()).map(t => t.id).join();
  const c = WorldGen.caveWallTorches(townGrid(), N, TX, TY, TILE_M, 3, new Set()).map(t => t.id).join();
  assert.eq(a, b, 'same level, same torches');
  assert.truthy(a !== c, 'another depth lights other corners');
  const occupied = new Set();
  for (let i = 0; i < N * N; i += 2) occupied.add(i);
  for (const t of WorldGen.caveWallTorches(townGrid(), N, TX, TY, TILE_M, 2, occupied)) {
    const { lix, liy } = cellOf(t);
    assert.truthy(occupied.has(liy * N + lix), 'the cell is claimed');
    assert.eq((liy * N + lix) % 2, 1, 'and it was not one already taken');
  }
});

// ── Mushroom fairy rings ───────────────────────────────────────────────────

test('cave extras: the ring is a closed round loop of 12 at radius 2', () => {
  const R = WorldGen.CAVE_RING_CELLS;
  assert.eq(R.length, 12, 'twelve cells');
  for (const [dx, dy] of R) assert.eq(Math.round(Math.hypot(dx, dy)), 2, 'each at radius 2');
});

test('cave extras: some chests sit in a cleared ring of glowing mushrooms', () => {
  const grid = new Uint8Array(N * N).fill(CAVE_FLOOR);
  const objects = [], occupied = new Set();
  // Forty chests, each in a rubble field of rocks.
  for (let i = 0; i < 40; i++) {
    const lix = 6 + (i % 8) * 25, liy = 6 + Math.floor(i / 8) * 40;
    objects.push({ kind: 'chest', ...at(lix, liy), id: `c${i}`, poiClass: 'park' });
    occupied.add(liy * N + lix);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (!dx && !dy) continue;
      objects.push({ kind: 'mineralrock', ...at(lix + dx, liy + dy), id: `r${i}_${dx}_${dy}` });
      occupied.add((liy + dy) * N + lix + dx);
    }
  }
  const same = objects;
  const wildplants = [];
  WorldGen.caveChestRings(objects, grid, N, TX, TY, TILE_M, 1, wildplants, occupied);
  assert.truthy(objects === same, 'the level keeps its own objects array (compacted in place)');
  const ringed = objects.filter(o => o.kind === 'chest').filter(ch => {
    const c = cellOf(ch);
    return wildplants.some(w => { const m = cellOf(w); return Math.abs(m.lix - c.lix) <= 2 && Math.abs(m.liy - c.liy) <= 2; });
  });
  assert.inRange(ringed.length, 4, 22, 'about a third of the chests are ringed');
  for (const ch of ringed) {
    const c = cellOf(ch);
    const around = wildplants.filter(w => { const m = cellOf(w); return Math.abs(m.lix - c.lix) <= 2 && Math.abs(m.liy - c.liy) <= 2; });
    assert.eq(around.length, 12, 'a whole loop — the rocks were swept out of it');
    for (const w of around) {
      assert.eq(w.crop, 'mushroom', 'the cave mushroom');
      assert.truthy(w._cave, 'drawn as the blue luminous cap, with its glow');
    }
    const rocksInside = objects.filter(o => o.kind === 'mineralrock').filter(o => {
      const m = cellOf(o); return Math.round(Math.hypot(m.lix - c.lix, m.liy - c.liy)) <= 2;
    });
    assert.eq(rocksInside.length, 0, 'a clearing: no rock inside or on the ring');
  }
  const plain = objects.filter(o => o.kind === 'chest').length - ringed.length;
  // The sweep is the ring (12) and the clearing inside it (8); the four
  // corners of the 5×5 round off the circle and keep their rocks.
  assert.eq(objects.filter(o => o.kind === 'mineralrock').length, 40 * 48 - ringed.length * 20,
    `an unringed chest keeps every rock (${plain} of them)`);
});

// ── Seeded gold ────────────────────────────────────────────────────────────

test('cave extras: seeded coins cover the level, positional ids, never on a taken cell', () => {
  const grid = townGrid();
  const occupied = new Set([0, 1, 2]);
  const out = WorldGen.caveCoins(grid, N, TX, TY, TILE_M, 1, occupied);
  assert.gt(out.length, 60, 'a level of gold, not a handful');
  assert.eq(quadrantsHit(out), 4, 'spread across the whole level');
  const seen = new Set();
  for (const c of out) {
    assert.eq(c.kind, 'coindrop', 'the coin lane every coin walks');
    assert.truthy(c.seeded, 'flagged so the tap records the pickup');
    assert.eq(c.expiresAt, undefined, 'never expires');
    const { lix, liy } = cellOf(c);
    assert.eq(c.id, `ccoin_1_${TX}_${TY}_${lix}_${liy}`, 'id derived from position');
    assert.eq(grid[liy * N + lix], CAVE_FLOOR, 'on floor');
    assert.falsy(seen.has(c.id), 'one per cell');
    seen.add(c.id);
  }
  const again = WorldGen.caveCoins(townGrid(), N, TX, TY, TILE_M, 1, new Set([0, 1, 2])).map(c => c.id).join();
  assert.eq(again, out.map(c => c.id).join(), 'deterministic per tile+depth');
});

test('cave extras: a picked-up seeded coin is written to save.foundTreasures', () => {
  const body = INTERACT_JS_SRC.slice(INTERACT_JS_SRC.indexOf("{ name: 'coindrop'"));
  const handler = body.slice(0, body.indexOf('}},'));
  assert.truthy(/if \(coin\.seeded\) save\.foundTreasures = \[\.\.\.\(save\.foundTreasures \|\| \[\]\), coin\.id\];/.test(handler),
    'the coin tap records a seeded coin\'s id');
});

// ── X marks ────────────────────────────────────────────────────────────────

test('cave extras: 4..10 X marks per level, on free floor, ids carry the depth', () => {
  const grid = townGrid();
  const out = WorldGen.caveTreasureMarks(grid, N, TX, TY, TILE_M, 3, new Set());
  assert.inRange(out.length, 4, 10, 'the surface scatter\'s count');
  for (const t of out) {
    const { lix, liy } = cellOf(t);
    assert.eq(grid[liy * N + lix], CAVE_FLOOR, 'on floor');
    assert.eq(t.id, `treasure_c3_${TX}_${TY}_${lix}_${liy}`, 'positional, with the depth');
  }
});

// ── Wiring ─────────────────────────────────────────────────────────────────

test('cave extras: loadCaveTile rolls them after the rocks and mushrooms, and ships them on the entry', () => {
  const src = WORLDGEN_SRC;
  const start = src.indexOf('async function loadCaveTile(');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  const i = (s) => body.indexOf(s);
  assert.gt(i('caveChestRings('), i('spawnCaveMushrooms('), 'rings after the mushrooms');
  assert.gt(i('caveWallTorches('), i('spawnCaveMushrooms('), 'wall torches after the rocks + mushrooms');
  assert.gt(i('caveCoins('), i('spawnCaveMushrooms('), 'coins after');
  assert.gt(i('caveTreasureMarks('), i('spawnCaveMushrooms('), 'X marks after');
  assert.truthy(/extraTreasures, caveCoinSeeds,/.test(body), 'X marks ride extraTreasures; coins ride caveCoinSeeds');
});

test('cave extras: spawnCaveCreatures folds the seeded coins in, minus the found ones', () => {
  const BODY = SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, '');
  const grid = new Array(200 * 200).fill(CAVE_FLOOR);
  const seeds = [
    { kind: 'coindrop', x: 402.5, y: 402.5, id: 'ccoin_1_0_0_80_80', seeded: true },
    { kind: 'coindrop', x: 602.5, y: 602.5, id: 'ccoin_1_0_0_120_120', seeded: true },
  ];
  const entry = { cellsPerEdge: 200, tileEdgeM: 1000, grid, objects: [], caveCoinSeeds: seeds };
  const scene = { tileEdgeM: 1000, save: { caught: [], foundTreasures: ['ccoin_1_0_0_80_80'] } };
  new Function('entry', 'tx', 'ty', 'depth', BODY).call(scene, entry, 0, 0, 1);
  const ids = entry.coinDrops.map(c => c.id);
  assert.includes(ids, 'ccoin_1_0_0_120_120', 'an unfound seeded coin lies on the floor');
  assert.falsy(ids.includes('ccoin_1_0_0_80_80'), 'a found one stays found');
});

test('cave extras: monsters roam the whole level, not just the stair mouths', () => {
  const BODY = SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, '');
  const NN = 229;
  // One up-stair in a corner — the anchored pack stays near it.
  const entry = { cellsPerEdge: NN, tileEdgeM: 1600, grid: new Array(NN * NN).fill(CAVE_FLOOR),
    objects: [{ kind: 'staircase', dir: 'up', x: 5 * (1600 / NN), y: 5 * (1600 / NN) }] };
  const scene = { tileEdgeM: 1600, save: { caught: [] } };
  new Function('entry', 'tx', 'ty', 'depth', BODY).call(scene, entry, 0, 0, 1);
  const m = 1600 / NN;
  const far = entry.creatures.filter(c => c.id.startsWith('mon_'))
    .filter(c => Math.max(c.x / m, c.y / m) > 60);
  assert.gt(far.length, 40, 'plenty of foes far from the only stair');
  const ids = new Set(entry.creatures.map(c => c.id));
  assert.eq(ids.size, entry.creatures.length, 'every creature id unique');
  // And a killed roamer stays dead.
  const victim = far[0].id;
  const entry2 = { ...entry, creatures: undefined, coinDrops: undefined, _spawned: false };
  const scene2 = { tileEdgeM: 1600, save: { caught: [victim] } };
  new Function('entry', 'tx', 'ty', 'depth', BODY).call(scene2, entry2, 0, 0, 1);
  assert.falsy(entry2.creatures.some(c => c.id === victim), 'save.caught keeps a roamer dead');
});
})();
