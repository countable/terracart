// THE SPAWN PASS, SLICED. spawnInTile ran 20-70 ms (160 ms the first time)
// unbroken as the tail of every neighbour tile's build — the stutter while the
// ring streams in. The pass is now a steps generator (spawnInTileSteps): the
// ring drives it sliced on the heavy chain (_spawnInTileSliced), the centre
// and every other caller straight through (spawnInTile). Pinned here:
//   • the same fixture tile spawns the same world either way;
//   • it really yields, and never after entry._spawned (nothing outside may
//     meet a tile flagged spawned whose traps / treasure are still to come);
//   • one pass per entry, and an evicted entry's pass stops.
(() => {
  const W = WorldGen;
  // A real tile, built the way loadTile builds it (the fields the pass reads).
  const KEY = '2753_5567';
  const [TX, TY] = KEY.split('_').map(Number);
  const N = W.cellsPerEdgeForTile(TY), EDGE = W.tileEdgeMeters(W.latOfRowCentre(TY));
  const build = () => {
    const r = W.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[KEY]), N, TX, TY, EDGE);
    const entry = { ...r, status: 'ready', depth: 0, cellsPerEdge: N, tileEdgeM: EDGE,
      objects: r.objects.slice(), wildplants: r.wildplants.slice(), parkingTreasures: r.parkingTreasures || [] };
    W.maybePlaceCaveEntrance(entry, TX, TY, EDGE, r.objects, r.wildplants);
    entry.baseGrid = entry.grid.slice();
    entry.genObjects = entry.objects.slice();
    return entry;
  };
  const scene = () => Object.assign(new SceneCreatures(), {
    tileEdgeM: EDGE, save: { caught: [] },
    _pestFreeZone: () => null, _starterTrailAnchor: () => null,
    _provisionStarterHome() {}, _carveStarterPond() {},
  });
  const pick = (o) => {
    const r = {};
    for (const k of Object.keys(o).sort()) { const v = o[k]; if (v == null || typeof v !== 'object') r[k] = v; }
    return r;
  };
  const snapshot = (e) => JSON.stringify({
    creatures: (e.creatures || []).map(pick), objects: e.objects.map(pick), wildplants: e.wildplants.map(pick),
    traps: (e.traps || []).map(pick), treasure: e.treasure && pick(e.treasure),
    extra: (e.extraTreasures || []).map(pick), coins: (e.coinDrops || []).map(pick),
    lairs: (e.streetLairs || []).map(pick), attracted: e.faunaAttracted,
  });

  test('spawn sliced: stepping the pass lays exactly the world spawnInTile lays, flag last', () => {
    const was = window.__TEST_MODE;
    window.__TEST_MODE = false;               // the full pass: dressing, traps, the X scatter
    try {
      const a = build();
      scene().spawnInTile(a, TX, TY);
      const b = build();
      const it = scene().spawnInTileSteps(b, TX, TY);
      let yields = 0;
      for (let r = it.next(); !r.done; r = it.next()) {
        yields++;
        assert.falsy(b._spawned, `a yield (${r.value}) after entry._spawned — the flag must come in the last slice`);
        assert.falsy(b.creatures, 'and the creatures are only committed at the end');
      }
      assert.gt(yields, 10, `the pass yields between its phases (${yields})`);
      assert.truthy(a._spawned && b._spawned, 'both passes finished');
      assert.gt(a.creatures.length, 50, 'the fixture spawns a real population');
      assert.gt(a.traps.length, 0, 'and real traps');
      assert.eq(snapshot(b), snapshot(a), 'the same creatures, objects, traps and treasure, id for id');
    } finally { window.__TEST_MODE = was; }
  });

  test('spawn sliced: one pass per entry, and an entry evicted mid-pass stops', async () => {
    const real = W.runStepsSliced;
    const cache = W.tileCacheFor(0);
    const key = W.tileKey(TX, TY);
    const had = cache.get(key);
    // A stand-in driver: same contract (abort asked between slices), driven
    // synchronously so the headless runner needs no frames.
    let drives = 0;
    W.runStepsSliced = (make, opts) => {
      drives++;
      return Promise.resolve().then(() => {
        const it = make();
        for (let r = it.next(); !r.done; r = it.next()) {
          if (opts && opts.abort && opts.abort()) { it.return(); return W.STEPS_ABORTED; }
        }
        return 'done';
      });
    };
    const was = window.__TEST_MODE;
    window.__TEST_MODE = true;
    try {
      const sc = scene();
      const e = { ...build() };
      cache.set(key, e);
      const p1 = sc._spawnInTileSliced(e, TX, TY);
      const p2 = sc._spawnInTileSliced(e, TX, TY);
      assert.truthy(p1 === p2, 'a second ask gets the pass in flight');
      assert.eq(await p1, true, 'it runs to the end');
      assert.eq(drives, 1, 'one pass, not two');
      assert.truthy(e._spawned && !e._spawnPass, 'the flag is up and the pass released');
      assert.eq(await sc._spawnInTileSliced(e, TX, TY), true, 'a spawned entry needs nothing more');
      assert.eq(drives, 1);
      const gone = { ...build() };
      cache.set(key, { replaced: true });       // a rebuild swapped in, or the LRU evicted it
      assert.eq(await sc._spawnInTileSliced(gone, TX, TY), false, 'a pass on an entry no longer cached stops');
      assert.falsy(gone._spawned, 'and never raises the flag');
    } finally {
      W.runStepsSliced = real;
      window.__TEST_MODE = was;
      if (had === undefined) cache.delete(key); else cache.set(key, had);
    }
  });

  test('spawn sliced: the neighbour ring slices, the centre stays whole (source pin)', () => {
    const geo = SCENE_SRC;
    assert.truthy(/entry\._spawnPass \|\| k !== centreKey/.test(geo), 'ring tiles (and a pass in flight) go through the sliced pass');
    assert.truthy(/await this\._spawnInTileSliced\(entry, tx, ty\)/.test(geo), 'and the build awaits it');
    assert.truthy(/return WorldGen\.runSteps\(this\.spawnInTileSteps\(entry, tx, ty\)\);/.test(SCENE_SRC),
      'spawnInTile drives the same steps straight through');
  });
})();
