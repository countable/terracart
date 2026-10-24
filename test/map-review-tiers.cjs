// Run against a served checkout. A returning game player already has a worker
// and unversioned review modules cached from earlier HTML revisions.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const base = process.env.REVIEW_BASE_URL || 'http://localhost:8765';
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/manifest.webmanifest`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'test uses an already-active worker');
    await page.evaluate(async () => {
      const stale = 'window.__staleTierModule=true;window.MapReviewGameplay={create(){throw Error("obsolete tier legend")}};';
      for (const key of await caches.keys()) if (key.startsWith('shell-')) {
        await (await caches.open(key)).put('/tools/map-review-gameplay-layer.js', new Response(stale,
          { headers: { 'Content-Type': 'application/javascript' } }));
      }
    });
    await page.goto(`${base}/tools/map-review.html?lat=49.88&lon=-119.48&r=0&fixtures=1&geometry=off`);
    await page.waitForFunction(() => window.__world && !building, null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => !!window.__staleTierModule), false, 'current HTML must bypass the obsolete unversioned module');
    await page.locator('summary').filter({ hasText: /^Gameplay tiers$/ }).click();
    const toggle = page.locator('#gameplayTiers');
    const before = await page.locator('#map').screenshot();
    await toggle.check();
    await page.waitForFunction(() => gameplayReview.result && [...document.querySelectorAll('.leaflet-gameplayTiers-pane img')].some(i => i.complete && i.naturalWidth));
    const rendered = await page.evaluate(() => {
      const img = document.querySelector('.leaflet-gameplayTiers-pane img');
      const rect = img.getBoundingClientRect(), mapRect = document.querySelector('#map').getBoundingClientRect();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return {
        active: map.hasLayer(gameplayReview.layer),
        coloured: pixels.some((value, i) => i % 4 === 3 && value > 0),
        opacity: Number(getComputedStyle(img).opacity),
        overlaps: rect.left < mapRect.right && rect.right > mapRect.left && rect.top < mapRect.bottom && rect.bottom > mapRect.top,
        aboveArt: Number(getComputedStyle(map.getPane('gameplayTiers')).zIndex) > Number(getComputedStyle(map.getPane('gameArt')).zIndex),
        shared: gameplayReview.result.tiles.every(tile => tile.tiers === tile.entry.gameplayTiers),
      };
    });
    assert.deepEqual(rendered, { active: true, coloured: true, opacity: 0.45, overlaps: true, aboveArt: true, shared: true });
    const after = await page.locator('#map').screenshot();
    assert.ok(!before.equals(after), 'enabling tiers changes the visible map pixels');
    await toggle.uncheck();
    assert.equal(await page.locator('.leaflet-gameplayTiers-pane img').count(), 0, 'disabling removes the visible images');
    await toggle.check();
    assert.ok(await page.locator('.leaflet-gameplayTiers-pane img').count(), 'enabling again restores the images');
    assert.deepEqual(errors, []);
    console.log('Map review tiers bypass stale worker modules and visibly toggle on/off over game art.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
