(() => {
  test('bone cache: accepted loot proportions and independent skeleton disturbance', () => {
    const counts = { empty: 0, supplies: 0, scroll: 0 }, skeletons = { empty: 0, supplies: 0, scroll: 0 };
    for (let i = 0; i < 10000; i++) {
      const o = { id: `bone-cache-test-${i}` }, got = boneCacheReward(o);
      const bucket = got.kind === 'empty' ? 'empty' : got.id === 'bones_scroll' ? 'scroll' : 'supplies';
      counts[bucket]++;
      if (boneCacheSkeleton(o)) skeletons[bucket]++;
      if (bucket === 'supplies') assert.truthy(['torch', 'rope', 'trap_disarm_kit'].includes(got.id));
      assert.eq(JSON.stringify(got), JSON.stringify(boneCacheReward(o)));
    }
    assert.inRange(counts.empty / 10000, .48, .52);
    assert.inRange(counts.supplies / 10000, .38, .42);
    assert.inRange(counts.scroll / 10000, .08, .12);
    for (const bucket in counts) assert.inRange(skeletons[bucket] / counts[bucket], .21, .29);
  });
  test('bone cache: search is permanent, repeats give nothing and no skeleton', () => {
    const scene = makeScene(), save = { opened: [] };
    let raised = 0; scene._raiseBoneCacheSkeleton = () => raised++;
    let o;
    for (let i = 0; i < 1000; i++) {
      o = { kind: 'bone_cache', id: `empty-bones-${i}`, depth: 1 };
      if (boneCacheReward(o).kind === 'empty' && boneCacheSkeleton(o)) break;
    }
    const ctx = makeCtx(scene, save);
    INTERACTABLES.bone_cache.custom(ctx, o);
    INTERACTABLES.bone_cache.custom(ctx, o);
    assert.eq(save.opened.length, 1); assert.eq(raised, 1); assert.truthy(ctx.dirty);
    assert.truthy(isSpent(o, { opened: new Set(save.opened) }));
  });
  test('bone cache: full reward stack leaves the cache and skeleton untouched', () => {
    let o, got;
    for (let i = 0; i < 100; i++) {
      o = { kind: 'bone_cache', id: `bag-bones-${i}`, depth: 1 }; got = boneCacheReward(o);
      if (got.kind === 'item') break;
    }
    const save = { opened: [], inv: [{ id: got.id, count: 999 }] }, scene = makeScene();
    let raised = 0; scene._raiseBoneCacheSkeleton = () => raised++;
    INTERACTABLES.bone_cache.custom(makeCtx(scene, save), o);
    assert.eq(save.opened.length, 0); assert.eq(raised, 0);
  });
  test('bone cache: an awakened skeleton restores once, and stays defeated', () => {
    const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    const entry = { creatures: [] }, o = { id: 'persisted-cache', x: 25, y: 25, depth: 1 };
    const scene = Object.assign(new SceneCreatures(), { tileEdgeM: 200, save: { caught: [] } });
    try {
      WorldGen.tileCache.set(key, entry);
      scene._raiseBoneCacheSkeleton(o); scene._raiseBoneCacheSkeleton(o);
      assert.eq(entry.creatures.length, 1);
      scene.save.caught.push(entry.creatures[0].id); entry.creatures = [];
      scene._raiseBoneCacheSkeleton(o); assert.eq(entry.creatures.length, 0);
    } finally {
      if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
    }
  });
  test('bone cache: sm road galleries cluster caches and reserve a strong level guard', () => {
    const N = 20, edge = 200, W = WorldGen, grid = new Uint8Array(N * N).fill(W.T.CAVE_FLOOR);
    const cells = Array.from({ length: 14 }, (_, i) => 10 * N + 3 + i);
    const route = { id: 'bone-route', routeKey: 'bone-route', street: true, theme: 'bone_gallery', cells,
      owner: { x: 30, y: 100 }, midpoint: { x: 100, y: 100 } };
    const plan = { N, tx: 0, ty: 0, tileEdgeM: edge, depth: 1,
      data: { grid: new Uint8Array(N * N).fill(W.T.ROAD) },
      routes: [route], routeAt: new Map(cells.map(i => [i, route])), lane: new Set(cells), streetCells: new Set(cells) };
    const objects = [], occupied = new Set();
    Underground.decorate(plan, grid, objects, [], occupied);
    const bones = objects.filter(o => o.kind === 'bone_cache');
    assert.inRange(bones.length, 3, 6); assert.eq(plan.boneGuards.length, 1);
    const guard = plan.boneGuards[0], rows = EnemySpawns.caveRows(1);
    assert.eq(EnemyRoster.get(guard.kind).tier, Math.max(...rows.map(r => r.tier)));
    assert.truthy(bones.every(o => o.x !== guard.x || o.y !== guard.y));
    plan.depth = 2;
    const deeper = []; Underground.decorate(plan, grid, deeper, [], new Set());
    assert.eq(plan.boneGuards.length, 1);
    assert.eq(EnemyRoster.get(plan.boneGuards[0].kind).tier, Math.max(...EnemySpawns.caveRows(2).map(r => r.tier)));
    route.street = false;
    const pathObjects = []; Underground.decorate(plan, grid, pathObjects, [], new Set());
    assert.eq(pathObjects.filter(o => o.kind === 'bone_cache').length, 0);
    route.street = true;
    plan.data.why = new Uint16Array(N * N).fill(W.SPAWN_WHY.PRIVATE);
    const privateObjects = []; Underground.decorate(plan, grid, privateObjects, [], new Set());
    assert.eq(privateObjects.filter(o => o.kind === 'bone_cache').length, 0);
    assert.eq(plan.boneGuards.length, 0);
    plan.data.why = null;
    const blocked = [{ kind: 'staircase', id: 'stairs', x: 95, y: 105 }];
    Underground.decorate(plan, grid, blocked, [], new Set([10 * N + 9]));
    assert.truthy(blocked.filter(o => o.kind === 'bone_cache').every(o => Math.abs(o.x - 95) > 10));

  });
})();
