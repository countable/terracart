(() => {
  test('sewer water follows existing L1 centre lanes without repainting walls or L2', () => {
    const T = WorldGen.T;
    const entry = { depth: 1, grid: [T.CAVE_FLOOR, T.CAVE_FLOOR, T.CAVE_WALL, T.CAVE_LAVA],
      underground: { lane: new Set([0, 2, 3]) } };
    assert.eq(FloorWallMaterials.groundTexture(entry, 0), 'floor-sewer-water');
    for (const i of [2, 3]) assert.eq(FloorWallMaterials.groundTexture(entry, i), null);
    assert.eq(FloorWallMaterials.groundTexture({...entry, depth: 2}, 0), null);
    assert.truthy(FloorWallMaterials.groundTexture({...entry, underground: null}, 0).startsWith('floor-sewer-ground'));
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
    for (const i of [2, 3]) assert.eq(FloorWallMaterials.groundTexture(entry, i), null);
    assert.eq(FloorWallMaterials.groundTexture(entry, 0, T.CAVE_WALL), null, 'render-time terrain override wins');
    assert.eq(grid.join(','), [T.WATER, T.PIER, T.WETLAND, T.CAVE_LAVA, T.CAVE_FLOOR].join(','),
      'water collision and pier walkability remain their original terrain types');
  });
  test('sewer stone: sparse stable alternates follow world cells across tile boundaries', () => {
    const counts = {ground: 0, groundBroken: 0, groundGrate: 0};
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const role = FloorWallMaterials.sewerGroundRole(x, y); counts[role]++;
      const n = 16, index = (y % n) * n + x % n;
      const entry = {depth: 1, cellsPerEdge: n, tx: Math.floor(x/n), ty: Math.floor(y/n)};
      assert.eq(FloorWallMaterials.groundTexture(entry, index, WorldGen.T.CAVE_FLOOR), 'floor-sewer-' + role);
    }
    assert.inRange(counts.ground / 4096, .85, .90);
    for (const role of ['groundBroken', 'groundGrate']) assert.inRange(counts[role] / 4096, .04, .08);
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
  test('sewer wall curves stay inside every footprint and keep the complete crown', () => {
    const points = [{x: 0, y: 0}, {x: 32, y: 0}, {x: 32, y: 32}, {x: 0, y: 32}];
    for (let mask = 0; mask < 16; mask++) for (let diagonal = 0; diagonal < 16; diagonal++) {
      const faces = FloorWallMaterials.geometry(points, mask, 0, 1, diagonal);
      for (const p of faces.flatMap(f => f.points)) {
        assert.inRange(p.x, 0, 32); assert.inRange(p.y, 0, 32); assert.inRange(p.z, 0, 19);
        assert.truthy(Object.values(p).every(Number.isFinite));
      }
      const shared = new Map();
      for (const f of faces.filter(f => f.normal)) for (const p of f.points) {
        const key = [f.normal.x, f.normal.y, p.x, p.y, p.z].join(',');
        if (shared.has(key)) assert.eq(shared.get(key), [p.u, p.v].join(','), 'subdivision UVs meet exactly');
        else shared.set(key, [p.u, p.v].join(','));
      }
      assert.eq(JSON.stringify(faces.filter(f => !f.normal)),
        JSON.stringify(FloorWallMaterials.geometry(points, mask, 0, 2).filter(f => !f.normal)));
    }
    const faces = FloorWallMaterials.geometry(points, 15, 0, 1);
    assert.eq(faces.length, 42, 'shoulder, upright and three curve strips per exposed side, plus crown');
    // Every outer-corner profile joins exactly with its adjoining face.
    const south = faces.filter(f => f.normal?.y === 1).flatMap(f => f.points);
    const east = faces.filter(f => f.normal?.x === 1).flatMap(f => f.points);
    for (const p of south.filter(p => p.x >= 29))
      assert.truthy(east.some(q => p.x === q.x && p.y === q.y && p.z === q.z), 'miter joins without a slit');
    const levels = [...new Set(south.map(p => p.z))].sort((a, b) => a - b);
    for (const z of levels) {
      const row = south.filter(p => p.z === z);
      assert.eq(new Set(row.map(p => p.v)).size, 1, 'one continuous UV row across strip boundaries');
    }
  });
  test('sewer wall recess joins straight runs and pins L/T inside corners', () => {
    const grid = [
      ['###', '#..', '#..'], // L
      ['###', '.#.', '.#.'], // T
      ['###', '###', '...'], // straight
      ['###', '#.#', '###'], // enclosed concave corners
    ];
    for (const rows of grid) {
      const solid = (x, y) => rows[y]?.[x] === '#';
      const walls = [];
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
        if (!solid(x, y)) continue;
        const mask = (!solid(x,y-1)?1:0)|(!solid(x+1,y)?2:0)|(!solid(x,y+1)?4:0)|(!solid(x-1,y)?8:0);
        const diagonal = (solid(x-1,y-1)?1:0)|(solid(x+1,y-1)?2:0)|(solid(x+1,y+1)?4:0)|(solid(x-1,y+1)?8:0);
        const points = [{x:x*32,y:y*32},{x:(x+1)*32,y:y*32},
          {x:(x+1)*32,y:(y+1)*32},{x:x*32,y:(y+1)*32}];
        walls.push({x,y, faces: FloorWallMaterials.geometry(points,mask,0,1,diagonal)});
      }
      for (const wall of walls) for (const other of walls) {
        if (other.x !== wall.x + 1 || other.y !== wall.y) continue;
        const seam = other.x * 32;
        const left = wall.faces.filter(f => f.normal).flatMap(f => f.points).filter(p => p.x === seam);
        // At an inside corner the matching exposed face belongs to the
        // diagonal wall, while the edge-adjacent wall has no exposed side.
        const right = walls.filter(w => w !== wall).flatMap(w => w.faces)
          .filter(f => f.normal).flatMap(f => f.points).filter(p => p.x === seam);
        for (const p of left) assert.truthy(right.some(q => p.y === q.y && p.z === q.z), 'shared cell edge closes at every curve height');
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
