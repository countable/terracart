(function () {
  function entry() { return { status: 'ready', _spawned: true, cellsPerEdge: 8, tileEdgeM: 64,
    grid: new Uint8Array(64).fill(WorldGen.T.CAVE_FLOOR), spawnWhy: new Uint32Array(64),
    objects: [], wildplants: [], creatures: [], traps: [], laidTraps: [] }; }
  function deferred() { let resolve, reject; const promise = new Promise((ok, bad) => { resolve = ok; reject = bad; }); return { promise, resolve, reject }; }
  async function fixture(run, depth = 0) {
    const oldWorld = globalThis.WorldGen, oldOverlap = EnvironmentHazards.overlaps;
    const ready = entry(), cache = new Map(), calls = [], transitions = [];
    const world = { ...oldWorld, loadTile: { atDepth: async (...args) => { calls.push(args); return ready; } },
      tileCacheFor: () => cache, setDepth(d) { transitions.push(d); } };
    globalThis.WorldGen = world; EnvironmentHazards.overlaps = s => s.touching;
    const scene = { depth, tileEdgeM: 64, feetOffsetM: 0, startWorldM: { x: 0, y: 0 }, playerM: { x: 28, y: 28 },
      touching: true, save: { depth, energy: 50, dungeonProgression: {} }, flashed: [], persisted: 0,
      flashAtPlayer(s) { this.flashed.push(s); }, flash() {}, syncMoveTarget() {},
      cameras: { main: { setBackgroundColor() {} } }, ensureTilesAround: async () => {},
      _storySplashOnce() {}, spawnCaveCreatures(e) { e._spawned = true; } };
    const start = SCENE_SRC.indexOf('\n  changeDepth('), end = SCENE_SRC.indexOf('\n  }', start) + 4;
    scene.changeDepth = new Function('DungeonProgression', 'Arena', 'WorldGen', 'persistSave',
      `return ({${SCENE_SRC.slice(start, end)}}).changeDepth;`)(DungeonProgression, Arena, world, () => { scene.persisted++; });
    const hole = { depth, phase: 'open', x: 28, y: 28, cellIX: 3, cellIY: 3, widthCells: 2, heightCells: 2 };
    try { await run({ scene, hole, ready, world, calls, transitions, cache }); }
    finally { globalThis.WorldGen = oldWorld; EnvironmentHazards.overlaps = oldOverlap; }
  }
  for (const depth of [0, 1, 3]) test(`hazard falls: actual transition ${depth}→${depth + 1} preserves energy and bypasses voluntary locks`, () => fixture(async f => {
    const { scene, hole, calls, transitions } = f;
    if (depth === 1 || depth === 3) assert.falsy(DungeonProgression.canUseDescent(scene.save, depth, depth + 1, 'stairs'));
    assert.eq(await HazardFalls.fall(scene, hole), true);
    assert.eq(scene.depth, depth + 1); assert.eq(scene.save.depth, depth + 1); assert.eq(scene.save.energy, 50);
    assert.eq(scene.playerM.x, 28); assert.eq(scene.playerM.y, 28);
    assert.eq(calls.length, 1); assert.eq(calls[0][0], depth + 1); assert.eq(transitions[0], depth + 1);
    assert.eq(scene.persisted, 1); assert.eq(scene._hazardFallPending, false);
  }, depth));
  test('hazard falls: loading entries await their promise and block duplicate descents', () => fixture(async f => {
    const gate = deferred(); f.world.loadTile.atDepth = async () => ({ status: 'loading', promise: gate.promise });
    const pending = HazardFalls.fall(f.scene, f.hole);
    assert.eq(f.scene._hazardFallPending, true); assert.eq(await HazardFalls.fall(f.scene, f.hole), false);
    await Promise.resolve(); assert.eq(f.scene.depth, 0); assert.eq(f.scene.persisted, 0);
    f.cache.set(f.world.tileKey(0, 0), f.ready); gate.resolve();
    assert.eq(await pending, true); assert.eq(f.transitions.length, 1); assert.eq(f.scene._hazardFallPending, false);
  }));
  for (const change of ['walked away', 'pit closed', 'changed floor', 'downed']) test(`hazard falls: ${change} during loading cancels stale fall`, () => fixture(async f => {
    const gate = deferred(); f.world.loadTile.atDepth = () => gate.promise;
    const pending = HazardFalls.fall(f.scene, f.hole);
    if (change === 'walked away') f.scene.touching = false;
    if (change === 'pit closed') f.hole.phase = 'closed';
    if (change === 'changed floor') f.scene.depth = f.scene.save.depth = 2;
    if (change === 'downed') f.scene.save.energy = 0;
    const before = JSON.stringify(f.scene.save); gate.resolve(f.ready);
    assert.eq(await pending, false); assert.eq(JSON.stringify(f.scene.save), before);
    assert.eq(f.transitions.length, 0); assert.eq(f.scene.persisted, 0); assert.eq(f.scene._hazardFallPending, false);
  }));
  for (const failure of ['request', 'entry promise']) test(`hazard falls: ${failure} failure leaves current floor intact and releases retry lock`, () => fixture(async f => {
    const before = JSON.stringify(f.scene.save);
    if (failure === 'request') f.world.loadTile.atDepth = async () => { throw Error('offline'); };
    else f.world.loadTile.atDepth = async () => ({ status: 'loading', promise: Promise.reject(Error('tile failed')) });
    assert.eq(await HazardFalls.fall(f.scene, f.hole), false);
    assert.eq(f.scene.depth, 0); assert.eq(JSON.stringify(f.scene.save), before);
    assert.eq(f.transitions.length, 0); assert.eq(f.scene.persisted, 0); assert.eq(f.scene._hazardFallPending, false);
    f.world.loadTile.atDepth = async () => f.ready;
    assert.eq(await HazardFalls.fall(f.scene, f.hole), true, 'successful retry after failure');
  }));
  test('hazard falls: no safe floor never falls back to blocked hole coordinates', () => fixture(async f => {
    f.ready.grid.fill(WorldGen.T.CAVE_LAVA);
    assert.eq(await HazardFalls.fall(f.scene, f.hole), false);
    assert.eq(f.scene.depth, 0); assert.eq(f.scene.save.depth, 0); assert.eq(f.scene.save.energy, 50);
    assert.eq(f.transitions.length, 0); assert.eq(f.scene.persisted, 0); assert.eq(f.scene._hazardFallPending, false);
  }));
  test('hazard falls: cold destination spawns traps before choosing its safe landing', () => fixture(async f => {
    f.ready._spawned = false; let spawns = 0;
    f.scene.spawnCaveCreatures = (e, tx, ty, depth) => {
      assert.eq(depth, 1); assert.eq(f.scene.depth, 0, 'destination prep never swaps active floor');
      spawns++; e.traps.push({ x: 28, y: 28 }); e._spawned = true;
    };
    assert.eq(await HazardFalls.fall(f.scene, f.hole), true); assert.eq(spawns, 1);
    assert.truthy(f.scene.playerM.x !== 28 || f.scene.playerM.y !== 28, 'fresh trap cell excluded');
    assert.eq(f.scene.save.energy, 50);
  }));
  for (const depth of [99, 100]) test(`hazard falls: reserved arena boundary refuses depth ${depth}`, () => fixture(async f => {
    assert.eq(await HazardFalls.fall(f.scene, f.hole), false);
    assert.eq(f.calls.length, 0); assert.eq(f.scene.depth, depth); assert.eq(f.scene.persisted, 0);
    assert.falsy(DungeonProgression.canUseDescent(f.scene.save, depth, depth + 1, 'sinkhole'));
  }, depth));
  test('hazard falls: refused central transition reports failure without a success message', () => fixture(async f => {
    f.scene.changeDepth = () => false;
    assert.eq(await HazardFalls.fall(f.scene, f.hole), false);
    assert.eq(f.scene.depth, 0); assert.eq(f.scene.flashed.length, 0); assert.eq(f.scene._hazardFallPending, false);
  }));
  test('hazard falls: landing rejects lava, walls, spawn exclusions and every occupied category', () => {
    const e = entry(), point = { x: 28, y: 28 }, center = 3 * 8 + 3;
    for (const kind of ['objects', 'wildplants', 'creatures', 'traps', 'laidTraps']) {
      e[kind].push({ x: 28, y: 28 }); const found = HazardFalls.landing(e, point, 64);
      assert.truthy(found); assert.truthy(found.x !== 28 || found.y !== 28, kind); e[kind] = [];
    }
    for (const terrain of [WorldGen.T.CAVE_LAVA, WorldGen.T.CAVE_WALL]) {
      e.grid[center] = terrain; const found = HazardFalls.landing(e, point, 64);
      assert.truthy(found.x !== 28 || found.y !== 28, 'non-floor rejected');
    }
    e.grid.fill(WorldGen.T.CAVE_FLOOR); e.spawnWhy.fill(1);
    assert.eq(HazardFalls.landing(e, point, 64), null);
    e.spawnWhy[center] = 0; assert.eq(JSON.stringify(HazardFalls.landing(e, point, 64)), JSON.stringify(point));
  });
  test('hazard falls: landing uses destination row grid and world tile offset, never nominal cell size', () => {
    const e = entry(); e.cellsPerEdge = 4; e.grid = new Uint8Array(16).fill(WorldGen.T.CAVE_WALL); e.spawnWhy = new Uint32Array(16);
    e.grid[1 * 4 + 2] = WorldGen.T.CAVE_FLOOR;
    const found = HazardFalls.landing(e, { x: 100, y: 86 }, 999);
    assert.eq(found.x, 104); assert.eq(found.y, 88);
  });
})();
