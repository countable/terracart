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

  function paint(field, grid, pathUnder, roadMask, spawnWhy) {
    const it = ZoneCoverage.paintSteps(field, grid, N, pathUnder, roadMask, spawnWhy);
    let result, slices = 0;
    do { result = it.next(); if (!result.done) slices++; } while (!result.done);
    return { painted: result.value, slices };
  }
  test('zone coverage: zone ground overrides ordinary terrain throughout the coverage union', () => {
    const T = WorldGen.T, original = [T.GRASS, T.PARK, T.FOREST, T.FARMLAND, T.ROCK,
      T.SCHOOL, T.COMMERCIAL, T.INDUSTRIAL, T.RESIDENTIAL, T.WASTELAND, T.WETLAND,
      T.GOLF, T.ORCHARD, T.PLAYGROUND, T.PITCH];
    for (const kind of Object.keys(Zones.ZONE_KINDS)) {
      const grid = new Uint8Array(N * N).fill(T.FOREST), coverage = new Uint16Array(N * N);
      grid.set(original); coverage.fill(1, 0, original.length);
      const field = { anchors: [anchor(1000, 1000, kind)], coverage, idx: new Uint8Array(N * N) };
      const result = paint(field, grid);
      assert.eq(result.painted, original.filter(t => t !== Zones.terrainOf(kind)).length);
      assert.gt(result.slices, 0);
      for (let i = 0; i < original.length; i++) {
        assert.eq(grid[i], Zones.terrainOf(kind), `${kind} overrides ${original[i]} beyond influence`);
        assert.eq(Zones.landAt(grid, field.under, i), original[i], 'original land remains available even when no repaint is needed');
      }
      assert.eq(grid[original.length], T.FOREST, 'outside coverage unchanged');
      assert.eq(paint(field, grid).painted, 0, 'repainting preserves the original underlay');
      for (let i = 0; i < original.length; i++) assert.eq(Zones.landAt(grid, field.under, i), original[i]);
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
  test('zone coverage: road bands, paths, water, structures and BEACH SAND retain their visible footprint', () => {
    const T = WorldGen.T, original = [T.ROAD, T.ROAD_MD, T.ROAD_LG, T.WATER,
      T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE, T.CAVE_WALL, T.PIER, T.PATH, T.PARK, T.SAND];
    const grid = new Uint8Array(N * N).fill(T.FOREST); grid.set(original);
    grid[21] = T.PATH;    // a boardwalk cell over the beach, elsewhere from the T.PATH already above
    const coverage = new Uint16Array(N * N).fill(1), roadMask = new Uint8Array(N * N);
    roadMask[10] = 1;
    // A path's own "under" land metadata over the beach (a boardwalk pebble
    // path across the sand) must not turn into zone ground either.
    const pathUnder = { '9_0': T.FOREST, '20_0': T.FARMLAND, '21_0': T.SAND };
    const field = { anchors: [anchor(1000, 1000)], coverage };
    paint(field, grid, pathUnder, roadMask);
    for (let i = 0; i < original.length; i++) assert.eq(grid[i], original[i], `protected terrain ${i}`);
    assert.eq(grid[11], T.SAND, 'beach sand, not on any road, still keeps its look under zone coverage');
    assert.eq(pathUnder['9_0'], T.GROVE, 'zone ground beneath the still visible path');
    assert.eq(pathUnder['20_0'], T.FARMLAND, 'stale path metadata does not paint non-path cells');
    assert.eq(pathUnder['21_0'], T.SAND, 'a boardwalk\'s saved land over sand stays sand, never grove');
    for (let i = 0; i < original.length; i++) assert.eq(field.under[i], 0, 'unpainted cell adds no underlay');
    assert.eq(grid[12], T.GROVE, 'ordinary adjacent ground still changes');
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

  test('zone coverage: painted ground preserves every exclusion, including existing halo paint', () => {
    const T = WorldGen.T, W = WorldGen.SPAWN_WHY;
    const original = [T.RESIDENTIAL, T.COMMERCIAL, T.GROVE, T.PATH, T.ROAD,
      T.BUILDING, T.WATER, T.PIER, T.RESIDENTIAL, T.RESIDENTIAL];
    const grid = new Uint8Array(N * N).fill(T.GRASS); grid.set(original);
    const coverage = new Uint16Array(N * N); coverage.fill(1, 0, 9);
    const roadMask = new Uint8Array(N * N); roadMask[8] = 1;
    const spawnWhy = new Uint32Array(N * N);
    const everyReason = Object.values(W).reduce((bits, v) => bits | v, 0);
    spawnWhy.fill(everyReason, 0, original.length);
    const field = { anchors: [anchor(1000, 1000)], coverage };
    paint(field, grid, {}, roadMask, spawnWhy);
    for (let i = 0; i < original.length; i++) {
      assert.eq(spawnWhy[i], everyReason,
        `cell ${i}: site restrictions survive; transport, structures and uncovered ground keep lot reasons too`);
    }
    spawnWhy[0] = W.PRIVATE | W.BEHIND_HOUSE;
    paint(field, grid, {}, roadMask, spawnWhy);
    assert.falsy(WorldGen.isSpawnCell(grid, N, N, 0, 0, { spawnWhy, roadMask }, 'minor'),
      'live spawn gate rejects variant material on the excluded lot');
    spawnWhy[0] = W.PRIVATE | W.RESTRICTED;
    paint(field, grid, {}, roadMask, spawnWhy);
    assert.falsy(WorldGen.isSpawnCell(grid, N, N, 0, 0, { spawnWhy, roadMask }, 'minor'),
      'a real restricted site stays blocked even under zone ground');
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

  test('park beaches: adjoining park becomes grass marine meadow while mapped sand keeps its beach', () => {
    const T = WorldGen.T, a = anchor(1800, 1800);
    const park = { rings: [rect(700, 700, 3000, 3000)] };
    const beachLayer = { features: [{ type: 3, tags: { class: 'sand', subclass: 'beach' },
      geom: [rect(700, 700, 1100, 3000)] }] };
    const grid = new Uint8Array(N * N).fill(T.PARK);
    grid[20 * N + 13] = T.BUILDING;
    grid[21 * N + 13] = T.WATER;
    const f = build([a], [park], { grid, beachLayer }).field;
    const beach = ownerAt(f, 13, 22);
    assert.eq(beach.kind, 'beach');
    assert.truthy(beach.parkShore);
    assert.eq(beach.key, a.key, 'existing source point owns the beach identity');
    assert.eq(ownerAt(f, 30, 22), a, 'park keeps its original POI');
    assert.eq(a.variant, 'marine_meadow', 'beach park cannot roll an unrelated mushroom grove');
    paint(f, grid);
    assert.eq(grid[22 * N + 30], T.GRASS, 'marine meadow has grass ground');
    assert.falsy(ownerAt(f, 13, 20)?.parkShore, 'building is never beach');
    assert.falsy(ownerAt(f, 13, 21)?.parkShore, 'water is never beach');
    assert.eq(ownerAt(build([anchor(1800, 1800)], [park], { grid }).field, 13, 22).kind,
      'grove', 'a beach-like park name or sand without mapped beach is insufficient');
    const inland = { features: [{ type: 3, tags: { class: 'sand', subclass: 'sand' }, geom: beachLayer.features[0].geom }] };
    assert.falsy(build([anchor(1800, 1800)], [park], { grid, beachLayer: inland }).field.anchors.some(a => a.parkShore));
  });

  test('park beaches: source adjacency outside the park and direct beach POIs get a meadow companion', () => {
    const park = { rings: [rect(1200, 700, 3000, 3000)] };
    const beachLayer = { features: [{ type: 3, tags: { natural: 'beach' }, geom: [rect(700,700,1200,3000)] }] };
    for (const kind of ['grove', 'beach']) {
      const a = anchor(1800, 1800, kind), grid = new Uint8Array(N * N).fill(WorldGen.T.PARK);
      for (let y = 11; y < 47; y++) for (let x = 11; x < 19; x++) grid[y * N + x] = WorldGen.T.SAND;
      const f = build([a], [park], { grid, beachLayer }).field;
      assert.eq(ownerAt(f, 30, 22).variant, 'marine_meadow', kind);
      assert.eq(ownerAt(f, 18, 22).kind, 'beach', 'adjoining mapped sand stays beach');
      paint(f, grid);
      assert.eq(grid[22 * N + 30], WorldGen.T.GRASS);
      assert.eq(grid[22 * N + 18], WorldGen.T.SAND);
    }
    const distant = { features: [{ ...beachLayer.features[0], geom: [rect(0,0,100,100)] }] };
    assert.falsy(build([anchor(1800,1800)], [park], { grid:new Uint8Array(N*N).fill(WorldGen.T.PARK), beachLayer:distant })
      .field.anchors.some(a => a.variant === 'marine_meadow'), 'unrelated beach does not change an inland park');
  });

  test('park beaches: source identity survives clipped geometry, seams and feature order', () => {
    const run = (tx, reverse) => {
      const shift = rings => rings.map(r => r.map(p => ({ x: p.x - tx * EXT, y: p.y })));
      const parks = [
        { rings: shift([rect(3400, 1000, 4800, 2600)]) },
        { rings: shift([rect(3200, 800, 4900, 2800)]) },
      ];
      const features = [
        { type: 3, tags: { natural: 'beach' }, geom: shift([rect(tx ? 4096 : 3500, 1200, tx ? 4700 : 4096, 1500)]) },
        { type: 3, tags: { subclass: 'beach' }, geom: shift([rect(3600, 1500, 4600, 1700)]) },
      ];
      const grid = new Uint8Array(N * N).fill(WorldGen.T.SAND);
      return build([anchor(3900, 1800, 'grove', tx)], reverse ? parks.reverse() : parks,
        { tx, grid, beachLayer: { features: reverse ? features.reverse() : features } }).field;
    };
    const left = run(0), right = run(1);
    for (const tx of [0, 1]) assert.eq(signature(run(tx)), signature(run(tx, true)));
    const a = left.anchors.find(a => a.parkShore), b = right.anchors.find(a => a.parkShore);
    assert.truthy(a && b);
    for (const k of ['gx', 'gy', 'key', 'R', 'variant']) assert.eq(a[k], b[k], k);
    assert.truthy(a.owned); assert.falsy(b.owned, 'finite beach finds retain canonical tile ownership');
    assert.eq(a.originGX, undefined); assert.eq(b.originGX, undefined);
  });

  test('beach parks: buffered POIs continue across clipped park edges only', () => {
    const run = (right, gx, reverse = false) => {
      const a = anchor(gx, 1800), rings = [rect(3600, 1200, right, 2200)];
      if (reverse) rings[0].reverse();
      const grid = new Uint8Array(N * N).fill(WorldGen.T.PARK);
      const field = build([a], [{rings}], {grid, beachLayer:{features:[{
        type:3, tags:{natural:'beach'}, geom:[rect(3600,1200,3800,2200)]
      }]}}).field;
      return {a, field};
    };
    for (const reverse of [false,true]) {
      const {a,field} = run(4160,4172,reverse);
      assert.eq(a.variant,'marine_meadow');
      assert.truthy(field.anchors.some(a=>a.parkShore && !a.owned));
    }
    assert.falsy(run(4120,4132).a.variant==='marine_meadow','a real boundary beyond tile edge is not a clip edge');
    assert.falsy(run(4000,4012).a.variant==='marine_meadow','a nearby public park does not claim an outside POI');
    assert.falsy(run(4160,4800).a.variant==='marine_meadow','projection is bounded to the existing fringe distance');
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

  // ── Beaches keep their sand look (Sep 2026) ──────────────────────────────
  // A shore-sand cell must never come out of ANY zone/fringe pass as a
  // zone's ground: not the ragged HALO (Zones.haloSteps), not the PARK FRINGE
  // band (Zones.fringeSteps), not the full placement union (ZoneCoverage.
  // paintSteps, which must skip T.SAND). Runs the real pipeline
  // order from worldgen.js rasterizeTileSteps (halo, then fringe, then
  // coverage) over a tile scattered with sand under a full-tile park/anchor,
  // so every pass gets a real chance to touch it.
  test('zone coverage: NO zone or fringe pass ever repaints beach sand, through the real pipeline order', () => {
    const T = WorldGen.T;
    const grid = new Uint8Array(N * N);
    const sandCells = [];
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
      const i = iy * N + ix;
      if ((ix + iy) % 5 === 0) { grid[i] = T.SAND; sandCells.push(i); }
      else if ((ix + iy) % 3 === 0) grid[i] = T.RESIDENTIAL;
      else grid[i] = T.GRASS;
    }
    assert.gt(sandCells.length, 0, 'the fixture actually has sand');
    const a = anchor(1500, 1500);
    const idx = new Uint8Array(N * N).fill(1);        // the whole tile is the one anchor's disc
    const fld = { anchors: [a], idx, s: null, reach: [], allAnchors: [a] };
    const pathUnder = {};
    const run = (it) => { let r = it.next(); while (!r.done) r = it.next(); return r.value; };

    run(Zones.haloSteps(fld, grid, N, pathUnder));
    for (const i of sandCells) assert.eq(grid[i], T.SAND, `haloSteps left sand at ${i}`);
    assert.gt(Array.from(grid).filter((v) => v === T.GROVE).length, 0, 'the halo painted SOMETHING (residential lots)');

    const parks = [{ rings: [rect(0, 0, EXT, EXT)] }];
    const fringeOut = run(Zones.fringeSteps({ parks, grid, N, tx: 0, ty: 0, field: fld, pathUnder }));
    for (const i of sandCells) assert.eq(grid[i], T.SAND, `fringeSteps left sand at ${i}`);

    const zone = run(ZoneCoverage.buildSteps({ field: fringeOut.field, poiLayer: null, parks,
      tx: 0, ty: 0, N, chests: [], tileEdgeM: 448, grid }));
    run(ZoneCoverage.paintSteps(zone, grid, N, pathUnder, null, null));
    for (const i of sandCells) assert.eq(grid[i], T.SAND, `ZoneCoverage.paintSteps left sand at ${i}`);
    assert.gt(Array.from(grid).filter((v) => v === T.GROVE).length, sandCells.length,
      'the full pipeline still painted plenty of grove ground — just never over sand');
  });
  test('beach coverage: tagged source keeps one sand owner and excludes inland spill', () => {
    const beach = anchor(2048, 2048, 'beach'), grove = anchor(2048, 2048);
    const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
    for (let y = 29; y < 35; y++) for (let x = 29; x < 35; x++) grid[y * N + x] = WorldGen.T.SAND;
    const field = { anchors: [grove, beach], idx: new Uint8Array(N * N).fill(1), allAnchors: [grove, beach] };
    const out = build([grove, beach], [], { grid, field }).field;
    assert.eq(ownerAt(out, 32, 32).kind, 'beach');
    assert.eq(ownerAt(out, 40, 40).kind, 'grove');
    const plain = build([grove], [], { grid, field: { anchors: [grove], idx: new Uint8Array(N * N).fill(1), allAnchors: [grove] } }).field;
    assert.falsy(ownerAt(plain, 32, 32), 'unanchored beach is not a grove motif');
    const before = grid[32 * N + 32]; paint(out, grid);
    assert.eq(grid[32 * N + 32], before, 'beach sand retains its terrain');
  });
})();
