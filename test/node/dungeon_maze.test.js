(function () {
  const W = WorldGen, T = W.T, N = 64, edge = N * W.CELL_M;
  const shapes = {
    broad: (x, y) => Math.abs(x) <= 18 && Math.abs(y) <= 15,
    concave: (x, y) => Math.abs(x) <= 18 && Math.abs(y) <= 15 && !(x > 5 && y < -3),
    narrow: (x, y) => Math.abs(x) <= 19 && Math.abs(y) <= 4,
    small: (x, y) => Math.abs(x) <= 5 && Math.abs(y) <= 5,
    lobes: (x, y) => (Math.abs(x + 11) <= 7 && Math.abs(y) <= 8) ||
      (Math.abs(x - 11) <= 7 && Math.abs(y) <= 8) || (Math.abs(x) <= 11 && Math.abs(y) <= 1)
  };
  function fixture(depth, shape = shapes.broad, start = 951001, cx = 32) {
    const ty = 951101, cy = 32;
    let tx, anchor;
    for (tx = start; tx < start + 10000; tx++) {
      anchor = { kind: 'grove', owned: true,
        gx: tx * 4096 + (cx + .5) * 64, gy: ty * 4096 + (cy + .5) * 64,
        lx: (cx + .5) * 64, ly: (cy + .5) * 64, upm: edge / 4096 };
      if (CaveAreas.select(anchor, depth) === 'dungeon_maze') break;
    }
    assert.lt(tx, start + 10000, 'maze is selectable on floor ' + depth);
    const source = new Uint8Array(N * N).fill(T.PARK), coverage = new Uint16Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      if (shape(x - cx, y - cy)) coverage[y * N + x] = 1;
    const surface = { status: 'ready', depth: 0, cellsPerEdge: N, tileEdgeM: edge,
      grid: source.slice(), baseGrid: source.slice(), genObjects: [], objects: [], wildplants: [],
      zone: { anchors: [anchor], coverage,
        caveSource: { grid: source, objects: [], wildplants: [], spawnWhy: new Uint16Array(N * N) } } };
    return { surface, grid: new Uint8Array(N * N).fill(T.CAVE_FLOOR), N, tx, ty,
      tileEdgeM: edge, depth, objects: [], occupied: new Set(), spawnWhy: new Uint16Array(N * N), cx, cy };
  }
  const frame = f => W.tileFrame({ cellsPerEdge: N }, f.tx, f.ty, edge);
  const idx = (f, o) => { const p = frame(f).cellOf(o.x, o.y); return p.iy * N + p.ix; };
  const payload = p => JSON.stringify({ reserved: [...p.reserved], terrain: [...p.terrain],
    objects: p.objects, encounters: p.encounters });
  function flood(f, p) {
    const start = f.cy * N + f.cx, reached = new Set([start]), queue = [start];
    assert.eq(f.grid[start], T.CAVE_FLOOR, 'grove focus remains open');
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % N, y = Math.floor(i / N);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
        const j = ny * N + nx;
        if (p.reserved.has(j) && f.grid[j] === T.CAVE_FLOOR && !reached.has(j)) {
          reached.add(j); queue.push(j);
        }
      }
    }
    return reached;
  }

  test('dungeon maze: canonical wall mask matches the reviewed layout-lab braid and repeats with open seams', () => {
    // Independent reference from geometricPositions('maze_braid') in the
    // reviewed lab: gx=34, gy=33, mazeStep=3, loops=77, seed=2718.
    let count = 0, hash = 2166136261;
    for (let y = 0; y < 33; y++) for (let x = 0; x < 34; x++) {
      const wall = CaveAreas.mazeWallAt(x - 17, y - 16);
      if (wall) count++;
      hash = Math.imul(hash ^ (wall ? 49 : 48), 16777619) >>> 0;
      if (x === 0 || x === 33 || y === 0 || y === 32)
        assert.falsy(wall, 'repeated blocks have an open perimeter');
      for (const [dx, dy] of [[34, 0], [-34, 0], [0, 33], [0, -33], [68, -66]])
        assert.eq(CaveAreas.mazeWallAt(x - 17 + dx, y - 16 + dy), wall,
          'canonical phase is stable across positive and negative repetitions');
    }
    assert.eq(count, 381, 'reviewed wall-cell count');
    assert.eq(hash, 2687869564, 'reviewed row-major wall-mask fingerprint');
  });

  test('dungeon maze: irregular, narrow, small and lobed footprints keep connected floor and native rock walls', () => {
    for (const depth of [1, 2]) for (const [name, shape] of Object.entries(shapes)) {
      const f = fixture(depth, shape), p = CaveAreas.plan(f);
      assert.eq(p.areas.length, 1, name + ' D' + depth + ' accepts its actual footprint');
      assert.eq(p.areas[0].kind, 'dungeon_maze');
      assert.eq(payload(p), payload(CaveAreas.plan(f)), 'deterministic regeneration');
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      const reached = flood(f, p);
      for (const i of p.reserved) {
        assert.eq(f.surface.zone.coverage[i], 1, 'area fits coverage');
        if (f.grid[i] === T.CAVE_FLOOR) assert.truthy(reached.has(i), name + ' floor reaches the focus');
      }
      assert.gt([...p.reserved].filter(i => f.grid[i] === T.CAVE_WALL).length, 0, name + ' contains mineable terrain walls');
      assert.falsy(p.objects.some(o => o.kind === 'mineralrock'), 'wall fill uses terrain, not individual rock props');
      for (let i = 0; i < f.grid.length; i++) if (!f.surface.zone.coverage[i])
        assert.eq(f.grid[i], T.CAVE_FLOOR, 'maze does not extend outside its owner');
    }
  });

  test('dungeon maze: protected source islands, through routes and landmark approaches stay intact', () => {
    for (const depth of [1, 2]) {
      const f = fixture(depth), protectedCells = [];
      for (const [k, terrain, why] of [[0, T.BUILDING, 0], [1, T.WATER, 0],
        [2, T.ROAD, W.SPAWN_WHY.ROAD], [3, T.PARK, W.SPAWN_WHY.FARMLAND],
        [4, T.PARK, W.SPAWN_WHY.GOLF]]) {
        const i = (f.cy - 7) * N + f.cx - 8 + k;
        f.surface.zone.caveSource.grid[i] = terrain;
        f.surface.zone.caveSource.spawnWhy[i] = why;
        f.spawnWhy[i] = why & W.SPAWN_WHY_ALL_FLOORS;
        f.grid[i] = T.CAVE_WALL;
        protectedCells.push(i);
      }
      f.routeLane = new Set();
      for (let x = f.cx - 18; x <= f.cx + 18; x++) f.routeLane.add((f.cy + 5) * N + x);
      const landmark = { id: 'maze-stairs', kind: 'staircase', ...frame(f).centre(f.cx + 7, f.cy - 3) };
      f.objects.push(landmark); f.occupied.add(idx(f, landmark));
      const before = JSON.stringify(landmark), p = CaveAreas.plan(f);
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      assert.eq(p.areas.length, 1);
      assert.eq(JSON.stringify(landmark), before, 'fixed landmark stays at its original position');
      for (const i of protectedCells) {
        assert.eq(f.grid[i], T.CAVE_WALL, 'excluded source island is not carved');
        assert.falsy(p.reserved.has(i), 'protected land is not claimed');
      }
      const reached = flood(f, p);
      for (const i of f.routeLane) {
        assert.eq(f.grid[i], T.CAVE_FLOOR, 'through route stays open');
        assert.truthy(reached.has(i), 'through route connects to focus');
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        assert.eq(f.grid[(f.cy - 3 + dy) * N + f.cx + 7 + dx], T.CAVE_FLOOR, 'landmark retains its approach');
    }
  });

  test('dungeon maze: focus has one shrine or T3 treasure and enemies match the floor roster', () => {
    const rewardKinds = new Set();
    for (const depth of [1, 2]) for (const start of [951001, 951101, 951201, 951301, 951401, 951501]) {
      const f = fixture(depth, shapes.broad, start), p = CaveAreas.plan(f);
      const rewards = p.objects.filter(o => o.kind === 'grove_shrine' || (o.kind === 'chest' && !o.barrel));
      assert.eq(rewards.length, 1, 'one focus reward');
      const reward = rewards[0]; rewardKinds.add(reward.kind);
      assert.eq(idx(f, reward), f.cy * N + f.cx, 'reward sits at grove focus');
      if (reward.kind === 'chest') assert.eq(chestTier(reward), 3, 'actual loot and art tier are T3');
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      const reached = flood(f, p), used = new Set();
      assert.gt(p.encounters.length, 0, 'maze has authored monsters');
      for (const enemy of p.encounters) {
        const row = EnemyRoster.get(enemy.kind), i = idx(f, enemy);
        assert.truthy(row && row.cave, 'enemy has cave spawn data');
        assert.lte(row.cave.minDepth, depth);
        if (row.cave.maxDepth != null) assert.gte(row.cave.maxDepth, depth);
        assert.truthy(reached.has(i), 'monster stands in reachable maze corridor');
        assert.falsy(used.has(i), 'monster seats do not overlap'); used.add(i);
        assert.falsy(i === idx(f, reward), 'reward seat stays clear');
      }
    }
    assert.eq(rewardKinds.size, 2, 'deterministic world includes both reward alternatives');
  });

  test('dungeon maze: clipped tile-edge coverage still places and remains connected', () => {
    for (const depth of [1, 2]) {
      const f = fixture(depth, shapes.broad, 951001, 5), p = CaveAreas.plan(f);
      assert.eq(p.areas.length, 1, 'edge does not force a circular-fit rejection');
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      const reached = flood(f, p);
      for (const i of p.reserved) if (f.grid[i] === T.CAVE_FLOOR)
        assert.truthy(reached.has(i), 'clipped floor connects');
    }
  });

  test('dungeon maze: existing mirrored focus reward is replaced once while a blocked focus preserves its old approach', () => {
    for (const depth of [1, 2]) for (const blocked of [false, true]) {
      const f = fixture(depth), anchor = f.surface.zone.anchors[0];
      const source = { id: 'surface-grove-reward', kind: 'chest', poiClass: 'park',
        _poiAt: `${anchor.lx},${anchor.ly}` };
      f.surface.genObjects.push(source);
      const mirror = { id: source.id + '_d' + depth, kind: 'chest', caveOf: source.id,
        poiClass: 'park', depth, ...frame(f).centre(f.cx + 7, f.cy + 7) };
      f.objects.push(mirror); f.occupied.add(idx(f, mirror));
      if (blocked) {
        const stairs = { id: 'occupied-focus-stairs', kind: 'staircase', ...frame(f).centre(f.cx, f.cy) };
        f.objects.push(stairs); f.occupied.add(idx(f, stairs));
      }
      const before = JSON.stringify(f.objects), p = CaveAreas.plan(f);
      assert.eq(JSON.stringify(f.objects), before, 'planning does not mutate live reward objects');
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      const rewards = f.objects.filter(o => o.kind === 'chest' || o.kind === 'grove_shrine');
      assert.eq(rewards.length, 1, 'no duplicate reward is minted beside the mirror');
      assert.eq(rewards[0].id, mirror.id, 'existing finite reward identity remains stable');
      if (blocked) {
        assert.eq(rewards[0], mirror, 'blocked focus leaves existing reward in place');
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
          assert.eq(f.grid[(f.cy + 7 + dy) * N + f.cx + 7 + dx], T.CAVE_FLOOR,
            'unmoved mirror retains an open approach');
      } else {
        assert.eq(idx(f, rewards[0]), f.cy * N + f.cx, 'own mirror becomes the central reward');
        if (rewards[0].kind === 'chest') {
          assert.eq(chestTier(rewards[0]), 3);
          assert.eq(rewards[0].caveOf, source.id, 'surface provenance survives replacement');
          assert.eq(rewards[0].poiClass, mirror.poiClass, 'chest can still mirror on lower floors');
        }
      }
    }
  });

  test('dungeon maze: disconnected rock-only fragments stay sealed and anchor ordering preserves identities', () => {
    const shape = (x, y) => (Math.abs(x) <= 7 && Math.abs(y) <= 7) ||
      (x >= 13 && x <= 19 && Math.abs(y) <= 5);
    const f = fixture(2, shape);
    for (let y = f.cy - 5; y <= f.cy + 5; y++) for (let x = f.cx + 13; x <= f.cx + 19; x++)
      f.grid[y * N + x] = T.CAVE_WALL;
    const p = CaveAreas.plan(f), before = payload(p);
    assert.eq(p.areas.length, 1);
    for (let y = f.cy - 5; y <= f.cy + 5; y++) for (let x = f.cx + 13; x <= f.cx + 19; x++) {
      assert.falsy(p.reserved.has(y * N + x), 'inaccessible fragment has no authored claim');
      assert.falsy(p.terrain.has(y * N + x), 'solid fragment is not opened without access');
    }
    f.surface.zone.anchors.unshift({ kind: 'seep', gx: 1, gy: 1 });
    for (let i = 0; i < f.surface.zone.coverage.length; i++) if (f.surface.zone.coverage[i])
      f.surface.zone.coverage[i] = 2;
    assert.eq(payload(CaveAreas.plan(f)), before, 'array ordering does not reroll the maze or its rewards');
    CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
    const reached = flood(f, p);
    for (const i of p.reserved) if (f.grid[i] === T.CAVE_FLOOR) assert.truthy(reached.has(i));
  });

  test('dungeon maze: native wall mining persists across regenerated terrain and stays scoped to its floor', () => {
    const lift = name => {
      const start = SCENE_SRC.indexOf(`\n  ${name}(`), end = SCENE_SRC.indexOf('\n  }', start) + 4;
      return new Function('WorldGen', 'cellKeyFromAbsCell', 'absCellToTile',
        `return ({${SCENE_SRC.slice(start, end)}}).${name};`)(W, cellKeyFromAbsCell, absCellToTile);
    };
    const dig = lift('digCaveWall'), restore = lift('_applyDugWalls');
    for (const depth of [1, 2]) {
      const f = fixture(depth), p = CaveAreas.plan(f), key = W.tileKey(f.tx, f.ty);
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      const i = [...p.reserved].find(i => f.grid[i] === T.CAVE_WALL);
      assert.truthy(i != null, 'fixture has a native terrain wall');
      const ix = i % N, iy = Math.floor(i / N), save = {};
      const scene = { depth, cellsPerTile: N, dugWallSet: bindIdSet(save, 'dugWalls') };
      const entry = { grid: f.grid, cellsPerEdge: N, depth };
      W.setDepth(depth).set(key, entry);
      try {
        dig.call(scene, f.tx, f.ty, ix, iy, f.tx * N + ix, f.ty * N + iy);
        assert.eq(entry.grid[i], T.CAVE_FLOOR, 'ordinary mining opens the maze wall');
        assert.eq(save.dugWalls.length, 1, 'ordinary saved mining ledger records it');
        const fresh = fixture(depth), regenerated = CaveAreas.plan(fresh);
        CaveAreas.apply(regenerated, fresh.grid, fresh.objects, [], fresh.occupied);
        assert.eq(fresh.grid[i], T.CAVE_WALL, 'world generation reconstructs its canonical wall');
        const saved = JSON.parse(JSON.stringify(save));
        const returning = { depth, cellsPerTile: N, dugWallSet: bindIdSet(saved, 'dugWalls') };
        restore.call(returning, { grid: fresh.grid, cellsPerEdge: N, depth: depth + 1 }, f.tx, f.ty);
        assert.eq(fresh.grid[i], T.CAVE_WALL, 'mining on one floor does not alter another');
        restore.call(returning, { grid: fresh.grid, cellsPerEdge: N, depth }, f.tx, f.ty);
        assert.eq(fresh.grid[i], T.CAVE_FLOOR, 'saved passage reopens after regeneration');
      } finally {
        W.setDepth(depth).delete(key);
        W.setDepth(0);
      }
    }
  });

  test('dungeon maze: actual floor loading retains walls, reward and encounters through ambient generation', async () => {
    for (const depth of [1, 2]) {
      const f = fixture(depth, shapes.concave), key = W.tileKey(f.tx, f.ty);
      W.setDepth(0).set(key, f.surface);
      try {
        const entry = await W.loadTile.atDepth(depth, f.tx, f.ty, 49), p = entry.caveAreas;
        assert.eq(p.areas.length, 1);
        assert.eq(p.areas[0].kind, 'dungeon_maze');
        assert.gt([...p.terrain].filter(([, terrain]) => terrain === T.CAVE_WALL).length, 0);
        for (const [i, terrain] of p.terrain) assert.eq(entry.grid[i], terrain, 'later generation preserves authored terrain');
        for (const i of p.reserved) {
          assert.truthy(entry.undergroundReserved.has(i));
          assert.eq(W.variantOwnerAt(entry, i), 'cave');
        }
        const rewards = entry.objects.filter(o => o.caveArea === p.areas[0].id &&
          (o.kind === 'grove_shrine' || (o.kind === 'chest' && !o.barrel)));
        assert.eq(rewards.length, 1, 'loader retains exactly one focus reward');
        assert.gt(p.encounters.length, 0);
        for (const enemy of p.encounters) assert.eq(entry.grid[idx(f, enemy)], T.CAVE_FLOOR);
        const before = payload(p);
        W.setDepth(depth).delete(key);
        assert.eq(payload((await W.loadTile.atDepth(depth, f.tx, f.ty, 49)).caveAreas), before,
          're-entry preserves wall geometry, reward identity and monster seats');
      } finally {
        for (const d of [0, 1, 2]) W.setDepth(d).delete(key);
        W.setDepth(0);
      }
    }
  });
})();
