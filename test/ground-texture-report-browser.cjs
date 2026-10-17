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
        changedMaterials: report.visibleMaterials.filter(i => report.banks.old[i * 3].toDataURL() !== report.banks.new[i * 3].toDataURL()).length,
        seams: report.seamMetric(),
        stripesPreserved: [15,19,21].every(t => report.banks.new[t*3].toDataURL() === report.banks.procedural[t*3].toDataURL()),
        sandPreserved: [0, 1, 2].every(v => report.banks.new[6 + v].toDataURL() === report.banks.procedural[6 + v].toDataURL()),
      };
    });
    assert.deepEqual(result.dimensions, { width: 384, height: 256 });
    assert.deepEqual(result.coverage, { old: 96, new: 96, procedural: 96 });
    assert.equal(result.nativeDimensions, true);
    assert.equal(result.cards, 28);
    assert.equal(result.changedMaterials, 28);
    assert.equal(result.seams.max, 0, 'All replacement native variant edges must match');
    assert.equal(result.seams.materials, 17);
    assert.deepEqual(result.seams.excluded, [2, 3, 7, 8, 11, 12, 13, 14, 15, 19, 21, 23, 25, 26, 30]);
    assert.equal(result.stripesPreserved, true, 'Striped bases preserve original mowing pixels');
    assert.equal(result.sandPreserved, true, 'Latest sand retains all original procedural slots');
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
    const materialIds = await page.locator('#material option').evaluateAll(options => options.map(option => Number(option.value)));
    assert.deepEqual(materialIds, Array.from({length: 32}, (_, i) => i).filter(i => ![7, 8, 13, 14].includes(i)));
    for (const i of materialIds) await page.selectOption('#material', String(i));
    await page.selectOption('#material', '2');
    assert.equal(await pixels('new'), await pixels('procedural'), 'Sand patches match the original');
    for (const t of [11, 12, 25, 30]) {
      await page.selectOption('#material', String(t));
      assert.equal(await pixels('new'), await pixels('procedural'), 'Masonry patches preserve the real procedural renderer');
    }
    await page.selectOption('#material', '9');
    assert.notEqual(await pixels('new'), await pixels('procedural'), 'Brick uses the new periodic masonry');
    const masonry = await page.evaluate(() => {
      const { masonry, tileAt } = groundTextureReport;
      return { counts: Object.fromEntries(Object.entries(masonry).map(([t, tiles]) => [t, tiles.length])),
        used: new Set(Array.from({length: 60}, (_, i) => tileAt('new', 12, i % 10, Math.floor(i / 10)).toDataURL())).size,
        rows: document.querySelector('.card[data-material="12"] canvas').height };
    });
    assert.deepEqual(masonry.counts, {9: 1, 12: 16});
    assert.equal(masonry.used, 16, 'Castle patch includes all original slab layouts across both axes');
    assert.equal(masonry.rows, 64, 'Masonry catalogue shows both horizontal and vertical repeats');
    assert.equal(await page.locator('.card[data-material="16"] canvas').first().evaluate(c => c.height), 64, 'Commercial paving shows both horizontal and vertical repeats');
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
    console.log('PASS: native size, all 96 frames, old/new comparison, all controls, matching edges, side-by-side layout, no browser errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
