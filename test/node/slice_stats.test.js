// A generator's final next() does work too. Keep completion stalls visible
// even when a pass has no yields, or finishes after a short labelled step.
test('slice stats: includes the work after the last yield', async () => {
  const now = performance.now, raf = window.requestAnimationFrame;
  let clock = 0;
  performance.now = () => clock;
  window.requestAnimationFrame = fn => fn();
  try {
    const stats = {};
    const result = await WorldGen.runStepsSliced(function* () {
      clock += 1;
      yield 'short setup';
      clock += 100;
      return 42;
    }, { stats });
    assert.eq(result, 42);
    assert.eq(stats.worstMs, 101);
    assert.eq(stats.worstAt, 'completion');
    assert.eq(stats.slices, 1);
  } finally {
    performance.now = now;
    if (raf === undefined) delete window.requestAnimationFrame;
    else window.requestAnimationFrame = raf;
  }
});
