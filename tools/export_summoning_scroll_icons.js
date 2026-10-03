// Stamp the game's unchanged blank scroll (Books frame 45) with native 16px
// SVG ink. Rebuild from repo root; existing parchment pixels remain exact.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const base = 'data:image/png;base64,' + fs.readFileSync('assets/Icons/RPG icons/Extras/Books.png').toString('base64');
    for (const name of ['Thunder', 'Raven', 'Skeleton', 'Wraith']) {
      const dir = 'assets/Icons/Items';
      const stamp = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(dir, name + 'ScrollStamp.svg')).toString('base64');
      const png = await page.evaluate(async ({ base, stamp }) => {
        const images = await Promise.all([base, stamp].map(async src => {
          const im = new Image(); im.src = src; await im.decode(); return im;
        }));
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(images[0], 0, 48, 16, 16, 0, 0, 16, 16);
        ctx.drawImage(images[1], 0, 0);
        return canvas.toDataURL('image/png');
      }, { base, stamp });
      fs.writeFileSync(path.join(dir, name + 'Scroll.png'), Buffer.from(png.split(',')[1], 'base64'));
    }
  } finally { await browser.close(); }
})();
