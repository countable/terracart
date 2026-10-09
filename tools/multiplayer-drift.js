#!/usr/bin/env node
// Repeatable helper-level drift experiment. Executes shipping rosterEnemyMove
// and the scene's lifted enemyDt expression. This is not a browser/relay test:
// attacks, aggro announcements, save reconciliation and terrain generation are
// excluded. Delayed-target cases inject sampled coordinates, not socket packets.
// Run: node tools/multiplayer-drift.js [--json]
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'test/node/run.js');
const runnerSource = fs.readFileSync(runner, 'utf8');
const marker = '// ── Load every *.test.js';
assert(runnerSource.includes(marker), 'Node harness bootstrap marker changed');
const boot = new Module(runner, module);
boot.filename = runner;
boot.paths = Module._nodeModulePaths(path.dirname(runner));
boot._compile(runnerSource.slice(0, runnerSource.indexOf(marker)) + '\nmodule.exports = ctx;', runner);
const ctx = boot.exports;
const sceneSource = fs.readFileSync(path.join(root, 'src/scene_creatures.js'), 'utf8');
const dtSource = sceneSource.match(/const enemyDt = c\._enemyTickT[^\n]+\n\s*c\._enemyTickT = now;/)?.[0];
assert(dtSource, 'Shipping enemyDt scheduler changed');
vm.runInContext(`globalThis.driftStep = function(scene,c,now,target,inactive) {
  ${dtSource}
  rosterEnemyMove(scene,c,EnemyRoster.get(c.kind),now,target.x,target.y,inactive,false,null,enemyDt);
};`, ctx);
const CELL_M = 7, DURATION_MS = 30000, SAMPLE_MS = 100, HZ = 600, SEEDS = 10;
const cases = [
  { name: 'Shared idle, identical 60 Hz, unrelated RNG', idle: true },
  { name: 'Private idle, independent RNG (control)', idle: true, private: true },
  { name: 'Shared idle, 60 vs 30 Hz', idle: true, fpsB: 30 },
  { name: 'Shared idle, 60 vs 10 Hz', idle: true, fpsB: 10 },
  { name: 'Shared idle, 60 vs 5 Hz (dt cap)', idle: true, fpsB: 5 },
  { name: 'Pursuit, moving target, 60 vs 30 Hz', fpsB: 30 },
  { name: 'Pursuit, moving target, 60 vs 10 Hz', fpsB: 10 },
  { name: 'Pursuit, moving target, 60 vs 5 Hz (dt cap)', fpsB: 5 },
  { name: 'Pursuit, peer coordinates sampled every 125 ms', sampleTarget: 125 },
  { name: 'Pursuit, 125 ms coordinates + 100 ms delay', sampleTarget: 125, delay: 100 },
  { name: 'Pursuit, 125 ms coordinates + 300 ms delay', sampleTarget: 125, delay: 300 },
  { name: 'Pursuit, 125 ms coordinates + 1000 ms delay', sampleTarget: 125, delay: 1000 },
  { name: 'Shared idle, B pauses/culls from 5–10 seconds', idle: true, pause: [5000, 10000] },
  { name: 'Shared idle, B first loads at 10 seconds', idle: true, late: 10000 },
  { name: 'Shared idle, B clock origin offset +10 seconds', idle: true, offset: 10000 },
  { name: 'Pursuit, same wall, 60 vs 30 Hz', obstacle: true, fpsB: 30 },
  { name: 'Pursuit, wall loaded only on B', obstacleB: true },
  { name: 'Bat orbit, 60 vs 30 Hz', kind: 'bat', fpsB: 30, stationaryTarget: true },
  { name: 'Bat orbit, B pauses/culls from 5–10 seconds', kind: 'bat', pause: [5000, 10000], stationaryTarget: true },
];
function rng(seed) { let n = seed >>> 0; return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296); }
function makeScene(wall) {
  return { cellM: CELL_M, depth: 2, save: { energy: 100, armor: {} },
    cellAt: () => ({ loaded: true, type: ctx.WorldGen.T.CAVE_FLOOR }),
    _cellBlocked: (x, y) => !!wall && x > 4 && x < 6 && Math.abs(y) < 12,
    _nearAny: () => false };
}
function targetAt(ms, conf, seed) {
  if (conf.idle) return { x: 200, y: 0 };
  if (conf.stationaryTarget || conf.obstacle || conf.obstacleB) return { x: 14, y: 0 };
  const phase = seed * 0.31 + ms / 1000 * 0.24;
  return { x: 20 * Math.cos(phase), y: 20 * Math.sin(phase) };
}
function state(c) { return JSON.stringify([c._idleAngle ?? null, c._batLeg ?? null, !!c._batFlight, c._avoidSide ?? null, c._movementDecisions || {}]); }
function quantile(a, p) { const s = [...a].sort((x,y) => x-y); return s[Math.ceil(p*s.length)-1] || 0; }
const originalRandom = Math.random;
const originalNow = ctx.performance.now;
const oldDateNow = Date.now;
const results = [];
try {
  Date.now = () => 1800000000000;
  for (const conf of cases) {
    const distances = [], finals = []; let mismatches = 0, n = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const pair = [0,1].map(i => ({ c: { kind: conf.kind || 'goblin', id: `mon_drift_${seed}`, _sharedId: !conf.private, x: 0, y: 0 },
        scene: makeScene(conf.obstacle || (i === 1 && conf.obstacleB)), random: rng(seed + i * 1000) }));
      let last = 0;
      for (let tick = 0; tick <= DURATION_MS * HZ / 1000; tick++) {
        const t = tick * 1000 / HZ;
        for (let i = 0; i < 2; i++) {
          const fps = i === 1 ? conf.fpsB || 60 : 60;
          if (tick % (HZ / fps) !== 0) continue;
          if (i === 1 && ((conf.late && t < conf.late) || (conf.pause && t >= conf.pause[0] && t < conf.pause[1]))) continue;
          let seen = t;
          if (i === 1 && conf.sampleTarget) seen = Math.max(0, Math.floor((t - (conf.delay || 0)) / conf.sampleTarget) * conf.sampleTarget);
          const now = t + (i === 1 ? conf.offset || 0 : 0);
          ctx.performance.now = () => now;
          Math.random = pair[i].random;
          ctx.driftStep(pair[i].scene, pair[i].c, now, targetAt(seen, conf, seed), !!conf.idle);
        }
        if (tick % (SAMPLE_MS * HZ / 1000) === 0 && t > 0 && (!conf.late || t >= conf.late)) {
          const [a,b] = pair.map(p => p.c);
          last = Math.hypot(a.x-b.x, a.y-b.y);
          assert(Number.isFinite(last), `nonfinite position: ${conf.name}`);
          distances.push(last); n++; if (state(a) !== state(b)) mismatches++;
        }
      }
      finals.push(last);
    }
    results.push({ case: conf.name, samples: n, meanM: distances.reduce((a,b)=>a+b,0)/n,
      p95M: quantile(distances, 0.95), maxM: Math.max(...distances), meanFinalM: finals.reduce((a,b)=>a+b,0)/SEEDS,
      overHalfMeterPct: 100*distances.filter(d=>d>0.5).length/n, discreteMovementMismatchPct: 100*mismatches/n });
  }
} finally { Math.random = originalRandom; ctx.performance.now = originalNow; Date.now = oldDateNow; }
assert.equal(results[0].maxM, 0, 'identical shared baseline diverged');
assert.equal(results[0].discreteMovementMismatchPct, 0, 'identical shared baseline state diverged');
assert(results[1].maxM > 0.5, 'private RNG positive control failed');
const report = { scope: 'Shipping rosterEnemyMove and scene enemyDt scheduler, synthetic flat cave; no attacks, full scene gates, enemyTarget/aggro, real network or reconciliation.',
  durationMs: DURATION_MS, sampleMs: SAMPLE_MS, seeds: SEEDS, cellM: CELL_M,
  seedIds: 'mon_drift_1 through mon_drift_10; per-client LCG noise seed + clientIndex*1000',
  sampling: 'Positions sampled at common wall times after due client ticks; zero-order-held between frames; late-load samples start at 10s. Pause models omitted movement calls. Clock offset models performance clock origins.',
  target: 'Moving target radius 20m, angular speed 0.24 rad/s (4.8m/s), seed phase 0.31*seed. Sampled peer coordinates on B only; A receives live coordinates. Wall spans x=(4,6), |y|<12m.',
  state: 'Mismatch compares idle angle, bat leg/flight-active, avoidance side, movement decision counters; not entire creature state or target identity.', results };
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else { console.log(JSON.stringify({ ...report, results: undefined }, null, 2)); console.table(results.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k, typeof v === 'number' ? +v.toFixed(3) : v])))); }
