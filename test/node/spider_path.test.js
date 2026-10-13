(function () {
  function dressing(block) {
    const N = 64, extent = 4096, edge = N * 7;
    const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
    const spawnOpts = { occupied: new Set(), roadMask: new Uint8Array(N * N),
      roadClass: new Uint8Array(N * N), spawnWhy: new Uint16Array(N * N), pois: [] };
    if (block) spawnOpts.spawnWhy.fill(block);
    const rec = { variant: 'spider_path', key: 'spider-test', lineKey: 'spider-test', size: 'path',
      line: [{x: 512, y: 2048}, {x: 3584, y: 2048}], halfW: 1.5 };
    const index = { extent, lines: [rec], vehicleLines: [], hoardPois: [] };
    return StreetVariants.dress({ index, tx: 0, ty: 0, N, tileEdgeM: edge, grid, spawnOpts });
  }
  test('Spider Path: deterministic webs and one two-spider garrison preserve path provenance', () => {
    const a = dressing(), b = dressing();
    assert.gt(a.webs.length, 0); assert.lt(a.webs.length, 40);
    assert.eq(JSON.stringify(a.webs), JSON.stringify(b.webs));
    assert.eq(new Set(a.webs.map(w => w.id)).size, a.webs.length);
    assert.truthy(a.webs.every(w => w.permanent && w._street === 'spider_path' && w.expiresAt == null));
    assert.eq(a.lairs.length, 1); assert.eq(a.lairs[0]._street, 'spider_path');
    assert.eq(Lairs.GROUPS.street_spider_path.members[0].kind, 'spider');
    assert.eq(Lairs.GROUPS.street_spider_path.members[0].n, 2);
  });
  test('Spider Path: private land and road kerbs reject webs and spiders', () => {
    for (const reason of [WorldGen.SPAWN_WHY.PRIVATE, WorldGen.SPAWN_WHY.KERB]) {
      const a = dressing(reason); assert.eq(a.webs.length, 0); assert.eq(a.lairs.length, 0);
    }
  });
  test('Spider Path: permanent silk survives days, shots, and reloading without save duplication', () => {
    const original = WorldGen.tileCache, cache = new Map();
    const list = [{ id: 'path_web_test', x: 28, y: 28, permanent: true, _street: 'spider_path' }];
    const s = { depth: 0, cellsPerTile: 8, cellM: 8, mPerPx: 64 / WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 28, y: 28 },
      save: { energy: 100 }, cellAt: () => ({ loaded: true, type: WorldGen.T.GRASS }) };
    try {
      WorldGen.tileCache = cache; cache.set('0,0', { spiderPathWebs: list });
      const now = 1800000000000;
      assert.eq(SpiderWebs.lists(s, now).webs.length, 1);
      SpiderWebs.land(s, { depth: 0, cellIX: 3, cellIY: 3, targetX: 28, targetY: 28 }, now);
      assert.eq(s.save.spiderWebs, undefined);
      assert.eq(SpiderWebs.lists(s, now + 10 * 86400000).webs.length, 1);
      assert.truthy(SpiderWebs.contact(s, 'player', now));
      assert.eq(s.save.conditions.paralysis.remainingMs, 6000);
      delete s._spiderWebRuntime;
      assert.eq(SpiderWebs.lists(s, now).webs.length, 1);
      cache.clear(); assert.eq(SpiderWebs.lists(s, now).webs.length, 0);
      cache.set('0,0', { spiderPathWebs: list }); assert.eq(SpiderWebs.lists(s, now).webs.length, 1);
      s.depth = 1; assert.eq(SpiderWebs.lists(s, now).webs.length, 0);
    } finally { WorldGen.tileCache = original; }
  });
})();
