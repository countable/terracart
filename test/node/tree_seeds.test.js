test('tree seeds: saplings share the seed category and retain their planting targets', () => {
  assert.falsy(ITEMS_BY_CLASS_TIER.sapling);
  assert.falsy(ChestThemes.groups.saplings);
  for (const id of ['acorn', 'apple_sapling', 'worldpeach_sapling']) {
    assert.eq(ITEM_BY_ID[id].kind, 'seed', id);
    assert.includes(ITEMS_BY_CLASS_TIER.seed[ITEM_BY_ID[id].baseTier], id);
  }
  assert.eq(ITEM_BY_ID.worldpeach_sapling.baseTier, 7);
  assert.eq(itemName('worldpeach'), 'Worldpeach');
  assert.eq(itemName('worldpeach_sapling'), 'Worldpeach Sapling');
  assert.eq(cropName('worldpeach'), 'Worldpeach');
});

test('tree seeds: park chests can award every tree seed at its reward quality', () => {
  for (const [id, chestTier, quality] of [
    ['acorn', 2, 2], ['apple_sapling', 1, 4], ['apple_sapling', 4, 4],
    ['worldpeach_sapling', 3, 7], ['worldpeach_sapling', 7, 7],
  ]) {
    const opts = { tier: chestTier, depth: chestTier === 7 ? 6 : 0 };
    assert.gt(ChestThemes.weights('park', quality, opts).parkSeeds, 0);
    const rng = makeRng32(1937);
    let found = false;
    for (let n = 0; n < 2000 && !found; n++) {
      const reward = resolveChestReward('park', { tier: quality, bracket: 0, jackpotApplied: 0 }, {}, rng, opts);
      found = reward.kind === 'item' && reward.id === id;
      if (found && ITEM_BY_ID[id].plants === 'fruittree') assert.eq(reward.qty, 1);
    }
    assert.truthy(found, `${id} is awarded by a T${chestTier} park chest at quality ${quality}`);
  }
});

test('tree seeds: planting consumes a seed and creates its tree instead of a crop bed', () => {
  const original = globalThis.WorldGen;
  try {
    for (const id of ['acorn', 'apple_sapling', 'worldpeach_sapling']) {
      const entry = { objects: [] };
      globalThis.WorldGen = { ...original, tileCache: new Map([[original.tileKey(0, 0), entry]]) };
      const save = { inv: [{ id, count: 1 }], selSlot: 0, planted: [], fruittrees: [] };
      const messages = [];
      const scene = Object.assign(makeScene(), { save, tilledSet: new Set(['plot']),
        tileEdgeM: 1000, spendEnergy: () => true, buildInventoryDOM() {}, flash: msg => messages.push(msg) });
      const ctx = { scene, save, sx: 0, sy: 0, cellKey: 'plot', cwmx: 10, cwmy: 10 };
      assert.eq(TAP_HANDLERS.find(h => h.name === 'plant').try(ctx), true);
      assert.eq(save.planted.length, 0, id);
      assert.eq(save.fruittrees.length, 1, id);
      assert.eq(entry.objects.length, 1, id);
      assert.eq(entry.objects[0].kind, ITEM_BY_ID[id].plants, id);
      assert.eq(entry.objects[0].species, ITEM_BY_ID[id].grows, id);
      assert.eq(Inventory.count(save, id), 0, id);
      assert.falsy(scene.tilledSet.has('plot'));
      assert.truthy(ctx.dirty);
      assert.lte([...messages[0]].length, MAP_MSG_MAX, messages[0]);
    }
  } finally { globalThis.WorldGen = original; }
});
