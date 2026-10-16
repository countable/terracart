// Run against the local game: TEST_URL=http://127.0.0.1:8012/ node test/shop-layout-browser.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const failures = [];
  try {
    for (const [width, height] of [[320, 568], [390, 844], [1280, 900]]) {
      const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => { window.__TEST_MODE = true; });
      await page.goto((process.env.TEST_URL || 'http://127.0.0.1:8012/') + '?sandbox=true');
      await page.waitForFunction(() => window.__scene?.save, { timeout: 60000 });
      const cases = await page.evaluate(() => {
        const save = __scene.save;
        Object.assign(save, { money: 1000, energy: 1, booksRead: 18, inv: [], selSlot: -1,
          foundWild: Object.fromEntries(ITEMS.map(i => [i.id, 1])), usedScrolls: ITEMS.filter(i => i.scroll).map(i => i.id) });
        return [...HOME_RECIPES.flatMap(r => [['home', r.id], ['home-receipt', r.id]]),
          ...BREW_RECIPES.flatMap(r => [['brew', r.id], ['brew-receipt', r.id]]),
          ...[...Shops.THEMES, 'book', 'pet'].map(theme => ['shop', theme]), ...Gear.smeltUnlockedBars().map(id => ['smelt', id]),
          ...['sell', 'sell-stock', 'market', 'castle', 'forge', 'trader', 'wizard', 'inn', 'guildhall', 'bank', 'curio', 'scholar', 'training'].map(k => [k, null])];
      });
      for (const [kind, id] of cases) {
        const label = `${width}×${height} ${kind}${id ? ':' + id : ''}`;
        try {
          await page.evaluate(({ kind: requestedKind, id }) => {
            const kind = requestedKind.replace('-receipt', '');
            document.querySelectorAll('.game-modal').forEach(el => el.remove());
            const s = __scene, house = { id: `layout-${kind}-${id}`, kind: 'house' }, done = () => {};
            s.save.inv = []; s.save.selSlot = -1;
            if (requestedKind.endsWith('-receipt')) {
              const recipe = (kind === 'home' ? HOME_RECIPES : BREW_RECIPES).find(r => r.id === id);
              s.save.inv = recipe.cost.map(r => ({ id: r.id, count: r.qty }));
            }
            const dress = { kind: 'trade', art: `booth_${kind}_intro` };
            if (kind === 'home') s.presentHomeCraft(0, 0, id);
            else if (kind === 'brew') s.presentBrewOffer(0, 0, house, done, id);
            else if (kind === 'shop') s.presentThemedShop(0, 0, { ...house, kind: 'npc', shopTheme: id }, done);
            else if (kind === 'smelt') s.presentSmeltOffer(0, 0, house, done, done, id);
            else if (kind === 'sell') s.presentHomeSell(0, 0);
            else if (kind === 'sell-stock') {
              s.save.inv = [{ id: 'growth_powder', count: 10 }]; s.save.selSlot = 0;
              s.presentHomeSell(0, 0);
            }
            else if (kind === 'market') s.presentMarketStandOffer(0, 0, { item: 'berry' });
            else if (kind === 'castle') s.presentCastleServiceOffer(0, 0, house);
            else if (kind === 'forge') s.presentBlacksmithOffer(0, 0, { kind: 'relic', slot: 'pickaxe', tier: 2 }, done, house);
            else if (kind === 'trader') s.presentTraderOffer(0, 0, house, done);
            else if (kind === 'wizard') s.presentWizardOffer(0, 0, done);
            else s[`_present${kind[0].toUpperCase() + kind.slice(1)}`](0, 0, house, dress);
          }, { kind, id });
          await page.waitForTimeout(100);
          if (kind.endsWith('-receipt')) {
            await page.locator('.game-modal').last().getByRole('button', { name: kind === 'home-receipt' ? 'Craft' : 'Brew', exact: true }).last().click();
            await page.waitForTimeout(100);
            assert.equal(await page.locator('.game-modal [role=status]').count(), 1, 'transaction receipt appears');
          }
          const wrap = page.locator('.game-modal').last();
          assert.equal(await wrap.count(), 1, 'presenter opens a dialog');
          const measure = () => wrap.evaluate(el => {
            const box = el.querySelector('.modal-box').getBoundingClientRect();
            const body = el.querySelector('.modal-body'), content = el.querySelector('.modal-content');
            const pages = el.querySelector('.modal-pages');
            return { visible: box.top >= -1 && box.bottom <= innerHeight + 1
                && box.left >= -1 && box.right <= innerWidth + 1,
              horizontal: [...el.querySelectorAll('*')].filter(x => x.clientWidth && x.scrollWidth > x.clientWidth + 2
                && !['hidden', 'clip'].includes(getComputedStyle(x).overflowX)
                && getComputedStyle(x).columnWidth === 'auto').map(x => x.className),
              scrolling: [...el.querySelectorAll('*')].filter(x => x.clientHeight && x.scrollHeight > x.clientHeight + 2
                && /auto|scroll/.test(getComputedStyle(x).overflowY)).map(x => x.className),
              paginated: pages && getComputedStyle(pages).display !== 'none',
              fits: content.scrollHeight <= body.clientHeight + 2 };
          });
          const m = await measure();
          if (process.env.SHOP_SCREENSHOT && width === 320 && kind === 'brew-receipt' && id === 'stoneskin_potion') {
            await page.screenshot({ path: process.env.SHOP_SCREENSHOT });
          }
          assert(m.visible, 'dialog stays inside viewport');
          assert.deepEqual(m.scrolling, [], 'no vertical scrollbars');
          assert.deepEqual(m.horizontal, [], 'no horizontal overflow');
          if (!['curio', 'scholar'].includes(kind)) {
            assert(!m.paginated && m.fits, `ordinary counter fits one page: ${JSON.stringify(m)}`);
          }
          // Every button/select must be reachable whole on at least one page.
          const reached = new Set();
          let turns = 0;
          while (true) {
            const controls = await wrap.evaluate(el => {
              const b = el.querySelector('.modal-body').getBoundingClientRect();
              return [...el.querySelectorAll('.modal-content button, .modal-content select')].map((x, i) => {
                const r = x.getBoundingClientRect();
                return { i, visible: r.width > 0 && r.height > 0 && r.left >= b.left - 1 && r.right <= b.right + 1
                  && r.top >= b.top - 1 && r.bottom <= b.bottom + 1, label: x.textContent };
              });
            });
            controls.filter(c => c.visible).forEach(c => reached.add(c.i));
            const next = wrap.getByRole('button', { name: 'Next page', exact: true });
            if (!(await next.isVisible()) || await next.isDisabled()) {
              assert.deepEqual(controls.filter(c => !reached.has(c.i)).map(c => c.label), [], 'all controls fully reachable');
              break;
            }
            assert(++turns < 50, 'finite page count');
            await next.click();
          }
        } catch (error) {
          failures.push(`${label}: ${error.message}`);
          console.error(failures.at(-1));
        }
      }
      assert.deepEqual(errors, [], `${width}: browser errors`);
      console.log(`${width}×${height}: audited ${cases.length} shop/venue states`);
      await page.close();
    }
    assert.equal(failures.length, 0, `${failures.length} shop layout failures (details above)`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
