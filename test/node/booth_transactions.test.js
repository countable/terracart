(function () {
  const boothTest = (name, fn) => test(name, () => {
    const previous = document.getElementById;
    document.getElementById = () => null;
    try { fn(); } finally { document.getElementById = previous; }
  });
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})')()[name];
  }
  function fixture(over = {}) {
    const s = {
      save: { inv: [], money: 10000, relics: {}, energy: 20, selSlot: 0 },
      offers: [], messages: [], events: [],
      showOfferModal(o) { this.offers.push(o); },
      showMessageModal(o) { this.messages.push(o); },
      moneyHTML: n => `<coin>${n}</coin>`, iconSpanHTML: () => '',
      flash() {}, flashLoot() {}, updateHUD() {}, _popEnergy() {},
      _finishInventoryChange() { this.events.push('committed'); },
      _clampSelSlot() {}, memoriesTotal: () => 100,
      getMaxEnergy: () => 100, _zeroEnergyLocked: () => false,
      _revealPendingBookReads() { this.events.push('read'); },
      ...over,
    };
    for (const name of ['_macroStory', '_storySplashOnce', '_macroTransaction', '_drainMacroTransactions', '_presentInn',
      '_presentCurio', '_presentTraining', '_presentStallOffer', '_settleDeal', '_guildBountyDefeat']) s[name] = method(name);
    s.invRoomFor = id => Inventory.roomFor(s.save, id);
    s.addToInv = (id, n, flash, opts) => { s.grantOptions = opts; return Inventory.add(s.save, id, n).accepted; };
    return s;
  }
  boothTest('booth intro: each physical booth introduces once, including same-kind neighbours', () => {
    const s = fixture(); let continued = 0;
    assert.truthy(s._macroStory('inn', () => continued++, { id: 'a' }));
    assert.eq(continued, 0);
    s.messages[0].onDismiss(); assert.eq(continued, 1);
    assert.falsy(s._macroStory('inn', () => continued++, { id: 'a' }));
    assert.truthy(s._macroStory('inn', () => continued++, { id: 'b' }));
    assert.eq(s.messages.length, 2);
    assert.eq(s.messages[0].art, 'booth_inn_intro');
    assert.eq(s.save.storySeen['macro:inn:a'], 1);
    assert.eq(s.save.storySeen['macro:inn:b'], 1);
  });
  boothTest('booth receipt: all nine services use their matching art and dialog category', () => {
    const s = fixture();
    for (const kind of Object.keys(Macros.KIND_TRANSACTION)) {
      s._macroTransaction(kind, 'An actual outcome.');
      const m = s.messages.at(-1);
      assert.eq(m.art, `booth_${kind}_used`);
      assert.eq(m.kind, Macros.KIND_DIALOG[kind].modal);
      assert.eq(m.kindLabel, Macros.KIND_DIALOG[kind].label);
      assert.eq(m.body, 'An actual outcome.');
    }
    assert.eq(s.messages.length, 9);
  });
  boothTest('booth inn: receipt follows payment and healing; repeated daily use cannot show success', () => {
    const s = fixture(); const o = { id: 'inn-receipt' };
    s._presentInn(0, 0, o, {}); s.offers[0].onAccept();
    assert.eq(s.save.energy, 100);
    assert.includes(s.messages[0].body, '80 HP');
    assert.includes(s.messages[0].body, s.moneyHTML(Macros.innPrice(80)));
    assert.eq(s.messages[0].art, 'booth_inn_used');
    s.offers[0].onAccept(); assert.eq(s.messages.length, 1);
  });
  boothTest('booth shop: each tap buys one, refreshes the price, and leaves book reading until Leave', () => {
    const s = fixture();
    const opts = { items: ['book'], boothKind: 'scriptorium' };
    const price = () => ShopsMath.standPrice(s.save, ShopsMath.listPrice(s.save, 'book'));
    let paid = 0;
    s._presentStallOffer(0, 0, opts);
    for (let i = 0; i < 2; i++) {
      const offer = s.offers.at(-1);
      assert.eq(offer.quantity, undefined);
      assert.eq(offer.cancelLabel, 'Leave');
      assert.includes(offer.cost, s.moneyHTML(price()));
      paid += price();
      offer.onAccept();
      offer.repeat();
      assert.eq(s.save.money, 10000 - paid);
      assert.eq(Inventory.count(s.save, 'book'), i + 1);
    }
    assert.truthy(s.grantOptions.deferBookRead);
    assert.eq(s.messages.length, 0, 'receipts do not interrupt repeated purchases');
    assert.eq(s.events.join(), 'committed,committed');
    s.offers.at(-1).onCancel();
    assert.eq(s.events.join(), 'committed,committed,read');
  });
  boothTest('booth shop: insufficient cash or a refused grant neither charges nor confirms', () => {
    for (const why of ['money', 'bag']) {
      const s = fixture();
      s._presentStallOffer(0, 0, { items: ['wood'], boothKind: 'sundries' });
      if (why === 'money') s.save.money = 0;
      else s.addToInv = () => 0;
      const before = s.save.money;
      s.offers[0].onAccept(1);
      assert.eq(s.save.money, before);
      assert.eq(s.messages.length, 0);
    }
  });
  boothTest('booth training: lesson and drill report the paid price, level and duration', () => {
    const s = fixture(), o = { id: 'training-receipt' };
    const kind = Macros.trainingKindFor(o);
    s._presentTraining(0, 0, o, {});
    s.offers[0].onAccept();
    assert.eq(Combat.trainingLevel(s.save, kind), 1);
    assert.includes(s.messages[0].body, 'level 1');
    assert.includes(s.messages[0].body, 'permanent');
    s.offers[0].secondary.onClick();
    assert.includes(s.messages[1].body, shortDuration(Combat.TRAINING_BUFF_MS));
    s.offers[0].secondary.onClick(); assert.eq(s.messages.length, 2);
  });
  boothTest('booth curio: milestone is banked before receipt and duplicate donations have no receipt', () => {
    const s = fixture();
    s.save.donated = Macros.curioCollection().slice(0, 4);
    const id = Macros.curioCollection()[4]; Inventory.add(s.save, id, 1);
    s._bankDiscovery = key => { s.events.push(key); };
    s._presentCurio(0, 0, {}, {}); s.offers[0].onAccept();
    assert.eq(Inventory.count(s.save, id), 0);
    assert.includes(s.events.join(), 'curio:5');
    assert.includes(s.messages[0].body, '5 curios');
    assert.includes(s.messages[0].body, 'memory has returned');
    s.offers[0].onAccept(); assert.eq(s.messages.length, 1);
  });
  boothTest('booth guildhall: receipt repeats for completed bounties but never pays a pack twice', () => {
    const s = fixture();
    for (let i = 0; i < 2; i++) {
      s.save.guildBounty = { id: 'hunt' + i, pay: 30, foes: [{ id: 'foe' + i }] };
      const victim = { id: 'foe' + i, bounty: 'hunt' + i };
      s._guildBountyDefeat(victim); s._guildBountyDefeat(victim);
    }
    assert.eq(s.messages.length, 2);
    assert.eq(s.save.money, 10060);
    assert.includes(s.messages[0].body, s.moneyHTML(30));
  });
  boothTest('booth bounty: a busy shop keeps its dialog while the paid receipt waits', () => {
    const s = fixture();
    const previous = document.body;
    let busy = true;
    document.body = { classList: { contains: () => busy } };
    try {
      s.save.guildBounty = { id: 'busy-hunt', pay: 30, foes: [{ id: 'busy-foe' }] };
      s._guildBountyDefeat({ id: 'busy-foe', bounty: 'busy-hunt' });
      assert.eq(s.save.money, 10030);
      assert.eq(s.messages.length, 0, 'the open shop has not been replaced');
      assert.eq(s._macroReceipts.length, 1);
      assert.falsy(s._drainMacroTransactions());
      busy = false;
      assert.truthy(s._drainMacroTransactions());
      assert.eq(s.messages.length, 1);
      assert.eq(s.messages[0].art, 'booth_guildhall_used');
      assert.falsy(s._drainMacroTransactions());
    } finally { document.body = previous; }
  });
  boothTest('booth chapel: full-fit blessing uses receipt art; leaving a full bag keeps the gift unclaimed', () => {
    const oldPick = globalThis.pickReward, oldHome = HomeArea.worldM;
    HomeArea.worldM = null;
    globalThis.pickReward = () => ({ kind: 'item', id: 'wood', qty: 3 });
    try {
      for (const full of [false, true]) {
        const s = fixture(); s.save.opened = [];
        const ceremonies = [];
        s.showChestRewardModal = p => ceremonies.push(p);
        s.invRoomFor = () => full ? 0 : 9;
        s._macroStory = () => false;
        const o = { id: 'chapel' + full, kind: 'chest', poiClass: 'place_of_worship', x: 0, y: 0 };
        INTERACTABLES.chest.custom(makeCtx(s, s.save), o);
        assert.eq(ceremonies.length, 1);
        assert.eq(ceremonies[0].art, full ? 'booth_chapel_intro' : 'booth_chapel_used');
        if (full) ceremonies[0].actions[0].onClick();
        assert.eq(Macros.serviceUsedToday(s.save, o.id), !full);
        assert.eq(Inventory.count(s.save, 'wood'), full ? 0 : 3);
        assert.eq(s.messages.length, 0, 'the chest receipt is the only panel');
      }
    } finally { globalThis.pickReward = oldPick; HomeArea.worldM = oldHome; }
  });
  boothTest('booth chapel: a partial take confirms only the items that actually fit', () => {
    const oldPick = globalThis.pickReward, oldHome = HomeArea.worldM;
    HomeArea.worldM = null;
    globalThis.pickReward = () => ({ kind: 'item', id: 'wood', qty: 3 });
    try {
      const s = fixture(); s.save.opened = []; Inventory.add(s.save, 'wood', 8);
      const ceremonies = [];
      s.showChestRewardModal = p => ceremonies.push(p);
      s._macroStory = () => false;
      const o = { id: 'chapel-partial', kind: 'chest', poiClass: 'place_of_worship', x: 0, y: 0 };
      INTERACTABLES.chest.custom(makeCtx(s, s.save), o);
      assert.eq(ceremonies[0].art, 'booth_chapel_intro');
      ceremonies[0].actions[1].onClick();
      assert.eq(Inventory.count(s.save, 'wood'), 9);
      assert.eq(s.messages[0].art, 'booth_chapel_used');
      assert.includes(s.messages[0].body, 'Wood ×1');
      assert.truthy(Macros.serviceUsedToday(s.save, o.id));
      ceremonies[0].actions[1].onClick(); assert.eq(s.messages.length, 1);
    } finally { globalThis.pickReward = oldPick; HomeArea.worldM = oldHome; }
  });
  boothTest('booth curio: its receipt waits ahead of the queued memory story', () => {
    const s = fixture();
    const previous = document.body;
    let busy = false;
    document.body = { classList: { contains: () => busy } };
    s.showMessageModal = m => { s.messages.push(m); busy = true; };
    MemoryStory.enqueue(s.save, 1, 'a curio');
    s._drainBadgeStories = method('_drainBadgeStories');
    try {
      s._macroTransaction('curio', 'You donated a curio and recovered a memory.');
      s._drainBadgeStories();
      assert.eq(s.messages.length, 1);
      assert.eq(s.save.memoryStory.pending.length, 1);
      assert.eq(s.messages[0].art, 'booth_curio_used');
      busy = false;
      s._drainBadgeStories();
      assert.eq(s.messages.length, 2);
      assert.truthy(s.messages[1].mustAcknowledge);
      s.messages[1].onDismiss();
      assert.eq(s.save.memoryStory.pending.length, 0);
    } finally { document.body = previous; }
  });
  boothTest('booth receipt dismissal: backdrop and OK each continue at most once, required acknowledgements stay required', () => {
    const show = method('showMessageModal');
    for (const mustAcknowledge of [false, true]) {
      let options, click, n = 0;
      const s = { makeModalShell(id, opts) {
        options = opts;
        return { wrap: { remove() {} }, box: { appendChild() {} }, mount() {},
          mkBtn: () => ({ addEventListener(type, fn) { click = fn; } }) };
      } };
      show.call(s, { title: 'Done', body: 'A book was bought.', kindLabel: 'Scriptorium',
        mustAcknowledge, onDismiss: () => n++ });
      assert.eq(options.kindLabel, 'Scriptorium');
      if (mustAcknowledge) assert.eq(options.onClose, undefined);
      else options.onClose();
      click({ stopPropagation() {} }); click({ stopPropagation() {} });
      assert.eq(n, 1);
    }
  });
})();
