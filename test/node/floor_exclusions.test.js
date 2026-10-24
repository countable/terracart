(() => {
  const W = WorldGen, T = W.T, WHY = W.SPAWN_WHY;
  const spawn = new Function('entry', 'tx', 'ty', 'depth', SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, ''));

  test('floor exclusions: immutable field interiors and golf survive overlays including road and access safety', () => {
    const source = { grid: Uint8Array.from([T.FARMLAND, T.GOLF, T.PARK, T.ROAD, T.FARMLAND]),
      spawnWhy: Uint32Array.from([WHY.FARM_INTERIOR, 0, WHY.GOLF | WHY.PRIVATE, WHY.ROAD | WHY.TERRAIN, 0]),
      gameplayTiers: Uint8Array.from([4,4,4,2,1]) };
    const surface = { grid: new Uint8Array(5).fill(T.PARK), caveSource: source };
    const why = W.floorSpawnWhy(surface);
    assert.eq([...why].join(','), [WHY.FARM_INTERIOR, WHY.GOLF, WHY.GOLF | WHY.PRIVATE, WHY.ROAD, 0].join(','));
    for (const cls of W.SPAWN_CLASSES) for (let x = 0; x < 3; x++) {
      assert.falsy(W.isSpawnCell(new Uint8Array(5).fill(T.CAVE_FLOOR), 5, 1, x, 0,
        { spawnWhy: why, pois: [{ ix: x, iy: 0 }] }, cls), cls + ' cannot reopen an excluded floor');
    }
    assert.truthy(W.isSpawnCell(new Uint8Array(5).fill(T.CAVE_FLOOR), 5, 1, 4, 0,
      { spawnWhy: why }, 'minor'), 'farmland rim stays available underground');
    assert.truthy(W.isSpawnCell(new Uint8Array(5).fill(T.CAVE_FLOOR), 5, 1, 3, 0,
      { spawnWhy: why }, 'minor'), 'inherited Calm overrides stale street ROAD evidence');
    assert.eq([...W.gameplayTiersOf(null, { spawnWhy: why })].join(), '4,4,4,2,1', 'floor inherits source policy');
    assert.truthy(why !== source.spawnWhy, 'floor owns its diagnostic mask');
    why[0] = 0;
    assert.eq(source.grid[0], T.FARMLAND, 'surface evidence stays immutable');
  });

  test('floor exclusions: inherited tiers control every cave floor despite legacy diagnostic bits', async () => {
    const N = 24, tx = 931521, ty = 931522, key = W.tileKey(tx, ty), edge = N * W.CELL_M;
    const reasons = [WHY.RESTRICTED, WHY.QUIET, WHY.KINDERGARTEN, WHY.SENSITIVE_SITE,
      WHY.BEHIND_HOUSE, WHY.PRIVATE, WHY.FARMLAND, WHY.PIER_ACCESS, WHY.JUNCTION,
      WHY.KERB, WHY.SENSITIVE, WHY.JUNCTION_SOFT];
    const grid = new Uint8Array(N * N).fill(T.PARK), why = new Uint32Array(N * N);
    const roadClass = new Uint16Array(N * N), gameplayTiers = new Uint8Array(N * N).fill(1);
    gameplayTiers.set([4,4,4,4,4,4,4,4,3,3,2,1]);
    reasons.forEach((reason, i) => { why[i] = reason; });
    roadClass[9] = W.ROAD_CLASS_MAJOR_BUFFER;
    W.setDepth(0).set(key, { status: 'ready', grid, baseGrid: grid.slice(), spawnWhy: why,
      roadClass, gameplayTiers, cellsPerEdge: N, tileEdgeM: edge, objects: [], wildplants: [] });
    try {
      for (let depth = 1; depth <= 10; depth++) {
        const entry = await W.loadTile.atDepth(depth, tx, ty, 49);
        assert.eq([...entry.spawnWhy].join(), [...why].join(), 'all safety bits survive depth ' + depth);
        assert.eq([...entry.gameplayTiers].join(), [...gameplayTiers].join(), 'tier policy survives depth ' + depth);
        assert.eq(entry.roadClass[9], W.ROAD_CLASS_MAJOR_BUFFER);
        assert.truthy(entry.roadClass !== roadClass, 'floor owns its copy');
        const open = new Uint8Array(N * N).fill(T.CAVE_FLOOR);
        for (const cls of W.SPAWN_CLASSES) for (let i = 0; i < reasons.length; i++) {
          const permitted = GameplayTiers.allowed(gameplayTiers[i], cls);
          assert.eq(W.isSpawnCell(open, N, N, i, 0, { spawnWhy: entry.spawnWhy }, cls), permitted,
            cls + ' safety at depth ' + depth + ' reason ' + reasons[i]);
        }
        for (const o of [...entry.objects, ...entry.wildplants, ...entry.extraTreasures, ...entry.caveCoinSeeds]) {
          const i = Math.floor((o.y - ty * edge) / W.CELL_M) * N + Math.floor((o.x - tx * edge) / W.CELL_M);
          assert.truthy(gameplayTiers[i] !== 4, 'generated content avoids Excluded tier');
        }
      }
    } finally {
      for (let depth = 0; depth <= 10; depth++) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });

  test('floor exclusions: Passing blocks cave hazards while allowing static resources and rewards', () => {
    const N = 64, grid = new Uint8Array(N * N).fill(T.CAVE_FLOOR);
    const spawnWhy = new Uint32Array(N * N).fill(WHY.KERB);
    const gameplayTiers = new Uint8Array(N * N).fill(3);
    W.registerGameplayTiers(grid, spawnWhy, gameplayTiers);
    const level = W.cavePassLevel(grid, N, 123, 456, N * W.CELL_M, 1, new Set(), { spawnWhy, gameplayTiers });
    for (const id of ['chasms', 'coins', 'drills', 'rocks']) W.runCavePass(W.CAVE_PASSES.find(row => row.id === id), level);
    assert.falsy(level.objects.some(o => o.kind === 'ground_hole'), 'Passing blocks chasm hazards');
    assert.truthy(level.objects.some(o => o.shrineKind === 'drill'), 'static drill rewards remain eligible');
    assert.gt(level.coins.length, 0, 'static coin rewards are allowed in Passing');
    assert.truthy(level.objects.some(o => o.kind === 'mineralrock'), 'ordinary static rocks remain allowed');
  });

  test('floor exclusions: every generated cave depth keeps resources, stairs and fauna off excluded land', async () => {
    const N = 48, edge = N * W.CELL_M, tx = 931501, ty = 931502, key = W.tileKey(tx, ty);
    const grid = new Uint8Array(N * N).fill(T.PARK), why = new Uint32Array(N * N);
    const gameplayTiers = new Uint8Array(N * N).fill(1);
    for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++)
      { why[y * N + x] = y < N / 2 ? WHY.FARM_INTERIOR : WHY.GOLF; gameplayTiers[y * N + x] = 4; }
    const at = (x, y) => ({ x: (tx * N + x + .5) * W.CELL_M, y: (ty * N + y + .5) * W.CELL_M });
    const objects = [
      { kind: 'staircase', dir: 'down', id: 'open_stair', ...at(36, 24) },
      { kind: 'staircase', dir: 'down', id: 'excluded_stair', ...at(8, 8) },
      { kind: 'chest', poiClass: 'park', id: 'excluded_chest', tier: 3, ...at(8, 10) },
    ];
    W.setDepth(0).set(key, { status: 'ready', grid, baseGrid: grid.slice(), spawnWhy: why, gameplayTiers,
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
    const spawnWhy = new Uint32Array(N * N).fill(WHY.FARM_INTERIOR), gameplayTiers = new Uint8Array(N * N).fill(4);
    W.setDepth(0).set(key, { status: 'ready', grid, baseGrid: grid.slice(), spawnWhy, gameplayTiers, cellsPerEdge: N,
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
