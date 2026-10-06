// Real strike and work methods, with a controllable clock and moving player.
(function () {
  let now = 1000;
  function lift(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    assert.gte(start, 0, signature);
    return SCENE_SRC.slice(start + 1, SCENE_SRC.indexOf('\n  }\n', start) + 4);
  }
  const methods = new Function('performance', 'return ({' + [
    'startCombat(victim, opts = {}) {', '_busyWheel() {',
    '_stopDownedActions() {', 'cancelWorkProgress() {', '_drawWorkProgress() {',
    'startWorkProgress(worldX, worldY, onComplete, durationMs = 3000, energyRefund = 0, toolSlot = null, trackCreature = null) {',
    '_consumeFoodEffects(id, featherRevive = false, now = Date.now()) {',
  ].map(lift).join(',') + '});')({ now: () => now });
  const start = SCENE_SRC.indexOf('    // ── Melee: auto-engage');
  const end = SCENE_SRC.indexOf('    this._drawEnemyHealth(enemies);', start);
  const tick = new Function('enemies', 'px', 'py', SCENE_SRC.slice(start, end));
  function scene() {
    now = 1000;
    return Object.assign({
      save: { energy: 50, relics: { sword: { tier: 3 } }, activeWeapon: 'sword' }, cellM: 10,
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, hits: [],
      isShadowActive: () => false, isTorchActive: () => false,
      _toolActionStory() {}, _toolTexture: () => null,
      _attackMul: () => 1, _attackFlat: () => 0,
      _damageEnemy(c, damage) { this.hits.push({ c, damage }); return false; },
      _drawSwordSwing() {}, _drawWatering() {},
      getMaxEnergy() { return Energy.maxEnergy(this.save); },
      _applyCondition(id, opts) { return Conditions.apply(this.save, id, Date.now(), opts); },
    }, methods);
  }
  const foe = (id, x) => ({ id, kind: 'slime', x, y: 0 });

  test('melee: each strike is immediate and never creates a work item or movement hold', () => {
    const s = scene(), a = foe('a', 3);
    assert.truthy(s.startCombat(a));
    assert.eq(s.hits.length, 1);
    assert.truthy(s.hits[0].damage > 0);
    assert.falsy(s._workProgress);
    assert.falsy(s._busyWheel());
    s._drawWorkProgress();
    assert.eq(s.hits.length, 1, 'drawing work cannot repeat the strike');
    s.playerM.x = 100;
    now = s._nextBlowT;
    assert.eq(s.startCombat(a), false, 'moving away prevents the next strike');
    const ready = s._nextBlowT;
    s.playerM.x = 0;
    assert.truthy(s.startCombat(a), 'returning to reach allows the due strike');
    assert.truthy(s._nextBlowT > ready);
  });

  test('melee: auto-strikes select the current closest foe without resetting cooldown', () => {
    const s = scene(), a = foe('a', 8), b = foe('b', 4);
    tick.call(s, [a, b], 0, 0);
    assert.eq(s.hits[0].c, b);
    a.x = 2;
    tick.call(s, [a, b], 0, 0);
    assert.eq(s.hits.length, 1, 'retargeting grants no extra blow');
    now = s._nextBlowT;
    tick.call(s, [a, b], 0, 0);
    assert.eq(s.hits[1].c, a);
    a.x = b.x = 100;
    now = s._nextBlowT;
    tick.call(s, [a, b], 0, 0);
    assert.eq(s.hits.length, 2);
  });

  test('melee: ordinary work and equipped ranged weapons retain priority', () => {
    const s = scene(), job = { durationMs: 1000 };
    s._workProgress = job;
    tick.call(s, [foe('a', 1)], 0, 0);
    assert.eq(s._workProgress, job);
    assert.eq(s.hits.length, 0);
    s._workProgress = null;
    s.save.relics.bow = { tier: 3 };
    s.save.activeWeapon = 'bow';
    tick.call(s, [foe('a', 1)], 0, 0);
    assert.eq(s.hits.length, 0);
  });

  test('death: cancels overdue work without completion or refund, releases catch, clears attacks', () => {
    const s = scene(), caught = { _beingCaught: true };
    s._workProgress = { startT: 1, durationMs: 100, energyRefund: 10, flee: caught,
      onComplete() { throw Error('Dead player completed work'); } };
    s._swing = {}; s._staffCharge = 1; s._autoMineKey = 'rock';
    Energy.set(s.save, 0);
    s._drawWorkProgress();
    assert.eq(s._workProgress, null);
    assert.eq(caught._beingCaught, false);
    assert.eq(s.save.energy, 0);
    assert.eq(s._swing, null); assert.eq(s._staffCharge, null); assert.eq(s._autoMineKey, null);
    assert.eq(s.startCombat(foe('a', 1)), false);
    assert.eq(s.startWorkProgress(0, 0, () => {}), false);
    tick.call(s, [foe('a', 1)], 0, 0);
    assert.eq(s.hits.length, 0);
    Energy.set(s.save, 20);
    s._drawWorkProgress();
    assert.eq(s._workProgress, null, 'revival cannot resume the job');
    assert.truthy(s.startCombat(foe('a', 1)));
  });

  test('death: ranged weapons refuse even an enemy standing on the player', () => {
    const a = SCENE_SRC.indexOf('    const rangedArmed =');
    const b = SCENE_SRC.indexOf('    if (rangedArmed)', a);
    const armed = new Function('px', 'py', 'enemies', 'reachCells',
      SCENE_SRC.slice(a, b) + 'return rangedArmed;');
    const s = scene(), enemy = foe('near', 0);
    assert.truthy(armed.call(s, 0, 0, [enemy], () => 2));
    Energy.set(s.save, 0);
    assert.falsy(armed.call(s, 0, 0, [enemy], () => 2));
  });

  test('mushroom food: raw mushroom confuses for three seconds and preserves longer confusion', () => {
    const s = scene();
    const result = s._consumeFoodEffects('mushroom');
    assert.truthy(result.gained > 0);
    assert.eq(s.save.conditions.confused.remainingMs, 3000);
    Conditions.tick(s.save, 2999);
    assert.truthy(Conditions.active(s.save, 'confused'));
    Conditions.tick(s.save, 1);
    assert.falsy(Conditions.active(s.save, 'confused'));
    Conditions.apply(s.save, 'confused', Date.now(), { durationMs: 10000 });
    s._consumeFoodEffects('mushroom');
    assert.eq(s.save.conditions.confused.remainingMs, 10000);
    const cooked = scene();
    cooked._consumeFoodEffects('grilled_mushroom');
    assert.falsy(Conditions.active(cooked.save, 'confused'));
  });
})();
