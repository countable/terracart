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
  test('spider web and jellyfish: timed conditions follow their attack delivery', () => {
    assert.eq(EnemyRoster.get('spider').attackType, 'web');
    assert.falsy(Combat.monster('spider').condition, 'silk applies paralysis on ground contact');
    assert.eq(SpiderWebs.CONFIG.paralysisMs, 6000);
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
  test('conditions: an additional hit keeps the greater of remaining and inflicted duration', () => {
    const save = { energy: 100 };
    // Burning and poison are the `stack` rows and paralysis the `hold` row
    // (condition_repeat.test.js); contact with fire (`stack: false`) takes
    // this top-up rule, so burning stays in the sweep that way.
    for (const id of ['confused', 'jellyfish_stun', 'pinned', 'blinded', 'burning']) {
      const def = Conditions.DEFINITIONS[id];
      // Each later hit lands past the one-dose-a-second window.
      const hit = (now) => Conditions.apply(save, id, now, id === 'burning' ? { stack: false } : {});
      hit(0);
      Conditions.tick(save, Math.floor(def.durationMs / 2));
      hit(5000);
      assert.eq(save.conditions[id].remainingMs, def.durationMs, `${id}: a hit on a fading effect tops it back up`);
      const longer = Math.min(def.durationMs + 1000, def.maxDurationMs || def.durationMs);
      save.conditions[id].remainingMs = longer;
      hit(10000);
      assert.eq(save.conditions[id].remainingMs, longer, `${id}: a hit never shortens a longer effect`);
      Conditions.cure(save, id);
    }
    Conditions.apply(save, 'frozen', 0);
    Conditions.tick(save, 4000);
    Conditions.apply(save, 'frozen', 5000);
    assert.eq(save.conditions.frozen.remainingMs, 10000, 'frozen refills like the rest (an aura keeps a body chilled)');
  });
  test('conditions: one dose a second — a repeat landing inside a second of play is ignored, the next tops up', () => {
    assert.eq(Conditions.APPLY_DEBOUNCE_MS, 1000);
    // On a top-up row (confusion); the stacking rows bank past the window
    // (condition_repeat.test.js), the window itself is the same.
    const save = { energy: 100 };
    assert.truthy(Conditions.apply(save, 'confused'));
    Conditions.tick(save, 400);
    assert.falsy(Conditions.apply(save, 'confused'), 'inside the window: ignored');
    assert.eq(save.conditions.confused.remainingMs, 9600, 'and no top-up');
    Conditions.tick(save, 599);
    assert.falsy(Conditions.apply(save, 'confused'));
    assert.eq(save.conditions.confused.remainingMs, 9001);
    Conditions.tick(save, 1);
    assert.falsy(Conditions.apply(save, 'confused'), 'not fresh, so false');
    assert.eq(save.conditions.confused.remainingMs, 10000, 'but a second of play on, it tops up');
    Conditions.tick(save, 500);
    assert.falsy(Conditions.apply(save, 'confused'));
    assert.eq(save.conditions.confused.remainingMs, 9500, 'the window restarts from the last landing');
    assert.truthy(Conditions.apply(save, 'paralysis'), 'another status keeps its own clock');
    assert.truthy(Conditions.apply({ energy: 100 }, 'confused'), 'and another body its own');
    assert.truthy(Conditions.cure(save, 'confused'));
    assert.truthy(Conditions.apply(save, 'confused'), 'a cure clears the stamp: the next dose lands at once');
    // Time is play, never the wall: a later wall-clock `now` alone changes nothing.
    assert.falsy(Conditions.apply(save, 'confused', Date.now() + 60000));
    // A refused dose leaves no stamp: the first real landing is not debounced by it.
    const immune = { energy: 100, immortalPotionUntil: 2000 };
    assert.falsy(Conditions.apply(immune, 'burning', 1000), 'immune');
    assert.truthy(Conditions.apply(immune, 'burning', 2001));
    // The row the gorgon lands: paralysis in stone grey, five seconds, no stacking.
    const stone = Conditions.DEFINITIONS.petrified, para = Conditions.DEFINITIONS.paralysis;
    assert.eq(stone.durationMs, 5000); assert.eq(stone.maxDurationMs, 5000);
    assert.truthy(stone.blocksMovement && stone.blocksAttacks && para.blocksMovement && para.blocksAttacks);
    assert.eq(stone.tint, 0x8f8f8f, 'grey');
    assert.truthy(Conditions.apply(save, 'petrified'));
    assert.truthy(Conditions.movementBlocked(save) && Conditions.attacksBlocked(save));
    Conditions.tick(save, 2000);
    Conditions.apply(save, 'petrified');
    assert.eq(save.conditions.petrified.remainingMs, 5000, 'topped up, never stacked');
    assert.truthy(Conditions.describe('petrified').includes('stone'));
    assert.truthy(StatusIcons.frames[stone.icon] != null, 'its chip has an icon frame');
  });
  test('poison: a repeat banks its minute without postponing the next tick', () => {
    const save = { energy: 100 };
    assert.truthy(Conditions.apply(save, 'poison', 0));
    Conditions.tick(save, 1500);
    assert.falsy(Conditions.apply(save, 'poison', 1500));
    assert.eq(save.conditions.poison.remainingMs, 118500, 'banked on the 58.5 s left (the repeat rule)');
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
    assert.truthy(/if \(lost > 0 && condition\) scene\._applyCondition\(condition,\s*\{ \.\.\.conditionOptions, \.\.\.\(conditionDurationMs != null \? \{ durationMs: conditionDurationMs \} : \{\}\) \}\);/.test(CREATURE_AI_SRC));
    assert.truthy(/foeBlowLands\(scene, c, raw, \{ condition: Combat\.monster\(c\.kind\)\?\.condition, conditionDurationMs: row\.conditionDurationMs \}\)/.test(CREATURE_AI_SRC));
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
      const fn = new Function('getSelectedSlot', 'Conditions', 'kept', body);
      const save = { energy: 0, inv: [{ id, count: 2 }] };
      let consumed = 0;
      const scene = { save, flash() {}, flashAtPlayer() {}, _syncStatusRow() {}, _announceStatuses() {}, _syncAttackConditionSpeed() {}, _popEnergy() {}, updateEnergyDOM() {},
        _selectedConsumable(id) { const sel = this.save.inv[0]; return sel && sel.id === id && sel.count > 0 ? sel : null; },
        _finishConsumable() { consumed++; return true; } };
      const call = () => fn.call(scene, s => s.inv[0], Conditions, (why, noun) => `${why} — ${noun} kept.`);
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
      const fn = new Function('getSelectedSlot', 'Conditions', 'kept', body);
      const save = { energy: 1, inv: [{ id, count: 2 }] };
      Energy.set(save, Energy.maxEnergy(save));
      let consumed = 0, synced = 0;
      Conditions.apply(save, 'pinned');
      const scene = { save,
        flash() {}, flashAtPlayer() {}, _syncStatusRow() { synced++; }, _popEnergy() {}, updateEnergyDOM() {},
        _selectedConsumable(id) { const sel = this.save.inv[0]; return sel && sel.id === id && sel.count > 0 ? sel : null; },
        _finishConsumable() { consumed++; return true; } };
      const call = () => fn.call(scene, s => s.inv[0], Conditions, (why, noun) => `${why} — ${noun} kept.`);
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
    Conditions.apply(save, 'poison', Date.now(), { stack: false }); // a top-up: duration ends 1 s after the final tick.
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
  test('burning: five seconds of brief contact cost a pip a second, then expire', () => {
    const save = { energy: 50 };
    assert.truthy(Conditions.apply(save, 'burning'));
    const result = Conditions.tick(save, 5000);
    assert.eq(result.ticks, 5);
    assert.eq(result.lost, 5, 'fire on the body never burns for nothing (burnTickLoss floors at energyLoss)');
    assert.eq(save.energy, 45);
    assert.truthy(result.expired);
    assert.falsy(Conditions.active(save, 'burning'));
  });
  test('burning: a hit banks on top of what is left, capped at sixty seconds; contact only tops up', () => {
    const def = Conditions.DEFINITIONS.burning;
    assert.eq(def.repeat.mode, 'stack', 'a stacking row');
    // A second of play between hits: the one-dose-a-second window applies to
    // banking too, so a per-frame source can never pile a burn up.
    const save = { energy: 100 };
    const second = () => Conditions.tick(save, 1000);
    assert.truthy(Conditions.apply(save, 'burning'));
    assert.eq(save.conditions.burning.remainingMs, 5000);
    assert.falsy(Conditions.apply(save, 'burning'), 'within the second: ignored');
    assert.eq(save.conditions.burning.remainingMs, 5000);
    second();
    assert.falsy(Conditions.apply(save, 'burning'), 'not fresh');
    assert.eq(save.conditions.burning.remainingMs, 9000, 'a second hit banks its five seconds on the four left');
    second();
    Conditions.apply(save, 'burning', Date.now(), { durationMs: 6000 });
    assert.eq(save.conditions.burning.remainingMs, 14000, 'a blast banks its own length');
    second();
    Conditions.apply(save, 'burning', Date.now(), { stack: false });
    assert.eq(save.conditions.burning.remainingMs, 13000, 'contact with fire never shortens or adds');
    save.conditions.burning.remainingMs = 2000;
    second();
    Conditions.apply(save, 'burning', Date.now(), { stack: false });
    assert.eq(save.conditions.burning.remainingMs, 5000, 'contact tops a fading burn back up');
    save.conditions.burning.remainingMs = 58000;
    second();
    Conditions.apply(save, 'burning');
    assert.eq(save.conditions.burning.remainingMs, def.maxDurationMs, 'capped');
    second();
    assert.eq(save.conditions.burning.nextTickMs, 1000, 'the tick phase is kept across hits');
    const other = { energy: 100 };
    Conditions.apply(other, 'confused'); other.conditions.confused.remainingMs = 3000;
    Conditions.tick(other, 1000);
    Conditions.apply(other, 'confused');
    assert.eq(other.conditions.confused.remainingMs, 10000, 'a row with no repeat rule still tops up, never banks');
  });
  test('burning: exposure grows five seconds per second, caps at sixty and preserves cadence', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'burning');
    Conditions.tick(save, 700, { burningExposure: true });
    assert.falsy(Conditions.apply(save, 'burning', Date.now(), { stack: false }));
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
    // 60 s of decay: floor(remaining s / 10) a second sums to 150, plus one
    // pip for each of the last ten seconds, which the floor at energyLoss keeps.
    assert.eq(decay.damage, 160);
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

test('furniture Wash: clears every debuff, preserves buffs, energy and food cooldown', () => {
  const record = { id: 'tub', itemId: 'washtub' };
  const save = { furniture: [record], energy: 42, eatReadyAt: 12345, shieldPotionUntil: Date.now() + 60000 };
  for (const id of Object.keys(Conditions.DEFINITIONS)) Conditions.apply(save, id);
  const messages = [];
  const scene = Object.assign(Object.create(SceneFurniture.prototype), {
    save, depth: 0, _furnitureAbilityAllowed: () => true,
    flashAtPlayer: msg => messages.push(msg), _syncStatusRow() { this.synced = (this.synced || 0) + 1; },
  });
  const buff = save.shieldPotionUntil;
  assert.truthy(scene.useFurniture(record));
  assert.falsy(Conditions.hasDebuffs(save));
  assert.eq(save.energy, 42); assert.eq(save.eatReadyAt, 12345); assert.eq(save.shieldPotionUntil, buff);
  assert.eq(scene.synced, 1); assert.eq(messages[0], 'Debuffs cleared.');
  scene.useFurniture(record);
  assert.eq(messages[1], 'Cool, clear water.');
});
