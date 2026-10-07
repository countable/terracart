// Run the actual scene methods: concealment must change both retaliation and
// capture movement, and Rust must reach the bow's existing damage lane.
(function () {
  function lift(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) throw new Error('Cannot lift ' + signature);
    return SCENE_SRC.slice(start + 1, end + 4);
  }
  const methods = new Function('slimeCharging', 'ENEMY_HEALTH_RING_MS', 'DMG_POPUP_BEAT_MS',
    'isShiny', 'SHINY_RATE', 'SHINY_SPEED_MUL', 'worldMetersToAbsCell', 'cellInReach', 'absCellCenterMeters',
    `return {${[
      'isUnnoticed(creature = null) {',
      "_damageEnemy(c, amount, source = 'player', options = {}) {",
      '_drawWorkProgress() {',
    ].map(lift).join(',\n')}};`)(() => false, 3000, 300,
      () => false, { animal: 1 }, 2, () => ({ cellIX: 0, cellIY: 0 }), () => true, () => ({ x: 0, y: 0 }));

  function scene() {
    return Object.assign({
      save: { energy: 100, boonUntil: { hidden: Date.now() + 180000 } },
      isShadowActive: () => false, isTooFast: () => false,
      _popDamageNumber() {}, resolveDefeat() {}, _stopDownedActions() { return false; }, _drawSwordSwing() {},
      cancelWorkProgress() { this._workProgress = null; },
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      // These capture scenarios take place outside Home's wildlife circle.
      _starterTrailAnchor: () => ({ x: 10000, y: 10000 }),
      worldMetersToScreen: (x, y) => ({ x, y }),
      _workProgressGfx: { clear() {} }, _strokeWorkRing() {}, _drawWorkTool() {},
    }, methods);
  }

  test('Moss: melee and projectiles reveal only their target, with powder still separate', () => {
    for (const source of [undefined, Combat.shotSource({ slot: 'bow' }), Combat.shotSource({ slot: 'staff' })]) {
      const s = scene();
      const target = { id: 'target', kind: 'slime', _hp: 100 };
      const other = { id: 'other', kind: 'slime', _hp: 100 };
      assert.truthy(s.isUnnoticed(target));
      s._damageEnemy(target, 1, source);
      assert.falsy(s.isUnnoticed(target), 'the struck monster may retaliate');
      assert.truthy(s.isUnnoticed(other), 'other monsters remain unaware');
      assert.truthy(s.isUnnoticed(), 'the aura remains concealed');
      s.isShadowActive = () => true;
      assert.truthy(s.isUnnoticed(target), 'Shadow Powder remains unconditional');
      s.isShadowActive = () => false;
      s.save.boonUntil.hidden += 1000;
      assert.truthy(s.isUnnoticed(target), 'a fresh blessing restores concealment');
      s.save.boonUntil.hidden = Date.now() - 1;
      assert.falsy(s.isUnnoticed(other), 'expiry restores awareness');
    }
  });

  test('Moss: environmental and allied hits do not expose the player', () => {
    for (const source of ['lava', 'light', 'turret', 'pet']) {
      const s = scene(), target = { id: 'target', kind: 'slime', _hp: 100 };
      s._damageEnemy(target, 1, source);
      assert.truthy(s.isUnnoticed(target), source);
    }
    const s = scene(), target = { id: 'target', kind: 'slime', _hp: 100 };
    s._damageEnemy(target, 0);
    assert.truthy(s.isUnnoticed(target), 'a missed blow does not reveal');
  });

  test('Moss: fauna and pets stay still during capture, resume fleeing after expiry, and complete', () => {
    for (const kind of ['butterfly', 'chicken', 'cat', 'rabbit']) {
      const s = scene(), c = { id: kind, kind, x: 10, y: 0 };
      let completed = 0;
      const now = performance.now();
      s._workProgress = { flee: c, startT: now - 100, _lastT: now - 100,
        durationMs: 10000, onComplete: () => completed++ };
      s._drawWorkProgress();
      assert.eq(c.x, 10, kind + ': unnoticed capture stays in place');
      assert.eq(c._mossProvokedUntil, undefined, 'capture never provokes');
      s.save.boonUntil.hidden = Date.now() - 1;
      s._workProgress._lastT = performance.now() - 100;
      s._drawWorkProgress();
      assert.gt(c.x, 10, kind + ': fleeing resumes when Moss expires');
      s.save.boonUntil.hidden = Date.now() + 10000;
      s._workProgress.startT = performance.now() - 11000;
      s._drawWorkProgress();
      assert.eq(completed, 1, kind + ': concealed catch still completes');
      assert.eq(s._workProgress, null);
    }
  });

  test('Rust: five extra melee and bow damage for five minutes, no magic or drill stacking', () => {
    const now = Date.now(), save = {};
    Shrines.grant(save, 'rust_totem', now);
    assert.eq(Shrines.SHRINE_KINDS.rust_totem.durationMs, 5 * 60000);
    assert.eq(Combat.trainingBonus(save, 'melee', now), 5);
    assert.eq(Combat.trainingBonus(save, 'ranged', now), 5);
    assert.eq(Combat.trainingBonus(save, 'magic', now), 0);
    save.training = { melee: 2, ranged: 3 };
    save.trainingDrills = { melee: now + 1000, ranged: now + 1000 };
    assert.eq(Combat.trainingBonus(save, 'melee', now), 7);
    assert.eq(Combat.trainingBonus(save, 'ranged', now), 8);
    assert.eq(Combat.trainingBonus(save, 'ranged', now + 5 * 60000), 3);
    assert.eq(Combat.trainingBonus(save, 'melee', now + 5 * 60000), 2);
  });
})();
