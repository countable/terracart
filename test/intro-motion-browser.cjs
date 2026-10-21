const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const output = process.env.OUTPUT_DIR || '/tmp/intro-motion-qa';
const near = (actual, expected) => assert(Math.abs(actual - expected) < .002, `${actual} ≈ ${expected}`);
(async () => {
  assert(!fs.readFileSync(path.join(root, 'assets/art/story_wrecks.webp')).equals(
    fs.readFileSync(path.join(root, 'assets/art/story_wrecks_frame2.webp'))), 'street fade needs distinct images');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      for (const reduced of [false, true]) {
        const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block',
          reducedMotion: reduced ? 'reduce' : 'no-preference' });
        await page.addInitScript(() => { window.__TEST_MODE = true; });
        await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8013/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#story-art img')?.complete);
        const ready = () => page.waitForFunction(() => [...document.querySelectorAll('#story-art img')]
          .every(img => img.complete && img.naturalWidth > 0));
        const next = async () => { await page.evaluate(() => document.getElementById('story-next').click()); await ready(); };
        const seek = async time => page.evaluate(time => {
          for (const animation of document.getElementById('story-art').getAnimations({ subtree: true })) {
            animation.pause(); animation.currentTime = time;
          }
        }, time);
        const snapshot = async name => {
          await page.locator('#story .box').evaluate(box => {
            for (const animation of box.getAnimations()) animation.finish();
          });
          const button = await page.locator('#story-next').evaluate(el => {
            const rect = el.getBoundingClientRect();
            return { visible: getComputedStyle(el).visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
              inside: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1 };
          });
          assert(button.visible && button.inside, `${width} ${name}: next action stays in viewport`);
          await page.screenshot({ path: path.join(output, `${width}-${reduced ? 'reduced' : 'motion'}-${name}.png`) });
        };
        const state = () => page.evaluate(() => {
          const art = document.getElementById('story-art');
          const camera = art.querySelector('.nightmare-camera, .wake-camera');
          const scale = element => new DOMMatrix(getComputedStyle(element).transform).a;
          return { scale: camera ? scale(camera) : 1,
            animations: art.getAnimations({ subtree: true }).map(a => ({name:a.animationName, duration:a.effect.getTiming().duration, iterations:a.effect.getTiming().iterations})),
            frames: [...art.querySelectorAll('.nightmare-frame, .story-frame-next')].map(el => ({opacity:+getComputedStyle(el).opacity, scale:scale(el)})) };
        });
        await next(); // Dragon war.
        await seek(0);
        let s = await state(); near(s.scale, 1);
        if (reduced) {
          assert.equal(s.animations.length, 0); assert(s.frames.every(f => f.opacity === 0));
        } else {
          assert(s.animations.every(a => a.duration === 16000 && a.iterations === 1));
          [1.05, 1.10, 1.15].forEach((zoom, i) => near(s.frames[i].scale, zoom));
          for (const [time, visible] of [[4750, 0], [8750, 1], [12750, 2]]) {
            await seek(time); s = await state(); near(s.frames[visible].opacity, 1);
            assert(s.frames.slice(visible + 1).every(f => f.opacity === 0));
          }
          await seek(16750); near((await state()).scale, 3);
          await seek(40000); s = await state(); near(s.scale, 3); near(s.frames[2].opacity, 1);
        }
        await snapshot('dream');
        await next(); // Hood in bed.
        await seek(0); s = await state(); near(s.scale, reduced ? 1 : 1.75);
        if (reduced) {
          assert.equal(s.animations.length, 0); assert(s.frames.every(f => f.opacity === 0));
        } else {
          assert.equal(s.animations.find(a => a.name === 'wake-pullback').duration, 14000);
          await seek(14750); near((await state()).scale, 1.25);
        }
        await snapshot('wake');
        await next(); // Ruined street.
        const differentPixels = await page.evaluate(() => {
          const images = [...document.querySelectorAll('#story-art img')];
          const samples = images.map(img => {
            const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          });
          return samples[0].some((value, i) => value !== samples[1][i]);
        });
        assert(differentPixels, 'street frames must decode to different pixels');
        await seek(0); near((await state()).frames[0].opacity, 0);
        await seek(1950); s = await state();
        if (reduced) { assert.equal(s.animations.length, 0); near(s.frames[0].opacity, 0); }
        else { assert(s.frames[0].opacity > .1 && s.frames[0].opacity < .9, 'street visibly crossfades'); }
        await seek(3150); near((await state()).frames[0].opacity, reduced ? 0 : 1);
        await snapshot('street');
        await page.close();
      }
      console.log(`${width}x${height}: dream progression, wake pullback, street fade and reduced motion passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
