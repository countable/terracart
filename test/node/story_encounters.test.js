(function () {
  function scene() {
    // Six restored: the fixed opening run plus two, the one the encounter
    // arms on (StoryEncounters.ARM_AT_RESTORES); `d` is the one just rebuilt.
    const s = { save: { restoredHouses: { a: 'blacksmith', b: 'trader', c: 'plain', e: 'market', f: 'plain', d: 'plain' }, caught: [] },
      depth: 0, cellM: 7, tileEdgeM: 224, startWorldM: { x: 0, y: 0 }, playerM: { x: 112, y: 112 },
      _dialogOpen: () => false, showMessageModal: p => s.lastDialog = p,
      addToInv: (id, n) => { const accepted = Inventory.add(s.save, id, n).accepted; s.gifts = (s.gifts || 0) + accepted; s.giftId = id; return accepted; } };
    return s;
  }
  test('hunted-neighbour encounter arms only once, at the SIXTH rebuild', () => {
    assert.eq(StoryEncounters.ARM_AT_RESTORES, 6, 'two restores after the opening run (blacksmith, trader, house, market)');
    const s = scene();
    delete s.save.restoredHouses.d;
    assert.falsy(StoryEncounters.arm(s, { id: 'd' }), 'five restored: not yet');
    const four = scene(); four.save.restoredHouses = { a: 'blacksmith', b: 'trader', c: 'plain', d: 'market' };
    assert.falsy(StoryEncounters.arm(four, { id: 'd' }), 'the fourth (the market) no longer arms it');
    s.save.restoredHouses.d = 'plain';
    assert.truthy(StoryEncounters.arm(s, { id: 'd' }));
    const id = s.save.storyEncounter.enemyId;
    assert.falsy(StoryEncounters.arm(s, { id: 'different' }));
    assert.eq(s.save.storyEncounter.enemyId, id);
  });
  test('hunted-neighbour gift requires its own archer and is exactly once across reload', () => {
    const s = scene(); StoryEncounters.arm(s, { id: 'd' });
    const q = s.save.storyEncounter, c = { id: q.npcId, name: 'Neighbour' };
    const portrait = NPC.portrait; NPC.portrait = () => 'portrait';
    try {
      assert.falsy(StoryEncounters.defeated(s, { id: 'other-archer' }));
      StoryEncounters.interact(s, c);
      assert.eq(s.gifts || 0, 0);
      assert.eq(s.lastDialog.body, StoryEncounters.WORRIED);
      s.save.caught.push(q.enemyId);
      StoryEncounters.interact(s, c);
      assert.eq(s.gifts, 1); assert.eq(s.giftId, 'starfruit_seed');
      assert.eq(q.status, 'rewarded');
      s.save = JSON.parse(JSON.stringify(s.save));
      StoryEncounters.interact(s, c);
      assert.eq(s.gifts, 1);
    } finally { NPC.portrait = portrait; }
  });
  test('hunted-neighbour full bag and a busy modal do not spend the gift', () => {
    const s = scene(); StoryEncounters.arm(s, { id: 'd' });
    const q = s.save.storyEncounter, c = { id: q.npcId, name: 'Neighbour' };
    StoryEncounters.defeated(s, { id: q.enemyId });
    s.addToInv = () => 0;
    const portrait = NPC.portrait; NPC.portrait = () => 'portrait';
    try {
      s._dialogOpen = () => true; StoryEncounters.interact(s, c);
      assert.falsy(s.lastDialog); assert.eq(q.status, 'grateful');
      s._dialogOpen = () => false; StoryEncounters.interact(s, c);
      assert.eq(q.status, 'grateful');
      assert.truthy(s.lastDialog.body.includes('Make room'));
    } finally { NPC.portrait = portrait; }
  });
  test('hunted-neighbour spawn retries unavailable ground without losing the encounter', () => {
    const s = scene(); StoryEncounters.arm(s, { id: 'd' });
    s.cellAt = () => ({ loaded: false });
    StoryEncounters.tick(s, 1000);
    assert.falsy(s.save.storyEncounter.npc);
    StoryEncounters.tick(s, 2000);
    assert.eq(s.save.storyEncounter.status, 'hunted');
  });
  test('hunted-neighbour pair survives tile rebuild without duplicates and respects Home', () => {
    const s = scene(); StoryEncounters.arm(s, { id: 'd' });
    const cache = WorldGen.tileCacheFor(0), old = Array.from(cache.entries());
    const N = 32;
    const makeEntry = () => ({ _spawned: true, cellsPerEdge: N,
      grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), creatures: [],
      _spawnOpts: { roadMask: new Uint8Array(N * N), occupied: new Set() } });
    const e = makeEntry();
    s.cellAt = (x,y) => ({ loaded: true, tx: 0, ty: 0, ix: Math.floor(x/7), iy: Math.floor(y/7) });
    s.inHomeRing = (x,y) => x < 112;
    const portrait = NPC.portrait; NPC.portrait = () => 'portrait';
    cache.clear(); cache.set(WorldGen.tileKey(0,0), e);
    try {
      StoryEncounters.tick(s, 1000);
      assert.eq(e.creatures.length, 2);
      const enemy = e.creatures.find(c => c.kind === 'goblin_archer');
      assert.truthy(enemy); assert.falsy(s.inHomeRing(enemy.x, enemy.y));
      StoryEncounters.tick(s, 2000); assert.eq(e.creatures.length, 2);
      const replacement = makeEntry(); cache.set(WorldGen.tileKey(0,0), replacement);
      s.save = JSON.parse(JSON.stringify(s.save));
      StoryEncounters.tick(s, 3000); assert.eq(replacement.creatures.length, 2);
      s.save.caught.push(enemy.id);
      const afterKill = makeEntry(); cache.set(WorldGen.tileKey(0,0), afterKill);
      StoryEncounters.tick(s, 4000);
      assert.eq(afterKill.creatures.length, 1);
      assert.eq(afterKill.creatures[0].kind, 'npc');
      assert.eq(s.save.storyEncounter.status, 'grateful');
    } finally { NPC.portrait = portrait; cache.clear(); for (const [k,v] of old) cache.set(k,v); }
  });
  test('starfruit reward uses the real seed, planting, growth and harvest path', () => {
    const save = { inv: [], selSlot: 0, planted: [], tilled: ['0,0'] };
    assert.eq(Inventory.add(save, 'starfruit_seed', 1).accepted, 1);
    assert.eq(ITEM_BY_ID.starfruit_seed.grows, 'starfruit');
    assert.eq(ITEM_BY_ID.starfruit.kind, 'produce');
    const scene = { save, depth: 0, cellM: 7, tilledSet: new Set(['0,0']),
      spendEnergy: () => true, flash() {}, flashLoot() {}, buildInventoryDOM() {},
      addToInv: (id,n) => Inventory.add(save,id,n).accepted };
    const ctx = { scene, save, sx: 0, sy: 0, cellKey: '0,0', cwmx: 0, cwmy: 0 };
    assert.truthy(TAP_HANDLERS.find(h => h.name === 'plant').try(ctx));
    assert.eq(Inventory.count(save, 'starfruit_seed'), 0);
    assert.eq(save.planted[0].crop, 'starfruit');
    for (let stage=0; stage < MAX_GROWTH_STAGE; stage++) {
      const now = 1000000 + stage * Crops.stageHoldMs('starfruit');
      Crops.waterWithin(save, 0, 0, 1, now);
      Crops.advanceGrowth(save, now + Crops.stageHoldMs('starfruit'));
    }
    assert.truthy(Crops.isMature(save.planted[0]));
    assert.truthy(TAP_HANDLERS.find(h => h.name === 'planted').try(ctx));
    assert.eq(save.planted.length, 0);
    assert.inRange(Inventory.count(save, 'starfruit'), 1, 3);
    assert.eq(inventoryIconSource('starfruit').frame, 10 * 9 + 7);
    assert.falsy(JSON.stringify(inventoryIconSource('starfruit')) === JSON.stringify(inventoryIconSource('gemfruit')));
    assert.eq(iconBadgeItem('starfruit_seed'), 'starfruit');
    for (const id of ['starfruit', 'starfruit_seed']) {
      const icon = inventoryIconSource(id);
      assert.truthy(icon); assert.eq(icon.sheet, 'crops');
    }
  });
})();
