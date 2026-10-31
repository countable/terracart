(function () {
  test('ice aura: reaches enemies, neighbours and pets, refilling frost and never shortening it', () => {
    for (const c of [{ kind: 'goblin' }, { kind: 'npc', id: 'neighbour' }, { kind: 'cow', id: 'released_cow' }]) {
      assert.truthy(Combat.applyAuraFrost(c, 1000));
      assert.eq(c._frozenUntil, 11000);
      assert.eq(Combat.slowMul(c, 1000), 0.5);
      assert.truthy(Combat.applyAuraFrost(c, 5000));
      assert.eq(c._frozenUntil, 15000, 'an overlapping aura refills the chill (the frozen row tops up)');
      assert.eq(Combat.slowMul(c, 15000), 1, 'expires ten seconds after the last dose');
      assert.truthy(Combat.applyAuraFrost(c, 15000), 'can land again after expiry');
    }
    const foe = { kind: 'goblin', id: 'foe' };
    Combat.applyFrost(foe, 30000, 1000);
    assert.truthy(Combat.applyAuraFrost(foe, 2000));
    assert.eq(foe._frozenUntil, 31000, 'existing powder is not shortened');
    assert.falsy(Combat.applyFrost({ kind: 'cow', id: 'released_cow' }, 30000, 1000), 'powder keeps its hostile-only gate');
  });
  test('ice aura: a chilled neighbour actually walks at half pace', () => {
    const scene = { save: {}, cellM: 10, cellAt: () => ({ loaded: true, type: T.PARK }) };
    const warm = { id: 'npc_warm', kind: 'npc', x: 0, y: 0, homeX: 0, homeY: 0, _npcSteps: 5, _npcDX: 1, _npcDY: 0 };
    const cold = { ...warm, id: 'npc_cold' };
    Combat.applyAuraFrost(cold);
    NPC.tick(scene, warm, 1000, 0.1);
    NPC.tick(scene, cold, 1000, 0.1);
    assert.gt(warm.x, 0);
    assert.eq(cold.x, warm.x / 2);
  });
  test('ice aura: player chill shares creature pace, refills on a repeat and expires without energy damage', () => {
    const save = { energy: 100 };
    assert.truthy(Conditions.apply(save, 'frozen'));
    assert.eq(Conditions.movementMul(save), Combat.STATUS_LOOKS.frozen.slow);
    assert.eq(Combat.playerAttackIntervalMul(save), 2);
    Conditions.tick(save, 4000);
    assert.falsy(Conditions.apply(save, 'frozen'));
    assert.eq(save.conditions.frozen.remainingMs, 10000, 'refilled, never banked');
    Conditions.normalize(save);
    Conditions.tick(save, 9999);
    assert.eq(Conditions.movementMul(save), 0.5);
    Conditions.tick(save, 1);
    assert.eq(Conditions.movementMul(save), 1);
    assert.eq(Combat.playerAttackIntervalMul(save), 1);
    assert.eq(save.energy, 100);
    Conditions.apply(save, 'frozen');
    assert.truthy(Conditions.useAntidote(save));
    assert.eq(Conditions.movementMul(save), 1);
  });
})();
