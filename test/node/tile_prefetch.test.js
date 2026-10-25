(() => {
  function method(name) {
    const m = SCENE_GEO_SRC.match(new RegExp(`^  async ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)^  \\}`, 'm'));
    assert.truthy(m, `extract ${name}`);
    return `async function(${m[1]}) {${m[2]}}`;
  }
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

  function ringScene(depth = 0) {
    const events = [], pending = new Map();
    let active = 0, maxActive = 0;
    const WG = {
      tileCache: new Map(), tileKey: (x, y) => `${x}/${y}`,
      warmOverpass: () => null,
      prefetchTileBytes(x, y) {
        const k = `${x}/${y}`;
        events.push(`fetch ${k}`);
        const promise = new Promise((resolve, reject) => pending.set(k, { resolve, reject }));
        promise.catch(() => {});
        return promise;
      },
      async loadTile(x, y, lat, opts) {
        const k = `${x}/${y}`;
        events.push(`build ${k}`);
        maxActive = Math.max(maxActive, ++active);
        try {
          if (opts.bytesPromise) await opts.bytesPromise;
          const entry = { status: 'ready', _spawned: true };
          WG.tileCache.set(k, entry);
          return entry;
        } finally { active--; }
      },
    };
    const scene = {
      depth, _tilePassSeq: 1,
      _loadTileEntry: new Function('WorldGen', 'START_LAT', `return ${method('_loadTileEntry')}`)(WG, 49),
      _whenIdle: async () => {}, ensureHomeElevatorObject() {},
      _ensureHomeUpStair() {}, _ensureLadderUpStairs() {}, _applyDugWalls() {}, _carveLanding() {},
      _tileFailureKind: () => 'failed', showBanner(failed) { events.push(`banner ${failed}`); },
      _scheduleTileRetry(retry) { events.push(`retry ${retry}`); },
    };
    const run = new Function('WorldGen', 'START_LAT', 'Arena', 'eachTile3x3', 'window', 'console',
      `return ${method('_ensureTilesAroundPass')}`)(WG, 49, { DEPTH: 99 },
      (x, y, fn) => { for (let i = 0; i < 9; i++) fn(i, 0); }, {}, { warn() {} });
    scene.playerToWorldCell = () => ({ tx: 0, ty: 0 });
    scene._ensureTilesAroundPass = run;
    scene.ensureTilesAround = new Function('WorldGen', `return ${method('ensureTilesAround')}`)(WG);
    return { scene, WG, events, pending, run: () => run.call(scene, { tx: 0, ty: 0 }, 1),
      maxActive: () => maxActive };
  }

  test('tile prefetch: repeated same-centre checks retain the unfinished ring and lookahead', async () => {
    const f = ringScene();
    await f.scene.ensureTilesAround();
    await flush();
    const ring = f.scene._ringBuild, seq = f.scene._tilePassSeq;
    assert.falsy(f.scene._tilePass, 'centre promise has already released');
    for (let i = 1; i <= 8; i++) {
      await f.scene.ensureTilesAround();
      assert.eq(f.scene._tilePassSeq, seq, 'walk check does not supersede the ring');
      assert.eq(f.scene._ringBuild, ring, 'same background pass stays active');
      f.pending.get(`${i}/0`).resolve({ bytes: new Uint8Array(), fromCache: true });
      await flush();
    }
    await ring;
    assert.eq(f.events.filter(e => e === 'build 0/0').length, 1);
    assert.eq(f.events.filter(e => e.startsWith('fetch')).length, 8);
    assert.eq(f.scene._settledTilePassKey, '0/0/0');
    assert.falsy(f.scene._ringCentre, 'completed ring releases its centre identity');
  });

  test('tile prefetch: rebuilt or evicted centre still supersedes its unfinished ring', async () => {
    for (const replacement of [null, { status: 'ready', _spawned: true },
      { status: 'ready', _spawned: false }]) {
      const f = ringScene();
      await f.scene.ensureTilesAround();
      await flush();
      const ring = f.scene._ringBuild, seq = f.scene._tilePassSeq;
      if (replacement) f.WG.tileCache.set('0/0', replacement);
      else f.WG.tileCache.delete('0/0');
      await f.scene.ensureTilesAround();
      assert.eq(f.scene._tilePassSeq, seq + 1, 'invalid centre starts a new pass');
      assert.eq(f.events.filter(e => e === 'build 0/0').length, 2);
      for (const p of f.pending.values()) p.resolve({ bytes: new Uint8Array(), fromCache: true });
      await ring;
      assert.falsy(f.scene._settledTilePassKey, 'obsolete ring cannot settle replacement');
    }
  });

  test('tile prefetch: changed centre or depth supersedes the active ring', async () => {
    for (const change of ['centre', 'depth']) {
      const f = ringScene();
      await f.scene.ensureTilesAround();
      await flush();
      const ring = f.scene._ringBuild, seq = f.scene._tilePassSeq;
      if (change === 'centre') f.scene.playerToWorldCell = () => ({ tx: 9, ty: 0 });
      else f.scene.depth = 2;
      await f.scene.ensureTilesAround();
      assert.eq(f.scene._tilePassSeq, seq + 1, `${change} owns a fresh pass`);
      for (const p of f.pending.values()) p.resolve({ bytes: new Uint8Array(), fromCache: true });
      await ring;
      assert.falsy(f.scene._settledTilePassKey, 'old ring cannot settle the new location');
    }
  });

  test('tile prefetch: the same centre entry must remain ready and spawned', async () => {
    for (const change of ['loading', 'unspawned']) {
      const f = ringScene();
      await f.scene.ensureTilesAround();
      await flush();
      const ring = f.scene._ringBuild, seq = f.scene._tilePassSeq;
      const entry = f.WG.tileCache.get('0/0');
      if (change === 'loading') entry.status = 'loading';
      else entry._spawned = false;
      await f.scene.ensureTilesAround();
      assert.eq(f.scene._tilePassSeq, seq + 1, `${change} centre needs a fresh pass`);
      for (const p of f.pending.values()) p.resolve({ bytes: new Uint8Array(), fromCache: true });
      await ring;
      assert.falsy(f.scene._settledTilePassKey, 'old ring cannot settle the incomplete centre');
    }
  });

  test('tile prefetch: centre first, bounded lookahead and serial builds reuse fetched bytes', async () => {
    const f = ringScene();
    await f.run();
    await flush();
    assert.eq(f.events[0], 'build 0/0');
    assert.eq([...f.pending.keys()].join(), '1/0,2/0,3/0');
    assert.eq(f.events.filter(e => e.startsWith('build')).join(), 'build 0/0,build 1/0');
    const done = f.scene._ringBuild;
    for (let i = 1; i <= 8; i++) {
      assert.truthy(f.pending.has(`${i}/0`), 'payload was started before its build');
      f.pending.get(`${i}/0`).resolve({ bytes: new Uint8Array([i]), fromCache: false });
      await flush();
      assert.eq(f.pending.size, Math.min(8, i + 3), 'only three positions ahead');
    }
    await done;
    assert.eq(f.maxActive(), 1, 'heavy builds never overlap');
    assert.eq(f.events.filter(e => e.startsWith('fetch')).length, 8, 'one fetch per neighbour');
    assert.eq(f.scene._settledTilePassKey, '0/0/0');
  });

  test('tile prefetch: early neighbour rejection stays quiet and schedules normal retry', async () => {
    const f = ringScene();
    await f.run();
    await flush();
    f.pending.get('3/0').reject(new Error('HTTP 503'));
    await flush();
    const done = f.scene._ringBuild;
    for (let i = 1; i <= 8; i++) {
      if (i !== 3) f.pending.get(`${i}/0`).resolve({ bytes: new Uint8Array(), fromCache: true });
      await flush();
    }
    await done;
    assert.includes(f.events, 'retry true');
    assert.falsy(f.events.includes('banner true'), 'ring failure does not cover playable centre');
    assert.eq(f.events.filter(e => e.startsWith('build')).length, 9, 'failure does not stop later neighbours');
  });

  test('tile prefetch: superseded ring stops scheduling neighbours', async () => {
    const f = ringScene();
    await f.run();
    await flush();
    const done = f.scene._ringBuild;
    f.scene._tilePassSeq++;
    for (const p of f.pending.values()) p.resolve({ bytes: new Uint8Array(), fromCache: false });
    await done;
    assert.eq(f.pending.size, 3, 'no new fetches for obsolete centre');
    assert.eq(f.events.filter(e => e.startsWith('build')).length, 2);
    assert.falsy(f.scene._settledTilePassKey, 'old ring cannot settle new centre');
  });

  test('tile prefetch: underground ring retains its existing load path', async () => {
    const f = ringScene(2);
    await f.run();
    await f.scene._ringBuild;
    assert.eq(f.pending.size, 0);
    assert.eq(f.events.filter(e => e.startsWith('build')).length, 9);
  });

  test('tile prefetch: loaded tiles and other depths never fetch bytes', () => {
    try {
      WorldGen.setDepth(0);
      const key = WorldGen.tileKey(15001, 15002);
      WorldGen.tileCache.set(key, { status: 'ready' });
      try { assert.eq(WorldGen.prefetchTileBytes(15001, 15002), null); }
      finally { WorldGen.tileCache.delete(key); }
      WorldGen.setDepth(2);
      assert.eq(WorldGen.prefetchTileBytes(15001, 15002), null);
    } finally { WorldGen.setDepth(0); }
  });

  test('tile prefetch: real fixture builds identically without fetching its payload twice', async () => {
    // The headless harness deliberately never fires setTimeout. Give the
    // real sliced loader a paint turn, as slice_stats.test.js does.
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = fn => fn();
    const bytes = FIXTURE_TILES['2754_5566'];
    assert.truthy(bytes, 'Kelowna centre fixture exists');
    const fetch = globalThis.fetch;
    let tileFetches = 0;
    globalThis.fetch = async url => {
      if (String(url).endsWith('.pbf')) {
        tileFetches++;
        return { ok: true, arrayBuffer: async () => bytes.slice().buffer };
      }
      return { ok: false, status: 404 };
    };
    try {
      WorldGen.setDepth(0);
      const ordinary = await WorldGen.loadTile(2754, 5566, 49.88, { detached: true });
      await ordinary.promise;
      const before = tileFetches;
      const ahead = await WorldGen.loadTile(2754, 5566, 49.88, {
        detached: true, bytesPromise: Promise.resolve({ bytes, fromCache: false }),
      });
      await ahead.promise;
      assert.eq(ahead.status, 'ready');
      assert.eq(tileFetches, before, 'supplied payload causes no tile request');
      assert.eq(Array.from(ahead.grid).join(), Array.from(ordinary.grid).join(), 'same terrain cells');
      const objects = entry => JSON.stringify(entry.objects.map(o => [o.id, o.kind, o.x, o.y]));
      assert.eq(objects(ahead), objects(ordinary), 'same generated object identities and positions');
    } finally {
      globalThis.fetch = fetch; WorldGen.setDepth(0);
      if (raf === undefined) delete window.requestAnimationFrame;
      else window.requestAnimationFrame = raf;
    }
  });

  test('tile prefetch: supplied failure follows loadTile backoff without a second fetch', async () => {
    const fetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('unexpected network'); };
    try {
      WorldGen.setDepth(0);
      const bytesPromise = Promise.reject(new Error('prefetched HTTP 503'));
      bytesPromise.catch(() => {});
      const entry = await WorldGen.loadTile(15003, 15004, 49, { bytesPromise });
      let error;
      try { await entry.promise; } catch (e) { error = e; }
      assert.truthy(error && /prefetched HTTP 503/.test(error.message));
      assert.eq(calls, 0, 'load consumes original prefetch failure');
      assert.eq(WorldGen.prefetchTileBytes(15003, 15004), null, 'retry floor also guards lookahead');
    } finally { globalThis.fetch = fetch; WorldGen.setDepth(0); }
  });
  // Without requestIdleCallback (iOS Safari) the ring waits for one quick
  // frame, not a flat RING_IDLE_TIMEOUT_MS: that wait cost ~450 ms per tile.
  function idleFallback() {
    const m = SCENE_GEO_SRC.match(/^  _whenIdle\(\) \{([\s\S]*?)^  \}/m);
    assert.truthy(m, 'extract _whenIdle');
    const consts = ['RING_IDLE_TIMEOUT_MS', 'RING_IDLE_FRAME_MS'].map(n => {
      const c = SCENE_GEO_SRC.match(new RegExp(`^const ${n} = (\\d+);`, 'm'));
      assert.truthy(c, `read ${n}`);
      return Number(c[1]);
    });
    const frames = [];
    let now = 0;
    const raf = (fn) => frames.push(fn);
    const whenIdle = new Function('requestIdleCallback', 'requestAnimationFrame', 'performance',
      'RING_IDLE_TIMEOUT_MS', 'RING_IDLE_FRAME_MS', `return function() {${m[1]}}`)(
      undefined, raf, { now: () => now }, ...consts);
    // Run the next frame `gap` ms after the last one.
    const frame = (gap) => { now += gap; frames.shift()(now); };
    return { whenIdle, frame, timeout: consts[0] };
  }

  test('tile prefetch: rAF idle fallback resolves on the first quick frame', async () => {
    const f = idleFallback();
    let done = false;
    f.whenIdle().then(() => { done = true; });
    f.frame(16);
    await flush();
    assert.falsy(done, 'one frame has no gap to judge');
    f.frame(80);
    await flush();
    assert.falsy(done, 'a slow frame is not idle');
    f.frame(16);
    await flush();
    assert.truthy(done, 'a 60 fps frame is idle');
  });

  test('tile prefetch: rAF idle fallback still resolves on a thread that never settles', async () => {
    const f = idleFallback();
    let done = false;
    f.whenIdle().then(() => { done = true; });
    f.frame(0);
    let waited = 0;
    while (!done && waited < f.timeout * 2) { f.frame(100); waited += 100; await flush(); }
    assert.truthy(done, 'resolved');
    assert.truthy(waited <= f.timeout + 100, `resolved by the timeout (waited ${waited} ms)`);
  });
})();
