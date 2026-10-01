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
    assert.eq(CONSUMABLE_SPEC.sleep_powder.method, 'useSleepPowder', 'sleep has its own use action');
    assert.eq(CONSUMABLE_SPEC.fireball_scroll.immediate, true, 'fireball throws on use like the spear');
  });
})();
