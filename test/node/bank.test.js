// THE BANK (banks and ATMs — src/macros.js BANK, scene_venues.js
// _presentBank / _tickBankDebt): borrow or invest a day per counter, in three
// sizes; a loan falls due after a day with interest and a pirate collects it.
(function () {
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = Date.UTC(2026, 9, 11, 10, 0, 0);
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})')()[name];
  }
  const bankTest = (name, fn) => test(name, () => {
    const previous = document.getElementById;
    document.getElementById = () => null;
    try { fn(); } finally { document.getElementById = previous; }
  });
  // A bank id whose offer on day `now` is `kind` (the pick is the world's).
  const bankFor = (kind, now = T0) => {
    for (let i = 0; i < 100; i++) {
      const o = { kind: 'chest', poiClass: 'bank', id: 'bank-' + i };
      if (Macros.bankOfferKind(o, now) === kind) return o;
    }
    throw new Error('no bank offers ' + kind);
  };
  function fixture(save = {}) {
    const s = {
      save: SaveState.defaults({ inv: [], money: 0, relics: {}, discovered: {}, ...save }),
      offers: [], messages: [], flashes: [], receipts: [],
      showOfferModal(o) { this.offers.push(o); },
      showMessageModal(o) { this.messages.push(o); },
      moneyHTML: n => `<coin>${n}</coin>`, flashLoot() {}, coinIconEl() {},
      flashAtPlayer(t) { this.flashes.push(t); },
      _finishInventoryChange() {},
      _macroTransaction(kind, body) { this.receipts.push({ kind, body }); },
    };
    for (const name of ['_presentBank', '_tickBankDebt', '_presentBankCollector']) s[name] = method(name);
    return s;
  }

  test('bank: banks and ATMs are the bank booth, never a chest or a coin burst', () => {
    for (const cls of ['bank', 'atm']) {
      const o = { kind: 'chest', poiClass: cls, id: cls };
      assert.eq(macroFor(o).kind, 'bank', cls);
      assert.eq(chestLook(o).texKey, 'macro_bank');
      assert.eq(macroFor({ ...o, depth: 1 }), null, 'never underground');
    }
    assert.eq(Macros.KIND_DIALOG.bank.present, '_presentBank');
  });

  test('bank: the limit is 100 plus 25 a memory, in max / half / quarter shares', () => {
    assert.eq(Macros.bankLimit({ discovered: {} }), 100);
    assert.eq(Macros.bankLimit({ discovered: { a: 1, b: 1, c: 1, d: 1 } }), 200);
    assert.eq(Macros.bankAmounts(200).map(a => a.amount).join(), '200,100,50');
    assert.eq(Macros.bankAmounts(0).length, 0, 'nothing to offer');
    assert.eq(Macros.bankInvestCap({ discovered: {}, money: 60 }), 60, 'a deposit is capped by the purse');
    assert.eq(Macros.bankInvestCap({ discovered: {}, money: 600 }), 100, 'and by the limit');
    assert.eq(Macros.bankWithInterest(100), 120, '20% interest');
  });

  test('bank: each counter offers borrow or invest by a stable pick off its id and the day', () => {
    const kinds = new Set();
    for (let i = 0; i < 40; i++) {
      const o = { id: 'b' + i };
      const k = Macros.bankOfferKind(o, T0);
      assert.eq(Macros.bankOfferKind(o, T0 + 3600e3), k, 'the same all day');
      kinds.add(k);
    }
    assert.eq([...kinds].sort().join(), 'borrow,invest', 'both deals are offered');
  });

  test('bank: one loan at a time, one borrow a day; it falls due after a day at 20%', () => {
    const save = { money: 0, discovered: {}, coinBurstClaimed: {} };
    const o = { id: 'bank-a' };
    assert.truthy(Macros.bankBorrow(save, o, 100, T0));
    assert.eq(save.money, 100);
    assert.eq(save.bankLoan.owed, 120);
    assert.eq(Macros.bankBorrowBlock(save, T0), 'loan');
    assert.falsy(Macros.bankBorrow(save, o, 50, T0), 'no second loan');
    assert.eq(Macros.bankLoanDue(save, T0 + DAY - 1), null, 'not yet due');
    assert.eq(Macros.bankLoanDue(save, T0 + DAY).owed, 120, 'due after a day');
    assert.falsy(Macros.bankLoanSettle(save, true), 'a short purse cannot pay');
    assert.truthy(save.bankLoan, 'and the loan stays open');
    save.money = 500;
    assert.truthy(Macros.bankLoanSettle(save, true));
    assert.eq(save.money, 380);
    assert.eq(save.bankLoan, undefined);
    assert.eq(Macros.bankBorrowBlock(save, T0), 'today', 'one borrow a UTC day');
    assert.eq(Macros.bankBorrowBlock(save, T0 + DAY), null);
    assert.falsy(Macros.bankBorrow({ money: 0, discovered: {} }, o, 101, T0), 'never above the limit');
  });

  test('bank: a deposit returns 20% after a day, from the bank that holds it', () => {
    const save = { money: 300, discovered: {} };
    const a = { id: 'bank-a' }, b = { id: 'bank-b' };
    assert.falsy(Macros.bankInvest(save, a, 150, T0), 'above the limit');
    assert.truthy(Macros.bankInvest(save, a, 100, T0));
    assert.eq(save.money, 200);
    assert.falsy(Macros.bankInvest(save, a, 50, T0), 'one deposit at a time');
    assert.eq(Macros.bankWithdraw(save, a, T0 + DAY - 1), 0, 'not matured');
    assert.eq(Macros.bankWithdraw(save, b, T0 + DAY), 0, 'another bank does not hold it');
    assert.eq(Macros.bankWithdraw(save, a, T0 + DAY), 120);
    assert.eq(save.money, 320);
    assert.eq(save.bankInvest, undefined);
  });

  bankTest('bank dialog: borrow tabs offer max, half and quarter; the pick is paid out', () => {
    const s = fixture({ discovered: { a: 1, b: 1, c: 1, d: 1 } });
    const o = bankFor('borrow', Date.now());
    s._presentBank(0, 0, o, { kind: 'trade' });
    const offer = s.offers.at(-1);
    assert.eq(offer.tabs.map(t => t.label).join(), 'Max · 200,Half · 100,Quarter · 50');
    assert.includes(offer.get, '<coin>200</coin>');
    offer.tabs[2].onSelect();
    const quarter = s.offers.at(-1);
    assert.includes(quarter.get, '<coin>50</coin>');
    quarter.onAccept();
    assert.eq(s.save.money, 50);
    assert.eq(s.save.bankLoan.owed, 60);
    assert.eq(s.receipts.at(-1).kind, 'bank');
    s._presentBank(0, 0, o, { kind: 'trade' });
    assert.includes(s.messages.at(-1).body, 'already owe');
  });

  bankTest('bank dialog: invest takes the coins; the same bank pays them back with interest', () => {
    const s = fixture({ money: 80 });
    const o = bankFor('invest', Date.now());
    s._presentBank(0, 0, o, { kind: 'trade' });
    const offer = s.offers.at(-1);
    assert.eq(offer.tabs.map(t => t.label).join(), 'Max · 80,Half · 40,Quarter · 20', 'capped by the purse');
    offer.onAccept();
    assert.eq(s.save.money, 0);
    s.save.bankInvest.due = Date.now() - 1;
    s._presentBank(0, 0, o, { kind: 'trade' });
    const collect = s.offers.at(-1);
    assert.includes(collect.get, '<coin>96</coin>');
    collect.onAccept();
    assert.eq(s.save.money, 96);
  });

  bankTest('debt collector: a due loan brings a pirate beside the player, who asks; paying ends it', () => {
    const entry = { creatures: [] };
    const s = fixture({ money: 500 });
    Object.assign(s, { depth: 0, cellM: 5, tileEdgeM: 640, homeWorldPos: () => null,
      findWalkableDestination: (dist, opts) => { s.asked = { dist, opts }; return { entry, tx: 1, ty: 2, x: 10, y: 10 }; } });
    s.save.bankLoan = { principal: 100, owed: 120, due: Date.now() + DAY, bank: 'b' };
    s._tickBankDebt();
    assert.eq(entry.creatures.length, 0, 'not before it is due');
    s.save.bankLoan.due = Date.now() - 1;
    s._tickBankDebt();
    assert.eq(s.asked.dist, Macros.BANK_COLLECTOR_DIST_CELLS, 'he steps up beside the player');
    const c = entry.creatures[0];
    assert.eq(c.kind, Macros.BANK_COLLECTOR_KIND);
    assert.truthy(Pirates.isPirate(c) && c.debtCollector && c._pirateParleyPending, 'a pirate, calm while he asks');
    assert.truthy(/^debtor_1_2_/.test(c.id), 'an id the caught-prune knows');
    const ask = s.offers.at(-1);
    assert.includes(ask.get, '<coin>120</coin>');
    assert.eq(ask.cancelLabel, 'Refuse');
    s._tickBankDebt();
    assert.eq(entry.creatures.length, 1, 'one collector at a time');
    const prevCache = WorldGen.tileCache;
    WorldGen.tileCache = new Map([[WorldGen.tileKey(0, 0), entry]]);
    try { ask.onAccept(); } finally { WorldGen.tileCache = prevCache; }
    assert.eq(s.save.money, 380);
    assert.eq(s.save.bankLoan, undefined);
    assert.eq(entry.creatures.length, 0, 'paid, he leaves');
  });

  bankTest('debt collector: refusing (or a short purse) closes the loan and he fights', () => {
    const entry = { creatures: [] };
    const s = fixture({ money: 10 });
    Object.assign(s, { depth: 0, cellM: 5, tileEdgeM: 640, homeWorldPos: () => null,
      findWalkableDestination: () => ({ entry, tx: 0, ty: 0, x: 10, y: 10 }) });
    s.save.bankLoan = { principal: 100, owed: 120, due: Date.now() - 1, bank: 'b' };
    s._tickBankDebt();
    const ask = s.offers.at(-1), c = entry.creatures[0];
    assert.falsy(ask.canAfford, 'he cannot be paid from a short purse');
    ask.onCancel();
    assert.eq(s.save.bankLoan, undefined, 'the loan is closed');
    assert.eq(s.save.money, 10, 'nothing taken');
    assert.falsy(c._pirateParleyPending, 'no longer calm');
    assert.falsy(Combat.isPacified(c), 'he fights');
    assert.eq(entry.creatures.length, 1, 'and stays to fight');
  });

  test('debt collector: paid passage never calms him, and he offers no passage', () => {
    const c = { kind: Macros.BANK_COLLECTOR_KIND, id: 'debtor_0_0_1', debtCollector: true };
    const scene = { save: { piratePeaceUntil: Date.now() + DAY }, _pirateParleyPending: true };
    Pirates.sync(scene, c);
    assert.falsy(Combat.isPacified(c), 'passage does not cover a debt');
    assert.truthy(Pirates.isCollector(c));
    assert.falsy(Pirates.present(scene, c), 'no passage offer');
  });
})();
