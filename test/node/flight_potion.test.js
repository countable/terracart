(function () {
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start, name);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  }
  test('flight potion: one minute of persisted flight without general damage or fire immunity', () => {
    const spec = CONSUMABLE_SPEC.flight_potion;
    assert.eq(spec.durationMs, 60000);
    assert.eq(spec.buff, 'flight');
    assert.truthy(isPotion('flight_potion'));
    const save = { energy: 100 };
    Buffs.extend(save, null, 'flight', spec.durationMs, 1000);
    const restored = JSON.parse(JSON.stringify(save));
    assert.truthy(Conditions.flying(restored, 60999));
    assert.falsy(Conditions.flying(restored, 61000));
    assert.falsy(Conditions.damageImmune(restored, 1000));
    assert.falsy(Conditions.fireImmune(restored, 1000));
    assert.truthy(Conditions.apply(restored, 'poison', 1000));
    assert.truthy(Conditions.apply(restored, 'burning', 1000));
    PlayerTime.reset({ save: restored });
    assert.falsy(Conditions.flying(restored, 1000));
  });
  test('flight potion: body rises above unchanged ground coordinates and lowers at expiry', () => {
    const old = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
      const scene = { save: { energy: 100, flightPotionUntil: 61000 }, playerFeetNudgeY: -12,
        playerM: { x: 3, y: 5 }, _obstacleStep: { liftPx: 2 } };
      const bodyDy = method('playerBodyDy');
      assert.eq(bodyDy.call(scene), -12 - CONSUMABLE_SPEC.flight_potion.liftPx);
      assert.eq(scene.playerM.x, 3);
      assert.eq(scene.playerM.y, 5);
      now = 61000;
      assert.eq(bodyDy.call(scene), -14);
      scene._obstacleStep = null;
      assert.eq(bodyDy.call(scene), -12);
    } finally { Date.now = old; }
  });
  test('flight potion: thrown effect survives creature reconstruction and expires', () => {
    const now = Date.now(), scene = { save: {} }, c = { id: 'flight-target', kind: 'rat' };
    assert.truthy(PotionEffects.apply(scene, c, 'flight_potion', now));
    assert.truthy(Conditions.flying(c, now));
    const rebuilt = { id: c.id, kind: c.kind };
    PotionEffects.restore(scene, rebuilt, now + 1000);
    assert.truthy(Conditions.flying(rebuilt, now + 59999));
    assert.falsy(Conditions.flying(rebuilt, now + 60000));
  });
})();
