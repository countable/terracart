(function () {
  const W = WorldGen, N = 32, edge = N * W.CELL_M;
  function mirror(i, depth = 1, tierSeed = 1) {
    return { kind: 'chest', id: `cap_${String(i).padStart(4, '0')}_d${depth}`, caveOf: `cap_${i}`,
      depth, poiClass: 'park', tierSeed, rank: i,
      x: (i % N + 0.5) * W.CELL_M, y: (Math.floor(i / N) + 0.5) * W.CELL_M };
  }
  const cell = o => Math.floor(o.y / W.CELL_M) * N + Math.floor(o.x / W.CELL_M);
  const cap = (objects, occupied = new Set(objects.map(cell))) => W.capCaveChests(objects, N, 0, 0, edge, occupied);

  test('cave chest cap: only surplus lowest-tier chests are removed', () => {
    for (const n of [0, 49, 50, 51, 200]) {
      const low = Array.from({ length: n }, (_, i) => mirror(i));
      const high = [mirror(201, 1, 2), mirror(202, 1, 5)];
      const other = [{ ...mirror(203), caveOf: undefined, barrel: true },
        { kind: 'staircase', id: 'stair', x: 3.5, y: 80.5 }];
      const objects = [...low, ...high, ...other], occupied = new Set(objects.map(cell));
      assert.eq(cap(objects, occupied), Math.max(0, n - 50));
      assert.eq(objects.filter(o => low.includes(o)).length, Math.min(n, 50));
      for (const o of [...high, ...other]) assert.includes(objects, o);
      for (const o of low) assert.eq(occupied.has(cell(o)), objects.includes(o), 'dropped seats become free');
    }
  });

  test('cave chest cap: follows displayed tier at every depth, including merged tiers', () => {
    for (const depth of [1, 2, 4, 6, 8, 10]) {
      const objects = Array.from({ length: 200 }, (_, i) => mirror(i, depth));
      W.seedChestTiers(objects, { cave: true });
      const lowest = Math.min(...objects.map(chestTier));
      const high = objects.filter(o => chestTier(o) > lowest);
      cap(objects);
      assert.eq(objects.filter(o => chestTier(o) === lowest).length, 50, `depth ${depth}`);
      assert.eq(objects.length, 50 + high.length);
      for (const o of high) assert.includes(objects, o, 'higher-tier chest survives');
      assert.eq(cap(objects), 0, 'second pass cannot remove more');
    }
  });

  test('cave chest cap: rank then stable id determines survivors regardless of input order', () => {
    const first = Array.from({ length: 120 }, (_, i) => ({ ...mirror(i), rank: i % 3 }));
    const second = [...first].reverse();
    cap(first); cap(second);
    const ids = objects => objects.map(o => o.id).sort().join(',');
    assert.eq(ids(first), ids(second));
    assert.eq(first.filter(o => o.rank === 0).length, 40, 'best ranks retained first');
    assert.eq(first.filter(o => o.rank === 2).length, 0);
  });

  test('cave chest cap: loader drops surplus mirrors before dressing and deeper inheritance', async () => {
    const tx = 910001, ty = 910002, key = W.tileKey(tx, ty), grid = new Uint8Array(N * N).fill(W.T.GRASS);
    const objects = Array.from({ length: 200 }, (_, i) => ({ ...mirror(i), id: `source_${i}`,
      depth: 0, caveOf: undefined, x: tx * edge + mirror(i).x, y: ty * edge + mirror(i).y }));
    const surface = { status: 'ready', grid, baseGrid: grid, cellsPerEdge: N, tileEdgeM: edge,
      depth: 0, objects, genObjects: objects, wildplants: [] };
    W.setDepth(0).set(key, surface);
    try {
      const first = await W.loadTile.atDepth(1, tx, ty, 49.85);
      const chests = first.objects.filter(o => o.caveOf);
      assert.eq(chests.filter(o => chestTier(o) === 1).length, 50);
      assert.gt(chests.filter(o => chestTier(o) > 1).length, 0);
      assert.eq(first.genObjects.filter(o => o.caveOf).length, chests.length);
      const ids = new Set(chests.map(o => o.caveOf));
      const second = await W.loadTile.atDepth(2, tx, ty, 49.85);
      for (const o of second.objects.filter(o => o.caveOf)) assert.truthy(ids.has(o.caveOf), 'dropped chest stays absent below');
      const occupied = new Set();
      for (const o of first.objects) {
        const i = Math.floor((o.y - ty * edge) / W.CELL_M) * N + Math.floor((o.x - tx * edge) / W.CELL_M);
        assert.falsy(occupied.has(i), 'retained chests and cave dressing do not overlap'); occupied.add(i);
      }
    } finally {
      for (const depth of [0, 1, 2]) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });
})();
