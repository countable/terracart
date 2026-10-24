// Run against a served checkout; the relay is mocked, so no detection is billed.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', async m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) for (const a of m.args()) console.error(await a.evaluate(v => v?.stack || String(v))); });
    let requests = 0, detectedPoint = null;
    await page.route('http://review-relay.invalid/geometry/trees/**', async route => {
      requests++;
      const [z, x, y] = new URL(route.request().url()).pathname.split('/').slice(-3).map(Number);
      const tile = { z, x, y };
      const bbox = await page.evaluate(t => Geometry.bounds(t), tile);
      await route.fulfill({ json: { type: 'FeatureCollection', schemaVersion: 1, tile,
        coverage: { bbox }, features: detectedPoint ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: detectedPoint }, properties: { source: 'gemini', kind: 'tree', tree_type: 'broadleaf', size: 'medium', confidence: 'high', crown_m: 4 } }] : [], model: 'test', generatedAt: '2026-10-23T00:00:00Z' } });
    });
    const base = process.env.REVIEW_BASE_URL || 'http://localhost:8765';
    await page.goto(`${base}/tools/map-review.html?lat=49.88&lon=-119.48&r=0&fixtures=1&geometry=off&relay=http://review-relay.invalid`);
    await page.waitForFunction(() => (window.__world && !building) || document.querySelector('#status').textContent.startsWith('failed:'), null, { timeout: 120000 }).catch(async e => { console.error(await page.locator('#status').innerText(), errors); throw e; });
    assert.equal(await page.locator('#status').innerText(), 'ready');
    assert.equal(requests, 0, 'offline mode never contacts relay');
    await page.evaluate(async () => {
      const url = new URL(location.href); url.searchParams.delete('geometry'); history.replaceState(null, '', url);
      await detectTreesAtCentre();
    });
    assert.equal(requests, 1, 'requests only the centre z18 tile');
    assert.match(await page.locator('#geometryStatus').innerText(), /Relay evidence loaded/);
    assert.equal(await page.evaluate(() => raw.filter(e => e.bin?._geometryCoverage?.length).length), 1);
    assert.equal(await page.evaluate(() => window.__world.errors.length), 0);
    await page.evaluate(() => detectTreesAtCentre());
    assert.equal(requests, 1, 'successful empty coverage is cached');
    detectedPoint = await page.evaluate(() => {
      const centre = Geometry.tileAt(map.getCenter().lng, map.getCenter().lat);
      for (const entry of window.__world.tiles) for (const o of entry.objects) {
        if (o.kind !== 'tree' || o.planted) continue;
        const ll = L.latLng(toLL(o.x, o.y, EDGE)), tile = Geometry.tileAt(ll.lng, ll.lat);
        if (tile.x === centre.x && tile.y === centre.y) continue;
        map.setView(ll, map.getZoom(), { animate: false });
        return [ll.lng, ll.lat];
      }
    });
    assert.ok(detectedPoint, 'fixture has a tree outside the empty observation');
    await page.evaluate(() => detectTreesAtCentre());
    assert.equal(requests, 2);
    assert.ok(await page.evaluate(() => window.__world.tiles.some(e => e.objects.some(o => o._treeSource === 'gemini'))), 'relay tree survives the real generation and dressing pipeline');
    assert.deepEqual(errors, []);
    console.log('Map review relay request, detected tree placement, empty coverage, rebuild, cache and offline checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
