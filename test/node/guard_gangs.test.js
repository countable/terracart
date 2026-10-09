(() => {
  const L = Lairs, W = WorldGen, N = 64, cellM = W.CELL_M, edge = N * cellM;
  const world = tx => {
    const sid = L.structureKey(tx, 0, 32, 32), rng = W.makeRng(L.hashKey(sid));
    if (rng() >= L.occupancyFor(9)) return { sid, held: false };
    const t = rng(), group = L.groupFor(9, t, rng, false);
    rng(); // the ordinary facing draw precedes count expansion
    return { sid, held: true, group, n: group ? L.expandGroup(group, 9, rng).length : null };
  };
  function fixture(tx, sid) {
    const lx = 32.5 * cellM, ly = lx, ox = tx * edge;
    const grid = new Uint8Array(N * N).fill(W.T.GRASS);
    grid[32 * N + 32] = W.T.BUILDING;
    return {
      entry: { grid, cellsPerEdge: N, tileEdgeM: edge, objects: [],
        _spawnOpts: { roadMask: new Uint8Array(N * N), spawnWhy: new Uint16Array(N * N) } },
      cand: { tx, ty: 0, ix: 32, iy: 32, sid, tier: 9, key: null,
        lx, ly, ox, oy: 0, wx: ox + lx, wy: ly, halfW: cellM / 2, halfH: cellM / 2 },
    };
  }
  test('grunt gangs: fixed tenth of held houses, with ordinary groups using the remaining ticket', () => {
    for (const t of [0, .5, 1]) {
      const counts = {};
      for (let i = 0; i < 10000; i++) {
        let draws = 0;
        const group = L.groupFor(9, t, () => { draws++; return (i + .5) / 10000; }, false);
        counts[group || 'plain'] = (counts[group || 'plain'] || 0) + 1;
        assert.eq(draws, 1);
      }
      assert.eq(counts.grunt_gang, 1000, 'exactly ten percent of eligible group-selection tickets');
      assert.eq(counts.plain, 10000 * .9 * (1 - L.GROUP_RATE[9]));
      for (const name of ['splitter', 'haunting', 'roost'])
        assert.eq(counts[name], 10000 * .9 * L.GROUP_RATE[9] / 3);
    }
    assert.falsy(L.groupRows(11, 1, true).includes('grunt_gang'));
    assert.falsy(L.groupRows(12, 1, true).includes('grunt_gang'));
  });

  test('grunt gangs: occupancy remains unchanged and seeded sizes cover three through eight uniformly', () => {
    let held = 0, gangs = 0;
    const counts = new Map();
    for (let tx = 0; tx < 30000; tx++) {
      const g = world(tx);
      if (!g.held) continue;
      held++;
      if (g.group !== 'grunt_gang') continue;
      gangs++; counts.set(g.n, (counts.get(g.n) || 0) + 1);
      assert.inRange(g.n, 3, 8);
      assert.eq(JSON.stringify(g), JSON.stringify(world(tx)), 'the same structure keeps its gang');
    }
    assert.inRange(held / 30000, L.occupancyFor(9) - .01, L.occupancyFor(9) + .01);
    assert.inRange(gangs / held, .09, .11, 'a tenth of held houses, not all houses');
    assert.eq([...counts.keys()].sort().join(), '3,4,5,6,7,8');
    for (const count of counts.values()) assert.inRange(count / gangs, .12, .22, 'each inclusive count equally likely');
    let draws = 0;
    L.expandGroup('splitter', 9, () => { draws++; return .5; });
    assert.eq(draws, 0, 'fixed groups preserve their count stream');
    const plan = L.expandGroup('grunt_gang', 9, () => { draws++; return .999; });
    assert.eq(draws, 1); assert.eq(plan.length, 8);
    plan.forEach((m, i) => { assert.eq(m.idx, i); assert.eq(m.of, 8); assert.eq(m.kind, 'goblin_runt'); });
  });

  test('grunt gangs: full real garrison in Easy and Hard, stable caught IDs, ordinary spawn gate', () => {
    const prev = Difficulty.mode(), sizes = new Set();
    try {
      for (let tx = 0; tx < 10000 && sizes.size < 6; tx++) {
        const g = world(tx);
        if (g.group !== 'grunt_gang' || sizes.has(g.n)) continue;
        sizes.add(g.n);
        const { entry, cand } = fixture(tx, g.sid), opts = { tileEdgeM: edge, caughtSet: new Set() };
        Difficulty.setMode('hard');
        const hard = L.garrisonFor(entry, cand, opts);
        assert.eq(hard.length, g.n, 'all members seat on open ground');
        assert.eq(new Set(hard.map(c => c.id)).size, g.n);
        hard.forEach(c => {
          assert.eq(c.kind, 'goblin_runt'); assert.eq(c.group, 'grunt_gang');
          assert.truthy(c.immobile && c.lair === g.sid);
          const ix = Math.floor((c.x - cand.ox) / cellM), iy = Math.floor(c.y / cellM);
          assert.truthy(W.isSpawnCell(entry.grid, N, N, ix, iy, entry._spawnOpts, creatureSpawnClass(c.kind)));
        });
        Difficulty.setMode('easy');
        assert.eq(JSON.stringify(L.garrisonFor(entry, cand, opts)), JSON.stringify(hard), 'authored gang bypasses only its mode cap');
        const caught = hard[1].id;
        assert.eq(JSON.stringify(L.garrisonFor(entry, cand, { ...opts, caughtSet: new Set([caught]) })),
          JSON.stringify(hard.filter(c => c.id !== caught)), 'caught member removed without rerolling survivors');
        entry._spawnOpts.spawnWhy.fill(W.SPAWN_WHY.QUIET);
        assert.eq(L.garrisonFor(entry, cand, opts).length, 0, 'the full gang still respects protected ground');
      }
      assert.eq([...sizes].sort().join(), '3,4,5,6,7,8', 'real garrisons exercise every count in both modes');
    } finally { Difficulty.setMode(prev); }
  });
})();
