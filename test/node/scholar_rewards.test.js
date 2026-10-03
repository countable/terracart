(function () {
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})')()[name];
  }
  function fixture(read = 3) {
    const save = { booksRead: read, money: 20, inv: [], relics: {} };
    const s = {
      save, offers: [], messages: [], refreshes: 0,
      _presentScholar: method('_presentScholar'),
      _macroTransaction: method('_macroTransaction'),
      _drainMacroTransactions: method('_drainMacroTransactions'),
      invRoomFor: id => Inventory.roomFor(save, id),
      iconSpanHTML: () => '',
      showOfferModal(o) { this.offers.push(o); },
      showMessageModal(o) { this.messages.push(o); },
      addToInv: (id, n) => Inventory.add(save, id, n).accepted,
      _finishInventoryChange() { this.refreshes++; this.persisted = JSON.parse(JSON.stringify(save)); },
      flashLoot() {},
    };
    s.open = () => s._presentScholar(0, 0, { id: 'school' }, { kind: 'trade' });
    return s;
  }
  test('scholar reward: three collected books grant a tome without spending reading or money', () => {
    const s = fixture(); s.open();
    const offer = s.offers[0];
    assert.eq(offer.acceptLabel, 'Collect');
    assert.falsy(offer.disabledReason);
    offer.onAccept();
    assert.eq(Inventory.count(s.save, Macros.scholarShelf()[0]), 1);
    assert.eq(s.save.booksRead, 3);
    assert.eq(s.save.money, 20);
    assert.eq(s.save.scholarTomes, 1);
    assert.eq(s.refreshes, 1);
    assert.eq(s.persisted.scholarTomes, 1, 'the same persisted state includes the reward and milestone');
    assert.eq(s.persisted.inv.length, 1);
  });
  test('scholar reward: a full bag preserves the earned milestone until there is room', () => {
    const s = fixture(), id = Macros.scholarShelf()[0];
    Inventory.add(s.save, id, 9); s.open();
    assert.truthy(s.offers[0].disabledReason);
    s.offers[0].onAccept();
    assert.eq(Macros.scholarTaken(s.save), 0);
    assert.eq(Inventory.count(s.save, id), 9);
    assert.eq(s.refreshes, 0);
    Inventory.remove(s.save, id, 1); s.open();
    assert.falsy(s.offers[1].disabledReason);
    s.offers[1].onAccept();
    assert.eq(Macros.scholarTaken(s.save), 1);
    assert.eq(Inventory.count(s.save, id), 9);
  });
  test('scholar reward: stale offers cannot pay twice or consume the following milestone', () => {
    const s = fixture(6); s.open(); s.open();
    s.offers[0].onAccept(); s.offers[1].onAccept();
    assert.eq(Macros.scholarTaken(s.save), 1);
    assert.eq(s.save.inv.length, 1);
    assert.eq(s.refreshes, 1);
    s.open(); s.offers[2].onAccept();
    assert.eq(Macros.scholarTaken(s.save), 2);
    assert.eq(s.save.inv.length, 2);
  });
  test('scholar reward: unfinished milestones explain the next tome and books needed', () => {
    const s = fixture(2); s.open();
    assert.eq(s.offers.length, 0);
    assert.includes(s.messages[0].body, itemName(Macros.scholarShelf()[0]));
    assert.includes(s.messages[0].body, 'Read 1 more');
    assert.includes(s.messages[0].body, 'Every 3 books');
  });
})();
