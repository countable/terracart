(function () {
test('startup memory: WebGL FX pools require explicit device opt-in before boot', () => {
  const config = SCENE_SRC.slice(SCENE_SRC.indexOf('new Phaser.Game({'));
  assert.truthy(/disablePreFX: !GRAPHICS_FX_ENABLED/.test(config), 'pre-FX pool follows the boot preference');
  const code = SCENE_SRC.match(/const GRAPHICS_FX_ENABLED = ([\s\S]*?\n\}\)\(\));/)[1];
  for (const value of [null, '0', 'true', '1']) {
    const enabled = new Function('localStorage', `return ${code}`)({ getItem: () => value });
    assert.eq(enabled, value === '1', 'only an explicit opt-in enables FX');
  }
  assert.eq(new Function('localStorage', `return ${code}`)({ getItem() { throw Error('blocked'); } }), false,
    'unavailable storage keeps FX off');
  assert.truthy(/disablePostFX: true/.test(config), 'unused post-FX pipelines stay disabled');
});

test('startup memory: graphics menu persists changes before reload and allows cancellation', () => {
  const code = INDEX_HTML_SRC.split('// FX pools are a renderer boot choice, shared by saves on this device.')[1]
    .split("// The active slot's save")[0];
  for (const initial of [null, '1']) {
    for (const confirmed of [false, true]) {
      const events = [];
      let click;
      const button = { setAttribute() {}, addEventListener(name, fn) { click = fn; } };
      new Function('document', 'localStorage', 'window', 'flushSave', 'location', code)(
        { getElementById: () => button },
        { getItem: () => initial, setItem: (key, value) => events.push(key + '=' + value) },
        { confirm: () => confirmed }, () => events.push('save'), { reload: () => events.push('reload') });
      assert.truthy(button.textContent.includes(initial === '1' ? 'on' : 'off'));
      click({ stopPropagation() {} });
      assert.eq(events.join(','), confirmed
        ? `terracart.graphicsFX=${initial === '1' ? '0' : '1'},save,reload` : '');
    }
  }
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
