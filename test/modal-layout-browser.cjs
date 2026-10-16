// Run against the local game: TEST_URL=http://127.0.0.1:8012/ node test/modal-layout-browser.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [1280, 900]]) {
      const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => { window.__TEST_MODE = true; });
      await page.goto((process.env.TEST_URL || 'http://127.0.0.1:8012/') + '?sandbox=true');
      await page.waitForFunction(() => window.__scene?.save, { timeout: 60000 });
      await page.evaluate(() => {
        window.staticDialogs = ['howto', 'story', 'bootload'].map(id => document.getElementById(id)?.cloneNode(true));
      });
      for (const kind of ['coins', 'relic', 'pick', 'offer', 'portrait', 'long-story', 'plain', 'acknowledge']) {
        await page.evaluate(kind => {
          const s = window.__scene;
          document.querySelectorAll('.game-modal').forEach(el => el.remove());
          const long = 'This is a longer description of a discovery, with enough words to explain its effect and how to use it. ';
          if (kind === 'coins') s.showChestRewardModal({ name: 'Coins', qty: '× 250', iconHTML: s.coinIconHTML(48) });
          if (kind === 'relic') s.showChestRewardModal({ name: 'Ring of Gathering', tier: 3,
            iconHTML: s.iconSpanHTML('coin_ring', 48), sub: 'Loose coins slide across the ground toward its golden band.' });
          if (kind === 'pick') s.showChestRewardModal({ name: 'Choose your reward', cards: true,
            actions: ['Wood Pickaxe', 'Ring of Gathering', 'Healing Potion'].map(name => ({ label: name,
              info: long, onClick: () => { window.picked = name; } })) });
          if (kind === 'offer') s.showOfferModal({ kind: 'shop', title: 'Supplies', get: 'Healing Potion',
            blurb: long, cost: '25 coins', canAfford: true, onAccept: () => {} });
          if (kind === 'portrait') s.showMessageModal({ kind: 'talk', kindLabel: 'Tilly', title: 'Neighbour',
            portrait: 'assets/Icons/coin.png', body: long.repeat(2) });
          if (kind === 'long-story') s.showMessageModal({ title: 'A long book', art: 'booth_home_craft', body: long.repeat(30) });
          if (kind === 'acknowledge') s.showMessageModal({ title: 'Read this first', body: long, mustAcknowledge: true });
          if (kind === 'plain') s.showMessageModal({ title: 'A long note', art: false, body: long.repeat(20) });
        }, kind);
        await page.waitForTimeout(350);
        if (kind === 'pick') {
          await page.getByRole('button', { name: 'Ring of Gathering', exact: true }).click();
          await page.waitForTimeout(100);
        }
        const measure = () => page.locator('.game-modal').evaluate(wrap => {
          const body = wrap.querySelector('.modal-body'), content = wrap.querySelector('.modal-content');
          const box = wrap.querySelector('.modal-box').getBoundingClientRect();
          return {
            scroll: [...wrap.querySelectorAll('*')].filter(el => el.clientHeight && el.scrollHeight > el.clientHeight + 2
              && /auto|scroll/.test(getComputedStyle(el).overflowY)).map(el => el.className),
            bodyFits: body.scrollHeight <= body.clientHeight + 2,
            boxVisible: box.top >= -1 && box.bottom <= innerHeight + 1
              && box.left >= -1 && box.right <= innerWidth + 1,
          };
        });
        const m = await measure();
        assert(m.boxVisible, `${width} ${kind}: dialog fits screen ${JSON.stringify(m)}`);
        // Main's compass sheets and speech bubbles have one content scroller.
        // Ordinary offers fit in full; long stories keep their natural scroll.
        assert(m.scroll.every(name => name === 'modal-body'), `${width} ${kind}: only body scrolls`);
        if (kind === 'offer') {
          assert.deepEqual(m.scroll, [], `${width} offer: no scrolling ${JSON.stringify(m)}`);
          assert(m.bodyFits, `${width} offer: content not clipped`);
        }
        if (['long-story', 'plain'].includes(kind)) {
          assert.deepEqual(m.scroll, ['modal-body'], `${width} ${kind}: long copy is scrollable`);
        }
        if (kind === 'portrait') {
          assert.equal(await page.locator('.speech-dialog .speech-speaker .modal-portrait').count(), 1);
          assert.equal(await page.getByRole('button', { name: 'Close panel', exact: true }).count(), 0);
        }
        if (kind === 'acknowledge') {
          assert.equal(await page.getByRole('button', { name: 'Close panel', exact: true }).count(), 0);
          await page.locator('#message-modal').click({ position: { x: 1, y: 1 }, force: true });
          assert.equal(await page.locator('#message-modal').count(), 1, 'mandatory acknowledgement survives backdrop click');
        }
        if (['portrait', 'long-story', 'plain', 'acknowledge'].includes(kind)) {
          const ok = page.getByRole('button', { name: kind === 'portrait' ? 'Got it' : 'OK', exact: true });
          await ok.scrollIntoViewIfNeeded();
          const visible = await ok.evaluate(el => {
            const b = el.getBoundingClientRect(), p = el.closest('.modal-body').getBoundingClientRect();
            return b.left >= p.left - 1 && b.right <= p.right + 1 && b.top >= p.top - 1 && b.bottom <= p.bottom + 1;
          });
          assert(visible, 'message action is reachable and whole');
          await ok.click();
          assert.equal(await page.locator('#message-modal').count(), 0);
        }
        if (process.env.MODAL_SCREENSHOTS && width === 390 && ['relic', 'pick'].includes(kind)) {
          require('node:fs').mkdirSync(process.env.MODAL_SCREENSHOTS, { recursive: true });
          await page.screenshot({ path: `${process.env.MODAL_SCREENSHOTS}/${kind}.png` });
        }
        console.log(`${width}×${height} ${kind} passed`);
      }
      const standalone = await page.evaluate(() => {
        document.querySelectorAll('.game-modal').forEach(el => el.remove());
        const results = [];
        for (const dialog of window.staticDialogs) {
          if (!dialog) continue;
          document.getElementById(dialog.id)?.remove();
          document.body.appendChild(dialog);
          dialog.style.display = 'flex';
          if (dialog.id === 'howto') {
            dialog.querySelector('#howto-modes').hidden = false;
            dialog.querySelector('#howto-close').hidden = true;
            dialog.querySelector('#howto-skip').hidden = true;
            dialog.querySelector('#howto-mode-current').hidden = true;
          }
          if (dialog.id === 'story') {
            dialog.querySelector('p').textContent = 'The long night is over. You wake beside the ruined street, with a compass in your hand and a whole neighbourhood waiting to be rebuilt.';
          }
          for (const box of dialog.querySelectorAll('.box')) {
            if (!box.clientHeight) continue;
            const r = box.getBoundingClientRect();
            results.push({ id: dialog.id, fits: box.scrollHeight <= box.clientHeight + 2,
              visible: r.top >= -1 && r.bottom <= innerHeight + 1 });
          }
          dialog.remove();
        }
        return results;
      });
      for (const item of standalone) assert(item.fits && item.visible, `${width}: ${JSON.stringify(item)}`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
