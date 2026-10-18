(() => {
  // Trace the union on a coarse grid so all sixteen connection combinations
  // exercise concave crowns, rather than reproducing the production outline.
  function footprint(mask) {
    const cells = new Set();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if ((x >= 3 && x < 5 && y >= 3 && y < 5)
        || (mask & 1 && x >= 3 && x < 5 && y < 3)
        || (mask & 2 && y >= 3 && y < 5 && x >= 5)
        || (mask & 4 && x >= 3 && x < 5 && y >= 5)
        || (mask & 8 && y >= 3 && y < 5 && x < 3)) cells.add(`${x},${y}`);
    }
    const edges = new Map();
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      if (!cells.has(`${x},${y - 1}`)) edges.set(`${x},${y}`, [x + 1, y]);
      if (!cells.has(`${x + 1},${y}`)) edges.set(`${x + 1},${y}`, [x + 1, y + 1]);
      if (!cells.has(`${x},${y + 1}`)) edges.set(`${x + 1},${y + 1}`, [x, y + 1]);
      if (!cells.has(`${x - 1},${y}`)) edges.set(`${x},${y + 1}`, [x, y]);
    }
    const points = [], start = edges.keys().next().value;
    let key = start;
    do { const [x, y] = key.split(',').map(Number); points.push({ x: x * 4, y: y * 4 }); key = edges.get(key).join(','); } while (key !== start);
    PolygonGeometry.removeCollinear(points);
    const openEdges = points.map((a, i) => {
      const b = points[(i + 1) % points.length];
      return (a.x === b.x && (a.x === 0 || a.x === 32)) || (a.y === b.y && (a.y === 0 || a.y === 32));
    });
    return { points, openEdges };
  }
  test('wall materials: every connection mask retains exact shared crown boundaries', () => {
    for (const kind of ['hedge', 'stone']) for (let mask = 0; mask < 16; mask++) {
      const { points, openEdges } = footprint(mask), height = 5;
      const faces = WallMaterials.geometry(kind, points, height, { openEdges });
      const capPoints = faces.filter(f => f.normal === null).flatMap(f => f.points);
      assert.truthy(capPoints.length, `${kind} mask ${mask} has a triangulated crown`);
      assert.lt(faces.length, 160, 'texture details do not create per-texel geometry');
      assert.truthy(faces.every(f => f.points.every(p => Object.values(p).every(Number.isFinite)
        && p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1)), 'finite positions and normalized UVs');
      assert.truthy(capPoints.every(p => p.z === height), 'crown matches obstacle support height');
      const inset = kind === 'hedge' ? 1.6 : .7;
      for (const [bit, axis, boundary, transverse] of [[1, 'y', 0, 'x'], [2, 'x', 32, 'y'], [4, 'y', 32, 'x'], [8, 'x', 0, 'y']]) {
        if (!(mask & bit)) continue;
        const seam = capPoints.filter(p => Math.abs(p[axis] - boundary) < 1e-8);
        assert.truthy(seam.length, 'open connection reaches the cell boundary');
        assert.lt(Math.abs(Math.min(...seam.map(p => p[transverse])) - (12 + inset)), 1e-8, 'shared left crown edge');
        assert.lt(Math.abs(Math.max(...seam.map(p => p[transverse])) - (20 - inset)), 1e-8, 'shared right crown edge');
        assert.truthy(!faces.some(f => f.normal && f.points.every(p => Math.abs(p[axis] - boundary) < 1e-8)), 'no shared-end face');
      }
    }
  });
  test('wall materials: junction caps keep joints transverse on every arm', () => {
    const { points, openEdges } = footprint(15);
    const capRegions = [
      { x0: 12, y0: 12, x1: 20, y1: 20, horizontal: true, joints: false },
      { x0: 12, y0: 0, x1: 20, y1: 12, horizontal: false },
      { x0: 20, y0: 12, x1: 32, y1: 20, horizontal: true },
      { x0: 12, y0: 20, x1: 20, y1: 32, horizontal: false },
      { x0: 0, y0: 12, x1: 12, y1: 20, horizontal: true }
    ];
    const faces = WallMaterials.geometry('stone', points, 5, { openEdges, capRegions });
    assert.lt(faces.length, 220, 'region clipping stays below mesh budget');
    for (const face of faces.filter(f => f.normal === null)) {
      const x = face.points.reduce((n, p) => n + p.x, 0) / 3;
      const y = face.points.reduce((n, p) => n + p.y, 0) / 3;
      if (x >= 12 && x <= 20 && y >= 12 && y <= 20) {
        assert.truthy(face.points.every(p => p.u >= 386 / 512 && p.v >= 130 / 512), 'core uses the unjointed stone slot');
        continue;
      }
      const axis = y < 12 || y > 20 ? 'y' : 'x';
      const a = face.points[0];
      for (const b of face.points.slice(1)) assert.lt(Math.abs((b.u - a.u) - (b[axis] - a[axis]) / 14 * 124 / 512), 1e-8, 'cap joints run across the arm');
    }
  });
  test('wall materials: pointed timber retains a small mesh and fixed support height', () => {
    const w = WallMaterials.WOOD, faces = WallMaterials.geometry('wood', [{ x: 0, y: 0 }, { x: w.width, y: 0 }, { x: w.width, y: w.width }, { x: 0, y: w.width }], w.height);
    assert.eq(faces.length, 24, 'chamfered pole sides and eight pointed crown faces');
    assert.eq(Math.max(...faces.flatMap(f => f.points.map(p => p.z))), w.height + w.tipHeight, 'point height');
  });
  test('wall materials: state tint colors both GPU and flat fallbacks', () => {
    const points = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }];
    const faces = WallMaterials.geometry('stone', points, 5, { tint: 0 });
    assert.truthy(faces.every(face => face.color === 0 && face.flatColor === 0), 'state tint reaches every material face');
  });
  test('wall materials: shared atlas is created once and headless scenes stay supported', () => {
    assert.eq(WallMaterials.prepare({}), null, 'missing texture manager is supported');
    let creates = 0, refreshes = 0, slots = 0;
    const context = { save() { slots++; }, restore() {}, translate() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, drawImage() {} };
    const texture = { getContext: () => context, getSourceImage: () => ({}), refresh() { refreshes++; }, setFilter() {} };
    const scene = { textures: { exists: () => creates > 0, get: () => texture, createCanvas() { creates++; return texture; } } };
    assert.eq(WallMaterials.prepare(scene), texture);
    assert.eq(WallMaterials.prepare(scene), texture);
    assert.eq(creates, 1); assert.eq(refreshes, 1); assert.eq(slots, 8, 'all material slots painted once');
    assert.truthy(WallMaterials.WHITE.u > .9 && WallMaterials.WHITE.v > .9, 'solid texel is outside material slots');
  });
})();
