/* Inject BEFORE application scripts. No effect on clock speed until install(). */
(function (root) {
  'use strict';
  const NativeDate = root.Date;
  const native = {
    now: root.performance.now.bind(root.performance),
    timeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root),
    raf: root.requestAnimationFrame.bind(root), cancelRaf: root.cancelAnimationFrame.bind(root),
  };
  const timers = new Map(), frames = new Map();
  let nextId = 1000000000, paused = false, advancing = false, game;
  let now = native.now(), epoch = NativeDate.now() - now, start = now, steps = 0;
  const current = () => paused ? now : native.now();
  function VirtualDate(...args) {
    if (!new.target) return new NativeDate(epoch + current()).toString();
    return new NativeDate(...(args.length ? args : [epoch + current()]));
  }
  VirtualDate.prototype = NativeDate.prototype;
  Object.setPrototypeOf(VirtualDate, NativeDate);
  VirtualDate.now = () => Math.floor(epoch + current());
  root.Date = VirtualDate;
  Object.defineProperty(root.performance, 'now', { configurable: true, value: current });

  function invokeTimer(id) {
    const timer = timers.get(id);
    if (!timer) return;
    if (timer.interval !== null) {
      timer.due += timer.interval;
      if (!paused) timer.nativeId = native.timeout(() => invokeTimer(id), timer.interval);
    } else timers.delete(id);
    timer.callback(...timer.args);
  }
  function schedule(callback, delay, args, interval) {
    if (typeof callback !== 'function') throw new TypeError('QA clock requires function timer callbacks');
    const ms = Math.max(interval ? 1 : 0, Number(delay) || 0);
    const id = nextId++;
    const timer = { callback, args, due: current() + ms, interval: interval ? ms : null };
    timers.set(id, timer);
    if (!paused) timer.nativeId = native.timeout(() => invokeTimer(id), ms);
    return id;
  }
  root.setTimeout = (callback, delay, ...args) => schedule(callback, delay, args, false);
  root.setInterval = (callback, delay, ...args) => schedule(callback, delay, args, true);
  root.clearTimeout = root.clearInterval = id => {
    const timer = timers.get(id);
    if (timer) { native.clearTimeout(timer.nativeId); timers.delete(id); }
    else native.clearTimeout(id);
  };
  root.requestAnimationFrame = callback => {
    const id = nextId++;
    const frame = { callback };
    frames.set(id, frame);
    if (!paused) frame.nativeId = native.raf(time => { frames.delete(id); callback(time); });
    return id;
  };
  root.cancelAnimationFrame = id => {
    const frame = frames.get(id);
    if (frame) { native.cancelRaf(frame.nativeId); frames.delete(id); }
    else native.cancelRaf(id);
  };
  function status() {
    return { paused, elapsedMs: paused ? now - start : 0, performanceMs: current(),
      wallMs: VirtualDate.now(), steps, pendingTimers: timers.size, pendingFrames: frames.size };
  }
  function pause() {
    if (!paused) {
      now = native.now(); start = now; paused = true;
      game?.loop.sleep();
      for (const timer of timers.values()) native.clearTimeout(timer.nativeId);
      for (const frame of frames.values()) native.cancelRaf(frame.nativeId);
    }
    return status();
  }
  function render() {
    if (!game || game.isPaused) return;
    const renderer = game.renderer;
    renderer.preRender();
    game.events.emit('prerender', renderer, now, 0);
    game.scene.render(renderer);
    renderer.postRender();
    game.events.emit('postrender', renderer, now, 0);
  }
  async function advance(ms, options = {}) {
    if (!paused || !game) throw new Error('Call QAClock.install() after game boot first');
    if (advancing) throw new Error('QA clock advance already in progress');
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('advance milliseconds must be finite and nonnegative');
    const stepMs = options.stepMs ?? 50;
    if (!(stepMs > 0 && stepMs <= 50)) throw new RangeError('stepMs must be > 0 and <= 50');
    advancing = true;
    try {
      const advanceStart = now;
      const target = now + ms;
      let batch = 0;
      while (now < target) {
        // Timers form step boundaries, so a short callback never waits a whole frame.
        let end = Math.min(target, now + stepMs);
        for (const timer of timers.values()) if (timer.due > now) end = Math.min(end, timer.due);
        const delta = end - now;
        now = end;
        let fired = 0;
        while (true) {
          let selected;
          for (const [id, timer] of timers) if (timer.due <= now &&
              (!selected || timer.due < selected[1].due)) selected = [id, timer];
          if (!selected) break;
          if (++fired > 10000) throw new Error('QA clock detected runaway timer callbacks');
          invokeTimer(selected[0]);
        }
        const callbacks = [...frames.values()]; frames.clear();
        for (const frame of callbacks) frame.callback(now);
        // Update the public loop counters read by Phaser systems and diagnostics.
        game.loop.now = game.loop.lastTime = now;
        game.loop.delta = delta;
        game.loop.frame++;
        game.headlessStep(now, delta);
        steps++;
        await Promise.resolve();
        if (++batch % 100 === 0) await new Promise(resolve => native.timeout(resolve, 0));
        if (options.until?.()) break;
      }
      if (options.render !== false) render();
      return { ...status(), advancedMs: now - advanceStart };
    } finally { advancing = false; }
  }
  root.QAClock = {
    install(candidate = root.__game) {
      if (!candidate?.headlessStep || !candidate.loop) throw new Error('Phaser game has not booted');
      game = candidate;
      // Phaser visibility handlers must not restart its real RAF while paused.
      const wake = game.loop.wake.bind(game.loop);
      if (!game.loop.__qaWakeGuard) {
        game.loop.wake = (...args) => { if (!paused) return wake(...args); };
        game.loop.__qaWakeGuard = true;
      }
      return pause();
    }, pause, advance, render, status,
  };
})(window);
