(function () {
  const W = WorldGen, T = W.T;
  test('L1 road geology: only small roads make walls; medium, large and paths stay open', () => {
    const source = Uint8Array.from([T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH, T.BUILDING, T.WATER, T.GRASS]);
    const result = W.undergroundTerrain({ baseGrid: source }, source, 1);
    assert.eq([...result.grid].join(), [T.CAVE_WALL, T.CAVE_FLOOR, T.CAVE_FLOOR, T.CAVE_FLOOR,
      T.CAVE_WALL, T.CAVE_WALL, T.CAVE_FLOOR].join());
  });
  test('deep stone: only surface parks and commercial clearings open, roads remain stone', () => {
    const source = Uint8Array.from([T.GRASS, T.PARK, T.COMMERCIAL, T.GROVE, T.BUILDING, T.ROAD]);
    const surface = { grid: new Uint8Array(6).fill(T.PARK), baseGrid: source, roadMask: Uint8Array.from([0, 0, 1, 0, 0, 1]) };
    const result = W.undergroundTerrain(surface, new Uint8Array(6).fill(T.CAVE_FLOOR), 3);
    assert.eq([...result.grid].join(','), [T.CAVE_WALL,T.CAVE_FLOOR,T.CAVE_WALL,T.CAVE_FLOOR,T.CAVE_WALL,T.CAVE_WALL].join(','));
    assert.eq([...result.areas].join(','), '0,1,0,1,0,0');
    assert.eq(source[0], T.GRASS, 'immutable surface untouched');
  });
  test('goblin city: roads and water open; every building class remains stone', () => {
    const source = Uint8Array.from([T.ROAD, T.WATER, T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE, T.GRASS]);
    const result = W.undergroundTerrain({ baseGrid: source }, new Uint8Array(6).fill(T.CAVE_WALL), 2);
    assert.eq([...result.grid].join(), [T.CAVE_FLOOR,T.CAVE_FLOOR,T.CAVE_WALL,T.CAVE_WALL,T.CAVE_WALL,T.CAVE_FLOOR].join());
    assert.falsy(result.areas.some(Boolean), 'city cells do not become deep-stone settlements');
  });
  test('underdark: surface structures and prior cave walls never make walls', () => {
    const surface = { grid: Uint8Array.from([T.WATER, T.BUILDING, T.ROAD, T.GRASS]) };
    const result = W.undergroundTerrain(surface, new Uint8Array(4).fill(T.CAVE_WALL), 4);
    assert.truthy([...result.grid].every(t => t === T.CAVE_FLOOR));
  });
  test('dungeon progression: first cave has exits only; deep stone and underdark have onward shafts', async () => {
    const N = 24, edge = N * W.CELL_M, tx = 930121, ty = 930122, key = W.tileKey(tx, ty);
    const grid = new Uint8Array(N * N).fill(T.GRASS);
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) grid[y*N+x] = T.PARK;
    for (let y = 12; y < 22; y++) for (let x = 12; x < 22; x++) grid[y*N+x] = T.COMMERCIAL;
    const objects = [{ kind: 'staircase', dir: 'down', id: 'source_stair', x: (tx+0.5)*edge, y: (ty+0.5)*edge }];
    W.setDepth(0).set(key, { status: 'ready', grid, baseGrid: grid.slice(), cellsPerEdge: N, tileEdgeM: edge, objects, genObjects: objects, wildplants: [] });
    try {
      const shallow = await W.loadTile.atDepth(1, tx, ty, 49);
      assert.eq(shallow.objects.filter(o => o.kind === 'staircase' && o.dir === 'down').length, 0);
      assert.eq(shallow.objects.filter(o => o.kind === 'staircase' && o.dir === 'up').length, 1);
      const deep = await W.loadTile.atDepth(3, tx, ty, 49);
      assert.truthy(deep.grid.includes(T.CAVE_WALL));
      assert.eq(deep.undergroundClearings.length, 2);
      assert.truthy(deep.undergroundResidents.some(o => o.dwarf));
      assert.truthy(deep.objects.some(o => o.kind === 'grove_shrine'));
      assert.truthy(deep.objects.filter(o => o.kind === 'grove_shrine' || o.name?.endsWith('cache')).every(o => o.depth === 3), 'settlement objects belong to their floor');
      assert.truthy(deep.objects.some(o => o.kind === 'chest' && o.name === 'Dwarven city cache'));
      const dark = await W.loadTile.atDepth(4, tx, ty, 49);
      assert.falsy(dark.grid.includes(T.CAVE_WALL));
      assert.truthy(dark.objects.some(o => o.kind === 'staircase' && o.dir === 'up'));
      assert.truthy(dark.objects.some(o => o.kind === 'staircase' && o.dir === 'down'));
      const before = JSON.stringify(deep.genObjects);
      W.setDepth(3).delete(key);
      const rebuilt = await W.loadTile.atDepth(3, tx, ty, 49);
      assert.eq(JSON.stringify(rebuilt.genObjects), before, 'same surface yields identical terrain dressing');
    } finally {
      for (const depth of [0, 1, 2, 3, 4]) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });
  test('arena tile: isolated blank cache does not recursively generate the dungeon', async () => {
    const tx = 2700, ty = 5700, key = W.tileKey(tx, ty);
    try {
      const arena = await W.loadTile.atDepth(W.ARENA_DEPTH, tx, ty, 49);
      assert.eq(arena.cellsPerEdge, W.cellsPerEdgeForTile(ty), 'arena grid follows its tile row');
      assert.eq(arena.tileEdgeM, W.tileEdgeMeters(49), 'world metre frame stays shared with scene');
      assert.eq(arena.objects.length, 0); assert.eq(arena.creatures.length, 0);
      assert.truthy(arena._spawned);
      assert.truthy([...arena.grid].every(t => t === T.CAVE_FLOOR));
      assert.falsy(W.setDepth(99).has(key));
      assert.falsy(W.setDepth(0).has(key));
      W.setDepth(W.ARENA_DEPTH).delete(key);
      const otherFrame = await W.loadTile.atDepth(W.ARENA_DEPTH, tx, ty, 30);
      assert.eq(otherFrame.cellsPerEdge, arena.cellsPerEdge, 'different home latitude keeps the same cell identities');
      assert.eq(otherFrame.grid.length, arena.grid.length);
      assert.eq(otherFrame.tileEdgeM, W.tileEdgeMeters(30));
    } finally { W.setDepth(W.ARENA_DEPTH).delete(key); W.setDepth(0); }
  });
})();
