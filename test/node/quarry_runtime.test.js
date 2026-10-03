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
    for (const [id, finds, guards] of [['quarry-crater', 2, 0], ['quarry-abandoned', 2, 0], ['quarry-strip-mine', 0, 2], ['quarry-stronghold', 3, 3]]) {
      const a = ZoneDressing.dress(context(id)), b = ZoneDressing.dress(context(id));
      assert.eq(records(a).filter(o => o.zoneLayer === 'find').length, finds, id);
      assert.eq(a.guards.length, guards, id);
      assert.eq(JSON.stringify(records(a)), JSON.stringify(records(b)), 'stable rebuild');
      const active = records(a).filter(o => !o.coverRockId);
      assert.eq(new Set(active.map(o => `${o._ix},${o._iy}`)).size, active.length, 'unique active authored seats');
      const observer = ZoneDressing.dress(context(id, false));
      assert.eq(records(observer).filter(o => o.zoneLayer === 'find').length, 0, 'observer cannot multiply finds');
      assert.eq(observer.guards.length, 0, 'observer cannot multiply guards');
    }
  });
  test('quarry runtime: strip mine inhabitants split and respect enemy-only exclusions', () => {
    const out = ZoneDressing.dress(context('quarry-strip-mine'));
    assert.eq(out.guards.length, 2);
    for (const guard of out.guards) {
      assert.eq(guard.kind, 'split_slime');
      assert.eq(EnemyRoster.get(guard.kind).ability.type, 'split');
    }
    const ctx = context('quarry-strip-mine');
    ctx.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.SENSITIVE);
    const blocked = ZoneDressing.dress(ctx);
    assert.eq(blocked.guards.length, 0, 'enemy gate suppresses the slimes');
    assert.gt(blocked.objects.length, 0, 'ordinary bench stones remain eligible');
    for (const owned of [true, false]) {
      const clipped = context('quarry-strip-mine', owned);
      clipped.field.anchors[0].clipped = true;
      const inhabited = ZoneDressing.dress(clipped);
      assert.gt(inhabited.guards.length, 0, 'clipped sites retain sparse splitting slimes');
      for (const guard of inhabited.guards) {
        assert.eq(guard.kind, 'split_slime');
        assert.eq(guard.zoneLayer, 'background', 'clipped cells do not acquire a finite guard budget');
      }
      const movedAnchor = context('quarry-strip-mine', owned);
      movedAnchor.field.anchors[0].clipped = true;
      movedAnchor.field.anchors[0].gx += 100;
      assert.eq(JSON.stringify(ZoneDressing.dress(movedAnchor).guards), JSON.stringify(inhabited.guards), 'anchor changes cannot reroll cell identities');
      const excluded = context('quarry-strip-mine', owned);
      excluded.field.anchors[0].clipped = true;
      excluded.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.SENSITIVE);
      const blockedClipped = ZoneDressing.dress(excluded);
      assert.eq(blockedClipped.guards.length, 0, 'typed enemy gate applies to sparse inhabitants');
      assert.gt(blockedClipped.objects.length, 0, 'typed enemy exclusion still allows stones');
    }
  });
  test('quarry runtime: abandoned ground spikes visibly slow their own cells', () => {
    const out=ZoneDressing.dress(context('quarry-abandoned')), spikes=out.objects.filter(o=>o.kind==='stakes');
    assert.gt(spikes.length,0);assert.lte(spikes.length,6);
    for(const o of spikes) assert.eq(out.slowCells.get(o._iy*N+o._ix),'stakes');
  });
  test('quarry runtime: abandoned finds are fixed-loot persistent crates, not daily POIs', () => {
    const out = ZoneDressing.dress(context('quarry-abandoned'));
    const crates = out.objects.filter(o => o.zoneLayer === 'find');
    assert.eq(crates.length, 2);
    for (const crate of crates) {
      assert.eq(crate.kind, 'chest'); assert.truthy(crate.fixedLoot);
      assert.truthy(crate.quarryCrate); assert.falsy(crate.daily); assert.falsy(crate._poiAt);
    }
  });
  test('quarry runtime: crater hazards and finds respect preoccupied and protected cells', () => {
    const baseline = ZoneDressing.dress(context('quarry-crater'));
    const vents = baseline.objects.filter(o => o.kind === 'lava_vent');
    assert.truthy(vents.length >= 2);
    const ctx = context('quarry-crater');
    const occupied = vents[0]._iy * N + vents[0]._ix, restricted = vents[1]._iy * N + vents[1]._ix;
    ctx.spawnOpts.occupied.add(occupied);
    ctx.spawnOpts.spawnWhy[restricted] = WorldGen.SPAWN_WHY.RESTRICTED;
    const out = ZoneDressing.dress(ctx);
    for (const i of [occupied, restricted]) {
      assert.eq(ctx.grid[i], WorldGen.T.ROCK, 'protected terrain remains intact');
      assert.falsy(records(out).some(o => o._iy * N + o._ix === i));
    }
    for (const o of out.objects.filter(o => o.kind === 'lava_vent')) assert.eq(ctx.grid[o._iy * N + o._ix], WorldGen.T.CAVE_LAVA);
    for (const o of records(out).filter(o => o.zoneLayer === 'find')) assert.falsy(ctx.grid[o._iy * N + o._ix] === WorldGen.T.CAVE_LAVA);
  });
  test('quarry runtime: blocked foundations produce no guards or buried finds through spawn gates', () => {
    const ctx = context('quarry-stronghold');
    ctx.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    const out = ZoneDressing.dress(ctx);
    assert.eq(records(out).length, 0);
    assert.truthy(out.diagnostics[0].shortfalls.length > 0);
  });
  test('quarry runtime: Home and live objects suppress lava without changing the shared base grid', () => {
    const was = window.__TEST_MODE; window.__TEST_MODE = false;
    try {
      for (const reason of ['home', 'object', 'repaint']) {
        const ctx = context('quarry-crater'), dress = ZoneDressing.dress(ctx);
        const vent = dress.objects.find(o => o.kind === 'lava_vent'), i = vent._iy * N + vent._ix;
        const baseGrid = ctx.grid.slice();
        const entry = { grid: baseGrid, baseGrid, cellsPerEdge: N, genObjects: [], objects: [], wildplants: [], zoneDress: dress };
        if (reason === 'object') entry.objects.push({ kind: 'chest', x: vent.x, y: vent.y, id: 'player_chest' });
        if (reason === 'repaint') { entry.grid = baseGrid.slice(); entry.grid[i] = WorldGen.T.GRASS; }
        const scene = Object.assign(new SceneCreatures(), { tileEdgeM: N * C, cellM: C, save: { caught: [] },
          homeWorldPos: () => reason === 'home' ? { x: vent.x, y: vent.y } : null });
        const steps = scene.spawnInTileSteps(entry, 0, 0);
        let step;
        do { step = steps.next(); } while (!step.done && step.value !== 'spawn zone dressing');
        steps.return();
        assert.eq(baseGrid[i], WorldGen.T.CAVE_LAVA, 'shared generated terrain remains intact');
        assert.eq(entry.grid[i], reason === 'repaint' ? WorldGen.T.GRASS : WorldGen.T.ROCK, 'live terrain is safe');
        assert.falsy(entry.objects.some(o => o.id === vent.id), 'suppressed lava has no glowing marker');
      }
    } finally { window.__TEST_MODE = was; }
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
