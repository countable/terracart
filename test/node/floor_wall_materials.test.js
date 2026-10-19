(() => {
  test('sewer water follows existing L1 centre lanes without repainting walls, banks or L2', () => {
    const T = WorldGen.T;
    const entry = { depth: 1, grid: [T.CAVE_FLOOR, T.CAVE_FLOOR, T.CAVE_WALL, T.CAVE_LAVA],
      underground: { lane: new Set([0, 2, 3]) } };
    assert.eq(FloorWallMaterials.groundTexture(entry, 0), 'floor-sewer-water');
    for (const i of [1, 2, 3]) assert.eq(FloorWallMaterials.groundTexture(entry, i), null);
    assert.eq(FloorWallMaterials.groundTexture({...entry, depth: 2}, 0), null);
    assert.eq(FloorWallMaterials.groundTexture({...entry, underground: null}, 0), null);
    assert.eq(FloorWallMaterials.groundTexture(null, 0), null);
    assert.eq(entry.grid[0], T.CAVE_FLOOR, 'visual water never changes walkability');
  });
  test('L1 actual water and pier water use sewer art independently of decorative channels', () => {
    const T = WorldGen.T;
    const grid = [T.WATER, T.PIER, T.WETLAND, T.CAVE_LAVA, T.CAVE_FLOOR];
    const entry = {depth: 1, grid};
    for (const i of [0, 1]) {
      assert.eq(FloorWallMaterials.groundTexture(entry, i), 'floor-sewer-water');
      for (const depth of [0, 2, 3, 4, 5, 6, 7, 8])
        assert.eq(FloorWallMaterials.groundTexture({...entry, depth}, i), null);
    }
    for (const i of [2, 3, 4]) assert.eq(FloorWallMaterials.groundTexture(entry, i), null);
    assert.eq(FloorWallMaterials.groundTexture(entry, 0, T.CAVE_WALL), null, 'render-time terrain override wins');
    assert.eq(grid.join(','), [T.WATER, T.PIER, T.WETLAND, T.CAVE_LAVA, T.CAVE_FLOOR].join(','),
      'water collision and pier walkability remain their original terrain types');
  });
  test('floor wall materials: concealed sides are omitted without opening the full-cell crown', () => {
    const points = [{x: 32, y: 64}, {x: 64, y: 64}, {x: 64, y: 96}, {x: 32, y: 96}];
    for (let mask = 0; mask < 16; mask++) {
      const faces = FloorWallMaterials.geometry(points, mask, 2);
      const cap = faces.filter(f => !f.normal), sides = faces.filter(f => f.normal);
      assert.eq(cap.length, 2, 'two triangles cover every complete crown');
      assert.eq(sides.length, mask.toString(2).replace(/0/g, '').length * 2, 'only exposed sides');
      assert.truthy(cap.flatMap(f => f.points).every(p => p.z === 19), 'approved wall height');
      const area = cap.reduce((sum, f) => {
        const [a, b, c] = f.points;
        return sum + Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;
      }, 0);
      assert.eq(area, 32*32, 'cap retains full cell thickness');
      for (const face of faces) for (const p of face.points) {
        assert.truthy(Object.values(p).every(Number.isFinite), 'finite world vertices and UVs');
        assert.truthy(p.u > 0 && p.u < 1 && p.v > 0 && p.v < 1, 'UVs avoid outer borders');
      }
    }
  });
  test('floor wall materials: lava accents are stable and sparse without rows or columns of cracks', () => {
    const counts = [0,0,0,0], rowCounts = [], colCounts = Array(64).fill(0);
    for (let y = -32; y < 32; y++) {
      let row = 0;
      for (let x = -32; x < 32; x++) {
        const v = FloorWallMaterials.variant(6,x,y); counts[v]++;
        assert.eq(v, FloorWallMaterials.variant(6,x,y), 'deterministic after scene rebuild');
        if (v === 0) { row++; colCounts[x+32]++; }
      }
      rowCounts.push(row);
    }
    assert.inRange(counts[0]/4096,.22,.28,'roughly one quarter of walls carry lava');
    assert.truthy([...rowCounts,...colCounts].every(n => n > 0 && n < 32), 'no periodic all-cracked rows or columns');
    assert.truthy(FloorWallMaterials.theme(6).face !== FloorWallMaterials.theme(6).faceAccent, 'plain and cracked tiles are distinct');
    assert.eq(FloorWallMaterials.theme(2).cap.join(','),'86,70,51','approved lighter earthy cave cap');
    assert.eq(FloorWallMaterials.theme(6).cap.join(','),'30,27,31','approved nearly black basalt cap');
  });
})();
