// THE TIER QUOTA PYRAMID (Oct 2026).
//
// seedChestTiers replaces the count-threshold ladder for GENERATED chests:
// each tile seeds ~1 T5, 5 T4, 11 T3, 18 T2 (x1..x2 as the budgeted count
// runs 100..1000), picking the best POIs first (the MVT rank tag), spreading
// each tier's seats round-robin across chest categories. Vista chests stand
// outside; a nexus chest can win a tier but never spends a seat; sparse tiles
// fill from the top and leave lower quotas empty. The ladder stays only as
// the fallback for chests that never see a seeding pass.
(function () {
  
  const mk = (i, cat, rank, extra = {}) => ({   // surface: no depth, no caveOf
    kind: 'chest', poiClass: cat === 'roadside' ? 'bus' : cat === 'food' ? 'cafe' : cat === 'civic' ? 'town_hall' : 'park',
    poiDensity: 1, x: i, y: 0, id: `q${i}`, rank, ...extra,
  });

  test('quota: base pyramid on an ordinary tile', () => {
    const objs = [];
    for (let i = 0; i < 90; i++) objs.push(mk(i, ['roadside', 'food', 'civic'][i % 3], (i % 30) + 1));
    WorldGen.seedChestTiers(objs);
    const n = (t) => objs.filter(o => o.tierSeed === t).length;
    assert.eq(n(5), 1, 'one T5');
    assert.eq(n(4), 5, 'five T4');
    assert.eq(n(3), 11, 'eleven T3');
    assert.eq(n(2), 18, 'eighteen T2');
    assert.eq(n(1), 55, 'the rest T1');
  });

  test('quota: dense tiles scale toward double, capped at 1000 POIs', () => {
    const build = (count) => {
      const objs = [];
      for (let i = 0; i < count; i++) objs.push(mk(i, ['roadside', 'food', 'civic', 'park'][i % 4], (i % 40) + 1));
      WorldGen.seedChestTiers(objs);
      return objs.filter(o => o.tierSeed === 4).length;
    };
    const t4 = (n) => Math.round(5 * (1 + Math.max(0, Math.min(1, (n - 100) / 900))));
    assert.eq(build(100), t4(100), 'at 100 POIs the base quotas');
    assert.eq(build(550), t4(550), 'halfway scaled');
    assert.eq(build(1000), 10, 'double at 1000');
    assert.eq(build(2000), 10, 'and never more than double');
  });

  test('quota: a sparse tile fills from the top and leaves gaps', () => {
    const objs = [];
    for (let i = 0; i < 10; i++) objs.push(mk(i, ['roadside', 'food'][i % 2], i + 1));
    WorldGen.seedChestTiers(objs);
    const n = (t) => objs.filter(o => o.tierSeed === t).length;
    assert.eq(n(5), 1, 'the T5 is filled first');
    assert.eq(n(4), 5, 'then every T4 seat');
    assert.eq(n(3), 4, 'the four leftovers land T3');
    assert.eq(n(2), 0, 'no T2: the quota gaps');
    assert.eq(n(1), 0, 'and nothing demotes to T1');
  });

  test('quota: the best-ranked POIs take the highest tiers', () => {
    const objs = [];
    for (let i = 0; i < 30; i++) objs.push(mk(i, 'civic', 30 - i));   // rank asc == id desc
    WorldGen.seedChestTiers(objs);
    const t5 = objs.find(o => o.tierSeed === 5);
    assert.eq(t5.id, 'q29', 'rank 1 (the best) takes the T5');
    const t4s = objs.filter(o => o.tierSeed === 4).map(o => Number(o.id.slice(1))).sort((a, b) => b - a);
    assert.eq(t4s.join(','), '28,27,26,25,24', 'then the next best take the T4 seats');
    // Missing rank sorts last: an unranked chest never beats a ranked one.
    const mixed = [mk(0, 'civic', undefined), mk(1, 'civic', 12), mk(2, 'civic', 5)];
    WorldGen.seedChestTiers(mixed);
    assert.eq(mixed.find(o => o.tierSeed === 5).id, 'q2', 'rank 5 beats rank 12');
  });

  test('quota: seats round-robin across categories; vista stands outside; nexus spends no seat', () => {
    // Three categories of equal size: each tier's seats split as evenly as
    // round-robin allows (5 T4 = 2+2+1).
    const objs = [];
    for (let i = 0; i < 60; i++) objs.push(mk(i, ['roadside', 'food', 'civic'][i % 3], (i % 20) + 1));
    WorldGen.seedChestTiers(objs);
    const byCat = {};
    for (const o of objs.filter(x => x.tierSeed === 4)) {
      const c = o.poiClass; byCat[c] = (byCat[c] || 0) + 1;
    }
    const counts = Object.values(byCat).sort((a, b) => b - a);
    assert.eq(counts.join(','), '2,2,1', 'no category owns a tier');
    // Vista: no seed at all - its Scenic tier stands.
    const v = mk(99, 'civic', 1, { vista: 'grail' });
    WorldGen.seedChestTiers([v, ...objs.slice(0, 30)]);
    assert.eq(v.tierSeed, undefined, 'a grail never takes a seat or a seed');
    // Nexus: takes a tier, never a seat (23 chests still fill 1/5/11).
    const nx = mk(98, 'civic', 0, { zoneNexus: 'grove' });
    const set = [nx, ...objs.slice(0, 22)];
    WorldGen.seedChestTiers(set);
    assert.truthy(nx.tierSeed === 5, 'the nexus (best rank) takes the T5');
    const n = (t) => set.filter(o => o.tierSeed === t && o !== nx).length;
    assert.eq(n(5), 1, 'the T5 seat is still spent on a budgeted chest');
    assert.eq(n(4), 5, 'as are the T4s');
    assert.eq(chestTier({ ...nx, depth: 0 }), Math.min(CHEST_TIER_MAX, nx.tierSeed + 1),
      'and its +1 lands on top of the seed');
  });

  test('quota: vistas neither spend the T5 seat nor increase the density budget', () => {
    const ordinary = Array.from({ length: 100 }, (_, i) => mk(i, 'civic', i + 1));
    const vistas = Array.from({ length: 900 }, (_, i) => mk(100 + i, 'civic', 0, {
      vista: Object.keys(Scenic.VISTA_CHEST_TIER)[i % 4],
    }));
    assert.eq(WorldGen.seedChestTiers([...vistas, ...ordinary]), 100);
    assert.eq(ordinary.filter(o => o.tierSeed === 5).length, 1);
    assert.eq(ordinary[0].tierSeed, 5, 'ordinary best-ranked chest retains the T5 seat');
    for (const vista of vistas) {
      assert.eq(vista.tierSeed, undefined);
      assert.eq(chestTier(vista), Scenic.VISTA_CHEST_TIER[vista.vista]);
    }
  });

  test('quota: the seed is the tier; the unseeded are the unstamped T2', () => {
    assert.eq(chestTier({ kind: 'chest', poiClass: 'bus', tierSeed: 4, poiDensity: 50 }), 4,
      'a seeded chest ignores its class count');
    assert.eq(chestTier({ kind: 'chest', poiClass: 'bus', poiDensity: 50 }), CHEST_TIER_UNSTAMPED,
      'counts no longer tier anything (the ladder retired, Oct 2026)');
    assert.eq(chestTier({ kind: 'chest', poiClass: 'bus', tierSeed: 2, depth: 4 }), 4,
      'depth adds its bonus on top of the seed');
  });
test('quota: each CAVE level runs its own pyramid over its mirrors', () => {
  const mkCave = (i, rank, depth = 4) => ({
    kind: 'chest', poiClass: ['cafe', 'park', 'town_hall'][i % 3], x: i, y: 0,
    id: `m${i}`, rank, depth, caveOf: `s${i}`, poiDensity: 2,
  });
  const level = [];
  for (let i = 0; i < 60; i++) level.push(mkCave(i, (i % 20) + 1));
  WorldGen.seedChestTiers(level, { cave: true });
  const n = (t) => level.filter(o => o.tierSeed === t).length;
  assert.eq(n(5), 1, 'one T5 seat at this level');
  assert.eq(n(4), 5, 'five T4');
  assert.eq(n(3), 11, 'eleven T3');
  assert.eq(n(2), 18, 'eighteen T2');
  assert.eq(chestTier(level.find(o => o.tierSeed === 5)), chestTierMaxFor(4),
    'the depth bonus reaches this level\'s cap');
  assert.eq(chestTier(level.find(o => o.tierSeed === 2)), 4, 'a T2 seed at depth 4 reads T4 (+2 bonus)');
  assert.eq(chestTier(level.find(o => o.tierSeed === 1)), 3, 'and a T1 mirror reads T3 - no crates down deep');
  // The rank rides down with the mirror: the level's best takes the T5.
  assert.eq(level.find(o => o.tierSeed === 5).rank, 1, 'rank 1 wins the seat');
  // The surface seed does NOT ride down.
  const surf = mk(0, 'civic', 1); WorldGen.seedChestTiers([surf]);
  const mirror = { ...mkCave(0, 1, 4), caveOf: surf.id };
  WorldGen.seedChestTiers([mirror], { cave: true });
  assert.eq(mirror.tierSeed, 5, 'the mirror earns its own seat, not the surface one');
});
})();
