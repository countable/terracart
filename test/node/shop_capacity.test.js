(function () {
  const methods = ['_presentThemedItem', '_buildThemedItemOffer', '_buildRelicOffer', '_spendMoney', '_gearUpgradeOk', '_shopBagSpaceReason', 'buildShopOffer', '_settleDeal'].map(name => {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    return SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start) + 4);
  });
  const proto = (0, eval)('({' + methods.join(',') + '})');
  function fixture(held, money = 100) {
    const save = { money, inv: [{ id: 'potato_seed', count: held }], relics: {} };
    const scene = Object.assign(Object.create(proto), {
      save, shopLine: () => ({ theme: 'seed', tier: 1 }), shopRng: () => () => 0, shopCharmMul: () => 1, priceMul: () => 1, guildPrice: (_h, n) => n,
      moneyHTML: n => String(n), iconSpanHTML: () => '',
      buildingFlavorTitle: () => 'Seed Shop', shopTierBadgeHTML: () => '',
      invRoomFor: id => Inventory.roomFor(save, id), _themedStockCount: () => 1,
      showOfferModal(offer) { this.offer = offer; },
      addToInv: (id, n) => Inventory.add(save, id, n),
      _finishInventoryChange() {}, flashLoot() {}, flash() {},
      deals: 0,
    });
    scene._presentThemedItem(0, 0, { id: 'seed-shop' }, () => scene.deals++, 'potato_seed');
    return scene;
  }
  test('book shop: saved shelf prices cannot bypass the climbing book price', () => {
    const s = fixture(0, 1000);
    s.shopLine = () => ({ theme: 'book', tier: 1 });
    s.save.booksBought = 4;
    const quote = s._buildThemedItemOffer(0, 0, { id: 'book-shop' }, () => {}, 'book',
      { id: 'book', units: 1, price: 1 });
    const before = s.save.money;
    quote.onAccept();
    assert.gt(before - s.save.money, 1, 'ignores stale shelf quote');
    assert.eq(s.save.booksBought, 5);
  });
  test('seed shop: affordable pack explains insufficient bag room separately from money', () => {
    for (const held of [7, 8, 9]) {
      const s = fixture(held);
      assert.eq(s.offer.canAfford, true);
      assert.includes(s.offer.disabledReason, `${held}/9`);
      assert.includes(s.offer.disabledReason, 'room for 3');
      assert.eq(s.offer.onAccept(), false);
      assert.eq(s.save.money, 100, 'no charge for a pack that cannot fit');
      assert.eq(Inventory.count(s.save, 'potato_seed'), held);
      assert.eq(s.deals, 0);
    }
  });
  test('seed shop: a full pack fits at the exact boundary and purchases normally', () => {
    const s = fixture(6);
    assert.eq(s.offer.canAfford, true);
    assert.falsy(s.offer.disabledReason);
    assert.eq(s.offer.onAccept(), true);
    assert.eq(Inventory.count(s.save, 'potato_seed'), 9);
    assert.lt(s.save.money, 100);
    assert.eq(s.deals, 1);
  });
  test('seed shop: money and capacity are rechecked before charging', () => {
    for (const change of ['money', 'capacity']) {
      const s = fixture(6);
      if (change === 'money') s.save.money = 0;
      else Inventory.add(s.save, 'potato_seed', 1);
      const before = s.save.money;
      assert.eq(s.offer.onAccept(), false);
      assert.eq(s.save.money, before);
      assert.eq(s.deals, 0);
    }
    const poor = fixture(0, 0);
    assert.eq(poor.offer.canAfford, false);
    assert.falsy(poor.offer.disabledReason, 'space is not blamed for insufficient cash');
  });
  test('seed shop: equipping a larger bag permits the same pack', () => {
    const s = fixture(8);
    s.save.relics.bag = { tier: 1 };
    s._presentThemedItem(0, 0, { id: 'seed-shop' }, () => s.deals++, 'potato_seed');
    assert.falsy(s.offer.disabledReason);
    assert.eq(s.offer.onAccept(), true);
    assert.eq(Inventory.count(s.save, 'potato_seed'), 11);
    assert.eq(s.deals, 1);
  });
  test('shop quote: successful purchase does not require a deal counter callback', () => {
    const s = fixture(0);
    s.showOfferModal = () => { throw new Error('building a quote must not open a dialog'); };
    const quote = s._buildThemedItemOffer(0, 0, { id: 'seed-shop' }, null, 'potato_seed');
    assert.eq(quote.onAccept(), true);
    assert.eq(s.deals, 0);
    assert.eq(Inventory.count(s.save, 'potato_seed'), 3);
  });
  test('relic quote: acceptance reports success and rejects changed money or gear', () => {
    for (const change of ['none', 'money', 'gear']) {
      const s = fixture(0);
      s.gearIconHTML = () => '';
      s.markRelicsDirty = () => {};
      s._equipGear = (_kind, slot, tier) => { s.save.relics[slot] = { tier }; };
      const quote = s._buildRelicOffer(0, 0,
        { kind: 'relic', slot: 'sword', tier: 2, price: 20 }, null, { id: 'relic-shop' });
      assert.eq(quote.canAfford, true);
      assert.falsy(quote.disabledReason);
      if (change === 'money') s.save.money = 0;
      if (change === 'gear') s.save.relics.sword = { tier: 3 };
      const before = s.save.money;
      assert.eq(quote.onAccept(), change === 'none');
      assert.eq(s.save.money, change === 'none' ? before - 20 : before);
      assert.eq(s.save.relics.sword?.tier, change === 'none' ? 2 : change === 'gear' ? 3 : undefined);
    }
  });
})();
