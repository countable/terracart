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
  test('flight: natural flyers and inherited variants remain airborne after potion expiry and reload', () => {
    const kinds = ['bat', 'bee', 'vampire_bat', 'gull', 'raven', 'storm_gull',
      'sword_spirit', 'ghost', 'pink_ghost', 'giant_bat', 'giant_ghost',
      'summoned_wraith', 'crow', 'spirit_raven', 'azure_butterfly'];
    for (const kind of kinds) {
      const restored = JSON.parse(JSON.stringify({ kind, flightPotionUntil: 1000 }));
      assert.truthy(Conditions.flying(restored, 2000), kind);
      assert.truthy(Conditions.flying(restored, Number.MAX_SAFE_INTEGER), kind + ': permanent');
      assert.falsy(Conditions.damageImmune(restored, 2000), kind + ': attacks still hurt');
      assert.falsy(Conditions.fireImmune(restored, 2000), kind + ': airborne is not fireproof');
      assert.falsy(Buffs.active(restored, null, 2000).some(b => b.id === 'flight'), kind + ': no infinite countdown');
    }
    for (const kind of ['rat', 'spider', 'slime', 'giant_slime', 'npc', 'unknown']) {
      assert.falsy(Conditions.flying({ kind }, 2000), kind + ': grounded');
    }
    assert.falsy(Conditions.flying(undefined, 2000));
    assert.falsy(Conditions.flying({}, 2000));
  });
  test('flight: natural flyers take no ground walking damage with no potion timer', () => {
    const scene = { _walkHazardExposure: () => 2,
      _damageEnemy(c, amount) { c._hp -= amount; return false; } };
    for (const kind of ['bat', 'ghost', 'giant_bat', 'zombie']) {
      const c = { id: 'ground-contact-' + kind, kind, x: 0, y: 0, _hp: 100 };
      enemyWalkHazardTick(scene, c, 0);
      for (let i = 1; i <= 20; i++) {
        c.x += .1;
        enemyWalkHazardTick(scene, c, i * 100);
      }
      assert.eq(c._hp, kind === 'zombie' ? 96 : 100, kind);
    }
  });
})();
