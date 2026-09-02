// FINDING 2 — the fauna spawner must consult the road mask on EVERY candidate
// cell, not just RESIDENTIAL ones.
//
// WHAT BROKE. spawnInTile's tryPlace only asked WorldGen.isSpawnCell (the
// shared spawn rule, which checks opts.roadMask FIRST, before its
// residential-frontage logic) when the candidate cell's TERRAIN was
// RESIDENTIAL. isSpawnCell returns true immediately after the walkable +
// roadMask checks for any OTHER terrain (worldgen.js: `if (here !==
// T.RESIDENTIAL) return true;`), so gating the call on `t === 5` made the
// mask unreachable for grass / park / farmland / etc — exactly the terrain a
// road's overlay band actually paints over (a motorway's band covers a cell
// either side of the cells it paints; a parking lot's aisles paint no road
// cell at all). A cow or crow could spawn on ground the player sees as
// asphalt.
//
// FINDING 3(b) — the same tryPlace closure (and spawnCaveCreatures) checked
// `this.save.caught.includes(id)`, an O(save.caught length) scan, on every
// spawn ATTEMPT — hundreds of times per tile build. util.js's setOf() exists
// for exactly this (see its doc comment); app.js already uses it in six
// places, just not these four.
//
// FINDING 3(a) — pest crows mint a fresh globally-unique id every ~90s spawn
// and nothing ever pruned save.caught of them, so a long session with crops
// planted grew the array forever.
//
// None of spawnInTile / spawnCaveCreatures / the prune block can load
// headlessly (methods on the Phaser scene class) — run.js lifts the exact
// pieces each finding touches and this file drives them for real via
// `new Function(...).call(stub, …)`, same technique spawn_rebuild.test.js
// uses on the spawn gate.
(function () {

// ── FINDING 2 / 3(b): the tryPlace closure ─────────────────────────────────
// TRY_PLACE_SRC is the closure's BODY only (run.js sliced between the
// `const tryPlace = (...) => {` head and the closing `};`), so re-wrap it as
// an arrow function (to keep the original's `this` semantics) inside a host
// function that supplies the variables tryPlace closes over.
function makeTryPlace(scene, rng, N, pestFree, entry, _spawnOpts, tx, ty, caughtSet, creatures) {
  const factory = new Function(
    'rng', 'N', 'pestFree', 'entry', '_spawnOpts', 'tx', 'ty', 'caughtSet', 'creatures',
    'return (kindWant, classesOK, idx, kindStr) => {\n' + TRY_PLACE_SRC + '\n};');
  return factory.call(scene, rng, N, pestFree, entry, _spawnOpts, tx, ty, caughtSet, creatures);
}

const GRASS = 0, RESIDENTIAL = 5, ROAD = 7;

test('fauna spawn (FINDING 2): a GRASS cell under the road mask is refused, not just RESIDENTIAL', () => {
  const N = 2;
  const entry = { grid: [GRASS, GRASS, GRASS, GRASS] };
  const roadMask = [1, 0, 0, 0];   // cell (0,0) is under the drawn road band
  const _spawnOpts = { roadMask, pois: [] };
  const creatures = [];
  const rng = () => 0;             // always rolls cx=cy=0 -- the masked cell
  const scene = { tileEdgeM: 100, cellM: 1 };
  const tryPlace = makeTryPlace(scene, rng, N, null, entry, _spawnOpts, 0, 0, new Set(), creatures);
  tryPlace('cow', new Set([GRASS]), 0, 'cow');
  assert.eq(creatures.length, 0,
    'a cow spawned on a grass cell the road mask covers -- isSpawnCell (and its roadMask check) ' +
    'was only reachable for RESIDENTIAL terrain before the fix');
});

test('fauna spawn: the SAME grass cell spawns fine once off the road mask (no new over-restriction)', () => {
  const N = 2;
  const entry = { grid: [GRASS, GRASS, GRASS, GRASS] };
  const _spawnOpts = { roadMask: [0, 0, 0, 0], pois: [] };
  const creatures = [];
  const rng = () => 0;
  const scene = { tileEdgeM: 100, cellM: 1 };
  const tryPlace = makeTryPlace(scene, rng, N, null, entry, _spawnOpts, 0, 0, new Set(), creatures);
  tryPlace('cow', new Set([GRASS]), 0, 'cow');
  assert.eq(creatures.length, 1,
    'routing every cell through isSpawnCell must not refuse an ordinary open grass cell -- ' +
    'isSpawnCell returns true right after the walkable+roadMask checks for non-RESIDENTIAL terrain');
});

test('fauna spawn: RESIDENTIAL frontage rule is still enforced (unchanged by the fix)', () => {
  const N = 3;
  const entry = { grid: new Array(9).fill(RESIDENTIAL) };   // an all-yard block, no public anchor anywhere
  const _spawnOpts = { roadMask: null, pois: [] };
  const creatures = [];
  const rng = () => 0.5;   // -> cx=cy=1, the centre cell
  const scene = { tileEdgeM: 100, cellM: 1 };
  const tryPlace = makeTryPlace(scene, rng, N, null, entry, _spawnOpts, 0, 0, new Set(), creatures);
  tryPlace('chicken', new Set([RESIDENTIAL]), 0, 'chicken');
  assert.eq(creatures.length, 0, 'a private yard with no public anchor within frontage spawned anyway');
});

test('fauna spawn: RESIDENTIAL cell WITH a nearby public anchor still spawns', () => {
  const N = 3;
  const grid = new Array(9).fill(RESIDENTIAL);
  grid[0] = ROAD;   // (cx=0,cy=0) -- within the default 3-cell frontage of the centre cell
  const entry = { grid };
  const _spawnOpts = { roadMask: null, pois: [] };
  const creatures = [];
  const rng = () => 0.5;
  const scene = { tileEdgeM: 100, cellM: 1 };
  const tryPlace = makeTryPlace(scene, rng, N, null, entry, _spawnOpts, 0, 0, new Set(), creatures);
  tryPlace('chicken', new Set([RESIDENTIAL]), 0, 'chicken');
  assert.eq(creatures.length, 1, 'a residential cell with a road just down the street was refused');
});

test('fauna spawn (FINDING 3b): tryPlace consults the memoised Set, never Array.prototype.includes', () => {
  const N = 2;
  const entry = { grid: [GRASS, GRASS, GRASS, GRASS] };
  const _spawnOpts = { roadMask: null, pois: [] };
  const caughtArr = ['cow_0_0_0'];   // the id tryPlace is about to mint, already marked caught
  const caughtSet = setOf(caughtArr);
  const creatures = [];
  const rng = () => 0;
  // this.save.caught is wired to the SAME array setOf() built the Set from,
  // with an own-property spy shadowing .includes (own properties win over
  // the inherited Array.prototype method, so this counts a call regardless
  // of which realm's Array.prototype the array happens to chain to — a
  // prototype-level monkeypatch does NOT reliably cross the vm-context
  // realm boundary this test harness runs inside, which is exactly the trap
  // that made an earlier version of this test pass vacuously).
  let includesCalls = 0;
  caughtArr.includes = function (...args) {
    includesCalls++;
    return Array.prototype.includes.apply(this, args);
  };
  const scene = { tileEdgeM: 100, cellM: 1, save: { caught: caughtArr } };
  const tryPlace = makeTryPlace(scene, rng, N, null, entry, _spawnOpts, 0, 0, caughtSet, creatures);
  tryPlace('cow', new Set([GRASS]), 0, 'cow');
  assert.eq(creatures.length, 0, 'sanity: the already-caught id spawned again');
  assert.eq(includesCalls, 0,
    'tryPlace called save.caught.includes(id) -- FINDING 3(b): it should read the memoised ' +
    'setOf() Set instead of rescanning save.caught (O(save lifetime) per spawn attempt)');
});

test('fauna spawn source: tryPlace no longer calls save.caught.includes directly', () => {
  assert.falsy(/\.caught\.includes/.test(TRY_PLACE_SRC),
    'tryPlace source still calls save.caught.includes -- regressed back off the Set');
});

// ── FINDING 3(b), cave half: spawnCaveCreatures ────────────────────────────
// Small and self-contained enough (this.save.caught / this.tileEdgeM /
// WorldGen / MONSTERS / entry.*) to run the WHOLE lifted method rather than
// a slice of it — SPAWN_CAVE_SRC was already lifted for the rebuild-contract
// tests (spawn_rebuild.test.js) and read fresh from app.js each run, so it
// can't drift from tryPlace's fix above.
//   SPAWN_CAVE_SRC is sliced up to (and including) the method's own closing
// "}" — fine for the regex-only checks spawn_rebuild.test.js runs on it, but
// `new Function` already wraps its body in braces, so that trailing "}"
// needs stripping before it's runnable as one.
const SPAWN_CAVE_BODY = SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, '');

test('cave spawn (FINDING 3b): spawnCaveCreatures consults the memoised Set, not save.caught.includes', () => {
  const N = 200;
  const CAVE_FLOOR = 24;
  const entry = {
    cellsPerEdge: N,
    tileEdgeM: 1000,
    grid: new Array(N * N).fill(CAVE_FLOOR),   // every cell walkable -- no terrain rejections to dodge
    objects: [],                               // no staircases -> falls back to the tile centre anchor
  };
  // Own-property spy on .includes, not a prototype patch — see the comment
  // on the tryPlace version of this test for why a prototype patch doesn't
  // reliably cross this harness's vm-context realm boundary.
  const caughtArr = [];
  let includesCalls = 0;
  caughtArr.includes = function (...args) {
    includesCalls++;
    return Array.prototype.includes.apply(this, args);
  };
  const scene = { tileEdgeM: 1000, save: { caught: caughtArr } };
  new Function('entry', 'tx', 'ty', 'depth', SPAWN_CAVE_BODY).call(scene, entry, 0, 0, 1);
  assert.truthy(entry.creatures && entry.creatures.length > 0,
    'sanity: spawnCaveCreatures placed nothing at all -- the harness is broken, not the fix');
  assert.eq(includesCalls, 0,
    'spawnCaveCreatures called save.caught.includes(id) -- FINDING 3(b): the monster/rabbit ' +
    'placement loops should read the memoised setOf() Set instead');
});

test('cave spawn source: spawnCaveCreatures no longer calls save.caught.includes directly', () => {
  assert.falsy(/\.caught\.includes/.test(SPAWN_CAVE_SRC),
    'spawnCaveCreatures source still calls save.caught.includes -- regressed back off the Set');
});

// ── FINDING 3(a): the save.caught pest-crow prune ──────────────────────────
function runPrune(self, now) {
  return new Function('now', CAUGHT_PRUNE_SRC).call(self, now);
}

test('save.caught prune (FINDING 3a): a pest-crow marker for an EVICTED tile is dropped', () => {
  WorldGen.setDepth(0);
  WorldGen.tileCache.delete(WorldGen.tileKey(777, 888));   // make sure it really is absent
  const self = {
    depth: 0,
    save: { caught: ['pest_crow_777_888_1000_42', 'crow_777_888_3'] },
    _lastCaughtPruneT: 0,
  };
  runPrune(self, 200000);
  assert.falsy(self.save.caught.includes('pest_crow_777_888_1000_42'),
    'a pest-crow marker for a tile no longer in WorldGen.tileCache was kept -- pure dead weight ' +
    'forever, since that id is never minted again');
  assert.truthy(self.save.caught.includes('crow_777_888_3'),
    'a DETERMINISTIC id (crow_tx_ty_i) got pruned too -- that would let the tile\'s next visit ' +
    're-seed the same rng and spawn the "dead" crow right back');
});

test('save.caught prune: a pest-crow marker for a STILL-CACHED tile is kept', () => {
  WorldGen.setDepth(0);
  const key = WorldGen.tileKey(555, 666);
  WorldGen.tileCache.set(key, { grid: [] });
  try {
    const self = { depth: 0, save: { caught: ['pest_crow_555_666_1000_1'] }, _lastCaughtPruneT: 0 };
    runPrune(self, 200000);
    assert.truthy(self.save.caught.includes('pest_crow_555_666_1000_1'),
      'a pest crow whose tile is STILL loaded was pruned -- the (still-live) creature object it ' +
      'names would read as un-caught again and reappear');
  } finally {
    WorldGen.tileCache.delete(key);
  }
});

test('save.caught prune: throttled to its own timer, not run on every call', () => {
  WorldGen.setDepth(0);
  WorldGen.tileCache.delete(WorldGen.tileKey(777, 888));
  const self = { depth: 0, save: { caught: ['pest_crow_777_888_1000_42'] }, _lastCaughtPruneT: 1000 };
  runPrune(self, 1000 + 200);   // 200ms later -- nowhere near the 90s throttle
  assert.truthy(self.save.caught.includes('pest_crow_777_888_1000_42'),
    'the prune ran before its own 90s throttle elapsed');
});

test('save.caught prune: skipped underground (WorldGen.tileCache is repointed to the cave map there)', () => {
  WorldGen.setDepth(0);
  WorldGen.tileCache.delete(WorldGen.tileKey(777, 888));
  const self = { depth: 2, save: { caught: ['pest_crow_777_888_1000_42'] }, _lastCaughtPruneT: 0 };
  runPrune(self, 200000);
  assert.truthy(self.save.caught.includes('pest_crow_777_888_1000_42'),
    'pruned a surface pest-crow marker while at depth !== 0 -- WorldGen.tileCache is a different ' +
    'map underground, so an absent key there proves nothing about the surface tile');
});

})();
