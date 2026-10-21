// Run against a local server: node test/scholar-lending-browser.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || '/usr/lib/chromium/chromium', headless: true,
    args: ['--no-sandbox', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
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
      const catalog = page.locator('[data-tome]');
      assert.equal(await catalog.count(), await page.evaluate(() => Macros.scholarCatalog(__scene.save).length),
        'every tome is in one scrollable shelf');
      assert.equal(await page.getByRole('button', { name: /^(Next|Previous)$/ }).count(), 0);
      await catalog.last().scrollIntoViewIfNeeded();
      assert.equal(await catalog.last().isVisible(), true);
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
          overflow: [...el.querySelectorAll('*')].some(x => x.clientWidth > 0 && x.scrollWidth > x.clientWidth + 2) };
      });
      assert.equal(geometry.doneVisible, true, 'Done stays inside the dialog');
      assert.equal(geometry.overflow, false, 'no horizontal overflow');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      assert.equal(await page.locator('#scholar-modal').count(), 0);
      await page.evaluate(() => { __scene.save.tipsRead = PLAY_TIPS.length; __scene._showBooksRead(); });
      const bookRows = page.locator('#books-modal .book-row');
      const titles = await bookRows.allTextContents();
      assert.equal(titles.length, await page.evaluate(() => PLAY_TIPS.length), 'every read page is in one shelf');
      assert.equal(await page.locator('#books-modal').getByRole('button', { name: /^(Next|Previous)$/ }).count(), 0);
      const scrolls = await page.locator('#books-modal').evaluate(el => [...el.querySelectorAll('*')].some(x =>
        x.clientHeight > 0 && x.scrollHeight > x.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(x).overflowY)));
      assert.equal(scrolls, true, 'the full book shelf scrolls');
      await bookRows.last().click();
      const backToBooks = page.getByRole('button', { name: 'Back to books', exact: true });
      await backToBooks.click();
      assert.deepEqual(await bookRows.allTextContents(), titles, 'rereading returns to the full shelf');
      await page.locator('#books-modal').getByRole('button', { name: 'Close', exact: true }).click();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Book Club lending passed at ${width}px`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
