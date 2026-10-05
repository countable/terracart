(() => {
  const W = WorldGen, T = W.T, WHY = W.SPAWN_WHY;
  const spawn = new Function('entry', 'tx', 'ty', 'depth', SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, ''));

  test('floor exclusions: immutable mapped farmland and golf survive overlays without importing roads', () => {
    const source = { grid: Uint8Array.from([T.FARMLAND, T.GOLF, T.PARK, T.ROAD]),
      spawnWhy: Uint16Array.from([0, 0, WHY.GOLF | WHY.PRIVATE, WHY.ROAD | WHY.TERRAIN]) };
    const surface = { grid: new Uint8Array(4).fill(T.PARK), caveSource: source };
    const why = W.floorSpawnWhy(surface);
    assert.eq([...why].join(','), [WHY.FARMLAND, WHY.GOLF, WHY.GOLF, 0].join(','));
    for (const cls of W.SPAWN_CLASSES) for (let x = 0; x < 3; x++) {
      assert.falsy(W.isSpawnCell(new Uint8Array(4).fill(T.CAVE_FLOOR), 4, 1, x, 0,
        { spawnWhy: why, pois: [{ ix: x, iy: 0 }] }, cls), cls + ' cannot reopen an excluded floor');
    }
    why[0] = 0;
    assert.eq(source.grid[0], T.FARMLAND, 'surface evidence stays immutable');
  });

  test('floor exclusions: every generated cave depth keeps resources, stairs and fauna off excluded land', async () => {
    const N = 48, edge = N * W.CELL_M, tx = 931501, ty = 931502, key = W.tileKey(tx, ty);
    const grid = new Uint8Array(N * N).fill(T.PARK), why = new Uint16Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++)
      why[y * N + x] = y < N / 2 ? WHY.FARMLAND : WHY.GOLF;
    const at = (x, y) => ({ x: (tx * N + x + .5) * W.CELL_M, y: (ty * N + y + .5) * W.CELL_M });
    const objects = [
      { kind: 'staircase', dir: 'down', id: 'open_stair', ...at(36, 24) },
      { kind: 'staircase', dir: 'down', id: 'excluded_stair', ...at(8, 8) },
      { kind: 'chest', poiClass: 'park', id: 'excluded_chest', tier: 3, ...at(8, 10) },
    ];
    W.setDepth(0).set(key, { status: 'ready', grid, baseGrid: grid.slice(), spawnWhy: why,
      cellsPerEdge: N, tileEdgeM: edge, objects, genObjects: objects, wildplants: [] });
    const index = o => Math.floor((o.y - ty * edge) / W.CELL_M) * N + Math.floor((o.x - tx * edge) / W.CELL_M);
    const oldTest = window.__TEST_MODE;
    window.__TEST_MODE = false;
    try {
      for (let depth = 1; depth <= 10; depth++) {
        const entry = await W.loadTile.atDepth(depth, tx, ty, 49);
        spawn.call({ tileEdgeM: edge, save: { caught: [] } }, entry, tx, ty, depth);
        assert.eq([...entry.spawnWhy].join(','), [...why].join(','), 'same exclusion footprint at depth ' + depth);
        const all = [...entry.objects, ...entry.wildplants, ...entry.extraTreasures, ...entry.caveCoinSeeds,
          ...entry.creatures, ...(entry.coinDrops || []), ...(entry.traps || []), ...(entry.undergroundResidents || [])];
        assert.gt(all.length, 0, 'public half still populates at depth ' + depth);
        for (const o of all) assert.falsy(why[index(o)], `${o.kind || o.crop || 'reward'} excluded at depth ${depth}`);
      }
    } finally {
      window.__TEST_MODE = oldTest;
      for (let depth = 0; depth <= 10; depth++) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });

  test('floor exclusions: fully excluded tiles cannot use the fallback stair or spawn rabbits and coins', async () => {
    const N = 24, edge = N * W.CELL_M, tx = 931511, ty = 931512, key = W.tileKey(tx, ty);
    const grid = new Uint8Array(N * N).fill(T.FARMLAND);
    W.setDepth(0).set(key, { status: 'ready', grid, baseGrid: grid.slice(), cellsPerEdge: N,
      tileEdgeM: edge, objects: [], wildplants: [] });
    try {
      for (const depth of [1, 2, 3]) {
        const entry = await W.loadTile.atDepth(depth, tx, ty, 49);
        spawn.call({ tileEdgeM: edge, save: { caught: [] } }, entry, tx, ty, depth);
        for (const name of ['objects', 'wildplants', 'extraTreasures', 'caveCoinSeeds', 'creatures', 'coinDrops', 'traps'])
          assert.eq((entry[name] || []).length, 0, name + ' stays empty at depth ' + depth);
      }
    } finally {
      for (const depth of [0, 1, 2, 3]) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });
})();
