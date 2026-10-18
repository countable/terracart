// Repack approved native 24px cells without resampling their artwork.
// CHROMIUM_PATH=/usr/bin/chromium node assets/Objects/CelProps/export.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const groups = {
  bushes: [0, 1, 2, 3, 4, 5, 6, 7],
  bramble: [16, 17, 18, 19],
  clipped: [20, 21, 22, 23, 28, 29, 30, 31],
  barrels: [48, 49, 50, 51, 52, 53, 54, 55],
  pots: [56, 58, 60, 62],
  'pots-smashed': [57, 59, 61, 63],
  palms: [null, null, 24, 25, 26, 27],
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true });
  try {
    const page = await browser.newPage();
    const png = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    const outputs = await page.evaluate(async ({ source, palms, groups }) => {
      const load = async src => { const i = new Image(); i.src = src; await i.decode(); return i; };
      const sheet = await load(source), oldPalms = await load(palms);
      if (sheet.width !== 192 || sheet.height !== 192) throw Error('Expected approved 8×8 native study');
      return Object.fromEntries(Object.entries(groups).map(([name, frames]) => {
        const c = document.createElement('canvas'); c.width = frames.length * 24; c.height = 24;
        const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
        frames.forEach((f, n) => {
          if (f == null) ctx.drawImage(oldPalms, n * 24, 0, 24, 24, n * 24, 0, 24, 24);
          else ctx.drawImage(sheet, f % 8 * 24, Math.floor(f / 8) * 24, 24, 24, n * 24, 0, 24, 24);
        });
        return [name, c.toDataURL().split(',')[1]];
      }));
    }, { source: png(path.join(__dirname, 'approved-study-24.png')), palms: png(path.join(__dirname, '../Beach/palms-24.png')), groups });
    for (const [name, data] of Object.entries(outputs)) fs.writeFileSync(path.join(__dirname, name + '.png'), Buffer.from(data, 'base64'));
    fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify({ frameWidth: 24, frameHeight: 24, source: 'approved-study-24.png', groups }, null, 2) + '\n');
    console.log('Exported ' + Object.keys(outputs).length + ' native 24px prop atlases.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
