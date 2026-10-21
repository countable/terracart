// Run against the local game: TEST_URL=http://127.0.0.1:8012/ node test/modal-layout-browser.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const env = { ...process.env }; delete env.DISPLAY;
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium',
    env, headless: true, args: ['--no-sandbox', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const [width, height] of (process.env.MODAL_DESKTOP_ONLY ? [[1280, 900]] : [[320, 568], [390, 844], [768, 1024], [1280, 900]])) {
      const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => { window.__TEST_MODE = true; });
      await page.goto((process.env.TEST_URL || 'http://127.0.0.1:8012/') + '?sandbox=true');
      await page.waitForFunction(() => window.__scene?.save, { timeout: 60000 });
      await page.evaluate(() => {
        window.staticDialogs = ['howto', 'story', 'bootload'].map(id => document.getElementById(id)?.cloneNode(true));
      });
      for (const kind of ['coins', 'relic', 'pick', 'offer', 'portrait', 'long-story', 'plain', 'square-story', 'square-night', 'square-long', 'portrait-art-long', 'wreck', 'book', 'long-speech', 'x-mark']) {
        await page.evaluate(kind => {
          const s = window.__scene;
          document.querySelectorAll('.game-modal').forEach(el => el.remove());
          const long = 'This is a longer description of a discovery, with enough words to explain its effect and how to use it. ';
          if (kind === 'wreck') s.showOfferModal({ kind: 'build', get: 'Restore a wreck', choices: Array.from({length: 24}, (_, i) => ({key: String(i), label: `Building ${i + 1}`, info: long})), cost: '25 wood', canAfford: true, onAccept: () => {} });
          if (kind === 'book') { const shell = s.makeModalShell('test-book', {kind:'story', bookPage:true}); shell.box.innerHTML = long.repeat(30) + '<button>Finish reading</button>'; shell.mount(); }
          if (kind === 'long-speech') s.showMessageModal({kind:'talk', kindLabel:'Tilly', body:long.repeat(30)});
          if (kind === 'x-mark') s.showChestRewardModal({name:'Buried treasure', sub:long.repeat(30)});
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
          if (kind === 'square-story') {
            s.showMessageModal({ title: 'Low Health', art: 'health_low',
              body: 'Rest here to recover.' });
          }
          if (kind === 'square-night') s.showMessageModal(RoadSafety.NIGHT_STORY);
          if (kind === 'plain') s.showMessageModal({ title: 'A long note', art: false, body: long.repeat(2) });
          if (kind === 'book') {
            const page = PLAY_TIPS.map((_, i) => i).sort((a, b) => bookPageHTML(b).length - bookPageHTML(a).length)[0];
            s.showMessageModal({ title: '', body: bookPageHTML(page), bookPage: true });
          }
          if (kind === 'menu') s._openMenuDialog();
          if (kind === 'restore-list') {
            const { box, mount } = s.makeModalShell('restore-test', { kind: 'restore', art: false, scroll: true });
            for (let i = 0; i < 30; i++) {
              const row = document.createElement('button');
              row.textContent = `Restore building ${i + 1}`;
              row.style.cssText = 'display:block;min-height:44px;margin:8px;';
              box.appendChild(row);
            }
            mount();
          }
        }, kind);
        // Measure final layout after the shell's entrance, even under renderer load.
        // Loading mosaics may loop forever; only finite dialog animations settle.
        await page.locator('.game-modal').evaluate(async wrap => {
          const animations = wrap.getAnimations({subtree: true}).filter(animation =>
            Number.isFinite(animation.effect.getComputedTiming().iterations));
          await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        if (kind === 'pick') {
          await page.getByRole('button', { name: 'Ring of Gathering', exact: true }).click();
          await page.waitForTimeout(100);
        }
        const measure = () => page.locator('.game-modal').evaluate(wrap => {
          const body = wrap.querySelector('.modal-copy'), content = wrap.querySelector('.modal-content');
          const box = wrap.querySelector('.modal-box').getBoundingClientRect();
          const pages = wrap.querySelector('.modal-pages');
          return {
            art: (() => {
              const layer = wrap.querySelector('.modal-art');
              if (!layer) return null;
              const style = getComputedStyle(layer);
              const bounds = wrap.querySelector('.modal-art-spacer').getBoundingClientRect();
              return { bottom: bounds.bottom, bodyTop: body.getBoundingClientRect().top,
                width: bounds.width, height: bounds.height, position: style.backgroundPosition,
                size: style.backgroundSize, story: wrap.dataset.kind === 'story', scrim: style.backgroundImage };
            })(),
            pages: !!pages,
            contentHeight: content.scrollHeight, bodyHeight: body.clientHeight,
            scroll: [...wrap.querySelectorAll('*')].filter(el => el.clientHeight && el.scrollHeight > el.clientHeight + 2
              && /auto|scroll/.test(getComputedStyle(el).overflowY)).map(el => el.className),
            box: {top:box.top,bottom:box.bottom,height:box.height,viewport:innerHeight,transform:getComputedStyle(wrap.querySelector('.modal-box')).transform},
            boxVisible: box.top >= -1 && box.bottom <= innerHeight + 1,
          };
        });
        const m = await measure();
        assert(m.scroll.every(name => name === 'modal-copy'), `${width} ${kind}: only copy scrolls ${JSON.stringify(m)}`);
        assert.equal(m.pages, false, `${width} ${kind}: no pagination controls`);
        assert(m.boxVisible, `${width} ${kind}: dialog fits screen ${JSON.stringify(m.box)}`);
        if (m.art) {
          assert.equal(m.art.position, '50% 0%', `${kind}: art preserves its top edge`);
          assert.equal(m.art.size, m.art.story ? 'cover' : '100% auto', `${kind}: width-fit art`);
          assert(m.art.height >= 60, `${kind}: art remains visible`);
          if (kind.startsWith('square-')) {
            assert(m.art.bottom <= m.art.bodyTop + 1, `${kind}: copy sits below art`);

            assert(m.art.height <= m.art.width + 1, `${kind}: visible art never stretches`);
            assert(!m.art.scrim.includes('gradient'), `${kind}: artwork has no dark copy scrim`);
          }
        }
        if (['long-story', 'plain', 'square-long', 'portrait-art-long', 'book', 'long-speech', 'x-mark', 'wreck'].includes(kind)) {
          assert(m.scroll.includes('modal-copy'), `${width} ${kind}: long copy scrolls`);
          await page.locator('.modal-copy').evaluate(el => { el.scrollTop = el.scrollHeight; });
          const lastButton = page.locator('.game-modal button').last();
          await lastButton.focus();
          const visible = await lastButton.evaluate(el => {
            const b = el.getBoundingClientRect(), p = el.closest('.modal-box').getBoundingClientRect();
            return b.top >= p.top - 1 && b.bottom <= p.bottom + 1;
          });
          assert(visible, `${kind}: final action is reachable by scrolling and focus`);
        }
        if (process.env.MODAL_SCREENSHOTS && width === 390 && ['relic', 'pick'].includes(kind)) {
          require('node:fs').mkdirSync(process.env.MODAL_SCREENSHOTS, { recursive: true });
          await page.screenshot({ path: `${process.env.MODAL_SCREENSHOTS}/${kind}.png` });
        }
        console.log(`${width}×${height} ${kind} passed`);
      }
      await page.evaluate(() => {
        document.querySelectorAll('.game-modal').forEach(el => el.remove());
        window.selectedRecipe = null;
        window.__scene.showOfferModal({ kind: 'forge', get: 'Copper bar', cost: '2 ore', canAfford: true,
          onAccept: () => { throw new Error('Selecting a recipe must not buy it'); },
          selector: { label: 'Bar', index: 0, options: ['Copper', 'Iron'].map(label => ({label,
            onSelect: () => { window.selectedRecipe = label; }})) } });
      });
      await page.getByRole('combobox', {name: 'Bar'}).selectOption('1');
      assert.equal(await page.evaluate(() => window.selectedRecipe), 'Iron', 'named selector opens the selected recipe');
      const standalone = await page.evaluate(() => {
        document.querySelectorAll('.game-modal').forEach(el => el.remove());
        const results = [];
        const root = getComputedStyle(document.documentElement);
        const left = parseFloat(root.getPropertyValue('--phone-left')) || 0;
        const right = innerWidth - (parseFloat(root.getPropertyValue('--phone-right')) || 0);
        for (const dialog of window.staticDialogs) {
          if (!dialog) continue;
          document.getElementById(dialog.id)?.remove();
          document.body.appendChild(dialog);
          dialog.style.display = 'flex';
          const bounds = dialog.getBoundingClientRect();
          results.push({ id: dialog.id + '-phone-bounds', fits: true,
            visible: Math.abs(bounds.left - left) < 1 && Math.abs(bounds.right - right) < 1 });
          if (dialog.id === 'howto') {
            dialog.querySelector('#howto-modes').hidden = false;
            dialog.querySelector('#howto-close').hidden = true;
            dialog.querySelector('#howto-skip').hidden = true;
            dialog.querySelector('#howto-mode-current').hidden = true;
          }
          if (dialog.id === 'story') {
            dialog.className = 'compass-story';
            dialog.querySelector('.box').style.animation = 'none';
            const art = dialog.querySelector('.art').getBoundingClientRect();
            const frame = dialog.querySelector('.box').getBoundingClientRect();
            results.push({ id: 'opening-story-art', fits: art.height > 0 && art.height <= art.width,
              visible: Math.abs(frame.width - (right - left)) < 1 && Math.abs(art.width - frame.width) < 1 });
            dialog.querySelector('p').textContent = STORY_SLIDES.filter(slide => !slide.fullscreen).sort((a, b) => b.text.length - a.text.length)[0].text;
          }
          for (const box of dialog.querySelectorAll('.box')) {
            if (!box.clientHeight) continue;
            const r = box.getBoundingClientRect();
            results.push({ id: dialog.id, fits: box.scrollHeight <= box.clientHeight + 2 && !['auto', 'scroll'].includes(getComputedStyle(box).overflowY),
              visible: r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= left - 1 && r.right <= right + 1 });
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
