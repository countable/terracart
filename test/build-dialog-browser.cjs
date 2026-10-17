const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 900]]) {
      const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
      await page.addInitScript(() => { window.__TEST_MODE = true; });
      await page.goto((process.env.TEST_URL || 'http://127.0.0.1:8012/') + '?sandbox=true');
      await page.waitForFunction(() => window.__scene?.save, { timeout: 60000 });
      await page.evaluate(() => {
        document.querySelectorAll('.game-modal').forEach(el => el.remove());
        window.__scene.showOfferModal({ kind: 'build', canAfford: true, acceptLabel: 'Restore', cancelLabel: 'Later',
          choices: Array.from({ length: 18 }, (_, i) => ({ key: String(i), label: `Building ${i + 1}`, cost: `${i + 1} rocks`, canAfford: i !== 16 })),
          onAccept: key => { window.buildPicked = key; } });
      });
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#offer-modal .modal-pages').count(), 0);
      const restore = page.getByRole('button', { name: 'Restore', exact: true });
      assert(await restore.isDisabled());
      const checkFooter = async () => assert(await restore.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      }), `${width}×${height}: actions stay on screen`);
      await checkFooter();
      await page.getByRole('button', { name: 'Building 17', exact: true }).click();
      assert(await restore.isDisabled(), 'unaffordable selection stays disabled');
      await page.getByRole('button', { name: 'Building 18', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Building 18', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.offer-cost').innerText(), '18 rocks');
      assert(await page.locator('.modal-copy').evaluate(el => (el.scrollHeight <= el.clientHeight || el.scrollTop > 0) && el.scrollWidth <= el.clientWidth + 1));
      await checkFooter();
      await page.screenshot({ path: `/tmp/build-dialog-${width}.png` });
      await restore.click();
      assert.equal(await page.evaluate(() => window.buildPicked), '17');
      assert.equal(await page.locator('#offer-modal').count(), 0);
      await page.evaluate(() => {
        const scene = window.__scene;
        scene.presentWreckRestoreModal(0, 0, { kind: 'house', tier: 1, id: 'build-layout-review' });
      });
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#offer-modal .modal-pages').count(), 0);
      await checkFooter();
      await page.locator('#offer-modal [aria-pressed]').last().click();
      await page.screenshot({ path: `/tmp/build-dialog-real-${width}.png` });
      await page.getByRole('button', { name: 'Later', exact: true }).click();
      assert.equal(await page.locator('#offer-modal').count(), 0);
      console.log(`${width}×${height}: build scroll, selection, price and actions passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
