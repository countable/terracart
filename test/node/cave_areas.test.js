(function () {
  const W = WorldGen, T = W.T, N = 64, edge = N * W.CELL_M, EXT = 4096;
  function fixture(cx = 32, cy = 32, firstTx = 940001) {
    const ty = 940101;
    let tx, anchor;
    for (tx = firstTx; tx < firstTx + 1000; tx++) {
      anchor = { kind: 'grove', key: `spring-test-${tx}`, owned: true,
        gx: tx * EXT + (cx + .5) * EXT / N, gy: ty * EXT + (cy + .5) * EXT / N,
        lx: (cx + .5) * EXT / N, ly: (cy + .5) * EXT / N, upm: edge / EXT };
      if (CaveAreas.select(anchor, 1) === 'spring_cave') break;
    }
    assert.lt(tx, firstTx + 1000, 'fixture finds a selected grove without overriding selection');
    const surfaceGrid = new Uint8Array(N * N).fill(T.PARK);
    const surface = { status: 'ready', depth: 0, cellsPerEdge: N, tileEdgeM: edge,
      grid: surfaceGrid, baseGrid: surfaceGrid.slice(), objects: [], genObjects: [], wildplants: [],
      zone: { anchors: [anchor], coverage: new Uint16Array(N * N).fill(1) } };
    return { surface, grid: new Uint8Array(N * N).fill(T.CAVE_FLOOR), N, tx, ty,
      tileEdgeM: edge, depth: 1, objects: [], occupied: new Set(), spawnWhy: new Uint16Array(N * N), cx, cy };
  }
  const at = (f, x, y) => ({ x: f.tx * edge + (x + .5) * W.CELL_M,
    y: f.ty * edge + (y + .5) * W.CELL_M });
  const index = (f, o) => Math.floor((o.y - f.ty * edge) / W.CELL_M) * N
    + Math.floor((o.x - f.tx * edge) / W.CELL_M);
  const snapshot = p => JSON.stringify({ areas: p.areas, reserved: [...p.reserved],
    terrain: [...p.terrain], objects: p.objects, wildplants: p.wildplants });

  test('cave areas: a relocated profile enables authored springs on another floor', () => {
    const f = fixture(), original = W.floorProfile;
    const spring = { ...original(1).caveAreas, weights: [{ id: 'spring_cave', weight: 1 }] };
    W.floorProfile = depth => ({ ...original(depth), caveAreas: depth === 4 ? spring : null });
    try {
      assert.eq(CaveAreas.select(f.surface.zone.anchors[0], 1), null);
      assert.eq(CaveAreas.plan(f).areas.length, 0);
      f.depth = 4;
      assert.eq(CaveAreas.select(f.surface.zone.anchors[0], 4), 'spring_cave');
      assert.eq(CaveAreas.plan(f).areas.length, 1, 'generation follows the profile');
    } finally { W.floorProfile = original; }
  });
  test('cave areas: anchor origin is identical across neighbouring observers', () => {
    const f = fixture(), a = f.surface.zone.anchors[0];
    for (const anchor of [a, { ...a, originGX: a.gx - 71.2, originGY: a.gy + 17.3 }]) {
      const own = ZoneVariants.anchorFrame(anchor, f);
      const next = ZoneVariants.anchorFrame(anchor, { N, tx: f.tx + 1, ty: f.ty - 1 });
      assert.eq(next.originX, own.originX); assert.eq(next.originY, own.originY);
      assert.eq(next.unit, own.unit);
      const here = own.local(own.originX, own.originY), there = next.local(next.originX, next.originY);
      assert.eq(there[0] + N, here[0]); assert.eq(there[1] - N, here[1]);
    }
  });

  test('cave areas: Spring reserves empty approaches and builds concentric pool and rings', () => {
    const f = fixture(), before = [...f.grid].join(), p = CaveAreas.plan(f);
    assert.eq(p.areas.length, 1); assert.gt(p.reserved.size, 150);
    assert.eq([...f.grid].join(), before, 'planning leaves terrain unchanged');
    assert.eq(f.objects.length, 0); assert.eq(f.occupied.size, 0);
    const plants = [];
    CaveAreas.apply(p, f.grid, f.objects, plants, f.occupied);
    assert.gt(p.terrain.size, 0); assert.gt(plants.length, 0); assert.gt(f.objects.length, 0);
    assert.eq(f.grid[f.cy * N + f.cx], T.CAVE_WALL, 'central source remains solid');
    assert.eq(f.grid[(f.cy + 1) * N + f.cx + 1], T.WATER, 'pool surrounds island');
    const props = new Set([...f.objects, ...plants].map(o => index(f, o)));
    for (let d = -8; d <= 8; d++) {
      assert.truthy(p.reserved.has(f.cy * N + f.cx + d));
      assert.truthy(p.reserved.has((f.cy + d) * N + f.cx));
      assert.falsy(props.has(f.cy * N + f.cx + d), 'east/west approach has no props');
      assert.falsy(props.has((f.cy + d) * N + f.cx), 'north/south approach has no props');
    }
    for (const plant of plants) {
      assert.eq(plant.crop, 'mushroom');
      const i = index(f, plant);
      assert.inRange(Math.hypot(i % N - f.cx, Math.floor(i / N) - f.cy), 4.6, 5.4,
        'mushroom ring matches authored radius');
    }
    for (const rock of f.objects) {
      assert.eq(rock.kind, 'mineralrock');
      const i = index(f, rock);
      assert.inRange(Math.hypot(i % N - f.cx, Math.floor(i / N) - f.cy), 7.6, 8.4,
        'stone ring matches authored radius');
    }
    assert.falsy(f.objects.some(o => o.kind === 'chest'), 'area adds no chest rewards');
    for (const o of [...f.objects, ...plants]) {
      const i = index(f, o);
      assert.truthy(p.reserved.has(i)); assert.truthy(f.occupied.has(i));
      assert.eq(f.grid[i], T.CAVE_FLOOR, 'props remain reachable on dry ground');
    }
  });

  test('cave areas: a normal circular grove fits without requiring the preview canvas corners', () => {
    const f = fixture();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      if (Math.hypot(x - f.cx, y - f.cy) > 8.6) f.surface.zone.coverage[y * N + x] = 0;
    const p = CaveAreas.plan(f);
    assert.eq(p.areas.length, 1);
    for (const i of p.reserved) assert.eq(f.surface.zone.coverage[i], 1);
  });

  test('cave areas: one blocked footprint cell rejects the whole Spring without partial painting', () => {
    const cases = [
      f => { f.spawnWhy[(f.cy + 5) * N + f.cx + 5] = W.SPAWN_WHY.FARMLAND; },
      f => { f.spawnWhy[(f.cy + 5) * N + f.cx + 5] = W.SPAWN_WHY.GOLF; },
      f => { f.grid[(f.cy + 5) * N + f.cx + 5] = T.CAVE_WALL; },
      f => { f.surface.zone.coverage[(f.cy + 5) * N + f.cx + 5] = 2; },
      f => { f.surface.baseGrid[(f.cy + 5) * N + f.cx + 5] = T.FARMLAND; },
    ];
    for (const damage of cases) {
      const f = fixture(); damage(f); const p = CaveAreas.plan(f);
      assert.eq(p.areas.length, 0); assert.eq(p.reserved.size, 0); assert.eq(p.terrain.size, 0);
      assert.eq(p.objects.length + p.wildplants.length, 0);
      assert.gt(p.diagnostics.length, 0, 'rejection is inspectable');
    }
  });

  test('cave areas: tile-edge Springs skip whole footprints and report why', () => {
    for (const [x, y] of [[4, 32], [59, 32], [32, 4], [32, 59]]) {
      const p = CaveAreas.plan(fixture(x, y));
      assert.eq(p.areas.length, 0); assert.eq(p.reserved.size, 0); assert.eq(p.terrain.size, 0);
      assert.gt(p.diagnostics.length, 0);
    }
  });

  test('cave areas: protected stairs and existing chests retain dry landings through the pool', () => {
    for (const kind of ['staircase', 'chest']) for (const delta of [0, 1]) {
      const f = fixture(), x = f.cx + delta, y = f.cy + delta;
      const protectedObject = { kind, dir: 'up', id: `spring-protected-${kind}`, ...at(f, x, y) };
      f.objects.push(protectedObject); f.occupied.add(y * N + x);
      const p = CaveAreas.plan(f);
      assert.eq(p.areas.length, 0, 'pool conflict declines entire layout');
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      assert.includes(f.objects, protectedObject);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        assert.eq(f.grid[(y + dy) * N + x + dx], T.CAVE_FLOOR, 'protected 3x3 landing remains dry');
      assert.eq(f.objects.filter(o => index(f, o) === y * N + x).length, 1);
    }
  });

  test('cave areas: chest fairy-ring clearing preserves authored stones and empty reservations', () => {
    let f, chest;
    // Fairy-ring rolls belong to the tile stream, not chest ids. Probe until
    // both the Spring selection and the first chest's ring roll are active.
    for (let candidate = 940001; candidate < 941001;) {
      f = fixture(32, 32, candidate);
      candidate = f.tx + 1;
      chest = { kind: 'chest', id: 'spring-bank-cache', ...at(f, f.cx + 6, f.cy + 3) };
      const probe = [];
      W.caveChestRings([chest], f.grid, N, f.tx, f.ty, edge, 1, probe, new Set());
      if (probe.length) break;
      f = null;
    }
    assert.truthy(f, 'a deterministic tile triggers the chest ring');
    f.objects.push(chest); f.occupied.add(index(f, chest));
    const p = CaveAreas.plan(f), plants = [];
    assert.eq(p.areas.length, 1, 'dry-bank cache does not conflict with pool');
    CaveAreas.apply(p, f.grid, f.objects, plants, f.occupied);
    const caughtBySweep = p.objects.filter(o => {
      const i = index(f, o), c = index(f, chest);
      return Math.round(Math.hypot(i % N - c % N, Math.floor(i / N) - Math.floor(c / N))) <= 2;
    });
    assert.gt(caughtBySweep.length, 0, 'ring sweep actually intersects authored stone ring');
    const occupied = new Set([...f.occupied, ...p.reserved]);
    const before = plants.map(o => o.id).sort().join();
    W.caveChestRings(f.objects, f.grid, N, f.tx, f.ty, edge, 1, plants, occupied);
    for (const rock of p.objects) assert.includes(f.objects, rock, 'authored ring stone survives clearing');
    for (const i of p.reserved) assert.truthy(occupied.has(i), 'sweep cannot reopen reserved banks');
    assert.eq(plants.filter(o => p.reserved.has(index(f, o))).map(o => o.id).sort().join(), before,
      'ordinary fairy-ring mushrooms cannot replace authored seats');
  });

  function groveChestFixture() {
    const f = fixture(), anchor = f.surface.zone.anchors[0];
    anchor.originGX = anchor.gx; anchor.originGY = anchor.gy;
    const source = { kind: 'chest', poiClass: 'park', id: 'spring-grove-source', rank: 4,
      _poiAt: `${anchor.lx},${anchor.ly}`, ...at(f, f.cx, f.cy) };
    f.surface.objects.push(source); f.surface.genObjects.push(source);
    return { f, source };
  }

  test('cave areas: canonical grove mirror relocation is transactional and retains its reward identity', () => {
    for (const excluded of [false, true]) {
      const { f, source } = groveChestFixture();
      const mirror = { kind: 'chest', poiClass: 'park', id: `${source.id}_d1`, caveOf: source.id,
        depth: 1, rank: source.rank, tierSeed: 3, ...at(f, f.cx, f.cy) };
      const original = JSON.stringify(mirror), originalCell = index(f, mirror);
      f.objects.push(mirror); f.occupied.add(originalCell);
      if (excluded) f.spawnWhy[(f.cy + 5) * N + f.cx + 5] = W.SPAWN_WHY.FARMLAND;
      const p = CaveAreas.plan(f);
      assert.eq(JSON.stringify(mirror), original, 'planning never moves live chest');
      assert.truthy(f.occupied.has(originalCell), 'planning leaves source occupancy intact');
      assert.eq(p.moves.length, excluded ? 0 : 1);
      assert.eq(p.areas.length, excluded ? 0 : 1);
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      assert.eq(f.objects.filter(o => o.kind === 'chest').length, 1, 'no new reward allocation');
      assert.includes(f.objects, mirror, 'existing object identity retained');
      assert.eq(mirror.id, `${source.id}_d1`); assert.eq(mirror.caveOf, source.id);
      assert.eq(mirror.rank, source.rank); assert.eq(mirror.tierSeed, 3);
      if (excluded) {
        assert.eq(JSON.stringify(mirror), original, 'declined area cannot move chest');
      } else {
        const destination = index(f, mirror), x = destination % N, y = Math.floor(destination / N);
        assert.truthy(destination !== originalCell, 'central chest seats on dry bank');
        assert.falsy(f.occupied.has(originalCell)); assert.truthy(f.occupied.has(destination));
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const i = (y + dy) * N + x + dx;
          assert.eq(f.grid[i], T.CAVE_FLOOR, 'destination halo stays dry');
          assert.falsy(p.objects.concat(p.wildplants).some(o => index(f, o) === i), 'destination halo stays clear');
        }
      }
    }
  });

  test('cave areas: loader seats the existing canonical grove mirror on the Spring bank', async () => {
    const { f, source } = groveChestFixture(), key = W.tileKey(f.tx, f.ty);
    W.setDepth(0).set(key, f.surface);
    try {
      const entry = await W.loadTile.atDepth(1, f.tx, f.ty, 49);
      assert.eq(entry.caveAreas.areas.length, 1);
      const mirrors = entry.objects.filter(o => o.caveOf === source.id);
      assert.eq(mirrors.length, 1);
      const mirror = mirrors[0], i = index(f, mirror), x = i % N, y = Math.floor(i / N);
      assert.eq(mirror.id, `${source.id}_d1`); assert.eq(mirror.rank, source.rank);
      assert.gt(mirror.tierSeed, 0, 'quota tier survives relocation');
      assert.truthy(i !== f.cy * N + f.cx);
      assert.truthy(entry.caveAreas.reserved.has(i));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const seat = (y + dy) * N + x + dx;
        assert.eq(entry.grid[seat], T.CAVE_FLOOR);
        for (const o of entry.objects.concat(entry.wildplants)) if (o !== mirror)
          assert.truthy(index(f, o) !== seat, 'mirror retains a clear approach after ambient dressing');
      }
      assert.eq(index(f, source), f.cy * N + f.cx, 'surface chest stays at its own canonical origin');
    } finally {
      for (const depth of [0, 1]) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });

  test('cave areas: generation is stable on reload and limited to shallow levels', () => {
    assert.eq(snapshot(CaveAreas.plan(fixture())), snapshot(CaveAreas.plan(fixture())));
    for (const depth of [0, 3, 10]) {
      const f = fixture(); f.depth = depth;
      const p = CaveAreas.plan(f);
      assert.eq(p.areas.length, 0); assert.eq(p.reserved.size, 0); assert.eq(p.terrain.size, 0);
    }
  });

  test('cave areas: loader keeps ordinary resources, rewards and fauna out of reserved banks', async () => {
    const f = fixture(), key = W.tileKey(f.tx, f.ty);
    W.setDepth(0).set(key, f.surface);
    const oldTest = window.__TEST_MODE;
    window.__TEST_MODE = false;
    try {
      const entry = await W.loadTile.atDepth(1, f.tx, f.ty, 49);
      assert.eq(entry.caveAreas.areas.length, 1);
      const ownedIds = new Set([...entry.caveAreas.objects, ...entry.caveAreas.wildplants].map(o => o.id));
      const spawn = new Function('entry', 'tx', 'ty', 'depth', SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, ''));
      spawn.call({ tileEdgeM: edge, save: { caught: [] } }, entry, f.tx, f.ty, 1);
      for (const list of [entry.objects, entry.wildplants, entry.extraTreasures, entry.caveCoinSeeds,
        entry.creatures, entry.coinDrops, entry.traps]) for (const o of list || []) {
        if (!ownedIds.has(o.id) && !o.caveArea) assert.falsy(entry.caveAreas.reserved.has(index(f, o)),
          `${o.kind || o.crop || 'reward'} respects empty reserved ground`);
      }
      const deeper = await W.loadTile.atDepth(2, f.tx, f.ty, 49);
      for (const i of entry.caveAreas.terrain.keys()) {
        assert.eq(entry.geologyGrid[i], T.CAVE_FLOOR, 'original geology is retained');
        assert.eq(deeper.geologyGrid[i], T.CAVE_FLOOR, 'authored pool and source do not leak into the next stratum');
      }
      const first = snapshot(entry.caveAreas);
      W.setDepth(1).delete(key);
      const reloaded = await W.loadTile.atDepth(1, f.tx, f.ty, 49);
      assert.eq(snapshot(reloaded.caveAreas), first, 'loader rebuild retains exact authored layout');
    } finally {
      window.__TEST_MODE = oldTest;
      for (const depth of [0, 1, 2]) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });
})();
