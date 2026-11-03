(function () {
  test('hives: house taps attack live hives and restore destroyed ones', () => {
    const house = { kind: 'house', id: 'tap-hive', hive: 'mushroom', tier: 9 };
    const save = {};
    const calls = [];
    const scene = { save, startCombat(o) { calls.push(['attack', o]); return true; },
      _isHouseWreck: () => true, presentWreckRestoreModal(x, y, o) { calls.push(['restore', o]); } };
    const tap = liftSceneMethod('shopInteract', { document: { getElementById: () => null } });
    tap.call(scene, 0, 0, house);
    assert.eq(calls[0][0], 'attack');
    Hives.damage(scene, house, Hives.KINDS.mushroom.hp);
    tap.call(scene, 0, 0, house);
    assert.eq(calls[1][0], 'restore');
  });
  test('hives: melee swing shares cooldown and reach without creature defeat rewards', () => {
    let now = 1000;
    const house = { kind: 'house', id: 'swing-hive', hive: 'mushroom', tier: 9, x: 2, y: 0 };
    const scene = { save: { energy: 100 }, cellM: 5, isShadowActive: () => false,
      _toolActionStory() {}, _attackMul: () => 1, _attackFlat: () => 0 };
    const strike = liftSceneMethod('startCombat', { performance: { now: () => now },
      Visibility: { hidden: () => false }, playerWorldM: () => ({ x: 0, y: 0 }), isRiding: () => false });
    assert.truthy(strike.call(scene, house, {}));
    const hp = Hives.health(scene.save, house);
    assert.lt(hp, Hives.KINDS.mushroom.hp);
    assert.falsy(strike.call(scene, house, {}));
    assert.eq(Hives.health(scene.save, house), hp);
    now += 10000; house.x = 500;
    assert.falsy(strike.call(scene, house, {}));
    assert.eq(Hives.health(scene.save, house), hp);
    house.x = 2; scene.save.energy = 0;
    assert.falsy(strike.call(scene, house, {}));
  });
  test('hives: a swing from any neighbouring cell reaches the house body', () => {
    // The blade is measured to the house's body (bodyCells), not its centre:
    // beside it and diagonal to it both land; two cells off does not.
    let now = 1000;
    const cellM = 7, house = { kind: 'house', id: 'body-hive', hive: 'mushroom', tier: 9, x: 0, y: 0 };
    let at = { x: cellM, y: cellM };
    const scene = { save: { energy: 100 }, cellM, isShadowActive: () => false,
      _toolActionStory() {}, _attackMul: () => 1, _attackFlat: () => 0 };
    const strike = liftSceneMethod('startCombat', { performance: { now: () => now },
      Visibility: { hidden: () => false }, playerWorldM: () => at, isRiding: () => false });
    assert.falsy(Combat.inMeleeReach(0, 0, cellM, cellM, cellM, null), 'the bare creature reach falls short of a diagonal');
    assert.truthy(strike.call(scene, house, {}), 'a diagonal neighbour strikes the house');
    now += 10000; at = { x: 0, y: cellM };
    assert.truthy(strike.call(scene, house, {}), 'so does the cell beside it');
    now += 10000; at = { x: 0, y: 2.5 * cellM };
    assert.falsy(strike.call(scene, house, {}), 'two cells off is out of reach');
    for (const row of Object.values(Hives.KINDS)) assert.gt(row.bodyCells, 0);
  });
  test('hives: auto-melee swings at an active hive in reach when no foe is closer', () => {
    assert.truthy(/for \(const house of Hives\.nearby\(this\)\)/.test(SCENE_SRC), 'the auto-engage lane reads the nearby hives');
    const house = { kind: 'house', id: 'near-hive', hive: 'mushroom', tier: 9 };
    const scene = { save: {}, _hives: { near: [house], clocks: new Map() } };
    assert.eq(Hives.nearby(scene)[0], house);
    Hives.damage(scene, house, Hives.KINDS.mushroom.hp);
    assert.eq(Hives.nearby(scene).length, 0, 'a cleared hive drops out');
  });
})();
