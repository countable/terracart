const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      if (!/^https?:$/.test(location.protocol)) return;
      window.__renderScaleCap = 1;
      window.__deviceGpsCalls = 0;
      navigator.geolocation.watchPosition = () => { window.__deviceGpsCalls++; return 1; };
    });
    const page = await context.newPage();
    const errors = [];
    context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    page.on('pageerror', e => errors.push(e.message));
    const base = process.env.REVIEW_BASE_URL || 'http://localhost:8765';
    await page.goto(`${base}/tools/map-review.html?lat=49.88&lon=-119.48&r=0&fixtures=1&geometry=off`);
    await page.waitForFunction(() => window.__world && !building, null, { timeout: 120000 });
    const point = await page.evaluate(() => {
      const point = map.getCenter();
      map.fire('click', { latlng: point });
      return { lat: point.lat, lon: point.lng };
    });
    const link = page.getByRole('link', { name: 'Open in game', exact: true });
    const href = new URL(await link.getAttribute('href'));
    assert.equal(href.searchParams.get('fakeGps'), '1');
    for (const flag of ['skipIntro','skipStory','skipTutorial']) assert.equal(href.searchParams.get(flag),'true');
    assert.equal(Number(href.searchParams.get('lat')), point.lat);
    assert.equal(Number(href.searchParams.get('lon')), point.lon);
    const opened = context.waitForEvent('page');
    await link.click();
    const game = await opened;
    await game.waitForFunction(() => window.__scene?._gpsSimulated, null, { timeout: 120000 });
    const actual = await game.evaluate(() => ({
      position: localMToLonLat(__scene, __scene.playerM.x, __scene.playerM.y),
      enabled: __scene._debugGpsEnabled,
      simulated: __scene._gpsSimulated,
      deviceCalls: window.__deviceGpsCalls,
      capture: __scene._homeCapturePending,
      teleport: localStorage.getItem('terracart.teleport'),
    }));
    assert.ok(Math.abs(actual.position.lat - point.lat) < 1e-7);
    assert.ok(Math.abs(actual.position.lon - point.lon) < 1e-7);
    assert.equal(actual.enabled, true);
    assert.equal(actual.simulated, true);
    assert.equal(actual.deviceCalls, 0);
    assert.equal(actual.capture, false);
    assert.equal(actual.teleport, null);
    assert.equal(await game.locator('#safety').count(),0,'location welcome prompt is skipped');
    assert.equal(await game.locator('#howto').isVisible(),false,'how-to prompt is skipped');
    assert.equal(await game.evaluate(()=>Quests.starterHidden(__scene.save)),true,'tutorial objectives are skipped');
    assert.equal(await game.evaluate(()=>localStorage.getItem('terracart.introSeen')),null,'preview does not mark the intro seen');
    assert.deepEqual(errors, []);
    console.log('Map popup opens the game at the clicked point with simulated GPS and no device watch.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
