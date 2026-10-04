(function () {
  const temple = { id: 'temple', kind: 'temple', x: 15, y: 15, tier: 12, templeZone: 'park' };
  function tile(mask) {
    return { status: 'ready', _spawned: true, cellsPerEdge: 3,
      zone: { anchors: [{ key: 'park' }], coverage: Uint8Array.from(mask || [0, 0, 0, 0, 1, 0, 0, 0, 0]) },
      creatures: [] };
  }
  function fixture(entry = tile()) { return new Map([[WorldGen.tileKey(0, 0), entry]]); }
  function state(cache, save = {}) { return Temples.status(save, temple, { tileCache: cache, tileEdgeM: 30 }); }
  test('temple: clear requires fully loaded and spawned park coverage', () => {
    const entry = tile(), cache = fixture(entry);
    assert.eq(state(cache).ready, true);
    entry._spawned = false;
    assert.eq(state(cache).ready, false);
    entry._spawned = true;
    entry.zone.coverage[5] = 1;
    assert.eq(state(cache).ready, false, 'unloaded continuation does not mean no enemies');
    cache.set(WorldGen.tileKey(1, 0), tile([0, 0, 0, 1, 0, 0, 0, 0, 0]));
    assert.eq(state(cache).ready, true);
    delete cache.get(WorldGen.tileKey(1, 0)).zone;
    assert.eq(state(cache).ready, true, 'a spawned neighbour without zones ends the park');
  });
  test('temple: dormant enemies and chased residents count, fauna and caught enemies do not', () => {
    const entry = tile(), cache = fixture(entry);
    entry.creatures = [
      { id: 'foe', kind: 'slime', x: 15, y: 15, _surfaceInactive: true },
      { id: 'chased', kind: 'slime', x: 200, y: 200, lairX: 15, lairY: 15 },
      { id: 'deer', kind: 'deer', x: 15, y: 15 },
      { id: 'released_slime', kind: 'slime', x: 15, y: 15 },
    ];
    assert.eq(state(cache).remaining, 2);
    assert.eq(state(cache, { caught: ['foe', 'chased'] }).ready, true);
  });
  test('temple: spirit awakening survives reload and shrine tap rewards once per park', () => {
    const oldCache = WorldGen.tileCache, oldGrant = grantTreasureRoll;
    WorldGen.tileCache = fixture();
    let grants = 0, modal;
    grantTreasureRoll = (scene, save, x, y, mark, context, opts) => {
      grants++;
      assert.eq(context, 'treasure:temple');
      assert.eq(opts.rollBonus, 1);
    };
    try {
      const save = {}, scene = { save, tileEdgeM: 30, flash() {}, showMessageModal(row) { modal = row; } };
      const ctx = { scene, save };
      Temples.interact(ctx, temple);
      assert.eq(grants, 0);
      assert.eq(Temples.isActive(save, temple), false);
      Temples.discoverSpirit(scene, temple);
      assert.eq(modal.body, 'Shrine spirit discovered. The shrine begins to glow.');
      assert.eq(grants, 0);
      assert.eq(Temples.isActive(save, temple), true);
      assert.eq(modal.art, 'temple_activated');
      const restored = JSON.parse(JSON.stringify(save));
      Temples.interact({ scene, save: restored }, { ...temple, id: 'other-temple' });
      assert.eq(grants, 1);
      Temples.interact({ scene, save: restored }, temple);
      assert.eq(grants, 1);
    } finally { WorldGen.tileCache = oldCache; grantTreasureRoll = oldGrant; }
  });
  test('temple: defeating the last authored enemy awakens without paying the gift', () => {
    const oldCache = WorldGen.tileCache;
    const entry = tile();
    entry.objects = [temple];
    entry.templeEnemySites = [{ id: 'foe', kind: 'slime', x: 15, y: 15 }];
    WorldGen.tileCache = fixture(entry);
    try {
      let stories = 0;
      const save = { caught: [] }, scene = { save, tileEdgeM: 30, showMessageModal() { stories++; } };
      Temples.observe(scene);
      assert.eq(Temples.isActive(save, temple), false);
      save.caught.push('foe');
      Temples.observe(scene);
      assert.eq(Temples.isActive(save, temple), true);
      assert.eq(save.temples.park.rewardClaimed, false);
      Temples.observe(scene);
      assert.eq(stories, 1);
    } finally { WorldGen.tileCache = oldCache; }
  });
  test('temple: an enemy-free park waits for its spirit and does not auto-activate', () => {
    const oldCache = WorldGen.tileCache;
    const entry = tile(); entry.objects = [temple];
    WorldGen.tileCache = fixture(entry);
    try {
      const save = {}, scene = { save, tileEdgeM: 30 };
      Temples.observe(scene);
      assert.eq(Temples.isActive(save, temple), false);
    } finally { WorldGen.tileCache = oldCache; }
  });
  test('temple: tier two magic-only roll cannot become gear, supply or higher-tier magic', () => {
    let seed = 123;
    const rng = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
    for (let i = 0; i < 200; i++) {
      const reward = pickReward(Temples.CONTEXT, { inv: [] }, rng, { rollBonus: 1 });
      assert.eq(reward.kind, 'item');
      assert.eq(ITEM_BY_ID[reward.id].kind, 'magic');
      assert.eq(ITEM_BY_ID[reward.id].baseTier, 2);
    }
  });
  test('temple: activation owns its light independently of castle restoration', () => {
    assert.eq(isCastle(temple), false);
    assert.eq(isBuilding('temple'), false);
    assert.eq(Lighting.sourceKind({ save: {} }, temple), null);
    assert.eq(Lighting.sourceKind({ save: { temples: { park: { active: true } } } }, temple), 'temple');
  });
})();
