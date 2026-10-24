// Run the shipped final cave pass, retaining safety and occupancy precedence.
(() => {
  const row = WorldGen.CAVE_PASSES.find(r => r.id === 'grass');
  const N = 64, edge = N * 7;
  function run(depth = 5, blocked = false) {
    const grid = new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR);
    const spawnWhy = new Uint16Array(N * N), occupied = new Set();
    for (let i = 0; i < N * N; i++) {
      if (i % N < 4) grid[i] = WorldGen.T.CAVE_WALL;
      if (i % N >= 4 && i % N < 8) occupied.add(i);
      if (blocked && i % N >= 32) spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
    }
    const level = WorldGen.cavePassLevel(grid, N, -3, 8, edge, depth, occupied, { spawnWhy });
    WorldGen.runCavePass(row, level);
    return level;
  }
  test('Underdark grass: floor profile enables stable grass stands on eligible empty floor only', () => {
    const before = run(), after = run(5, true), plants = after.wildplants;
    assert.gt(plants.length, 100);
    assert.eq(JSON.stringify(plants), JSON.stringify(run(5, true).wildplants));
    const byId = new Map(before.wildplants.map(p => [p.id, p]));
    const ids = new Set();
    for (const plant of plants) {
      assert.eq(plant.crop, 'longgrass'); assert.eq(plant.depth, 5);
      assert.truthy(WorldGen.isGrassCover(plant));
      assert.truthy(plant.id.startsWith('cgrass_5_'));
      assert.inRange(plant._ix, 8, 31);
      assert.eq(after.grid[plant._iy * N + plant._ix], WorldGen.T.CAVE_FLOOR);
      assert.eq(JSON.stringify(plant), JSON.stringify(byId.get(plant.id)), 'safety does not move surviving grass');
      assert.falsy(ids.has(plant.id)); ids.add(plant.id);
    }
    assert.eq(row, WorldGen.CAVE_PASSES[WorldGen.CAVE_PASSES.length - 1], 'all existing floor content gets first claim');
  });
  test('Underdark grass: other floors retain their existing flora', () => {
    for (const depth of [1, 2, 3, 4, 6, 7, 8, 9]) assert.eq(run(depth).wildplants.length, 0);
  });
})();
