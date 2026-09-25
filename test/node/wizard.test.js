// The wizard tower (src/wizard.js): tracks drawn two at a time, climbed in
// order within a track, and the one-time calling as the third purchase — all
// paid in memories. Pure module, so these drive the shipping rules.

(() => {
  const W = Wizard;
  // A fresh save with plenty to spend. relicSalt fixed so the draw is stable.
  const fresh = (over = {}) => Object.assign({ memories: 100, relicSalt: 12345, relics: {} }, over);
  const keys = (offers) => offers.map((o) => o.key);
  const ring = (save) => (save.relics && save.relics.ring && save.relics.ring.tier) || 0;
  // Buy one of what's on offer, doing the caller's half (equipping the Ring).
  const buyFirst = (save, pick = 0) => {
    const o = W.offers(save)[pick];
    const r = W.buy(save, o.key);
    if (r && r.equip) save.relics.ring = { tier: r.equip.tier };
    return r;
  };

  test('wizard: the table holds four tracks and four classes, with the promised prices', () => {
    assert.eq(keys(W.TRACKS).join(','), 'light,measure,eye,vigour');
    assert.eq(keys(W.CLASSES).join(','), 'hunter,runner,enforcer,enchanter');
    const byKey = Object.fromEntries(W.TRACKS.map((t) => [t.key, t]));
    for (const k of ['light', 'measure', 'eye']) assert.eq(byKey[k].cost, 5, `${k} costs 5`);
    assert.eq(byKey.vigour.cost, 2, 'vigour is the cheap one');
    assert.eq(byKey.vigour.max(), 5, 'five vigour rungs');
    assert.eq(byKey.light.max(), 6, 'six Inner Light rungs');
    assert.eq(byKey.eye.max(), 7, 'seven Ring tiers');
    assert.eq(byKey.measure.max(), RARITY_TUNING.qtyLuckLevels, 'measure reads rarity.js');
    assert.eq(W.CLASS_COST, 3);
    assert.gt(W.ENCHANTER_ENERGY_COST, 0, 'the enchanter pays energy');
  });

  test('wizard: two DISTINCT offers, the same pair every time the tower reopens', () => {
    const save = fresh();
    const a = W.offers(save), b = W.offers(save);
    assert.eq(a.length, 2, 'two on the table');
    assert.truthy(a[0].key !== a[1].key, 'distinct tracks');
    assert.eq(keys(a).join(), keys(b).join(), 'stable across calls');
    for (const o of a) {
      assert.eq(o.kind, 'track'); assert.eq(o.rung, 1, 'a fresh save is offered rung 1');
      assert.truthy(o.get && o.title && o.name && o.header, 'carries its copy');
    }
  });

  test('wizard: buying re-rolls BOTH offers (the seed moved)', () => {
    // Over many salts, the pair after a purchase must differ from a pure
    // "remove the bought one" some of the time — i.e. it is a fresh draw.
    let rerolled = 0;
    for (let salt = 1; salt <= 40; salt++) {
      const save = fresh({ relicSalt: salt });
      const before = keys(W.offers(save));
      buyFirst(save, 0);
      const after = keys(W.offers(save));
      if (!after.includes(before[1])) rerolled++;
      assert.eq(after.length, 2, 'still two after a buy');
    }
    assert.gt(rerolled, 0, 'the unbought offer is not simply kept');
  });

  test('wizard: the seed is buys + salt, so the same save state shows the same pair', () => {
    const s1 = fresh({ relicSalt: 7 }), s2 = fresh({ relicSalt: 7 });
    assert.eq(keys(W.offers(s1)).join(), keys(W.offers(s2)).join(), 'same salt, same pair');
    const seen = new Set();
    for (let salt = 0; salt < 30; salt++) seen.add(keys(W.offers(fresh({ relicSalt: salt }))).join());
    assert.gt(seen.size, 1, 'the salt changes the roll');
  });

  test('wizard: the calling is exactly the THIRD purchase, all four classes', () => {
    const save = fresh();
    buyFirst(save); assert.eq(W.buys(save), 1);
    assert.eq(W.offers(save)[0].kind, 'track', 'second visit: tracks');
    buyFirst(save); assert.eq(W.buys(save), 2);
    const cls = W.offers(save);
    assert.eq(cls.length, 4, 'four callings');
    assert.truthy(cls.every((o) => o.kind === 'class' && o.cost === W.CLASS_COST), 'all classes, at 3');
    const r = W.buy(save, 'runner');
    assert.truthy(r, 'bought');
    assert.eq(save.playerClass, 'runner'); assert.eq(r.playerClass, 'runner');
    assert.eq(W.buys(save), 3);
    const next = W.offers(save);
    assert.eq(next.length, 2); assert.truthy(next.every((o) => o.kind === 'track'), 'back to tracks');
    assert.eq(W.buy(save, 'hunter'), null, 'the calling is one-time');
  });

  test('wizard: while the calling is due, no track can be bought around it', () => {
    const save = fresh({ wizardBuys: 2 });
    assert.eq(W.buy(save, 'vigour'), null, 'not on the table');
    assert.eq(save.memories, 100, 'nothing spent');
  });

  test('wizard: an old save derives its purchase count from its rungs', () => {
    const old = fresh({ reachUpgrades: 3, qtyUpgrades: 1, relics: { ring: { tier: 2 } } });
    assert.eq(W.buys(old), 6, '3 + 1 + 2');
    assert.eq(W.offers(old)[0].kind, 'class', 'past its third purchase: the calling on its next visit');
    W.buy(old, 'enforcer');
    assert.eq(old.wizardBuys, 7, 'the derived count + 1 is written');
    assert.eq(W.buys({ vigourUpgrades: 2, playerClass: 'hunter' }), 3, 'vigour and a class count');
    assert.eq(W.buys({ wizardBuys: 4, reachUpgrades: 6 }), 4, 'a stored count wins');
    assert.eq(W.buys({}), 0);
  });

  test('wizard: refused when memories are short — nothing changes', () => {
    // Two distinct tracks and only one costs 2, so a 5 is always on the table.
    const probe = fresh({ memories: 4 });
    const five = W.offers(probe).find((x) => x.cost === 5);
    assert.falsy(five.canAfford, 'the offer says so');
    assert.eq(W.buy(probe, five.key), null, 'refused');
    assert.eq(probe.memories, 4); assert.eq(probe.wizardBuys, undefined, 'no buy counted');
    // Vigour (2) at 1 memory, forced onto the table by finishing the rest.
    const lone = fresh({ memories: 1, reachUpgrades: 6, qtyUpgrades: 99, relics: { ring: { tier: 7 } }, playerClass: 'hunter' });
    assert.eq(keys(W.offers(lone)).join(), 'vigour');
    assert.eq(W.buy(lone, 'vigour'), null, 'one memory buys nothing');
    lone.memories = 2;
    const r = W.buy(lone, 'vigour');
    assert.truthy(r && r.energyCap, 'two buys a vigour rung and flags the cap');
    assert.eq(lone.memories, 0); assert.eq(lone.vigourUpgrades, 1);
  });

  test('wizard: within a track the rungs climb in order', () => {
    const save = fresh({ memories: 1000, playerClass: 'hunter' });
    for (let i = 0; i < 12; i++) {
      const offers = W.offers(save);
      if (!offers.length) break;
      const o = offers[0];
      const have = { light: save.reachUpgrades | 0, measure: save.qtyUpgrades | 0,
                     eye: ring(save), vigour: save.vigourUpgrades | 0 }[o.key];
      assert.eq(o.rung, have + 1, `${o.key} offers the next rung`);
      const r = buyFirst(save);
      assert.eq(r.rung, have + 1);
      if (o.key === 'eye') assert.eq(r.equip.tier, have + 1, 'the Ring equip is the caller\'s, at that tier');
    }
  });

  test('wizard: finished tracks drop out; one left is one offer; none is empty', () => {
    const qmax = RARITY_TUNING.qtyLuckLevels;
    const done = { reachUpgrades: 6, qtyUpgrades: qmax, relics: { ring: { tier: 7 } }, playerClass: 'enchanter' };
    const two = fresh(Object.assign({}, done, { reachUpgrades: 5 }));
    assert.eq(keys(W.offers(two)).join(), 'light,vigour', 'only the unfinished two');
    const one = fresh(Object.assign({}, done, { vigourUpgrades: 5, reachUpgrades: 5 }));
    assert.eq(keys(W.offers(one)).join(), 'light');
    const none = fresh(Object.assign({}, done, { vigourUpgrades: 5 }));
    assert.eq(W.offers(none).length, 0, 'nothing left to give');
    assert.eq(W.buy(none, 'light'), null);
    // Buy everything, start to finish, and the tower empties.
    const all = fresh({ memories: 10000 });
    for (let i = 0; i < 100 && W.offers(all).length; i++) buyFirst(all);
    assert.eq(W.offers(all).length, 0, 'every track finished');
    assert.eq(all.reachUpgrades, 6); assert.eq(all.vigourUpgrades, 5); assert.eq(ring(all), 7);
    assert.truthy(W.playerClass(all), 'and a calling chosen on the way');
  });

  test('wizard: the calling copy reads the owning modules\' numbers', () => {
    const by = Object.fromEntries(W.offers(fresh({ wizardBuys: 2 })).map((o) => [o.key, o]));
    assert.truthy(by.hunter.get.includes(String(Combat.HUNTER_BOW_MUL)), 'hunter prints the bow mul');
    assert.truthy(by.enforcer.get.includes(String(Combat.ENFORCER_MELEE_DPS)), 'enforcer prints the bonus');
    assert.truthy(by.enchanter.get.includes(String(W.ENCHANTER_ENERGY_COST)), 'enchanter prints the cost');
    const vig = W.offers(fresh({ memories: 9, reachUpgrades: 6, qtyUpgrades: 99,
                                 relics: { ring: { tier: 7 } }, playerClass: 'runner' }))[0];
    assert.truthy(vig.get.includes(`+${Energy.VIGOUR_ENERGY_STEP}`), 'vigour prints energy.js\'s step');
    assert.eq(W.playerClass({ playerClass: 'wizard' }), null, 'an unknown class is no class');
  });
})();
