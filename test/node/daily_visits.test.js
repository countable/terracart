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

  test('daily visits: a message bottle reads one page with its own painting, then is gone', () => at(T0, () => {
    const h = harness({ opened: [] }), o = { kind: 'bottle', id: 'bottle_1_2_3_4' };
    h.tap(o);
    assert.eq(h.pages(), 1);
    assert.eq(h.stories[0].art, 'bottle_read');
    assert.includes(h.save.opened, o.id);
    assert.truthy(isSpent(o, spentSets(null, h.save)), 'picked up: hidden and refused');
    h.tap(o);
    assert.eq(h.pages(), 1);
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
    assert.eq(h.offers.length, 1);
    assert.falsy(h.offers[0].canAfford);
    h.offers.pop().onCancel();
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
  const shipwreck = { kind: 'grove_shrine', zoneVariant: 'pirate_cove', id: 'pirate-wreck' };
  test('daily visits: shipwreck hires a pirate for 75 coins and one day, without a gift lottery', () => at(T0, () => {
    const row = Shrines.kindForObject(shipwreck);
    assert.eq(row, Shrines.REWARD_KINDS.pirate_cove);
    assert.eq(row.reward, 'companion'); assert.eq(row.companion, 'pirate_mercenary');
    assert.eq(row.price, 75); assert.eq(row.durationMs, DAY);
    const h = harness({ money: 100, opened: [], inv: [], relics: {}, armor: {} });
    h.scene.flashLoot = () => { throw new Error('Hiring must not grant a treasure roll'); };
    h.scene.showRewardCard = () => { throw new Error('Hiring must not offer a gift'); };
    h.tap(shipwreck); h.tap(shipwreck);
    assert.eq(h.offers.length, 1); assert.eq(h.stories.length, 0);
    assert.includes(h.offers[0].body, 'pirate mercenary');
    assert.eq(h.save.money, 100); assert.falsy(Macros.usedToday(h.save, shipwreck.id));
    h.offers[0].onCancel(); h.offers[0].onAccept();
    assert.eq(h.save.money, 100); assert.falsy(h.save.pirateMercenaryUntil);
    assert.falsy(Macros.usedToday(h.save, shipwreck.id));
    h.tap(shipwreck); h.offers[1].onAccept(); h.offers[1].onAccept();
    assert.eq(h.save.money, 25); assert.eq(h.save.pirateMercenaryUntil, T0 + DAY);
    assert.falsy(h.save.mercenaryUntil, 'ship hires its own pirate companion');
    assert.truthy(Macros.usedToday(h.save, shipwreck.id));
    assert.eq(h.stories.length, 1); assert.eq(h.stories[0].art, row.art);
    h.stories[0].onDismiss(); h.stories[0].onDismiss();
    assert.eq(h.rewards.length, 0); assert.eq(h.save.inv.length, 0);
    assert.eq(h.save.opened.length, 0, 'ship remains a repeatable hiring site');
    assert.eq(h.save.money, 25, 'story dismissal does not pay out treasure');
    h.tap(shipwreck); assert.eq(h.offers.length, 2);
  }));

  test('daily visits: shipwreck rechecks funds and never spends an unsuccessful hire', () => at(T0, () => {
    const h = harness({ money: 74 });
    h.tap(shipwreck); assert.eq(h.offers.length, 1); assert.eq(h.save.money, 74);
    assert.falsy(h.offers[0].canAfford);
    h.offers.pop().onCancel();
    assert.falsy(Macros.usedToday(h.save, shipwreck.id));
    h.save.money = 100; h.tap(shipwreck); h.save.money = 74;
    h.offers[0].onAccept(); h.offers[0].onAccept();
    assert.eq(h.save.money, 74); assert.falsy(h.save.pirateMercenaryUntil);
    assert.falsy(Macros.usedToday(h.save, shipwreck.id)); assert.eq(h.stories.length, 0);
    h.save.money = 75; h.tap(shipwreck); h.offers[1].onAccept();
    assert.eq(h.save.money, 0); assert.truthy(Companions.active(h.save, 'pirate_mercenary'));
  }));

  test('daily visits: another wreck cannot duplicate an active pirate contract; expiry permits rehire', () => at(T0, () => {
    const h = harness({ money: 225 });
    h.tap(shipwreck); h.offers[0].onAccept(); h.stories[0].onDismiss();
    const other = { ...shipwreck, id: 'second-pirate-wreck' };
    h.tap(other); assert.eq(h.offers.length, 1); assert.eq(h.save.money, 150);
    assert.falsy(Macros.usedToday(h.save, other.id));
    at(T0 + DAY, () => {
      h.tap(other); assert.eq(h.offers.length, 2); h.offers[1].onAccept();
      assert.eq(h.save.money, 75); assert.eq(h.save.pirateMercenaryUntil, T0 + 2 * DAY);
      assert.truthy(Macros.usedToday(h.save, other.id));
    });
  }));

  test('daily visits: regular and pirate mercenaries have independent paid contracts', () => at(T0, () => {
    for (const order of [[wagon, shipwreck], [shipwreck, wagon]]) {
      const h = harness({ money: 125 });
      h.tap(order[0]); h.offers[0].onAccept(); h.stories[0].onDismiss();
      h.tap(order[1]); assert.eq(h.offers.length, 2); h.offers[1].onAccept();
      assert.eq(h.save.money, 0);
      assert.eq(h.save.mercenaryUntil, T0 + DAY);
      assert.eq(h.save.pirateMercenaryUntil, T0 + DAY);
      assert.truthy(Companions.active(h.save, 'mercenary'));
      assert.truthy(Companions.active(h.save, 'pirate_mercenary'));
    }
  }));
})();
