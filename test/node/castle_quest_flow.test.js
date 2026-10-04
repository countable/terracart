// Exercise the castle conversation with the shipping quest and ownership ledgers.
(() => {
  const start = SCENE_SRC.indexOf('\n  showQuestBoard(sx, sy, house) {');
  const end = SCENE_SRC.indexOf('\n  }\n', start);
  const methods = (0, eval)('({' + SCENE_SRC.slice(start + 1, end + 4) + '})');
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

  test('castle conversation: first talk assigns the variant job and reopening preserves progress', () => {
    for (const [variant, verb] of [['bastion', 'kill'], ['archive', 'deliver'], ['ruin', 'hunt']]) {
      const s = scene(), h = house(variant);
      assert.eq(Quests.get(s.save, variant), null);
      s.showQuestBoard(0, 0, h);
      const q = Quests.get(s.save, variant);
      assert.eq(q.verb, verb);
      assert.eq(s.offers[0].canAfford, false);
      // Even a stale or manually triggered locked callback cannot grant ownership.
      s.offers[0].onAccept();
      assert.falsy(s.isCastleClaimed(h));
      if (verb === 'deliver') Quests.onEvent(s.save, 'deliver');
      else Quests.onKill(s.save, q.target);
      s.showQuestBoard(0, 0, { ...h, id: 'another-tower' });
      assert.eq(Quests.get(s.save, variant), q);
      assert.eq(q.have, 1);
      assert.eq(s.save.quests.assigned[verb], 1);
      assert.eq(s.offers[1].canAfford, q.have >= q.need);
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
    Quests.onEvent(s.save, 'deliver');
    assert.eq(firstQuest.have, firstQuest.need);
    assert.eq(secondQuest.have, secondQuest.need, 'one delivery completes both active quests');
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
