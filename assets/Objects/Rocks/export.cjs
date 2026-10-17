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
    const source = fs.readFileSync(path.join(__dirname, manifest.sources.celShaded.file));
    const result = await page.evaluate(async ({ src, mapping }) => {
      const image = new Image(); image.src = src; await image.decode();
      if (image.width !== 192 || image.height !== 192) throw Error('Expected 8×8 study with 24px cells');
      const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 216;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      const frames = mapping.map(({ sourceFrame, ...entry }, frame) => {
        const x = frame % 8 * 24, y = Math.floor(frame / 8) * 24;
        ctx.drawImage(image, sourceFrame % 8 * 24, Math.floor(sourceFrame / 8) * 24, 24, 24, x, y, 24, 24);
        const { data } = ctx.getImageData(x, y, 24, 24);
        let minX = 24, minY = 24, maxX = -1, maxY = -1;
        for (let py = 0; py < 24; py++) for (let px = 0; px < 24; px++) {
          if (data[(py * 24 + px) * 4 + 3] < 16) continue;
          minX = Math.min(minX, px); minY = Math.min(minY, py);
          maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
        }
        if (maxX < 0) throw Error('Empty runtime frame ' + frame);
        return { frame, sourceFrame, ...entry, width: maxX - minX + 1, height: maxY - minY + 1 };
      });
      return { png: canvas.toDataURL().split(',')[1], frames };
    }, { src: 'data:image/png;base64,' + source.toString('base64'), mapping: manifest.mapping });
    fs.writeFileSync(path.join(__dirname, 'rocks-24.png'), Buffer.from(result.png, 'base64'));
    fs.writeFileSync(path.join(__dirname, 'export.json'), JSON.stringify(result.frames, null, 2) + '\n');
    console.log('Exported all 65 runtime frames from the approved 24px study.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
