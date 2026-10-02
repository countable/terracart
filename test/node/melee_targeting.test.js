// Exercise the scene's selection block while foes move during an existing
// fight. The swing clock must survive target changes and ordinary work wins.
(function () {
  const start = SCENE_SRC.indexOf('    // ── Melee: auto-engage');
  const end = SCENE_SRC.indexOf('    this._drawEnemyHealth(enemies);', start);
  const tick = new Function('enemies', 'px', 'py', SCENE_SRC.slice(start, end));
  function scene() {
    return {
      save: { relics: { sword: { tier: 3 } }, activeWeapon: 'sword' }, cellM: 10,
      _nextBlowT: 5000, starts: 0,
      startCombat(c, opts) {
        this.starts++;
        this._workProgress = { combat: c, auto: opts.auto };
      },
      cancelWorkProgress() { this._workProgress = null; },
    };
  }

  test('melee: moving foes retarget to the closest without restarting the swing clock', () => {
    const s = scene(), a = { x: 8, y: 0 }, b = { x: 4, y: 0 };
    tick.call(s, [a, b], 0, 0);
    assert.eq(s._workProgress.combat, b);
    assert.truthy(s._workProgress.auto);
    a.x = 2;
    tick.call(s, [a, b], 0, 0);
    assert.eq(s._workProgress.combat, a, 'closer foe replaces active target');
    assert.eq(s._nextBlowT, 5000, 'target switching grants no extra blow');
    tick.call(s, [a, b], 0, 0);
    assert.eq(s.starts, 2, 'same target does not restart its wheel each frame');
    a.x = b.x = 100;
    tick.call(s, [a, b], 0, 0);
    assert.eq(s._workProgress, null, 'no eligible foe clears melee');
  });

  test('melee: ordinary work and equipped ranged weapons keep priority', () => {
    const s = scene(), job = { durationMs: 1000 };
    s._workProgress = job;
    tick.call(s, [{ x: 1, y: 0 }], 0, 0);
    assert.eq(s._workProgress, job);
    s._workProgress = null;
    s.save.relics.bow = { tier: 3 };
    s.save.activeWeapon = 'bow';
    tick.call(s, [{ x: 1, y: 0 }], 0, 0);
    assert.eq(s._workProgress, null);
  });
})();
