// Loose coins on the cave floor — app.js spawnCaveCreatures lays a handful of
// entry.coinDrops per level tile beside the monsters and rabbits. They are the
// same record a coin-burst coin is (kind 'coindrop', world x/y, an id) so the
// renderer's coin pass and interact.js's 'coindrop' tap pick them up unchanged
// at every depth — minus expiresAt, since a coin found by digging must still be
// there when the torch swings back. The pass is guarded on entry.coinDrops the
// way the fauna are on entry.creatures: a REBUILT tile carries coinDrops
// across and re-runs the spawn pass, so the guard is what stops a second
// handful landing on the first.
//
// Runs the lifted method the way fauna_spawn.test.js does (SPAWN_CAVE_SRC is
// read fresh from app.js by run.js each run).

(function () {
const BODY = SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, '');
const CAVE_FLOOR = 24, CAVE_WALL = 25;
const run = (entry, tx = 0, ty = 0, depth = 1) => {
  const scene = { tileEdgeM: entry.tileEdgeM, save: { caught: [] } };
  new Function('entry', 'tx', 'ty', 'depth', BODY).call(scene, entry, tx, ty, depth);
  return entry;
};
const floorTile = (N = 200, objects = []) => ({
  cellsPerEdge: N, tileEdgeM: 1000,
  grid: new Array(N * N).fill(CAVE_FLOOR),
  objects,
});

test('cave coins: a handful of coindrops lands on each level tile', () => {
  const entry = run(floorTile());
  assert.truthy(Array.isArray(entry.coinDrops), 'the pass creates entry.coinDrops');
  assert.gte(entry.coinDrops.length, 4, 'at least the minimum handful');
  assert.lte(entry.coinDrops.length, 8, 'no more than the maximum — a trickle, not a burst');
  for (const c of entry.coinDrops) {
    assert.eq(c.kind, 'coindrop', 'the same record the coin-burst coins use');
    assert.truthy(typeof c.id === 'string' && c.id.startsWith('cavecoin_'), 'a stable per-tile id');
    assert.eq(c.expiresAt, undefined, 'a cave coin never expires on its own');
    assert.truthy(c.x >= 0 && c.x < 1000 && c.y >= 0 && c.y < 1000, 'inside the tile');
  }
  const cells = new Set(entry.coinDrops.map(c => `${Math.floor(c.x / 5)},${Math.floor(c.y / 5)}`));
  assert.eq(cells.size, entry.coinDrops.length, 'one coin per cell');
});

test('cave coins: only on floor, never under a staircase or a rock', () => {
  const N = 200, cellM = 1000 / N;
  const entry = floorTile(N);
  // One up-stair in the middle (the spawn anchor) and a ring of rocks round it.
  const mid = N / 2;
  const at = (cx, cy) => ({ x: (cx + 0.5) * cellM, y: (cy + 0.5) * cellM });
  entry.objects.push({ kind: 'staircase', dir: 'up', ...at(mid, mid) });
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (dx || dy) entry.objects.push({ kind: 'mineralrock', ...at(mid + dx, mid + dy) });
  }
  // Wall off a band of cells too.
  for (let cy = 0; cy < N; cy++) for (let cx = mid + 10; cx < mid + 14; cx++) entry.grid[cy * N + cx] = CAVE_WALL;
  run(entry);
  const taken = new Set(entry.objects.map(o => `${Math.floor(o.x / cellM)},${Math.floor(o.y / cellM)}`));
  for (const c of entry.coinDrops) {
    const cx = Math.floor(c.x / cellM), cy = Math.floor(c.y / cellM);
    assert.eq(entry.grid[cy * N + cx], CAVE_FLOOR, 'a coin lies on cave floor');
    assert.falsy(taken.has(`${cx},${cy}`), 'a coin never shares a cell with a stair or a rock');
  }
});

test('cave coins: the pass is deterministic per tile and depth', () => {
  const a = run(floorTile(), 3, 7, 2).coinDrops.map(c => `${c.x},${c.y}`).join('|');
  const b = run(floorTile(), 3, 7, 2).coinDrops.map(c => `${c.x},${c.y}`).join('|');
  const other = run(floorTile(), 3, 7, 3).coinDrops.map(c => `${c.x},${c.y}`).join('|');
  assert.eq(a, b, 'the same tile lays the same coins');
  assert.truthy(a !== other, 'a different depth lays different coins');
});

test('cave coins: a rebuilt tile that carried its coins does not get a second handful', () => {
  const carried = [{ kind: 'coindrop', x: 12.5, y: 12.5, id: 'cavecoin_1_0_0_0' }];
  const entry = floorTile();
  entry.coinDrops = carried;
  run(entry);
  assert.eq(entry.coinDrops, carried, 'the carried list is left exactly as it was');
  assert.eq(entry.coinDrops.length, 1, 'no coins were added to it');
  assert.truthy(entry.creatures && entry.creatures.length > 0, 'the fauna pass still ran');
});

test('cave coins: the pass leaves the monster and rabbit draw order alone', () => {
  // Coins are drawn AFTER the creatures off the same rng, so the fauna a tile
  // gets must be byte-identical to what a coin-less pass would place. Pin the
  // source order: the coin block sits after the rabbit loop.
  const rabbits = SPAWN_CAVE_SRC.indexOf("kind: 'rabbit'");
  const coins = SPAWN_CAVE_SRC.indexOf("kind: 'coindrop'");
  assert.truthy(rabbits > 0 && coins > rabbits, 'coins are rolled after the rabbits');
});
})();
