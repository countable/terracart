// Run with a checkout server: node test/ground-atlas-browser.cjs [base URL]
// Optional CHROMIUM_PATH and GROUND_ATLAS_SCREENSHOT_DIR control the browser/artifacts.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1300 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.argv[2] || 'http://127.0.0.1:8769'}/tools/ground-atlas-viewer.html`);
    await page.waitForFunction(() => document.documentElement.dataset.atlasReady === 'true');
    await page.locator('#animate').uncheck();
    const result = await page.evaluate(() => {
      const lab = groundAtlasLab;
      const meanErrors = lab.tiles.map((tile, i) => {
        const mean = [0, 0, 0];
        for (let p = 0; p < tile.repaired.length; p += 4) for (let k = 0; k < 3; k++) mean[k] += tile.repaired[p + k] / 1024;
        return Math.max(...mean.map((v, k) => Math.abs(v - lab.palette[i >> 1][k])));
      });
      const offsets = [0, 1, 2, 1, 0, -1, -2, -1];
      let waterLoopCorrect = true;
      for (const set of lab.waterFrames) for (const kind of ['raw', 'repaired']) for (let f = 0; f < 8; f++) {
        const next = (f + 1) % 8, shift = offsets[next] - offsets[f];
        if (Math.abs(shift) !== 1) waterLoopCorrect = false;
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) for (let k = 0; k < 4; k++) {
          if (set[kind][next][(y * 32 + x) * 4 + k] !== set[kind][f][(y * 32 + (x + shift + 32) % 32) * 4 + k]) waterLoopCorrect = false;
        }
      }
      return { tiles: lab.tiles.length, cards: document.querySelectorAll('.card').length, raw: lab.seamMetric(false), prepared: lab.seamMetric(true), maxPaletteMeanError: Math.max(...meanErrors), waterLoopCorrect };
    });
    assert.equal(result.tiles, 64); assert.equal(result.cards, 32);
    assert.equal(result.prepared.max, 0, 'Prepared edges must agree for every base/decoration pair in both axes');
    assert.equal(result.waterLoopCorrect, true, 'The last-to-first water frame must move one pixel, like every other step');
    assert(result.maxPaletteMeanError < 10, 'Prepared material averages must remain near the runtime palette');
    const pixels = () => page.locator('#blended').evaluate(c => c.toDataURL());
    const decorated = await pixels();
    await page.locator('#decor').uncheck(); assert.notEqual(await pixels(), decorated, 'Decoration control must affect rendered pixels');
    await page.locator('#decor').check();
    const prepared = await pixels();
    await page.locator('#repair').uncheck(); assert.notEqual(await pixels(), prepared, 'Preparation control must affect rendered pixels');
    await page.locator('#repair').check();
    const feathered = await pixels();
    await page.locator('#feather').uncheck(); assert.notEqual(await pixels(), feathered, 'Experimental feather must affect biome-edge pixels');
    await page.locator('#feather').check();
    for (const layout of ['island', 'split', 'repeat', 'checker', 'diagonal', 'junction']) {
      await page.selectOption('#layout', layout);
      for (const b of ['1', '2', '3', '9', '25', '26', '31']) await page.selectOption('#b', b);
    }
    for (let a = 0; a < 32; a++) await page.selectOption('#a', String(a));
    await page.selectOption('#layout', 'split'); await page.selectOption('#a', '0'); await page.selectOption('#b', '1');
    const masks = await page.evaluate(() => {
      const lab = groundAtlasLab;
      const same = lab.ground(0, 0, 15, 1, 2), edge = lab.ground(0, 31, 15, 5, 2), inner = lab.ground(0, 25, 15, 5, 2);
      return { sameFade: same.fade, edgeFade: edge.fade, innerFade: inner.fade, edgeColor: edge.color };
    });
    assert.equal(masks.sameFade, 1, 'No fade at a same-biome tile boundary');
    assert.equal(masks.edgeFade, 0); assert.equal(masks.innerFade, 1);
    await page.selectOption('#a', '3'); await page.selectOption('#b', '2');
    const shore = await page.evaluate(() => groundAtlasLab.ground(3, 31, 15, 5, 2).color);
    assert.deepEqual(shore, [223, 240, 247], 'Water keeps its surf rather than land blending');
    await page.selectOption('#zoom', '1');
    assert.equal(await page.locator('#blended').evaluate(c => c.getBoundingClientRect().width), 384);
    await page.selectOption('#zoom', '2'); await page.selectOption('#layout', 'island');
    await page.locator('#animate').check();
    const before = await page.evaluate(() => groundAtlasLab.renderCount);
    await page.waitForTimeout(500); assert(await page.evaluate(() => groundAtlasLab.renderCount) > before);
    await page.locator('#animate').uncheck();
    const stopped = await pixels(); await page.waitForTimeout(500); assert.equal(await pixels(), stopped, 'Paused water must stay still');
    if (process.env.GROUND_ATLAS_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.GROUND_ATLAS_SCREENSHOT_DIR, 'water.png') });
      await page.selectOption('#a', '0'); await page.selectOption('#b', '2');
      await page.screenshot({ path: path.join(process.env.GROUND_ATLAS_SCREENSHOT_DIR, 'blending.png') });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(result, null, 2));
    console.log('PASS: atlas coverage, actual canvas changes, matching edges, palette, six seam layouts, shore mask, native zoom, cyclic water, pause. Edge equality does not prove absence of repeated motifs or inner preparation bands.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
