(function () {
  function fixture(run) {
    const W = WorldGen, key = W.tileKey(0, 0), old = W.tileCache.get(key), veto = W.privateVetoAt;
    const entry = { _spawned: true, cellsPerEdge: 8, grid: new Uint8Array(64).fill(W.T.PARK),
      objects: [], roadMask: new Uint8Array(64), spawnWhy: new Uint32Array(64) };
    W.tileCache.set(key, entry); W.privateVetoAt = () => false;
    const scene = { depth: 0, cellsPerTile: 8, cellM: 8, tileEdgeM: 64, mPerPx: 64 / W.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 20, y: 20 },
      save: { opened: [], energy: 100 }, flashes: [], flash(s) { this.flashes.push(s); },
      cellAt(x, y) {
        const c = worldMetersToAbsCell(this, x, y), t = absCellToTile(this, c.cellIX, c.cellIY);
        return { ...t, ...c, loaded: W.tileCache.has(W.tileKey(t.tx, t.ty)) };
      } };
    const stones = [2, 3, 4].map((ix, i) => ({ kind: 'waystone', id: 'stone' + i,
      waystoneSet: 'way', waystoneCount: 3, x: ix * 8 + 4, y: 20 }));
    entry.objects.push(...stones);
    try { run(scene, entry, stones); } finally {
      if (old) W.tileCache.set(key, old); else W.tileCache.delete(key);
      W.privateVetoAt = veto;
    }
  }
  function walk(scene, stone, now) {
    scene.playerM = { x: stone.x, y: stone.y };
    Waystones.tick(scene, now);
  }
  test('waystones: grounded feet light stones; camera peeking and flight do not', () => fixture((s, e, stones) => {
    s.playerM.x = 4; s._peekM = { x: 16, y: 0 };
    Waystones.tick(s, 1000);
    assert.falsy(Waystones.isLit(stones[0], s.save, 1000));
    const flying = Conditions.flying;
    Conditions.flying = () => true;
    try { walk(s, stones[0], 2000); } finally { Conditions.flying = flying; }
    assert.falsy(Waystones.isLit(stones[0], s.save, 2000));
    walk(s, stones[0], 3000);
    assert.truthy(Waystones.isLit(stones[0], s.save, 3000));
    assert.falsy(Waystones.isLit(stones[1], s.save, 3000));
    assert.falsy(Waystones.isLit(stones[0], s.save, 3000 + Waystones.LIGHT_MS));
    s.depth = 1; walk(s, stones[1], 4000);
    assert.falsy(Waystones.isLit(stones[1], s.save, 4000));
  }));
  test('waystones: simultaneous set creates one T3 chest and remains lit after reload', () => fixture((s, e, stones) => {
    stones.forEach((o, i) => walk(s, o, 1000 + i * 1000));
    const chests = e.objects.filter(o => o.kind === 'chest');
    assert.eq(chests.length, 1); assert.eq(chestTier(chests[0]), 3);
    assert.lte(Math.hypot(chests[0].x - s.playerM.x, chests[0].y - s.playerM.y), 8 * Math.SQRT2);
    s.save = JSON.parse(JSON.stringify(s.save));
    assert.truthy(stones.every(o => Waystones.isLit({ ...o }, s.save, 1e12)));
    walk(s, stones[0], 1e12); assert.eq(e.objects.filter(o => o.kind === 'chest').length, 1);
    e.objects = stones.map(o => ({ ...o }));
    Waystones.restoreRewards(s); assert.eq(e.objects.filter(o => o.kind === 'chest').length, 1);
    s.save.opened.push(chests[0].id); e.objects = [...stones];
    Waystones.restoreRewards(s); assert.eq(e.objects.filter(o => o.kind === 'chest').length, 0);
    assert.truthy(stones.every(o => Waystones.isLit(o, s.save, 1e12)));
  }));
  test('waystones: expired lights, incomplete sets and other ways cannot complete a puzzle', () => fixture((s, e, stones) => {
    walk(s, stones[0], 1000);
    walk(s, stones[1], 1000 + Waystones.LIGHT_MS);
    walk(s, stones[2], 2000 + Waystones.LIGHT_MS);
    assert.falsy(s.save.waystoneSets?.way);
    assert.eq(e.objects.filter(o => o.kind === 'chest').length, 0);
    stones[0].waystoneSet = 'other-way';
    walk(s, stones[0], 3000 + Waystones.LIGHT_MS);
    assert.falsy(s.save.waystoneSets?.way);
    stones[0].waystoneSet = 'way';
    walk(s, stones[0], 4000 + Waystones.LIGHT_MS);
    assert.truthy(s.save.waystoneSets.way);
  }));
  test('waystones: a blocked reward seat preserves completion and retries safely', () => fixture((s, e, stones) => {
    e.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    stones.forEach((o, i) => walk(s, o, 1000 + i * 1000));
    assert.truthy(s.save.waystoneSets.way);
    assert.eq(e.objects.filter(o => o.kind === 'chest').length, 0);
    s.save = JSON.parse(JSON.stringify(s.save));
    e.spawnWhy.fill(0);
    walk(s, stones[2], 4000);
    assert.eq(e.objects.filter(o => o.kind === 'chest').length, 1);
  }));
})();
