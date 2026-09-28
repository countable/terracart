#!/usr/bin/env node
// Render-loop profile: boots the real game headless (test/perf.html, sandbox
// world, TEST_MODE) and prints what one frame costs — the in-game profiler's
// per-pass timings (window.__boot: 'update (all)', 'drawCells', 'phaser
// render', the @crossing variants, 'fog paint', the overlay rebuilds), the
// drawObjects scan counts, the size of every Graphics command buffer Phaser
// replays per frame, the pool sizes, and a CDP CPU profile with Phaser-
// internal time attributed back to the nearest call site of ours.
//
// Phases: standing still, walking a square (the fix moved at the
// DEBUG keyboard's pace), then standing on a real street while it restores
// (the recorded fixture tiles — the sandbox has no road lines). A crop check
// compares both render passes with a small farm and 10,000 distant crops.
// Runtime errors and crop work-count regressions exit nonzero. Timings are
// reported for comparison, without machine-dependent pass/fail thresholds.
// The baseline and the reading of it are in
// test/findings/render-loop-audit-2026-09-06.md.
//
//   npm install                       # playwright-core (devDependency)
//   node tools/perf_loop.js [out.json]
//
// Env: PW_CHROMIUM=/path/to/chrome to use a specific binary (the remote
// sandbox has one at /opt/pw-browsers/chromium); IDLE_MS / WALK_MS to change
// the phase lengths, WALK_SPEED_MPS the walk's pace (default 10), RESTORE_MS
// the street-restore phase (0 skips it); PORT for the static server (default 7731).
//
// Read the numbers with the caveats in the findings doc: under headless
// SwiftShader the frame GAPS are meaningless (rAF runs at ~15 Hz) — the
// per-pass timings and their relative shares are what to compare.
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright-core'));

const PORT = +(process.env.PORT || 7731);
const OUT = process.argv[2] || '';
const IDLE_MS = +(process.env.IDLE_MS || 6000);
const WALK_MS = +(process.env.WALK_MS || 8000);
const RESTORE_MS = +(process.env.RESTORE_MS ?? 8000);
const RESTORE_SETTLE_MS = +(process.env.RESTORE_SETTLE_MS || 15000);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function collectErrors(page, errors, prefix = '') {
  page.on('pageerror', e => errors.push(prefix + String(e)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text(), url = message.location().url || '';
    // The offline harness deliberately refuses tiles outside its fixture ring.
    // Only that network noise is expected; JavaScript errors still fail the run.
    if (/^Failed to load resource:.*\b(?:404|504)\b/.test(text) &&
        (/\/test\/fixtures\//.test(url) || /tiles\.openfreemap\.org\//.test(url))) return;
    errors.push(prefix + text + (url ? ` (${url})` : ''));
  });
}

function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((r) => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

async function main() {
  const srv = await serve();
  let browser;
  try {
    const launch = { headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
    if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
    browser = await chromium.launch(launch);
    await profile(browser);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => srv.close(resolve));
  }
}

async function profile(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  collectErrors(page, errs);
  await page.goto(`http://127.0.0.1:${PORT}/test/perf.html?sandbox=true&overpass=off`, { timeout: 60000 });
  await page.evaluate(() => window.__perfReady);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });

  await page.evaluate(() => window.__boot.reset());
  await cdp.send('Profiler.start');
  await page.waitForTimeout(IDLE_MS);
  const idleProf = (await cdp.send('Profiler.stop')).profile;
  const idle = await page.evaluate(() => window.__perfSnap());

  await page.evaluate(() => window.__boot.reset());
  await cdp.send('Profiler.start');
  // Walk a square by moving the FIX, the way a GPS update does. (This used
  // to hold WASD down, but the keyboard walk is gated on app.js DEBUG, which
  // ships false — so the "walking" phase stood still and never exercised
  // the crossing rebuilds: fog, road and building canvases, tile scans.)
  // WALK_SPEED_MPS is the DEBUG keyboard's pace, so a phase crosses cells
  // often enough to measure the per-crossing passes.
  const WALK_SPEED_MPS = +(process.env.WALK_SPEED_MPS || 10);
  await page.evaluate(({ ms, v }) => {
    const s = window.__scene;
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const t0 = performance.now();
    let last = t0;
    window.__perfWalk = setInterval(() => {
      const now = performance.now();
      const d = dirs[Math.min(3, Math.floor((now - t0) / (ms / 4)))];
      const step = v * (now - last) / 1000;
      last = now;
      s.playerM.x += d[0] * step;
      s.playerM.y += d[1] * step;
      if (s.syncMoveTarget) s.syncMoveTarget();
    }, 50);
  }, { ms: WALK_MS, v: WALK_SPEED_MPS });
  await page.waitForTimeout(WALK_MS);
  await page.evaluate(() => clearInterval(window.__perfWalk));
  const walkProf = (await cdp.send('Profiler.stop')).profile;
  const walk = await page.evaluate(() => window.__perfSnap());

  // Exercise the shipping render paths, including the first index build.
  // Synchronous samples keep camera position and gameplay mutations fixed.
  const farm = await page.evaluate(() => {
    const s = window.__scene, B = window.__boot;
    const original = s.save.planted;
    const anchor = viewAnchorWorldM(s);
    const local = Array.from({ length: 4 }, (_, i) => ({
      x: anchor.x + (i % 2) * s.cellM,
      y: anchor.y + Math.floor(i / 2) * s.cellM,
      crop: 'potato', stage: MAX_GROWTH_STAGE, watered_t: 0, depth: s.depth || 0,
    }));
    const sample = (planted) => {
      s.save.planted = planted;
      B.reset();
      const coldStart = performance.now();
      s.drawCells(); s.drawObjects();
      const coldMs = performance.now() - coldStart;
      const rebuilt = B.counts['crop index rebuild entries']?.sum;
      B.reset();
      const frames = 40, start = performance.now();
      for (let i = 0; i < frames; i++) { s.drawCells(); s.drawObjects(); }
      return { crops: planted.length, frames, coldMs, rebuilt,
        warmMsPerFrame: (performance.now() - start) / frames,
        candidates: B.counts['crop candidates'],
        warmRebuilt: B.counts['crop index rebuild entries']?.sum };
    };
    try {
      const small = sample(local);
      const large = sample(local.concat(Array.from({ length: 10000 }, (_, i) => ({
        ...local[0], x: anchor.x + 100000 + i * s.cellM,
      }))));
      if (!small.candidates || small.candidates.n !== small.frames * 2 ||
          small.candidates.sum <= 0 || large.candidates?.n !== large.frames * 2 ||
          large.candidates.sum !== small.candidates.sum ||
          small.warmRebuilt !== 0 || large.warmRebuilt !== 0 ||
          small.rebuilt !== small.crops || large.rebuilt !== large.crops) {
        throw new Error('Crop work regression: ' + JSON.stringify({ small, large }));
      }
      return { small, large };
    } finally {
      s.save.planted = original;
    }
  });

  // ── RESTORE: stand on a real street while it rebuilds ──────────────────
  // The sandbox carries no transportation lines, so nothing restores there;
  // this phase loads a second page on the recorded tiles (perf.html
  // ?fixtures=1), puts the FEET on the nearest road cell and stands. The
  // dwell ripens, Streets.restore fires, the epoch bump repaints the road
  // overlay's restored canvas (its 'road overlay rebuild' tick) and the
  // lamps light. The street functions are timed directly on top.
  let restore = null, restoreProf = null, restoreStats = null;
  if (RESTORE_MS > 0) {
    const rp = await browser.newPage({ viewport: { width: 390, height: 844 } });
    collectErrors(rp, errs, '[restore] ');
    await rp.goto(`http://127.0.0.1:${PORT}/test/perf.html?fixtures=1&overpass=off`, { timeout: 60000 });
    await rp.evaluate(() => window.__perfReady);
    const at = await rp.evaluate(() => {
      const s = window.__scene, pc = s.playerToWorldCell();
      const e = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
      if (!e || !e.roadMask) return null;
      const n = Math.round(Math.sqrt(e.roadMask.length));
      let best = null;
      for (let i = 0; i < e.roadMask.length; i++) {
        if (!e.roadMask[i]) continue;
        const cx = i % n, cy = (i / n) | 0, d = (cx - pc.cx) ** 2 + (cy - pc.cy) ** 2;
        if (!best || d < best.d) best = { cx, cy, d };
      }
      if (!best) return null;
      const m = tileCellCenterMeters(s, pc.tx, pc.ty, best.cx, best.cy);
      s.playerM.x = m.x - s.startWorldM.x;
      s.playerM.y = m.y - s.startWorldM.y;
      if (s.syncMoveTarget) s.syncMoveTarget();
      return Math.sqrt(best.d);
    });
    if (at == null) {
      errs.push('[restore] no road cell on the start tile');
    } else {
      // The boot's idle prewarm (app.js _prewarmFx) is skipped in test
      // mode like the icon one beside it; run it, as a real session has.
      await rp.evaluate(() => window.__scene._prewarmFx && window.__scene._prewarmFx());
      // Let the recorded world finish building first: the neighbour ring
      // rasterizes in the background for several seconds on these tiles, and
      // a phase that overlaps it measures tile builds, not the street.
      await rp.waitForTimeout(RESTORE_SETTLE_MS);
      await rp.evaluate(() => {
        window.__boot.reset();
        const s = window.__scene;
        const st = window.__streetT = { restores: 0, metres: 0, fns: {} };
        for (const fn of ['_sweepStreets', '_rescanStreets', '_ripenStreets', '_updateStreetLamps', '_blastAt', '_toast']) {
          if (typeof s[fn] !== 'function') continue;
          const orig = s[fn].bind(s), rec = st.fns[fn] = { n: 0, sum: 0, worst: 0 };
          s[fn] = function (...a) {
            const t = performance.now(); const r = orig(...a); const ms = performance.now() - t;
            rec.n++; rec.sum += ms; if (ms > rec.worst) rec.worst = ms; return r;
          };
        }
        // update() sweeps the streets only outside __TEST_MODE (the block
        // that also holds the passive rests), and perf.html runs in test
        // mode — so the harness calls the real sweep at the loop's own cadence
        // (FPS_LIMIT, 30) instead.
        window.__perfSweep = setInterval(() => s._sweepStreets(), 1000 / 30);
        const orig = Streets.restore;
        Streets.restore = function (...a) {
          const r = orig.apply(this, a);
          if (r && r.addedM > 0) { st.restores++; st.metres += r.addedM; }
          return r;
        };
      });
      const rcdp = await rp.context().newCDPSession(rp);
      await rcdp.send('Profiler.enable');
      await rcdp.send('Profiler.setSamplingInterval', { interval: 250 });
      await rcdp.send('Profiler.start');
      await rp.waitForTimeout(RESTORE_MS);
      await rp.evaluate(() => clearInterval(window.__perfSweep));
      restoreProf = (await rcdp.send('Profiler.stop')).profile;
      restore = await rp.evaluate(() => window.__perfSnap());
      restoreStats = await rp.evaluate(() => window.__streetT);
      restoreStats.movedCells = at;
    }
  }

  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ idle, walk, farm, restore, restoreStats, errs, idleProf, walkProf, restoreProf }));
  print('STANDING STILL', idle, idleProf);
  print('WALKING', walk, walkProf);
  console.log('\nCROP SCALING (two render passes per frame):');
  for (const sample of [farm.small, farm.large]) {
    console.log(`  ${sample.crops} crops: ${sample.candidates.sum / sample.frames} candidates/frame, ` +
      `${sample.coldMs.toFixed(2)} ms cold, ${sample.warmMsPerFrame.toFixed(3)} ms/frame warm, ` +
      `${sample.warmRebuilt} entries rebuilt warm`);
  }
  if (restore) {
    print('RESTORING A STREET (recorded tiles)', restore, restoreProf);
    console.log(`street restores: ${restoreStats.restores} (${restoreStats.metres.toFixed(0)} m) — feet moved ${restoreStats.movedCells.toFixed(1)} cells onto the road`);
    for (const [k, v] of Object.entries(restoreStats.fns)) {
      console.log(`  ${k.padEnd(20)} ${(v.sum / Math.max(1, v.n)).toFixed(3)} / ${v.worst.toFixed(2)} ms  (${v.n})`);
    }
  }
  if (errs.length) throw new Error('Browser runtime errors:\n' + errs.slice(0, 10).join('\n'));
}

// ── CPU-profile digestion ─────────────────────────────────────────────────
function fnKey(n) {
  const f = n.callFrame;
  const url = (f.url || '').replace(/^.*\//, '').replace(/\?.*$/, '');
  return `${f.functionName || '(anon)'} ${url}:${f.lineNumber + 1}`;
}
function digest(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
  const self = new Map(), incl = new Map();
  let total = 0, idle = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i], ms = (profile.timeDeltas[i] || 0) / 1000;
    total += ms;
    const k0 = fnKey(byId.get(id));
    if (k0.startsWith('(idle)')) { idle += ms; continue; }
    self.set(k0, (self.get(k0) || 0) + ms);
    let cur = id; const seen = new Set();
    while (cur != null) {
      const k = fnKey(byId.get(cur));
      if (!seen.has(k)) { incl.set(k, (incl.get(k) || 0) + ms); seen.add(k); }
      cur = parent.get(cur);
    }
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { busy: total - idle, selfTop: top(self, 30), inclTop: top(incl, 40), byId, parent, profile };
}
// Attribute a Phaser-internal function's samples to the nearest ancestor of ours.
function callersOf(d, fn) {
  const out = new Map();
  const { profile, byId, parent } = d;
  for (let i = 0; i < profile.samples.length; i++) {
    let cur = profile.samples[i], hit = false;
    const ms = (profile.timeDeltas[i] || 0) / 1000;
    while (cur != null) {
      const k = fnKey(byId.get(cur));
      if (!hit && k === fn) hit = true;
      else if (hit && !/phaser\.js|:0$/.test(k)) { out.set(k, (out.get(k) || 0) + ms); break; }
      cur = parent.get(cur);
    }
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

function print(label, snap, prof) {
  const o = snap.objs;
  console.log(`\n===== ${label} =====  ${snap.renderer}, ${o.tiles} tiles, ${o.objects} objects, ${o.wildplants} wildplants, ${o.creatures} creatures, display list ${snap.disp.deep}`);
  console.log(`${snap.live.n} frames (headless cadence — ignore the gaps)`);
  console.log('per-frame passes (avg ms / worst ms / calls):');
  for (const [n, w] of Object.entries(snap.work).sort((a, b) => b[1].sum - a[1].sum)) {
    console.log(`  ${n.padEnd(26)} ${(w.sum / w.n).toFixed(2).padStart(7)} / ${w.worst.toFixed(1).padStart(6)}  (${w.n})`);
  }
  for (const [n, c] of Object.entries(snap.counts)) console.log(`  ${n.padEnd(26)} ${(c.sum / c.n).toFixed(1).padStart(7)} / ${String(c.worst).padStart(6)}  (count)`);
  console.log('Graphics command buffers replayed by Phaser every frame (entries):');
  console.log('  ' + Object.entries(o.gfx).filter(([, g]) => g.len).map(([n, g]) => `${n}=${g.len}${g.arcs ? ` (${g.arcs} arcs)` : ''}`).join('  '));
  console.log('pools: ' + Object.entries(o.pools).map(([n, v]) => `${n}=${v}`).join(' '));
  const d = digest(prof);
  console.log(`CPU busy ${d.busy.toFixed(0)} ms over ${snap.live.n} frames = ${(d.busy / snap.live.n).toFixed(2)} ms/frame`);
  console.log(' self time:');
  for (const [k, ms] of d.selfTop.slice(0, 18)) console.log(`   ${(ms / d.busy * 100).toFixed(1).padStart(5)}%  ${ms.toFixed(0).padStart(5)} ms  ${k}`);
  console.log(' inclusive:');
  for (const [k, ms] of d.inclTop.slice(0, 28)) if (!/\(root\)/.test(k)) console.log(`   ${(ms / d.busy * 100).toFixed(1).padStart(5)}%  ${ms.toFixed(0).padStart(5)} ms  ${k}`);
  console.log(' Phaser internals, attributed to our call sites:');
  for (const fn of ['batchFillPath phaser.js:1', 'get phaser.js:1', 'setFrame phaser.js:1', 'play phaser.js:1', 'updateText phaser.js:1', '(garbage collector) :0']) {
    const c = callersOf(d, fn);
    if (c.length) console.log(`   ${fn.replace(' phaser.js:1', '')}: ` + c.slice(0, 5).map(([k, ms]) => `${k}=${ms.toFixed(0)}ms`).join(' | '));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
