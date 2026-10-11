// Standalone clock contract test: node test/qa-clock.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  let realNow = 100, nativeId = 0;
  const nativeTimers = new Map(), nativeFrames = new Map(), deltas = [];
  const root = {
    Date,
    performance: { now: () => realNow },
    setTimeout(callback) { const id = ++nativeId; nativeTimers.set(id, callback); return id; },
    clearTimeout(id) { nativeTimers.delete(id); },
    requestAnimationFrame(callback) { const id = ++nativeId; nativeFrames.set(id, callback); return id; },
    cancelAnimationFrame(id) { nativeFrames.delete(id); },
  };
  root.window = root;
  let renders = 0, fired = 0;
  const game = {
    loop: { frame: 0, sleep() {}, wake() {} },
    headlessStep(time, delta) { deltas.push(delta); assert.equal(time, root.performance.now()); },
    renderer: { preRender() { renders++; }, postRender() {} },
    scene: { render() {} }, events: { emit() {} },
  };
  vm.runInNewContext(fs.readFileSync('tools/qa/clock.js', 'utf8'), root);
  root.setTimeout(() => fired++, 100);
  assert.equal(nativeTimers.size, 1, 'boot timers initially use real time');
  root.QAClock.install(game);
  assert.equal(nativeTimers.size, 0, 'pause cancels native timers queued during boot');
  const wall = root.Date.now();
  realNow += 10000;
  assert.equal(root.Date.now(), wall, 'agent thinking does not advance wall clock');
  assert.equal(root.performance.now(), 100);
  await root.QAClock.advance(200);
  assert.equal(fired, 1);
  assert.equal(root.Date.now(), wall + 200);
  assert.equal(root.performance.now(), 300);
  assert.equal(deltas.reduce((a, b) => a + b, 0), 200);
  assert.ok(deltas.every(delta => delta > 0 && delta <= 50));
  let intervals = 0;
  const interval = root.setInterval(() => { if (++intervals === 3) root.clearInterval(interval); }, 7);
  await root.QAClock.advance(100);
  assert.equal(intervals, 3, 'intervals run at due boundaries and can cancel themselves');
  let animationTime;
  root.requestAnimationFrame(time => { animationTime = time; });
  await root.QAClock.advance(20);
  assert.equal(animationTime, root.performance.now());
  assert.equal(renders, 3);
  assert.equal(root.QAClock.status().elapsedMs, 320);
  assert.equal(new root.Date().getTime(), root.Date.now());
  await assert.rejects(root.QAClock.advance(-1), /nonnegative/);
  await assert.rejects(root.QAClock.advance(100, { stepMs: 100 }), /stepMs/);
  const before = root.QAClock.status().elapsedMs;
  const interrupted = await root.QAClock.advance(1000, { until: () => true });
  assert.equal(interrupted.advancedMs, 50);
  assert.equal(root.QAClock.status().elapsedMs - before, 50, 'stop predicate preserves bounded action interruption');
  console.log('QA clock contracts passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
