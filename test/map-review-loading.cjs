// Startup and terrain-cache regression; no relay or CDN is needed.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors = [], cdn = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://unpkg.com/**', route => { cdn.push(route.request().url()); return route.abort(); });
    const start = Date.now();
    await page.goto(`${process.env.REVIEW_BASE_URL || 'http://localhost:8765'}/tools/map-review.html?geometry=off`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__world && !building && gameArt._assets, null, { timeout: 180000 });
    const initial = await page.evaluate(() => {
      const rings = __world.tiles.map(e => gameArt._terrainRing(e));
      return { errors: __world.errors, failures: gameArt._assets.failures,
        resolved: rings.reduce((n, r) => n + r.materials.filter(m => m !== -2).length, 0) };
    });
    assert.deepEqual(initial.errors, []);
    assert.deepEqual(initial.failures, []);
    assert.deepEqual(cdn, [], 'review scripts and styles load locally');
    assert.ok(initial.resolved > 0, 'initial view resolves visible materials');
    await page.evaluate(() => {
      map.setZoom(15, { animate: false });
      gameArt._invalidateGround(); gameArt.redraw();
    });
    await page.waitForFunction(() => gameArt._canvasZoom === 15 && !gameArt._groundJob);
    assert.equal(await page.evaluate(() => __world.tiles.reduce((n, e) =>
      n + gameArt._terrainRing(e).materials.filter(m => m !== -2).length, 0)), 0,
    'distant overview never resolves native texture materials');
    await page.evaluate(() => { map.setZoom(19, { animate: false }); });
    await page.waitForFunction(() => gameArt._canvasZoom === 19 && !gameArt._groundJob);
    const detailed = await page.evaluate(() => {
      const rings = __world.tiles.map(e => gameArt._terrainRing(e));
      return { resolved: rings.reduce((n, r) => n + r.materials.filter(m => m !== -2).length, 0),
        unseen: rings.reduce((n, r) => n + r.materials.filter(m => m === -2).length, 0),
        symbols: gameArt._drawnSymbols.length };
    });
    assert.ok(detailed.resolved > 0, 'detailed view resolves visible materials');
    assert.ok(detailed.unseen > detailed.resolved, 'offscreen cells stay unresolved');
    assert.ok(detailed.symbols > 0, 'detailed view still draws building symbols');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ readyAndZoomMs: Date.now() - start, ...detailed }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
