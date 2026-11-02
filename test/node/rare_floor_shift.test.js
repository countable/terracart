(function () {
  function fixture({ down = false, energy = 50 } = {}) {
    const entry = { status: 'ready', _spawned: true, cellsPerEdge: 8, tileEdgeM: 64,
      grid: new Uint8Array(64).fill(WorldGen.T.CAVE_FLOOR), spawnWhy: new Uint32Array(64),
      objects: [], wildplants: [], creatures: [], traps: [], laidTraps: [] };
    const calls = [], transitions = [];
    const world = { ...WorldGen, loadTile: { atDepth: async (...args) => { calls.push(args); return entry; } },
      setDepth: depth => transitions.push(depth) };
    const scene = { depth: 2, cellM: 8, tileEdgeM: 64, feetOffsetM: 0,
      startWorldM: { x: 0, y: 0 }, playerM: { x: 28, y: 28 },
      save: { depth: 2, energy, dungeonProgression: {} },
      flashAtPlayer() {}, flash() {}, syncMoveTarget() {}, _clearMarkers() {},
      cameras: { main: { setBackgroundColor() {} } }, ensureTilesAround: async () => {},
      _storySplashOnce() {}, spawnCaveCreatures(e) { e._spawned = true; } };
    const body = SCENE_SRC.match(/\n  async _rareFloorShift\(source, row\) \{([\s\S]*?)\n  \}\n/)[1];
    scene._rareFloorShift = new Function('WorldGen', 'HazardFalls', 'DungeonProgression', 'Arena', 'Combat', 'playerWorldM', 'fnv1a',
      `return async function(source, row) {${body}};`)(world, HazardFalls, DungeonProgression, Arena, Combat, playerWorldM,
        seed => seed.endsWith(':direction') ? Number(down) : 0);
    const start = SCENE_SRC.indexOf('\n  changeDepth('), end = SCENE_SRC.indexOf('\n  }', start) + 4;
    scene.changeDepth = new Function('DungeonProgression', 'Arena', 'WorldGen', 'persistSave',
      `return ({${SCENE_SRC.slice(start, end)}}).changeDepth;`)(DungeonProgression, Arena, world, () => {});
    const source = { id: 'test-portacular' }, row = { rareBehaviour: { floorShiftChance: .25 } };
    return { scene, entry, world, calls, transitions, shift: () => scene._rareFloorShift(source, row) };
  }
  test('Portacular: ascends through the real floor transition after resolving safe occupancy', async () => {
    const f = fixture();
    f.entry.creatures.push({ x: 28, y: 28 });
    assert.truthy(await f.shift());
    assert.eq(f.scene.depth, 1); assert.eq(f.scene.save.depth, 1);
    assert.eq(f.scene.save.energy, 50); assert.eq(f.calls[0][0], 1);
    assert.truthy(f.scene.playerM.x !== 28 || f.scene.playerM.y !== 28, 'never lands inside the occupant');
    assert.eq(f.transitions.length, 1); assert.eq(f.scene._rareFloorShiftPending, null);
  });
  test('Portacular: a locked downward route cannot load or bypass the elevator seal', async () => {
    const f = fixture({ down: true });
    assert.falsy(await f.shift());
    assert.eq(f.scene.depth, 2); assert.eq(f.calls.length, 0);
    f.scene.save.elevators = { repaired: true, partsFound: true };
    assert.truthy(await f.shift());
    assert.eq(f.scene.depth, 3); assert.eq(f.calls[0][0], 3);
  });
  for (const ground of ['CAVE_WALL', 'WATER']) test(`Portacular: no landing in ${ground} leaves the current floor intact`, async () => {
    const f = fixture(); f.entry.grid.fill(WorldGen.T[ground]);
    assert.falsy(await f.shift());
    assert.eq(f.scene.depth, 2); assert.eq(f.transitions.length, 0);
    assert.eq(f.scene._rareFloorShiftPending, null);
  });
  test('Portacular: loading failure leaves floor and energy intact and releases the request', async () => {
    const f = fixture(); f.world.loadTile.atDepth = async () => { throw Error('offline'); };
    assert.falsy(await f.shift());
    assert.eq(f.scene.depth, 2); assert.eq(f.scene.save.energy, 50);
    assert.eq(f.scene._rareFloorShiftPending, null);
  });
  test('Portacular: an in-flight request cannot teleport a player who moved or changed floor', async () => {
    for (const changed of ['position', 'floor', 'defeat']) {
      const f = fixture(); let resolve;
      f.world.loadTile.atDepth = () => new Promise(done => { resolve = done; });
      const pending = f.shift();
      assert.falsy(await f.shift(), 'only one pending shift');
      if (changed === 'position') f.scene.playerM.x += 8;
      if (changed === 'floor') f.scene.depth = 4;
      if (changed === 'defeat') f.scene.save.energy = 0;
      resolve(f.entry);
      assert.falsy(await pending); assert.eq(f.transitions.length, 0);
      assert.eq(f.scene._rareFloorShiftPending, null);
    }
  });
  test('Portacular: destination spawns complete before the occupancy check', async () => {
    const f = fixture(); f.entry._spawned = false;
    f.scene._spawnCaveCreaturesSliced = async (entry, tx, ty, depth) => {
      assert.eq(depth, 1); entry.grid.fill(WorldGen.T.CAVE_WALL); return true;
    };
    assert.falsy(await f.shift()); assert.eq(f.transitions.length, 0);
  });
})();
