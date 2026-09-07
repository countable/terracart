#!/usr/bin/env node
// Render-loop profile: boots the real game headless (test/perf.html, sandbox
// world, TEST_MODE) and prints what one frame costs — the in-game profiler's
// per-pass timings (window.__boot: 'update (all)', 'drawCells', 'phaser
// render', the @crossing variants, 'fog paint', the overlay rebuilds), the
// drawObjects scan counts, the size of every Graphics command buffer Phaser
// replays per frame, the pool sizes, and a CDP CPU profile with Phaser-
// internal time attributed back to the nearest call site of ours.
//
// Two phases: standing still, then walking a square at the DEBUG keyboard
// speed. The baseline and the reading of it are in
// test/findings/render-loop-audit-2026-09-06.md.
//
//   npm install                       # playwright-core (devDependency)
//   node tools/perf_loop.js [out.json]
//
// Env: PW_CHROMIUM=/path/to/chrome to use a specific binary (the remote
// sandbox has one at /opt/pw-browsers/chromium); IDLE_MS / WALK_MS to change
// the phase lengths; PORT for the static server (default 7731).
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

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
  const launch = { headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/test/perf.html?sandbox=true`, { timeout: 60000 });
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
  for (const key of 'DSAW') {
    await page.evaluate((k) => { const K = window.__scene.keys; for (const n of 'WASD') K[n].isDown = false; K[k].isDown = true; }, key);
    await page.waitForTimeout(WALK_MS / 4);
  }
  await page.evaluate(() => { const K = window.__scene.keys; for (const n of 'WASD') K[n].isDown = false; });
  const walkProf = (await cdp.send('Profiler.stop')).profile;
  const walk = await page.evaluate(() => window.__perfSnap());

  await browser.close();
  srv.close();
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ idle, walk, errs, idleProf, walkProf }));
  print('STANDING STILL', idle, idleProf);
  print('WALKING', walk, walkProf);
  if (errs.length) console.log('\nERRORS:\n' + errs.slice(0, 10).join('\n'));
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
