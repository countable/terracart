// Cached decoration must not change the generated layer caves derive from,
// or mutate a bin shared by later builds and other world frames.
(function () {
  const N = 32;
  const T = WorldGen.T;
  function entry(cellM = 7) {
    const grid = new Uint8Array(N * N).fill(T.GRASS);
    return { cellsPerEdge: N, tileEdgeM: N * cellM, grid,
      roadMask: new Uint8Array(N * N), objects: [], wildplants: [],
      parkingTreasures: [], roadLabels: {}, baseGrid: grid.slice(), genObjects: [] };
  }
  const point = (ix, iy, cellM = 7) => ({ x: (ix + 0.5) * cellM, y: (iy + 0.5) * cellM });

  test('tile bin: cached rows survive relocation and reuse in a different world frame', () => {
    const bin = { trees: [
      { kind: 'tree', lix: 10, liy: 10, crown_m: 3 },
      { kind: 'tree', lix: 10, liy: 10, crown_m: 8 },
    ] };
    const before = JSON.stringify(bin);
    for (const cellM of [7, 9]) {
      const e = entry(cellM);
      e.roadMask[10 * N + 10] = 1;
      WorldGen.injectTileBin(e, bin, 0, 0);
      assert.eq(e.objects.length, 2);
      assert.eq(e.objects[0].crown_m, 8, 'largest crown wins first choice');
      assert.eq(e.objects[0].x, point(11, 10, cellM).x, 'first free neighbour east');
      assert.eq(e.objects[1].x, point(9, 10, cellM).x, 'next tree takes west');
      assert.eq(e.objects[0].id, WorldGen.cellId('tree_sx', 0, 0, 11, 10));
      assert.eq(e.objects[1].id, WorldGen.cellId('tree_sx', 0, 0, 9, 10));
      assert.eq(JSON.stringify(bin), before, 'shared bin remains unchanged');
    }
  });

  test('tile bin: destinations displace scenery but cannot displace structures', () => {
    const e = entry();
    const rock = { kind: 'mineralrock', id: 'rock', ...point(5, 5) };
    const house = { kind: 'house', id: 'house', ...point(20, 20) };
    e.objects.push(rock, house);
    e.wildplants.push({ id: 'grass', crop: 'shrub', ...point(5, 5) });
    e.genObjects = e.objects.slice();
    WorldGen.injectTileBin(e, { chests: [
      { kind: 'chest', id: 'destination', poiClass: 'bus', lix: 5, liy: 5 },
      { kind: 'chest', id: 'blocked', poiClass: 'bus', lix: 20, liy: 20 },
    ], poles: [{ kind: 'pole', id: 'late-pole', lix: 5, liy: 5 }] }, 0, 0);
    assert.eq(e.objects.map(o => o.id).join(','), 'house,destination');
    assert.eq(e.wildplants.length, 0, 'displaced plants are removed');
    assert.eq(e.genObjects.length, 2, 'generated snapshots keep original scenery');
    assert.eq(e.genObjects[0], rock);
    assert.eq(e.genObjects[1], house);
  });

  test('tile bin: a well repaints live road terrain without changing the cave source', () => {
    const e = entry();
    const idx = 10 * N + 10;
    e.grid[idx] = T.ROAD;
    e.baseGrid = e.grid.slice();
    e.roadLabels['10_10'] = 'Old Road';
    const bin = { wells: [{ kind: 'well', id: 'fountain', lix: 10, liy: 10 }] };
    WorldGen.injectTileBin(e, bin, 0, 0);
    assert.eq(e.objects[0].id, 'fountain');
    assert.eq(e.grid[idx], T.GRASS);
    assert.eq(e.baseGrid[idx], T.ROAD);
    assert.eq(e.genObjects.length, 0);
    assert.eq(e.roadLabels['10_10'], undefined);
    assert.eq(bin.wells[0].lix, 10);
    assert.eq(bin.wells[0].x, undefined);
  });
})();
