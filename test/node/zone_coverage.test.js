(() => {
  const EXT = 4096, N = 64, unit = EXT / N;
  const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  function anchor(gx, gy, kind = 'grove', tx = 0) {
    return { kind, gx, gy, lx: gx - tx * EXT, ly: gy, owned: gx >= tx * EXT && gx < (tx + 1) * EXT,
      R: 42, upm: N * WorldGen.CELL_M / EXT, code: Zones.ZONE_KINDS[kind].code,
      key: Zones.anchorKey(gx, gy) };
  }
  function build(all, parks, opts = {}) {
    const field = opts.field || { anchors: [], idx: null, s: null, reach: [], allAnchors: all };
    const it = ZoneCoverage.buildSteps({ field, parks, N, tx: 0, ty: 0, ...opts });
    let r = it.next(), slices = 0;
    while (!r.done) { slices++; r = it.next(); }
    return { field: r.value, slices };
  }
  const ownerAt = (f, x, y) => f.anchors[f.coverage[y * N + x] - 1];
  const signature = f => Array.from(f.coverage, slot => slot ? `${f.anchors[slot - 1].kind}:${f.anchors[slot - 1].gx},${f.anchors[slot - 1].gy}` : '-').join('|');
  // An independent point/segment oracle pins scanline fill, holes, diagonal
  // fringes and Euclidean corners rather than mirroring the optimized raster.
  function covered(rings, x, y) {
    let inside = false, d2 = Infinity;
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      d2 = Math.min(d2, (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2);
    }
    const margin = Zones.FRINGE_FILL_M / (N * WorldGen.CELL_M / EXT);
    return inside || d2 <= margin ** 2;
  }

  function paint(field, grid, pathUnder, roadMask) {
    const it = ZoneCoverage.paintSteps(field, grid, N, pathUnder, roadMask);
    let result, slices = 0;
    do { result = it.next(); if (!result.done) slices++; } while (!result.done);
    return { painted: result.value, slices };
  }
  test('zone coverage: zone ground overrides ordinary terrain throughout the coverage union', () => {
    const T = WorldGen.T, original = [T.GRASS, T.PARK, T.FOREST, T.FARMLAND, T.ROCK,
      T.SCHOOL, T.COMMERCIAL, T.INDUSTRIAL, T.RESIDENTIAL, T.WASTELAND, T.SAND, T.WETLAND,
      T.GOLF, T.ORCHARD, T.PLAYGROUND, T.PITCH];
    for (const kind of Object.keys(Zones.ZONE_KINDS)) {
      const grid = new Uint8Array(N * N).fill(T.FOREST), coverage = new Uint16Array(N * N);
      grid.set(original); coverage.fill(1, 0, original.length);
      const field = { anchors: [anchor(1000, 1000, kind)], coverage, idx: new Uint8Array(N * N) };
      const result = paint(field, grid);
      assert.eq(result.painted, original.length);
      assert.gt(result.slices, 0);
      for (let i = 0; i < original.length; i++) {
        assert.eq(grid[i], Zones.terrainOf(kind), `${kind} overrides ${original[i]} beyond influence`);
        assert.eq(field.under[i], original[i], 'original land recorded');
      }
      assert.eq(grid[original.length], T.FOREST, 'outside coverage unchanged');
      assert.eq(paint(field, grid).painted, 0, 'repainting preserves the original underlay');
      for (let i = 0; i < original.length; i++) assert.eq(field.under[i], original[i]);
    }
  });
  test('zone coverage: zero-valued grass remains original land across paint and legacy underlays', () => {
    const T = WorldGen.T, grid = new Uint8Array(N * N).fill(T.GRASS);
    const coverage = new Uint16Array(N * N); coverage[0] = 1;
    const field = { anchors: [anchor(1000, 1000)], coverage };
    paint(field, grid);
    assert.eq(grid[0], T.GROVE);
    assert.eq(Zones.landAt(grid, field.under, 0), T.GRASS);
    assert.eq(field.under.present[0], 1);
    field.anchors[0].kind = 'stones';
    paint(field, grid);
    assert.eq(grid[0], T.CHURCHYARD);
    assert.eq(Zones.landAt(grid, field.under, 0), T.GRASS, 'repaint cannot replace saved grass with the first zone');
    const legacy = new Uint8Array(N * N); legacy[1] = T.PARK;
    assert.eq(Zones.landAt(grid, legacy, 0), T.CHURCHYARD, 'legacy zero still means untouched');
    assert.eq(Zones.landAt(grid, legacy, 1), T.PARK, 'legacy nonzero land still works');
    assert.eq(Zones.landAt(grid, null, 0), T.CHURCHYARD);
  });
  test('zone coverage: road bands, paths, water and structures retain their visible footprint', () => {
    const T = WorldGen.T, original = [T.ROAD, T.ROAD_MD, T.ROAD_LG, T.WATER,
      T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE, T.CAVE_WALL, T.PIER, T.PATH, T.PARK];
    const grid = new Uint8Array(N * N).fill(T.FOREST); grid.set(original);
    const coverage = new Uint16Array(N * N).fill(1), roadMask = new Uint8Array(N * N);
    roadMask[10] = 1;
    const pathUnder = { '9_0': T.FOREST, '20_0': T.FARMLAND };
    const field = { anchors: [anchor(1000, 1000)], coverage };
    paint(field, grid, pathUnder, roadMask);
    for (let i = 0; i < original.length; i++) assert.eq(grid[i], original[i], `protected terrain ${i}`);
    assert.eq(pathUnder['9_0'], T.GROVE, 'zone ground beneath the still visible path');
    assert.eq(pathUnder['20_0'], T.FARMLAND, 'stale path metadata does not paint non-path cells');
    for (let i = 0; i < original.length; i++) assert.eq(field.under[i], 0, 'unpainted cell adds no underlay');
    assert.eq(grid[11], T.GROVE, 'ordinary adjacent ground still changes');
  });
  test('zone coverage: road bands restore earlier halo and fringe paint even outside the union', () => {
    const T = WorldGen.T, grid = new Uint8Array(N * N).fill(T.FOREST);
    const under = new Uint8Array(N * N), coverage = new Uint16Array(N * N), roadMask = new Uint8Array(N * N);
    grid[0] = T.CHURCHYARD; under[0] = T.RESIDENTIAL; coverage[0] = 1; roadMask[0] = 1;
    grid[1] = T.GROVE; under[1] = T.COMMERCIAL; roadMask[1] = 1;
    grid[2] = T.ROAD; under[2] = T.RESIDENTIAL; coverage[2] = 1; roadMask[2] = 1;
    grid[3] = T.PATH; under[3] = T.PARK; coverage[3] = 1; roadMask[3] = 1;
    const field = { anchors: [anchor(1000, 1000)], coverage, under };
    paint(field, grid, {}, roadMask);
    assert.eq(grid[0], T.RESIDENTIAL, 'covered road band restored');
    assert.eq(grid[1], T.COMMERCIAL, 'fringe road band outside coverage restored');
    assert.eq(grid[2], T.ROAD, 'actual road keeps its footprint');
    assert.eq(grid[3], T.PATH, 'actual path keeps its footprint');
    assert.eq(under[0], T.RESIDENTIAL); assert.eq(under[1], T.COMMERCIAL);
  });
  test('zone coverage: expanded paint preserves original land saved by halo and fringe passes', () => {
    const T = WorldGen.T, grid = new Uint8Array(N * N).fill(T.GROVE);
    const under = new Uint8Array(N * N); under[0] = T.RESIDENTIAL; under[1] = T.PARK;
    const coverage = new Uint16Array(N * N); coverage[0] = coverage[1] = 1;
    const field = { anchors: [anchor(1000, 1000, 'stones')], coverage, under };
    assert.eq(paint(field, grid).painted, 2);
    assert.eq(field.under, under);
    assert.eq(under[0], T.RESIDENTIAL); assert.eq(under[1], T.PARK);
    assert.eq(grid[0], T.CHURCHYARD); assert.eq(grid[1], T.CHURCHYARD);
  });

  test('zone coverage: associated footprint and exact 30m fringe include holes and diagonal corners correctly', () => {
    const rings = [[{ x: 300, y: 600 }, { x: 3600, y: 350 }, { x: 3400, y: 3650 }, { x: 400, y: 3400 }],
      rect(1300, 1300, 2700, 2700)];
    const a = anchor(800, 800);
    const { field: f, slices } = build([a], [{ rings }]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      assert.eq(!!f.coverage[y * N + x], covered(rings, (x + .5) * unit, (y + .5) * unit), `cell ${x},${y}`);
    }
    assert.falsy(ownerAt(f, 31, 31), 'large polygon hole stays empty past its fringe');
    assert.truthy(ownerAt(f, 10, 10));
    assert.truthy(f.coverage instanceof Uint16Array);
    assert.gt(slices, 0, 'coverage yields work slices');
  });

  test('zone coverage: original influence winners survive overlapping park-only ownership', () => {
    const grove = anchor(1000, 1000), stones = anchor(1500, 1500, 'stones');
    const idx = new Uint8Array(N * N); idx[20 * N + 20] = 1;
    const strength = new Uint8Array(N * N); strength[20 * N + 20] = 90;
    const field = { anchors: [stones], idx, s: strength, reach: [], allAnchors: [grove, stones] };
    const f = build([grove, stones], [{ rings: [rect(500, 500, 3000, 3000)] }], { field }).field;
    assert.eq(ownerAt(f, 20, 20), stones);
    assert.eq(ownerAt(f, 21, 20), grove);
    assert.eq(f.idx, idx);
    assert.eq(f.s[20 * N + 20], 90);
    assert.eq(f.anchors[0], stones, 'one-based influence slots stay unchanged');
  });

  test('zone coverage: park and anchor enumeration cannot change an overlap winner', () => {
    const parks = [{ rings: [rect(200, 200, 2000, 3000)] }, { rings: [rect(1500, 400, 3500, 3200)] }];
    const run = reverse => {
      const anchors = [anchor(700, 700), anchor(2800, 800)];
      return build(reverse ? anchors.reverse() : anchors, reverse ? parks.slice().reverse() : parks).field;
    };
    const f = run(false);
    assert.eq(signature(f), signature(run(true)));
    assert.eq(ownerAt(f, 27, 20).gx, 700, 'park-only ties use stable global point');
  });

  test('zone coverage: an unrelated park or cemetery cannot extend a grove', () => {
    const parks = [{ rings: [rect(2700, 2700, 3500, 3500)] },
      { rings: [rect(500, 500, 1500, 1500)], cemetery: true }];
    const f = build([anchor(1000, 1000)], parks).field;
    assert.falsy(f.coverage.some(Boolean));
  });

  test('zone coverage: buffered source polygons extend into neighbouring tiles without halo cells', () => {
    const a = anchor(3900, 1800);
    a.owned = false; a.lx = -196;
    const rings = [rect(-600, 1200, 800, 2400)];
    const f = build([a], [{ rings }], { tx: 1 }).field;
    assert.eq(f.idx, null, 'fringe-only tile needs no painted influence');
    assert.eq(ownerAt(f, 2, 24), a);
    assert.eq(a.originGX, undefined, 'neighbour never settles another tile\'s origin');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      assert.eq(!!f.coverage[y * N + x], covered(rings, (x + .5) * unit, (y + .5) * unit));
    }
  });

  test('zone coverage: enclosed outdoor patterns phase from the settled POI in either metre frame', () => {
    for (const tileEdgeM of [448, 713]) {
      const a = anchor(1800, 1800);
      const chest = { kind: 'chest', _poiAt: '1800,1800', x: 2000 / EXT * tileEdgeM, y: 2100 / EXT * tileEdgeM };
      const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
      build([a], [{ rings: [rect(900, 900, 3000, 3000)] }], { tileEdgeM, grid, chests: [chest] });
      assert.inRange(a.originGX, 2000 - 1e-9, 2000 + 1e-9);
      assert.inRange(a.originGY, 2100 - 1e-9, 2100 + 1e-9);
    }
  });

  test('zone coverage: indoor POIs and coverage crossing a seam retain the shared source phase', () => {
    for (const why of ['indoor', 'influence', 'park']) {
      const a = anchor(why === 'influence' ? 200 : 1800, 1800);
      const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
      if (why === 'indoor') grid[Math.floor(a.gy / unit) * N + Math.floor(a.gx / unit)] = WorldGen.T.BUILDING;
      const parks = why === 'park' ? [{ rings: [rect(900, 900, 4050, 3000)] }] : [];
      build([a], parks, { tileEdgeM: 448, grid, chests: [{ kind: 'chest', _poiAt: `${a.lx},${a.ly}`, x: 210, y: 210 }] });
      assert.eq(a.originGX, undefined, why);
      assert.eq(a.originGY, undefined, why);
    }
  });
})();
