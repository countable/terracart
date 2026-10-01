// Every scene mixin app.js installs (installSceneMixin(MapScene, X) — the
// class X lives in its own src module; run.js derives the list as
// SCENE_FILES) must be a <script> in index.html, loaded BEFORE app.js (the
// boot gate's APP_SRC). Vanilla scripts in shared global scope, no bundler: a
// module nobody loads is a ReferenceError at the install line, and the game
// is dead on the page. A merge dropped the scene_shops.js tag once ("Can't
// find variable: SceneShops" on the live site, Sep 2026) while the headless
// suite, which bundles the modules by its own list, stayed green. This pins
// the page itself.
test('scene mixins: every installed mixin module is a <script> in index.html, before app.js', () => {
  const html = INDEX_HTML_SRC;
  const [appFile, ...mixinFiles] = SCENE_FILES;
  assert.eq(appFile, 'app.js');
  assert.gt(mixinFiles.length, 0, 'app.js installs scene mixins');
  const appAt = html.search(/APP_SRC\s*=\s*['"]src\/app\.js/);
  assert.gt(appAt, 0, 'the boot gate names app.js');
  for (const file of mixinFiles) {
    const tag = html.search(new RegExp(`<script src="src/${file.replace('.', '\\.')}(\\?v=[a-f0-9]+)?"></script>`));
    assert.gt(tag, 0, `index.html loads src/${file}`);
    assert.lt(tag, appAt, `src/${file} is loaded before app.js installs its mixin`);
  }
});
