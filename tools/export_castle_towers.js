// Export the regenerated tower designs into their fixed one-and-a-half-cell frames.
// node tools/export_castle_towers.js [path/to/tower_master.png]
// High-quality reduction integrates source detail; nearest-neighbour reduction
// of the large generated master produced the scrambled first tower export.
const fs = require('fs');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      const sheet = document.createElement('canvas'); sheet.width = 128; sheet.height = 48;
      const out = sheet.getContext('2d'); out.imageSmoothingEnabled = true; out.imageSmoothingQuality = 'high';
      const selected = [7, 12, 1, 3], crops = [];
      selected.forEach((id, frame) => {
        const x = Math.round(frame * image.width / 4), y = 0;
        const w = Math.round((frame + 1) * image.width / 4) - x, h = image.height;
        const cell = document.createElement('canvas'); cell.width = w; cell.height = h;
        const ctx = cell.getContext('2d'); ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        let l = w, t = h, r = 0, b = 0;
        for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if (px[(cy * w + cx) * 4 + 3] >= 128) {
          l = Math.min(l, cx); r = Math.max(r, cx); t = Math.min(t, cy); b = Math.max(b, cy);
        }
        const cw = r - l + 1, ch = b - t + 1;
        // The regenerated shafts fill one cell plus half the cell above.
        out.drawImage(cell, l, t, cw, ch, frame * 32, 0, 32, 48);
        crops.push({ frame, candidate: id, source: [x + l, y + t, cw, ch], width: 32, height: 48 });
      });
      return { png: sheet.toDataURL(), crops };
    }, 'data:image/png;base64,' + fs.readFileSync(process.argv[2] || 'assets/Objects/Castle/tower_master.png').toString('base64'));
    fs.writeFileSync('assets/Objects/Castle/tower_shapes.png', Buffer.from(result.png.split(',')[1], 'base64'));
    fs.writeFileSync('assets/Objects/Castle/frames.json', JSON.stringify(result.crops, null, 2) + '\n');
  } finally { await browser.close(); }
})();
