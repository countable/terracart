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
    c.spawnOpts.spawnWhy.fill(W.SPAWN_WHY.PRIVATE);
    // Four eligible cells: a fifth is occupied, a sixth under the road,
    // a seventh in its kerb, an eighth water, and a ninth sensitive.
    for (let i = 0; i < 9; i++) c.spawnOpts.spawnWhy[i] = 0;
    c.spawnOpts.occupied.add(4); c.spawnOpts.roadMask[5] = 1;
    c.spawnOpts.spawnWhy[6] = W.SPAWN_WHY.KERB;
    c.grid[7] = W.T.WATER; c.spawnOpts.spawnWhy[8] = W.SPAWN_WHY.SENSITIVE;
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
  test('ambient crates: a tile under the low-tier quota fills to it with one-time tier-1 crates', () => {
    const big = 24, Q = W.LOW_TIER_CHEST_QUOTA;
    assert.eq(Q, 200);
    const ctx = (t1) => ({ objects: Array.from({ length: t1 }, (_, i) => chest(1, i)),
      grid: new Uint8Array(big * big).fill(W.T.GRASS), N: big, tx: 3, ty: 9, tileEdgeM: 168,
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
  test('ambient crates: in a low-POI tile they lie thicker along the walking paths', () => {
    const N = 120, R = W.AMBIENT_CRATE_PATH_CELLS;
    assert.eq(W.AMBIENT_CRATE_PATH_BIAS, 4);
    const grid = new Uint8Array(N * N).fill(W.T.GRASS);
    for (const col of [20, 60, 100]) for (let y = 0; y < N; y++) grid[y * N + col] = W.T.PATH;
    const c = { objects: [], grid, N, tx: 5, ty: 2, tileEdgeM: N * 7,
      spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(N * N), roadMask: new Uint8Array(N * N) } };
    const it = W.topUpAmbientCratesSteps(c); let r; do { r = it.next(); } while (!r.done);
    const crates = c.objects.filter(o => o.ambientCrate);
    assert.eq(crates.length, W.LOW_TIER_CHEST_QUOTA, 'the count is the quota, unchanged');
    const near = crates.filter(o => {
      const ix = Math.floor(o.x / 7) % N;
      return [20, 60, 100].some(col => Math.abs(ix - col) <= R);
    }).length;
    const share = 3 * (2 * R + 1) / N;   // the path band's share of the ground
    assert.gt(near / crates.length, share * 2.5, `crates favour the path band (${near}/${crates.length}, ground share ${share.toFixed(2)})`);
  });
  test('ambient crates: the X-mark top-up reads the deficit, off the cell hash, never the rng stream', () => {
    const src = SCENE_CREATURES_SRC;
    assert.truthy(/entry\.lowTierDeficit = chestTopUp\?\.ambient\?\.deficit/.test(WORLDGEN_SRC), 'stored on the entry');
    assert.truthy(/X_TOP_UP_MAX\s*\*\s*Math\.min\(1, \(entry\.lowTierDeficit \|\| 0\) \/ WorldGen\.LOW_TIER_CHEST_QUOTA\)/.test(src), 'in proportion to the shortfall');
    assert.truthy(/WorldGen\.cellHash\(tx, ty, k, 0x7a0b\)/.test(src), 'hash-drawn cells');
  });
})();
