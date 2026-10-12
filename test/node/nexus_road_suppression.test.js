(function () {
  const N = 12, extent = 120, scale = N * WorldGen.CELL_M / extent;
  function fixture(size = 'minor', variant = 'burned') {
    const coverage = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 4; x < 7; x++) coverage[y * N + x] = 1;
    const rec = { size, variant, key: 'stable', selectedVariant: variant, halfW: 3,
      line: [{ x: 5, y: 55 }, { x: 115, y: 55 }], rocks: true };
    const index = { extent, lines: [rec], dressingLines: [{ ...rec }] };
    WorldGen.runSteps(StreetVariants.suppressNexusRoadThemesSteps(index, { coverage }, N));
    return { index, rec, coverage };
  }
  test('nexus roads: exact boundary intervals hide theme without changing identity or substrate', () => {
    const { index, rec } = fixture();
    assert.eq(JSON.stringify(rec.nexusSuppressedRanges), '[[35,65]]');
    assert.eq(rec.key, 'stable'); assert.eq(rec.selectedVariant, 'burned'); assert.truthy(rec.rocks);
    assert.eq(StreetVariants.variantAt(rec, 20 * scale, scale), 'burned');
    assert.eq(StreetVariants.variantAt(rec, 45 * scale, scale), null);
    assert.eq(StreetVariants.variantAt(rec, 80 * scale, scale), 'burned');
    assert.eq(JSON.stringify(StreetVariants.lineParts(rec, scale).map(p => p.variant)), '["burned",null,"burned"]');
    assert.eq(index.dressingLines.length, 2);
    assert.eq(index.dressingLines[0].line.at(-1).x, 40);
    assert.eq(index.dressingLines[1].line[0].x, 70);
  });
  test('nexus roads: road claims and hot pavement stop at coverage including end-cap overlap', () => {
    const { index, coverage } = fixture();
    const area = StreetVariants.area(index, N);
    for (let i = 0; i < coverage.length; i++) if (coverage[i]) assert.eq(area[i], 0);
    const entry = { cellsPerEdge: N, tileEdgeM: N * WorldGen.CELL_M,
      streetIndex: index, grid: new Uint8Array(N * N).fill(WorldGen.T.ROAD) };
    assert.truthy(StreetVariants.hotRoadAt(entry, 2.5, 5.5));
    assert.falsy(StreetVariants.hotRoadAt(entry, 4.01, 5.5));
    assert.truthy(StreetVariants.hotRoadAt(entry, 8.5, 5.5));
  });
  test('nexus roads: light path theme and path paving survive, nexus verge stays untouched', () => {
    const { index, rec, coverage } = fixture('path', 'lantern');
    assert.eq(StreetVariants.variantAt(rec, 45), 'lantern');
    assert.eq(index.dressingLines.length, 1);
    const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
    for (let x = 0; x < N; x++) grid[5 * N + x] = WorldGen.T.PATH;
    const ground = new Uint8Array(N * N);
    WorldGen.runSteps(StreetVariants.paintTerrainSteps({ index, grid, N, zone: { coverage }, streetGround: ground }));
    assert.eq(ground[5 * N + 5], WorldGen.T.COMMERCIAL + 1);
    assert.eq(grid[4 * N + 5], WorldGen.T.GRASS);
    assert.eq(grid[5 * N + 5], WorldGen.T.PATH);
  });
  test('nexus roads: existing theme gaps are preserved by suppression', () => {
    const { rec } = fixture();
    rec.variantRanges = [[0, 25], [60, 90]];
    assert.eq(StreetVariants.variantAt(rec, 30), null);
    assert.eq(StreetVariants.variantAt(rec, 62), null);
    assert.eq(StreetVariants.variantAt(rec, 80), 'burned');
    assert.eq(StreetVariants.variantAt(rec, 100), null);
  });
  test('nexus roads: cleanup retains path identity but removes props and slow effects', () => {
    const { coverage } = fixture('path', 'barricade'), i = 5 * N + 5;
    const streetDress = { marks: new Uint8Array(N * N), slowCells: new Set([i]),
      objects: [{ id: 'path_prop', kind: 'barrel', x: 55, y: 55 }] };
    streetDress.marks[i] = StreetVariants.VARIANT_BY_ID.barricade.code;
    WorldGen.runSteps(WorldGen.clearZoneAmbientSteps({ field: { coverage }, streetDress,
      objects: [], wildplants: [], tx: 0, ty: 0, N, tileEdgeM: extent }));
    assert.eq(streetDress.marks[i], StreetVariants.VARIANT_BY_ID.barricade.code);
    assert.eq(streetDress.objects.length, 0);
    assert.falsy(streetDress.slowCells.has(i));
  });
})();
