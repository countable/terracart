// THE REPEAT RULE (conditions.js repeatDose): what a dose does to a body
// already carrying a row is the row's `repeat` column, read through ONE
// helper by the player's Conditions.apply and a foe's Combat.landStatus /
// poison / ignite — so the two never drift and no call site branches on it.
(function () {
  const D = Conditions.DEFINITIONS;

  test('repeat rule: top up, stack (capped), stack to twice the dose, hold with recovery', () => {
    const top = { durationMs: 10000 };
    assert.eq(Conditions.repeatDose(top, 0, 10000), 10000, 'fresh: the dose');
    assert.eq(Conditions.repeatDose(top, 4000, 10000), 10000, 'a fading row refills');
    assert.eq(Conditions.repeatDose(top, 30000, 10000), 30000, 'never shortened');
    assert.eq(Conditions.repeatDose(undefined, 4000, 10000), 10000, 'no row at all (a creature-only status): top up');
    const stack = { maxDurationMs: 60000, repeat: { mode: 'stack' } };
    assert.eq(Conditions.repeatDose(stack, 4000, 5000), 9000, 'banked');
    assert.eq(Conditions.repeatDose(stack, 58000, 5000), 60000, 'to the row cap');
    assert.eq(Conditions.repeatDose(stack, 4000, 5000, { stack: false }), 5000, 'contact tops up');
    const twice = { repeat: { mode: 'stack', capMul: 2 } };
    assert.eq(Conditions.repeatDose(twice, 50000, 60000), 110000, 'banked under twice the dose');
    assert.eq(Conditions.repeatDose(twice, 90000, 60000), 120000, 'never above twice the dose just given');
    assert.eq(Conditions.repeatDose(twice, 59250, 30000), 60000, 'a smaller dose caps lower');
    assert.eq(Conditions.repeatDose(twice, 100000, 30000), 100000, 'but never below what was left');
    const hold = { repeat: { mode: 'hold', recoverMs: 3000 } };
    assert.eq(Conditions.repeatDose(hold, 2000, 5000), null, 'refused while it runs');
    assert.eq(Conditions.repeatDose(hold, 0, 5000, { sinceEndedMs: 2999 }), null, 'refused while recovering');
    assert.eq(Conditions.repeatDose(hold, 0, 5000, { sinceEndedMs: 3000 }), 5000, 'recovered: the dose');
    assert.eq(Conditions.repeatDose(hold, 0, 5000), 5000, 'never held before: the dose');
    assert.eq(D.burning.repeat.mode, 'stack'); assert.eq(D.poison.repeat.mode, 'stack'); assert.eq(D.poison.repeat.capMul, 2);
    assert.eq(D.paralysis.repeat.mode, 'hold'); assert.eq(D.paralysis.repeat.recoverMs, 3000);
    assert.falsy(D.frozen.refresh, 'frozen has no private rule left'); assert.falsy(D.frozen.repeat);
    for (const def of Object.values(D)) assert.falsy('refresh' in def || 'stack' in def, 'the repeat column is the one rule');
  });

  test('player: paralysis does not refill, and nothing lands for three seconds after it ends or is cured', () => {
    const save = { energy: 100 };
    assert.truthy(Conditions.apply(save, 'paralysis'));
    Conditions.tick(save, 2000);
    assert.falsy(Conditions.apply(save, 'paralysis'));
    assert.eq(save.conditions.paralysis.remainingMs, 3000, 'a web walked through again does not refill the hold');
    Conditions.tick(save, 3000);
    assert.falsy(Conditions.active(save, 'paralysis'), 'ran out');
    Conditions.tick(save, 1000);
    assert.falsy(Conditions.apply(save, 'paralysis'), 'one second into recovery: refused');
    Conditions.tick(save, 1999);
    assert.falsy(Conditions.apply(save, 'paralysis'), 'just under three: refused');
    Conditions.tick(save, 1);
    assert.truthy(Conditions.apply(save, 'paralysis'), 'three seconds recovered: it takes hold again');
    assert.truthy(Conditions.cure(save, 'paralysis'));
    Conditions.tick(save, 1000);
    assert.falsy(Conditions.apply(save, 'paralysis'), 'an Antidote starts the same recovery');
    Conditions.tick(save, 2000);
    assert.truthy(Conditions.apply(save, 'paralysis'));
    assert.truthy(Conditions.apply({ energy: 100 }, 'paralysis'), 'a fresh save was never held');
  });

  test('player: frozen refills on a repeat; poison banks to twice the dose', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'frozen');
    Conditions.tick(save, 7000);
    assert.eq(save.conditions.frozen.remainingMs, 3000);
    Conditions.apply(save, 'frozen');
    assert.eq(save.conditions.frozen.remainingMs, 10000, 'refilled');
    Conditions.apply(save, 'poison');
    Conditions.tick(save, 10000);
    assert.eq(save.conditions.poison.remainingMs, 50000);
    Conditions.apply(save, 'poison');
    assert.eq(save.conditions.poison.remainingMs, 110000, 'a second bite banks');
    Conditions.tick(save, 1000);
    Conditions.apply(save, 'poison');
    assert.eq(save.conditions.poison.remainingMs, 120000, 'never above two minutes of a minute\'s bite');
    Conditions.tick(save, 1000);
    Conditions.apply(save, 'poison', Date.now(), { durationMs: 30000 });
    assert.eq(save.conditions.poison.remainingMs, 119000, 'a smaller dose adds nothing past its own cap, and never shortens');
  });

  test('foe: the same rule through landStatus, poison and ignite', () => {
    const T0 = 1700000000000;
    const foe = () => ({ id: 'g', kind: 'goblin', x: 0, y: 0 });
    // paralysis holds, then recovers off the expired field.
    let c = foe();
    assert.truthy(Combat.paralyze(c, 6000, T0));
    assert.falsy(Combat.paralyze(c, 6000, T0 + 2000), 'standing in the web does not refill');
    assert.eq(c._paralysisUntil, T0 + 6000);
    assert.falsy(Combat.paralyze(c, 6000, T0 + 8000), 'two seconds after: still recovering');
    assert.truthy(Combat.paralyze(c, 6000, T0 + 9000), 'three seconds after: it takes hold again');
    assert.eq(c._paralysisUntil, T0 + 15000);
    // frozen refills, never shortens.
    c = foe();
    Combat.applyFrost(c, 10000, T0);
    Combat.applyFrost(c, 10000, T0 + 7000);
    assert.eq(c._frozenUntil, T0 + 17000, 'refilled');
    Combat.applyAuraFrost(c, T0 + 8000);
    assert.eq(c._frozenUntil, T0 + 18000, 'an aura refills too');
    Combat.applyFrost(c, 30000, T0 + 9000);
    Combat.applyAuraFrost(c, T0 + 10000);
    assert.eq(c._frozenUntil, T0 + 39000, 'a longer chill is never shortened');
    // charm and sleep (no Conditions row): top up as before.
    c = foe();
    Combat.applySleep(c, T0); Combat.applySleep(c, T0 + 30000);
    assert.eq(c._sleepUntil, T0 + 90000);
    // poison banks to twice the dose, keeping the bite's cadence.
    c = foe();
    assert.truthy(Combat.poison(c, 0));
    Combat.poisonTick(c, 10000);
    assert.eq(c._poisonState.remainingMs, 50000);
    assert.falsy(Combat.poison(c, 10500), 'not fresh');
    assert.eq(c._poisonState.remainingMs, 109500, 'banked on what was left');
    assert.eq(c._poisonState.nextTickMs, 1500, 'the bite already due is not postponed');
    Combat.poison(c, 10500);
    assert.eq(c._poisonState.remainingMs, 120000, 'never above twice the dose');
    // burning banks to the row cap (burning.test.js has the rest).
    c = foe();
    Combat.ignite(c, 0, 'player'); Combat.ignite(c, 500, 'player');
    assert.eq(c._burnState.remainingMs, 10000);
  });
})();
