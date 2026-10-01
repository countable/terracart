(function () {
  test('scroll icons: second scroll casts fire and the last scroll is the map', () => {
    for (const [id, frame] of Object.entries({
      blank_scroll: 45, fireball_scroll: 46, fear_scroll: 47, treasure_map: 49,
    })) {
      assert.eq(MINERAL_ICON_SHEET[id].sheet, MINERAL_ICON_SHEET.book.sheet, `${id}: book art sheet`);
      assert.eq(MINERAL_ICON_SHEET[id].frame, frame, `${id}: scroll art frame`);
      assert.eq(inventoryIconSource(id).frame, frame, `${id}: inventory resolves scroll art`);
    }
  });

  test('scrolls and sleep powder: consumables participate in the item economy', () => {
    for (const id of ['blank_scroll', 'fireball_scroll', 'fear_scroll', 'treasure_map', 'sleep_powder']) {
      assert.truthy(ITEM_BY_ID[id], `${id}: registered`);
      assert.gt(ITEM_BY_ID[id].baseTier, 0, `${id}: loot tier`);
      assert.gt(PRICES[id], 0, `${id}: trade price`);
      assert.truthy(ITEM_EFFECTS[id], `${id}: description`);
    }
    assert.falsy(CONSUMABLE_SPEC.blank_scroll, 'blank parchment is a material');
    assert.eq(CONSUMABLE_SPEC.treasure_map.durationMs, 15 * 60 * 1000, 'map lasts fifteen minutes');
    assert.eq(CONSUMABLE_SPEC.sleep_powder.durationMs, Combat.FLOWER_STATUS_MS, 'sleep reuses the existing flower debuff duration');
    assert.eq(CONSUMABLE_SPEC.sleep_powder.method, 'useSleepPowder', 'sleep has its own use action');
    assert.eq(CONSUMABLE_SPEC.fireball_scroll.immediate, true, 'fireball throws on use like the spear');
  });
  test('scrolls: themed chests offer the new items without replacing tomes', () => {
    for (const [id, group, theme] of [
      ['blank_scroll', 'supplies', 'roadside'],
      ['fireball_scroll', 'combatMagic', 'authority'],
      ['fear_scroll', 'combatMagic', 'authority'],
      ['sleep_powder', 'combatMagic', 'authority'],
      ['treasure_map', 'travelMagic', 'roadside'],
    ]) {
      const pool = ChestThemes.resolve(group, ITEM_BY_ID[id].baseTier, { theme });
      assert.includes(ChestThemes.selectableIds(pool), id, `${id}: available from themed loot`);
    }
    for (const item of ITEMS.filter(item => item.scroll)) {
      assert.lte(PRICES[item.id], PRICES.blank_scroll, `${item.id}: crafting cannot increase the material's sale value`);
    }
  });
})();
