// Themes are tested through the same groups and picker consumed by the game.
test('chest themes: every authored path terminates and conserves probability', () => {
  assert.truthy(ChestThemes.validate());
  assert.eq(Object.keys(ChestThemes.themes).length, 14);
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
          assert.truthy(item && !item.shiny && !item.cooked);
          assert.truthy(!item.caveOnly || depth > 0);
          assert.truthy(item.baseTier <= tier || (theme === 'school' && id === 'book'));
        }
      }
    }
  }
});

test('chest themes: seed probability moves to related rewards at high quality', () => {
  const expected = [[3, 45], [4, 22.5], [5, 14.85], [6, 11.25], [7, 11.25]];
  for (const [tier, seeds] of expected) {
    const w = ChestThemes.weights('flora', tier);
    assert.inRange(w.flowerSeeds, seeds - 1e-9, seeds + 1e-9);
    assert.inRange(w.growth, 10 + (45 - seeds) / 2 - 1e-9, 10 + (45 - seeds) / 2 + 1e-9);
    assert.inRange(w.saplings, 15 + (45 - seeds) / 2 - 1e-9, 15 + (45 - seeds) / 2 + 1e-9);
    assert.eq(w.flowers, 30, 'direct flower share does not silently increase');
  }
});

test('chest themes: cave mixture adds medicine and retains the location share', () => {
  for (let tier = 1; tier <= 7; tier++) {
    const w = ChestThemes.weights('school', tier, { depth: 1 });
    assert.eq(w.books, 33, '60% of the 55% school Book group');
    if (tier === 1) assert.eq(w.antidote, 24);
    else assert.eq(w.caveMagic, tier === 2 ? 24 : 32);
  }
  const r = ChestThemes.resolve('caveMagic', 6, { depth: 1 });
  const rng = makeRng32(101);
  let powders = 0, elixirs = 0;
  for (let i = 0; i < 5000; i++) {
    const id = ChestThemes.pickItem(r, 6, rng);
    if (id.endsWith('_powder')) powders++;
    if (id === 'elixir') elixirs++;
  }
  assert.inRange(elixirs / 5000, 0.67, 0.73);
  assert.gt(powders, 150, 'deep magic retains useful lower-tier powders');
});

test('chest themes: recovery, revival and protection remain distinct', () => {
  for (let tier = 1; tier <= 7; tier++) {
    const opts = { theme: 'health' };
    const recovery = ChestThemes.resolve('recovery', tier, opts);
    const ids = ChestThemes.selectableIds(recovery);
    if (tier === 1) assert.eq(recovery.group, 'restorative');
    else assert.eq(ids.join(','), tier >= 6 ? 'elixir' : 'vigor_potion');
    const revival = ChestThemes.resolve('revival', tier, opts);
    if (tier === 1) assert.eq(revival.group, 'restorative');
    else assert.eq(ChestThemes.selectableIds(revival).join(','), tier >= 5 ? 'resurrection_potion' : 'revive_potion');
    assert.eq(ChestThemes.weights('health', tier).antidote, 25);
  }
});

test('chest themes: quantities use actual item price once and discard excess allowance', () => {
  assert.eq(ChestThemes.quantity('vigor_potion', 4, 0), 2);
  assert.eq(ChestThemes.quantity('revive_potion', 4, 0), 1);
  assert.eq(ChestThemes.quantity('vigor_potion', 5, 0), 3);
  for (const id of ['antidote', 'elixir', 'resurrection_potion', 'book', 'sunflower_seed', 'fireflower_seed', 'iceflower_seed']) {
    assert.eq(ChestThemes.quantity(id, 7, 3), 1, id + ' is a single reward');
  }
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
        if (['school', 'civic'].includes(theme)) assert.includes(['amulet', 'bags', 'can', 'hoe', 'rod', 'bugnet'], r.slot);
      }
    }
  }
});

test('chest themes: school-only Book exception and named venue preference', () => {
  assert.eq(ChestThemes.resolve('books', 1, { theme: 'school' }).group, 'books');
  assert.eq(ChestThemes.resolve('books', 1, { theme: 'culture' }).group, 'torch');
  const opts = { theme: 'food', venueProduct: 'potato' };
  const pool = ChestThemes.resolve('food', 5, opts);
  const rng = makeRng32(222);
  let potatoes = 0;
  for (let i = 0; i < 5000; i++) if (ChestThemes.pickItem(pool, 5, rng, opts) === 'potato') potatoes++;
  assert.inRange(potatoes / 5000, 0.67, 0.73);
  assert.eq(ChestThemes.resolve('foodSeeds', 3, { theme: 'food', venueProduct: 'milk' }).group, 'food');
});
