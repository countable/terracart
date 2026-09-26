// The starter stash: four Books, a Rope and a Trap Disarm Kit, one per small
// crate, scattered through the resource ring around home
// (starter.js scatterStarterStash behind app.js's _scatterStarterStash
// wrapper; STARTER_STASH, STARTER_STASH_R_CELLS in app.js).
//
// The function is lifted out of starter.js and RUN on a synthetic tile, with the
// coords helpers stubbed to the tile's own metre grid (1 m cells), so what is
// tested is where it actually seats crates and what they hold.

(function () {
const app = APP_JS_SRC;
const starter = STARTER_JS_SRC;
const lift = (sig) => {
  const a = starter.indexOf('\n  ' + sig);
  assert.truthy(a > 0, 'found ' + sig);
  const b = starter.indexOf('\n  }\n', a);
  return starter.slice(a + 1 + 2 + sig.length, b);
};
const body = lift('function scatterStarterStash(scene, entry, tx, ty, spawnIX, spawnIY, usedSeats) {');
const stash = eval(app.match(/const STARTER_STASH = (\[[\s\S]*?\]);/)[1]);
const R = eval(app.match(/const STARTER_STASH_R_CELLS = (\[[^\]]*\]);/)[1]);

const run = (grid, opts = {}) => {
  const N = 64;
  const entry = { cellsPerEdge: N, grid: grid || new Array(N * N).fill(0), objects: [], wildplants: [], ...opts };
  const scene = { tileEdgeM: N, cellM: 1 };
  const w2c = (s, x, y) => ({ cellIX: Math.floor(x), cellIY: Math.floor(y) });
  const c2w = (s, ix, iy) => ({ x: ix + 0.5, y: iy + 0.5 });
  new Function('scene', 'entry', 'tx', 'ty', 'spawnIX', 'spawnIY', 'usedSeats',
               'worldMetersToAbsCell', 'absCellCenterMeters', 'STARTER_STASH', 'STARTER_STASH_R_CELLS', body)
    .call(null, scene, entry, 0, 0, 32, 32, new Set(), w2c, c2w, stash, R);
  return entry.objects;
};

test('starter stash: four Books, a Rope and a Trap Disarm Kit', () => {
  const ids = stash.map((s) => s.id).sort().join();
  assert.eq(ids, 'book,book,book,book,rope,trap_kit', 'what the stash holds');
});

test('starter stash: every crate is seated, in the resource ring, one to a cell', () => {
  const crates = run();
  assert.eq(crates.length, stash.length, 'all six seated on open ground');
  const cells = new Set();
  for (const c of crates) {
    assert.truthy(c.fixedLoot && c.crate, 'a fixed-contents crate');
    assert.truthy(/^stash_start_/.test(c.id), 'its own id — never the trail arrow\'s chest_start_');
    const d = Math.max(Math.abs(Math.floor(c.x) - 32), Math.abs(Math.floor(c.y) - 32));
    assert.truthy(d >= R[0] - 1 && d <= R[1] + 1, `${c.id} ${d} cells out, inside the ring`);
    cells.add(Math.floor(c.x) + ',' + Math.floor(c.y));
  }
  assert.eq(cells.size, crates.length, 'no two share a cell');
});

test('starter stash: the same anchor seats the same crates (PLACED, not rolled)', () => {
  const a = run().map((c) => `${c.id}@${c.x},${c.y}`).join();
  const b = run().map((c) => `${c.id}@${c.x},${c.y}`).join();
  assert.eq(a, b, 'a rebuild or reload puts them back where they were');
});

test('starter stash: never on water or a road', () => {
  const N = 64;
  const grid = new Array(N * N).fill(0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x > 32) grid[y * N + x] = 3;   // east half water
  const roadMask = new Uint8Array(N * N);
  for (let x = 0; x < N; x++) roadMask[20 * N + x] = 1;
  for (const c of run(grid, { roadMask })) {
    assert.truthy(Math.floor(c.x) <= 32, `${c.id} on dry land`);
    assert.truthy(Math.floor(c.y) !== 20, `${c.id} off the road band`);
  }
});

test('starter stash: runs once per tile build, beside the trail', () => {
  assert.truthy(/scene\._scatterStarterStash\(entry, tx, ty, spawnIX, spawnIY, usedSeats\);/.test(starter),
    'called from _placeStarterTrail (gated on entry._starterTrail, re-run on a rebuild)');
});
})();
