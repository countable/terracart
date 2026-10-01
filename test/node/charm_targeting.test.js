// Exercise scene entry points as allegiance changes during an active fight.
(function () {
  function lift(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.gte(start, 0, signature);
    return SCENE_SRC.slice(start + 1, end + 4);
  }
  const methods = new Function('return ({' + [
    'startCombat(victim, opts = {}) {', '_drawWorkProgress() {',
  ].map(lift).join(',') + '});')();

  test('charm: manual and automatic melee refuse a temporary ally', () => {
    const c = { id: 'wild', kind: 'slime', x: 0, y: 0 };
    Combat.applyCharm(c);
    for (const auto of [false, true]) {
      const scene = Object.assign({ isShadowActive: () => false,
        _toolActionStory() { throw new Error('Ally must not start an attack'); },
      }, methods);
      assert.eq(scene.startCombat(c, { auto }), false);
      assert.eq(scene._workProgress, undefined);
    }
  });

  test('charm: existing melee cancels before another blow can land', () => {
    const c = { id: 'wild', kind: 'slime', _hp: 20, x: 0, y: 0 };
    const scene = Object.assign({
      _workProgress: { combat: c }, _drawSwordSwing() {},
      cancelWorkProgress() { this._workProgress = null; },
      _damageEnemy() { throw new Error('Ally must not take another melee blow'); },
    }, methods);
    Combat.applyCharm(c);
    scene._drawWorkProgress();
    assert.eq(scene._workProgress, null);
    assert.eq(c._hp, 20);
  });
})();
