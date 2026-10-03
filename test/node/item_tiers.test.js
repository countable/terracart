// Requested rarity bands must stay aligned with gameplay difficulty.
test('item tiers: fish span T1–T7 with no gap larger than two', () => {
  const tiers = FISH_SPECIES.map(f => fishTier(f.id));
  assert.eq(tiers[0], 1);
  assert.eq(tiers[tiers.length - 1], 7);
  for (let i = 1; i < tiers.length; i++) assert.inRange(tiers[i] - tiers[i - 1], 1, 2);
  assert.eq(ITEM_BY_ID.egg.baseTier, 2);
  assert.eq(ITEM_BY_ID.healing_potion.baseTier, 2);
  assert.eq(ITEM_BY_ID.reach_potion.baseTier, 4);
  assert.eq(ITEM_BY_ID.revival_potion.baseTier, 3);
});

test('item tiers: ordinary fauna span the approved catch and utility bands', () => {
  const tiers = { crow: 1, rabbit: 1, chicken: 2, crab: 2, deer: 3,
    butterfly: 3, sea_turtle: 3, cat: 4, cow: 4, horse: 4, dog: 5 };
  const seen = new Set();
  for (const item of ITEMS.filter(it => it.kind === 'animal' && !it.shiny)) {
    assert.eq(item.baseTier, tiers[item.base || item.id], item.id);
    seen.add(item.baseTier);
  }
  assert.eq(seen.size, 5, 'all five ordinary fauna tiers are populated');
});

test('item tiers: shiny animals gain three tiers up to the T7 ceiling', () => {
  for (const item of ITEMS.filter(it => it.shiny)) {
    assert.eq(item.baseTier, Math.min(7, ITEM_BY_ID[item.base].baseTier + 3), item.id);
  }
  assert.eq(ITEM_BY_ID.shiny_dog.baseTier, 7);
  for (const item of ITEMS) assert.inRange(item.baseTier, 1, 7, item.id);
  assert.eq(fishCatchChance('goldenfish', 7, true), 1);
});

test('item tiers: approved food and utility shifts use their new reward tiers', () => {
  const tiers = { milk: 3, meat: 3, grilled_meat: 4, banana: 2, coconut: 2,
    orange: 2, elixir: 7, goblet: 6, field_scope: 5, orb: 7, apple_sapling: 4 };
  for (const [id, tier] of Object.entries(tiers)) assert.eq(ITEM_BY_ID[id].baseTier, tier, id);
  assert.eq(ITEM_BY_ID.starfruit.baseTier, 3);
  assert.eq(FOOD_ENERGY.starfruit, 35, 'Starfruit healing fits its new tier');
  // Coverage improvements must survive the real picker index.
  assert.includes(ITEMS_BY_CLASS_TIER.magic[7], 'elixir');
  for (const id of ['goblet', 'field_scope', 'orb']) {
    assert.eq(ITEM_BY_ID[id].kind, 'unique_relic');
    for (const pool of Object.values(ITEMS_BY_CLASS_TIER)) {
      assert.falsy(Object.values(pool).flat().includes(id), 'unique relic excluded from ordinary loot');
    }
  }
});

test('item tiers: cooked dishes inherit raw tiers without entering random loot', () => {
  for (const [raw, cooked] of Object.entries(COOKED_FOODS)) {
    const item = ITEM_BY_ID[cooked.id];
    assert.eq(item.baseTier, ITEM_BY_ID[raw].baseTier, cooked.id);
    assert.eq(Energy.tasteBonus(cooked.id), Energy.tasteBonus(raw), 'matching first-taste credit');
    for (const pool of Object.values(ITEMS_BY_CLASS_TIER.produce)) {
      assert.falsy(pool.includes(cooked.id), `${cooked.id} stays cooking-only`);
    }
  }
});


test('item tiers: crop seeds have three entries at each tier from T1 through T4', () => {
  for (let tier = 1; tier <= 4; tier++) {
    const seeds = ITEMS.filter(it => it.kind === 'seed' && !it.plants && it.baseTier === tier);
    assert.eq(seeds.length, 3, `T${tier}: ${seeds.map(it => it.id).join(', ')}`);
    for (const seed of seeds) assert.eq(seed.baseTier, ITEM_BY_ID[seed.grows].baseTier);
  }
});
