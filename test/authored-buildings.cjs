// Run against `python3 -m http.server 7731`; override with GAME_URL.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
(async () => {
  const env = { ...process.env }; delete env.DISPLAY;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/lib/chromium/chromium', env,
    args: ['--no-sandbox', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1120, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = new URL(process.env.GAME_URL || 'http://localhost:7731').origin;
    page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === origin) errors.push(response.status() + ' ' + response.url()); });
    // Optional external map services must not make local art validation flaky.
    // Local resource failures are checked above; JS errors still fail below.
    page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
    await page.goto((process.env.GAME_URL || 'http://localhost:7731') + '/index.html?sandbox=true&sandboxZone=restoration&skipStory=true&skipTutorial=true');
    await page.waitForFunction(() => window.__scene?._bootOverlayGone, {}, { timeout: 60000 });
    const result = await page.evaluate(() => {
      const scene = __scene;
      const recipes = new Map();
      for (let id = 0; id < 100; id++) {
        const r = AuthoredBuildings.recipeFor('plain', id); recipes.set(r.key + ':' + r.palette, r);
      }
      for (const role of ['home', 'blacksmith', 'trader', 'wizard', 'fort', 'shop', 'seed', 'supply', 'potion', 'relic', 'pet', 'book']) {
        for (const tier of [1, 4]) for (const second of [false, true]) {
          const r = AuthoredBuildings.recipeFor(role, role, tier, second); recipes.set(r.key + ':' + r.palette, r);
        }
      }
      const texturesBefore = scene.textures.getTextureKeys().length;
      const native = [...recipes.values()].map(r => {
        const first = AuthoredBuildings.build(scene, r.key, r.palette), second = AuthoredBuildings.build(scene, r.key, r.palette);
        if (!first || !second) throw Error('Missing prepared model ' + JSON.stringify(r));
        const old = second.faces[0].points[0].x; first.faces[0].points[0].x += 1;
        return { ...r, faces: second.faces.length, independent: old === second.faces[0].points[0].x,
          valid: second.faces.every(f => f.points.length === 3 && f.points.every(p => ['x','y','z','tu','tv'].every(k => Number.isFinite(p[k])))) };
      });
      const addedTextures = scene.textures.getTextureKeys().length - texturesBefore;
      BuildingOverlay.setEnabled(scene, true); scene._overlayFrameSeq++; scene.drawBuildingGeometry(); scene.drawObjects();
      const buildings = scene._lowpoly?.buildings || [];
      const authored = buildings.filter(m => m.authored);
      const faces = authored.flatMap(m => m.faces), originals = faces.map(f => f.points);
      const finiteAtEveryAngle = [0, .37, Math.PI / 2, Math.PI, Math.PI * 1.5].every(angle => {
        scene.mapRot = angle; BuildingLowPoly.update(scene);
        return faces.every(f => f.projected.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
      });
      return { native, addedTextures,
        authored: authored.map(m => ({ key: m.authoredKey, role: m.role })), finiteAtEveryAngle,
        retained: faces.every((f,i) => f.points === originals[i]) };
    });
    assert(result.native.length >= 18, 'all role palettes prepared');
    assert(result.native.every(m => m.faces > 0 && m.faces <= 1000 && m.valid && m.independent), 'finite bounded independent model instances');
    assert.equal(result.addedTextures, 0, 'placement and rotation reuse prewarmed textures');
    assert(result.authored.length > 0, 'live restored sandbox buildings use reviewed meshes');
    assert(result.finiteAtEveryAngle && result.retained, 'heading rotation retains valid geometry');
    await page.evaluate(() => { document.querySelectorAll('#bootload,#story,#safety-card').forEach(e => e.remove()); __scene.scene.pause(); });
    for (const angle of [0, .7, Math.PI, Math.PI * 1.5]) {
      await page.evaluate(angle => { __scene.mapRot = angle; BuildingLowPoly.update(__scene); }, angle);
      await page.waitForTimeout(350);
      const gpu = await page.evaluate(() => ({ angle: __scene.mapRot, error: __scene.game.renderer.gl.getError(), target: !!__scene._authoredDepthRenderer?.target,
        palettes: __scene._lowpoly.buildings.filter(m => m.authored).every(m => new Set(m.faces.map(f => f.texture.key)).size > 1) }));
      assert.equal(gpu.angle, angle, 'heading persists through the rendered frame');
      assert.equal(gpu.error, 0, 'GPU render has no GL errors');
      assert(gpu.target && gpu.palettes, 'GPU target and separate roof palettes active');
      await page.screenshot({ path: '/tmp/authored-mapping-game-' + angle.toFixed(2) + '.png' });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
