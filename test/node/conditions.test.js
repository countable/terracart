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
      const scene = { save, flash() {}, _syncStatusRow() {}, _popEnergy() {}, updateEnergyDOM() {},
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
      const scene = { save, _pinnedUntil: performance.now() + 3000,
        flash() {}, _syncStatusRow() { synced++; }, _popEnergy() {}, updateEnergyDOM() {},
        _finishConsumable() { consumed++; return true; } };
      const call = () => fn.call(scene, s => s.inv[0], Conditions);
      assert.truthy(call());
      assert.eq(scene._pinnedUntil, 0);
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
    const scene = { save, _conditionLastT: 5000, _conditionVisibilityHandler() {}, _syncStatusRow() {} };
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
    const scene = { save: { energy: 100 }, _syncStatusRow() {}, _flashPlayerHit() {}, _popEnergy() {}, _warnIfTiring() {}, updateEnergyDOM() {} };
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

// BURNING (owner, Oct 2026): fire on the body — the second row of the one
// status table. 1 a second for 5 s, out on its own or cleansed; the row owns
// its look (tint, HUD chip) for the player and every burning foe alike.
(function () {
  test('burning: five ticks of one over five seconds, then it goes out on its own', () => {
    const save = { energy: 50 };
    assert.truthy(Conditions.apply(save, 'burning'));
    assert.eq(Conditions.tick(save, 999).ticks, 0);
    assert.eq(Conditions.tick(save, 1).ticks, 1, 'the first point a second in');
    const r = Conditions.tick(save, 4000);
    assert.eq(r.ticks, 4); assert.truthy(r.expired, 'out at five seconds');
    assert.eq(save.energy, 45, 'five points in all');
    assert.falsy(Conditions.active(save, 'burning'));
  });
  test('burning: a fresh contact restarts the five seconds without moving the next tick', () => {
    const save = { energy: 50 };
    Conditions.apply(save, 'burning');
    Conditions.tick(save, 700);
    assert.falsy(Conditions.apply(save, 'burning'), 'not fresh');
    assert.eq(save.conditions.burning.remainingMs, 5000);
    assert.eq(Conditions.tick(save, 300).ticks, 1, 'the tick already due still lands on time');
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
    scene._pinnedUntil = performance.now() + 3000;
    const buffsBefore = JSON.stringify(Buffs.active(save, scene, 0));
    assert.truthy(Conditions.useAntidote(save, scene));
    for (const id of Object.keys(Conditions.DEFINITIONS)) assert.falsy(Conditions.active(save, id));
    assert.eq(scene._pinnedUntil, 0);
    assert.eq(JSON.stringify(Buffs.active(save, scene, 0)), buffsBefore);
    assert.eq(Conditions.tick(save, 60000).ticks, 0);
    assert.eq(save.energy, 50, 'no healing or delayed damage');
    assert.falsy(Conditions.useAntidote(save, scene), 'nothing left to cure');
  });
  test('cleansing potions: pin alone enables use; Elixir at full energy cleanses and keeps buffs', () => {
    for (const id of ['antidote', 'elixir']) {
      const save = { energy: 1, shieldPotionUntil: Date.now() + 100000, eatReadyAt: 12345 };
      Energy.set(save, Energy.maxEnergy(save));
      const scene = { save, _pinnedUntil: performance.now() + 3000,
        getMaxEnergy: () => Energy.maxEnergy(save), _slowHere: 'tar' };
      assert.truthy(CONSUMABLE_SPEC[id].usable(scene), `${id} is usable for pin alone`);
      const method = id === 'antidote' ? 'useAntidote' : 'useElixir';
      assert.truthy(Conditions[method](save, scene));
      assert.eq(scene._pinnedUntil, 0);
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
