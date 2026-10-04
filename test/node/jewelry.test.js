// Unique carried jewelry: intrinsic effects, no material-tier gear slot.

(function () {
  const ids = ['stealth_ring', 'invisibility_ring', 'ember_ring', 'regeneration_amulet', 'vigor_amulet'];

  test('unique jewelry: carried unique relics replace tiered ring and amulet gear', () => {
    assert.falsy(RELIC_DEFS.ring, 'ring is not a tiered gear slot');
    assert.falsy(RELIC_DEFS.amulet, 'amulet is not a tiered gear slot');
    for (const id of ids) {
      const item = ITEM_BY_ID[id];
      assert.truthy(item && item.kind === 'unique_relic' && item.uniqueJewelry, id + ' is a carried unique relic');
      assert.truthy(MINERAL_ICON_SHEET[id], id + ' has an inventory icon frame');
      assert.truthy(ITEM_EFFECTS[id], id + ' has effect copy');
    }
    assert.eq(MINERAL_ICON_SHEET.stealth_ring.frame, 8);
    assert.eq(MINERAL_ICON_SHEET.invisibility_ring.frame, 11);
    assert.eq(MINERAL_ICON_SHEET.regeneration_amulet.frame, 10);
    assert.eq(MINERAL_ICON_SHEET.vigor_amulet.frame, 17);
  });

  test('unique rings: strongest carried ring shortens sight without stacking', () => {
    const bag = (...ids) => ({ inv: ids.map(id => ({ id, count: 1 })) });
    assert.eq(jewelryVisionReduction({}), 0);
    assert.eq(jewelryVisionReduction(bag('stealth_ring')), 1);
    assert.eq(jewelryVisionReduction(bag('invisibility_ring')), 2);
    assert.eq(jewelryVisionReduction(bag('stealth_ring', 'invisibility_ring')), 2, 'strongest wins');
    assert.eq(jewelryVisionReduction({ inv: [{ id: 'invisibility_ring', count: 0 }] }), 0, 'empty stack is absent');
    const slime = Combat.sightCells('slime');
    assert.eq(Combat.sightCells('slime', bag('stealth_ring')), Math.max(0, slime - 1));
    assert.eq(Combat.sightCells('slime', bag('invisibility_ring')), Math.max(0, slime - 2));
    assert.truthy(Combat.seesPlayer('slime', Math.max(0, slime - 2) * 10, 10, bag('invisibility_ring')),
      'the reduced edge is still visible');
    assert.eq(Math.max(0, Combat.sightCells('slime', bag('invisibility_ring'))), Combat.sightCells('slime', bag('invisibility_ring')),
      'effective sight never goes below zero');
    assert.eq((CREATURE_AI_SRC.match(/Combat\.seesPlayer\(c\.kind, dist, scene\.cellM, scene\.save\)/g) || []).length, 2,
      'ordinary pursuit (the roster attack and mover) passes the save through the one sight helper');
  });

  test('unique amulets: fastest carried regeneration cadence wins', () => {
    const bag = (...ids) => ({ inv: ids.map(id => ({ id, count: 1 })) });
    assert.eq(jewelryRegenIntervalMs({}), Infinity);
    assert.eq(jewelryRegenIntervalMs(bag('regeneration_amulet')), 4000);
    assert.eq(jewelryRegenIntervalMs(bag('vigor_amulet')), 2000);
    assert.eq(jewelryRegenIntervalMs(bag('regeneration_amulet', 'vigor_amulet')), 2000, 'strongest wins');
    const update = SCENE_SRC.match(/const jewelryRegenMs = jewelryRegenIntervalMs\(this\.save\);[\s\S]*?this\._jewelryAccrueE = 0;/);
    assert.truthy(update, 'update reads the carried amulet');
    assert.truthy(/if \(!working && Number\.isFinite\(jewelryRegenMs\)/.test(update[0]), 'working pauses regeneration');
    assert.truthy(/this\._accrueRestEnergy\('_jewelryAccrueE', dt \* 1000 \/ jewelryRegenMs, maxE\)/.test(update[0]),
      'the cadence rides the shared fractional Energy.set accumulator');
  });

  test('unique jewelry: only the rare unique-relic lane awards it, ordinary shops cannot', () => {
    const unique = ChestThemes.members('uniqueRelics');
    for (const id of ids) {
      assert.gt(unique[id], 0);
      for (const group of ['shadow', 'healing', 'study', 'caveMagic'])
        assert.falsy(ChestThemes.members(group)[id], `${id}: absent from ${group}`);
    }
    const shopMagic = Shops.THEME_POOL.potion();
    for (const id of ids) assert.falsy(shopMagic.includes(id), id + ' is not shop stock');
  });
})();
