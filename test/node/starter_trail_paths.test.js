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
  test('chest trails: the starter relic chest gets a trail from Home\'s door until it is opened', () => {
    const pass = c => Math.abs(c.cellIX) < 20 && Math.abs(c.cellIY) < 20 && !(c.cellIX === 3 && c.cellIY > -6);
    const route = Starter.trailRoute(cell(6, 0), null, pass, next, 0, cell(0, 0));
    assert.eq(key(route[0]), '0,0', 'starts at the reachable cell nearest the door');
    assert.eq(key(route[route.length - 1]), '6,0', 'ends at the chest');
    assert.truthy(route.every(pass), 'round the wall, never through it');
    const prior = [...WorldGen.tileCache];
    WorldGen.tileCache.clear();
    const N = 64, m = 7, at = (x, y) => ({ x: (x + 0.5) * m, y: (y + 0.5) * m });
    const relic = { id: 'chest_start_0_0_5', kind: 'chest', ...at(32 + VIEW_CELLS, 32) };
    const crate = { id: 'chest_start_0_0_1', kind: 'chest', crate: true, ...at(34, 32) };
    const entry = { grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), cellsPerEdge: N, objects: [crate, relic], spawnWhy: new Uint16Array(N * N) };
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
    const scene = { depth: 0, cellM: m, cellsPerTile: N, tileEdgeM: N * m, mPerPx: N * m / WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: at(32, 32),
      save: { starterCratesAt: at(32, 32), opened: [] } };
    try {
      const paths = Starter.trailPaths(scene, 0);
      const trail = paths.find(p => p.id === relic.id);
      assert.truthy(trail, 'the wooden tool chest has a trail');
      assert.falsy(paths.some(p => p.id === crate.id), 'supply crates still get none');
      const first = trail.points[0];
      assert.lte(Math.hypot(first.x - scene.save.starterCratesAt.x, first.y - scene.save.starterCratesAt.y), m,
        'it begins at the door');
      scene.save.opened.push(relic.id);
      assert.falsy(Starter.trailPaths(scene, 2000).some(p => p.id === relic.id), 'opening retires it');
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
  test('chest trails: the dashed line uses half-opacity ink', () => {
    assert.eq(Starter.TRAIL_STYLE.colour, 0x000000);
    assert.eq(Starter.TRAIL_STYLE.alpha, 0.375);
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
  test('chest trails: radial clipping includes crossings with both ends outside and excludes tangencies', () => {
    const target = { x: 1000000, y: -1000000 };
    const p = (x, y) => ({ x: target.x + x, y: target.y + y });
    const clip = (a, b) => Starter.trailSegmentRange(a, b, target, 25);
    assert.eq(JSON.stringify(clip(p(-10, 0), p(10, 0))), '[0.25,0.75]');
    assert.eq(JSON.stringify(clip(p(0, 0), p(10, 0))), '[0,0.5]');
    assert.eq(JSON.stringify(clip(p(-10, 0), p(0, 0))), '[0.5,1]');
    assert.eq(clip(p(-10, 5), p(10, 5)), null, 'a tangent has no visible length');
    assert.eq(clip(p(6, 0), p(6, 9)), null);
    assert.eq(clip(p(6, 0), p(6, 0)), null, 'outside zero-length segment');
    assert.eq(JSON.stringify(clip(p(0, 0), p(0, 0))), '[0,1]');
  });

  test('chest trails: draw cutoff tracks subcell approach and retreat without shifting dashes or cached routes', () => {
    const old = Starter.trailPaths;
    const paths = [{ id: 'cutoff', target: { x: 0, y: 0 },
      points: [{ x: 20, y: 0 }, { x: 13, y: 0 }, { x: 0, y: 0 }] }];
    const original = JSON.stringify(paths);
    const scene = { cellM: 7, cellsPerTile: 32, mPerPx: 7 * 32 / WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      playerM: { x: 30, y: 0 }, peekM: { x: 0, y: 0 }, viewCenterX: 176, viewCenterY: 200,
      cobbleContainer: { add() {} } };
    let strokes = [], segments = [], pen;
    const gfx = { clear() { strokes = []; segments = []; }, lineStyle() {}, beginPath() {}, strokePath() {},
      moveTo(x, y) { pen = screenToWorldMeters(scene, x, y); },
      lineTo(x, y) { const end = screenToWorldMeters(scene, x, y); strokes.push([pen.x, end.x]); segments.push([pen, end]); } };
    scene.add = { graphics() { return gfx; } };
    Starter.trailPaths = () => paths;
    const near = (actual, expected) => assert.inRange(actual, expected - 1e-6, expected + 1e-6);
    try {
      Render.drawChestTrails(scene);
      const full = strokes.map(pair => pair.slice());
      for (const playerX of [2.5, 2.25, 2.1, 2.5, 0, 30]) {
        scene.playerM.x = playerX;
        Render.drawChestTrails(scene);
        const cutoff = playerX + scene.cellM * Starter.TRAIL_STYLE.behindCells;
        const expected = full.filter(pair => pair[1] < cutoff)
          .map(pair => [Math.min(pair[0], cutoff), pair[1]]);
        assert.eq(strokes.length, expected.length);
        strokes.forEach((pair, i) => { near(pair[0], expected[i][0]); near(pair[1], expected[i][1]); });
        assert.eq(JSON.stringify(paths), original, 'draw never trims or mutates the cached route');
      }
      paths[0].points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }];
      // Stand so the visible circle is exactly one cell around the target.
      scene.playerM.x = scene.cellM * (1 - Starter.TRAIL_STYLE.behindCells);
      Render.drawChestTrails(scene);
      assert.truthy(segments.some(([a, b]) => b.y > 0), 'route reenters the visible circle');
      for (const [a, b] of segments) {
        assert.lte(Math.hypot(a.x, a.y), scene.cellM + 1e-6);
        assert.lte(Math.hypot(b.x, b.y), scene.cellM + 1e-6);
        assert.truthy((Math.abs(a.y) < 1e-6 && Math.abs(b.y) < 1e-6)
          || (Math.abs(a.x - a.y) < 1e-6 && Math.abs(b.x - b.y) < 1e-6),
          'visible runs stay on original segments instead of bridging the hidden bend');
      }
    } finally { Starter.trailPaths = old; }
  });
})();
