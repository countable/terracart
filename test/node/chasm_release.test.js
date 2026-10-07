(function () {
  const W = WorldGen, N = 96, edge = N * W.CELL_M;
  const row = W.CAVE_PASSES.find(r => r.id === 'chasms');
  const point = (x, y, tx = 2, ty = -3) => ({ x: (tx * N + x + .5) * W.CELL_M, y: (ty * N + y + .5) * W.CELL_M });
  function level(depth = 1) {
    return W.cavePassLevel(new Uint8Array(N * N).fill(W.T.CAVE_FLOOR), N, 2, -3, edge, depth, new Set());
  }
  const holes = L => L.objects.filter(o => o.kind === 'ground_hole');
  const index = o => Math.floor(o.y / W.CELL_M + 3 * N) * N + Math.floor(o.x / W.CELL_M - 2 * N);

  test('chasm release: deterministic connected clusters appear only on L1 and reserve their floor cells', () => {
    const a = level(), b = level();
    W.runCavePass(row, a); W.runCavePass(row, b);
    assert.gt(holes(a).length, 4);
    assert.eq(JSON.stringify(holes(a)), JSON.stringify(holes(b)));
    const unseen = new Set(holes(a).map(index));
    assert.eq(unseen.size, holes(a).length);
    for (const o of holes(a)) {
      assert.eq(o.depth, 1);
      assert.truthy(a.occupied.has(index(o)));
      assert.truthy(o.id.startsWith('chasm_1_2_-3_'));
    }
    while (unseen.size) {
      const queue = [unseen.values().next().value]; unseen.delete(queue[0]);
      for (let j = 0; j < queue.length; j++) for (const next of [queue[j]-1, queue[j]+1, queue[j]-N, queue[j]+N]) {
        if (unseen.delete(next)) queue.push(next);
      }
      assert.truthy(queue.length === 4 || queue.length === 5, 'each complete shape contains four or five joined cells');
    }
    for (const depth of [0, 2, 3, 7]) {
      const L = level(depth); W.runCavePass(row, L); assert.eq(holes(L).length, 0);
    }
  });

  test('chasm release: obstruction or exclusion anywhere in a footprint rejects the entire hole', () => {
    const pick = L => row.cluster(() => .5, 30, 30, L, row.setup(L));
    const clear = pick(level()); assert.gt(clear.length, 3);
    for (const c of clear) for (const obstacle of ['occupied', 'wall']) {
      const L = level(), i = c.liy * N + c.lix;
      if (obstacle === 'occupied') L.occupied.add(i); // Includes inherited all-floor spawn exclusions.
      else L.grid[i] = W.T.CAVE_WALL;
      assert.eq(pick(L).length, 0, `${obstacle} rejects every member, never leaves fragments`);
    }
    const full = level(); full.occupied = new Set(Array.from({ length: N * N }, (_, i) => i));
    W.runCavePass(row, full); assert.eq(holes(full).length, 0);
  });

  test('chasm release: stair and chest approaches plus the surrounding floor margin remain clear', () => {
    for (const kind of ['staircase', 'chest']) {
      const L = level(); L.objects.push({ kind, ...point(32, 30) });
      assert.eq(row.cluster(() => .5, 30, 30, L, row.setup(L)).length, 0, kind);
    }
    const L = level(), clear = row.cluster(() => .5, 30, 30, L, row.setup(L));
    const c = clear.reduce((a, b) => a.lix < b.lix ? a : b);
    L.grid[c.liy * N + c.lix - 1] = W.T.CAVE_WALL;
    assert.eq(row.cluster(() => .5, 30, 30, L, row.setup(L)).length, 0, 'floor remains open beside the lip');
  });

  function destination() {
    return { cellsPerEdge: N, tileEdgeM: edge, grid: new Uint8Array(N * N).fill(W.T.CAVE_WALL), objects: [], _spawned: true };
  }
  test('chasm release: landing chooses nearby unoccupied floor, including negative world tiles', () => {
    const e = destination(), hole = { ...point(30, 30), depth: 1 };
    e.grid[30*N+30] = e.grid[30*N+31] = W.T.CAVE_FLOOR;
    for (const list of ['objects', 'wildplants', 'traps', 'laidTraps', 'creatures']) {
      e[list] = [{ ...point(30, 30) }];
      assert.eq(JSON.stringify(CaveHazards.landing(e, hole, edge)), JSON.stringify(point(31, 30)), list);
      e[list] = [];
    }
    assert.eq(JSON.stringify(CaveHazards.landing(e, hole, edge)), JSON.stringify(point(30, 30)));
    e.grid.fill(W.T.CAVE_WALL); e.grid[30*N+35] = W.T.CAVE_FLOOR;
    assert.eq(CaveHazards.landing(e, hole, edge), null, 'distant floor cannot teleport the player across the cave');
  });

  async function withFall(fn) {
    const load = W.loadTile.atDepth;
    const e = destination(); e.grid[30*N+30] = W.T.CAVE_FLOOR;
    const state = { damage: [], changes: [], messages: [], flashes: [], loads: [] };
    const scene = { depth: 1, tileEdgeM: edge, save: { energy: 100, mode: 'easy' },
      showMessageModal(m) { state.messages.push(m); }, flash(m) { state.flashes.push(m); },
      _losePlayerEnergy(n) { state.damage.push(n); return n; }, _popEnergy() {},
      changeDepth(...args) { state.changes.push(args); this.depth += args[0]; } };
    W.loadTile.atDepth = async (...args) => { state.loads.push(args); return e; };
    try { await fn(scene, e, state, { ...point(30, 30), depth: 1 }); }
    finally { W.loadTile.atDepth = load; }
  }
  test('chasm release: fall prepares L2 first and applies damage and descent once on acknowledgement', async () => {
    await withFall(async (scene, e, state, hole) => {
      assert.truthy(await CaveHazards.fall(scene, hole, 49));
      assert.eq(JSON.stringify(state.loads[0]), JSON.stringify([2, 2, -3, 49]));
      assert.eq(state.changes.length, 0); assert.eq(state.damage.length, 0);
      assert.falsy(await CaveHazards.fall(scene, hole), 'pending fall cannot open a second modal');
      state.messages[0].onDismiss(); state.messages[0].onDismiss();
      assert.eq(state.damage.length, 1); assert.gt(state.damage[0], 0);
      assert.eq(state.changes.length, 1); assert.eq(scene.depth, 2);
      assert.eq(JSON.stringify(state.changes[0]), JSON.stringify([1, point(30, 30), { fall: true }]));
      assert.falsy(scene._caveFallPending);
    });
  });
  test('chasm release: unavailable or unsafe L2 leaves player and energy untouched', async () => {
    await withFall(async (scene, e, state, hole) => {
      e.grid.fill(W.T.CAVE_WALL);
      assert.falsy(await CaveHazards.fall(scene, hole));
      assert.eq(state.messages.length, 0); assert.eq(state.damage.length, 0); assert.eq(state.changes.length, 0);
      assert.falsy(scene._caveFallPending);
      W.loadTile.atDepth = async () => { throw new Error('offline'); };
      assert.falsy(await CaveHazards.fall(scene, hole));
      assert.falsy(scene._caveFallPending); assert.eq(scene.depth, 1);
    });
  });
  test('chasm release: a stale fall acknowledgement cannot change a different floor', async () => {
    await withFall(async (scene, e, state, hole) => {
      assert.truthy(await CaveHazards.fall(scene, hole)); scene.depth = 0;
      state.messages[0].onDismiss();
      assert.eq(state.damage.length, 0); assert.eq(state.changes.length, 0); assert.falsy(scene._caveFallPending);
    });
  });
})();
