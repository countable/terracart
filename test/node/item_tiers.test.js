// Requested rarity bands must stay aligned with gameplay difficulty.
test('item tiers: fish span T1–T7 with no gap larger than two', () => {
  const tiers = FISH_SPECIES.map(f => fishTier(f.id));
  assert.eq(tiers[0], 1);
  assert.eq(tiers[tiers.length - 1], 7);
  for (let i = 1; i < tiers.length; i++) assert.inRange(tiers[i] - tiers[i - 1], 1, 2);
  assert.eq(ITEM_BY_ID.egg.baseTier, 2);
  assert.eq(ITEM_BY_ID.vigor_potion.baseTier, 4);
});

test('item tiers: ordinary fauna follow their actual HP bands', () => {
  const seen = new Set();
  for (const item of ITEMS.filter(it => it.kind === 'animal' && !it.shiny)) {
    const hp = Combat.creatureMaxHp(item.id);
    const tier = hp <= 10 ? 2 : hp <= 15 ? 3 : hp <= 20 ? 4 : 5;
    assert.eq(item.baseTier, tier, `${item.id}: ${hp} HP`);
    seen.add(tier);
  }
  assert.eq(seen.size, 4, 'all four fauna tiers are populated');
});

test('item tiers: shiny animals gain exactly three tiers, including above T7', () => {
  for (const item of ITEMS.filter(it => it.shiny)) {
    assert.eq(item.baseTier, ITEM_BY_ID[item.base].baseTier + 3, item.id);
  }
  assert.eq(ITEM_BY_ID.shiny_dog.baseTier, 8);
  assert.eq(fishCatchChance('goldenfish', 7, true), 0.125);
});
