(function () {
  const W = WorldGen, T = W.T, N = 64, edge = N * W.CELL_M;
  const kinds = ['spring_cave', 'goblin_warrens', 'mushroom_cavern', 'gemstone_cavern', 'mine_tunnels'];
  function fixture(kind, depth, start = 950201) {
    const ty = 950101, cx = 32, cy = 32;
    let tx, anchor;
    for (tx = start; tx < start + 10000; tx++) {
      anchor = { kind: kind === 'mine_tunnels' ? 'quarry' : 'grove', owned: true,
        gx: tx * 4096 + (cx + .5) * 64, gy: ty * 4096 + (cy + .5) * 64,
        lx: (cx + .5) * 64, ly: (cy + .5) * 64, upm: edge / 4096 };
      if (CaveAreas.select(anchor, depth) === kind) break;
    }
    assert.lt(tx, start + 10000, 'deterministic selection supplies fixture');
    const source = new Uint8Array(N * N).fill(T.PARK);
    const surface = { status: 'ready', depth: 0, cellsPerEdge: N, tileEdgeM: edge,
      grid: source.slice(), baseGrid: source.slice(), genObjects: [], objects: [], wildplants: [],
      zone: { anchors: [anchor], coverage: new Uint16Array(N * N).fill(1),
        caveSource: { grid: source, objects: [], wildplants: [], spawnWhy: new Uint16Array(N * N) } } };
    return { surface, grid: new Uint8Array(N * N).fill(T.CAVE_FLOOR), N, tx, ty,
      tileEdgeM: edge, depth, objects: [], occupied: new Set(), spawnWhy: new Uint16Array(N * N), cx, cy };
  }
  const frame = f => W.tileFrame({ cellsPerEdge: N }, f.tx, f.ty, edge);
  const idx = (f, o) => { const p = frame(f).cellOf(o.x, o.y); return p.iy * N + p.ix; };
  const payload = p => JSON.stringify({ reserved: [...p.reserved], terrain: [...p.terrain],
    objects: p.objects, plants: p.wildplants, encounters: p.encounters });

  test('cave nexuses: all five definitions select and place on both shallow floors', () => {
    for (const depth of [1, 2]) for (const kind of kinds) {
      const f = fixture(kind, depth), p = CaveAreas.plan(f);
      assert.eq(p.areas.length, 1, kind + ' D' + depth);
      assert.eq(p.areas[0].kind, kind); assert.gt(p.reserved.size, 0);
      assert.eq(payload(p), payload(CaveAreas.plan(f)), 'same immutable evidence repeats exact slots');
      const props = p.objects.concat(p.wildplants), ids = props.map(o => o.id);
      assert.eq(new Set(ids).size, ids.length, 'finite slots have unique ids');
      assert.falsy(props.some(o => o.kind === 'chest' && !o.barrel), 'no added cache reward');
      for (const o of props) assert.truthy(p.reserved.has(idx(f, o)), 'props stay inside own region');
    }
    for (const depth of [0, 3, 4, 10]) for (const kind of ['grove', 'quarry', 'seep'])
      assert.eq(CaveAreas.select({ kind, gx: 5, gy: 5 }, depth), null);
    for (const depth of [1, 2]) assert.eq(CaveAreas.select({ kind: 'seep', gx: 5, gy: 5 }, depth), null);
  });

  test('cave nexuses: immutable protected ground survives even if the visible surface was repainted', () => {
    for (const depth of [1, 2]) for (const kind of kinds) for (const [terrain, why] of [
      [T.BUILDING, 0], [T.WATER, 0], [T.ROAD, W.SPAWN_WHY.ROAD],
      [T.PARK, W.SPAWN_WHY.FARMLAND], [T.PARK, W.SPAWN_WHY.GOLF]
    ]) {
      const f = fixture(kind, depth), i = (f.cy + 4) * N + f.cx + 4;
      f.surface.zone.caveSource.grid[i] = terrain;
      f.surface.zone.caveSource.spawnWhy[i] = why;
      f.spawnWhy[i] = why & W.SPAWN_WHY_ALL_FLOORS;
      f.grid[i] = T.CAVE_WALL;
      const p = CaveAreas.plan(f), plants = [];
      CaveAreas.apply(p, f.grid, f.objects, plants, f.occupied);
      assert.eq(f.grid[i], T.CAVE_WALL, kind + ' never carves excluded or original protected land');
      assert.falsy(p.objects.concat(p.wildplants, p.encounters || []).some(o => idx(f, o) === i));
    }
  });

  test('cave nexuses: deep grove chamber carving uses source eligibility; quarry never invents tunnels', () => {
    for (const kind of kinds) {
      const f = fixture(kind, 2); f.grid.fill(T.CAVE_WALL);
      // An actual pre-existing passage connects the chamber to its floor.
      for (let x = 0; x <= f.cx; x++) f.grid[f.cy * N + x] = T.CAVE_FLOOR;
      if (kind === 'mine_tunnels') {
        for (let y = 24; y <= 40; y++) for (let x = 29; x <= 35; x++) f.grid[y * N + x] = T.CAVE_FLOOR;
      }
      const before = f.grid.slice(), p = CaveAreas.plan(f);
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      assert.eq(p.areas.length, 1, kind + ' has a usable source chamber');
      if (kind === 'mine_tunnels') {
        for (let i = 0; i < before.length; i++) assert.eq(f.grid[i], before[i], 'mine preserves existing route geometry');
        assert.falsy(p.objects.some(o => ['grove_shrine', 'chest', 'temple'].includes(o.kind)));
      } else {
        assert.gt([...p.reserved].filter(i => f.grid[i] === T.CAVE_FLOOR).length, 0, 'eligible grove opens a chamber');
      }
    }
  });

  test('cave nexuses: gemstone seats use depth-qualified shared deposits and finite mining identity', () => {
    for (const depth of [1, 2]) {
      const f = fixture('gemstone_cavern', depth), p = CaveAreas.plan(f);
      const gems = p.objects.filter(o => mineralDeposit(o));
      assert.gt(gems.length, 0);
      for (const o of gems) {
        const deposit = mineralDeposit(o);
        assert.lte(deposit.yieldTier, depth);
        assert.eq(o.requiredTier, deposit.requiredTier);
        assert.eq(o.kind, 'mineralrock');
      }
      const reload = CaveAreas.plan(f);
      assert.eq(gems.map(o => o.id).join(), reload.objects.filter(o => mineralDeposit(o)).map(o => o.id).join(),
        'minedRock ids cannot reroll after re-entry');
    }
  });

  test('cave nexuses: anchor reordering and neighbouring observers cannot duplicate owned slots', () => {
    for (const kind of kinds) {
      const f = fixture(kind, 1), expected = CaveAreas.plan(f);
      const foreign = { ...f.surface.zone.anchors[0], kind: 'seep', gx: 1, gy: 1 };
      f.surface.zone.anchors.unshift(foreign); f.surface.zone.coverage.fill(2);
      assert.eq(payload(CaveAreas.plan(f)), payload(expected), 'array position is not generation identity');
      f.tx++;
      const neighbour = CaveAreas.plan(f);
      const existing = new Set(expected.objects.concat(expected.wildplants, expected.encounters || []).map(o => o.id));
      for (const o of neighbour.objects.concat(neighbour.wildplants, neighbour.encounters || []))
        assert.falsy(existing.has(o.id), 'same anchor observed next door never duplicates owner seats');
    }
  });

  test('cave nexuses: every fitted warren room has a clear route to the central court', () => {
    for (const depth of [1, 2]) for (const start of [950201, 950501, 950801]) {
      const f = fixture('goblin_warrens', depth, start), p = CaveAreas.plan(f);
      CaveAreas.apply(p, f.grid, f.objects, [], f.occupied);
      const solid = new Set(p.objects.map(o => idx(f, o)));
      const allowed = i => p.reserved.has(i) && f.grid[i] === T.CAVE_FLOOR && !solid.has(i);
      const visited = new Set([f.cy * N + f.cx]), queue = [...visited];
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        for (const j of [i - 1, i + 1, i - N, i + N]) if (allowed(j) && !visited.has(j)) {
          visited.add(j); queue.push(j);
        }
      }
      assert.gt(p.areas[0].rooms.length, 0, 'fixture contains fitted rooms');
      for (const room of p.areas[0].rooms) {
        const cells = [...p.reserved].filter(i => {
          const u = i % N - f.cx, v = Math.floor(i / N) - f.cy;
          return u > room.left && u < room.right && v > room.top && v < room.bottom && allowed(i);
        });
        assert.gt(cells.length, 0, 'room retains empty interior');
        for (const i of cells) assert.truthy(visited.has(i), 'room interior connects through an open shared-wall door');
      }
    }
  });

  test('cave nexuses: route decoration cannot erase or transform authored deposits and walls', () => {
    for (const kind of ['spring_cave', 'goblin_warrens', 'gemstone_cavern', 'mine_tunnels']) {
      const f = fixture(kind, 2), p = CaveAreas.plan(f), plants = [];
      CaveAreas.apply(p, f.grid, f.objects, plants, f.occupied);
      const rocks = f.objects.filter(o => o.kind === 'mineralrock');
      assert.gt(rocks.length, 0);
      const before = JSON.stringify(rocks), occupied = new Set([...f.occupied, ...p.reserved]);
      const route = { theme: 'gemstone_path' };
      const plan = { N, tx: f.tx, ty: f.ty, tileEdgeM: edge, depth: 2,
        data: Underground.surfaceData(f.surface), routes: [], streetCells: new Set(),
        routeAt: new Map([...p.reserved].map(i => [i, route])), lane: new Set(rocks.map(o => idx(f, o))) };
      Underground.decorate(plan, f.grid, f.objects, plants, occupied);
      assert.eq(JSON.stringify(f.objects.filter(o => o.kind === 'mineralrock')), before,
        'route lanes retain authored pieces');
      plan.lane.clear();
      Underground.decorate(plan, f.grid, f.objects, plants, occupied);
      assert.eq(JSON.stringify(f.objects.filter(o => o.kind === 'mineralrock')), before,
        'gem route conversion preserves exact authored mineral payload');
      for (const i of p.reserved) assert.truthy(occupied.has(i), 'route clearing cannot reopen a reserved seat');
    }
  });

  test('cave nexuses: level-two quarry uses projected small-street routes through actual rock substrate', async () => {
    const f = fixture('mine_tunnels', 2), key = W.tileKey(f.tx, f.ty);
    for (const grid of [f.surface.grid, f.surface.baseGrid, f.surface.zone.caveSource.grid]) {
      grid.fill(T.ROCK);
      for (let y = f.cy - 2; y <= f.cy + 2; y++) for (let x = 0; x < N; x++) grid[y * N + x] = T.ROAD;
    }
    f.surface.layers = [{ name: 'transportation', extent: 4096, features: [{ id: 79111, type: 2,
      tags: { class: 'minor' }, geom: [[{ x: 0, y: (f.cy + .5) * 64 }, { x: 4096, y: (f.cy + .5) * 64 }]] }] }];
    W.setDepth(0).set(key, f.surface);
    try {
      const entry = await W.loadTile.atDepth(2, f.tx, f.ty, 49);
      const ore = entry.caveAreas.objects.filter(o => o.kind === 'mineralrock');
      assert.eq(entry.caveAreas.areas.length, 1, 'eligible source route enables an actual mine');
      assert.gt(ore.length, 0, 'mine has finite ore beside the reserved through lane');
      for (const o of ore) {
        const i = idx(f, o);
        assert.eq(entry.geologyGrid[i], T.CAVE_WALL, 'projected route opens original rock');
        assert.eq(entry.grid[i], T.CAVE_FLOOR);
        assert.truthy(entry.underground.streetCells.has(i));
        assert.falsy(entry.underground.lane.has(i), 'ore preserves through route');
      }
    } finally {
      for (const depth of [0, 1, 2]) W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });

  test('cave nexuses: actual loader preserves area ownership through ordinary cave generation', async () => {
    for (const depth of [1, 2]) for (const kind of kinds) {
      // Park evidence opens natural D2 clearings, which must defer to authored
      // nexuses; this exercises the real order of carving, settlements and fill.
      const f = fixture(kind, depth), key = W.tileKey(f.tx, f.ty);
      W.setDepth(0).set(key, f.surface);
      try {
        const entry = await W.loadTile.atDepth(depth, f.tx, f.ty, 49);
        assert.eq(entry.caveAreas.areas.length, 1, kind + ' D' + depth + ' survives loader passes');
        for (const i of entry.caveAreas.reserved) {
          assert.truthy(entry.undergroundReserved.has(i), kind + ' D' + depth + ' reserved cell ' + i + ' survives all ambient passes');
          assert.eq(W.variantOwnerAt(entry, i), 'cave');
        }
        const authored = new Set(entry.caveAreas.objects.concat(entry.caveAreas.wildplants).map(o => o.id));
        for (const o of entry.objects.concat(entry.wildplants, entry.extraTreasures || [], entry.caveCoinSeeds || [])) {
          if (authored.has(o.id) || ['staircase', 'chest', 'torch'].includes(o.kind)) continue;
          assert.falsy(entry.caveAreas.reserved.has(idx(f, o)), 'ordinary object suppressed inside ' + kind);
        }
        const old = payload(entry.caveAreas);
        W.setDepth(depth).delete(key);
        assert.eq(payload((await W.loadTile.atDepth(depth, f.tx, f.ty, 49)).caveAreas), old);
      } finally {
        for (const d of [0, 1, 2]) W.setDepth(d).delete(key);
        W.setDepth(0);
      }
    }
  });
})();
