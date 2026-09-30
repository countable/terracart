#!/usr/bin/env node
// Cold live-map CPU profile. No fixtures or substituted tile responses.
// node tools/perf_live.js [output-directory] (default /tmp/perf-live)
// PW_CHROMIUM, PORT (0 = free port), IDLE_MS, WALK_MS, STREAM_MS tune runs.
// Optional FPS=N compares the existing ?fps=N game setting.
// Walking is 1.4 m/s. Streaming covers 1.25 tile widths at an accelerated
// pace to exercise new tile loads; it must not be read as normal walking.
// SwiftShader is software rendering: these CPU samples do not measure GPU
// load, device battery draw, or representative handset frame cadence.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || '/tmp/perf-live');
const durations = { idle: +(process.env.IDLE_MS || 8000), walking: +(process.env.WALK_MS || 20000), streaming: +(process.env.STREAM_MS || 20000) };
const fps = process.env.FPS;
if (fps !== undefined && (!Number.isFinite(+fps) || +fps < 0)) throw new Error('FPS must be a nonnegative number');
const tileRE = /\/\d+\/\d+\/\d+\.pbf(?:\?|$)/;

function digest(profile) {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const parents = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parents.set(c, n.id);
  const key = n => `${n.callFrame.functionName || '(anonymous)'} ${(n.callFrame.url || '').split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  const self = new Map(), inclusive = new Map();
  let sampledMs = 0, idleMs = 0;
  for (let i = 0; i < (profile.samples || []).length; i++) {
    const ms = (profile.timeDeltas[i] || 0) / 1000;
    let id = profile.samples[i];
    sampledMs += ms;
    if (nodes.get(id).callFrame.functionName === '(idle)') { idleMs += ms; continue; }
    const name = key(nodes.get(id));
    self.set(name, (self.get(name) || 0) + ms);
    const seen = new Set();
    while (id != null) {
      const name = key(nodes.get(id));
      if (!seen.has(name)) inclusive.set(name, (inclusive.get(name) || 0) + ms);
      seen.add(name);
      id = parents.get(id);
    }
  }
  const sorted = map => [...map].sort((a, b) => b[1] - a[1]).slice(0, 40);
  return { sampledMs, idleMs, busyMs: sampledMs - idleMs, self: sorted(self), inclusive: sorted(inclusive) };
}

async function snapshot(page) {
  return page.evaluate(() => {
    const s = window.__scene, B = window.__boot;
    const tiles = [...WorldGen.tileCache].map(([key, e]) => ({ key, status: e.status, grid: !!e.grid }));
    const pc = s.playerToWorldCell();
    const ring = [];
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const key = WorldGen.tileKey(pc.tx + x, pc.ty + y), e = WorldGen.tileCache.get(key);
      ring.push({ key, ready: !!(e && e.grid && e.status === 'ready') });
    }
    return { ...window.__perfSnap(), tiles, ring, playerTile: { tx: pc.tx, ty: pc.ty }, spans: B.spans.slice(), marks: B.marks.slice() };
  });
}

async function waitTiles(page) {
  await page.waitForFunction(() => {
    if (!window.__scene?.cellsPerTile) return false;
    const pc = window.__scene.playerToWorldCell();
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const e = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx + x, pc.ty + y));
      if (!e?.grid || e.status !== 'ready') return false;
    }
    return true;
  }, null, { timeout: 120000 });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    let file;
    try { file = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0])); }
    catch { res.writeHead(400); res.end(); return; }
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(+(process.env.PORT || 0), '127.0.0.1', resolve));
  const results = { environment: { browser: 'Chromium headless with SwiftShader flags', walkingMps: 1.4, fpsOverride: fps === undefined ? null : +fps, durations, note: 'Main-renderer JS CPU samples; GPU/battery power not measured. Fresh browser context, live network tiles. TEST_MODE direct-position movement excludes GPS, multiplayer, street restoration, rest and traps; Overpass disabled.' }, phases: {}, requests: [], pageErrors: [], consoleErrors: [] };
  let browser, phase = 'boot';
  try {
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', e => results.pageErrors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') results.consoleErrors.push({ text: m.text(), url: m.location().url }); });
    page.on('response', r => { if (tileRE.test(r.url())) results.requests.push({ phase, url: r.url(), status: r.status(), ok: r.ok() }); });
    page.on('requestfailed', r => { if (tileRE.test(r.url())) results.requests.push({ phase, url: r.url(), ok: false, error: r.failure()?.errorText }); });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    async function capture(name, action) {
      phase = name;
      if (name !== 'boot') await page.evaluate(() => { window.__boot.reset(); window.__boot.spans = []; window.__boot.marks = []; });
      const requestStart = results.requests.length;
      await cdp.send('Profiler.start');
      const start = Date.now();
      await action();
      const profile = (await cdp.send('Profiler.stop')).profile;
      const snap = await snapshot(page);
      const cpu = digest(profile);
      results.environment.renderer = snap.renderer;
      results.phases[name] = { elapsedMs: Date.now() - start, snapshot: snap, cpu, successfulTileResponses: results.requests.slice(requestStart).filter(r => r.ok).length };
      fs.writeFileSync(path.join(OUT, `${name}.cpuprofile`), JSON.stringify(profile));
      console.log(`${name} (${snap.renderer}): ${snap.work['update (all)']?.n || 0} game updates (${snap.live.n} rAF callbacks); CPU busy ${cpu.busyMs.toFixed(0)} ms; ${snap.tiles.filter(t => t.grid).length} ready tiles; ${results.phases[name].successfulTileResponses} successful live PBF responses`);
      console.log('  passes ms/call: ' + Object.entries(snap.work).sort((a, b) => b[1].sum - a[1].sum).slice(0, 10).map(([n, w]) => `${n}=${(w.sum / w.n).toFixed(2)}`).join(', '));
      for (const type of ['self', 'inclusive']) console.log(`  ${type}: ` + cpu[type].filter(([n]) => !n.startsWith('(root)')).slice(0, 8).map(([n, ms]) => `${n}=${ms.toFixed(0)}ms`).join(', '));
      fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    }
    await capture('boot', async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}/test/perf.html?live=1&overpass=off${fps === undefined ? '' : '&fps=' + encodeURIComponent(fps)}`,  { timeout: 120000 });
      await page.evaluate(() => window.__perfReady);
      await waitTiles(page);
    });
    await capture('idle', () => page.waitForTimeout(durations.idle));
    async function move(ms, speed) {
      await page.evaluate(({ ms, speed }) => new Promise(resolve => {
        const s = window.__scene, start = performance.now();
        let last = start;
        const timer = setInterval(() => {
          const now = Math.min(performance.now(), start + ms);
          s.playerM.x += speed * (now - last) / 1000;
          s.syncMoveTarget?.();
          last = now;
          if (now >= start + ms) { clearInterval(timer); resolve(); }
        }, 50);
      }), { ms, speed });
    }
    await capture('walking', () => move(durations.walking, 1.4));
    const startTile = results.phases.walking.snapshot.playerTile;
    const speed = await page.evaluate(ms => window.__scene.tileEdgeM * 1.25 / (ms / 1000), durations.streaming);
    results.environment.streamingMps = speed;
    results.environment.streamingLabel = 'Accelerated 1.25-tile eastbound route plus wait for complete destination 3x3 ring';
    await capture('streaming', async () => { await move(durations.streaming, speed); await waitTiles(page); });
    const finalTile = results.phases.streaming.snapshot.playerTile;
    const failures = [];
    if (!results.requests.some(r => r.ok)) failures.push('No real successful PBF responses');
    if (results.requests.some(r => !r.ok)) failures.push('Failed live PBF requests (see results.requests)');
    if (!results.phases.streaming.successfulTileResponses) failures.push('Streaming did not fetch new live tiles');
    if (startTile.tx === finalTile.tx && startTile.ty === finalTile.ty) failures.push('Streaming did not cross a tile boundary');
    if (results.pageErrors.length) failures.push('Browser JavaScript errors');
    const runtimeConsoleErrors = results.consoleErrors.filter(e => !(e.url.endsWith('/favicon.ico') && /Failed to load resource:.*404/.test(e.text)));
    if (runtimeConsoleErrors.length) failures.push('Browser console errors (see results.consoleErrors)');
    if (results.phases.streaming.snapshot.ring.some(t => !t.ready)) failures.push('Missing destination tiles');
    results.validation = { passed: failures.length === 0, failures };
    if (failures.length) throw new Error(failures.join('; '));
    console.log(`Saved profiles and results: ${OUT}`);
  } catch (error) {
    results.error = String(error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
