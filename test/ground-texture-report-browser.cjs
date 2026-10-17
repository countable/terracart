// Start a repository HTTP server, then node test/ground-texture-report-browser.cjs [base URL].
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${process.argv[2] || 'http://127.0.0.1:8769'}/tools/ground-texture-report.html`);
    await page.waitForFunction(() => document.documentElement.dataset.reportReady === 'true');
    const result = await page.evaluate(() => {
      const report = groundTextureReport;
      return {
        dimensions: report.dimensions,
        coverage: Object.fromEntries(Object.entries(report.banks).map(([key, tiles]) => [key, tiles.length])),
        nativeDimensions: report.banks.new.every(tile => tile.width === 32 && tile.height === 32),
        cards: document.querySelectorAll('.card').length,
        changedMaterials: report.names.filter((_, i) => report.banks.old[i * 2].toDataURL() !== report.banks.new[i * 2].toDataURL()).length,
        seams: report.seamMetric(),
      };
    });
    assert.deepEqual(result.dimensions, { width: 256, height: 256 });
    assert.deepEqual(result.coverage, { old: 64, new: 64, procedural: 64 });
    assert.equal(result.nativeDimensions, true);
    assert.equal(result.cards, 32);
    assert.equal(result.changedMaterials, 32);
    assert.equal(result.seams.max, 0, 'All native variant edges must match');
    const pixels = id => page.locator('#' + id).evaluate(c => c.toDataURL());
    assert.notEqual(await pixels('old'), await pixels('new'));
    assert.notEqual(await pixels('procedural'), await pixels('new'));
    assert.equal(await page.locator('#new').evaluate(c => c.getBoundingClientRect().width), 320, 'Native zoom is the default');
    const decorated = await pixels('new');
    await page.locator('#decor').uncheck();
    assert.notEqual(await pixels('new'), decorated, 'Decor control changes actual pixels');
    await page.locator('#decor').check();
    const withCharacter = await pixels('new');
    await page.locator('#character').uncheck();
    assert.notEqual(await pixels('new'), withCharacter, 'Character control changes actual pixels');
    await page.locator('#character').check();
    for (let i = 0; i < 32; i++) await page.selectOption('#material', String(i));
    await page.selectOption('#material', '0');
    assert.equal(await pixels('new'), decorated, 'Material controls restore the deterministic comparison');
    for (const zoom of [2, 4]) {
      await page.selectOption('#zoom', String(zoom));
      assert.equal(await page.locator('#new').evaluate(c => c.getBoundingClientRect().width), 320 * zoom);
    }
    await page.selectOption('#zoom', '1');
    const adjacent = await page.evaluate(() => {
      const old = document.querySelector('#procedural').closest('figure').getBoundingClientRect();
      const next = document.querySelector('#new').closest('figure').getBoundingClientRect();
      return old.top === next.top && old.right <= next.left;
    });
    assert.equal(adjacent, true, 'Procedural original and latest remain side by side');
    assert.deepEqual(errors, []);
    if (process.env.GROUND_REPORT_SCREENSHOT) await page.screenshot({ path: process.env.GROUND_REPORT_SCREENSHOT, fullPage: true });
    console.log(JSON.stringify(result, null, 2));
    console.log('PASS: native size, all 64 frames, old/new comparison, all controls, matching edges, side-by-side layout, no browser errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
