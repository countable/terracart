(() => {
  function method(name) {
    const match = APP_JS_SRC.match(new RegExp('^  ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'));
    if (!match) throw new Error('Missing scene method: ' + name);
    return new Function('return ({' + match[0] + '})')()[name];
  }
  const addToInv = method('addToInv');
  const finish = method('_finishInventoryChange');

  test('shop purchase: one inventory refresh observes payment, grant and deal together', () => {
    let modal, deals = 0, refreshes = 0;
    const scene = {
      save: { money: 20, inv: [], relics: {}, selSlot: -1 },
      addToInv, _finishInventoryChange: finish,
      invEntriesForCat() { return this.save.inv.map((entry, idx) => ({ entry, idx })); },
      buildInventoryDOM() {
        refreshes++;
        assert.eq(this.save.money, 15);
        assert.eq(Inventory.count(this.save, 'potato'), 1);
        assert.eq(deals, 1, 'bookkeeping precedes the refresh');
      },
      buildShopOffer() { return { canAfford: () => true, consume: () => { this.save.money -= 5; } }; },
      showOfferModal(m) { modal = m; },
      buildingFlavorTitle: () => '', iconSpanHTML: () => '', flashLoot() {},
      _themedStockCount: () => 1,
    };
    method('_presentThemedItem').call(scene, 0, 0, { id: 'shop' }, () => { deals++; }, 'potato');
    modal.onAccept();
    assert.eq(refreshes, 1);
    assert.eq(scene.save.selSlot, -1, 'a purchase never selects a new item');
    assert.eq(scene.save.invCat, invCatForItem('potato'), 'the new stack still surfaces');
    assert.falsy(scene.save.foundWild?.potato, 'a purchase is not a wild find');
  });

  test('ordinary pickup: inventory still refreshes immediately', () => {
    let refreshes = 0;
    const scene = {
      save: { inv: [], relics: {}, selSlot: -1 },
      _finishInventoryChange: finish,
      invEntriesForCat() { return [{ idx: 0 }]; },
      buildInventoryDOM() { refreshes++; },
    };
    assert.eq(addToInv.call(scene, 'potato', 2), 2);
    assert.eq(refreshes, 1);
    assert.eq(scene.save.foundWild.potato, 1);
    assert.eq(scene.save.selSlot, -1);
  });
})();
