(function () {
  test('web paralysis: player holds movement and attacks for six seconds across normalization', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'paralysis', 1000, { durationMs: 6000 });
    Conditions.normalize(save);
    assert.eq(save.conditions.paralysis.remainingMs, 6000);
    Conditions.tick(save, 5999);
    assert.truthy(Conditions.movementBlocked(save));
    assert.truthy(Conditions.attacksBlocked(save));
    Conditions.tick(save, 1);
    assert.falsy(Conditions.movementBlocked(save));
    assert.falsy(Conditions.attacksBlocked(save));
    assert.eq(save.energy, 100);
    Conditions.apply(save, 'paralysis');
    assert.eq(save.conditions.paralysis.remainingMs, 5000, 'other paralysis sources keep their existing duration');
  });

  test('web paralysis: any body is caught and its current action is cancelled until exact expiry', () => {
    for (const spec of [{ kind: 'spider' }, { kind: 'cow', pet: true }, { kind: 'npc' }, { kind: 'goblin', hidden: true }]) {
      const c = { ...spec, id: 'web_target', x: 7, y: 14, _moving: true, _targetX: 70,
        _attackWindupUntil: 2000, _abilityWindupUntil: 2000, _lungeUntil: 2000 };
      assert.truthy(Combat.paralyze(c, 6000, 1000));
      assert.truthy(Combat.isParalyzed(c, 6999));
      assert.falsy(Combat.isParalyzed(c, 7000));
      assert.falsy(c._moving);
      assert.eq(c._targetX, 7);
      assert.eq(c._attackWindupUntil, null);
      assert.eq(c._abilityWindupUntil, null);
      assert.eq(c._lungeUntil, 0);
      assert.eq(c._statusPop.label, Conditions.DEFINITIONS.paralysis.label);
      assert.eq(c._statusPop.color, Conditions.DEFINITIONS.paralysis.ink);
      Combat.paralyze(c, 1000, 2000);
      assert.truthy(Combat.isParalyzed(c, 6999), 'shorter exposure cannot shorten the existing hold');
    }
  });

  test('web paralysis: neighbour stops walking and resumes after the hold', () => {
    const scene = { save: {}, cellM: 10, cellAt: () => ({ loaded: true, type: WorldGen.T.PARK }) };
    const c = { id: 'npc_web', kind: 'npc', x: 0, y: 0, homeX: 0, homeY: 0,
      _npcSteps: 5, _npcDX: 1, _npcDY: 0 };
    const realNow = Date.now;
    let wall = 1000;
    Date.now = () => wall;
    try {
      Combat.paralyze(c, 6000);
      wall = 6999;
      NPC.tick(scene, c, 5999, 0.1);
      assert.eq(c.x, 0);
      assert.falsy(c._moving);
      wall = 7000;
      NPC.tick(scene, c, 6000, 0.1);
      assert.gt(c.x, 0);
    } finally { Date.now = realNow; }
  });
})();
