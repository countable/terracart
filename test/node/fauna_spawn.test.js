// Surface habitat placement regressions live in habitat_spawns.test.js.
// Keep cave placement and the saved transient-pest ledger checks here.
(function () {

// ── FINDING 3(b), cave half: spawnCaveCreatures ────────────────────────────
// Small and self-contained enough (this.save.caught / this.tileEdgeM /
// WorldGen / MONSTERS / entry.*) to run the WHOLE lifted method rather than
// a slice of it — SPAWN_CAVE_SRC was already lifted for the rebuild-contract
// tests (spawn_rebuild.test.js) and read fresh from app.js each run, so it
// executes the shipped cave placement method.
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

test('cave spawn shares mushroom and floor-torch occupancy with creatures and laid traps', () => {
  const N = 200, EDGE = 1000, CAVE_FLOOR = 24;
  const run = (wildplants = [], genWildplants = wildplants) => {
    const grid = new Array(N * N).fill(CAVE_FLOOR);
    const entry = {
      cellsPerEdge: N, tileEdgeM: EDGE,
      grid, baseGrid: grid.slice(), objects: [], genObjects: [], wildplants, genWildplants,
    };
    new Function('entry', 'tx', 'ty', 'depth', SPAWN_CAVE_BODY)
      .call({ tileEdgeM: EDGE, save: { caught: [] } }, entry, 0, 0, 1);
    return entry;
  };
  const baseline = run();
  const cells = [];
  for (const c of baseline.creatures.filter(Combat.isEnemy)) {
    const ix = Math.floor(c.x / (EDGE / N)), iy = Math.floor(c.y / (EDGE / N));
    const idx = iy * N + ix;
    if (!cells.some(cell => cell.idx === idx)) cells.push({ ix, iy, idx, x: c.x, y: c.y });
    if (cells.length === 2) break;
  }
  assert.eq(cells.length, 2, 'the control produced two distinct cave creature seats');

  const generatedFlora = [
    WorldGen.makeWildplant('mushroom', cells[0].x, cells[0].y, 'mushroom_test'),
    WorldGen.makeWildplant('torch', cells[1].x, cells[1].y, 'floor_torch_test'),
  ];
  // A player's synthetic stair may filter the live wildplant list. The
  // generated snapshot still owns the deterministic spawn draw.
  const blocked = run([], generatedFlora);
  assert.truthy(/genWildplants: wildplants\.slice\(\)/.test(WORLDGEN_SRC),
    'loadCaveTile preserves the generated flora snapshot');
  assert.truthy(blocked._spawnOpts, 'the cave publishes its shared spawn options');
  for (const cell of cells) {
    assert.truthy(blocked._spawnOpts.occupied.has(cell.idx), 'the wildplant cell is occupied');
    assert.falsy(blocked.creatures.some(c =>
      Math.floor(c.x / (EDGE / N)) === cell.ix && Math.floor(c.y / (EDGE / N)) === cell.iy),
    'a cave creature refuses the wildplant cell');
    assert.falsy(Traps.canLay(blocked, cell.ix, cell.iy),
      'a goblin trapper refuses the same wildplant cell');
  }
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
