// Ordinary rewards are zone rows; sparse POIs no longer create a refill target.
(function () {
  const W = WorldGen, N = 240;
  function context() {
    const grid = new Uint8Array(N * N).fill(W.T.GRASS);
    return { objects: [], grid, entry: { grid, cellsPerEdge: N }, N, tx: 3, ty: 9,
      tileEdgeM: N * W.CELL_M,
      spawnOpts: { occupied: new Set(), gameplayTiers: new Uint8Array(N * N).fill(GameplayTiers.CORE) } };
  }
  const run = c => W.runSteps(W.spawnAmbientCratesSteps(c));
  const ids = c => c.objects.filter(o => o.ambientCrate).map(o => o.id).sort().join();
  test('ambient reward rows: POI abundance never changes the eligible-cell roll', () => {
    const a = context(), b = context();
    b.objects.push(...Array.from({ length: 300 }, (_, i) => ({ kind: 'chest', id: 'poi-' + i, poiClass: 'school', x: -1, y: -1 })));
    run(a); run(b);
    assert.gt(a.objects.length, 0);
    assert.eq(ids(a), ids(b), 'there is no quota/deficit or threshold');
    assert.eq(run(a).added, 0, 'same IDs are not created twice');
  });
  test('ambient reward rows: safety and occupancy remove candidates without replacement', () => {
    const a = context(); run(a);
    const b = context(), first = a.objects[0];
    const ix = Math.floor((first.x - b.tx * b.tileEdgeM) / W.CELL_M), iy = Math.floor((first.y - b.ty * b.tileEdgeM) / W.CELL_M);
    b.spawnOpts.occupied.add(iy * N + ix); run(b);
    assert.eq(b.objects.length, a.objects.length - 1);
    assert.eq(ids(b), a.objects.filter(o => o.id !== first.id).map(o => o.id).sort().join());
    const blocked = context(); blocked.spawnOpts.gameplayTiers.fill(GameplayTiers.EXCLUDED);
    assert.eq(run(blocked).added, 0);
  });
  test('ambient reward rows: most specific road and Nexus ownership blocks terrain refill', () => {
    for (const kind of ['road', 'zone']) {
      const c = context();
      if (kind === 'road') { c.entry.streetArea = new Uint8Array(N * N).fill(1); c.entry.streetAreaVariants = new Uint8Array(N * N).fill(StreetVariants.VARIANT_BY_ID.orchard.code); }
      else c.entry.zone = { coverage: new Uint16Array(N * N).fill(1), anchors: [{ kind: 'grove', variant: 'meadow', key: 1 }] };
      assert.eq(run(c).added, 0, kind + ' has no ambient crate row');
    }
  });
  test('ambient reward rows: area expectation scales and frame metres do not reroll identities', () => {
    const a = context(), b = context(); b.tileEdgeM *= 2;
    const full = run(a); run(b); assert.eq(ids(a), ids(b));
    const half = context(); half.spawnOpts.gameplayTiers.fill(GameplayTiers.EXCLUDED, 0, N * N / 2);
    const part = run(half);
    assert.lt(Math.abs(full.expected / 2 - part.expected), 1e-8);
    assert.truthy(half.objects.every(o => a.objects.some(p => p.id === o.id)), 'area removal only removes candidates');
  });
  test('ambient reward rows: surface crate loot and opened identity remain compatible', () => {
    const c = context(); run(c);
    for (const o of c.objects) {
      assert.truthy(/^crate_ambient_3_9_/.test(o.id));
      assert.truthy(o.crate && o.ambientCrate); assert.eq(chestTier(o), 1);
      assert.falsy(restocks(o)); assert.eq(chestThemeFor(o), 'park');
    }
    W.seedChestTiers(c.objects);
    assert.truthy(c.objects.every(o => o.tierSeed === 1));
  });
  test('ambient reward rows: raster output never adds undeclared variant tier top-ups', () => {
    const layer = [{ name: 'landuse', features: [{ type: 3, tags: { class: 'park' }, geom: [[{ x: 0, y: 0 }, { x: 4096, y: 0 }, { x: 4096, y: 4096 }, { x: 0, y: 4096 }]] }] }];
    const r = W.rasterizeTile(layer, 64, 20, 20, 448);
    assert.eq(r.objects.filter(o => o.chestTopUp && !o.ambientCrate).length, 0);
    for (const o of r.objects.filter(o => o.ambientCrate)) {
      const ix = Math.floor((o.x - 20 * 448) / 7), iy = Math.floor((o.y - 20 * 448) / 7);
      assert.eq(SpawnPipeline.ownerAt(r, iy * 64 + ix).type, 'terrain');
    }
  });
})();
