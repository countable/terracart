test('reward categories: inventory keys match their official labels', () => {
  assert.eq(INV_CATS.map(c => c.key).join(','), 'seeds,produce,pets,relics,armour,ores,magic,supplies');
  for (const cat of INV_CATS) assert.eq(cat.key, cat.label.toLowerCase());
  for (const [id, category] of Object.entries({ potato_seed: 'seeds', potato: 'produce',
    pet_collar: 'pets', wood_shield: 'relics', wood: 'ores', rubble: 'ores',
    sapphire: 'ores', healing_potion: 'magic', book: 'supplies' })) {
    assert.eq(rewardCategory({ kind: 'item', id }), category, id);
  }
  assert.eq(rewardCategory({ kind: 'relic', slot: 'sword' }), 'relics');
  assert.eq(rewardCategory({ kind: 'armor', slot: 'helmet' }), 'armour');
  assert.eq(rewardCategory({ kind: 'gold', amount: 20, slot: 'sword' }), null, 'equipment cash-out is currency');
  assert.eq(rewardCategory(null), null);
});

test('reward categories: ores rename preserves the materials and gems split', () => {
  assert.falsy(ITEMS_BY_CLASS_TIER.mineral);
  assert.truthy(Object.values(ITEMS_BY_CLASS_TIER.ores).flat().includes('sapphire'));
  const materials = ChestThemes.members('materials'), gems = ChestThemes.members('gems');
  assert.truthy('wood' in materials); assert.truthy('rubble' in materials);
  assert.falsy('sapphire' in materials); assert.truthy('sapphire' in gems);
  assert.eq(ITEM_BY_ID.rubble.kind, 'produce', 'rock retains crop and reward behavior');
  assert.eq(ITEM_BY_ID.sapphire.kind, 'ores');
  assert.eq(ChestThemes.themes.roadside.weights.materials, 40);
  assert.falsy(ChestThemes.themes.roadside.weights.gems, 'names alone do not introduce gem drops');
});

test('reward categories: themed and generic picks identify the awarded inventory category', () => {
  const save = { relics: {}, armor: {}, inv: [] };
  const rng = makeRng32(81723), seen = new Set();
  for (const context of ['chest:roadside', 'chest:commerce', 'chest:culture', 'chest:school', 'treasure:great', 'treasure:default']) {
    for (let n = 0; n < 200; n++) {
      const r = pickReward(context, save, rng, { tier: 4 });
      if (!r) continue;
      assert.truthy(Object.hasOwn(r, 'category'));
      if (r.kind === 'gold') assert.eq(r.category, null);
      else {
        assert.truthy(INV_CAT_BY_KEY[r.category], context);
        if (r.kind === 'item') assert.eq(r.category, invCatForItem(r.id));
        if (r.kind === 'armor') assert.eq(r.category, 'armour');
        if (r.kind === 'relic') assert.eq(r.category, 'relics');
        seen.add(r.category);
      }
    }
  }
  assert.truthy(seen.has('ores')); assert.truthy(seen.has('supplies'));
  assert.truthy(seen.has('armour') || seen.has('relics'));
});
