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
})();
