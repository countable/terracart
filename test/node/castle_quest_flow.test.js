// Exercise the castle conversation with the shipping quest and ownership ledgers.
(() => {
  const start = SCENE_SRC.indexOf('\n  showQuestBoard(sx, sy, house) {');
  const end = SCENE_SRC.indexOf('\n  }\n', start);
  const methods = (0, eval)('({' + SCENE_SRC.slice(start + 1, end + 4) + '})');
  const expiryStart = SCENE_SRC.indexOf('\n  _expireCitadelBattles(now = Date.now()) {');
  const expiryEnd = SCENE_SRC.indexOf('\n  }\n', expiryStart);
  Object.assign(methods, (0, eval)('({' + SCENE_SRC.slice(expiryStart + 1, expiryEnd + 4) + '})'));
  const house = key => ({ id: 'tower:' + key, kind: 'tower', castle: key });
  const scene = () => Object.assign(Object.create(methods), {
    save: { money: 0, claimedCastles: {} }, offers: [], guardChecks: 0,
    _castleKey: Houses.castleKey,
    isCastleClaimed(h) { return Houses.isCastleClaimed(this.save, h); },
    _claimCastle(h) { return Houses.claimCastle(this.save, h); },
    _checkCitadelClaims() { this.guardChecks++; },
    showOfferModal(offer) { this.offers.push(offer); },
    moneyHTML: value => String(value),
    buildInventoryDOM() {}, flashLoot() {}, coinIconEl() {},
    _storySplashOnce: () => true,
  });
  const nextKey = variant => {
    for (let i = 0; i < 100; i++) {
      const key = 'conversation-castle-' + i;
      if (CastleStyles.get(key).id === variant) return key;
    }
    throw new Error('No castle key for ' + variant);
  };

  // A delivery, as scene_shops.js completes one: the lifetime tally moves,
  // then the castle quests hear about it.
  const deliver = save => {
    save.deliveryCount = (save.deliveryCount ?? 0) + 1;
    return Quests.onEvent(save, 'deliver');
  };

  test('castle conversation: first talk assigns the variant job and reopening preserves progress', () => {
    for (const [variant, verb] of [['bastion', 'kill'], ['archive', 'deliver'], ['ruin', 'hunt']]) {
      const s = scene(), h = house(variant);
      assert.eq(Quests.get(s.save, variant), null);
      s.showQuestBoard(0, 0, h);
      const q = Quests.get(s.save, variant);
      assert.eq(q.verb, verb);
      assert.eq(s.offers[0].canAfford, false);
      assert.eq(s.offers[0].get, q.title);
      assert.eq(s.offers[0].headline, 'banner', 'the quest name is dressed as a title');
      // Even a stale or manually triggered locked callback cannot grant ownership.
      s.offers[0].onAccept();
      assert.falsy(s.isCastleClaimed(h));
      if (verb === 'deliver') deliver(s.save);
      else Quests.onKill(s.save, q.target);
      s.showQuestBoard(0, 0, { ...h, id: 'another-tower' });
      assert.eq(Quests.get(s.save, variant), q);
      assert.eq(q.have, 1);
      assert.eq(s.save.quests.assigned[verb], 1);
      assert.eq(q.need, 1, 'every castle asks for a single kill, hunt or delivery');
      assert.truthy(s.offers[1].canAfford, 'one action completes it');
    }
  });

  test('castle conversation: claims only the visited castle and pays exactly once', () => {
    const s = scene(), first = house('archive'), second = house(nextKey('archive'));
    s.showQuestBoard(0, 0, first);
    s.showQuestBoard(0, 0, second);
    const firstQuest = Quests.get(s.save, first.castle);
    const secondQuest = Quests.get(s.save, second.castle);
    assert.eq(firstQuest.need, 1);
    assert.eq(secondQuest.need, 1, 'every Archive needs one delivery');
    deliver(s.save);
    assert.eq(firstQuest.have, firstQuest.need, 'the first Archive takes the delivery');
    assert.eq(secondQuest.have, 0, 'one delivery counts at one castle');
    deliver(s.save);
    assert.eq(secondQuest.have, secondQuest.need, 'the next delivery fills the next Archive');
    s.showQuestBoard(0, 0, first);
    const ready = s.offers[s.offers.length - 1];
    assert.truthy(ready.canAfford);
    ready.onAccept();
    assert.truthy(s.isCastleClaimed(first));
    assert.falsy(s.isCastleClaimed(second));
    assert.eq(s.save.money, firstQuest.reward);
    ready.onAccept();
    assert.eq(s.save.money, firstQuest.reward, 'repeated callback cannot pay twice');
    assert.eq(Quests.completedCount(s.save), 1);
    const offersBefore = s.offers.length;
    s.showQuestBoard(0, 0, first);
    assert.eq(s.offers.length, offersBefore);
    assert.eq(Quests.get(s.save, first.castle), firstQuest);
    assert.eq(Quests.get(s.save, second.castle), secondQuest);
  });

  test('castle conversation: deliveries made before an Archive is visited count there, once each', () => {
    const s = scene(), first = house('archive'), second = house(nextKey('archive'));
    s.save.deliveryCount = 2;               // two deliveries before any Archive
    s.showQuestBoard(0, 0, first);
    assert.truthy(s.offers[0].canAfford, 'an earlier delivery completes the first Archive');
    s.showQuestBoard(0, 0, second);
    assert.truthy(s.offers[1].canAfford, 'the second earlier delivery completes the second');
    s.showQuestBoard(0, 0, first);
    s.showQuestBoard(0, 0, second);
    assert.eq(s.save.quests.deliveriesSpent, 2, 'reopening credits nothing twice');
    const otherKey = (() => {
      for (let i = 0; i < 400; i++) {
        const key = 'later-archive-' + i;
        if (CastleStyles.get(key).id === 'archive') return key;
      }
      throw new Error('No third archive key');
    })();
    s.showQuestBoard(0, 0, house(otherKey));
    const q = Quests.get(s.save, otherKey);
    assert.eq(q.have, 0, 'the pool is spent: a third Archive waits for a new delivery');
    deliver(s.save);
    assert.eq(q.have, 1, 'and takes the next one');
  });

  test('castle conversation: a save from before the pool keeps its Archives and spends nothing twice', () => {
    const s = scene(), first = house('archive'), second = house(nextKey('archive'));
    s.showQuestBoard(0, 0, first);
    s.showQuestBoard(0, 0, second);
    // The old rule: one delivery filled both, and no spent count was kept.
    s.save.deliveryCount = 1;
    delete s.save.quests.deliveriesSpent;
    for (const key of [first.castle, second.castle]) Quests.get(s.save, key).have = 1;
    assert.falsy(Quests.creditDeliveries(s.save), 'nothing new to credit');
    assert.eq(s.save.quests.deliveriesSpent, 1, 'never more spent than delivered');
  });

  test('castle conversation: an older three-kill or two-hunt quest asks for one', () => {
    for (const [variant, need] of [['bastion', 3], ['ruin', 2]]) {
      const s = scene(), h = house(variant);
      s.showQuestBoard(0, 0, h);
      const q = Quests.get(s.save, variant);
      Object.assign(q, { need, have: 0, body: 'old copy' });
      Quests.onKill(s.save, q.target);
      assert.eq(q.need, 1, `${variant} drops to a single target`);
      assert.eq(q.have, 1, `${variant} one kill completes it`);
      assert.falsy(/old copy|\d/.test(q.body), `${variant} objective names one target: ${q.body}`);
      Object.assign(q, { need, have: 2 });
      s.showQuestBoard(0, 0, h);
      assert.eq(q.have, 1, 'progress already made carries over, capped at one');
    }
  });

  test('castle conversation: citadel waits for Fight and Later leaves it dormant', () => {
    const s = scene();
    s.showQuestBoard(0, 0, house('citadel'));
    assert.eq(s.guardChecks, 1);
    assert.eq(s.offers.length, 1);
    assert.eq(s.offers[0].get, 'Defeat the guards');
    assert.truthy(s.offers[0].canAfford);
    assert.eq(s.offers[0].acceptLabel, 'Fight');
    assert.eq(s.offers[0].cancelLabel, 'Later');
    assert.falsy(Houses.citadelBattleActive(s.save, 'citadel'), 'reading is not accepting');
    s.showQuestBoard(0, 0, house('citadel'));
    assert.falsy(Houses.citadelBattleActive(s.save, 'citadel'), 'leaving and returning does not activate');
    s.offers[1].onAccept();
    assert.truthy(Houses.citadelBattleActive(s.save, 'citadel'));
    assert.eq(s._lastLairT, -Infinity, 'the next residency tick can spawn the guards');
    assert.truthy(Houses.citadelBattleActive(JSON.parse(JSON.stringify(s.save)), 'citadel'));
    assert.falsy(Houses.startCitadelBattle(s.save, 'citadel'), 'accepting again cannot restart it');
    assert.falsy(Houses.startCitadelBattle(s.save, 'archive'));
    assert.falsy(s.save.quests);
  });

  test('castle conversation: expiry resets persisted defeats and wounds without unlocking', () => {
    const s = scene(), now = 1000000;
    Houses.startCitadelBattle(s.save, 'citadel', now);
    s.save.citadelBattles.citadel.guardIds = ['guard'];
    s.save.caught = ['guard', 'guard_s1', 'guard_summon_0', 'unrelated'];
    s._lairHp = new Map([['guard', 1]]);
    s._expireCitadelBattles(now + Houses.CITADEL_BATTLE_MS - 1);
    assert.eq(s.save.caught.length, 4);
    s._expireCitadelBattles(now + Houses.CITADEL_BATTLE_MS);
    assert.eq(s.save.caught.join(), 'unrelated');
    assert.falsy(s._lairHp.has('guard'));
    assert.falsy(s.isCastleClaimed(house('citadel')));
    assert.falsy(s.save.citadelBattles.citadel);
    assert.truthy(Houses.startCitadelBattle(s.save, 'citadel', now + Houses.CITADEL_BATTLE_MS));
  });

  test('castle conversation: newly cleared citadel opens without a guarded offer', () => {
    const s = scene(), h = house('citadel');
    s._checkCitadelClaims = () => Houses.claimCastle(s.save, h);
    s.showQuestBoard(0, 0, h);
    assert.truthy(s.isCastleClaimed(h));
    assert.eq(s.offers.length, 0);
    assert.falsy(s.save.quests);
  });

  test('castle conversation: existing ownership does not assign a replacement job', () => {
    const s = scene(), h = house('bastion');
    Houses.claimCastle(s.save, h);
    s.showQuestBoard(0, 0, h);
    assert.eq(s.offers.length, 0);
    assert.falsy(s.save.quests);
  });
})();
