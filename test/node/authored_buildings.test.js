(() => {
  const recipe = (...args) => AuthoredBuildings.recipeFor(...args);
  test('authored buildings: homes and all stable residential variants have yellow roofs', () => {
    assert.eq(recipe('home', 'player').key, 'pp_cabin');
    assert.eq(recipe('home', 'player').palette, 'yellow');
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const id = `house:${i}`, first = recipe('plain', id), again = recipe('plain', id, 7);
      assert.eq(first.palette, 'yellow');
      assert.eq(first.key, again.key, 'rank does not replace a residential facade');
      assert.truthy(AuthoredBuildings.SPECS[first.key]);
      seen.add(first.key);
    }
    assert.eq(seen.size, AuthoredBuildings.RESIDENCES.length, 'all residential variants are reachable');
  });
  test('authored buildings: every shop line uses a commercial model and a distinct signature', () => {
    const colors = new Set();
    for (const role of [...Shops.THEMES, ...Object.keys(Shops.SOLO_LINES)]) {
      for (const tier of [1, 3, 4, 7]) {
        const r = recipe(role, 'shop:fixture', tier);
        assert.includes(['market', 'city_storefront'], r.key, role);
        assert.falsy(r.palette === 'yellow', 'residential color is reserved');
        assert.eq(r.palette, recipe(role, 'another-shop', 1).palette, 'signature persists across rank and identity');
      }
      colors.add(recipe(role, 'shop:fixture').palette);
    }
    assert.eq(colors.size, Shops.THEMES.length + Object.keys(Shops.SOLO_LINES).length);
    assert.includes(['market', 'city_storefront'], recipe('shop', 'legacy').key);
  });
  test('authored buildings: service landmarks preserve their role across upgrades', () => {
    assert.eq(recipe('blacksmith', 'smith', 3).key, 'fdr');
    assert.eq(recipe('blacksmith', 'smith', 4).key, 'steam_blacksmith');
    assert.eq(recipe('blacksmith', 'smith', 1).palette, recipe('blacksmith', 'smith', 7).palette);
    assert.eq(recipe('fort', 'fort').key, 'city_gearhouse');
    assert.eq(recipe('fort', 'fort').palette, 'copper');
    assert.eq(recipe('trader', 'trader').key, 'trader');
    assert.eq(recipe('trader', 'trader').palette, 'green');
    assert.eq(recipe('wizard', 'first', 1, false).key, 'wizard');
    assert.eq(recipe('wizard', 'second', 1, true).key, 'steam_wizard');
    assert.eq(recipe('wizard', 'first').palette, 'purple');
    assert.eq(recipe('wizard', 'second', 1, true).palette, 'purple');
    assert.eq(recipe('potion', 'magic-shop').palette, 'teal');
    for (const role of ['turret', 'castle', 'wreck', 'unknown']) assert.eq(recipe(role, 'fixture'), null);
  });
})();
