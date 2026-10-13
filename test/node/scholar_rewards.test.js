(function () {
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})')()[name];
  }
  function fixture(read = 12) {
    return {
      save: { booksRead: read, money: 20, inv: [], relics: {}, selSlot: -1 }, refreshes: 0,
      _scholarTransaction: method('_scholarTransaction'),
      _clampSelSlot() {},
      _finishInventoryChange() { this.refreshes++; this.persisted = JSON.parse(JSON.stringify(this.save)); },
    };
  }
  test('scholar lending: persist inventory and reserved credits together without spending Books or coins', () => {
    const s = fixture(), id = Macros.scholarShelf()[0];
    assert.truthy(s._scholarTransaction('borrow', id).ok);
    assert.eq(s.persisted.scholarLoans[id], 1);
    assert.eq(Inventory.count(s.persisted, id), 1);
    assert.eq(s.persisted.booksRead, 12);
    assert.eq(s.persisted.money, 20);
    assert.eq(s.refreshes, 1);
    assert.eq(s.save.selSlot, -1, 'borrowing does not choose a spell for the player');
    assert.falsy(s.save.foundWild?.[id], 'a loan does not become a wild find');
    assert.truthy(s._scholarTransaction('return', id).ok);
    assert.eq(Macros.scholarCredits(s.persisted).used, 0);
    assert.eq(Inventory.count(s.persisted, id), 0);
  });
  test('scholar lending: repeated actions recheck credit and failed actions never persist', () => {
    const s = fixture(5), id = Macros.scholarShelf()[0];
    assert.truthy(s._scholarTransaction('borrow', id).ok);
    assert.eq(s._scholarTransaction('borrow', id).why, 'credit');
    assert.eq(s.refreshes, 1);
    assert.truthy(s._scholarTransaction('return', id).ok);
    assert.eq(s._scholarTransaction('return', id).why, 'notBorrowed');
    assert.eq(s.refreshes, 2);
  });
  test('scholar lending: returning preserves the selected item and a resting spell across reload', () => {
    const s = fixture(), id = Macros.scholarShelf()[0];
    s._scholarTransaction('borrow', id);
    Inventory.add(s.save, 'torch', 1);
    s.save.selSlot = 1;
    s.save.tomeMagicCd = { [id]: Date.now() + 60000 };
    const until = s.save.tomeMagicCd[id];
    s._scholarTransaction('return', id);
    assert.eq(s.save.selSlot, 0);
    assert.eq(getSelectedSlot(s.save).id, 'torch');
    assert.eq(s.persisted.tomeMagicCd[id], until);
    s.save = JSON.parse(JSON.stringify(s.persisted));
    s._scholarTransaction('borrow', id);
    assert.eq(s.save.tomeMagicCd[id], until);
    s.save.selSlot = s.save.inv.findIndex(stack => stack.id === id);
    s._scholarTransaction('return', id);
    assert.eq(s.save.selSlot, -1, 'returning the selected tome clears the selection');
  });
  test('scholar lending: Home refuses a borrowed tome, including a stale sale confirmation', () => {
    const s = fixture(), id = Macros.scholarShelf()[0];
    Object.assign(s, {
      presentHomeSell: method('presentHomeSell'), _homeTabs: () => [], _homeKindIcon: () => undefined,
      showOfferModal(o) { this.offer = o; }, iconSpanHTML: () => '', moneyHTML: String, flash() {},
    });
    Inventory.add(s.save, id, 1);
    s.save.selSlot = 0;
    s.presentHomeSell(0, 0);
    const old = s.offer;
    s.save.scholarLoans = { [id]: 1 };
    old.onAccept();
    assert.eq(s.save.money, 20);
    assert.eq(Inventory.count(s.save, id), 1);
    s.presentHomeSell(0, 0);
    assert.falsy(s.offer.canAfford);
    assert.includes(s.offer.blurb, 'cannot be sold');
  });
})();
