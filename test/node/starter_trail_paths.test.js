(function () {
  const cell = (x, y) => ({ cellIX: x, cellIY: y });
  const next = (c, dx, dy) => cell(c.cellIX + dx, c.cellIY + dy);
  const key = c => `${c.cellIX},${c.cellIY}`;
  test('chest trails: routes and rounded bends avoid blocked cells and diagonal shortcuts', () => {
    const blocked = new Set(['1,0', '1,1', '1,2']);
    const pass = c => Math.abs(c.cellIX) <= 4 && Math.abs(c.cellIY) <= 4 && !blocked.has(key(c));
    const route = Starter.trailRoute(cell(0, 0), cell(3, 0), pass, next);
    assert.gt(route.length, 4, 'detours around the wall');
    assert.eq(key(route[0]), '0,0');
    assert.eq(key(route[route.length - 1]), '3,0');
    for (let i = 1; i < route.length; i++) {
      assert.truthy(pass(route[i]));
      assert.eq(Math.abs(route[i].cellIX - route[i - 1].cellIX) + Math.abs(route[i].cellIY - route[i - 1].cellIY), 1);
    }
    const points = Starter.smoothTrail(route.map(c => ({ x: c.cellIX + 0.5, y: c.cellIY + 0.5 })), 1);
    for (let i = 1; i < points.length; i++) {
      for (let j = 0; j <= 20; j++) {
        const t = j / 20, a = points[i - 1], b = points[i];
        assert.truthy(pass(cell(Math.floor(a.x + (b.x - a.x) * t), Math.floor(a.y + (b.y - a.y) * t))), 'entire vector remains on allowed cells');
      }
    }
    assert.eq(Starter.trailRoute(cell(0, 0), cell(1, 0), pass, next).length, 0, 'blocked destination gets no straight fallback');
    assert.eq(Starter.trailRoute(cell(0, 0), cell(1, 1), c => ['0,0', '1,1'].includes(key(c)), next).length, 0, 'diagonally touching cells are disconnected');
  });
  test('chest trails: optional origins are stable, nearby and connected to their chest', () => {
    const pass = c => Math.abs(c.cellIX) < 10 && Math.abs(c.cellIY) < 10 && !(c.cellIX === 1 && c.cellIY >= 0);
    const route = Starter.trailRoute(cell(0, 0), null, pass, next, 678);
    assert.inRange(route.length, 5, 8);
    assert.eq(key(route[route.length - 1]), '0,0');
    assert.eq(route.map(key).join('|'), Starter.trailRoute(cell(0, 0), null, pass, next, 678).map(key).join('|'));
    assert.truthy(route.every(pass));
  });

  test('chest trails: live masks, opening, caching and five-path total are respected', () => {
    const prior = [...WorldGen.tileCache];
    WorldGen.tileCache.clear();
    const N = 64, m = 7, at = (x, y) => ({ x: (x + 0.5) * m, y: (y + 0.5) * m });
    const starter = { id: 'chest_start_test', kind: 'chest', crate: true, ...at(35, 32) };
    const others = Array.from({ length: 5 }, (_, i) => ({ id: 'treasure' + i, kind: 'chest', tierSeed: 3, ...at(30 + i, 37) }));
    const entry = { grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), cellsPerEdge: N, objects: [starter, ...others], spawnWhy: new Uint16Array(N * N) };
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
    let scans = 0;
    const scene = { depth: 0, cellM: m, cellsPerTile: N, tileEdgeM: N * m, mPerPx: N * m / WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: at(32, 32),
      save: { starterCratesAt: at(32, 32), opened: [] }, _nearestStarterCrate() { scans++; return this.save.opened.includes(starter.id) ? null : starter; } };
    try {
      const paths = Starter.trailPaths(scene, 0);
      assert.eq(paths.length, 5, 'five total, including starter');
      assert.eq(paths[0].id, starter.id);
      assert.truthy(Starter.trailPaths(scene, 10) === paths, 'same-cell frames reuse actual routes');
      assert.eq(scans, 1);
      const extra = paths.find(p => p.id === 'treasure0');
      scene.playerM = at(31, 32);
      const moved = Starter.trailPaths(scene, 20).find(p => p.id === 'treasure0');
      assert.eq(JSON.stringify(extra.points), JSON.stringify(moved.points), 'optional trail is independent of player movement');
      scene.save.opened.push(starter.id, 'treasure0');
      assert.falsy(Starter.trailPaths(scene, 30).some(p => p.id === starter.id || p.id === 'treasure0'), 'opening removes paths immediately');
      entry.spawnWhy[32 * N + 31] = WorldGen.SPAWN_WHY.SENSITIVE;
      scene.save.opened = [];
      const suppressed = Starter.trailPaths(scene, 1100);
      assert.falsy(suppressed.some(p => p.id === starter.id), 'no player route starts on suppressed ground');
      scene.depth = 1;
      assert.eq(Starter.trailPaths(scene, 1200).length, 0);
    } finally {
      WorldGen.tileCache.clear();
      for (const [k, e] of prior) WorldGen.tileCache.set(k, e);
    }
  });
})();
