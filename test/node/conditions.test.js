(function () {
  test('jellyfish stun: halves trained attack speed without changing hit damage, refreshes and expires', () => {
    const save = { energy: 100, training: { speed: 5 } };
    const baseline = Combat.playerAttackIntervalMul(save);
    const damage = Combat.meleeSwingDamage({});
    Conditions.apply(save, 'jellyfish_stun');
    assert.eq(Combat.playerAttackIntervalMul(save), baseline * 2);
    assert.eq(Combat.meleeSwingDamage({}), damage);
    Conditions.tick(save, 4000);
    Conditions.apply(save, 'jellyfish_stun');
    assert.eq(save.conditions.jellyfish_stun.remainingMs, 5000);
    Conditions.normalize(save);
    assert.eq(save.conditions.jellyfish_stun.remainingMs, 5000);
    Conditions.tick(save, 4999);
    assert.eq(Combat.playerAttackIntervalMul(save), baseline * 2, 'still slowed just before expiry');
    Conditions.tick(save, 1);
    assert.eq(Combat.playerAttackIntervalMul(save), baseline, 'normal speed at exactly five seconds');
    assert.eq(save.energy, 100, 'stun has no additional damage ticks');
    Conditions.apply(save, 'jellyfish_stun');
    assert.truthy(Conditions.useAntidote(save));
    assert.eq(Combat.playerAttackIntervalMul(save), baseline);
  });
  test('jellyfish stun: pending melee and ranged attacks retain progress when speed changes', () => {
    const body = SCENE_SRC.match(/\n  _syncAttackConditionSpeed\(\) \{([\s\S]*?)\n  \}\n/)[1];
    const sync = new Function('Conditions', 'performance', body);
    const scene = { save: {}, _nextBlowT: 1500, _nextShotT: { bow: 2000, staff: 4000 } };
    const clock = { now: () => 1000 };
    Conditions.apply(scene.save, 'jellyfish_stun');
    sync.call(scene, Conditions, clock);
    assert.eq(scene._nextBlowT, 2000);
    assert.eq(scene._nextShotT.bow, 3000);
    assert.eq(scene._nextShotT.staff, 7000);
    Conditions.cure(scene.save, 'jellyfish_stun');
    sync.call(scene, Conditions, clock);
    assert.eq(scene._nextBlowT, 1500);
    assert.eq(scene._nextShotT.staff, 4000);
  });
  test('jellyfish stun: scene clock restores pending attack speed at exactly five seconds', () => {
    const body = name => SCENE_SRC.match(new RegExp('\\n  ' + name + '\\(\\) \\{([\\s\\S]*?)\\n  \\}\\n'))[1];
    const sync = new Function('Conditions', 'performance', body('_syncAttackConditionSpeed'));
    const tick = new Function('Conditions', 'performance', 'document', 'persistSave', body('_tickConditions'));
    let now = 1000;
    const clock = { now: () => now };
    const scene = { save: { energy: 100 }, _conditionLastT: now, _conditionVisibilityHandler() {},
      _syncStatusRow() {}, _announceStatuses() {}, _nextBlowT: 5000, _nextShotT: { staff: 7000 },
      _syncAttackConditionSpeed() { sync.call(this, Conditions, clock); } };
    Conditions.apply(scene.save, 'jellyfish_stun');
    scene._syncAttackConditionSpeed();
    assert.eq(scene._nextBlowT, 9000);
    assert.eq(scene._nextShotT.staff, 13000);
    now += 4999;
    tick.call(scene, Conditions, clock, { hidden: false }, () => {});
    assert.eq(scene._nextShotT.staff, 13000, 'no early restoration');
    now++;
    tick.call(scene, Conditions, clock, { hidden: false }, () => {});
    assert.falsy(Conditions.active(scene.save, 'jellyfish_stun'));
    assert.eq(scene._nextBlowT, 7500);
    assert.eq(scene._nextShotT.staff, 9500, 'remaining slow cooldown shrinks immediately on expiry');
  });
  test('spider and jellyfish: combat rows carry their timed conditions', () => {
    assert.eq(Combat.monster('spider').condition, 'poison');
    assert.eq(Conditions.DEFINITIONS[Combat.monster('spider').condition].durationMs, 60000);
    assert.eq(Combat.monster('jellyfish').condition, 'jellyfish_stun');
    assert.eq(Conditions.DEFINITIONS[Combat.monster('jellyfish').condition].durationMs, 5000);
  });
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
    assert.falsy(Combat.monster('cave_slime')?.condition);
    // The one blow writer lands the row's condition with a blow that cost something.
    assert.truthy(/if \(lost > 0 && condition\) scene\._applyCondition\(condition\);/.test(CREATURE_AI_SRC));
    assert.truthy(/foeBlowLands\(scene, c, raw, \{ condition: Combat\.monster\(c\.kind\)\?\.condition \}\)/.test(CREATURE_AI_SRC));
  });
  test('Elixir: upgraded maximum refill clears debuffs, keeps cooldown; refuses healthy full/downed', () => {
    const save = { energy: 10, vigourUpgrades: 3, eaten: ['potato'], eatReadyAt: 12345 };
    Conditions.apply(save, 'poison');
    assert.truthy(Conditions.useElixir(save));
    assert.eq(save.energy, Energy.maxEnergy(save));
    assert.gt(save.energy, STARTING_ENERGY);
    assert.eq(save.eatReadyAt, 12345);
    assert.falsy(Conditions.active(save, 'poison'));
    assert.falsy(Conditions.useElixir(save));
    Conditions.apply(save, 'poison');
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
      const scene = { save, flash() {}, _syncStatusRow() {}, _announceStatuses() {}, _syncAttackConditionSpeed() {}, _popEnergy() {}, updateEnergyDOM() {},
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
  test('cleansing item methods release a trap pin at full energy and consume once', () => {
    for (const [method, id] of [['drinkAntidote', 'antidote'], ['drinkElixir', 'elixir']]) {
      const body = SCENE_SRC.match(new RegExp('\\n  ' + method + '\\(\\) \\{([\\s\\S]*?)\\n  \\}\\n'))[1];
      const fn = new Function('getSelectedSlot', 'Conditions', body);
      const save = { energy: 1, inv: [{ id, count: 2 }] };
      Energy.set(save, Energy.maxEnergy(save));
      let consumed = 0, synced = 0;
      Conditions.apply(save, 'pinned');
      const scene = { save,
        flash() {}, _syncStatusRow() { synced++; }, _popEnergy() {}, updateEnergyDOM() {},
        _finishConsumable() { consumed++; return true; } };
      const call = () => fn.call(scene, s => s.inv[0], Conditions);
      assert.truthy(call());
      assert.falsy(Conditions.active(save, 'pinned'));
      assert.eq(consumed, 1);
      assert.eq(synced, 1);
      assert.falsy(call());
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
    const scene = { save, _conditionLastT: 5000, _conditionVisibilityHandler() {}, _announceStatuses() {}, _syncStatusRow() {}, _syncAttackConditionSpeed() {} };
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
    const scene = { save: { energy: 100 }, _announceStatuses() {}, _syncStatusRow() {}, _syncAttackConditionSpeed() {}, _flashPlayerHit() {}, _popEnergy() {}, _warnIfTiring() {}, updateEnergyDOM() {} };
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

// Burn clocks are shared by the player and all units.
(function () {
  test('burning: five seconds of brief contact expire without damage below ten seconds', () => {
    const save = { energy: 50 };
    assert.truthy(Conditions.apply(save, 'burning'));
    const result = Conditions.tick(save, 5000);
    assert.eq(result.ticks, 5);
    assert.eq(result.lost, 0);
    assert.truthy(result.expired);
    assert.falsy(Conditions.active(save, 'burning'));
  });
  test('burning: exposure grows five seconds per second, caps at sixty and preserves cadence', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'burning');
    Conditions.tick(save, 700, { burningExposure: true });
    assert.falsy(Conditions.apply(save, 'burning'));
    assert.eq(save.conditions.burning.remainingMs, 8500);
    assert.eq(Conditions.tick(save, 300, { burningExposure: true }).lost, 1);
    assert.eq(save.conditions.burning.remainingMs, 10000);
    Conditions.tick(save, 10000, { burningExposure: true });
    assert.eq(save.conditions.burning.remainingMs, 60000);
    assert.eq(Conditions.tick(save, 1000, { burningExposure: true }).lost, 6);
    assert.eq(save.conditions.burning.remainingMs, 60000);
    assert.eq(Conditions.tick(save, 1000).lost, 5);
    assert.eq(save.conditions.burning.remainingMs, 59000);
  });
  test('burning: long frames match small steps during exposure and decay', () => {
    const state = { remainingMs: 5000, nextTickMs: 1000 };
    const whole = Conditions.advanceBurn(state, 12000, true);
    let stepped = state, damage = 0;
    for (let i = 0; i < 120; i++) {
      stepped = Conditions.advanceBurn(stepped, 100, true);
      damage += stepped.damage;
    }
    assert.eq(whole.damage, damage);
    assert.eq(whole.remainingMs, stepped.remainingMs);
    const decay = Conditions.advanceBurn(whole, 60000);
    assert.eq(decay.remainingMs, 0);
    assert.eq(decay.damage, 150);
    assert.eq(state.remainingMs, 5000, 'pure clock does not mutate input');
  });
  test('burning: normalization preserves accumulated duration and clamps at sixty seconds', () => {
    const save = { conditions: { burning: { remainingMs: 43000, nextTickMs: 600 } } };
    Conditions.normalize(save);
    assert.eq(save.conditions.burning.remainingMs, 43000);
    save.conditions.burning.remainingMs = 90000;
    Conditions.normalize(save);
    assert.eq(save.conditions.burning.remainingMs, 60000);
  });
  test('Antidote: burning alone is cured, all simultaneous debuffs clear, buffs and energy remain', () => {
    const save = { energy: 50, shieldPotionUntil: Date.now() + 100000,
      speedPotionUntil: Date.now() + 100000, boonUntil: { fortune: Date.now() + 100000 } };
    const scene = { _shadowUntil: Date.now() + 100000 };
    Conditions.apply(save, 'burning');
    assert.truthy(CONSUMABLE_SPEC.antidote.usable({ save }));
    assert.truthy(Conditions.useAntidote(save));
    assert.falsy(Conditions.active(save, 'burning'));
    for (const id of Object.keys(Conditions.DEFINITIONS)) Conditions.apply(save, id);
    assert.truthy(Conditions.active(save, 'pinned'), 'the trap pin is one of the rows');
    const buffsBefore = JSON.stringify(Buffs.active(save, scene, 0));
    assert.truthy(Conditions.useAntidote(save, scene));
    for (const id of Object.keys(Conditions.DEFINITIONS)) assert.falsy(Conditions.active(save, id));
    assert.eq(JSON.stringify(Buffs.active(save, scene, 0)), buffsBefore);
    assert.eq(Conditions.tick(save, 60000).ticks, 0);
    assert.eq(save.energy, 50, 'no healing or delayed damage');
    assert.falsy(Conditions.useAntidote(save, scene), 'nothing left to cure');
  });
  test('cleansing potions: pin alone enables use; Elixir at full energy cleanses and keeps buffs', () => {
    for (const id of ['antidote', 'elixir']) {
      const save = { energy: 1, shieldPotionUntil: Date.now() + 100000, eatReadyAt: 12345 };
      Energy.set(save, Energy.maxEnergy(save));
      Conditions.apply(save, 'pinned');
      const scene = { save, getMaxEnergy: () => Energy.maxEnergy(save), _slowHere: 'tar' };
      assert.truthy(CONSUMABLE_SPEC[id].usable(scene), `${id} is usable for pin alone`);
      const method = id === 'antidote' ? 'useAntidote' : 'useElixir';
      assert.truthy(Conditions[method](save, scene));
      assert.falsy(Conditions.active(save, 'pinned'));
      assert.eq(scene._slowHere, 'tar', 'environmental hazards remain in place');
      assert.eq(save.eatReadyAt, 12345);
      assert.truthy(save.shieldPotionUntil > Date.now());
      assert.falsy(CONSUMABLE_SPEC[id].usable(scene));
      for (const condition of Object.keys(Conditions.DEFINITIONS)) Conditions.apply(save, condition);
      assert.truthy(CONSUMABLE_SPEC[id].usable(scene), `${id} is usable at full energy with conditions`);
      assert.truthy(Conditions[method](save, scene));
      assert.falsy(Conditions.hasDebuffs(save, scene));
    }
  });
  test('status rows own their look: label, tint and HUD inks, poison steady and fire flickering', () => {
    for (const [id, def] of Object.entries(Conditions.DEFINITIONS)) {
      assert.truthy(def.label && def.ink && def.bg, `${id} has a chip`);
      assert.truthy(Number.isInteger(def.tint), `${id} has a body tint`);
    }
    assert.falsy(Conditions.DEFINITIONS.poison.flicker);
    assert.truthy(Conditions.DEFINITIONS.burning.flicker);
    assert.truthy(Conditions.conditionTintOn('poison', 0) && Conditions.conditionTintOn('poison', Conditions.FLICKER_MS));
    assert.truthy(Conditions.conditionTintOn('burning', 0));
    assert.falsy(Conditions.conditionTintOn('burning', Conditions.FLICKER_MS), 'a burn licks');
    assert.falsy(Conditions.conditionTintOn('nope', 0));
  });
})();
