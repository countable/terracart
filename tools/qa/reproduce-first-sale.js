#!/usr/bin/env node
'use strict';
// Disposable normal-speed regression reproduction. Inventory is a test fixture.
// Does not connect to or change a measured QA run.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || '/tmp/qa-first-sale-repro');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const file = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  try { const body = await fs.promises.readFile(file); res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream'); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
let browser;
async function run(mode) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 49.85438, longitude: -119.47870 }, permissions: ['geolocation'], serviceWorkers: 'block' });
  const errors = [], fixtureMisses = [];
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'tiles.openfreemap.org') {
      const match = u.pathname.match(/\/14\/(\d+)\/(\d+)\.pbf$/);
      if (match) {
        const file = path.join(ROOT, 'test/fixtures', `${match[1]}_${match[2]}.pbf`);
        if (fs.existsSync(file)) return route.fulfill({ path: file, contentType: 'application/octet-stream' });
        fixtureMisses.push(u.pathname); return route.fulfill({ status: 504, body: '' });
      }
      return route.fulfill({ json: { tiles: ['https://tiles.openfreemap.org/planet/fixture/{z}/{x}/{y}.pbf'] } });
    }
    return u.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await context.addInitScript(() => localStorage.setItem('terracart.introSeen', '1'));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?overpass=off`);
  await page.locator('#safety-dismiss').click({ timeout: 30000 });
  await page.waitForFunction(() => window.__scene?.playerM && window.__scene?.save, { timeout: 60000 });
  await page.locator('#howto-easy').click({ timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    // Fixture only: enough sellable inventory for the repeat offer to remain.
    __scene.save.inv = [{ id: 'potato', count: 2 }];
    __scene.save.selSlot = 0;
    if (__scene.save.storySeen) delete __scene.save.storySeen['sale:first'];
    delete __scene.save.firstSalePending;
    __scene.presentHomeSell(0, 0);
  });
  const snapshot = () => page.evaluate(() => ({
    date: Date.now(), virtualClock: typeof QAClock !== 'undefined', testMode: !!window.__TEST_MODE,
    money: __scene.save.money, inventory: __scene.save.inv,
    storySeen: !!__scene.save.storySeen?.['sale:first'],
    pending: !!__scene.save.firstSalePending,
    modals: [...document.querySelectorAll('.game-modal')]
      .filter(el => el.isConnected && getComputedStyle(el).display !== 'none' && el.getClientRects().length)
      .map(el => ({ kind: el.dataset.kind, text: el.innerText, zIndex: getComputedStyle(el).zIndex })),
  }));
  const before = await snapshot();
  await page.screenshot({ path: path.join(OUT, 'before-first-sale.png') });
  // Playwright's pointer click enforces normal visibility and hit-testing.
  await page.getByRole('button', { name: 'Sell', exact: true }).last().click();
  await page.waitForTimeout(2000);
  const after = await snapshot();
  await page.screenshot({ path: path.join(OUT, 'after-first-sale-queued.png') });
  assert.equal(after.modals.filter(m => m.kind === 'story').length, 0);
  assert.equal(after.modals.filter(m => m.kind === 'shop').length, 1);
  assert.equal(after.pending, true);
  assert.equal(after.storySeen, false);
  await page.getByRole('button', { name: 'Sell', exact: true }).last().click();
  await page.waitForTimeout(1000);
  const repeated = await snapshot();
  assert.equal(repeated.modals.filter(m => m.kind === 'story').length, 0);
  assert.equal(repeated.modals.filter(m => m.kind === 'shop').length, 1);
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('.game-modal[data-kind="story"]'));
  await page.waitForTimeout(600);
  const closed = await snapshot();
  assert.equal(closed.modals.filter(m => m.kind === 'shop').length, 0);
  assert.equal(closed.modals.filter(m => m.kind === 'story').length, 1);
  assert.equal(closed.storySeen, true);
  assert.equal(closed.pending, false);
  await page.screenshot({ path: path.join(OUT, 'story-after-leaving-shop.png') });
  const result = { repeated, closed, fixture: 'Disposable fresh Easy save; two potatoes inserted; Home sale opened directly. Only sale acceptance uses real pointer input. No virtual clock, no TEST_MODE, no measured-run connection.', before, after, errors, fixtureMisses };
  fs.writeFileSync(path.join(OUT, 'reproduction.json'), JSON.stringify(result, null, 2));
  assert.equal(after.virtualClock, false);
  assert.equal(after.testMode, false);
  assert.deepEqual(errors, []);
  assert.deepEqual(fixtureMisses, []);
  assert.equal(after.modals.filter(m => m.kind === 'shop').length, 1);
  console.log(JSON.stringify({passed:true, after:after.modals.map(m=>m.kind), repeated:repeated.modals.map(m=>m.kind), closed:closed.modals.map(m=>m.kind), errors, fixtureMisses}));
  await context.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try { await run(); } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
