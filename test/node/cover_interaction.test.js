// Cover must gate actions as well as artwork. Exercise the shipped dispatch
// and scene methods with deterministic cover samples, independent of geometry.
(function () {
  function lift(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    assert.gte(start, 0, signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return SCENE_SRC.slice(start + 1, end + 4);
  }

  test('cover: full cover blocks tap actions but still permits cancellation', () => {
    let cover = 2, actions = 0, cancellations = 0;
    const handlers = [
      { name: 'work-progress', try: ctx => {
        if (!ctx.scene.working) return false;
        ctx.scene.working = false; cancellations++; return true;
      } },
      { name: 'treasure', try: () => { actions++; return true; } },
    ];
    const tap = new Function('Visibility', 'TAP_HANDLERS', '_tapDiag', 'persistSave',
      INTERACT_SRC.slice(INTERACT_SRC.indexOf('function interactTap(scene, sx, sy) {')) + '\nreturn interactTap;')(
      { playerCover: () => cover }, handlers, () => {}, () => {});
    const scene = { viewLeft: 0, viewTop: 0, viewSize: 100, save: {},
      screenToWorldMeters: () => ({ x: 10, y: 10 }) };
    tap(scene, 10, 10);
    assert.eq(actions, 0);
    scene.working = true;
    tap(scene, 10, 10);
    assert.eq(cancellations, 1);
    assert.eq(actions, 0);
    cover = 1;
    tap(scene, 10, 10);
    assert.eq(actions, 1, 'partial tree cover remains interactable');
  });

  test('cover: spells target clear and partial foes, never fully hidden foes', () => {
    const foes = [0, 1, 2].map(cover => ({ id: 'cover' + cover, kind: 'slime', x: cover, y: 0 }));
    const method = new Function('Visibility', 'WorldGen', 'Combat', 'setOf',
      'return ({' + lift('_enemiesWhere(where) {') + '})._enemiesWhere;')(
      { playerCover: (scene, x) => x },
      { forEachItemNear: (layer, tx, ty, fn) => foes.forEach(fn) }, Combat, list => new Set(list));
    const scene = { save: { caught: [] }, playerToWorldCell: () => ({ tx: 0, ty: 0 }) };
    const targets = method.call(scene, () => true);
    assert.eq(targets.length, 2);
    assert.eq(targets[0], foes[0]);
    assert.eq(targets[1], foes[1]);
  });

  test('cover: direct melee cannot bypass full cover', () => {
    const method = new Function('Visibility',
      'return ({' + lift('startCombat(victim, opts = {}) {') + '}).startCombat;')(
      { playerCover: () => 2 });
    const scene = { save: { energy: 100 },
      isShadowActive() { throw new Error('Hidden foe must be rejected before attacking'); } };
    const foe = { kind: 'slime', x: 10, y: 0 };
    assert.eq(method.call(scene, foe), false);
    assert.eq(method.call(scene, foe, { auto: true }), false);
  });
})();
