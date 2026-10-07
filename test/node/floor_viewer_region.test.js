// The floor viewer's representative fake region, run through the REAL tile
// pipeline: the terrain mix the viewer promises (grass, forest, farmland,
// residential + houses, commercial, every street size, a small lake, a
// 5-cell beach with park backing, a separate park) must actually paint, and
// the dungeon floors must build from it.
(() => {
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
    W.tileCache.set(W.tileKey(0, 0), entry);
    return entry;
  }

  test('floor viewer region: every promised landcover class paints', async () => {
    const entry = await buildSurface();
    const T = WorldGen.T, counts = new Map();
    for (const v of entry.grid) counts.set(v, (counts.get(v) || 0) + 1);
    const at = t => counts.get(T[t]) || 0;
    assert.gt(at('FOREST'), 40, 'forest patch paints');
    assert.gt(at('FARMLAND'), 40, 'farmland paints');
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

  test('floor viewer region: street sizes differ and the beach is five cells', async () => {
    const entry = await buildSurface();
    const T = WorldGen.T, N = entry.cellsPerEdge;
    // The primary road is wide enough to paint more cells per length than a residential street.
    const isRoad = v => v === T.ROAD || v === T.ROAD_MD || v === T.ROAD_LG;
    let lg = 0, minor = 0;
    for (let y = 0; y < N; y++) if (isRoad(entry.grid[y * N + 35]) || isRoad(entry.grid[y * N + 36])) lg++;
    for (let y = 0; y < N; y++) if (isRoad(entry.grid[y * N + 22])) minor++;
    assert.gt(lg, minor, 'the primary paints a wider band than a residential street');
    // Beach: the north strip above the lake (rows ly-5..ly-1 at the lake's x range) is SAND, row ly-6 is not.
    const lx = 38, ly = 40;
    for (let dy = 1; dy <= 5; dy++) {
      const i = (ly - dy) * N + (lx + 4);
      assert.eq(entry.grid[i], T.SAND, `beach row ${dy} cells above the lake is sand`);
    }
    assert.truthy(entry.grid[(ly - 6) * N + (lx + 4)] !== T.SAND, 'the beach is exactly 5 cells wide');
    assert.eq(entry.grid[37 * N + 29], T.PARK, 'a park backs part of the beach');
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
})();
