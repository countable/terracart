// Export the selected approved candidates without distorting their silhouettes.
// node tools/export_castle_towers.js /path/to/castle-tower-candidates/master.png
// High-quality reduction integrates source detail; nearest-neighbour reduction
// of the large generated master produced the scrambled first tower export.
const fs = require('fs');
const { chromium } = require('playwright-core');
(async () => {
  if (!process.argv[2]) throw new Error('Pass the approved candidate master PNG');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      const sheet = document.createElement('canvas'); sheet.width = 128; sheet.height = 40;
      const out = sheet.getContext('2d'); out.imageSmoothingEnabled = true; out.imageSmoothingQuality = 'high';
      const selected = [7, 12, 1, 3], crops = [];
      selected.forEach((id, frame) => {
        const i = id - 1, x = Math.round(i % 4 * image.width / 4), y = Math.round(Math.floor(i / 4) * image.height / 3);
        const w = Math.round((i % 4 + 1) * image.width / 4) - x, h = Math.round((Math.floor(i / 4) + 1) * image.height / 3) - y;
        const cell = document.createElement('canvas'); cell.width = w; cell.height = h;
        const ctx = cell.getContext('2d'); ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        let l = w, t = h, r = 0, b = 0;
        for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if (px[(cy * w + cx) * 4 + 3] >= 128) {
          l = Math.min(l, cx); r = Math.max(r, cx); t = Math.min(t, cy); b = Math.max(b, cy);
        }
        const cw = r - l + 1, ch = b - t + 1, scale = Math.min(32 / cw, 40 / ch);
        const dw = Math.round(cw * scale), dh = Math.round(ch * scale);
        out.drawImage(cell, l, t, cw, ch, frame * 32 + Math.floor((32 - dw) / 2), 40 - dh, dw, dh);
        crops.push({ frame, candidate: id, source: [x + l, y + t, cw, ch], height: dh });
      });
      return { png: sheet.toDataURL(), crops };
    }, 'data:image/png;base64,' + fs.readFileSync(process.argv[2]).toString('base64'));
    fs.writeFileSync('assets/Objects/Castle/tower_shapes.png', Buffer.from(result.png.split(',')[1], 'base64'));
    fs.writeFileSync('assets/Objects/Castle/frames.json', JSON.stringify(result.crops, null, 2) + '\n');
  } finally { await browser.close(); }
})();
