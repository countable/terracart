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
    const pass = c => Math.abs(c.cellIX) < 20 && Math.abs(c.cellIY) < 20 && !(c.cellIX === 1 && c.cellIY >= 0);
    const route = Starter.trailRoute(cell(0, 0), null, pass, next, 678);
    const [near, far] = Starter.TRAIL_STYLE.startCells;
    assert.inRange(route.length, near + 1, far + 1, 'starts startCells walking cells out');
    assert.eq(key(route[route.length - 1]), '0,0');
    assert.eq(route.map(key).join('|'), Starter.trailRoute(cell(0, 0), null, pass, next, 678).map(key).join('|'));
    assert.truthy(route.every(pass));
  });

  test('chest trails: live masks, opening, caching and the CHEST_TRAIL_LIMIT total are respected; crates get none', () => {
    const prior = [...WorldGen.tileCache];
    WorldGen.tileCache.clear();
    const N = 64, m = 7, at = (x, y) => ({ x: (x + 0.5) * m, y: (y + 0.5) * m });
    const crate = { id: 'chest_start_test', kind: 'chest', crate: true, ...at(35, 32) };
    const others = Array.from({ length: HomeArea.CHEST_TRAIL_LIMIT + 1 }, (_, i) => ({ id: 'treasure' + String(i).padStart(2, '0'), kind: 'chest', tierSeed: 3, ...at(26 + i, 37) }));
    const entry = { grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), cellsPerEdge: N, objects: [crate, ...others], spawnWhy: new Uint16Array(N * N) };
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
    const scene = { depth: 0, cellM: m, cellsPerTile: N, tileEdgeM: N * m, mPerPx: N * m / WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: at(32, 32),
      save: { starterCratesAt: at(32, 32), opened: [] } };
    try {
      const paths = Starter.trailPaths(scene, 0);
      assert.eq(paths.length, HomeArea.CHEST_TRAIL_LIMIT, 'the limit in total');
      assert.falsy(paths.some(p => p.id === crate.id), 'no guide to a crate');
      assert.truthy(Starter.trailPaths(scene, 10) === paths, 'same-cell frames reuse actual routes');
      const id = paths[0].id, extra = paths[0];
      scene.playerM = at(31, 32);
      const moved = Starter.trailPaths(scene, 20).find(p => p.id === id);
      assert.eq(JSON.stringify(extra.points), JSON.stringify(moved.points), 'optional trail is independent of player movement');
      scene.save.opened.push(id);
      assert.falsy(Starter.trailPaths(scene, 30).some(p => p.id === id), 'opening removes paths immediately');
      scene.depth = 1;
      assert.eq(Starter.trailPaths(scene, 1200).length, 0);
    } finally {
      WorldGen.tileCache.clear();
      for (const [k, e] of prior) WorldGen.tileCache.set(k, e);
    }
  });
  test('chest trails: X marks get a trail and show from afar; found ones lose it', () => {
    const prior = [...WorldGen.tileCache];
    WorldGen.tileCache.clear();
    const N = 64, m = 7, at = (x, y) => ({ x: (x + 0.5) * m, y: (y + 0.5) * m });
    const mark = { id: 'treasure_x_test', ...at(40, 40) };
    const entry = { grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), cellsPerEdge: N, objects: [], spawnWhy: new Uint16Array(N * N), treasure: mark };
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
    const scene = { depth: 0, cellM: m, cellsPerTile: N, tileEdgeM: N * m, mPerPx: N * m / WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: at(30, 30), save: { opened: [] } };
    try {
      assert.eq(Starter.trailPaths(scene, 0).map(p => p.id).join(), mark.id);
      assert.truthy(HiddenObjects.treasureHidden(scene.save, mark), 'still undiscovered by the feet');
      assert.truthy(Starter.isTrailTreasure(scene, mark), 'but the trail end shows and digs');
      scene.save.foundTreasures = [mark.id];
      assert.falsy(Starter.isTrailTreasure(scene, mark));
    } finally {
      WorldGen.tileCache.clear();
      for (const [k, e] of prior) WorldGen.tileCache.set(k, e);
    }
  });
  test('chest trails: the line is dark ink, not a pale wash', () => {
    assert.eq(Starter.TRAIL_STYLE.colour, 0x000000);
    assert.truthy(Starter.TRAIL_STYLE.alpha >= 0.7);
  });
  test('chest trails: treasure trails follow the player away from Home', () => {
    const prior = [...WorldGen.tileCache];
    WorldGen.tileCache.clear();
    const N = 64, m = 7, at = (x, y) => ({ x: (x + 0.5) * m, y: (y + 0.5) * m });
    const chest = { id: 'faraway', kind: 'chest', tierSeed: 2, ...at(40, 40) };
    const entry = { grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), cellsPerEdge: N, objects: [chest], spawnWhy: new Uint16Array(N * N) };
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
    const scene = { depth: 0, cellM: m, cellsPerTile: N, tileEdgeM: N * m, mPerPx: N * m / WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: at(36, 36),
      save: { starterCratesAt: at(2000, 2000), opened: [] } };
    try {
      const paths = Starter.trailPaths(scene, 0);
      assert.eq(paths.map(p => p.id).join(), 'faraway', 'a T2 chest near the player, far from Home');
      assert.truthy(HomeArea.isTrailChest(scene, chest), 'and it is a trail end for the bonus');
      scene.playerM = at(40 + HomeArea.CHEST_TRAIL_RADIUS_CELLS + 4, 40);
      assert.eq(Starter.trailPaths(scene, 2000).length, 0, 'out of the player\'s trail radius');
    } finally {
      WorldGen.tileCache.clear();
      for (const [k, e] of prior) WorldGen.tileCache.set(k, e);
    }
  });
})();
