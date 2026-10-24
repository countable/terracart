(function () {
  const W = WorldGen, N = 16;
  const chest = (tier, i, extra = {}) => ({ kind: 'chest', id: `existing_${tier}_${i}`,
    poiClass: 'shelter', tierSeed: tier, x: -100, y: -100, ...extra });
  function context(t1 = 0, t2 = 0) {
    return { objects: [...Array.from({ length: t1 }, (_, i) => chest(1, i)),
      ...Array.from({ length: t2 }, (_, i) => chest(2, i))],
      grid: new Uint8Array(N * N).fill(W.T.GRASS), N, tx: 42, ty: 55, tileEdgeM: 112,
      streetDress: { marks: new Uint8Array(N * N).fill(StreetVariants.VARIANT_BY_ID.orchard.code) },
      spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(N * N), roadMask: new Uint8Array(N * N) } };
  }
  function run(ctx) {
    const it = W.topUpChestsSteps(ctx); let r;
    do { r = it.next(); } while (!r.done);
    return r.value;
  }
  const added = c => c.objects.filter(o => o.chestTopUp);
  const counts = c => [1, 2].map(t => c.objects.filter(o => chestTier(o) === t).length);

  test('chest top-up: both sparse tiers reach their minimums without spending quota seats', () => {
    const c = context(4, 3), r = run(c);
    assert.eq(counts(c).join(','), '18,7');
    assert.eq(r.added[1], 14); assert.eq(r.added[2], 4);
    assert.eq(r.shortfall[1] + r.shortfall[2], 0);
    const seeds = added(c).map(o => o.tierSeed).join(',');
    assert.eq(W.seedChestTiers(c.objects), 7, 'only original POIs enter the quota');
    assert.eq(added(c).map(o => o.tierSeed).join(','), seeds, 'restamping keeps top-up tiers');
    for (const o of added(c)) assert.falsy(chestMirrorsUnderground(o.poiClass));
  });

  test('chest top-up: reaching either minimum prevents top-ups', () => {
    for (const [t1, t2] of [[18, 0], [0, 7], [18, 7], [40, 20]]) {
      const c = context(t1, t2); run(c);
      assert.eq(added(c).length, 0, `${t1}/${t2}`);
    }
  });

  test('chest top-up: seeded cells survive rebuilds, object ordering and player metre frames', () => {
    const a = context(4, 3), b = context(4, 3), c = context(4, 3);
    b.objects.reverse(); c.tileEdgeM *= 2;
    run(a); run(b); run(c);
    assert.eq(JSON.stringify(added(a)), JSON.stringify(added(b)));
    assert.eq(added(a).map(o => o.id).join(','), added(c).map(o => o.id).join(','));
    assert.eq(new Set(added(a).map(o => `${o.x},${o.y}`)).size, added(a).length);
    for (let i = 0; i < added(a).length; i++) {
      assert.eq(added(c)[i].x, added(a)[i].x * 2);
      assert.eq(added(c)[i].y, added(a)[i].y * 2);
    }
    run(a); assert.eq(added(a).length, 18, 'repeat pass adds nothing');
  });

  test('chest top-up: zone variants qualify without granting the nexus tier bonus', () => {
    const c = context(); c.streetDress = null;
    const row = ZoneVariants.rows.find(v => v.zone === 'grove');
    c.zone = { coverage: new Uint16Array(N * N).fill(1), anchors: [{ kind: row.zone, variant: row.id, key: 1 }] };
    run(c);
    assert.eq(counts(c).join(','), '18,7');
    for (const o of added(c)) {
      assert.eq(o.zoneVariant, row.id); assert.falsy(o.zoneNexus);
      assert.eq(chestTier(o), o.tierSeed);
    }
  });

  test('chest top-up: no variants or no permitted cells leaves a measured shortfall', () => {
    const empty = context(); empty.streetDress = null;
    assert.eq(run(empty).shortfall[1], 18); assert.eq(added(empty).length, 0);
    const c = context();
    c.spawnOpts.gameplayTiers=new Uint8Array(N*N).fill(GameplayTiers.EXCLUDED);
    // Four eligible cells; a fifth is occupied, a sixth/seventh are Excluded
    // road/access ground, an eighth is live water, and a ninth is Excluded.
    for(let i=0;i<5;i++) c.spawnOpts.gameplayTiers[i]=GameplayTiers.CORE;
    c.spawnOpts.occupied.add(4);
    c.spawnOpts.gameplayTiers[7]=GameplayTiers.CORE;c.grid[7]=W.T.WATER;
    const r = run(c);
    assert.eq(added(c).length, 4); assert.eq(r.added[1], 2); assert.eq(r.added[2], 2);
    assert.eq(r.shortfall[1], 16); assert.eq(r.shortfall[2], 5);
    for (const o of added(c)) assert.truthy(/_([0-3])_0$/.test(o.id));
  });

  test('chest top-up: census includes dressing chests but excludes service fronts and barrels', () => {
    const c = context(0, 1);
    c.dressings = [{ objects: Array.from({ length: 25 }, (_, i) => chest(1, i)) }];
    run(c); assert.eq(added(c).length, 0, 'dressing chests meet the minimum');
    const d = context();
    d.objects.push(...Array.from({ length: 30 }, (_, i) => chest(1, i, { poiClass: 'school' })),
      ...Array.from({ length: 20 }, (_, i) => chest(2, i, { barrel: true })));
    const r = run(d); assert.eq(r.before[1] + r.before[2], 0);
    assert.eq(added(d).length, 25);
  });

  test('chest top-up: snare-area additions keep their ordinary surface tiers and loot mix', () => {
    const c = context(); c.streetDress.marks.fill(StreetVariants.VARIANT_BY_ID.snare.code);
    run(c);
    for (const o of added(c)) {
      assert.eq(chestTier(o), o.tierSeed); assert.eq(chestLootDepth(o), 0);
    }
  });
  test('ambient crates: a sparse tile fills to its POI target with one-time tier-1 crates', () => {
    const big = 240, Q = W.LOW_TIER_CHEST_QUOTA;
    assert.eq(Q, 200);
    const ctx = (t1) => ({ objects: Array.from({ length: t1 }, (_, i) => chest(1, i)),
      grid: new Uint8Array(big * big).fill(W.T.GRASS), N: big, tx: 3, ty: 9, tileEdgeM: big * W.CELL_M,
      spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(big * big), roadMask: new Uint8Array(big * big) } });
    const go = (c) => { const it = W.topUpAmbientCratesSteps(c); let r; do { r = it.next(); } while (!r.done); return r.value; };
    const c = ctx(50), r = go(c), crates = c.objects.filter(o => o.ambientCrate);
    assert.eq(r.before, 50); assert.eq(r.deficit, Q - 50); assert.eq(crates.length, Q - 50);
    for (const o of crates) {
      assert.truthy(o.crate && chestTier(o) === 1, 'a tier-1 crate');
      assert.falsy(restocks(o), 'opened once');
      assert.truthy(/^crate_ambient_3_9_/.test(o.id));
    }
    assert.eq(new Set(crates.map(o => o.id)).size, crates.length, 'one per cell');
    assert.eq(go(c).added, 0, 'a repeat pass counts its own crates and adds nothing');
    const d = ctx(50); d.objects.reverse(); go(d);
    assert.eq(d.objects.filter(o => o.ambientCrate).map(o => o.id).join(), crates.map(o => o.id).join(), 'stable seats');
    const full = ctx(Q); assert.eq(go(full).added, 0, 'at quota: nothing');
    const blocked = ctx(0); blocked.spawnOpts.spawnWhy.fill(W.SPAWN_WHY.RESTRICTED);
    assert.eq(go(blocked).added, 0, 'only spawnable ground');
    assert.eq(go(ctx(0)).deficit, Q, 'the deficit is kept for the X-mark top-up');
  });
  function ambientContext() {
    const N = 240;
    return { objects: [], grid: new Uint8Array(N * N).fill(W.T.GRASS), N,
      tx: 5, ty: 2, tileEdgeM: N * 7,
      spawnOpts: { occupied: new Set(), spawnWhy: new Uint32Array(N * N), roadMask: new Uint8Array(N * N) } };
  }
  function ambientRun(c) {
    const it = W.topUpAmbientCratesSteps(c); let r;
    do { r = it.next(); } while (!r.done);
    return r.value;
  }
  test('ambient crates: target scales with reward-spawnable area, not occupancy', () => {
    const c = ambientContext(), size = c.N * c.N;
    c.grid.fill(W.T.WATER, 0, size / 4);
    c.spawnOpts.roadMask.fill(1, size / 4, size / 2);
    const r = ambientRun(c);
    assert.eq(r.spawnableCells, size / 2);
    assert.eq(r.target, 100); assert.eq(r.threshold, 125); assert.eq(r.added, 100);
    for (const o of c.objects) assert.gte(Math.floor(o.y / 7) % c.N, c.N / 2);
    const repeat = ambientRun(c);
    assert.eq(repeat.target, 100); assert.eq(repeat.added, 0);
    for (const block of ['water', 'restricted', 'excluded']) {
      const d = ambientContext();
      if (block === 'water') d.grid.fill(W.T.WATER);
      else if(block==='excluded') d.spawnOpts.gameplayTiers=new Uint8Array(d.N*d.N).fill(GameplayTiers.EXCLUDED);
      else d.spawnOpts.spawnWhy.fill(W.SPAWN_WHY.RESTRICTED);
      const empty = ambientRun(d);
      assert.eq(empty.target, 0); assert.eq(empty.deficit, 0); assert.eq(empty.added, 0);
    }
  });
  test('ambient crates: compact viewer tiles get proportional fill independent of metre frame', () => {
    const make = (N, tileEdgeM = N * W.CELL_M) => ({ objects: [],
      grid: new Uint8Array(N * N).fill(W.T.GRASS), N, tx: 0, ty: 0, tileEdgeM,
      spawnOpts: { occupied: new Set(), spawnWhy: new Uint32Array(N * N), roadMask: new Uint8Array(N * N) } });
    const small = make(FloorViewerRegion.N), large = make(FloorViewerRegion.N * 2);
    const a = ambientRun(small), b = ambientRun(large);
    assert.eq(a.target, 12, '420 m square gets 12 crates, not 200');
    assert.eq(a.added, 12);
    assert.eq(b.target, 50, 'doubling the edge quadruples area before rounding');
    const reframed = make(FloorViewerRegion.N, FloorViewerRegion.EDGE * 2);
    assert.eq(ambientRun(reframed).added, a.added, 'player coordinate frame cannot alter density');
    assert.eq(reframed.objects.map(o => o.id).join(), small.objects.map(o => o.id).join());
    small.grid.fill(W.T.WATER, 0, small.grid.length / 2);
    assert.eq(ambientRun(small).target, 6, 'excluded land still reduces the target');
    assert.eq(ambientRun(make(7)).added, 0, 'tiny patches do not force a crate');
  });
  test('ambient crates: every POI type and tier counts, including services', () => {
    for (const count of [50, 200, 249, 250, 300]) {
      const c = ambientContext();
      c.objects = Array.from({ length: count }, (_, i) => chest(3, i, { poiClass: i % 2 ? 'school' : 'atm' }));
      c.dressings = [{ objects: c.objects.slice() }];
      const r = ambientRun(c);
      assert.eq(r.before, count, 'do not double count shared objects');
      assert.eq(r.added, Math.max(0, 200 - count));
    }
    const c = ambientContext(); c.grid.fill(W.T.WATER, 0, c.grid.length / 2);
    c.objects = Array.from({ length: 126 }, (_, i) => chest(3, i));
    assert.eq(ambientRun(c).added, 0, 'above the scaled threshold');
  });
  test('ambient crates: loot follows underlying landcover and stays surface-only', () => {
    for (const [terrain, theme] of [[W.T.GRASS, 'park'], [W.T.FOREST, 'park'],
      [W.T.ORCHARD, 'farm'], [W.T.FARMLAND, 'farm'], [W.T.COMMERCIAL, 'commerce'],
      [W.T.SCHOOL, 'school'], [W.T.ROCK, 'roadside']]) {
      const c = ambientContext();
      c.landcoverGrid = new Uint8Array(c.grid.length).fill(terrain);
      ambientRun(c);
      assert.eq(c.objects.length, 200);
      for (const o of c.objects) {
        assert.eq(chestThemeFor(o), theme);
        assert.eq(chestTier(o), 1); assert.falsy(restocks(o));
        assert.falsy(chestLook(o).macro); assert.falsy(chestLook(o).stand);
      }
      W.seedChestTiers(c.objects);
      assert.truthy(c.objects.every(o => o.tierSeed === 1), 'restamping preserves filler tiers');
    }
  });
  test('ambient crates: the X-mark top-up reads the deficit, off the cell hash, never the rng stream', () => {
    const src = SCENE_CREATURES_SRC;
    assert.truthy(/entry\.lowTierDeficit = chestTopUp\?\.ambient\?\.deficit/.test(WORLDGEN_SRC), 'stored on the entry');
    assert.truthy(/X_TOP_UP_MAX \* X_MARK_FREQUENCY\s*\*\s*Math\.min\(1, \(entry\.lowTierDeficit \|\| 0\) \/ WorldGen\.LOW_TIER_CHEST_QUOTA\)/.test(src), 'in proportion to the shortfall');
    assert.truthy(/WorldGen\.cellHash\(tx, ty, k, 0x7a0b\)/.test(src), 'hash-drawn cells');
  });
})();
