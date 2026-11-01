// Exercise the shipping shared row evaluator, including indices above 255.
(function () {
  const W = WorldGen, T = W.T, N = 300, edge = N * 7, tx = 3, ty = 4;
  function fixture(type = T.GRASS) {
    const grid = new Uint8Array(N * N).fill(type);
    return { entry: { grid, cellsPerEdge: N }, grid, N, tx, ty, tileEdgeM: edge,
      spawnOpts: { occupied: new Set(), gameplayTiers: new Uint8Array(N * N).fill(GameplayTiers.CORE) } };
  }
  const run = c => W.runSteps(W.surfaceTreasureSteps(c));
  const cell = t => ({ x: Math.round((t.x - tx * edge) / 7 - .5), y: Math.round((t.y - ty * edge) / 7 - .5) });
  const sand = c => { for (let y = 0; y < N; y++) for (let x = 0; x < 6; x++) c.grid[y * N + x] = T.SAND; return c; };
  test('buried rows: sand finds use sand cells and stable cell IDs', () => {
    const c = sand(fixture()), marks = run(c).filter(t => t.id.startsWith('treasure_sand_'));
    assert.gt(marks.length, 0);
    for (const t of marks) { const { x, y } = cell(t); assert.eq(c.grid[y * N + x], T.SAND); assert.eq(t.id, `treasure_sand_${tx}_${ty}_${x}_${y}`); }
    assert.eq(run(fixture()).filter(t => t.id.startsWith('treasure_sand_')).length, 0);
  });
  test('buried rows: removing eligible area removes finds without refilling', () => {
    const a = sand(fixture()), full = run(a), b = sand(fixture());
    b.spawnOpts.gameplayTiers.fill(GameplayTiers.EXCLUDED, 0, N * N / 2);
    const half = run(b);
    assert.gt(half.length, 0); assert.lt(half.length, full.length);
    assert.truthy(half.every(t => full.some(f => f.id === t.id)));
    assert.eq(new Set(full.map(t => { const c = cell(t); return c.y * N + c.x; })).size, full.length, 'rows cannot stack finds');
  });
  test('buried rows: builds and row order preserve random choices', () => {
    const c = sand(fixture()), a = run(c).map(t => t.id).join();
    assert.eq(run(c).map(t => t.id).join(), a);
    const rows = W.SURFACE_INTERACTABLE_ROWS['Terrain:SAND'];
    const before = rows.map(r => [r.id, W.interactableRoll(c.entry, 100, r, tx, ty, N)]);
    rows.reverse();
    try {
      for (const [id, result] of before) assert.eq(W.interactableRoll(c.entry, 100, rows.find(r => r.id === id), tx, ty, N), result);
      assert.eq(run(c).map(t => t.id).join(), a, 'row declaration order cannot change collision winners');
    }
    finally { rows.reverse(); }
  });
  test('buried rows: path finds decode cells beyond 256 beside the same path', () => {
    const c = fixture();
    for (let x = 10; x < N - 10; x += 6) for (let y = 260; y < N; y++) c.grid[y * N + x] = T.PATH;
    const marks = run(c).filter(t => t.id.startsWith('treasure_path_')); assert.gt(marks.length, 0);
    for (const t of marks) { const { x, y } = cell(t); assert.gte(y, 259); assert.truthy(c.grid[y * N + x] !== T.PATH);
      assert.truthy((x > 0 && c.grid[y * N + x - 1] === T.PATH) || (x + 1 < N && c.grid[y * N + x + 1] === T.PATH) || (y > 0 && c.grid[(y - 1) * N + x] === T.PATH) || (y + 1 < N && c.grid[(y + 1) * N + x] === T.PATH)); }
  });
  test('buried rows: Nexus and road-owned sand have no underlying sand finds', () => {
    for (const kind of ['zone', 'road']) {
      const c = fixture(T.SAND);
      if (kind === 'zone') c.entry.zone = { coverage: new Uint16Array(N * N).fill(1), anchors: [{ kind: 'grove', variant: 'meadow', key: 1 }] };
      else { c.entry.streetArea = new Uint8Array(N * N).fill(1); c.entry.streetAreaVariants = new Uint8Array(N * N).fill(StreetVariants.VARIANT_BY_ID.parkpath.code); }
      assert.eq(run(c).length, 0, kind + ' has no fallback');
    }
  });
  test('buried rows: ordinary sand scatter excludes the shoreline length-selector cells', () => {
    const c = sand(fixture()); c.entry.scenic = { shore: { mask: new Uint8Array(N * N) } };
    for (let y = 0; y < N; y++) for (let x = 0; x < 6; x++) c.entry.scenic.shore.mask[y * N + x] = 1;
    assert.eq(run(c).filter(t => t.id.startsWith('treasure_sand_')).length, 0);
  });
  test('buried rows: front-yard finds require street frontage and preserve IDs', () => {
    const c = fixture(T.RESIDENTIAL); assert.eq(run(c).filter(t => t.id.startsWith('treasure_yard_')).length, 0);
    for (let x = 10; x < N; x += 10) for (let y = 0; y < N; y++) c.grid[y * N + x] = T.PATH;
    const a = run(c).filter(t => t.id.startsWith('treasure_yard_')); assert.gt(a.length, 0);
    assert.eq(a.map(t => t.id).join(), run(c).filter(t => t.id.startsWith('treasure_yard_')).map(t => t.id).join());
    for (const t of a) { const { x, y } = cell(t); assert.eq(c.grid[y * N + x], T.RESIDENTIAL); assert.truthy(c.grid[y * N + x - 1] === T.PATH || c.grid[y * N + x + 1] === T.PATH); }
  });
})();
