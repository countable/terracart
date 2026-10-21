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
          assert(s.animations.every(a => a.duration === 24000 && a.iterations === 1));
          [1 / 1.45, 1 / 1.74, 1 / 2.088].forEach((zoom, i) => near(s.frames[i].scale, zoom));
          const dreamTime = progress => 750 + progress * 24000;
          for (const [progress, visible] of [[7 / 15, 0], [11 / 15, 1], [1, 2]]) {
            await seek(dreamTime(progress)); s = await state(); near(s.frames[visible].opacity, 1);
            assert(s.frames.slice(visible + 1).every(f => f.opacity < .0001));
          }
          let previousScale = 1;
          for (let step = 1; step <= 100; step++) {
            const progress = step / 100;
            await seek(dreamTime(progress)); s = await state();
            assert(s.scale > previousScale, 'zoom continues through every frame and the final fade');
            previousScale = s.scale;
            if (progress > .2 && progress < 1) {
              assert(s.frames.some(f => f.opacity > 0 && f.opacity < 1), 'a fade stays active throughout the final 80 percent');
            }
          }
          // At every fade sample, an incoming crop must cover the whole
          // original image area; otherwise the older frame leaks at its edge.
          for (const progress of [.201, 1 / 3, .467, .6, .734, 13 / 15, 1]) {
            await seek(dreamTime(progress)); s = await state();
            for (const frame of s.frames) if (frame.opacity > 0) {
              assert(s.scale * frame.scale >= .999, 'visible intrinsic crop covers the scene');
            }
          }
          if (width === 390) {
            for (const time of [11000, 17000, 24000]) {
              await seek(time); await snapshot(`dream-${time}`);
            }
          }
          for (const [progress, frame] of [[1 / 3, 0], [.6, 1], [13 / 15, 2]]) {
            await seek(dreamTime(progress)); near((await state()).frames[frame].opacity, .5);
          }
          await seek(dreamTime(1)); near((await state()).scale, 3.3);
          await seek(40000); s = await state(); near(s.scale, 3.3); near(s.frames[2].opacity, 1);
          const coverage = await page.evaluate(() => {
            const scene = document.querySelector('.nightmare-scene');
            const bounds = scene.getBoundingClientRect();
            const final = scene.querySelector('img:last-child').getBoundingClientRect();
            const style = getComputedStyle(scene);
            return { clipped: style.overflowX === 'hidden' && style.overflowY === 'hidden',
              covers: final.left <= bounds.left + 1 && final.top <= bounds.top + 1
                && final.right >= bounds.right - 1 && final.bottom >= bounds.bottom - 1 };
          });
          assert(coverage.clipped, 'older zoomed paintings cannot spill into the portrait letterbox');
          assert(coverage.covers, 'the final painting covers the entire clipped portrait canvas');
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
