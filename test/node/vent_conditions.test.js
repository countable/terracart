(function () {
  function lift(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    assert.gte(start, 0, signature);
    return SCENE_SRC.slice(start + 1, SCENE_SRC.indexOf('\n  }\n', start) + 4);
  }
  const methods = new Function('return ({' + [
    '_bodyHold() {', '_stopDownedActions() {', 'startCombat(victim, opts = {}) {', '_meleeTarget(enemies, px, py) {', '_drawWorkProgress() {',
    'canThrowItem(id) {', 'readTomeFirewall() {', 'useExplosiveFlask() {',
  ].map(lift).join(',') + '});')();
  test('vent conditions: exact burn, poison and paralysis durations survive normalization and expire', () => {
    for (const [id, durationMs] of [['burning', 6000], ['poison', 30000], ['paralysis', 5000]]) {
      const save = { energy: 100 };
      assert.truthy(Conditions.apply(save, id, 0, { durationMs }));
      Conditions.normalize(save);
      assert.eq(save.conditions[id].remainingMs, durationMs);
      Conditions.tick(save, durationMs - 1);
      assert.truthy(Conditions.active(save, id));
      Conditions.tick(save, 1);
      assert.falsy(Conditions.active(save, id));
    }
    assert.eq(Conditions.DEFINITIONS.burning.durationMs, 5000);
    assert.eq(Conditions.DEFINITIONS.poison.durationMs, 60000);
  });
  test('vent conditions: short exposures keep longer effects and damage cadence; immunity still applies', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'poison', 0);
    Conditions.tick(save, 750);
    Conditions.apply(save, 'poison', 0, { durationMs: 30000 });
    assert.eq(save.conditions.poison.remainingMs, 59250);
    assert.eq(save.conditions.poison.nextTickMs, 1250);
    Conditions.apply(save, 'burning', 0, { durationMs: 6000 });
    Conditions.tick(save, 1000);
    Conditions.apply(save, 'burning', 0, { durationMs: 6000 });
    assert.eq(save.conditions.burning.remainingMs, 6000);
    Conditions.apply(save, 'burning', 0);
    assert.eq(save.conditions.burning.remainingMs, 6000, 'default burn does not refresh');
    assert.falsy(Conditions.apply({ fireResistancePotionUntil: 100 }, 'burning', 0, { durationMs: 6000 }));
    assert.falsy(Conditions.apply(save, 'poison', 0, { durationMs: NaN }));
  });
  test('vent paralysis: yellow status holds the central body gate and releases at exactly five seconds', () => {
    const s = Object.assign({ save: { energy: 100 }, _walkHazardSlow: () => false }, methods);
    Conditions.apply(s.save, 'paralysis', 0, { durationMs: 5000 });
    assert.truthy(s._bodyHold().pinned);
    assert.eq(Conditions.movementMul(s.save), 0);
    assert.eq(Conditions.DEFINITIONS.paralysis.tint, 0xffdf38);
    Conditions.tick(s.save, 4999);
    assert.truthy(s._bodyHold().pinned);
    Conditions.tick(s.save, 1);
    assert.falsy(s._bodyHold().pinned);
    assert.eq(Conditions.movementMul(s.save), 1);
  });
  test('vent paralysis: manual and automatic melee, pending blows and hand attacks refuse without spending', () => {
    const target = { kind: 'slime', _hp: 20 };
    const s = Object.assign({ save: { energy: 100 }, _workProgress: null,
      _drawSwordSwing() {}, _drawWatering() {},
      _damageEnemy() { throw Error('A paralysed player must not hit'); },
    }, methods);
    Conditions.apply(s.save, 'paralysis');
    for (const auto of [false, true]) assert.eq(s.startCombat(target, { auto }), false);
    s._drawWorkProgress(); assert.eq(target._hp, 20);
    assert.eq(s.canThrowItem('throwing_spear'), false);
    assert.eq(s.readTomeFirewall(), false);
    assert.eq(s.useExplosiveFlask(), false);
    assert.eq(s.save.energy, 100);
    Conditions.useAntidote(s.save);
    assert.falsy(Conditions.attacksBlocked(s.save));
  });
  test('vent paralysis: real update movement gate blocks GPS follow, stick, keyboard and drift', () => {
    const start = SCENE_SRC.indexOf('const bodyHold = this._bodyHold();');
    const end = SCENE_SRC.indexOf('\n    }\n    // THE DRAIN ROLL-UP flushes here', start);
    assert.gte(end, start);
    const step = new Function('stick', 'vx', 'vy', 'speedMul', 'dt', SCENE_SRC.slice(start, end + 6));
    const fail = () => { throw Error('Paralysis must hold every movement source'); };
    const s = Object.assign({ save: {}, startWorldM: { x: 100, y: 100 }, playerM: { x: 3, y: 4 },
      _tickWalkHazards() {}, _steerManual: fail, _steerTarget: fail, _followStep: fail, _driftHome: fail,
    }, methods);
    Conditions.apply(s.save, 'paralysis');
    step.call(s, { x: 1, y: 0 }, 1, 0, 1, .1);
    assert.eq(s.playerM.x, 3); assert.eq(s.playerM.y, 4);
  });
  test('vent paralysis: actual ranged gate and dragon breath stop while prior shots remain intact', () => {
    const expr = SCENE_SRC.match(/const rangedArmed = ([\s\S]*?);/)[1];
    const gate = new Function('px', 'py', 'enemies', 'reachCells', 'return ' + expr);
    const enemy = { kind: 'slime', x: 7, y: 0 };
    const oldShot = { id: 'already-flying' };
    const s = { save: { energy: 100, dragonStory: { fireBreath: true } }, cellM: 7,
      _shots: [oldShot], isShadowActive: () => false, _meleeTarget: methods._meleeTarget };
    assert.truthy(gate.call(s, 0, 0, [enemy], () => 2));
    Conditions.apply(s.save, 'paralysis');
    assert.falsy(gate.call(s, 0, 0, [enemy], () => 2));
    assert.eq(DragonStory.tick(s, 1000, 0, 0, [enemy]), null);
    assert.eq(s._shots[0], oldShot);
    Conditions.tick(s.save, 5000);
    assert.truthy(gate.call(s, 0, 0, [enemy], () => 2));
  });
})();
