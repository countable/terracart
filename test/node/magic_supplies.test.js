test('item classes: potions and powders are Magic; practical items are Supplies', () => {
  for (const id of ['antidote', 'elixir', 'reach_potion', 'healing_potion', 'speed_potion', 'shielding_potion', 'blight_potion', 'raven_scroll', 'revival_potion', 'resurrection_potion', 'thunder_scroll', 'growth_powder', 'shadow_powder', 'dragon_powder', 'frost_powder']) {
    assert.eq(ITEM_BY_ID[id].kind, 'magic', id);
    assert.eq(invCatForItem(id), 'magic', id);
  }
  for (const id of ['taming_potion', 'book', 'rope', 'torch', 'trap_disarm_kit', 'magic_trap', 'scarecrow']) {
    assert.eq(ITEM_BY_ID[id].kind, 'supply', id);
    assert.eq(invCatForItem(id), 'supplies', id);
  }
  assert.falsy(ITEMS.some(item => item.kind === 'consumable'));
  assert.eq(INV_CATS.length, 8);
});



test('new medicines have distinct nonempty art and fixed tiers', () => {
  assert.eq(ITEM_BY_ID.antidote.baseTier, 1);
  assert.eq(ITEM_BY_ID.elixir.baseTier, 7);
  assert.eq(itemValue('antidote'), 12);
  assert.eq(itemValue('elixir'), 360);
  const used = new Set();
  for (const id of ['antidote', 'elixir', 'healing_potion', 'revival_potion', 'resurrection_potion']) {
    const art = inventoryIconSource(id);
    const key = `${art.sheet}:${art.frame}`;
    assert.falsy(used.has(key), `${id} shares art`);
    used.add(key);
  }
});

test('seed descriptions hint at planting without a growth formula', () => {
  for (const crop of ['potato', 'sunflower', 'fireflower', 'iceflower']) {
    assert.truthy(/earth/.test(ITEM_EFFECTS[crop + '_seed']));
    assert.falsy(/\d/.test(ITEM_EFFECTS[crop + '_seed']));
  }
});

test('unique relics: fixed-tier equipment values and no ordinary shop or loot stock', () => {
  const unique = ITEMS.filter(item => item.kind === 'unique_relic');
  assert.eq(unique.length, 26, 'sixteen finds, two progression relics and eight reusable tomes');
  for (const item of unique) {
    assert.eq(itemValue(item.id), gearPrice('relic', 'sword', item.baseTier), item.id);
    assert.eq(invCatForItem(item.id), 'relic', item.id);
    for (const pool of Object.values(Shops.THEME_POOL)) assert.falsy(pool().includes(item.id), item.id + ' is reward-only');
    for (const pool of Object.values(ITEMS_BY_CLASS_TIER)) assert.falsy(Object.values(pool).flat().includes(item.id), item.id + ' excluded from generic loot');
  }
});
