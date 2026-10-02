(function () {
test('startup memory: optional WebGL FX pools are disabled before renderer boot', () => {
  const config = APP_JS_SRC.slice(APP_JS_SRC.indexOf('new Phaser.Game({'));
  assert.truthy(/disablePreFX: true/.test(config), 'no eager pre-FX framebuffer pool');
  assert.truthy(/disablePostFX: true/.test(config), 'unused post-FX pipelines stay disabled');
});

test('startup memory: shinies keep fallback markers when WebGL FX is disabled', () => {
  const previous = globalThis.Phaser;
  globalThis.Phaser = { WEBGL: 2, CANVAS: 1 };
  try {
    const scene = { sys: { game: { renderer: { type: 2, pipelines: { FX_PIPELINE: null } } } } };
    assert.falsy(Render.canShine(scene), 'WebGL without FX keeps the spark fallback');
    let created = 0;
    const sprite = { scene, preFX: { padding: 0, setPadding() {},
      addGlow() { created++; return {}; }, addShine() { created++; return {}; } } };
    assert.falsy(Render.setShine(sprite, true, 'shiny'), 'disabled pipeline cannot attach effects');
    assert.eq(created, 0, 'no lazy effect allocation');
    scene.sys.game.renderer.pipelines.FX_PIPELINE = {};
    assert.truthy(Render.canShine(scene), 'an enabled FX pipeline can shine');
    assert.truthy(Render.setShine(sprite, true, 'shiny'));
    assert.eq(created, 2, 'enabled pipeline creates glow and shine once');
    Render.setShine(sprite, true, 'shiny');
    assert.eq(created, 2, 'pooled sprite keeps its existing effects');
    scene.sys.game.renderer.type = 1;
    assert.falsy(Render.canShine(scene), 'Canvas retains the same fallback');
  } finally { globalThis.Phaser = previous; }
});
})();
