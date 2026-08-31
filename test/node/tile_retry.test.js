// Re-fetching a 3×3 tile block that came back short (app.js
// _scheduleTileRetry, armed from ensureTilesAround).
//
// THE BUG THIS PINS: nothing re-fetched it. The only automatic re-fetch in the
// game is the 20 m walk check in update(), so a player standing still kept
// whatever the boot load managed — and the boot load fires all nine tiles at
// once into a cold cache, which is exactly what a brand-new install has. One
// bad moment there (a captive portal, a phone still handing off from cell to
// wifi, the tile host shedding a burst) left them on a featureless green
// field: no houses, no POIs, and no starter crates either, because the trail
// is laid when the anchor tile rasterizes. Measured in a real browser with the
// tile host failing for 25 s: two minutes later the game had re-fetched
// nothing and the map was still empty. With the retry, the world builds the
// moment the host answers.
(() => {
  // A controllable clock in place of the runner's no-op setTimeout: the lifted
  // method reads setTimeout / clearTimeout / document off these globals.
  function withClock(fn) {
    const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
    const realDoc = globalThis.document;
    const timers = new Map();
    let nextId = 1;
    globalThis.setTimeout = (cb, ms) => { const id = nextId++; timers.set(id, { cb, ms }); return id; };
    globalThis.clearTimeout = (id) => { timers.delete(id); };
    globalThis.document = { hidden: false, visibilityState: 'visible', addEventListener() {} };
    const clock = {
      timers,
      delays: [],
      // Fire the one pending timer, recording the delay it was armed with.
      fire() {
        const [id, t] = [...timers.entries()][0] || [];
        if (!id) return false;
        timers.delete(id);
        clock.delays.push(t.ms);
        t.cb();
        return true;
      },
      pending: () => timers.size,
      armedMs: () => { const t = [...timers.values()][0]; return t ? t.ms : null; },
    };
    try { return fn(clock); }
    finally {
      globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
      globalThis.document = realDoc;
    }
  }

  // Scene stub: records how many times the retry actually re-fetched.
  const trScene = (over = {}) => Object.assign({
    fetches: 0,
    ensureTilesAround() { this.fetches++; return { catch() {} }; },
    _scheduleTileRetry: scheduleTileRetry,
  }, over);

  test('tile retry: a whole block arms nothing', () => {
    withClock((clock) => {
      const s = trScene();
      s._scheduleTileRetry(false);
      assert.eq(clock.pending(), 0, 'a successful pass leaves no timer behind');
    });
  });

  test('tile retry: a short block schedules a re-fetch', () => {
    withClock((clock) => {
      const s = trScene();
      s._scheduleTileRetry(true);
      assert.eq(clock.pending(), 1, 'one retry armed');
      assert.eq(clock.armedMs(), TILE_RETRY_BASE_MS, 'first retry waits the base backoff');
      clock.fire();
      assert.eq(s.fetches, 1, 'and it actually re-fetches the block');
    });
  });

  test('tile retry: the base clears WorldGen\'s own per-tile backoff', () => {
    // WorldGen parks a failed tile for TILE_RETRY_MS (3 s) and answers from
    // that backoff instead of fetching. A retry sooner than that would be a
    // no-op that still burned the attempt.
    assert.gt(TILE_RETRY_BASE_MS, 3000, 'a retry must outlast the per-tile backoff');
  });

  test('tile retry: repeated failures back off, and stop at the cap', () => {
    withClock((clock) => {
      const s = trScene();
      let last = 0;
      for (let i = 0; i < 12; i++) {
        s._scheduleTileRetry(true);
        const armed = clock.armedMs();
        assert.truthy(armed, `attempt ${i} armed a retry`);
        assert.gte(armed, last, 'the backoff never shrinks while it keeps failing');
        assert.falsy(armed > TILE_RETRY_MAX_MS, `attempt ${i} stays under the cap`);
        last = armed;
        clock.fire();
      }
      assert.eq(last, TILE_RETRY_MAX_MS, 'a long outage settles at the cap, not higher');
      assert.eq(s.fetches, 12, 'every attempt re-fetched');
    });
  });

  test('tile retry: one timer at a time', () => {
    withClock((clock) => {
      const s = trScene();
      s._scheduleTileRetry(true);
      s._scheduleTileRetry(true);
      s._scheduleTileRetry(true);
      assert.eq(clock.pending(), 1, 'concurrent short passes share one retry');
    });
  });

  test('tile retry: a block that comes back whole cancels the retry', () => {
    withClock((clock) => {
      const s = trScene();
      s._scheduleTileRetry(true);
      assert.eq(clock.pending(), 1, 'armed while failing');
      s._scheduleTileRetry(false);
      assert.eq(clock.pending(), 0, 'and dropped the moment the map is whole');
      // ...and the backoff resets, so the next outage starts from the base
      // instead of resuming a minute-long wait.
      s._scheduleTileRetry(true);
      assert.eq(clock.armedMs(), TILE_RETRY_BASE_MS, 'the backoff reset with it');
    });
  });

  test('tile retry: a backgrounded tab waits instead of spending the radio', () => {
    withClock((clock) => {
      const s = trScene();
      s._scheduleTileRetry(true);
      globalThis.document.hidden = true;
      clock.fire();
      assert.eq(s.fetches, 0, 'hidden: no fetch');
      assert.eq(clock.pending(), 1, 'but the retry is still armed for the return');
      globalThis.document.hidden = false;
      clock.fire();
      assert.eq(s.fetches, 1, 'and fires for real once the tab is back');
    });
  });
})();
