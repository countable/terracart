// THE SEWER (floor 1): its route lanes are drawn as channel water
// (FloorWallMaterials.isSewerChannel, the profile's `channelWater`), so
// worldgen reserves them before any pass and nothing — barrel, rock, torch,
// coin, X, creature — is born in the water; its barrels heap up on a
// `barrels` profile row of their own; and its vermin are the sewer rats, the
// heaviest draw of the first floor's natural regions.
(() => {
  const W = WorldGen, T = W.T;
  const spawn = new Function('entry', 'tx', 'ty', 'depth', SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, ''));

  test('sewer: channel lanes are reserved, and nothing generated or spawned stands in the water', async () => {
    const N = 40, edge = N * W.CELL_M, tx = 931531, ty = 931532, key = W.tileKey(tx, ty);
    const grid = new Uint8Array(N * N).fill(T.PARK), spawnWhy = new Uint32Array(N * N), gameplayTiers = new Uint8Array(N * N).fill(1);
    // One footway across the middle and one down the tile: two projected
    // routes with a centre lane each.
    const layers = [{ name: 'transportation', extent: 4096, features: [
      { id: 7, type: 2, tags: { class: 'footway' }, geom: [[{ x: 100, y: 2048 }, { x: 4000, y: 2048 }]] },
      { id: 8, type: 2, tags: { class: 'path' }, geom: [[{ x: 1024, y: 100 }, { x: 1024, y: 4000 }]] }] }];
    W.setDepth(0).set(key, { status: 'ready', grid, baseGrid: grid.slice(), spawnWhy, gameplayTiers, layers,
      cellsPerEdge: N, tileEdgeM: edge, objects: [], genObjects: [], wildplants: [] });
    const index = o => Math.floor((o.y - ty * edge) / W.CELL_M) * N + Math.floor((o.x - tx * edge) / W.CELL_M);
    const oldTest = window.__TEST_MODE;
    window.__TEST_MODE = false;
    try {
      const entry = await W.loadTile.atDepth(1, tx, ty, 49);
      spawn.call({ tileEdgeM: edge, save: { caught: [] } }, entry, tx, ty, 1);
      assert.truthy(W.floorProfile(1).channelWater, 'the sewer row says its lanes are water');
      const lane = entry.underground.lane;
      assert.gt(lane.size, N, 'the fixture projects channel lanes');
      for (const i of lane) {
        assert.eq(entry.grid[i], T.CAVE_FLOOR, 'a channel is still walkable floor');
        assert.truthy(entry.undergroundReserved.has(i), 'every lane cell is reserved for the runtime draws too');
        assert.truthy(FloorWallMaterials.isSewerChannel(entry, i), 'and drawn as channel water');
      }
      const all = [...entry.objects, ...entry.wildplants, ...entry.extraTreasures, ...entry.caveCoinSeeds,
        ...entry.creatures, ...(entry.coinDrops || []), ...(entry.traps || [])];
      assert.gt(all.length, 40, 'the dry floor still populates');
      assert.gt(entry.creatures.length, 0, 'with monsters');
      for (const o of all) assert.falsy(lane.has(index(o)), `${o.kind || o.crop || 'reward'} ${o.id || ''} stands in the channel`);
      // Barrels: the sewer's own heap, all on dry floor.
      const barrels = entry.objects.filter(o => o.barrel);
      const budget = W.caveBarrelBudget(1);
      assert.gte(barrels.length, Math.floor(budget.min / 2), `the sewer heaps barrels (${barrels.length})`);
      // The natural cave beneath keeps its lanes as plain route floor.
      const below = await W.loadTile.atDepth(2, tx, ty, 49);
      assert.falsy(W.floorProfile(2).channelWater);
      for (const i of below.underground.lane) assert.falsy(FloorWallMaterials.isSewerChannel(below, i), 'no channel water on L2');
    } finally {
      window.__TEST_MODE = oldTest;
      for (let depth = 0; depth <= 2; depth++) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });

  test('sewer: rats are the first floor\'s heaviest natural draw, a two-level window, with sheet frames that exist', () => {
    const rat = EnemyRoster.get('rat');
    assert.truthy(rat && rat.tier === 1 && rat.surface === null, 'a cave-only tier-1 row');
    assert.includes(EnemyHabitats.FAMILIES.natural, 'rat');
    const l1 = EnemySpawns.caveRows(1);
    assert.truthy(l1.some(r => r.id === 'rat'), 'in the sewer');
    assert.truthy(EnemySpawns.caveRows(2).some(r => r.id === 'rat'), 'and the natural cave below');
    assert.falsy(EnemySpawns.caveRows(3).some(r => r.id === 'rat'), 'never the warrens');
    for (const row of l1) if (row.id !== 'rat') assert.gt(rat.cave.weight, row.cave.weight, `outweighs ${row.id}`);
    // The shared mini monsters sheet is 30 columns by 44 rows of 16px frames.
    const frames = Object.values(rat.art.directions).flatMap(d => [...d.idle, ...d.move]);
    assert.eq(new Set(frames).size, 12, 'four directions, three frames each');
    for (const f of frames) assert.inRange(f, 0, 30 * 44 - 1);
    const art = SpriteLayout.creatureArt('rat');
    assert.truthy(art.directions && art.directionSideFacing === 'right');
    assert.truthy(SpriteLayout.creatureWanders('rat'));
    assert.truthy(Combat.isEnemy({ kind: 'rat' }));
  });
})();
