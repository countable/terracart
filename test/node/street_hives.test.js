(function () {
  const N = 32, CELL = WorldGen.CELL_M, edge = N * CELL;
  function fixture() {
    const line = [{ x: 4 * CELL, y: 16.5 * CELL }, { x: 28 * CELL, y: 16.5 * CELL }];
    const rec = { key: 'mushroom-lane', variant: 'toadstool', size: 'minor', halfW: CELL / 2, line };
    const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
    for (let x = 4; x < 28; x++) grid[16 * N + x] = WorldGen.T.ROAD;
    return { index: { extent: edge, lines: [rec], dressingLines: [rec] }, N, tx: 2, ty: 3, tileEdgeM: edge,
      grid, objects: [], spawnOpts: { occupied: new Set(), gameplayTiers: new Uint8Array(N * N).fill(2) } };
  }
  function house(ctx, id = 'wreck', tier = WorldGen.T.BUILDING) {
    const o = WorldGen.makeObject('house', (ctx.tx * N + 10.5) * CELL, (ctx.ty * N + 18.5) * CELL, id, { tier, area: 49 });
    ctx.objects.push(o);
    ctx.grid[18 * N + 10] = tier;
    ctx.spawnOpts.occupied.add(18 * N + 10);
    return o;
  }
  test('street hives: converts a nearby ordinary wreck without changing identity or the cave snapshot', () => {
    const ctx = fixture(), original = house(ctx), out = [];
    StreetVariants.dressHives(ctx, out);
    assert.eq(out.length, 0);
    assert.eq(ctx.objects[0].hive, 'mushroom');
    assert.eq(ctx.objects[0].id, original.id);
    assert.eq(ctx.objects[0].x, original.x);
    assert.eq(original.hive, undefined, 'original substrate record stays unchanged');
  });
  test('street hives: fallback is a deterministic wreck with a reserved legal seat', () => {
    const a = fixture(), b = fixture(), left = [], right = [];
    StreetVariants.dressHives(a, left);
    StreetVariants.dressHives(b, right);
    assert.eq(left.length, 1);
    assert.eq(JSON.stringify(left), JSON.stringify(right));
    const o = left[0], ix = Math.floor(o.x / CELL) - a.tx * N, iy = Math.floor(o.y / CELL) - a.ty * N;
    assert.eq(o.kind, 'house');
    assert.eq(o.tier, WorldGen.T.BUILDING);
    assert.eq(o.hive, 'mushroom');
    assert.truthy(a.spawnOpts.occupied.has(iy * N + ix));
    assert.truthy(!WorldGen.isRoadTerrain(a.grid[iy * N + ix]));
  });
  test('street hives: excludes blocked corridors and does not convert specialty buildings', () => {
    const blocked = fixture(), out = [];
    house(blocked);
    blocked.spawnOpts.gameplayTiers.fill(4);
    StreetVariants.dressHives(blocked, out);
    assert.eq(out.length, 0);
    assert.eq(blocked.objects[0].hive, undefined);
    const special = fixture(), fort = house(special, 'fort', 11), fallback = [];
    StreetVariants.dressHives(special, fallback);
    assert.eq(fort.hive, undefined);
    assert.eq(fallback.length, 1);
  });
  test('street hives: fragments share a budget and row counts support several wrecks', () => {
    const ctx = fixture(), row = StreetVariants.VARIANT_BY_ID.toadstool.hives, count = row.count;
    const first = house(ctx, 'first');
    ctx.objects.push({ ...first, id: 'second', x: first.x + 4 * CELL });
    ctx.index.dressingLines.push({ ...ctx.index.lines[0] });
    try {
      row.count = 2;
      const out = [];
      StreetVariants.dressHives(ctx, out);
      assert.eq(out.length, 0);
      assert.eq(ctx.objects.filter(o => o.hive).length, 2);
    } finally { row.count = count; }
  });
  test('street hives: rasterized mapped wrecks convert and empty mapped lanes get a fallback', () => {
    const size = 64, extent = 4096, unit = extent / size, tx = 5, ty = 7;
    const point = (x, y) => ({ x: x * unit, y: y * unit });
    const line = [point(15, 30.5), point(45, 30.5)];
    let name;
    for (let i = 0; i < 10000; i++) {
      const candidate = `Pale Lane ${i}`;
      if (StreetVariants.variantFor(StreetVariants.streetKey(candidate, tx, ty), candidate, 'minor') === 'toadstool') { name = candidate; break; }
    }
    assert.truthy(name);
    const layers = [
      { name: 'landcover', features: [{ type: 3, tags: { class: 'meadow' }, geom: [[point(0, 0), point(64, 0), point(64, 64), point(0, 64)]] }] },
      { name: 'transportation', extent, features: [{ type: 2, tags: { class: 'minor' }, geom: [line] }] },
      { name: 'transportation_name', extent, features: [{ type: 2, tags: { name }, geom: [line] }] },
    ];
    const empty = WorldGen.rasterizeTile(layers, size, tx, ty, size * CELL);
    assert.truthy(empty.streetDress.objects.some(o => o.hive === 'mushroom' && o._hiveSynthetic));
    layers.push({ name: 'building', extent, features: [{ id: 717, type: 3, tags: {},
      geom: [[point(20, 32), point(22, 32), point(22, 34), point(20, 34), point(20, 32)]] }] });
    const built = WorldGen.rasterizeTile(layers, size, tx, ty, size * CELL);
    assert.truthy(built.objects.some(o => o.kind === 'house' && o.hive === 'mushroom'), 'real building records are eligible within the road corridor');
    assert.truthy(!built.streetDress.objects.some(o => o.hive), 'existing wreck replaces the fallback');
    assert.truthy(!built.caveSource.objects.some(o => o.hive), 'cave substrate has no converted hive');
  });
})();
