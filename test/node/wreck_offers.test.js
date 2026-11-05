// Site offers are stable world identity, while completion is save-local.
(() => {
  const house = id => ({ kind: 'house', id, tier: 9 });
  function site(type) {
    for (let i = 0; i < 10000; i++) {
      const o = house(`offer-${i}`);
      if (Houses.wreckOffer({}, o)?.key === type) return o;
    }
    throw new Error('No fixture for ' + type);
  }
  test('wreck offers: deterministic 15% selection with three equally likely offers', () => {
    const counts = { discount: 0, blessed: 0, contract: 0 };
    for (let i = 0; i < 20000; i++) {
      const o = house(`h_${i}_${i * 17}`), a = Houses.wreckOffer({}, o);
      assert.eq(Houses.wreckOffer({}, JSON.parse(JSON.stringify(o)))?.key, a?.key);
      if (a) counts[a.key]++;
    }
    for (const key of Object.keys(counts)) {
      assert.truthy(counts[key] > 800 && counts[key] < 1200, key + ': ' + counts[key]);
    }
    assert.eq(Houses.WRECK_OFFER_CHANCE, .15);
  });
  test('wreck offers: house discounts halve every material price and round down', () => {
    const o = site('discount');
    assert.eq(Houses.buildCost({}, o, { role: 'turret' }).qty, 2);
    assert.eq(Houses.buildCost({}, o, { role: 'shop', tier: 1 }).qty, 1);
    assert.eq(Houses.constructionCost({}, o, 1), 0);
  });
  test('wreck offers: forts and castles never receive offers or completion rewards', () => {
    for (let i = 0; i < 1000; i++) {
      const fort = { ...house(`offer-${i}`), tier: 11 };
      const castle = { kind: 'tower', id: `offer-${i}`, castle: `b_${i}_41` };
      assert.eq(Houses.wreckOffer({}, fort), null);
      assert.eq(Houses.wreckOffer({}, castle), null);
      assert.eq(Houses.fortUnlockCost({}, fort), 6);
      const save = { unlockedForts: { [fort.id]: true }, restoredCastles: { [castle.castle]: true }, money: 7 };
      assert.eq(Houses.completeWreckOffer(save, fort), null);
      assert.eq(Houses.completeWreckOffer(save, castle), null);
      assert.eq(save.money, 7);
    }
  });
  test('wreck offers: contract pays once when any valid building is completed, survives reload', () => {
    const o = site('contract'), save = { inv: [], money: 7 };
    assert.eq(Houses.completeWreckOffer(save, o), null, 'unfinished wreck pays nothing');
    assert.eq(save.money, 7);
    assert.truthy(Houses.restoreAs(save, o, 'plain'));
    assert.eq(save.money, 57);
    assert.truthy(save.firstCoinPending, 'earned contract money joins normal coin discovery');
    assert.eq(save.wreckOffers[o.id], 'contract');
    assert.eq(Houses.wreckOffer(save, o), null);
    const loaded = SaveState.defaults(JSON.parse(JSON.stringify(save)));
    assert.eq(Houses.completeWreckOffer(loaded, o), null);
    assert.eq(Houses.restoreAs(loaded, o, 'plain'), null);
    assert.eq(loaded.money, 57);
  });
  test('wreck offers: blessing persists independently of the magic hammer', () => {
    const o = site('blessed'), save = { inv: [] };
    assert.falsy(Houses.isBlessedSite(save, o));
    assert.truthy(Houses.restoreAs(save, o, 'plain'));
    assert.truthy(Houses.isBlessedSite(save, o));
    assert.eq(Houses.rerollPriceMul(save, o), .67);
    assert.eq(Houses.priceMul(save, o), 1, 'no hammer purchase discount');
    assert.falsy(Houses.isShinyHouse(save, o), 'hammer ownership stays separate');
    assert.eq(Houses.wreckOffer(save, o), null);
  });
  test('wreck offers: Home, active Hives and Citadels never advertise a construction offer', () => {
    const o = site('blessed');
    assert.eq(Houses.wreckOffer({ starterShopId: o.id }, o), null);
    assert.eq(Houses.wreckOffer({}, { ...o, hive: 'mushroom' }), null);
    assert.eq(Houses.wreckOffer({}, { kind: 'tower', castle: 'citadel' }), null);
    assert.eq(Houses.wreckOffer({ restoredHouses: { [o.id]: 'plain' } }, o), null);
  });
})();
