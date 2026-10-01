// Daily visits use the existing ledger and sequence story/reward dialogs.
(function () {
  const DAY = 86400000, T0 = Date.UTC(2026, 8, 30, 12);
  function at(now, fn) {
    const real = Date.now; Date.now = () => now;
    try { return fn(); } finally { Date.now = real; }
  }
  function harness(save = {}) {
    const stories = [], rewards = [], foods = [], flashes = [], offers = [];
    let pages = 0;
    const scene = makeScene({
      save,
      showMessageModal: m => stories.push(m),
      showConfirmModal: m => offers.push(m),
      showChestRewardModal: m => rewards.push(m),
      _bookRead: () => ({ body: 'Page ' + ++pages }),
      _consumeFoodEffects: id => foods.push(id),
      _revealPendingBookReads() {},
      flash: s => flashes.push(s),
    });
    return { scene, save, stories, rewards, foods, flashes, offers, pages: () => pages,
      tap: o => runInteractable(makeCtx(scene, save), o) };
  }

  test('daily visits: every idol tells its story on each successful day, never twice', () => at(T0, () => {
    for (const id of Shrines.KIND_IDS) {
      const h = harness({ energy: 80, inv: [], opened: [] });
      const o = { kind: 'grove_shrine', shrineKind: id, id: 'idol:' + id };
      h.tap(o);
      assert.eq(h.stories.length, 1, id);
      assert.eq(h.stories[0].art, Shrines.SHRINE_KINDS[id].art);
      assert.truthy(Macros.usedToday(h.save, o.id));
      h.tap(o);
      assert.eq(h.stories.length, 1, 'pending and used visits do not reopen');
      h.stories[0].onDismiss(); h.stories[0].onDismiss();
      at(T0 + DAY, () => h.tap(o));
      assert.eq(h.stories.length, 2, 'new UTC day gets a new panel');
      if (id === 'wayfarer_post') assert.eq(h.foods.length, 2, 'one Pairy per successful visit');
    }
  }));

  test('daily visits: waystone ignores old opened flags, grants one page after each daily story', () => at(T0, () => {
    const o = { kind: 'waystone', id: 'old_waystone' };
    const h = harness({ opened: [o.id] });
    h.tap(o);
    assert.eq(h.pages(), 0, 'book waits until the story closes');
    h.tap(o);
    assert.eq(h.stories.length, 1);
    h.stories[0].onDismiss(); h.stories[0].onDismiss();
    assert.eq(h.pages(), 1);
    assert.eq(h.stories[1].body, 'Page 1');
    h.tap(o);
    assert.eq(h.pages(), 1);
    at(T0 + DAY, () => { h.tap(o); h.stories[2].onDismiss(); });
    assert.eq(h.pages(), 2);
    assert.eq(h.save.opened.length, 1, 'no added permanent opened flags');
  }));

  test('daily visits: the notice board remains a one-time page', () => at(T0, () => {
    const h = harness({ opened: [] }), o = { kind: 'infoboard', id: 'board' };
    h.tap(o);
    assert.eq(h.pages(), 1);
    at(T0 + DAY, () => h.tap(o));
    assert.eq(h.pages(), 1);
    assert.includes(h.save.opened, o.id);
    assert.falsy(Macros.usedToday(h.save, o.id));
  }));

  test('daily visits: plain grove treasure waits for story dismissal and cannot pay twice', () => at(T0, () => {
    const h = harness({ opened: [], inv: [], relics: {}, armor: {}, money: 0 });
    let paid = 0;
    h.scene.flashLoot = () => paid++;
    const o = { kind: 'grove_shrine', id: 'grove' };
    h.tap(o);
    assert.eq(paid, 0);
    assert.eq(h.stories[0].art, Shrines.REWARD_KINDS.grove.art);
    h.stories[0].onDismiss(); h.stories[0].onDismiss();
    assert.eq(paid, 1);
    h.tap(o);
    assert.eq(paid, 1);
  }));

  const wagon = { kind: 'chest', id: 'daily-wagon', poiClass: 'bus_stop', banditStop: true };
  test('daily visits: wagon hires for fifty coins only after confirmation and tells the success story', () => at(T0, () => {
    const h = harness({ opened: [wagon.id], money: 75 });
    h.tap(wagon); h.tap(wagon);
    assert.eq(h.offers.length, 1, 'only one pending offer');
    assert.eq(h.save.money, 75);
    assert.falsy(Macros.usedToday(h.save, wagon.id));
    h.offers[0].onCancel();
    h.tap(wagon);
    h.offers[1].onAccept(); h.offers[1].onAccept();
    assert.eq(h.save.money, 25, 'paid once');
    assert.eq(h.save.mercenaryUntil, T0 + Companions.KINDS.mercenary.durationMs);
    assert.truthy(Macros.usedToday(h.save, wagon.id));
    assert.eq(h.stories.length, 1);
    assert.eq(h.stories[0].art, Macros.DAILY_VISIT_KINDS.wagon.art);
    assert.eq(h.rewards.length, 0, 'no supply lottery attached to hiring');
    h.stories[0].onDismiss();
    h.tap(wagon);
    assert.eq(h.offers.length, 2);
    at(T0 + DAY, () => {
      h.save.money = 100;
      h.tap(wagon); h.offers[2].onAccept();
      assert.eq(h.save.money, 50);
      assert.eq(h.stories.length, 2, 'each daily hire tells its story');
    });
  }));

  test('daily visits: poor or cancelled hires cost nothing; another wagon cannot duplicate an active ally', () => at(T0, () => {
    const h = harness({ money: 49 });
    h.tap(wagon);
    assert.eq(h.offers.length, 0);
    assert.eq(h.save.money, 49);
    assert.falsy(Macros.usedToday(h.save, wagon.id));
    h.save.money = 100;
    h.tap(wagon); h.offers[0].onAccept(); h.stories[0].onDismiss();
    h.tap({ ...wagon, id: 'other-wagon' });
    assert.eq(h.offers.length, 1);
    assert.eq(h.save.money, 50);
    assert.falsy(Macros.usedToday(h.save, 'other-wagon'));
  }));

  test('daily visits: bike retains speed and gold remains a coin-only reward', () => at(T0, () => {
    const bike = { kind: 'chest', id: 'bike', poiClass: 'bicycle_parking' };
    const h = harness({}); h.tap(bike);
    assert.eq(h.save.bikeUntil, T0 + BIKE_RACK_MS);
    assert.eq(h.stories[0].art, Macros.DAILY_VISIT_KINDS.bike.art);
    const pot = { kind: 'chest', id: 'gold', poiClass: 'atm' };
    const visit = Macros.beginDailyVisit(makeCtx(h.scene, h.save), pot);
    assert.truthy(visit.claim()); assert.falsy(visit.claim());
    assert.falsy(Shrines.leverActive(h.save, 'fortune'));
    visit.present();
    assert.eq(h.stories[1].art, Macros.DAILY_VISIT_KINDS.gold.art);
  }));
})();
