// Castle jobs belong to their first conversation, not a shared board.
(() => {
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

  test('castle quests: variants choose exactly the three quest types', () => {
    const save = {};
    const kill = Quests.assign(save, 'b', 'bastion');
    const delivery = Quests.assign(save, 'a', 'archive');
    const hunt = Quests.assign(save, 'r', 'ruin');
    assert.eq(kill.verb, 'kill'); assert.eq(kill.need, 3);
    assert.eq(delivery.verb, 'deliver'); assert.eq(delivery.need, 1);
    assert.eq(hunt.verb, 'hunt'); assert.eq(hunt.need, 2);
    assert.truthy(SpriteLayout.isGame(hunt.target));
  });

  test('castle quests: assignments advance enemy tiers independently of completion', () => {
    const save = {}, enemies = questEnemies();
    assert.eq(enemies[0], 'slime');
    for (let i = 0; i < enemies.length + 2; i++) {
      const q = Quests.assign(save, `b${i}`, 'bastion');
      assert.eq(q.target, enemies[Math.min(i, enemies.length - 1)]);
      assert.eq(q.need, 3);
      if (i && i < enemies.length) {
        assert.gte(Combat.monster(q.target)?.tier ?? 1, Combat.monster(enemies[i - 1])?.tier ?? 1);
      }
    }
    assert.eq(Quests.completedCount(save), 0);
    assert.eq(Quests.assign(save, 'first-delivery', 'archive').need, 1);
    assert.eq(Quests.assign(save, 'second-delivery', 'archive').need, 1);
    assert.eq(Quests.assign(save, 'third-delivery', 'archive').need, 1);
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
    for (let i = 0; i < 3; i++) assert.truthy(Quests.onKill(save, q.target));
    assert.falsy(Quests.onKill(save, q.target));
    assert.eq(q.have, 3);
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

  test('castle quests: deliveries credit every assigned unfinished delivery quest', () => {
    const save = {}, a = Quests.assign(save, 'a', 'archive'), b = Quests.assign(save, 'b', 'archive');
    Quests.onEvent(save, 'deliver');
    assert.eq(a.have, 1); assert.eq(b.have, 1);
    assert.eq(a.have, a.need); assert.eq(b.have, b.need);
    assert.falsy(Quests.onEvent(save, 'deliver'));
    assert.eq(a.have, 1); assert.eq(b.have, 1);
    assert.eq(Quests.assign(save, 'c', 'archive').have, 0, 'past deliveries do not count');
  });

  test('castle quests: one hunt advances all matching active jobs but never credits future jobs', () => {
    const save = {};
    Quests.onKill(save, 'deer');
    const a = Quests.assign(save, 'a', 'ruin');
    const other = Quests.assign(save, 'other', 'ruin');
    assert.eq(a.have, 0, 'kills before activation do not count');
    Quests.onKill(save, a.target);
    const b = Quests.assign(save, 'b', 'ruin');
    assert.eq(b.target, a.target);
    assert.eq(b.have, 0, 'a later conversation starts a fresh counter');
    Quests.onKill(save, a.target);
    assert.eq(a.have, 2); assert.eq(b.have, 1); assert.eq(other.have, 0);
    Quests.onKill(save, a.target);
    assert.eq(a.have, 2); assert.eq(b.have, 2);
    assert.truthy(Quests.claim(save, 'a'));
    assert.truthy(Quests.claim(save, 'b'));
  });

  test('castle quests: claim happens once and never replaces the permanent job', () => {
    const save = {}, q = Quests.assign(save, 'a', 'archive');
    assert.eq(Quests.claim(save, 'a'), null);
    assert.eq(Quests.claim(save, 'missing'), null);
    Quests.onEvent(save, 'deliver');
    assert.eq(Quests.claim(save, 'a'), q);
    assert.truthy(q.claimed);
    assert.eq(Quests.completedCount(save), 1);
    assert.eq(Quests.claim(save, 'a'), null);
    assert.falsy(Quests.onEvent(save, 'deliver'));
    assert.eq(Quests.assign(save, 'a', 'archive'), q);
    assert.eq(save.quests.assigned.deliver, 1);
    const restored = JSON.parse(JSON.stringify(save));
    assert.eq(Quests.claim(restored, 'a'), null);
    assert.eq(Quests.assign(restored, 'next', 'archive').need, 1);
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
})();
