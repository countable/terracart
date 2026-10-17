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
      context.canvas.width = 384; context.canvas.height = 256;
      const pixels = images.map(i => { context.clearRect(0, 0, 384, 256); context.drawImage(i, 0, 0); return context.getImageData(0, 0, 384, 256).data; });
      // Count the actual composited colours across all three variants of each material.
      context.clearRect(0, 0, 384, 256);
      for (let t = 0; t < 32; t++) for (let v = 0; v < 3; v++) {
        const frame = t * 3 + v;
        context.fillStyle = palette[t];
        context.fillRect(frame % 12 * 32, Math.floor(frame / 12) * 32, 32, 32);
      }
      context.drawImage(images[1], 0, 0);
      const composed = context.getImageData(0, 0, 384, 256).data;
      const composedColorCounts = [];
      let edgeMax = 0, maxChannelContrast = 0, meanError = 0, opaqueAlphaMin = 255, detailAlphaMin = 255, detailAlphaMax = 0, distinctVariants = 0;
      const offset = (t, v, x, y) => { const f = t * 3 + v; return ((Math.floor(f / 12) * 32 + y) * 384 + (f % 12) * 32 + x) * 4; };
      for (let t = 0; t < 32; t++) {
        const signatures = new Set();
        const colors = new Set();
        for (let v = 0; v < 3; v++) {
          const signature = [];
          const mean = [0, 0, 0], color = [1, 3, 5].map(i => parseInt(palette[t].slice(i, i + 2), 16));
          for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
            const p = offset(t, v, x, y);
            colors.add(`${composed[p]},${composed[p + 1]},${composed[p + 2]}`);
            for (let c = 0; c < 3; c++) { maxChannelContrast = Math.max(maxChannelContrast, Math.abs(composed[p + c] - color[c])); mean[c] += pixels[0][p + c] / 1024; signature.push(pixels[0][p + c]); }
            opaqueAlphaMin = Math.min(opaqueAlphaMin, pixels[0][p + 3]);
            detailAlphaMin = Math.min(detailAlphaMin, pixels[1][p + 3]); detailAlphaMax = Math.max(detailAlphaMax, pixels[1][p + 3]);
          }
          signatures.add(signature.join(','));
          meanError = Math.max(meanError, ...mean.map((value, c) => Math.abs(value - color[c])));
          for (let w = 0; w < 3; w++) for (let n = 0; n < 32; n++) for (let c = 0; c < 4; c++) for (const data of pixels) {
            edgeMax = Math.max(edgeMax, Math.abs(data[offset(t, v, 31, n) + c] - data[offset(t, w, 0, n) + c]), Math.abs(data[offset(t, v, n, 31) + c] - data[offset(t, w, n, 0) + c]));
          }
        }
        if (signatures.size === 3) distinctVariants++;
        composedColorCounts.push(colors.size);
      }
      // Runtime preparation must only crop the prebaked pixels, with no readbacks.
      const readback = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = () => { throw new Error('Runtime readback'); };
      const scene = { textures: { exists: () => true, get: () => ({ getSourceImage: () => images[1] }) } };
      GroundAtlas.prepare(scene, {});
      const variantCounts = [[0, 2], [2, 2], [9, 1], [12, 16]].map(([t, fallback]) => GroundAtlas.variantCount(t, fallback));
      const distribution = [0, 0, 0];
      for (let h = 0; h < 100; h++) distribution[GroundAtlas.pickVariant(0, h, 2)]++;
      const drawn = Array.from({ length: 32 }, (_, t) => GroundAtlas.draw(context, 32, t, 0));
      CanvasRenderingContext2D.prototype.getImageData = readback;
      context.clearRect(0, 0, 384, 256); GroundAtlas.draw(context, 32, 23, 0);
      const pier = context.getImageData(0, 0, 32, 32).data;
      context.clearRect(0, 0, 384, 256); GroundAtlas.draw(context, 32, 3, 0);
      const water = context.getImageData(0, 0, 32, 32).data;
      const runtimeMatchesNative = water.every((value, i) => value === pixels[1][offset(3, 0, (i >> 2) % 32, Math.floor((i >> 2) / 32)) + i % 4]);
      const pierSharesWater = pier.every((value, i) => value === water[i]);
      GroundAtlas.prepare({ textures: { exists: () => false } }, {});
      const missingFallsBack = !GroundAtlas.draw(context, 32, 0, 0);
      return { dimensions: images.map(i => [i.width, i.height]), edgeMax, maxChannelContrast, composedColorCounts, meanError, opaqueAlphaMin, detailAlphaMin, detailAlphaMax, distinctVariants, variantCounts, distribution, drawn, pierSharesWater, runtimeMatchesNative, missingFallsBack };
    }, {
      opaque: 'data:image/png;base64,' + fs.readFileSync(path.join(directory, 'terrain-atlas-32.png')).toString('base64'),
      detail: 'data:image/png;base64,' + fs.readFileSync(path.join(directory, 'terrain-detail-32.png')).toString('base64'),
      palette: metadata.palette,
    });
    assert.equal(metadata.maxColorsPerMaterial, 4);
    assert.equal(metadata.variants, 3);
    result.composedColorCounts.forEach((count, type) => assert(count <= 4, `Material ${type} uses ${count} composed colours; maximum is four`));
    assert.deepEqual(result.dimensions, [[384, 256], [384, 256]]);
    assert.equal(result.edgeMax, 0, 'Every opposite base/decor edge must match, including runtime alpha');
    assert(result.maxChannelContrast <= 11, 'Composed atlas tones must stay within eleven RGB levels of their ground colour');
    assert(result.meanError < 10, 'Tile means must stay within ten RGB levels of the game palette');
    assert.equal(result.opaqueAlphaMin, 255); assert(result.detailAlphaMin < 255); assert(result.detailAlphaMax > 0);
    assert.equal(result.distinctVariants, 32, 'Every material needs three distinct variants');
    assert.deepEqual(result.variantCounts, [3, 2, 3, 16]);
    assert.deepEqual(result.distribution, [80, 10, 10]);
    assert.deepEqual(result.drawn, Array.from({ length: 32 }, (_, t) => ![2, 11, 12, 25, 30].includes(t)));
    assert.equal(result.runtimeMatchesNative, true, 'Runtime must use the exported pixels at 1:1 native scale');
    assert.equal(result.pierSharesWater, true); assert.equal(result.missingFallsBack, true);
    await page.goto('http://atlas.test/');
    await page.addScriptTag({ path: path.join(root, 'src/ground_atlas.js') });
    assert.equal(await page.evaluate(() => GroundAtlas.enabled()), false, 'The trial remains opt-in');
    console.log(JSON.stringify(result, null, 2));
    console.log('PASS: native dimensions, seamless mixed-variant edges, palette, opaque/detail alpha, distinct variants, runtime no-readbacks, preserved terrain, pier water, missing-asset fallback, default off.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
