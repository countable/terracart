(() => {
  const temple = { x: 15, y: 15, templeZone: 'park' };
  const tile = (N = 3) => ({ status: 'ready', _spawned: true, cellsPerEdge: N,
    zone: { anchors: [{ key: 'park' }], coverage: new Uint16Array(N * N) } });
  const at = (cache, x, y, entry) => cache.set(WorldGen.tileKey(x, y), entry);
  const coverage = cache => Temples.coverage(temple, cache, 30);

  test('temple coverage: all edge and diagonal continuations must be spawned', () => {
    const center = tile(), cache = new Map();
    center.zone.coverage.fill(1);
    at(cache, 0, 0, center);
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      if (x || y) at(cache, x, y, tile());
    }
    assert.truthy(coverage(cache).complete);
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      if (!(x || y)) continue;
      const neighbour = cache.get(WorldGen.tileKey(x, y));
      neighbour._spawned = false;
      assert.falsy(coverage(cache).complete, `continuation ${x},${y} must spawn`);
      neighbour._spawned = true;
      assert.truthy(coverage(cache).complete, 'loading completion is read live');
    }
  });

  test('temple coverage: mask edits and replacements change the explored region immediately', () => {
    const center = tile(), cache = new Map();
    at(cache, 0, 0, center);
    assert.falsy(coverage(cache).complete, 'an anchor without any owned cells is not coverage');
    center.zone.coverage[4] = 1;
    assert.truthy(coverage(cache).complete);
    center.zone.coverage[5] = 1;
    assert.falsy(coverage(cache).complete, 'in-place edge edit reaches an unloaded tile');
    center.zone.coverage = Uint16Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    assert.truthy(coverage(cache).complete, 'replacement mask removes continuation');
    center.zone.anchors[0].key = 'another park';
    assert.falsy(coverage(cache).complete, 'changed anchor ownership is read live');
    center.zone.anchors.push({ key: 'park' });
    center.zone.coverage[4] = 2;
    assert.truthy(coverage(cache).complete, 'replacement slot is found');
  });

  test('temple coverage: large park masks resolve ownership per anchor, not per terrain cell', () => {
    const center = tile(512), cache = new Map();
    let keyReads = 0;
    center.zone.anchors = [{ get key() { keyReads++; return 'park'; } }];
    // A sizeable interior park makes repeated per-cell key/string lookups
    // observable without a machine-dependent wall-clock performance limit.
    for (let y = 1; y < 511; y++) center.zone.coverage.fill(1, y * 512 + 1, y * 512 + 511);
    at(cache, 0, 0, center);
    assert.truthy(coverage(cache).complete);
    assert.lte(keyReads, 2, 'ownership work scales with anchors');
  });

  test('temple census: reused lair indexes must be complete before declaring a park clear', () => {
    const oldLairs = globalThis.Lairs;
    const center = tile(), cache = new Map();
    center.zone.coverage[4] = 1;
    center._spawnOpts = {};
    at(cache, 0, 0, center);
    const partial = { done: false, buckets: new Map() };
    center._lairIndex = partial;
    const complete = { done: true, buckets: new Map([[0, [{ wx: 15, wy: 15, tier: 4 }]]]) };
    let builds = 0;
    globalThis.Lairs = {
      buildIndex() { builds++; return complete; },
      ALWAYS_AWAKE_TIERS: new Set([4]),
      garrisonFor() { return [{ id: 'sleeping-lair-foe', kind: 'slime', x: 15, y: 15 }]; },
    };
    try {
      const options = { tileCache: cache, tileEdgeM: 30 };
      const first = Temples.status({}, temple, options);
      assert.falsy(first.ready, 'an unindexed sleeping foe cannot be missed');
      assert.eq(first.remaining, 1);
      assert.falsy(partial.done, 'leave the shared sliced job unchanged');
      center._lairIndex = complete;
      assert.truthy(Temples.status({ caught: ['sleeping-lair-foe'] }, temple, options).ready);
      assert.eq(builds, 1, 'the next census reuses the completed index');
    } finally { globalThis.Lairs = oldLairs; }
  });
})();
