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
      invRoomFor(id) { return Inventory.roomFor(this.save, id); },
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

  test('shop purchase: a full output stack preserves payment and the deal', () => {
    let modal, deals = 0, consumed = 0;
    const scene = {
      save: { money: 20, inv: [{ id: 'potato', count: 9 }], relics: {}, selSlot: -1 },
      addToInv, _finishInventoryChange: finish,
      invRoomFor(id) { return Inventory.roomFor(this.save, id); },
      buildShopOffer() {
        return { canAfford: () => true, consume: () => { consumed++; this.save.money -= 5; } };
      },
      showOfferModal(m) { modal = m; },
      buildingFlavorTitle: () => '', iconSpanHTML: () => '', flashLoot() {},
      flash(t) { this.denial = t; }, _themedStockCount: () => 1,
    };
    method('_presentThemedItem').call(scene, 0, 0, { id: 'shop' }, () => { deals++; }, 'potato');
    assert.falsy(modal.canAfford, 'the buy button is disabled when the whole bundle cannot fit');
    modal.onAccept();
    assert.eq(consumed, 0, 'payment stays');
    assert.eq(deals, 0, 'the hourly deal stays');
    assert.eq(scene.save.money, 20, 'money stays');
    assert.eq(Inventory.count(scene.save, 'potato'), 9, 'the stack stays');
    assert.truthy(/Bag full for Potato/.test(scene.denial || ''), `names the full stack: ${scene.denial}`);

    const guards = APP_JS_SRC.match(/if \(this\.invRoomFor\(id\) < buyQty\)/g) || [];
    assert.eq(guards.length, 2, 'both cash-item purchase paths recheck room before payment');
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
