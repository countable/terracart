(function () {
  test('hives: house taps attack live hives and restore destroyed ones', () => {
    const house = { kind: 'house', id: 'tap-hive', hive: 'mushroom', tier: 9 };
    const save = {};
    const calls = [];
    const scene = { save, startCombat(o) { calls.push(['attack', o]); },
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
})();
