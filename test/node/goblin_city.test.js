(function () {
  const W = WorldGen, T = W.T, N = 64, edge = N * W.CELL_M;
  function fixture(tx = 945001, ty = 945101) {
    const grid = new Uint8Array(N * N).fill(T.PARK);
    return { N, tx, ty, tileEdgeM: edge, depth: 2,
      surface: { status: 'ready', depth: 0, cellsPerEdge: N, tileEdgeM: edge,
        grid, baseGrid: grid.slice(), objects: [], genObjects: [], wildplants: [],
        spawnWhy: new Uint32Array(N * N),
        zone: { anchors: [], coverage: new Uint16Array(N * N) } },
      grid: new Uint8Array(N * N).fill(T.CAVE_FLOOR),
      spawnWhy: new Uint32Array(N * N), objects: [], occupied: new Set(), routeLane: new Set() };
  }
  const index = (f, o) => Math.floor((o.y - f.ty * edge) / W.CELL_M) * N
    + Math.floor((o.x - f.tx * edge) / W.CELL_M);
  const snapshot = p => JSON.stringify({ areas: p.areas.map(a => ({ ...a, reserved: [...a.reserved] })),
    reserved: [...p.reserved], terrain: [...p.terrain], objects: p.objects,
    wildplants: p.wildplants, encounters: p.encounters });

  test('goblin city: L2 is mostly warren even without surface zone anchors', () => {
    const f = fixture(), before = [...f.grid].join(), p = CaveAreas.planCity(f);
    assert.truthy(W.floorProfile(2).warren);
    assert.gt(p.reserved.size, N * N * .7, 'warren extends beyond isolated grove footprints');
    assert.gt(p.objects.filter(o => o.kind === 'mineralrock' && o.caveArea).length, N,
      'inhabited rooms have substantial authored walls');
    assert.gt(p.encounters.length, 0, 'the warren is inhabited');
    assert.truthy(p.encounters.some(o => o.kind === 'club_goblin' || o.kind === 'spear_goblin'));
    assert.eq([...f.grid].join(), before, 'planning does not mutate live terrain');
    assert.eq(f.objects.length, 0); assert.eq(f.occupied.size, 0);
    for (const depth of [0, 1, 3, 10]) {
      const other = fixture(); other.depth = depth;
      assert.eq(CaveAreas.planCity(other).reserved.size, 0, 'other floors retain their own layouts');
    }
  });

  test('goblin city: reloads preserve layout and unique object and encounter identities', () => {
    const p = CaveAreas.planCity(fixture());
    assert.eq(snapshot(p), snapshot(CaveAreas.planCity(fixture())));
    const ids = [...p.objects, ...p.wildplants, ...p.encounters].map(o => o.id);
    assert.eq(new Set(ids).size, ids.length);
    assert.truthy(ids.every(Boolean));
  });

  test('goblin city: room doors connect the walkable floor across an open tile', () => {
    for (const tx of [945001, 945002, 945003]) {
      const f = fixture(tx), p = CaveAreas.planCity(f);
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      const walls = new Set(p.objects.filter(o => o.kind === 'mineralrock').map(o => index(f, o)));
      const open = new Set();
      for (let i = 0; i < N * N; i++) if (f.grid[i] === T.CAVE_FLOOR && !walls.has(i)) open.add(i);
      assert.gt(open.size, N * N / 2, 'walls leave useful room and passage space');
      const queue = [open.values().next().value], seen = new Set(queue);
      for (let k = 0; k < queue.length; k++) {
        const i = queue[k], x = i % N, y = Math.floor(i / N);
        const next = [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1,
          y > 0 ? i - N : -1, y < N - 1 ? i + N : -1];
        for (const j of next) if (open.has(j) && !seen.has(j)) { seen.add(j); queue.push(j); }
      }
      assert.eq(seen.size, open.size, 'no walkable room is sealed behind its walls');
    }
  });

  test('goblin city: safety exclusions and building footprints remain untouched', () => {
    const f = fixture(), excluded = new Set();
    const reasons = [W.SPAWN_WHY.FARM_INTERIOR, W.SPAWN_WHY.GOLF, W.SPAWN_WHY.JUNCTION,
      W.SPAWN_WHY.RESTRICTED];
    for (let r = 0; r < reasons.length; r++) for (let y = 10; y < 14; y++) {
      const i = y * N + 8 + r * 7;
      excluded.add(i); f.spawnWhy[i] = reasons[r]; f.surface.spawnWhy[i] = reasons[r];
    }
    for (let y = 28; y < 34; y++) for (let x = 28; x < 34; x++) {
      const i = y * N + x; excluded.add(i);
      f.surface.grid[i] = f.surface.baseGrid[i] = T.BUILDING_LARGE; f.grid[i] = T.CAVE_WALL;
    }
    const before = f.grid.slice(), p = CaveAreas.planCity(f);
    for (const i of excluded) {
      assert.falsy(p.reserved.has(i)); assert.falsy(p.terrain.has(i));
    }
    for (const o of [...p.objects, ...p.wildplants, ...p.encounters])
      assert.falsy(excluded.has(index(f, o)), 'warren content respects inherited restrictions');
    CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
    for (const i of excluded) assert.eq(f.grid[i], before[i]);
  });

  test('goblin city: encounters obey class-specific suppression on L2', () => {
    const f = fixture();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const reason = x < N / 2 ? W.SPAWN_WHY.KERB : W.SPAWN_WHY.SENSITIVE;
      f.spawnWhy[y * N + x] = reason; f.surface.spawnWhy[y * N + x] = reason;
    }
    const p = CaveAreas.planCity(f);
    for (const o of p.encounters) {
      const i = index(f, o), cls = creatureSpawnClass(o.kind);
      assert.truthy(W.isSpawnCell(f.grid, N, N, i % N, Math.floor(i / N), { spawnWhy: f.spawnWhy }, cls));
      assert.truthy(W.isSpawnCell(f.surface.grid, N, N, i % N, Math.floor(i / N),
        { spawnWhy: f.surface.spawnWhy }, cls));
    }
  });

  test('goblin city: route lanes and landmark landings stay clear', () => {
    const f = fixture(), cx = 30, cy = 31;
    for (let x = 0; x < N; x++) f.routeLane.add(20 * N + x);
    const stairs = { kind: 'staircase', id: 'goblin-city-stairs', dir: 'up',
      x: f.tx * edge + (cx + .5) * W.CELL_M, y: f.ty * edge + (cy + .5) * W.CELL_M };
    f.objects.push(stairs); f.occupied.add(cy * N + cx);
    const clear = new Set(f.routeLane);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) clear.add((cy + dy) * N + cx + dx);
    const p = CaveAreas.planCity(f);
    for (const o of [...p.objects, ...p.wildplants, ...p.encounters])
      assert.falsy(clear.has(index(f, o)), 'landings and routes have no walls or encounters');
    CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
    assert.includes(f.objects, stairs);
    for (const i of clear) assert.eq(f.grid[i], T.CAVE_FLOOR);
  });

  test('goblin city: an existing authored area keeps its reservation and terrain', () => {
    const f = fixture(), p = CaveAreas.plan(f), authored = new Set();
    for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) {
      const i = y * N + x; authored.add(i); p.reserved.add(i); p.terrain.set(i, T.WATER);
    }
    const area = { id: 'existing-authored-area', kind: 'spring_cave', reserved: authored };
    p.areas.push(area);
    assert.eq(CaveAreas.planCity(f, p), p, 'city extends the existing transaction');
    assert.includes(p.areas, area);
    for (const i of authored) assert.eq(p.terrain.get(i), T.WATER);
    for (const o of [...p.objects, ...p.wildplants, ...p.encounters]) assert.falsy(authored.has(index(f, o)));
    assert.gt(p.reserved.size, N * N * .7);
  });

  test('goblin city: L2 loader applies a continuous warren and preserves it on reload', async () => {
    const f = fixture(945011), key = W.tileKey(f.tx, f.ty);
    W.setDepth(0).set(key, f.surface);
    try {
      const entry = await W.loadTile.atDepth(2, f.tx, f.ty, 49);
      assert.gt(entry.caveAreas.reserved.size, N * N * .7);
      assert.truthy(entry.caveAreas.areas.some(a => a.kind === 'goblin_warrens' && a.city));
      const walls = entry.caveAreas.objects.filter(o => o.kind === 'mineralrock');
      assert.gt(walls.length, N);
      for (const wall of walls) assert.includes(entry.objects, wall);
      const ownedIds = new Set([...entry.caveAreas.objects, ...entry.caveAreas.wildplants].map(o => o.id));
      for (const o of entry.objects.concat(entry.wildplants || [])) {
        if (ownedIds.has(o.id) || o.caveArea || o.kind === 'staircase' || o.kind === 'drill') continue;
        // Mirrored landmarks are retained before reservation, ordinary dressing
        // must leave the authored city intact.
        if (o.caveOf) continue;
        assert.falsy(walls.some(wall => index(f, wall) === index(f, o)), 'ambient props do not overlap city walls');
      }
      const before = snapshot(entry.caveAreas);
      W.setDepth(2).delete(key);
      const reloaded = await W.loadTile.atDepth(2, f.tx, f.ty, 49);
      assert.eq(snapshot(reloaded.caveAreas), before);
    } finally {
      for (const depth of [0, 1, 2]) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });

  test('goblin city: L2 keeps authored springs clear of its fixed drill budget', async () => {
    const EXT = 4096, row = W.CAVE_PASSES.find(r => r.id === 'drills');
    let f, anchor;
    for (let tx = 945031; tx < 946031; tx++) {
      f = fixture(tx);
      const drillProbe = [];
      W.runCavePass(row, W.cavePassLevel(f.grid, N, f.tx, f.ty, edge, 2, new Set(),
        { objects: drillProbe, spawnWhy: f.spawnWhy }));
      for (const drill of drillProbe) {
        const centre = index(f, drill), cx = centre % N, cy = Math.floor(centre / N);
        if (cx <= 12 || cx >= N - 13 || cy <= 12 || cy >= N - 13) continue;
        const candidate = { kind: 'grove', owned: true,
          gx: f.tx * EXT + (cx + .5) * EXT / N, gy: f.ty * EXT + (cy + .5) * EXT / N,
          lx: (cx + .5) * EXT / N, ly: (cy + .5) * EXT / N, upm: edge / EXT };
        if (CaveAreas.select(candidate, 2) === 'spring_cave') { anchor = candidate; break; }
      }
      if (anchor) break;
    }
    assert.truthy(anchor, 'fixture finds a selected spring over an interior drill seat');
    const key = W.tileKey(f.tx, f.ty);
    f.surface.zone.anchors = [anchor]; f.surface.zone.coverage.fill(1);
    assert.truthy(CaveAreas.plan(f).areas.some(a => a.kind === 'spring_cave'));
    W.setDepth(0).set(key, f.surface);
    try {
      const entry = await W.loadTile.atDepth(2, f.tx, f.ty, 49);
      const spring = entry.caveAreas.areas.find(a => a.kind === 'spring_cave');
      assert.truthy(spring, 'drills cannot cause the existing authored pool to be rejected');
      const drills = entry.objects.filter(o => o.shrineKind === 'drill');
      assert.eq(drills.length, 10);
      for (const drill of drills) assert.falsy(spring.reserved.has(index(f, drill)));
    } finally {
      for (const depth of [0, 1, 2]) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });
})();
