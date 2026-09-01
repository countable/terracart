// The tile-build slice budget, and why it isn't a number any more.
//
// WHAT IT FIXED. A tile build hands the thread back through rAF, so a slice
// costs one frame however long it held. The old live budget of a flat 12 ms
// took that literally — "use the frame you already paid for" — and it made the
// first ten seconds of every walk stutter end to end: 12 ms of rasterize plus
// the game's own 5-9 ms of update and draw is past 16.7, so EVERY frame missed
// vsync for as long as the neighbour ring was streaming, and everything went
// smooth the instant it finished. Going one millisecond past the frame does not
// cost one millisecond, it costs the next vsync — so overrunning buys no
// throughput at all, which is what makes a smaller budget a fix and not a trade.
(() => {
  const W = WorldGen;
  // Put the dial back where the game leaves it, whatever a previous test did.
  const sbReset = (ms = W.RASTER_SLICE_LIVE_MS, adapt = true) => W.setSliceBudgetMs(ms, adapt);
  // Feed the controller `n` frames of `ms` and report where it settled.
  const sbFeed = (ms, n) => { for (let i = 0; i < n; i++) W.noteSliceFrame(ms); return W.sliceBudgetMs(); };

  test('slice budget: it starts at the ceiling it was set to', () => {
    sbReset();
    assert.eq(W.sliceBudgetMs(), W.RASTER_SLICE_LIVE_MS, 'nothing measured yet, so nothing backed off');
  });

  test('slice budget: a missed frame backs it off, hard', () => {
    sbReset();
    const after = W.noteSliceFrame(33);            // one dropped frame
    assert.lt(after, W.RASTER_SLICE_LIVE_MS, 'a single miss is enough to give ground');
    assert.lt(sbFeed(33, 10), after, 'and it keeps giving while the misses keep coming');
  });

  test('slice budget: it never backs off past the floor', () => {
    // A device that cannot hold 60 fps at all must still make progress on the
    // tile — a budget of 0 would stall the build forever.
    sbReset();
    const bottom = sbFeed(400, 200);
    assert.eq(bottom, W.SLICE_MIN_MS, 'parked at the floor');
    assert.gt(bottom, 0, 'and the floor is real work');
  });

  test('slice budget: frames that fit creep it back up', () => {
    sbReset();
    sbFeed(33, 20);                                 // knock it down
    const low = W.sliceBudgetMs();
    const up = sbFeed(16, 12);                      // then a run of clean frames
    assert.gt(up, low, 'it recovers when the device can carry it');
  });

  test('slice budget: it creeps up more slowly than it backs off', () => {
    // AIMD. Backing off gently would leave the player in the stutter for the
    // seconds it took to converge, which is most of the streaming window.
    sbReset();
    const start = W.sliceBudgetMs();
    W.noteSliceFrame(33);
    const dropped = start - W.sliceBudgetMs();
    sbReset();
    W.noteSliceFrame(16);
    const gained = W.sliceBudgetMs() - start;       // clamped at the ceiling
    assert.gt(dropped, Math.max(gained, 0.5), 'one miss loses more than one hit wins');
  });

  test('slice budget: it never creeps past the ceiling', () => {
    sbReset();
    assert.eq(sbFeed(8, 100), W.RASTER_SLICE_LIVE_MS, 'the dial is still the maximum');
  });

  test('slice budget: it settles just under what the device can carry', () => {
    // The whole point: converge, and stay converged. Model a device with 8 ms
    // of game work per frame and a 16.7 ms vsync — a slice that fits delivers a
    // 16.7 ms frame, one that does not delivers 33.
    sbReset();
    const frameFor = (slice) => (slice + 8 > 16.7 ? 33 : 16.7);
    let missed = 0;
    for (let i = 0; i < 400; i++) {
      const f = frameFor(W.sliceBudgetMs());
      if (i > 60 && f > W.sliceFrameTargetMs()) missed++;   // once it has converged
      W.noteSliceFrame(f);
    }
    const held = W.sliceBudgetMs();
    assert.lte(held, 8.7, 'it found the headroom (16.7 - 8ms of game work)');
    assert.gt(held, W.SLICE_MIN_MS, 'without collapsing to the floor');
    assert.lt(missed / 340, 0.05, `steady state drops frames rarely (${missed}/340)`);
  });

  // A device model: `game` ms of update + draw per frame, a 16.7 ms vsync, and
  // a frame that overruns costs the whole next one. Returns what the controller
  // settles on, how often it drops a frame, and — the number that matters most
  // — how much tile work it gets DONE per frame of wall clock.
  const sbDevice = (game, frames = 1200) => {
    sbReset();
    // rAF is quantised to the display: a frame takes as many 16.7 ms refreshes
    // as the work inside it needs.
    const VSYNC = 16.7;
    const frameFor = (slice) => Math.ceil((slice + game) / VSYNC) * VSYNC;
    let missed = 0, delivered = 0, wall = 0, n = 0;
    for (let i = 0; i < frames; i++) {
      const b = W.sliceBudgetMs(), f = frameFor(b);
      if (i > 100) { n++; delivered += b; wall += f; if (f > frameFor(0)) missed++; }
      W.noteSliceFrame(f);
    }
    return { held: W.sliceBudgetMs(), dropRate: missed / n, perMs: delivered / wall };
  };
  // What the flat 12 ms budget did on the same device.
  const sbFlat = (game) => {
    const f = 12 + game > 16.7 ? 33 : 16.7;
    return { dropRate: f > 22 ? 1 : 0, perMs: 12 / f };
  };

  test('slice budget: a device with room to spare keeps the whole ceiling', () => {
    // No regression where there was no problem. A frame with 4 ms of game work
    // can carry the full 12 and still make vsync, so nothing backs off and the
    // ring streams exactly as fast as it did before.
    const d = sbDevice(4);
    assert.eq(d.held, W.RASTER_SLICE_LIVE_MS, 'never gave any ground');
    assert.eq(d.dropRate, 0, 'and never missed a frame');
  });

  test('slice budget: on the device that stuttered it is FASTER, not just smoother', () => {
    // The heart of it. 8 ms of game work is where the flat 12 dropped every
    // single frame — and because a missed frame costs the next vsync, it only
    // delivered 12 ms of tile per 33 ms of wall clock. Backing off to fit
    // delivers less per frame and MORE per second.
    const game = 8;
    const now = sbDevice(game), was = sbFlat(game);
    assert.eq(was.dropRate, 1, 'the flat budget missed every frame here');
    assert.lt(now.dropRate, 0.05, `the controller almost never does (${(now.dropRate * 100).toFixed(1)}%)`);
    assert.gt(now.perMs, was.perMs, 'and it builds MORE tile per second while doing it');
  });

  test('slice budget: a device that frees up gets its throughput back', () => {
    // The remembered headroom has to relax, or a moment of heavy load parks the
    // streaming rate low for the rest of the session.
    const busy = sbDevice(12);
    assert.lt(busy.held, W.RASTER_SLICE_LIVE_MS, 'it backed off under load');
    // Same controller state, now the load is gone: a run of clean frames.
    const recovered = sbFeed(16, 2000);
    assert.eq(recovered, W.RASTER_SLICE_LIVE_MS, 'all the way back to the ceiling');
  });

  test('slice budget: a 30 fps device is not punished for a frame rate we did not cause', () => {
    // 25 ms of the device's OWN work per frame means rAF is already delivering
    // 33.4 ms frames with 8 ms of idle inside them. Judged against a fixed
    // threshold every one of those reads as a miss, the budget pins at the
    // floor, and the tile build crawls — for a stutter it is not causing and
    // cannot fix. The threshold tracks the device's quantum instead, so the
    // idle gets used.
    const d = sbDevice(25);
    assert.gt(d.held, W.SLICE_MIN_MS, `did not collapse to the floor (settled ${d.held.toFixed(1)}ms)`);
    assert.gt(d.perMs, 0.15, 'and still gets real tile work done per second of wall clock');
  });

  test('slice budget: every device model stays under 5% dropped frames', () => {
    // The sweep, as one assertion. The flat budget dropped 100% of frames on
    // everything from 8 ms of game work upward.
    for (const game of [2, 4, 8, 12, 25, 40]) {
      const d = sbDevice(game);
      assert.lt(d.dropRate, 0.05,
        `${game}ms of game work drops ${(d.dropRate * 100).toFixed(1)}% (settled ${d.held.toFixed(1)}ms)`);
    }
  });

  test('slice budget: the boot does NOT adapt', () => {
    // While the overlay is up nobody can tap anything and there is no frame
    // rate to protect — a controller there would only make the boot longer.
    W.setSliceBudgetMs(24, false);
    assert.eq(sbFeed(500, 50), 24, 'held flat through frames that would rout the live dial');
    sbReset();
  });

  test('slice budget: junk measurements are ignored', () => {
    sbReset();
    const before = W.sliceBudgetMs();
    W.noteSliceFrame(0);
    W.noteSliceFrame(-5);
    W.noteSliceFrame(NaN);
    assert.eq(W.sliceBudgetMs(), before, 'a clock that went backwards moves nothing');
  });
})();
