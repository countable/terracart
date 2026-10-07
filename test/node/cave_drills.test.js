(function () {
  const N = 40, edge = N * WorldGen.CELL_M;
  const row = WorldGen.CAVE_PASSES.find(r => r.id === 'drills');
  function generate(depth = 1, tx = 3, sparse = false) {
    const grid = new Uint8Array(N * N).fill(sparse ? WorldGen.T.CAVE_WALL : WorldGen.T.CAVE_FLOOR);
    if (sparse) for (const i of [0, 1, 2]) grid[i] = WorldGen.T.CAVE_FLOOR;
    grid[5 * N + 5] = WorldGen.T.CAVE_WALL;
    const occupied = new Set([7 * N + 7]);
    const objects = [{ kind: 'staircase', x: tx * edge + 20.5 * WorldGen.CELL_M, y: 20.5 * WorldGen.CELL_M }];
    const level = WorldGen.cavePassLevel(grid, N, tx, 0, edge, depth, occupied, { objects });
    WorldGen.runCavePass(row, level);
    return { ...level, drills: objects.filter(o => o.shrineKind === 'drill') };
  }

  test('drill generation: ten distinct daily shrines on each cave depth, excluding occupied cells and stair approaches', () => {
    for (let depth = 1; depth <= 7; depth++) {
      const { drills, grid, occupied } = generate(depth);
      assert.eq(drills.length, 10);
      const cells = new Set();
      for (const drill of drills) {
        assert.eq(drill.kind, 'grove_shrine');
        assert.eq(drill.depth, depth);
        const match = new RegExp(`^cdrill_${depth}_3_0_(\\d+)_(\\d+)$`).exec(drill.id);
        assert.truthy(match, 'stable positional shrine id');
        const x = Number(match[1]), y = Number(match[2]), idx = y * N + x;
        assert.eq(grid[idx], WorldGen.T.CAVE_FLOOR);
        assert.falsy(idx === 7 * N + 7 || cells.has(idx));
        assert.falsy(Math.abs(x - 20) <= 1 && Math.abs(y - 20) <= 1, 'clear stairs and their approach');
        assert.truthy(occupied.has(idx), 'claims its cell for later placement');
        cells.add(idx);
      }
    }
  });

  test('drill generation: seeded per tile and depth, fills sparse available floor without retries', () => {
    const ids = (depth, tx) => generate(depth, tx).drills.map(o => o.id).join();
    assert.eq(ids(1, 3), ids(1, 3));
    const positions = (depth, tx) => generate(depth, tx).drills.map(o => o.id.split('_').slice(-2).join('_')).join();
    assert.falsy(positions(1, 3) === positions(2, 3), 'depth changes random placements');
    assert.falsy(positions(1, 3) === positions(1, 4), 'tile changes random placements');
    assert.eq(generate(1, 3, true).drills.length, 3, 'uses all available cells when fewer than ten exist');
    assert.eq(WorldGen.CAVE_PASSES[WorldGen.CAVE_PASSES.length - 1].id, 'drills', 'preserves earlier cave dressing');
  });
})();
