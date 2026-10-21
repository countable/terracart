// Run against a local server: node test/scholar-lending-browser.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    for (const width of [390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => { window.__TEST_MODE = true; });
      await page.goto((process.env.TEST_URL || 'http://127.0.0.1:8012/') + '?sandbox=true');
      await page.waitForFunction(() => window.__scene?.save, { timeout: 60000 });
      await page.evaluate(() => {
        const s = window.__scene;
        document.querySelectorAll('.game-modal').forEach(el => el.remove());
        Object.assign(s.save, { booksRead: 18, scholarLoans: {}, inv: [], selSlot: -1, tomeMagicCd: {} });
        s._presentScholar(0, 0, { id: 'lending-test' }, { kind: 'trade', art: 'booth_scholar_intro' });
      });
      const healing = page.locator('[data-tome="tome_healing"]');
      const borrow = healing.getByRole('button', { name: /^Borrow/ });
      for (let i = 0; i < 3; i++) await borrow.click();
      assert.equal(await page.locator('#scholar-credit').textContent(), '3 / 18 credits free · 15 on loan');
      assert.equal(await borrow.isDisabled(), true);
      const tomes = page.locator('[data-tome]');
      assert.equal(await tomes.count(), await page.evaluate(() => Macros.scholarCatalog(__scene.save).length), 'every tome appears in the full catalog');
      assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).count(), 0, 'catalog has no pagination');
      await tomes.last().scrollIntoViewIfNeeded();
      assert.equal(await tomes.last().isVisible(), true, 'last tome remains reachable');
      await page.getByRole('button', { name: 'On loan', exact: true }).click();
      assert.equal(await page.locator('[data-tome]').count(), 1);
      const until = await page.evaluate(() => {
        const until = Date.now() + 3600000;
        window.__scene.save.tomeMagicCd.tome_healing = until;
        return until;
      });
      await healing.getByRole('button', { name: /^Return/ }).click();
      assert.equal(await page.locator('#scholar-credit').textContent(), '8 / 18 credits free · 10 on loan');
      await borrow.click();
      assert.equal(await page.evaluate(() => window.__scene.save.tomeMagicCd.tome_healing), until);
      await healing.locator('summary').click();
      assert.match(await healing.textContent(), /Restores 32 HP/);
      const geometry = await page.locator('#scholar-modal').evaluate(el => {
        const box = el.querySelector('.modal-box').getBoundingClientRect();
        const done = [...el.querySelectorAll('button')].find(b => b.textContent === 'Done').getBoundingClientRect();
        return { doneVisible: done.top >= box.top && done.bottom <= box.bottom,
          overflow: [...el.querySelectorAll('*')].some(x => x.clientWidth > 0 && x.scrollWidth > x.clientWidth + 2),
          scroll: [...el.querySelectorAll('*')].some(x => x.clientHeight > 0 && x.scrollHeight > x.clientHeight + 2
            && /auto|scroll/.test(getComputedStyle(x).overflowY)) };
      });
      assert.equal(geometry.doneVisible, true, 'Done stays inside the dialog');
      assert.equal(geometry.overflow, false, 'no horizontal overflow');
      assert.equal(geometry.scroll, false, 'short filtered list fits without scrolling');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      assert.equal(await page.locator('#scholar-modal').count(), 0);
      await page.evaluate(() => { __scene.save.tipsRead = PLAY_TIPS.length; __scene._showBooksRead(); });
      const bookRows = page.locator('#books-modal .book-row');
      assert.equal(await bookRows.count(), await page.evaluate(() => PLAY_TIPS.length), 'every read book appears in the full shelf');
      assert.equal(await page.locator('#books-modal').getByRole('button', { name: 'Next', exact: true }).count(), 0, 'shelf has no pagination');
      const lastTitles = await bookRows.allTextContents();
      await bookRows.first().click();
      const backToBooks = page.getByRole('button', { name: 'Back to books', exact: true });
      await backToBooks.focus();
      await backToBooks.click();
      assert.deepEqual(await bookRows.allTextContents(), lastTitles, 'rereading returns to the full shelf');
      await page.locator('#books-modal').getByRole('button', { name: 'Close', exact: true }).click();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Book Club lending passed at ${width}px`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
