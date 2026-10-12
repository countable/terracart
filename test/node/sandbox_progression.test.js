// The authored entrance must keep a climb-out on both sandbox cave floors.
test('sandbox progression: cave entrance mirrors return stairs onto open L1/L2 cells', () => {
  const n = 160, tx = 13, ty = 17;
  const built = Sandbox.buildForTest({ cellsPerEdge: n, tx, ty });
  const key = WorldGen.tileKey(tx, ty), oldDepth = WorldGen.depth || 0;
  const previous = [];
  for (const depth of [0, 1, 2]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cache = WorldGen.tileCacheFor(depth), k = WorldGen.tileKey(tx + dx, ty + dy);
    previous.push({ cache, k, entry: cache.get(k) });
  }
  WorldGen.tileCacheFor(0).set(key, built.entry);
  try {
    Sandbox.installHazardFloorsForTest({ cellsPerTile: n, tileEdgeM: n * WorldGen.CELL_M }, tx, ty);
    const entrance = built.entry.objects.find(o => o._sandboxProbe === 'cave-entrance');
    assert.truthy(entrance, 'surface entrance exists');
    assert.eq(entrance.dir, 'down');
    assert.eq(SandboxDestinations.find('cave-entrance').sub, 'CAVE ENTRANCE');
    const ids = new Set([entrance.id]);
    for (const depth of [1, 2]) {
      const floor = WorldGen.tileCacheFor(depth).get(key);
      const stairs = floor.objects.filter(o => o.kind === 'staircase');
      assert.eq(stairs.length, 1, 'one return path on each authored floor');
      const stair = stairs[0];
      assert.eq(stair.dir, 'up');
      assert.eq(stair.x, entrance.x, 'matching horizontal cell');
      assert.eq(stair.y, entrance.y, 'matching vertical cell');
      assert.eq(stair.depth, depth);
      assert.falsy(ids.has(stair.id), 'different floors keep distinct identities');
      ids.add(stair.id);
      const ix = Math.floor((stair.x - tx * floor.tileEdgeM) / built.cellM);
      const iy = Math.floor((stair.y - ty * floor.tileEdgeM) / built.cellM);
      assert.eq(floor.grid[iy * n + ix], WorldGen.T.CAVE_FLOOR, 'landing is walkable');
      assert.truthy(DungeonProgression.canUseDescent({}, depth, depth - 1, 'stairs'), 'return always allowed');
    }
    assert.falsy(DungeonProgression.canUseDescent({}, 1, 2, 'stairs'), 'fixture respects live L1 stair restriction');
    assert.truthy(DungeonProgression.canUseDescent({}, 1, 2, 'rope'), 'rope exercises ordinary L1 descent');
  } finally {
    for (const { cache, k, entry } of previous) {
      if (entry) cache.set(k, entry); else cache.delete(k);
    }
    WorldGen.setDepth(oldDepth);
  }
});
