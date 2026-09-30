(function () {
  test('poison: first tick after 2 seconds, 30 ticks including expiry', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'poison');
    assert.eq(Conditions.tick(save, 1999).ticks, 0);
    assert.eq(Conditions.tick(save, 1).ticks, 1);
    assert.eq(Conditions.tick(save, 58000).ticks, 29);
    assert.eq(save.energy, 70);
    assert.falsy(Conditions.active(save, 'poison'));
  });
  test('poison: refresh extends duration without postponing the next tick', () => {
    const save = { energy: 100 };
    assert.truthy(Conditions.apply(save, 'poison'));
    Conditions.tick(save, 1500);
    assert.falsy(Conditions.apply(save, 'poison'));
    assert.eq(save.conditions.poison.remainingMs, 60000);
    assert.eq(Conditions.tick(save, 500).ticks, 1);
    assert.eq(save.energy, 99);
  });
  test('poison: armor and Shielding cannot change ticks; downed duration still elapses', () => {
    const save = { energy: 1, shieldPotionUntil: Date.now() + 100000, armor: { boots: { tier: 7 } } };
    Conditions.apply(save, 'poison');
    assert.eq(Conditions.tick(save, 6000).ticks, 3);
    assert.eq(save.energy, 0);
    assert.eq(save.conditions.poison.remainingMs, 54000);
    Energy.set(save, 10);
    Conditions.tick(save, 2000);
    assert.eq(save.energy, 9, 'reviving leaves poison intact');
  });
  test('poison: save/reload preserves remaining time and tick phase, cure cancels boundary tick', () => {
    let save = { energy: 50 };
    Conditions.apply(save, 'poison');
    Conditions.tick(save, 1999);
    save = JSON.parse(JSON.stringify(save));
    Conditions.normalize(save);
    assert.eq(save.conditions.poison.nextTickMs, 1);
    assert.eq(save.conditions.poison.remainingMs, 58001);
    assert.truthy(Conditions.useAntidote(save));
    assert.eq(Conditions.tick(save, 1).ticks, 0);
    assert.eq(save.energy, 50);
    assert.falsy(Conditions.useAntidote(save));
  });
  test('poison: normalize rejects corrupt states and bounds remaining time', () => {
    const save = { conditions: { poison: { remainingMs: Infinity }, unknown: { remainingMs: 5 } } };
    Conditions.normalize(save);
    assert.eq(Object.keys(save.conditions).length, 0);
    save.conditions.poison = { remainingMs: 90000, nextTickMs: -1 };
    Conditions.normalize(save);
    assert.eq(save.conditions.poison.remainingMs, 60000);
    assert.eq(save.conditions.poison.nextTickMs, 0);
  });
  test('poison: Purple Slime variants inherit condition; guarded actual damage applies it', () => {
    assert.eq(Combat.monster('purple_slime').condition, 'poison');
    assert.eq(Combat.monster('giant_purple_slime').condition, 'poison');
    assert.falsy(Combat.monster('cave_slime')?.condition);
    assert.truthy(/lost > 0 && !isTame && Combat.isEnemy\(c\) && m.condition/.test(SCENE_SRC));
  });
  test('Elixir: upgraded maximum refill leaves cooldown and poison intact; refuses full/downed', () => {
    const save = { energy: 10, vigourUpgrades: 3, eaten: ['potato'], eatReadyAt: 12345 };
    Conditions.apply(save, 'poison');
    assert.truthy(Conditions.useElixir(save));
    assert.eq(save.energy, Energy.maxEnergy(save));
    assert.gt(save.energy, STARTING_ENERGY);
    assert.eq(save.eatReadyAt, 12345);
    assert.truthy(Conditions.active(save, 'poison'));
    assert.falsy(Conditions.useElixir(save));
    Energy.set(save, 0);
    assert.falsy(Conditions.useElixir(save));
    assert.eq(save.energy, 0);
    assert.truthy(Conditions.useAntidote(save));
    assert.eq(save.energy, 0, 'Antidote cures while downed without revival');
  });
  test('condition item methods consume only successful effects', () => {
    for (const [method, id] of [['drinkAntidote', 'antidote'], ['drinkElixir', 'elixir']]) {
      const body = SCENE_SRC.match(new RegExp('\\n  ' + method + '\\(\\) \\{([\\s\\S]*?)\\n  \\}\\n'))[1];
      const fn = new Function('getSelectedSlot', 'Conditions', body);
      const save = { energy: 0, inv: [{ id, count: 2 }] };
      let consumed = 0;
      const scene = { save, flash() {}, _syncConditionHUD() {}, _popEnergy() {}, updateEnergyDOM() {},
        _finishConsumable() { consumed++; return true; } };
      const call = () => fn.call(scene, s => s.inv[0], Conditions);
      assert.falsy(call());
      assert.eq(consumed, 0);
      if (id === 'antidote') Conditions.apply(save, 'poison');
      else Energy.set(save, 1);
      assert.truthy(call());
      assert.eq(consumed, 1);
    }
  });
  test('poison: expiry between ticks persists the cure before a reload', () => {
    const body = SCENE_SRC.match(/\n  _tickConditions\(\) \{([\s\S]*?)\n  \}\n/)[1];
    const fn = new Function('Conditions', 'document', 'performance', 'persistSave', body);
    const save = { energy: 100 };
    Conditions.apply(save, 'poison');
    Conditions.tick(save, 1000);
    Conditions.apply(save, 'poison'); // Duration ends 1s after the final tick.
    Conditions.tick(save, 59000);
    assert.eq(save.conditions.poison.remainingMs, 1000);
    assert.eq(save.conditions.poison.nextTickMs, 2000);
    let persisted = null;
    const scene = { save, _conditionLastT: 5000, _conditionVisibilityHandler() {}, _syncConditionHUD() {} };
    fn.call(scene, Conditions, { hidden: false }, { now: () => 6000 },
      state => { persisted = JSON.parse(JSON.stringify(state)); });
    assert.truthy(persisted, 'expiry saves even though no energy tick happened');
    Conditions.normalize(persisted);
    assert.falsy(Conditions.active(persisted, 'poison'), 'reload cannot resurrect the expired condition');
    assert.eq(persisted.energy, 70);
  });
  test('condition clock: hidden and resumed frames skip offline time; dialogs do not pause it', () => {
    const body = SCENE_SRC.match(/\n  _tickConditions\(\) \{([\s\S]*?)\n  \}\n/)[1];
    const fn = new Function('Conditions', 'document', 'performance', 'persistSave', body);
    let now = 1000;
    const doc = { hidden: false, addEventListener() {} };
    const scene = { save: { energy: 100 }, _syncConditionHUD() {}, _flashPlayerHit() {}, _popEnergy() {}, _warnIfTiring() {}, updateEnergyDOM() {} };
    Conditions.apply(scene.save, 'poison');
    const call = () => fn.call(scene, Conditions, doc, { now: () => now }, () => {});
    call(); now += 1000; call();
    doc.hidden = true; scene._conditionVisibilityHandler(); now += 500000; call();
    doc.hidden = false; scene._conditionVisibilityHandler(); call();
    assert.eq(scene.save.energy, 100);
    assert.eq(scene.save.conditions.poison.remainingMs, 59000);
    now += 1000; call();
    assert.eq(scene.save.energy, 99);
  });
})();
