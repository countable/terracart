// Declarative dressing tests exercise the real shared spawn gate and records.
(function () {
  function context(id, changes) {
    const v = ZoneVariants.byId(id), N = 64, c = 32;
    const a = { kind: v.zone, gx: (c + 0.5) * 4096 / N, gy: (c + 0.5) * 4096 / N,
      lx: (c + 0.5) * 4096 / N, ly: (c + 0.5) * 4096 / N, upm: N * WorldGen.CELL_M / 4096,
      R: 140, owned: true, key: 112, variant: id, rotation: 0 };
    const coverage = new Uint16Array(N * N).fill(1), grid = new Uint8Array(N * N).fill(WorldGen.T.PARK);
    const ctx = { N, tx: 0, ty: 0, tileEdgeM: N * WorldGen.CELL_M, grid,
      field: { anchors: [a], coverage, idx: new Uint8Array(N * N), under: new Uint8Array(N * N) },
      chests: [], spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(N * N), roadMask: new Uint8Array(N * N), roadClass: new Uint8Array(N * N) } };
    return Object.assign(ctx, changes);
  }
  const all = out => [...out.objects, ...out.wildplants, ...out.traps, ...out.guards];
  const finds = out => all(out).filter(o => o.zoneLayer === 'find');
  test('zone dressing: all variants keep finite counts, tool tiers, uniqueness and rebuild identities', () => {
    for (const row of ZoneVariants.rows) {
      const a = ZoneDressing.dress(context(row.id)), b = ZoneDressing.dress(context(row.id));
      assert.eq(finds(a).length, row.finds.count, row.id);
      assert.eq(a.guards.length, row.guards.count || 0, row.id);
      assert.eq(new Set(all(a).map(o => `${o.x},${o.y}`)).size, all(a).length, `${row.id}: unique cells`);
      assert.eq(JSON.stringify(all(a)), JSON.stringify(all(b)), `${row.id}: stable rebuild`);
      const m = ZoneVariants.materials[row.finds.material];
      for (const find of finds(a)) if (m.kind === 'mineralrock') {
        assert.eq(find.requiredTier, m.requiredTier); assert.eq(find.yieldTier, m.yieldTier);
      }
    }
  });
  test('zone dressing: buffered anchors cannot mint another finite reward or guard', () => {
    for (const id of ['black_ring', 'ancient_grove', 'seep']) {
      const ctx = context(id); ctx.field.anchors[0].owned = false;
      const out = ZoneDressing.dress(ctx);
      assert.eq(finds(out).length, 0); assert.eq(out.guards.length, 0);
      assert.gt(all(out).length, 0, 'neighbour still draws background');
    }
  });
  test('zone dressing: union fallback finds eligible ground and reports exhausted budgets', () => {
    const ctx = context('black_ring'), N = ctx.N;
    ctx.field.coverage.fill(0);
    ctx.field.coverage[10 * N + 10] = 1;
    ctx.field.coverage[10 * N + 11] = 1;
    const out = ZoneDressing.dress(ctx);
    assert.eq(finds(out).length, 2, 'fringe-only coverage supports both finds');
    const blocked = context('black_ring'); blocked.grid.fill(WorldGen.T.BUILDING);
    const empty = ZoneDressing.dress(blocked);
    assert.eq(all(empty).length, 0);
    assert.eq(empty.diagnostics[0].shortfalls.length, 2);
  });
  test('zone dressing: roads, existing occupancy and sensitive ghost ground stay excluded', () => {
    const ctx = context('ordered_graves'), N = ctx.N;
    for (let x = 0; x < N; x++) ctx.spawnOpts.roadMask[20 * N + x] = 1;
    for (let y = 0; y < N; y++) ctx.spawnOpts.occupied.add(y * N + 22);
    const out = ZoneDressing.dress(ctx);
    for (const o of all(out)) { assert.falsy(o._iy === 20); assert.falsy(o._ix === 22); }
    const sensitive = context('ordered_graves');
    sensitive.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.SENSITIVE);
    const fallback = ZoneDressing.dress(sensitive);
    assert.eq(fallback.objects.filter(o => o.kind === 'headstone').length, 0);
    assert.gt(fallback.objects.filter(o => o.kind === 'mineralrock').length, 0, 'safe stone replaces refused graves');
  });
  test('zone dressing: surface traps obey the existing trap-ground predicate', () => {
    const ctx = context('broken_depot'), N = ctx.N;
    for (let x = 0; x < N; x++) ctx.grid[30 * N + x] = WorldGen.T.PATH;
    const out = ZoneDressing.dress(ctx);
    assert.gt(out.traps.length, 0);
    for (const trap of out.traps) assert.truthy(Traps.isTrapGround(ctx.grid, ctx.spawnOpts.roadClass, N, N, trap._ix, trap._iy, ctx.field.under, ctx.spawnOpts.roadMask));
    const noGround = context('broken_depot'); noGround.grid.fill(WorldGen.T.GRASS);
    assert.eq(ZoneDressing.dress(noGround).traps.length, 0);
  });
  test('zone dressing: work-yard copper lines remain continuous and POI slots touch the chest', () => {
    const ctx = context('work_yard'), out = ZoneDressing.dress(ctx), origin = 32;
    const background = new Map(all(out).filter(o => o.zoneLayer === 'background').map(o => [`${o._ix},${o._iy}`, o]));
    // First boundary of the fixed 31 x 31 figure sits 15 cells from its origin.
    for (let x = origin - 15; x <= origin + 15; x++) {
      const o = background.get(`${x},${origin - 15}`);
      assert.truthy(o, `unbroken copper line ${x}`); assert.eq(o.yieldTier, 2);
    }
    for (const o of all(out).filter(o => o.zoneLayer === 'poi')) assert.eq(Math.max(Math.abs(o._ix - origin), Math.abs(o._iy - origin)), 1);
    const chestCtx = context('meadow'), a = chestCtx.field.anchors[0], cell = WorldGen.CELL_M;
    chestCtx.chests.push({ kind: 'chest', id: 'church', _poiAt: `${a.lx},${a.ly}`, x: 35.5 * cell, y: 33.5 * cell });
    chestCtx.spawnOpts.occupied.add(33 * chestCtx.N + 35);
    const chestOut = ZoneDressing.dress(chestCtx);
    assert.eq(chestCtx.chests[0].zoneNexus, 'grove');
    assert.eq(chestOut.objects.filter(o => o.kind === 'grove_shrine').length, 1);
    for (const o of all(chestOut).filter(o => o.zoneLayer === 'poi')) assert.eq(Math.max(Math.abs(o._ix - 35), Math.abs(o._iy - 33)), 1);
  });
  test('zone dressing: different tile-row grids sample the same anchor phase across their seam', () => {
    const owner = context('ancient_grove'), a = owner.field.anchors[0];
    a.gy = a.ly = 4090; a.rotation = 1;
    const neighbour = context('ancient_grove');
    neighbour.N = 63; neighbour.ty = 1; neighbour.tileEdgeM = 63 * WorldGen.CELL_M;
    neighbour.field.anchors = [{ ...a, owned: false, ly: a.ly - 4096 }];
    neighbour.field.coverage = new Uint16Array(63 * 63).fill(1);
    neighbour.grid = new Uint8Array(63 * 63).fill(WorldGen.T.PARK);
    neighbour.spawnOpts = { occupied: new Set(), spawnWhy: new Uint16Array(63 * 63) };
    const unit = 4096 / 64, originX = (Math.floor(a.gx / unit) + 0.5) * unit;
    const originY = (Math.floor(a.gy / unit) + 0.5) * unit, v = ZoneVariants.byId(a.variant), p = ZoneVariants.poiOrigin(v);
    for (const ctx of [owner, neighbour]) {
      const out = ZoneDressing.dress(ctx);
      const background = all(out).filter(o => o.zoneLayer === 'background');
      assert.gt(background.length, 0);
      for (const o of background) {
        const dx = Math.round(((o._ix + 0.5) * 4096 / ctx.N - originX) / unit);
        const dy = Math.round((ctx.ty * 4096 + (o._iy + 0.5) * 4096 / ctx.N - originY) / unit);
        const [u, w] = ZoneVariants.inverseRotate(dx, dy, a.rotation);
        const material = ZoneVariants.materials[ZoneVariants.sample(v, u + p[0], w + p[1], a.key)];
        assert.truthy(material); assert.eq(o.kind, material.kind); if (material.crop) assert.eq(o.crop, material.crop);
      }
    }
  });
  test('zone dressing: sliced passes yield coverage, patterns and blocked-find searches', () => {
    const ctx = context('seep'); ctx.grid.fill(WorldGen.T.BUILDING);
    const labels = [], it = ZoneDressing.dressSteps(ctx); let r;
    do { r = it.next(); if (!r.done) labels.push(r.value); } while (!r.done);
    assert.includes(labels, 'zone variant coverage'); assert.includes(labels, 'zone variant pattern rows'); assert.includes(labels, 'zone find fallback');
  });
})();
