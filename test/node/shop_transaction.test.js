(() => {
  function method(name) {
    const match = SCENE_SRC.match(new RegExp('^  ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'));
    if (!match) throw new Error('Missing scene method: ' + name);
    return new Function('return ({' + match[0] + '})')()[name];
  }
  const addToInv = method('addToInv');
  const finish = method('_finishInventoryChange');
  const settle = method('_settleDeal');

  test('campfire: borrowed tomes cannot be burned, including stale confirmation', () => {
    let modal;
    const getElementById = document.getElementById;
    document.getElementById = () => null;
    try {
      const scene = {
        save: { inv: [{ id: 'tome_healing', count: 1 }], selSlot: 0, scholarLoans: {} },
        worldIconHTML: () => '', iconSpanHTML: () => '', flash() {},
        showOfferModal(m) { modal = m; },
      };
      method('presentBurnConfirm').call(scene, 'tome_healing');
      assert.truthy(modal, 'owned tome may be burned');
      scene.save.scholarLoans.tome_healing = 1;
      modal.onAccept();
      assert.eq(Inventory.count(scene.save, 'tome_healing'), 1, 'stale confirmation preserves loan');
      modal = null;
      method('presentBurnConfirm').call(scene, 'tome_healing');
      assert.eq(modal, null, 'borrowed tome has no burn offer');
    } finally {
      document.getElementById = getElementById;
    }
  });

  test('barter: borrowed tomes cannot pay, including a stale accepted offer', () => {
    let modal, rewards = 0;
    const scene = {
      save: { inv: [{ id: 'tome_healing', count: 1 }], scholarLoans: {} },
      peekOrBuildTraderOffer: () => ({ giveId: 'wood', askId: 'tome_healing', askQty: 1 }),
      iconSpanHTML: () => '', _traderRerollSecondary: () => null,
      showOfferModal(m) { modal = m; }, flash() {},
      addToInv() { rewards++; }, _clampSelSlot() {}, _settleDeal() {},
    };
    method('presentTraderOffer').call(scene, 0, 0, { id: 'trader' }, () => {});
    assert.truthy(modal.canAfford, 'owned copy can pay');
    scene.save.scholarLoans.tome_healing = 1;
    modal.onAccept();
    assert.eq(rewards, 0, 'loan never becomes barter goods');
    assert.eq(Inventory.count(scene.save, 'tome_healing'), 1);
    method('presentTraderOffer').call(scene, 0, 0, { id: 'trader' }, () => {});
    assert.falsy(modal.canAfford, 'borrowed copy does not enable the offer');
  });

  test('shop purchase: one inventory refresh observes payment, grant and deal together', () => {
    let modal, deals = 0, refreshes = 0;
    const scene = {
      save: { money: 20, inv: [], relics: {}, selSlot: -1 },
      addToInv, _finishInventoryChange: finish, _settleDeal: settle,
      shopLine: () => ({ tier: 1 }), shopRng: () => () => 0,
      _shopBagSpaceReason: method('_shopBagSpaceReason'),
      _buildThemedItemOffer: method('_buildThemedItemOffer'),
      invDisplayEntriesForCat() { return this.save.inv.map((entry, idx) => ({ entry, idx })); },
      buildInventoryDOM() {
        refreshes++;
        assert.eq(this.save.money, 15);
        assert.eq(Inventory.count(this.save, 'potato'), 1);
        assert.eq(deals, 1, 'bookkeeping precedes the refresh');
      },
      buildShopOffer() { return { canAfford: () => true, consume: () => { this.save.money -= 5; } }; },
      showOfferModal(m) { modal = m; },
      invRoomFor(id) { return Inventory.roomFor(this.save, id); },
      shopTierBadgeHTML: () => '', buildingFlavorTitle: () => '', iconSpanHTML: () => '', flashLoot() {},
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
      addToInv, _finishInventoryChange: finish, _settleDeal: settle,
      shopLine: () => ({ tier: 1 }), shopRng: () => () => 0,
      _shopBagSpaceReason: method('_shopBagSpaceReason'),
      _buildThemedItemOffer: method('_buildThemedItemOffer'),
      invRoomFor(id) { return Inventory.roomFor(this.save, id); },
      buildShopOffer() {
        return { canAfford: () => true, consume: () => { consumed++; this.save.money -= 5; } };
      },
      showOfferModal(m) { modal = m; },
      shopTierBadgeHTML: () => '', buildingFlavorTitle: () => '', iconSpanHTML: () => '', flashLoot() {},
      flash(t) { this.denial = t; }, _themedStockCount: () => 1,
    };
    method('_presentThemedItem').call(scene, 0, 0, { id: 'shop' }, () => { deals++; }, 'potato');
    assert.truthy(modal.canAfford, 'the price is affordable');
    assert.truthy(modal.disabledReason, 'capacity disables the button with a visible reason');
    modal.onAccept();
    assert.eq(consumed, 0, 'payment stays');
    assert.eq(deals, 0, 'the hourly deal stays');
    assert.eq(scene.save.money, 20, 'money stays');
    assert.eq(Inventory.count(scene.save, 'potato'), 9, 'the stack stays');
    assert.truthy(/Bag full for\nPotato/.test(scene.denial || ''), `names the full stack: ${scene.denial}`);

    const guards = SCENE_SRC.match(/if \(this\.invRoomFor\(id\) < buyQty\)/g) || [];
    assert.eq(guards.length, 2, 'both cash-item purchase paths recheck room before payment');
  });

  test('ordinary pickup: inventory still refreshes immediately', () => {
    let refreshes = 0;
    const scene = {
      save: { inv: [], relics: {}, selSlot: -1 },
      _finishInventoryChange: finish,
      invDisplayEntriesForCat() { return [{ idx: 0 }]; },
      buildInventoryDOM() { refreshes++; },
    };
    assert.eq(addToInv.call(scene, 'potato', 2), 2);
    assert.eq(refreshes, 1);
    assert.eq(scene.save.foundWild.potato, 1);
    assert.eq(scene.save.selSlot, -1);
  });
})();
