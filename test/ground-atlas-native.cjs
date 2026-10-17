// node test/ground-atlas-native.cjs [asset directory]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.argv[2] || path.join(root, 'assets/ground'));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('http://atlas.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
    await page.goto('http://atlas.test/?groundAtlas=true');
    await page.addScriptTag({ path: path.join(root, 'src/ground_atlas.js') });
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'terrain-atlas-32.json')));
    const result = await page.evaluate(async ({ opaque, detail, palette }) => {
      const load = async data => { const i = new Image(); i.src = data; await i.decode(); return i; };
      const images = await Promise.all([load(opaque), load(detail)]);
      const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      context.canvas.width = context.canvas.height = 256;
      const pixels = images.map(i => { context.clearRect(0, 0, 256, 256); context.drawImage(i, 0, 0); return context.getImageData(0, 0, 256, 256).data; });
      let edgeMax = 0, meanError = 0, opaqueAlphaMin = 255, detailAlphaMin = 255, detailAlphaMax = 0, distinctVariants = 0;
      const offset = (t, v, x, y) => { const f = t * 2 + v; return (((f >> 3) * 32 + y) * 256 + (f % 8) * 32 + x) * 4; };
      for (let t = 0; t < 32; t++) {
        let different = false;
        for (let v = 0; v < 2; v++) {
          const mean = [0, 0, 0], color = [1, 3, 5].map(i => parseInt(palette[t].slice(i, i + 2), 16));
          for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
            const p = offset(t, v, x, y);
            for (let c = 0; c < 3; c++) { mean[c] += pixels[0][p + c] / 1024; if (pixels[0][p + c] !== pixels[0][offset(t, 1 - v, x, y) + c]) different = true; }
            opaqueAlphaMin = Math.min(opaqueAlphaMin, pixels[0][p + 3]);
            detailAlphaMin = Math.min(detailAlphaMin, pixels[1][p + 3]); detailAlphaMax = Math.max(detailAlphaMax, pixels[1][p + 3]);
          }
          meanError = Math.max(meanError, ...mean.map((value, c) => Math.abs(value - color[c])));
          for (let w = 0; w < 2; w++) for (let n = 0; n < 32; n++) for (let c = 0; c < 4; c++) for (const data of pixels) {
            edgeMax = Math.max(edgeMax, Math.abs(data[offset(t, v, 31, n) + c] - data[offset(t, w, 0, n) + c]), Math.abs(data[offset(t, v, n, 31) + c] - data[offset(t, w, n, 0) + c]));
          }
        }
        if (different) distinctVariants++;
      }
      // Runtime preparation must only crop the prebaked pixels, with no readbacks.
      const readback = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = () => { throw new Error('Runtime readback'); };
      const scene = { textures: { exists: () => true, get: () => ({ getSourceImage: () => images[1] }) } };
      GroundAtlas.prepare(scene, {});
      const drawn = Array.from({ length: 32 }, (_, t) => GroundAtlas.draw(context, 32, t, 0));
      CanvasRenderingContext2D.prototype.getImageData = readback;
      context.clearRect(0, 0, 256, 256); GroundAtlas.draw(context, 32, 23, 0);
      const pier = context.getImageData(0, 0, 32, 32).data;
      context.clearRect(0, 0, 256, 256); GroundAtlas.draw(context, 32, 3, 0);
      const water = context.getImageData(0, 0, 32, 32).data;
      const runtimeMatchesNative = water.every((value, i) => value === pixels[1][offset(3, 0, (i >> 2) % 32, Math.floor((i >> 2) / 32)) + i % 4]);
      const pierSharesWater = pier.every((value, i) => value === water[i]);
      GroundAtlas.prepare({ textures: { exists: () => false } }, {});
      const missingFallsBack = !GroundAtlas.draw(context, 32, 0, 0);
      return { dimensions: images.map(i => [i.width, i.height]), edgeMax, meanError, opaqueAlphaMin, detailAlphaMin, detailAlphaMax, distinctVariants, drawn, pierSharesWater, runtimeMatchesNative, missingFallsBack };
    }, {
      opaque: 'data:image/png;base64,' + fs.readFileSync(path.join(directory, 'terrain-atlas-32.png')).toString('base64'),
      detail: 'data:image/png;base64,' + fs.readFileSync(path.join(directory, 'terrain-detail-32.png')).toString('base64'),
      palette: metadata.palette,
    });
    assert.deepEqual(result.dimensions, [[256, 256], [256, 256]]);
    assert.equal(result.edgeMax, 0, 'Every opposite base/decor edge must match, including runtime alpha');
    assert(result.meanError < 10, 'Tile means must stay within ten RGB levels of the game palette');
    assert.equal(result.opaqueAlphaMin, 255); assert(result.detailAlphaMin < 255); assert(result.detailAlphaMax > 0);
    assert.equal(result.distinctVariants, 32, 'Every material needs a distinct decoration variant');
    assert.deepEqual(result.drawn, Array.from({ length: 32 }, (_, t) => ![9, 11, 12, 25, 30].includes(t)));
    assert.equal(result.runtimeMatchesNative, true, 'Runtime must use the exported pixels at 1:1 native scale');
    assert.equal(result.pierSharesWater, true); assert.equal(result.missingFallsBack, true);
    await page.goto('http://atlas.test/');
    await page.addScriptTag({ path: path.join(root, 'src/ground_atlas.js') });
    assert.equal(await page.evaluate(() => GroundAtlas.enabled()), false, 'The trial remains opt-in');
    console.log(JSON.stringify(result, null, 2));
    console.log('PASS: native dimensions, seamless mixed-variant edges, palette, opaque/detail alpha, distinct variants, runtime no-readbacks, preserved terrain, pier water, missing-asset fallback, default off.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
