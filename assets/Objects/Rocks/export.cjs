// Repack the approved 8×8 study without resampling or changing its pixels.
// Runtime retains its 65 frame identities, including Mystic Reef at frame 64.
// CHROMIUM_PATH=/usr/bin/chromium node assets/Objects/Rocks/export.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const manifest = require('./manifest.json');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true,
  });
  try {
    const page = await browser.newPage();
    const source = fs.readFileSync(path.join(__dirname, manifest.sources.dgPixel.file));
    const result = await page.evaluate(async ({ src, mapping }) => {
      const image = new Image(); image.src = src; await image.decode();
      if (image.width !== 128 || image.height !== 128) throw Error('Expected 8×8 study with 16px cells');
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 144;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      const frames = mapping.map(({ sourceFrame, ...entry }, frame) => {
        const x = frame % 8 * 16, y = Math.floor(frame / 8) * 16;
        ctx.drawImage(image, sourceFrame % 8 * 16, Math.floor(sourceFrame / 8) * 16, 16, 16, x, y, 16, 16);
        const { data } = ctx.getImageData(x, y, 16, 16);
        let minX = 16, minY = 16, maxX = -1, maxY = -1;
        for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
          if (data[(py * 16 + px) * 4 + 3] < 16) continue;
          minX = Math.min(minX, px); minY = Math.min(minY, py);
          maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
        }
        if (maxX < 0) throw Error('Empty runtime frame ' + frame);
        return { frame, sourceFrame, ...entry, width: maxX - minX + 1, height: maxY - minY + 1 };
      });
      return { png: canvas.toDataURL().split(',')[1], frames };
    }, { src: 'data:image/png;base64,' + source.toString('base64'), mapping: manifest.mapping });
    fs.writeFileSync(path.join(__dirname, 'rocks-16.png'), Buffer.from(result.png, 'base64'));
    fs.writeFileSync(path.join(__dirname, 'export.json'), JSON.stringify(result.frames, null, 2) + '\n');
    console.log('Exported all 65 runtime frames from the approved 16px study.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
