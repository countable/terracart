#!/usr/bin/env node
// Compare an old Lighting.coverFrame to the working tree in the SAME live
// sandbox and with the SAME Visibility implementation. Requires Chromium.
// node tools/benchmark-cover.js BASELINE_GIT_REF [output.json]
// PW_CHROMIUM=/usr/bin/chromium CPU_THROTTLE=4 SAMPLES=100 tune the run.
// Results measure coverFrame CPU work and Canvas2D commands, not GPU upload,
// complete frame time, or handset performance. Throttling is synthetic.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const ref = process.argv[2];
if (!ref) throw new Error('Usage: node tools/benchmark-cover.js BASELINE_GIT_REF [output.json]');
const output = path.resolve(process.argv[3] || '/tmp/cover-benchmark.json');
const baselineCommit = execFileSync('git', ['rev-parse', '--verify', ref], { cwd: ROOT, encoding: 'utf8' }).trim();
const oldSource = execFileSync('git', ['show', `${baselineCommit}:src/lighting.js`], { cwd: ROOT, encoding: 'utf8' });
const start = oldSource.indexOf('  function coverFrame(');
const end = oldSource.indexOf('\n  function draw(', start);
if (start < 0 || end < 0) throw new Error('Baseline must contain standalone coverFrame before draw');
const baseline = oldSource.slice(start, end).trim();
const samples = +(process.env.SAMPLES || 100), warmup = 24;
const throttle = +(process.env.CPU_THROTTLE || 1);
if (!(samples >= 10 && samples <= 1000 && throttle >= 1)) throw new Error('Invalid benchmark settings');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      localStorage.setItem('terracart.introSeen', '1'); sessionStorage.setItem('terracart.safetySeen', '1');
    });
    await ctx.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:8000') return route.abort();
      const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return route.fulfill({ status: 404, body: '' });
      }
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
        '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      return route.fulfill({ path: file, contentType: types[path.extname(file)] || 'application/octet-stream' });
    });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto('http://127.0.0.1:8000/index.html?sandbox=true&overpass=off', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__scene?.lightTex && window.__scene?.cellsPerTile, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const results = await page.evaluate(({ baseline, samples, warmup }) => {
      const old = (0, eval)('(' + baseline + ')');
      const s = __scene;
      s.scene.pause(); s.game.loop.stop();
      RoadSafety.isNight = () => false;
      const initial = playerWorldM(s), abs = worldMetersToAbsCell(s, initial.x, initial.y);
      const center = absCellCenterMeters(s, abs.cellIX, abs.cellIY), m = s.cellM;
      s.playerM.x = center.x - s.startWorldM.x; s.playerM.y = center.y - s.startWorldM.y;
      const pc = worldMetersToTileCell(s, center.x, center.y);
      const entries = [];
      for (let y = pc.ty - 1; y <= pc.ty + 1; y++) for (let x = pc.tx - 1; x <= pc.tx + 1; x++) {
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(x, y));
        if (entry) { entry.objects = []; entry.wildplants = []; entries.push(entry); }
      }
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
      if (!entry) throw new Error('Sandbox center tile is missing');
      const W = s.lightTex.width, H = s.lightTex.height;
      const versions = [{ name: 'before', fn: old }, { name: 'after', fn: Lighting.coverFrame }];
      const summarize = values => {
        const sorted = values.slice().sort((a, b) => a - b);
        return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
          minMs: sorted[0], maxMs: sorted.at(-1), samples: values.length, rawMs: values };
      };
      const results = [];
      for (const fixture of ['dense-surface', 'cave-walls']) {
        s.depth = fixture === 'cave-walls' ? 1 : 0;
        for (const e of entries) { e.depth = s.depth; e.objects = []; e.wildplants = []; }
        if (!s.depth) {
          for (let y = -12; y <= 12; y += 2) for (let x = -12; x <= 12; x += 2) {
            if (Math.abs(x) < 2 && Math.abs(y) < 2) continue;
            const i = (x + 12) / 2 + (y + 12) / 2 * 13;
            entry.objects.push({ id: 'benchmark-' + i, kind: i % 4 ? 'tree' : 'stronghold_wall',
              size: i % 3 ? 'large' : 'small', x: center.x + x * m, y: center.y + y * m });
          }
        }
        // Authored cave corridors, queried through the real world-cell transform.
        s.cellAt = (x, y) => {
          const c = worldMetersToAbsCell(s, x, y), dx = c.cellIX - abs.cellIX, dy = c.cellIY - abs.cellIY;
          const wall = s.depth && ((Math.abs(dx) === 3 && dy !== 1) || (dy === -4 && dx !== -1));
          return { loaded: true, type: wall ? WorldGen.T.CAVE_WALL : WorldGen.T.CAVE_FLOOR };
        };
        for (const mode of ['moving-retained-blockers', 'moving-cold', 'stationary-cached']) {
          for (const v of versions) { v.mask = undefined; v.values = []; }
          for (let i = -warmup; i < samples; i++) {
            // Repeat positions across versions, but alternate which one goes first.
            const order = Math.abs(i) % 2 ? versions.slice().reverse() : versions;
            for (const v of order) {
              s._coverLightMask = v.mask;
              const offset = mode !== 'stationary-cached' ? ((i + warmup) % 17) / 40 * m : 0;
              s.playerM.x = center.x - s.startWorldM.x + offset;
              s.playerM.y = center.y - s.startWorldM.y + offset * .37;
              s.game.loop.frame++;
              if (mode === 'moving-cold') Visibility.invalidate(s);
              if (mode === 'moving-retained-blockers') {
                // Clear source-ray cache equally for A/B without invalidating
                // the static blockers: the real within-cell walking path.
                s.playerM.x += .001; Visibility.revision(s); s.playerM.x -= .001;
              }
              const p = playerWorldM(s);
              const count = mode === 'stationary-cached' ? 2000 : 1;
              // Seed cache outside timing for the stationary case. Each version
              // retains its own mask; both versions share identical cover rules.
              if (mode === 'stationary-cached') v.fn(s, p.x, p.y, W, H);
              const t = performance.now();
              let mask;
              for (let n = 0; n < count; n++) mask = v.fn(s, p.x, p.y, W, H);
              const elapsed = (performance.now() - t) / count;
              v.mask = s._coverLightMask;
              if (i >= 0) v.values.push(elapsed);
            }
          }
          results.push({ fixture, mode, objects: entry.objects.length,
            before: summarize(versions[0].values), after: summarize(versions[1].values) });
        }
      }
      return { viewport: { width: innerWidth, height: innerHeight }, lightmap: { width: W, height: H },
        cellMeters: m, cellPixels: CELL_PX, samples, warmup, results,
        userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
    }, { baseline, samples, warmup });
    const sourceHash = name => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src', name))).digest('hex');
    const report = { baselineCommit, sourceHashes: { lighting: sourceHash('lighting.js'), visibility: sourceHash('visibility.js') }, workingTreeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      date: new Date().toISOString(), chromium: browser.version(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`, throttle, errors,
      methodology: 'Alternating paired A/B in paused live sandbox. Same current Visibility for both versions. Moving cold: invalidate visibility; moving retained: prime at a displaced source without blocker invalidation, restore source; measure coverFrame sight calculation and canvas paint commands, without pixel readback. Stationary: warmed cached coverFrame batches of 2000 calls; milliseconds per call. Warmup excluded. Cave terrain is a deterministic corridor fixture via cellAt; surface has 168 authored tree/wall objects. Software SwiftShader, no GPU upload or full-frame/FPS claim.', ...results };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ output, ...report, results: report.results.map(r => ({ ...r,
      before: { ...r.before, rawMs: undefined }, after: { ...r.after, rawMs: undefined } })) }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
