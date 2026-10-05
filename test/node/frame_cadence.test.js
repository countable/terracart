// Drive the shipping limiter and lifecycle methods without a Phaser/DOM boot.
(function () {
  const start = APP_JS_SRC.indexOf('function installFrameCadence(loop) {');
  const end = APP_JS_SRC.indexOf('\n}\n', start) + 2;
  const install = new Function(`return (${APP_JS_SRC.slice(start, end)});`)();

  const limiterAt = PHASER_SRC.indexOf('stepLimitFPS:function(');
  const timeStepSource = PHASER_SRC.slice(PHASER_SRC.lastIndexOf('initialize:function(', limiterAt),
    PHASER_SRC.indexOf('t.exports=', limiterAt));

  function vendorMethod(name, clock) {
    const marker = `${name}:function(`;
    const start = timeStepSource.indexOf(marker);
    assert.gte(start, 0, `Phaser still exports ${name}; review adapter on vendor updates`);
    const from = start + name.length + 1;
    let at = timeStepSource.indexOf('{', from), depth = 1;
    while (depth && ++at < timeStepSource.length) {
      if (timeStepSource[at] === '{') depth++;
      else if (timeStepSource[at] === '}') depth--;
    }
    return new Function('window', `return (${timeStepSource.slice(from, at + 1)});`)({ performance: clock });
  }

  function driver(limit = 30, adapted = true) {
    let time = 0;
    const calls = [], clock = { now: () => time };
    const loop = {
      hasFpsLimit: limit > 0, _limitRate: limit > 0 ? 1000 / limit : 0,
      now: 0, lastTime: 0, time: 0, startTime: 0, frame: 0, delta: 0,
      smoothStep: true, _target: 1000 / 60, _min: 200, _coolDown: 0,
      inFocus: true, deltaHistory: Array(10).fill(1000 / 60), deltaIndex: 0,
      deltaSmoothingMax: 10, panicMax: 120, actualFps: 60,
      nextFpsUpdate: 1000, framesThisSecond: 0,
      callback: (t, delta) => calls.push({ t, delta }),
    };
    for (const name of ['stepLimitFPS', 'step', 'smoothDelta', 'updateFPS', 'resetDelta', 'focus', 'pause', 'resume'])
      loop[name] = vendorMethod(name, clock);
    if (adapted) install(loop);
    return {
      loop, calls,
      advance(ms) { time += ms; (loop.hasFpsLimit ? loop.stepLimitFPS : loop.step).call(loop, time); },
      skip(ms) { time += ms; },
      now: () => time,
    };
  }

  for (const hz of [60, 90, 120, 53]) {
    test(`frame cadence: ${hz} Hz retains 30/s through clustered display jitter`, () => {
      const d = driver();
      let lastCount = 0;
      for (let i = 0; i < hz * 20; i++) {
        // Sustained faster/slower runs defeat the old +1 fps threshold slack.
        d.advance(1000 / hz + (i % 60 < 30 ? -2 : 2));
        assert.lte(d.calls.length - lastCount, 1, 'at most one game step per display frame');
        lastCount = d.calls.length;
      }
      assert.inRange(d.calls.length, Math.floor(d.now() * 30 / 1000), Math.floor(d.now() * 30 / 1000) + 1);
      const delivered = d.calls.reduce((sum, call) => sum + call.delta, 0);
      assert.lt(Math.abs(delivered - d.calls[d.calls.length - 1].t), 1e-6,
        'callback elapsed time neither loses nor double-counts the scheduling remainder');
      assert.lt(Math.abs(delivered + d.loop.delta - d.now()), 1e-6, 'pending time remains in Phaser delta');
      assert.eq(d.loop.frame, hz * 20, 'original display-frame bookkeeping still runs');
      assert.eq(d.loop.lastTime, d.now());
      assert.eq(d.loop.time, d.now());
      assert.eq(d.loop._limitRate, 1000 / 30, 'temporary gate never escapes a frame');
    });
  }

  test('frame cadence: a long stall delivers elapsed time once without catch-up bursts', () => {
    const d = driver();
    d.advance(10);
    d.advance(400);
    assert.eq(d.calls.length, 1);
    assert.eq(d.calls[0].delta, 410);
    for (let i = 0; i < 10; i++) d.advance(1);
    assert.eq(d.calls.length, 1, 'missed deadlines do not turn into rapid catch-up frames');
    d.advance(20);
    assert.eq(d.calls.length, 2);
    assert.eq(d.calls[1].delta, 30, 'the old remainder is not delivered a second time');
  });

  test('frame cadence: focus and resume discard background time and scheduling debt', () => {
    for (const action of ['focus', 'resume']) {
      const d = driver();
      d.advance(25);
      d.loop.pause();
      d.skip(60000);
      d.loop[action]();
      d.advance(10);
      assert.eq(d.calls.length, 0, `${action} cleared the pre-background scheduling phase`);
      d.advance(25);
      assert.eq(d.calls.length, 1);
      assert.eq(d.calls[0].delta, 35, `${action} does not advance the game by the background minute`);
    }
  });

  test('frame cadence: uncapped mode keeps the original driver and smoothing', () => {
    const d = driver(0, false), original = d.loop.stepLimitFPS, reset = d.loop.resetDelta;
    install(d.loop);
    assert.eq(d.loop.stepLimitFPS, original);
    assert.eq(d.loop.resetDelta, reset);
    assert.eq(d.loop.smoothStep, true);
    for (let i = 0; i < 120; i++) d.advance(1000 / 120);
    assert.eq(d.calls.length, 120);
  });
})();
