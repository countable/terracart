(function () {
  const N = 32, E = 4096, tx = 4, ty = 5, tileEdgeM = N * WorldGen.CELL_M;
  const p = (x, y) => ({ x: x * E / N + E / (2 * N), y: y * E / N + E / (2 * N) });
  const line = [p(0, 16), p(N - 1, 16)];
  const park = [p(0, 0), p(N - 1, 0), p(N - 1, N - 1), p(0, N - 1)];
  const name = (() => {
    for (let i = 0; i < 2000; i++) {
      const s = `Orchard Lane ${i}`;
      if (StreetVariants.variantFor(StreetVariants.streetKey(s, tx, ty), s, 'minor')) return s;
    }
    throw new Error('no special street');
  })();
  const layers = (streetName) => [
    { name: 'landuse', extent: E, features: [{ type: 3, tags: { class: 'park' }, geom: [park] }] },
    { name: 'transportation', extent: E,
      features: [{ type: 2, tags: { class: streetName ? 'minor' : 'service' }, geom: [line] }] },
    { name: 'transportation_name', extent: E,
      features: streetName ? [{ type: 2, tags: { name: streetName }, geom: [line] }] : [] },
  ];

  test('special street owns the whole corridor, including empty cells', () => {
    const r = WorldGen.rasterizeTile(layers(name), N, tx, ty, tileEdgeM);
    const owned = [];
    for (let i = 0; i < N * N; i++) if (r.streetArea[i]) owned.push(i);
    assert.gt(owned.length, N, 'corridor extends along and beside the line');
    const taken = new Set([...r.objects, ...r.wildplants,
      ...(r.streetDress?.objects || []), ...(r.streetDress?.wildplants || [])]
      .map(o => Math.floor((o.y - ty * tileEdgeM) / WorldGen.CELL_M) * N +
        Math.floor((o.x - tx * tileEdgeM) / WorldGen.CELL_M)));
    assert.truthy(owned.some(i => !taken.has(i)), 'intentional gaps remain owned');
    for (const i of owned) assert.eq(WorldGen.variantOwnerAt(r, i), 'road');
    const zone = { coverage: new Uint8Array(N * N) };
    zone.coverage[owned[0]] = 1;
    assert.eq(WorldGen.variantOwnerAt({ streetArea: r.streetArea, zone }, owned[0]), 'zone');
  });

  test('plain road has no special street reservation', () => {
    const r = WorldGen.rasterizeTile(layers(null), N, tx, ty, tileEdgeM);
    assert.falsy(r.streetArea.some(Boolean));
    assert.eq(WorldGen.variantOwnerAt(r, 16 * N + 16), null);
  });

  test('corridor covers horizontal and diagonal verges without sample gaps', () => {
    const index = (a, b) => ({ extent: E, lines: [{ variant: 'hedgerow',
      halfW: WorldGen.CELL_M / 2, line: [a, b] }] });
    const at = (mask, x, y) => mask[y * N + x];
    const horizontal = StreetVariants.area(index(p(0, 10), p(N - 1, 10)), N);
    for (let x = 2; x < N - 2; x++) {
      for (let y = 8; y <= 12; y++) assert.truthy(at(horizontal, x, y), `horizontal verge ${x},${y}`);
    }
    const diagonal = StreetVariants.area(index(p(0, 0), p(N - 1, N - 1)), N);
    for (let x = 2; x < N - 2; x++) {
      for (let d = -1; d <= 1; d++) assert.truthy(at(diagonal, x, x + d), `diagonal verge ${x},${x + d}`);
    }
    // Its centreline never enters this tile, but its band still owns rows 0-1.
    const outside = StreetVariants.area(index(
      { x: p(0, 0).x, y: -0.4 * E / N },
      { x: p(N - 1, 0).x, y: -0.4 * E / N }), N);
    for (let x = 2; x < N - 2; x++) {
      assert.truthy(at(outside, x, 0));
      assert.truthy(at(outside, x, 1));
      assert.falsy(at(outside, x, 2));
    }
  });

  test('clipped named road keeps bounded themed patches across a seam in either build order', () => {
    // A clipped road is a LONG one to the index (its length is unknown), so
    // it is themed in sections on the LONG_PATCH_UNITS lattice, about
    // LONG_ROAD_SECTION_SHARE of them (StreetVariants.longPatchThemed), and
    // a section under MIN_VARIANT_LENGTH_M is not laid. On this 224 m
    // fixture tile a lattice square is 56 m, so the road reaches 20 cells
    // into each tile (three squares a side) and the name is searched so a
    // square on each side of the seam wears the theme.
    const REACH = 20;
    const seamY = p(0, 15).y, py = Math.floor(seamY / StreetVariants.LONG_PATCH_UNITS) * StreetVariants.LONG_PATCH_UNITS;
    const squaresWest = [1024, 2048, 3072].map(px => `${tx * E + px},${ty * E + py}`);
    const squaresEast = [0, 1024, 2048].map(px => `${(tx + 1) * E + px},${ty * E + py}`);
    const seamName = (() => {
      for (let i = 0; i < 5000; i++) {
        const s = `Seam Lane ${i}`;
        const kw = StreetVariants.streetKey(s, tx, ty), ke = StreetVariants.streetKey(s, tx + 1, ty);
        if (StreetVariants.variantFor(kw, s, 'minor') && squaresWest.some(k => StreetVariants.longPatchThemed(kw, k))
          && squaresEast.some(k => StreetVariants.longPatchThemed(ke, k))) return s;
      }
      throw new Error('no seam street');
    })();
    const seamLine = (offset) => [
      { x: (N - REACH - offset) * E / N, y: seamY },
      { x: (N + REACH - offset) * E / N, y: seamY },
    ];
    const seamLayers = (offset) => [
      { name: 'transportation', extent: E,
        features: [{ type: 2, tags: { class: 'minor' }, geom: [seamLine(offset)] }] },
      { name: 'transportation_name', extent: E,
        features: [{ type: 2, tags: { name: seamName }, geom: [seamLine(offset)] }] },
    ];
    const build = (tileX, offset) => WorldGen.rasterizeTile(
      seamLayers(offset), N, tileX, ty, tileEdgeM);
    const west1 = build(tx, 0), east1 = build(tx + 1, N);
    const east2 = build(tx + 1, N), west2 = build(tx, 0);
    assert.eq(Array.from(west1.streetArea).join(','), Array.from(west2.streetArea).join(','));
    assert.eq(Array.from(east1.streetArea).join(','), Array.from(east2.streetArea).join(','));
    for (const r of [west1, east1, west2, east2]) {
      assert.truthy(r.streetArea.some(Boolean), 'a clipped street retains its compact themed corridor');
      assert.eq(r.streetIndex.lines[0].variant, west1.streetIndex.lines[0].variant, 'same theme in both tiles and build orders');
      for (const rec of r.streetIndex.dressingLines) {
        assert.lte(Streets.lineLengthM(rec.line, tileEdgeM / E), StreetVariants.MAX_VARIANT_LENGTH_M);
      }
      assert.truthy(StreetVariants.lineParts(r.streetIndex.lines[0], tileEdgeM / E).some(part => !part.variant), 'plain gaps separate the patches');
    }
    // A short road wholly inside a tile still receives its rolled theme.
    const contained = WorldGen.rasterizeTile(layers(name), N, tx, ty, tileEdgeM);
    assert.truthy(contained.streetIndex.lines[0].variant, 'contained short road keeps its theme');
    assert.truthy(contained.streetArea.some(Boolean), 'contained short road owns its corridor');
  });

  test('street replacement clears procedural scatter and preserves mapped places', () => {
    const idx = 16 * N + 16;
    const area = new Uint8Array(N * N);
    area[idx] = 1;
    const x = tx * tileEdgeM + 16.5 * WorldGen.CELL_M;
    const y = ty * tileEdgeM + 16.5 * WorldGen.CELL_M;
    const objects = [
      { id: `mr_${tx}_${ty}_16_16`, x, y },
      { id: 'house_osm', kind: 'house', x, y },
      { id: 'player_tree', placed: true, x, y },
    ];
    const wildplants = [{ id: `wp_${tx}_${ty}_16_16`, x, y }];
    const it = WorldGen.clearStreetAmbientSteps({ area, objects, wildplants, tx, ty, N, tileEdgeM });
    let result = it.next();
    while (!result.done) result = it.next();
    assert.eq(result.value, 2);
    assert.eq(objects.length, 2);
    assert.eq(wildplants.length, 0);
  });

  test('a plain rock street cannot drop verge rocks inside a variant corridor', () => {
    const area = new Uint8Array(N * N);
    area[16 * N + 16] = 1;
    const x = tx * tileEdgeM + 16.5 * WorldGen.CELL_M;
    const y = ty * tileEdgeM + 16.5 * WorldGen.CELL_M;
    const rock = (id, line) => ({ id: `mr_${tx}_${ty}_${id}_16`, x, y, _street: true, _streetLine: line });
    const objects = [rock(1, 'plain'), rock(2, 'variant')];
    const it = WorldGen.clearStreetAmbientSteps({ area, objects, wildplants: [], tx, ty, N, tileEdgeM,
      ownLines: new Set(['variant']) });
    let r = it.next();
    while (!r.done) r = it.next();
    assert.eq(r.value, 1);
    assert.eq(objects.length, 1);
    assert.eq(objects[0]._streetLine, 'variant', 'a variant street keeps its own rocks');
  });

  test('surface street cleanup keeps the cave entrance tied to its original rock', () => {
    const smallN = 12, edge = smallN * WorldGen.CELL_M;
    const grid = new Uint8Array(smallN * smallN).fill(WorldGen.T.GRASS);
    const roadMask = new Uint8Array(smallN * smallN);
    const rock = WorldGen.makeObject('mineralrock',
      tx * edge + 6.5 * WorldGen.CELL_M,
      ty * edge + 6.5 * WorldGen.CELL_M,
      `mr_${tx}_${ty}_6_6`, { caveVariant: 0, _clusterId: 'same-rock' });
    const source = { grid: grid.slice(), spawnWhy: new Uint32Array(smallN * smallN),
      objects: [rock], wildplants: [] };
    const base = { cellsPerEdge: smallN, grid, roadMask, poiPadCells: null, objects: [rock] };
    const cleared = { cellsPerEdge: smallN, grid, roadMask, poiPadCells: null,
      objects: [], caveSource: source };
    WorldGen.maybePlaceCaveEntrance(base, tx, ty, edge);
    WorldGen.maybePlaceCaveEntrance(cleared, tx, ty, edge);
    const stair = e => e.objects.find(o => o.kind === 'staircase');
    assert.truthy(stair(base));
    assert.eq(stair(cleared).id, stair(base).id);
  });

  test('cached OSM vegetation and poles obey empty reserved cells', () => {
    const entry = { cellsPerEdge: N, tileEdgeM, grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS),
      roadMask: new Uint8Array(N * N), streetArea: new Uint8Array(N * N),
      objects: [], wildplants: [], parkingTreasures: [] };
    // The tree's eight relocation candidates are reserved as well.
    for (let y = 14; y <= 16; y++) for (let x = 14; x <= 16; x++) entry.streetArea[y * N + x] = 1;
    const bin = {
      trees: [{ lix: 15, liy: 15, kind: 'tree', id: 'tree_osm_1' }],
      shrubs: [{ lix: 15, liy: 15, crop: 'shrub', id: 'shrub_osm_1' }],
      poles: [{ lix: 15, liy: 15, kind: 'pole', id: 'pole_osm_1' }],
      wells: [{ lix: 15, liy: 15, kind: 'well', id: 'well_osm_1' }],
    };
    WorldGen.injectTileBin(entry, bin, tx, ty);
    assert.eq(entry.wildplants.length, 0);
    assert.eq(entry.objects.length, 1, 'the mapped well remains a place landmark');
    assert.eq(entry.objects[0].kind, 'well');
  });
})();
