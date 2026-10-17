// Measure the same sandbox in a fresh context and on a normal cached reload.
// Run against the game server: node test/load-performance-browser.cjs [base URL]
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = `${process.argv[2] || 'http://localhost:8765'}/index.html?sandbox=true&sandboxZone=chapel&reset=true&skipStory=true`;
    const results = [];
    for (const run of ['cold', 'warm']) {
      await page.goto(url);
      await page.waitForFunction(() => window.__boot?.marks.some(m => m.name.startsWith('MAP PLAYABLE')), null, { timeout: 60000 });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
      // Includes the delayed modal icon prewarm, not just the boot loader.
      await page.waitForTimeout(12000);
      results.push(await page.evaluate(run => {
        const playable = __boot.marks.find(m => m.name.startsWith('MAP PLAYABLE')).t;
        const resources = performance.getEntriesByType('resource');
        const groups = {};
        for (const r of resources) {
          const path = new URL(r.name).pathname;
          const kind = path.endsWith('.js') ? 'scripts' : path.includes('/assets/') ? 'assets' : 'other';
          const group = groups[kind] ||= { requests: 0, transferred: 0, worker: 0 };
          group.requests++;
          group.transferred += r.transferSize;
          group.worker += r.workerStart > 0 ? 1 : 0;
        }
        return {
          run, playableMs: Math.round(playable), requests: resources.length,
          bootRequests: resources.filter(r => r.startTime < playable).length,
          groups,
          spans: __boot.spans.filter(s => /^(phaser preload|scene create)/.test(s.name))
            .map(s => ({ name: s.name, ms: Math.round(s.ms) })),
        };
      }, run));
    }
    assert.deepEqual(errors, [], 'Both loads must boot without JavaScript errors');
    assert(results[1].groups.assets.worker > 0, 'Warm assets must use the service worker');
    // A zero transferSize alone cannot prove a worker cache hit. Go offline and
    // fetch an exact cached resource: a worker passthrough would fail here.
    const asset = await page.evaluate(() => performance.getEntriesByType('resource').find(r => r.name.includes('/assets/'))?.name);
    assert(asset, 'The chapel must load game art');
    await context.setOffline(true);
    assert(await page.evaluate(async url => (await fetch(url)).ok, asset), 'Cached art must remain available offline');
    await page.goto(url);
    await page.waitForFunction(() => window.__boot?.marks.some(m => m.name.startsWith('MAP PLAYABLE')), null, { timeout: 30000 });
    assert.deepEqual(errors, [], 'Offline chapel must also boot without JavaScript errors');
    console.log(JSON.stringify(results, null, 2));
    console.log('PASS: cold/warm chapel boot, active worker, offline chapel reload, no page errors');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
