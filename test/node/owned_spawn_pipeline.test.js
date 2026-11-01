// Explicit requests share execution without borrowing an ambient population.
(function () {
  const drain = iterator => WorldGen.runSteps(iterator);
  test('owned requests: duplicates are rejected before selecting or reserving a seat', () => {
    const existing = new Set(['kept']), seated = [], created = [], persisted = [];
    const out = drain(CreatureSpawns.generateOwnedSteps('guild-bounty', 'contract-a', {
      count: 3, existing, member: n => ({ id: n === 0 ? 'kept' : 'new', kind: 'slime' }),
      seat: member => { seated.push(member.id); return { x: 7, y: 14 }; },
      create: member => { created.push(member.id); return { ...member }; },
      onPlaced: record => persisted.push(record.id),
    }));
    assert.eq(out.length, 1);
    assert.eq(seated.join(','), 'new');
    assert.eq(created.join(','), 'new');
    assert.eq(persisted.join(','), 'new');
    assert.eq(out[0]._spawnOwner, 'contract-a');
    assert.eq(out[0]._spawnCategory, 'contract');
  });
  test('owned requests: failed gates leave identities available and do not consume completion', () => {
    const existing = new Set(), writes = [];
    const options = { count: 1, existing, member: () => ({ id: 'guard', kind: 'slime' }),
      seat: () => ({ x: 3, y: 5 }), gate: () => false,
      onPlaced: record => writes.push(record.id) };
    assert.eq(drain(CreatureSpawns.generateOwnedSteps('building-garrisons', 'house', options)).length, 0);
    assert.eq(existing.size, 0); assert.eq(writes.length, 0);
    options.gate = () => true;
    const out = drain(CreatureSpawns.generateOwnedSteps('building-garrisons', 'house', options));
    assert.eq(out.length, 1); assert.eq(existing.size, 1); assert.eq(writes.length, 1);
    assert.eq(out[0].id, 'guard');
  });
  test('owned requests: inactive and capped triggers do not search seats or draw replacements', () => {
    let searches = 0;
    const context = { count: 4, maxAlive: 4, liveCount: 4,
      member: n => ({ id: 'hive-' + n }), seat: () => { searches++; return {}; } };
    assert.eq(drain(CreatureSpawns.generateOwnedSteps('mushroom-hive', 'house', context)).length, 0);
    context.liveCount = 2; context.when = () => false;
    assert.eq(drain(CreatureSpawns.generateOwnedSteps('mushroom-hive', 'house', context)).length, 0);
    assert.eq(searches, 0);
    context.when = () => true; context.create = member => ({ ...member });
    assert.eq(drain(CreatureSpawns.generateOwnedSteps('mushroom-hive', 'house', context)).length, 2);
    assert.eq(searches, 2);
  });
  test('owned requests: sliced selectors and factories retain checkpoints and explicit owners', () => {
    const iterator = CreatureSpawns.generateOwnedSteps('cave-finite', 'cave:seat', {
      count: 1, *member() { yield 'member'; return { kind: 'slime', id: 'fixed' }; },
      *seat() { yield 'seat'; return { x: 1, y: 2 }; },
      *create(member, seat) { yield 'create'; return { ...member, ...seat }; },
      *onPlaced() { yield 'persist'; },
    });
    const checkpoints = []; let result;
    do { result = iterator.next(); if (!result.done) checkpoints.push(result.value); } while (!result.done);
    assert.eq(checkpoints.join(','), 'member,seat,create,persist');
    assert.eq(result.value[0]._spawnSource, 'cave-finite');
    assert.eq(result.value[0]._spawnOwner, 'cave:seat');
  });
  test('owned requests: only story progression is an Event; repeatable trials keep arena records', () => {
    assert.eq(CreatureSpawns.OWNED_RULES['story-witness'].category, 'storyEvent');
    assert.eq(CreatureSpawns.OWNED_RULES.starter.category, 'storyEvent');
    assert.eq(CreatureSpawns.OWNED_RULES['fishing-slime'].category, 'trigger');
    assert.eq(CreatureSpawns.OWNED_RULES['temple-trials'].category, 'contract');
    const trial = TemplePuzzles.create({ kind: 'duel', size: 7, seed: 123, enemyKind: 'giant_reaper' });
    assert.eq(trial.enemies.length, 1);
    assert.eq(trial.enemies[0]._spawnSource, 'temple-trials');
    assert.eq(trial.enemies[0]._spawnOwner, 'trial:duel:123');
    assert.eq(trial.enemies[0].maxHp, 100);
    const restart = TemplePuzzles.create({ kind: 'duel', size: 7, seed: 123, enemyKind: 'giant_reaper' });
    assert.eq(restart.enemies[0].hp, 100);
    assert.eq(restart.enemies[0].id, trial.enemies[0].id);
  });
  test('owned requests: invalid sources and missing owners cannot silently use another rule', () => {
    for (const [source, owner] of [['missing', 'id'], ['toString', 'id'], ['resource-lifecycle', 'object-id'], ['nest', null], ['nest', ''], ['nest', {}]]) {
      let threw = false;
      try { CreatureSpawns.createOwned(source, owner, 'slime', 1, 2, 'id'); } catch (_) { threw = true; }
      assert.truthy(threw, String(source) + ':' + String(owner));
    }
  });
  test('owned feature rules: gates, tar sites, habitat posts and starter guards declare their actual source', () => {
    assert.eq(Lairs.FOCUS_RULES.gate.source, 'gate-guards');
    assert.eq(Lairs.FOCUS_RULES.tar.source, 'tar-guards');
    assert.eq(Lairs.FOCUS_RULES.habitat_marsh.source, 'habitat-lairs');
    assert.eq(Lairs.FOCUS_RULES.cafe.source, 'road-lairs');
    assert.eq(Lairs.FOCUS_RULES.starter_thief.source, 'starter');
    assert.eq(Lairs.FOCUS_RULES[12].source, 'building-garrisons', 'citadels share the building garrison');
    assert.eq(CreatureSpawns.OWNED_RULES['citadel-guards'].aliasOf, 'building-garrisons');
    assert.truthy(CreatureSpawns.OWNED_RULES['resource-lifecycle'].stateOnly);
  });
})();
