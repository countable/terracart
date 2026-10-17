// Exercise shipping draw methods: graphics at depth >= 90 use the UI camera,
// so rotating their graphics origin cannot move absolute command coordinates.
(function () {
  function method(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start + 1, end + 4) + '});')();
  }
  test('heading overlays: enemy health follows rotated feet with upright crown offset and zoom', () => {
    const enabled = HeadingUp.enabled;
    HeadingUp.enabled = true;
    try {
      const bars = [];
      const s = Object.assign({
        _headingUp: true, mapRot: -Math.PI / 2, mapZoom: 2,
        viewCenterX: 176, viewCenterY: 272,
        enemyHealthGfx: { clear() {} },
        worldMetersToScreen: () => ({ x: 196, y: 282 }),
        _drawEnemyHealthBar(g, x, y) { bars.push({ x, y }); },
      }, method('_drawEnemyHealth(enemies) {'));
      const c = { kind: 'slime', _hurtUntilT: performance.now() + 10000, _hp: 5 };
      s._drawEnemyHealth([c]);
      assert.eq(bars[0].x, 196, 'east/down world anchor rotates above/right');
      assert.eq(bars[0].y, Math.round(232 + 2 * SpriteLayout.creatureHealthBarTop(c.kind, SpriteLayout.creatureInstScale(c))));
      assert.truthy(s.enemyHealthGfx._huUI, 'commands already projected; never rotate graphics origin twice');
    } finally { HeadingUp.enabled = enabled; }
  });
  test('heading overlays: sword swing aims at screen direction of world target', () => {
    const enabled = HeadingUp.enabled;
    HeadingUp.enabled = true;
    const oldPose = Render.meleePose;
    try {
      let dir;
      Render.meleePose = sw => { dir = sw.dir; return null; };
      const s = Object.assign({
        _headingUp: true, mapRot: -Math.PI / 2,
        swordSwingGfx: { clear() {} },
        _swing: { dir: { x: 1, y: 0 }, weapon: 'sword', reachCells: 1 },
      }, method('_drawSwordSwing() {'));
      s._drawSwordSwing();
      assert.inRange(dir.x, -1e-9, 1e-9);
      assert.eq(dir.y, -1, 'east-facing target is above player after an east heading');
    } finally { Render.meleePose = oldPose; HeadingUp.enabled = enabled; }
  });
})();
