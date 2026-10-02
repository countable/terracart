// Themes are tested through the same groups and picker consumed by the game.
test('chest themes: every authored path terminates and conserves probability', () => {
  assert.truthy(ChestThemes.validate());
  // Memorials mint no chest, and the unused pets theme is gone because
  // OpenMapTiles represents pet stores as shop/pet commerce POIs.
  assert.eq(Object.keys(ChestThemes.themes).length, 13);
  assert.falsy(ChestThemes.themes.memorial, 'no memorial theme');
  for (const theme of Object.keys(ChestThemes.themes)) for (let tier = 1; tier <= 7; tier++) {
    for (const depth of [0, 1]) {
      const opts = { theme, depth, chestTier: Math.min(5, tier) };
      const weights = ChestThemes.weights(theme, tier, opts);
      assert.inRange(Object.values(weights).reduce((a, b) => a + b, 0), 99.999, 100.001);
      for (const group of Object.keys(weights)) {
        const r = ChestThemes.resolve(group, tier, opts);
        if (r.kind !== 'item') continue;
        assert.gt(r.ids.length, 0, `${theme}/${tier}/${group} resolves`);
        for (const id of ChestThemes.selectableIds(r)) {
          const item = ITEM_BY_ID[id];
          assert.truthy(item && !item.shiny);
          if (item.cooked) assert.eq(r.group, 'food', 'cooked meals stay in the food pool');
          assert.truthy(!item.caveOnly || depth > 0);
          assert.truthy(item.baseTier <= tier, 'the Book is a T1 item; every group member is tier-gated');
        }
      }
    }
  }
});

test('chest themes: cooked meals, spears and minerals are reachable at their quality tier', () => {
  const expected = [
    ...ITEMS.filter(item => item.cooked).map(item => ['food', 'food', item.id]),
    ['roadside', 'supplies', 'spear'], ['authority', 'supplies', 'spear'],
    ['roadside', 'materials', 'coal'],
    ...Object.values(MINERAL_TIERS).map(row => ['roadside', 'materials', row.barId]),
  ];
  for (const [theme, group, id] of expected) {
    const tier = ITEM_BY_ID[id].baseTier;
    const opts = { theme, chestTier: Math.min(5, tier) };
    const pool = ChestThemes.resolve(group, tier, opts);
    assert.includes(ChestThemes.selectableIds(pool), id, id + ' can actually be selected');
    if (tier > 1) assert.falsy(ChestThemes.eligible(group, tier - 1, opts).includes(id), id + ' respects its tier');
    const rng = makeRng32(1927);
    let found = false;
    for (let i = 0; i < 2000 && !found; i++) {
      const reward = resolveChestReward(theme, { tier, bracket: 0, jackpotApplied: 0 }, {}, rng, { tier: opts.chestTier });
      found = reward.kind === 'item' && reward.id === id;
    }
    assert.truthy(found, id + ' reaches the chest reward');
  }
  for (let tier = 2; tier <= 7; tier++) {
    const pool = ChestThemes.resolve('materials', tier, { theme: 'roadside' });
    assert.eq(ChestThemes.selectableIds(pool).join(','), MINERAL_TIERS[tier].barId, 'materials advance beyond basic debris');
  }
});

test('chest themes: high-tier weights use the chest tier, not jackpot quality', () => {
  assert.eq(ChestThemes.weights('roadside', 7, { tier: 1 }).supplies, 45);
  assert.eq(ChestThemes.weights('roadside', 1, { tier: 4 }).supplies, 45);
  assert.eq(ChestThemes.weights('flora', 4, { tier: 4 }).flowerSeeds, 50);
  assert.eq(ChestThemes.weights('flora', 7, { tier: 4 }).flowerSeeds, 50);
  assert.eq(ChestThemes.weights('food', 4, { tier: 1 }).food, 95,
    'a starter jackpot keeps the food chest identity');
});

test('chest themes: cave mixture adds medicine and retains the location share', () => {
  for (let tier = 1; tier <= 7; tier++) {
    const w = ChestThemes.weights('school', tier, { depth: 1 });
    assert.eq(w.books, 36, '60% of the surface book share');
    if (tier === 1) assert.eq(w.antidote, 24);
    else assert.eq(w.caveMagic, tier === 2 ? 24 : 32);
  }
  for (const [tier, top] of [[6, 'resurrection_potion'], [7, 'elixir']]) {
    const r = ChestThemes.resolve('caveMagic', tier, { depth: 1 });
    const rng = makeRng32(101);
    let powders = 0, topItems = 0;
    for (let i = 0; i < 5000; i++) {
      const id = ChestThemes.pickItem(r, tier, rng);
      assert.lte(ITEM_BY_ID[id].baseTier, tier, 'no medicine above the rolled tier');
      if (id.endsWith('_powder')) powders++;
      if (id === top) topItems++;
    }
    assert.inRange(topItems / 5000, 0.67, 0.73);
    assert.gt(powders, 150, 'deep magic retains useful lower-tier powders');
  }
});

test('chest themes: health stays in its medical-magic lane', () => {
  for (let tier = 1; tier <= 7; tier++) {
    const opts = { theme: 'health' };
    assert.eq(ChestThemes.weights('health', tier).medicalMagic, 100);
    const resolved = ChestThemes.resolve('medicalMagic', tier, opts);
    assert.eq(resolved.group, tier === 1 ? 'antidote' : 'medicalMagic');
    for (const id of ChestThemes.selectableIds(resolved)) {
      assert.truthy(['magic', 'unique_relic'].includes(ITEM_BY_ID[id].kind),
        id + ' is restorative magic or a selected healing relic');
    }
  }
});

test('chest themes: quantities use actual item price once and discard excess allowance', () => {
  assert.eq(ChestThemes.quantity('vigor_potion', 4, 0), 6);
  assert.eq(ChestThemes.quantity('revive_potion', 4, 0), 6);
  assert.eq(ChestThemes.quantity('vigor_potion', 5, 0), 6);
  for (const id of ['elixir', 'resurrection_potion', 'book', 'sunflower_seed', 'fireflower_seed', 'iceflower_seed']) {
    assert.eq(ChestThemes.quantity(id, 7, 3), 1, id + ' is a single reward');
  }
  assert.eq(ChestThemes.quantity('antidote', 4, 0), 6, 'cheap magic fills a single stack');
  assert.eq(ChestThemes.quantity('wood', 7, 3, () => 0.999), 12);
});

test('chest themes: unrelated gear and items never leak across themes', () => {
  const rng = makeRng32(400);
  for (const theme of Object.keys(ChestThemes.themes)) for (const tier of [1, 2, 3, 4, 5]) {
    for (const depth of [0, 1]) for (let i = 0; i < 100; i++) {
      const r = pickChestReward(theme, { relics: {}, armor: {} }, rng, { tier, depth });
      assert.truthy(r);
      assert.eq(r.consolation, 0, 'capped quantity never grants cash');
      if (r.kind === 'item') {
        assert.eq(r.cls, ITEM_BY_ID[r.id].kind);
        assert.lte(r.qty, ['wood', 'rockfruit'].includes(r.id) ? 12 : ChestThemes.cap(r.id));
      }
      if (r.kind === 'relic' || r.kind === 'armor') {
        assert.gt(tier, 1);
        assert.truthy(r.slot !== 'ring');
        if (theme === 'authority') assert.eq(r.kind, 'armor');
        if (['school', 'civic'].includes(theme)) assert.includes(['bags', 'can', 'hoe', 'rod', 'bugnet'], r.slot);
      }
    }
  }
});

test('chest themes: school-only Book exception and named venue preference', () => {
  assert.eq(ChestThemes.resolve('books', 1, { theme: 'school' }).group, 'books');
  // The Book became a T1 item (with the tomes), so a low culture roll
  // pays a Book where it used to fall through to a torch.
  assert.eq(ChestThemes.resolve('books', 1, { theme: 'culture' }).group, 'books');
  const opts = { theme: 'food', venueProduct: 'potato' };
  const pool = ChestThemes.resolve('food', 5, opts);
  const rng = makeRng32(222);
  let potatoes = 0;
  for (let i = 0; i < 5000; i++) if (ChestThemes.pickItem(pool, 5, rng, opts) === 'potato') potatoes++;
  assert.inRange(potatoes / 5000, 0.67, 0.73);
  assert.eq(ChestThemes.resolve('foodSeeds', 3, { theme: 'food', venueProduct: 'milk' }).group, 'food');
});

test('chest themes: high-tier rolls keep quality and one reward through quantity-heavy chains', () => {
  for (const theme of Object.keys(ChestThemes.themes)) for (const tier of [3, 4, 5]) {
    const rng = makeRng32(707 + tier);
    for (let i = 0; i < 250; i++) {
      const reward = pickChestReward(theme, { relics: {}, armor: {} }, rng, { tier });
      assert.gte(reward.rolledTier, tier);
      assert.eq(reward.consolation, 0);
      if (reward.slot) assert.gte(reward.tier, tier - 1, 'equipment has its own floor');
      if (reward.kind === 'item') {
        assert.truthy(typeof reward.id === 'string');
        assert.gte(reward.qty, 1);
        assert.lte(reward.qty, ChestThemes.cap(reward.id));
        if (theme === 'roadside' && reward.group === 'materials') assert.gte(ITEM_BY_ID[reward.id].baseTier, tier);
        if (theme === 'health') assert.truthy(['magic', 'unique_relic'].includes(ITEM_BY_ID[reward.id].kind));
        if (theme === 'flora' && tier >= 4 && ['flowers', 'flowerSeeds'].includes(reward.group))
          assert.gte(ITEM_BY_ID[reward.id].baseTier, 4);
      }
    }
  }
});

test('chest themes: a high-tier venue does not force starter food', () => {
  const rng = makeRng32(909);
  for (let i = 0; i < 1000; i++) {
    const reward = pickChestReward('food', {}, rng, { tier: 4, venueProduct: 'potato' });
    if (reward.group === 'food') assert.gte(ITEM_BY_ID[reward.id].baseTier, 4);
  }
});
