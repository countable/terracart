// Re-export the graphic-storybook sheet into 24px frames; no generative calls.
// CHROMIUM_PATH=/usr/bin/chromium node assets/Objects/Rocks/export.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true,
  });
  try {
    const page = await browser.newPage();
    const source = fs.readFileSync(path.join(__dirname, 'graphic-storybook-source.png'));
    const result = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const w = canvas.width, h = canvas.height, seen = new Uint8Array(w * h), boxes = [];
      // Find connected silhouettes instead of trusting generated cell spacing.
      for (let start = 0; start < seen.length; start++) {
        if (seen[start] || data[start * 4 + 3] < 128) continue;
        const queue = [start]; seen[start] = 1;
        let x0 = w, y0 = h, x1 = 0, y1 = 0;
        for (let n = 0; n < queue.length; n++) {
          const at = queue[n], x = at % w, y = Math.floor(at / w);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          for (const next of [x > 0 ? at - 1 : -1, x < w - 1 ? at + 1 : -1, at - w, at + w]) {
            if (next >= 0 && next < seen.length && !seen[next] && data[next * 4 + 3] >= 128) {
              seen[next] = 1; queue.push(next);
            }
          }
        }
        if (queue.length > 500) boxes.push({ x: x0, y: y0, w: x1 - x0 + 1,
          h: y1 - y0 + 1, bottom: y1, area: queue.length });
      }
      const groups = Array.from({ length: 9 }, () => []);
      for (const box of boxes) {
        const row = Math.round(box.bottom / h * 9) - 1;
        if (!groups[row]) throw Error('Silhouette outside source rows');
        groups[row].push(box);
      }
      for (const group of groups) group.sort((a, b) => a.x - b.x);
      const sourceCounts = groups.map(group => group.length);
      if (sourceCounts.join() !== '8,8,8,8,8,8,8,8,1') {
        throw Error('Unexpected source row counts: ' + sourceCounts);
      }
      const output = document.createElement('canvas'); output.width = 192; output.height = 216;
      const out = output.getContext('2d'); out.imageSmoothingEnabled = false;
      const frames = groups.flat().map((box, frame) => {
        const regular = frame < 52 && frame % 2 === 0;
        const boulder = frame < 52 && frame % 2 === 1;
        const scale = Math.min((regular ? 22 : 21) / box.w, (regular ? 14 : 21) / box.h);
        const width = Math.round(box.w * scale), height = Math.round(box.h * scale);
        const x = frame % 8 * 24 + Math.floor((24 - width) / 2);
        const y = Math.floor(frame / 8) * 24 + 22 - height;
        out.drawImage(canvas, box.x, box.y, box.w, box.h, x, y, width, height);
        return { frame, kind: regular ? 'regular' : boulder ? 'boulder' : 'signature',
          width, height, sourceBounds: box };
      });
      for (let frame = 0; frame < 52; frame += 2) {
        if (frames[frame + 1].height <= frames[frame].height) {
          throw Error('Boulder must be taller than regular rock: ' + frame);
        }
      }
      return { png: output.toDataURL().split(',')[1], frames, sourceCounts };
    }, 'data:image/png;base64,' + source.toString('base64'));
    fs.writeFileSync(path.join(__dirname, 'rocks-24.png'), Buffer.from(result.png, 'base64'));
    fs.writeFileSync(path.join(__dirname, 'export.json'), JSON.stringify(result.frames, null, 2) + '\n');
    console.log('Exported 65 sprites in an 8×9 atlas; all regular/boulder pairs retain their height distinction.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
