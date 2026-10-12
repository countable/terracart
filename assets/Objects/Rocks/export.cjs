// Extract generated sprites, normalize their seating, and export at 24px.
// CHROMIUM_PATH=/path/to/chrome node assets/Objects/Rocks/export.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
    headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const sources = ['neutral-source.png', 'plain-shapes-source.png', 'zone-plain-source.png', 'zone-themed-source.png', 'quarry-reef-source.png', 'slab-lava-source.png'].map(file => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, file)).toString('base64'));
    const result = await page.evaluate(async sources => {
      const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 264;
      const out = canvas.getContext('2d'); out.imageSmoothingEnabled = false;
      const frames = [];
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const src = sources[sourceIndex], rows = [5, 3, 4, 2, 1, 1][sourceIndex], cols = [6, 2, 4, 4, 5, 2][sourceIndex], expected = rows * cols;
      const local = document.createElement('canvas'); local.width = (sourceIndex < 2 ? 6 : cols) * 24; local.height = (sourceIndex < 2 ? 6 : rows) * 24;
      const localOut = local.getContext('2d'); localOut.imageSmoothingEnabled = false;
      const image = new Image(); image.src = src; await image.decode();
      const input = document.createElement('canvas'); input.width = image.width; input.height = image.height;
      const ctx = input.getContext('2d'); ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, input.width, input.height);
      const w = input.width, h = input.height, seen = new Uint8Array(w * h), boxes = [];
      for (let i = 0; i < seen.length; i++) {
        if (seen[i] || data[i * 4 + 3] < 128) continue;
        const queue = [i]; seen[i] = 1;
        let minX = w, minY = h, maxX = 0, maxY = 0;
        for (let q = 0; q < queue.length; q++) {
          const p = queue[q], x = p % w, y = Math.floor(p / w);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
            if (n >= 0 && n < seen.length && !seen[n] && data[n * 4 + 3] >= 128) { seen[n] = 1; queue.push(n); }
          }
        }
        if (queue.length > 1000) boxes.push({ minX, minY, maxX, maxY });
      }
      if (boxes.length !== expected) throw Error('Expected ' + expected + ' complete rock silhouettes, got ' + boxes.length);
      for (let row = 0; row < rows; row++) {
        const group = boxes.filter(b => Math.round(b.maxY / h * rows - 1) === row).sort((a,b) => a.minX - b.minX);
        if (group.length !== cols) throw Error('Unexpected rock count in row ' + row);
        group.forEach((b,col) => {
          const frame = sourceIndex === 5 ? [57, 62][col] : [0, 30, 36, 52, 60, 0][sourceIndex] + row * cols + col, targetRow = Math.floor(frame / 6), targetCol = frame % 6;
          const sw = b.maxX - b.minX + 1, sh = b.maxY - b.minY + 1;
          const scale = Math.min((sourceIndex >= 3 || col % 2 ? 19 : 14) / sw, (sourceIndex >= 3 || col % 2 ? 19 : 9) / sh);
          const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
          const localFrame = sourceIndex === 5 ? col : sourceIndex < 2 ? frame : frame - [0, 30, 36, 52, 60, 0][sourceIndex];
          const localCols = sourceIndex < 2 ? 6 : cols;
          const lx = localFrame % localCols * 24, ly = Math.floor(localFrame / localCols) * 24;
          localOut.drawImage(image, b.minX, b.minY, sw, sh, lx + Math.floor((24 - dw) / 2), ly + 22 - dh, dw, dh);
          out.clearRect(targetCol * 24, targetRow * 24, 24, 24);
          out.drawImage(local, lx, ly, 24, 24, targetCol * 24, targetRow * 24, 24, 24);
          frames.push({ frame, sourceIndex, sourceBounds: b, width: dw, height: dh });
        });
      }
      }
      const selected = [...new Map(frames.map(f => [f.frame, f])).values()].sort((a,b)=>a.frame-b.frame);
      return { png: canvas.toDataURL('image/png').split(',')[1], frames: selected };
    }, sources);
    fs.writeFileSync(path.join(__dirname, 'rocks-24.png'), Buffer.from(result.png, 'base64'));
    fs.writeFileSync(path.join(__dirname, 'export.json'), JSON.stringify(result.frames, null, 2) + '\n');
    console.log('Exported 65 complete sprites into 144x264, 24px frames.');
  } finally { await browser.close(); }
})();
