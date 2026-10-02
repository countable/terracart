// Exercise the actual scene transaction with real inventory operations.
(() => {
  const start = SCENE_SRC.indexOf('\n  presentDeliveryOffer(sx, sy, house, recordDeal) {');
  const end = SCENE_SRC.indexOf('\n  }\n', start);
  const method = SCENE_SRC.slice(start + 1, end + 4);
  const bonus = Number(SCENE_SRC.match(/const DELIVERY_BONUS_MULT = ([\d.]+);/)[1]);
  const offer = new Function('Inventory', 'PRICES', 'DELIVERY_BONUS_MULT', 'itemName', 'Delivery', 'addMoney',
    `return ({${method}}).presentDeliveryOffer;`)(Inventory, PRICES, bonus, itemName, Delivery,
      (save, amount) => { save.money = (save.money || 0) + amount; });
  function scene(wanted) {
    const calls = { records: 0, quests: 0, discoveries: 0, flashes: [] };
    const s = {
      save: { inv: wanted.map(id => ({ id, count: 8 })), money: 0, deliveryCount: 2 },
      isHouseSatisfied: () => !!calls.discoveries,
      wantedProduce: () => wanted,
      iconSpanHTML: id => `<i>${id}</i>`, moneyHTML: text => text,
      showOfferModal(options) { this.offer = options; },
      flash(text) { calls.flashes.push(text); },
      _clampSelSlot() {}, questEvent() { calls.quests++; },
      _bankDiscovery() { calls.discoveries++; return true; },
      _finishInventoryChange() {}, flashLoot() {}, flashShiny() {}, _storySplashOnce() {},
    };
    offer.call(s, 0, 0, { id: 'house' }, () => calls.records++);
    return { s, calls };
  }
  for (const wanted of [['potato'], ['potato', 'onion', 'carrot']]) {
    test(`delivery offer: ${wanted.length} requested kinds consume exactly one order without quantity controls`, () => {
      const { s, calls } = scene(wanted);
      assert.eq(s.offer.quantity, undefined);
      for (const id of wanted) assert.truthy(s.offer.cost.includes(itemName(id)), `${id} named`);
      assert.eq((s.offer.cost.match(/×1/g) || []).length, wanted.length, 'each requested amount shown');
      s.offer.onAccept(99); // Old callers cannot multiply a household's order.
      for (const id of wanted) assert.eq(Inventory.count(s.save, id), 7);
      assert.eq(s.save.money, Math.max(1, Math.round(wanted.reduce((n, id) => n + Math.max(1, PRICES[id] ?? 1), 0) * bonus)));
      assert.eq(s.save.deliveryCount, 3);
      assert.eq(calls.records, 1);
      assert.eq(calls.quests, 1);
      assert.eq(calls.discoveries, 1);
      const money = s.save.money;
      s.offer.onAccept();
      assert.eq(s.save.money, money, 'a repeated accept cannot pay again');
      for (const id of wanted) assert.eq(Inventory.count(s.save, id), 7);
    });
  }
  test('delivery offer: losing one requested item while the offer is open removes nothing and pays nothing', () => {
    const { s, calls } = scene(['potato', 'onion']);
    Inventory.remove(s.save, 'onion', 8);
    s.offer.onAccept();
    assert.eq(Inventory.count(s.save, 'potato'), 8);
    assert.eq(s.save.money, 0);
    assert.eq(s.save.deliveryCount, 2);
    assert.eq(calls.records, 0);
    assert.eq(calls.discoveries, 0);
    assert.eq(calls.quests, 0);
    assert.truthy(calls.flashes.length);
  });
})();
