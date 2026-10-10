// Execute the shipping damage entry point with an explicit publisher gate.
(function () {
  const start = SCENE_SRC.indexOf('\n  _damageEnemy(c, amount, source');
  const end = SCENE_SRC.indexOf('\n  }\n', start);
  const makeDamage = new Function('Multiplayer', 'slimeCharging', 'enemySplit',
    'ENEMY_HEALTH_RING_MS', 'DMG_POPUP_BEAT_MS',
    'return ({' + SCENE_SRC.slice(start + 1, end + 4) + '})._damageEnemy;');

  function harness(allowed) {
    const events = [];
    const scene = {
      save: { boonUntil: {} },
      _popDamageNumber(c, amount) { events.push(['number', amount]); },
      resolveDefeat(c, source) { events.push(['death', source]); },
    };
    scene._damageEnemy = makeDamage({
      shouldApplyDamage(s, c, source) {
        assert.eq(s, scene);
        events.push(['gate', source, Combat.hp(c)]);
        return allowed;
      },
      reportHit(s, c, amount, source) { events.push(['hit', source, amount]); },
    }, () => false, () => null, 1000, 100);
    return { scene, events };
  }

  test('multiplayer damage routes: denied world blows have no combat side effects', () => {
    for (const source of ['lava', 'light', 'burn', 'obstacle', 'enemy']) {
      const { scene, events } = harness(false);
      const c = { kind: 'goblin', id: 'gate-foe', _hp: 20, _sleepUntil: 12345 };
      const before = JSON.stringify(c);
      assert.falsy(scene._damageEnemy(c, 1000, source));
      assert.eq(JSON.stringify(c), before, source + ' did not mutate the foe');
      assert.eq(events.length, 1, 'only the publisher gate ran');
      assert.eq(events[0][0], 'gate');
    }
  });

  test('multiplayer damage routes: accepted blows report once after damage and before death', () => {
    for (const source of ['player', 'pet', 'ally', 'turret', 'peer', 'lava', 'enemy']) {
      const { scene, events } = harness(true);
      const c = { kind: 'goblin', id: 'gate-foe', _hp: 20 };
      assert.truthy(scene._damageEnemy(c, 1000, source, { exact: true }));
      assert.eq(events[0][0], 'gate');
      assert.eq(events[0][2], 20, 'gate sees undamaged HP');
      const hits = events.filter(e => e[0] === 'hit');
      assert.eq(hits.length, 1);
      assert.eq(hits[0][1], source);
      assert.eq(hits[0][2], 20, 'reports actual health lost');
      assert.eq(events[events.length - 1][0], 'death');
      assert.eq(events[events.length - 1][1], source);
    }
  });
})();
