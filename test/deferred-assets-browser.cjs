const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.GAME_URL || 'http://localhost:8765'}/index.html?sandbox=true&sandboxZone=chapel&reset=true&skipStory=true`);
    await page.waitForFunction(() => window.__scene?._bootOverlayGone, null, { timeout: 60000 });
    const boot = await page.evaluate(() => ({
      deferredEnemies: EnemyRoster.ROWS.filter(row => ASSETS[row.id]?.deferred).length,
      requested: [...(__scene._requestedAssets || [])],
      resources: performance.getEntriesByType('resource').length,
      minotaurLoaded: __scene.textures.exists('minotaur'),
    }));
    assert(!boot.minotaurLoaded, 'chapel does not load remote encounter art');
    assert(boot.deferredEnemies > 40);

    // Hold a real enemy request while teleporting into another sandbox area.
    // The world/AI still run: this exercises current-area prefetch and rendering.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/assets/**', async route => {
      if (/Minotaur/i.test(route.request().url())) await gate;
      await route.continue();
    });
    await page.evaluate(() => {
      const from = Sandbox.resolveDestination('chapel');
      const to = Sandbox.resolveDestination('encounters');
      __scene.playerM.x += (to.lx - from.lx) * __scene.cellM;
      __scene.playerM.y += (to.ly - from.ly) * __scene.cellM;
      __scene.syncMoveTarget();
    });
    await page.waitForFunction(() => __scene.creaturePool.some(sprite => sprite.visible && sprite.texture.key === 'creature_loading'));
    release();
    await page.waitForFunction(() => __scene.textures.exists('minotaur') &&
      __scene.creaturePool.some(sprite => sprite.visible && sprite.texture.key === 'minotaur'));
    const transition = await page.evaluate(() => ({
      requested: [...__scene._requestedAssets],
      pending: [...__scene._requestedAssets].filter(key => !__scene.textures.exists(key)),
    }));
    assert(transition.requested.includes('minotaur'));

    // Palette processing must happen before pet/elite variants are derived.
    await page.evaluate(() => __scene._ensureAsset('vampire_bat'));
    await page.waitForFunction(() => __scene.textures.exists('vampire_bat'));
    const palette = await page.evaluate(() => ({
      frames: __scene.textures.get('vampire_bat').frameTotal,
      elite: Render.vividTexture(__scene, 'vampire_bat', 'vampire_bat'),
      pet: Render.petTexture(__scene, 'vampire_bat', 'vampire_bat'),
    }));
    assert.equal(palette.frames, 49);
    assert.equal(palette.elite, 'elite-vivid-vampire_bat');
    assert.equal(palette.pet, 'pet-neutral-vampire_bat');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ boot, transition, palette }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
