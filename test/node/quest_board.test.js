// Castle jobs belong to their first conversation, not a shared board.
(() => {
  // Delivery-pool tests explicitly choose the delivery half of Archive courts.
  const deliveryKey = label => {
    for (let i = 0; ; i++) {
      const key = `${label}:delivery:${i}`;
      if (CastleStyles.questTypeFor(key, 'archive') === 'deliver') return key;
    }
  };
  test('castle quests: events and reads never assign quests', () => {
    const save = {};
    assert.eq(Quests.get(save, 'unvisited'), null);
    assert.falsy(Quests.onKill(save, 'slime'));
    assert.falsy(Quests.onEvent(save, 'deliver'));
    assert.eq(Quests.completedCount(save), 0);
    assert.falsy(save.quests);
    assert.eq(Quests.assign(save, 'citadel', 'citadel'), null);
    assert.falsy(save.quests);
    assert.eq(Quests.assign(save, 'first', 'bastion').have, 0);
  });

  test('castle quests: styles choose kill, hunt and Archive delivery jobs', () => {
    const save = {};
    const kill = Quests.assign(save, 'b', 'bastion');
    const delivery = Quests.assign(save, deliveryKey('a'), 'archive');
    const hunt = Quests.assign(save, 'r', 'ruin');
    assert.eq(kill.verb, 'kill'); assert.eq(kill.need, 1, 'a single enemy');
    assert.eq(delivery.verb, 'deliver'); assert.eq(delivery.need, 1);
    assert.eq(hunt.verb, 'hunt'); assert.eq(hunt.need, 1, 'a single animal');
    assert.truthy(SpriteLayout.isGame(hunt.target));
  });

  test('castle quests: assignments advance enemy tiers independently of completion', () => {
    const save = {}, enemies = questEnemies();
    assert.eq(enemies[0], 'slime');
    for (let i = 0; i < enemies.length + 2; i++) {
      const q = Quests.assign(save, `b${i}`, 'bastion');
      assert.eq(q.target, enemies[Math.min(i, enemies.length - 1)]);
      assert.eq(q.need, 1);
      if (i && i < enemies.length) {
        assert.gte(Combat.monster(q.target)?.tier ?? 1, Combat.monster(enemies[i - 1])?.tier ?? 1);
      }
    }
    assert.eq(Quests.completedCount(save), 0);
    assert.eq(Quests.assign(save, deliveryKey('first-delivery'), 'archive').need, 1);
    assert.eq(Quests.assign(save, deliveryKey('second-delivery'), 'archive').need, 1);
    assert.eq(Quests.assign(save, deliveryKey('third-delivery'), 'archive').need, 1);
  });

  test('castle quests: hunting cycles through game animals', () => {
    const save = {}, animals = questAnimals();
    assert.gt(animals.length, 0);
    for (let i = 0; i < animals.length * 2; i++) {
      assert.eq(Quests.assign(save, `r${i}`, 'ruin').target, animals[i % animals.length]);
    }
  });

  test('castle quests: repeated conversations and reload keep assignment and progress', () => {
    const save = {}, first = Quests.assign(save, 'first', 'bastion');
    Quests.onKill(save, first.target);
    assert.eq(Quests.assign(save, 'first', 'archive'), first, 'the castle keeps its original quest');
    assert.eq(save.quests.assigned.kill, 1);
    const restored = JSON.parse(JSON.stringify(save));
    assert.eq(Quests.assign(restored, 'first', 'bastion').have, 1);
    assert.eq(Quests.assign(restored, 'next', 'bastion').target, questEnemies()[1]);
    assert.eq(first.have, 1, 'the next assignment does not reset another castle');
  });

  test('castle quests: only exact targets count and progress caps at the requirement', () => {
    const save = {}, q = Quests.assign(save, 'b', 'bastion');
    assert.falsy(Quests.onKill(save, 'goblin'));
    assert.falsy(Quests.onEvent(save, 'kill'));
    assert.falsy(Quests.onEvent(save, 'kill', { target: 'deer' }));
    assert.truthy(Quests.onKill(save, q.target));
    assert.falsy(Quests.onKill(save, q.target));
    assert.eq(q.have, 1);
    for (const event of ['harvest', 'chest', 'fish', 'sell', 'poi', 'plant', 'till', 'restore']) {
      assert.falsy(Quests.onEvent(save, event));
    }
  });

  test('castle quests: hunts use the shared defeat hook without enemy cross-credit', () => {
    const save = {}, hunt = Quests.assign(save, 'r', 'ruin'), kill = Quests.assign(save, 'b', 'bastion');
    assert.truthy(Quests.onKill(save, hunt.target));
    assert.eq(hunt.have, 1); assert.eq(kill.have, 0);
    Quests.onKill(save, kill.target);
    assert.eq(hunt.have, 1); assert.eq(kill.have, 1);
  });

  // A delivery as scene_shops.js completes one: the tally, then the event.
  const deliver = save => {
    save.deliveryCount = (save.deliveryCount ?? 0) + 1;
    return Quests.onEvent(save, 'deliver');
  };

  test('castle quests: one delivery credits one Archive, oldest first', () => {
    const save = {}, a = Quests.assign(save, deliveryKey('a'), 'archive'), b = Quests.assign(save, deliveryKey('b'), 'archive');
    assert.truthy(deliver(save));
    assert.eq(a.have, 1); assert.eq(b.have, 0, 'the delivery is spent at the first Archive');
    assert.truthy(deliver(save));
    assert.eq(b.have, 1);
    assert.falsy(deliver(save), 'no Archive left waiting');
    assert.eq(Quests.assign(save, deliveryKey('c'), 'archive').have, 1,
      'the spare delivery credits the next Archive met');
    assert.eq(Quests.assign(save, deliveryKey('d'), 'archive').have, 0, 'and only one Archive');
    assert.eq(save.quests.deliveriesSpent, save.deliveryCount, 'every delivery spent exactly once');
  });

  test('castle quests: deliveries before the first Archive count, one per castle', () => {
    const save = { deliveryCount: 1 };
    assert.eq(Quests.assign(save, deliveryKey('a'), 'archive').have, 1, 'an earlier delivery counts');
    assert.eq(Quests.assign(save, deliveryKey('b'), 'archive').have, 0, 'but only at one castle');
    assert.falsy(Quests.assign(save, 'k', 'bastion').have, 'a delivery never credits a kill');
  });

  test('castle quests: one hunt advances all matching active jobs but never credits future jobs', () => {
    const save = {};
    Quests.onKill(save, 'deer');
    const a = Quests.assign(save, 'a', 'ruin');
    const other = Quests.assign(save, 'other', 'ruin');
    assert.eq(a.have, 0, 'kills before activation do not count');
    const b = Quests.assign(save, 'b', 'ruin');
    b.target = a.target;               // two Ruins hunting the same animal
    Quests.onKill(save, a.target);
    assert.eq(a.have, 1); assert.eq(b.have, 1, 'one hunt fills every matching job');
    assert.eq(other.have, 0);
    const c = Quests.assign(save, 'c', 'ruin');
    c.target = a.target;
    assert.eq(c.have, 0, 'a later conversation starts a fresh counter');
    assert.truthy(Quests.claim(save, 'a'));
    assert.truthy(Quests.claim(save, 'b'));
  });

  test('castle quests: claim happens once and never replaces the permanent job', () => {
    const save = {}, q = Quests.assign(save, deliveryKey('a'), 'archive');
    assert.eq(Quests.claim(save, deliveryKey('a')), null);
    assert.eq(Quests.claim(save, 'missing'), null);
    deliver(save);
    assert.eq(Quests.claim(save, deliveryKey('a')), q);
    assert.truthy(q.claimed);
    assert.eq(Quests.completedCount(save), 1);
    assert.eq(Quests.claim(save, deliveryKey('a')), null);
    assert.falsy(Quests.onEvent(save, 'deliver'), 'no new delivery, nothing to credit');
    assert.eq(Quests.assign(save, deliveryKey('a'), 'archive'), q);
    assert.eq(save.quests.assigned.deliver, 1);
    const restored = JSON.parse(JSON.stringify(save));
    assert.eq(Quests.claim(restored, deliveryKey('a')), null);
    assert.eq(Quests.assign(restored, deliveryKey('next'), 'archive').need, 1);
  });
  test('castle quests: each type has a title and one sentence of flavour naming its target', () => {
    const save = {};
    for (const variant of ['bastion', 'archive', 'ruin']) {
      const q = Quests.assign(save, variant, variant), text = Quests.flavour(q);
      assert.truthy(q.title, `${variant} has a title`);
      assert.eq((text.match(/[.!?](\s|$)/g) || []).length, 1, `${variant} flavour is one sentence: ${text}`);
      assert.falsy(/undefined/.test(text));
      if (q.target) assert.truthy(text.includes(q.verb === 'hunt' ? q.target : Combat.enemyName(q.target)), 'names its target');
    }
  });

  test('castle quests: luxury reads the active Home, revalidates decreases and survives reload', () => {
    const key = Array.from({ length: 100 }, (_, i) => `luxury-castle:${i}`)
      .find(k => CastleStyles.questTypeFor(k, 'archive') === 'luxury');
    const save = { starterShopId: 'home', houseLuxury: { home: { score: 16, footprintKey: 'room' } } };
    const q = Quests.assign(save, key, 'archive');
    assert.eq(q.verb, 'luxury'); assert.eq(q.have, 16); assert.eq(q.need, 16);
    assert.eq(q.title, 'A respectable address'); assert.eq(q.reward, 60);
    assert.eq(Quests.flavour(q), "We don't admit rabble here!");
    assert.truthy(q.body.includes('16 luxury'));
    Quests.onEvent(save, 'luxury'); Quests.onEvent(save, 'place');
    assert.eq(q.have, 16, 'placement events never increment the score');
    save.houseLuxury.home.score = 9;
    assert.eq(Quests.claim(save, key), null, 'stale completed card cannot claim after pickup');
    assert.eq(q.have, 9);
    save.starterShopId = 'new-home';
    assert.eq(Quests.open(save, key, 'archive').have, 0, 'moving Home reads its own score');
    save.houseLuxury['new-home'] = { score: 25, footprintKey: 'new-room' };
    assert.truthy(Quests.onEvent(save, 'luxury'));
    assert.eq(q.have, 25, 'progress is the current score, not a capped event counter');
    const loaded = JSON.parse(JSON.stringify(save));
    assert.eq(Quests.open(loaded, key, 'archive').have, 25);
    assert.truthy(Quests.claim(loaded, key));
    loaded.houseLuxury['new-home'].score = 0;
    Quests.onEvent(loaded, 'luxury');
    assert.truthy(Quests.open(loaded, key, 'archive').claimed, 'ownership remains earned');
    assert.eq(Quests.claim(loaded, key), null, 'claim pays only once');
  });

  test('castle quests: saved Archive assignments survive the new luxury subvariant', () => {
    const key = Array.from({ length: 100 }, (_, i) => `legacy-castle:${i}`)
      .find(k => CastleStyles.questTypeFor(k, 'archive') === 'luxury');
    const q = { verb: 'deliver', event: 'deliver', need: 1, have: 0, claimed: false, title: 'Neighbourly', reward: 30 };
    const save = { deliveryCount: 1, quests: { byCastle: { [key]: q }, assigned: { deliver: 1 } } };
    assert.eq(Quests.open(save, key, 'archive'), q);
    assert.eq(q.verb, 'deliver'); assert.eq(q.have, 1);
  });
})();
