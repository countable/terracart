(() => {
  const N = 48, C = WorldGen.CELL_M;
  function context(id, owned = true) {
    const gx = 24.5 * 4096 / N;
    const anchor = { kind: 'quarry', variant: id, generated: 'parking_lanes', owned,
      gx, gy: gx, lx: gx, ly: gx, key: 18, upm: N * C / 4096, R: 21 };
    const coverage = new Uint16Array(N * N);
    for (let y = 3; y < N - 3; y++) for (let x = 3; x < N - 3; x++) coverage[y * N + x] = 1;
    return { N, tx: 0, ty: 0, tileEdgeM: N * C, grid: new Uint8Array(N * N).fill(WorldGen.T.ROCK),
      field: { anchors: [anchor], coverage }, chests: [],
      spawnOpts: { occupied: new Set(), quiet: new Uint8Array(N * N), spawnWhy: new Uint16Array(N * N), roadMask: new Uint8Array(N * N) } };
  }
  const records = out => [...out.objects, ...out.guards, ...(out.treasures || [])];
  test('quarry runtime: generated plain rocks receive each quarry signature', () => {
    for (const zone of ['quarry-strip-mine', 'quarry-crater', 'quarry-abandoned']) {
      const out = ZoneDressing.dress(context(zone));
      const plain = out.objects.filter(o => o.kind === 'mineralrock' && mineralRockMaterial(o) === 'plain');
      assert.gt(plain.length, 0, zone);
      for (const rock of plain) assert.eq(mineralRockArtFrame(rock), ZONE_ROCK_THEMES[zone].frame);
    }
  });
  test('quarry runtime: stronghold walls preserve fitted frames and never replace global stone', () => {
    const ctx = context('quarry-stronghold'), out = ZoneDressing.dress(ctx);
    const walls = out.objects.filter(o => o.kind === 'stronghold_wall');
    assert.gt(walls.length, 0);
    const background = new Set(out.objects.filter(o => o.zoneLayer === 'background' && ['stone','stronghold_wall'].includes(o.kind)).map(o => o._iy*N+o._ix));
    for (const wall of walls) {
      assert.eq(wall.variant, QuarryLayout.wallFrameAt(background, wall._iy*N+wall._ix, N));
      assert.eq(wall.zoneVariant, 'quarry-stronghold');
      assert.inRange(wall.variant, 0, 14);
    }
    assert.truthy(walls.some(o => o.variant >= 11), 'broken wall ends use finished caps');
    for (const id of ['quarry-abandoned', 'quarry-strip-mine', 'quarry-crater']) {
      assert.falsy(ZoneDressing.dress(context(id)).objects.some(o => o.kind === 'stronghold_wall'), id);
    }
    const blocked = context('quarry-stronghold'), wall = walls[0], i = wall._iy*N+wall._ix;
    blocked.spawnOpts.spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
    const rerun = ZoneDressing.dress(blocked);
    assert.falsy(records(rerun).some(o => o._iy*N+o._ix === i), 'partial fitting retains the authoritative spawn gate');
    const tide = context('quarry-stronghold');
    tide.tideSeats = new Set([i]);
    const tidal = ZoneDressing.dress(tide);
    assert.falsy(records(tidal).some(o => o._iy*N+o._ix === i), 'reserved tide seats cannot acquire walls');
    const tidalBackground = new Set(tidal.objects.filter(o => o.zoneLayer === 'background' && ['stone','stronghold_wall'].includes(o.kind)).map(o => o._iy*N+o._ix));
    for (const o of tidal.objects.filter(o => o.kind === 'stronghold_wall')) {
      assert.eq(o.variant, QuarryLayout.wallFrameAt(tidalBackground, o._iy*N+o._ix, N), 'joins follow final placed neighbours');
    }
  });
  test('quarry runtime: all four compositions ship their finite site budgets and stable identities', () => {
    for (const [id, finds] of [['quarry-crater', 2], ['quarry-abandoned', 0], ['quarry-strip-mine', 0], ['quarry-stronghold', 3]]) {
      const a = ZoneDressing.dress(context(id)), b = ZoneDressing.dress(context(id));
      assert.eq(records(a).filter(o => o.zoneLayer === 'find').length, finds, id);
      assert.eq(a.guards.length, 0, id);
      assert.eq(JSON.stringify(records(a)), JSON.stringify(records(b)), 'stable rebuild');
      const active = records(a).filter(o => !o.coverRockId);
      assert.eq(new Set(active.map(o => `${o._ix},${o._iy}`)).size, active.length, 'unique active authored seats');
      const observer = ZoneDressing.dress(context(id, false));
      assert.eq(records(observer).filter(o => o.zoneLayer === 'find').length, 0, 'observer cannot multiply finds');
      assert.eq(observer.guards.length, 0, 'observer cannot multiply guards');
    }
  });
  test('quarry runtime: every quarry is peaceful (no enemies, lava, spikes or traps)', () => {
    for (const row of ZoneVariants.forKind('quarry')) for (const clipped of [false, true]) {
      const ctx = context(row.id);
      ctx.field.anchors[0].clipped = clipped;
      const out = ZoneDressing.dress(ctx);
      assert.eq(out.guards.length, 0, `${row.id}: no guards or inhabitants`);
      assert.eq((out.traps || []).length, 0, `${row.id}: no traps`);
      assert.falsy(out.objects.some(o => ['stakes', 'lava_vent'].includes(o.kind) || o.zoneLayer === 'hazard'), `${row.id}: no hazards`);
      assert.falsy(ctx.grid.includes(WorldGen.T.CAVE_LAVA), `${row.id}: no surface lava`);
      assert.eq(out.slowCells?.size || 0, 0, `${row.id}: nothing slows the player`);
    }
  });
  test('quarry runtime: quarries never generate fixed pickaxe rewards', () => {
    for (const row of ZoneVariants.forKind('quarry')) {
      const out = ZoneDressing.dress(context(row.id));
      assert.falsy(out.objects.some(o => o.fixedLoot?.slot === 'pickaxe'), row.id);
      assert.falsy(out.objects.some(o => o.quarryCrate), row.id);
    }
  });
  test('quarry runtime: blocked foundations produce no guards or buried finds through spawn gates', () => {
    const ctx = context('quarry-stronghold');
    ctx.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    const out = ZoneDressing.dress(ctx);
    assert.eq(records(out).length, 0);
    assert.truthy(out.diagnostics[0].shortfalls.length > 0);
  });
  test('quarry runtime: stronghold chests reach the live scene exactly once', () => {
    const was = window.__TEST_MODE; window.__TEST_MODE = false;
    try {
      const ctx = context('quarry-stronghold'), dress = ZoneDressing.dress(ctx);
      const entry = { grid: ctx.grid, baseGrid: ctx.grid.slice(), cellsPerEdge: N, genObjects: [], objects: [], wildplants: [], zoneDress: dress, depth: 0 };
      const scene = Object.assign(new SceneCreatures(), { tileEdgeM: N * C, cellM: C, save: { caught: [] },
        _pestFreeZone: () => null, _starterTrailAnchor: () => null,
        _provisionStarterHome() {}, _carveStarterPond() {} });
      scene.spawnInTile(entry, 0, 0);
      const actual = entry.objects.filter(o => o.zoneVariant === 'quarry-stronghold' && o.zoneLayer === 'find');
      assert.eq(actual.length, 3);
      for (const o of actual) assert.eq(chestTier(o), 2);
      assert.eq(new Set(actual.map(o => o.id)).size, 3);
      assert.eq(actual.map(o => o.id).join(','), dress.objects.filter(o=>o.zoneLayer==='find').map(o => o.id).join(','));
    } finally { window.__TEST_MODE = was; }
  });
})();
