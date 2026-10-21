// Exercises every choice in the local authored-building art viewer.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const out = process.env.ART_OUTPUT || '/tmp/pp-building-viewer';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const env = { ...process.env }; delete env.DISPLAY;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/lib/chromium/chromium', env,
    args: ['--no-sandbox', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = [], results = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
    await page.goto(process.env.VIEWER_URL || 'http://localhost:8765/ra-village-house/');
    await page.waitForFunction(() => window.ready, {}, { timeout: 60000 });
    const keys = await page.locator('#version option').evaluateAll(options => options.map(o => o.value));
    assert.equal(keys.filter(k => k.startsWith('pp_flat_')).length, 6, 'all six native flat-roof colorways are present');
    for (const key of keys) {
      await page.selectOption('#version', key);
      await page.selectOption('#footprint', 'rectangle');
      await page.click('#artview');
      for (const angle of [0, 45, 90, 180, 270]) {
        await page.locator('#angle').fill(String(angle));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const audit = await page.evaluate(() => ({
          faces: reviewScene._lowpoly.faces.length,
          finite: reviewScene._lowpoly.faces.every(f => f.points.every(p => ['x', 'y', 'z', 'tu', 'tv'].every(k => Number.isFinite(p[k])))),
          gl: depthView.gl.getError(), angle: reviewScene.mapRot,
          source: document.querySelector('#reference').width > 0
        }));
        assert(audit.faces > 0 && audit.finite && audit.source, key + ': valid textured geometry');
        assert.equal(audit.gl, 0, key + ': no WebGL error');
        assert(Math.abs(audit.angle - angle * Math.PI / 180) < .001, key + ': requested rotation rendered');
        if (angle === 0 || angle === 45) await page.locator('#game').screenshot({ path: path.join(out, `${key}-${angle}.png`) });
        results.push({ key, angle, ...audit });
      }
      // Flat roofs must also cover concave plots without invalid UVs.
      if (key.startsWith('pp_flat_')) {
        for (const shape of ['l', 't', 'courtyard']) {
          await page.selectOption('#footprint', shape);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert(await page.evaluate(() => reviewScene._lowpoly.faces.every(f => f.points.every(p =>
            ['x','y','z','tu','tv'].every(k => Number.isFinite(p[k])))) && depthView.gl.getError() === 0), key + ': ' + shape);
        }
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify({ models: keys.length, rotations: results.length, errors, results }, null, 2));
    fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Building texture checks</title><style>body{background:#202d28;color:#eee5cf;font:16px system-ui;margin:24px}section{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}article{background:#344539;padding:12px}img{width:100%;image-rendering:pixelated}h2{font-size:16px}</style><h1>Building texture checks</h1><p>All ' + keys.length + ' choices checked at five rotations. Native flat roofs also checked on L, T and courtyard plots. <a href="audit.json">Audit</a></p><section>' + keys.map(key => `<article><h2>${key}</h2><img src="${key}-0.png" alt="${key} front"><img src="${key}-45.png" alt="${key} rotated"></article>`).join('') + '</section>');
    console.log(JSON.stringify({ models: keys.length, rotations: results.length, concaveChecks: 18, errors, output: out }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
