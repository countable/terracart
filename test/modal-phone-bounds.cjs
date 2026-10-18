// TEST_URL=http://127.0.0.1:8000/ node test/modal-phone-bounds.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await page.addInitScript(() => {
      window.__TEST_MODE = true;
      document.addEventListener('DOMContentLoaded', () => {
        window.phoneDialogs = ['bootload', 'story', 'howto', 'tooshort', 'locating']
          .map(id => document.getElementById(id)?.cloneNode(true)).filter(Boolean);
      });
    });
    await page.goto((process.env.TEST_URL || 'http://127.0.0.1:8000/') + '?sandbox=true');
    for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      const results = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const left = parseFloat(root.getPropertyValue('--phone-left')) || 0;
        const right = innerWidth - (parseFloat(root.getPropertyValue('--phone-right')) || 0);
        return window.phoneDialogs.flatMap(template => {
          document.getElementById(template.id)?.remove();
          const modes = template.id === 'story' ? ['story-fullscreen', 'compass-story'] : [''];
          return modes.map(mode => {
            const dialog = template.cloneNode(true);
            if (mode) dialog.className = mode;
            dialog.style.display = 'flex';
            document.body.append(dialog);
            const rect = dialog.getBoundingClientRect();
            const boxes = [...dialog.querySelectorAll('.box')].map(box => {
              box.style.animation = 'none';
              const r = box.getBoundingClientRect();
              return r.left >= left - 1 && r.right <= right + 1;
            });
            const rail = mode === 'compass-story' ? parseFloat(getComputedStyle(dialog.querySelector('.box'), '::before').height) : null;
            dialog.remove();
            return { id: template.id + ' ' + mode,
              contained: Math.abs(rect.left - left) < 1 && Math.abs(rect.right - right) < 1 && boxes.every(Boolean),
              railFits: rail === null || Math.abs(rail - (right - left) * 220 / 750) < 1 };
          });
        });
      });
      assert(results.some(row => row.id.startsWith('story')), 'opening dialog exercised');
      for (const result of results) assert(result.contained && result.railFits, `${width}×${height}: ${JSON.stringify(result)}`);
      console.log(`${width}×${height}: ${results.length} standalone dialog variants fit the phone`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
