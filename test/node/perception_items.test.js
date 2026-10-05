// Exploration relics share the existing carried-item and unique-reward lanes.
(function () {
  test('exploration relics: compass and perception ring are T2 unique rewards and trades', () => {
    for (const id of ['compass', 'perception_ring']) {
      assert.eq(ITEM_BY_ID[id].baseTier, 2);
      assert.eq(ITEM_BY_ID[id].kind, 'unique_relic');
      assert.truthy(Gear.uniqueRelics().some(item => item.id === id));
      assert.gt(ChestThemes.members('uniqueRelics')[id], 0);
      assert.truthy(ITEM_EFFECTS[id]);
      assert.gt(PRICES[id], 0);
    }
    const save = { inv: [{ id: 'stealth_ring', count: 1 }] };
    const received = new Set();
    // Walk the actual trader's full T2 selection interval.
    for (let n = 0; n < 1000; n++) {
      const rolls = [0, 0, n / 1000];
      const swap = Gear.traderGearSwap(save, () => rolls.shift(), 2);
      if (swap?.get.id) received.add(swap.get.id);
    }
    assert.truthy(received.has('compass'));
    assert.truthy(received.has('perception_ring'));
  });

  test('exploration relics: positive carried stacks enable effects without consuming or stacking', () => {
    for (const [id, read] of [['compass', Gear.hasCompass], ['perception_ring', Gear.hasPerception]]) {
      assert.falsy(read({}));
      assert.falsy(read({ inv: [{ id, count: 0 }] }));
      assert.falsy(read({ inv: [{ id, count: -1 }] }));
      const save = { inv: [{ id, count: 2 }] };
      assert.eq(read(save), true);
      assert.eq(save.inv[0].count, 2);
      assert.eq(jewelryVisionReduction(save), 0, 'neither exploration item reduces enemy vision');
      assert.eq(jewelryFireDamageMul(save), 1);
    }
    assert.falsy(Gear.hasPerception({ inv: [{ id: 'stealth_ring', count: 1 }] }));
  });

  test('compass icon resolves its dedicated art on inventory and offer surfaces', () => {
    const icon = inventoryIconSource('compass');
    assert.eq(icon.sheet, 'icon_compass');
    assert.eq(icon.frame, 0);
    assert.truthy(/icon_compass:\s*\{ url: 'assets\/Icons\/Items\/compass\.png', cols: 1, srcW: 16, srcH: 16 \}/.test(APP_JS_SRC));
    const dims = pngDims('assets/Icons/Items/compass.png');
    assert.eq(dims.w, 16);
    assert.eq(dims.h, 16);
    assert.eq(MINERAL_ICON_SHEET.perception_ring.frame, 10);
  });
})();
