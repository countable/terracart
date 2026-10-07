// The floor viewer's representative fake region, run through the REAL tile
// pipeline: the terrain mix the viewer promises (grass, forest, parking, church,
// residential + houses, commercial, every street size, a small lake, a
// 5-cell beach with park backing, a separate park) must actually paint, and
// the dungeon floors must build from it.
(() => {
  const test = (name, fn) => globalThis.test(name, async () => {
    const W = WorldGen;
    const cached = Array.from({ length: 9 }, (_, d) => [...W.tileCacheFor(d)]);
    try { await fn(); }
    finally {
      for (let d = 0; d < cached.length; d++) {
        const cache = W.tileCacheFor(d); cache.clear();
        for (const [key, value] of cached[d]) cache.set(key, value);
      }
      W.setDepth(0);
    }
  });
  async function buildSurface() {
    const R = globalThis.FloorViewerRegion, W = globalThis.WorldGen;
    const pump = gen => { let r; do { r = gen.next(); } while (!r.done); return r.value; };
    const layers = R.makeLayers();
    const r = pump(W.rasterizeTileSteps(layers, R.N, 0, 0, R.EDGE));
    const entry = Object.assign({ tx: 0, ty: 0, cellsPerEdge: R.N, tileEdgeM: R.EDGE,
      layers, status: 'ready', depth: 0 }, r);
    entry.objects = r.objects.slice();
    pump(W.maybePlaceCaveEntranceSteps(entry, 0, 0, R.EDGE, r.objects, r.wildplants));
    entry.baseGrid = entry.grid.slice();
    entry.genObjects = entry.objects.slice();
    W.stampPoiDensity(entry.objects);
    W.tileCacheFor(0).set(W.tileKey(0, 0), entry);
    return entry;
  }

  test('floor viewer region: source geometry and labels fit the visible rectangle', async () => {
    const R = FloorViewerRegion;
    for (const layer of R.makeLayers()) for (const feature of layer.features)
      for (const ring of feature.geom) for (const point of ring) {
        assert.truthy(point.x >= 0 && point.x <= R.WIDTH * R.CELL, 'source x is visible');
        assert.truthy(point.y >= 0 && point.y <= R.HEIGHT * R.CELL, 'source y is visible');
      }
    for (const label of R.labels) {
      assert.truthy(label.x >= 0 && label.x < R.WIDTH, `${label.text} x is visible`);
      assert.truthy(label.y >= 0 && label.y < R.HEIGHT, `${label.text} y is visible`);
    }
  });

  test('floor viewer region: every surface nexus kind has a real source', async () => {
    const entry = await buildSurface();
    const kinds = new Set(entry.zone.anchors.map(anchor => anchor.kind));
    assert.truthy(entry.zone.anchors.some(anchor => anchor.kind === 'quarry' && anchor.owned && !anchor.clipped),
      'the parking lot generates a complete quarry nexus inside the map');
    for (const kind of ['grove', 'stones', 'tar', 'beach', 'quarry'])
      assert.truthy(kinds.has(kind), `${kind} anchor generated from the fixture source`);
  });

  test('floor viewer region: every promised landcover class paints', async () => {
    const entry = await buildSurface();
    const T = WorldGen.T, counts = new Map();
    for (const v of entry.grid) counts.set(v, (counts.get(v) || 0) + 1);
    const at = t => counts.get(T[t]) || 0;
    assert.gt(at('FOREST'), 40, 'forest patch paints');
    assert.eq(entry.grid[15 * FloorViewerRegion.N + 55], T.FOREST, 'forest sits below the eastern grove');
    const lot = entry.grid[12 * FloorViewerRegion.N + 7];
    assert.truthy(lot === T.COMMERCIAL || lot === T.ROCK, 'parking lot is paved or quarry ground, not bare dirt');
    assert.eq(entry.grid[3 * FloorViewerRegion.N + 5], T.COMMERCIAL, 'commercial fills the former northwest forest');
    assert.eq(entry.grid[21 * FloorViewerRegion.N + 25], T.RESIDENTIAL, 'residential fills the west side above the medium road');
    assert.eq(at('FARMLAND'), 0, 'farmland is replaced by the parking lot');
    assert.eq(FloorViewerRegion.WIDTH, 60, 'the viewport is sixty cells wide');
    assert.eq(FloorViewerRegion.HEIGHT, 35, 'the viewport is thirty-five cells high');
    assert.gt(at('RESIDENTIAL'), 100, 'residential belt paints');
    assert.gt(at('COMMERCIAL'), 40, 'commercial block paints');
    assert.gt(at('BUILDING'), 30, 'house and shop footprints paint');
    assert.gt(at('GROVE'), 100, 'the park and its grove halo paint');
    assert.gt(at('PARK') + at('GROVE'), 130, 'the two parks paint');
    assert.gt(at('SAND'), 60, 'the beach paints');
    assert.gt(at('WATER'), 60, 'the lake paints');
    assert.gt(at('PITCH'), 20, 'the pitch paints');
    assert.gt(at('ROAD') + at('ROAD_MD') + at('ROAD_LG'), 50, 'streets paint in all three tiers');
    // The lake stays small: well under an eighth of the tile.
    assert.lt(at('WATER'), entry.grid.length / 8, 'the corner lake stays compact');
  });

  test('floor viewer region: each surface variant reaches real dressing', async () => {
    const V = FloorViewerVariants;
    for (let i = 1; i < V.options(0).length; i++) {
      await V.withSelection(0, i, async selected => {
        const entry = await buildSurface();
        assert.truthy(entry.zone.anchors.some(anchor => anchor.kind === selected.kind && anchor.variant === selected.id), selected.id);
        assert.truthy(entry.zoneDress.diagnostics.some(nexus => nexus.zoneVariant === selected.id),
          `${selected.id} reaches the real dressing pipeline`);

      });
    }
  });

  test('floor viewer region: street sizes differ and the beach is five cells', async () => {
    const entry = await buildSurface();
    const T = WorldGen.T, N = entry.cellsPerEdge;
    // The primary road is wide enough to paint more cells per length than a residential street.
    const isRoad = v => v === T.ROAD || v === T.ROAD_MD || v === T.ROAD_LG;
    let lg = 0, minor = 0;
    for (let y = 0; y < N; y++) if (isRoad(entry.grid[y * N + 39]) || isRoad(entry.grid[y * N + 40])) lg++;
    for (let y = 0; y < N; y++) if (isRoad(entry.grid[y * N + 22])) minor++;
    assert.gt(lg, minor, 'the primary paints a wider band than a residential street');
    // Beach: the north strip above the lake (rows ly-5..ly-1 at the lake's x range) is SAND, row ly-6 is not.
    const lx = 48, ly = 27;
    for (let dy = 1; dy <= 5; dy++) {
      const i = (ly - dy) * N + (lx + 4);
      assert.eq(entry.grid[i], T.SAND, `beach row ${dy} cells above the lake is sand`);
    }
    assert.truthy(entry.grid[(ly - 6) * N + (lx + 4)] !== T.SAND, 'the beach is exactly 5 cells wide');
    assert.eq(entry.grid[19 * N + 46], T.PARK, 'a park backs part of the beach');
  });

  test('floor viewer region: dungeon floors derive from the fake tile', async () => {
    const entry = await buildSurface();
    const R = globalThis.FloorViewerRegion, W = globalThis.WorldGen, T = W.T;
    for (const depth of [1, 2, 3]) {
      const e = await W.loadTile.atDepth(depth, 0, 0, R.lat);
      assert.eq(e.status, 'ready', `depth ${depth} builds`);
      const open = [...e.grid].filter(v => v === T.CAVE_FLOOR).length;
      assert.gt(open, 50, `depth ${depth} has open floor`);
      assert.truthy(e.objects.some(o => o.kind === 'staircase'), `depth ${depth} seats stairs`);
    }
  });

  test('floor viewer region: compact spring preview reports the actual placement decision on both authored floors', async () => {
    const W = WorldGen, V = FloorViewerVariants, R = FloorViewerRegion;
    for (const depth of [1, 2]) {
      W.setDepth(0);
      for (let d = 0; d <= depth; d++) W.tileCacheFor(d).clear();
      await V.withSelection(depth, V.options(depth).findIndex(row => row.id === 'spring_cave'), async () => {
        await buildSurface();
        const entry = await W.loadTile.atDepth(depth, 0, 0, R.lat);
        if (entry.promise) await entry.promise;
        const result = entry.caveAreas.diagnostics.find(area => area.variant === 'spring_cave');
        assert.truthy(result, `spring evaluated on floor ${depth}`);
        assert.truthy(result.status === 'placed' || (result.status === 'declined' && result.reason),
          'oversized layouts report the live placement refusal');
      });
    }
    W.setDepth(0);
  });
})();
