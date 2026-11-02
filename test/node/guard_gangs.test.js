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
  test('wreck groups: removed gangs leave thieves and ordinary groups on the remaining ticket', () => {
    for (const t of [0, .5, 1]) {
      const counts = {};
      for (let i = 0; i < 10000; i++) {
        let draws = 0;
        const group = L.groupFor(9, t, () => { draws++; return (i + .5) / 10000; }, false);
        counts[group || 'plain'] = (counts[group || 'plain'] || 0) + 1;
        assert.eq(draws, 1);
      }
      assert.falsy(counts.grunt_gang, 'no wreck gang selection tickets');
      assert.eq(counts.thieves, 1500, 'fifteen percent of held houses get thieves');
      assert.eq(counts.plain, 10000 * .85 * (1 - L.GROUP_RATE[9]));
      // The splitting slime is a wreck's one ordinary group (bats left the surface).
      assert.eq(counts.splitter, 10000 * .85 * L.GROUP_RATE[9]);
    }
    assert.falsy(L.groupRows(11, 1, true).includes('grunt_gang'));
    assert.falsy(L.groupRows(12, 1, true).includes('grunt_gang'));
  });

  test('house thieves: seeded pairs seat in both modes and saved defeats stay removed', () => {
    const prev = Difficulty.mode(), sizes = new Set();
    try {
      for (let tx = 0; tx < 10000 && sizes.size < 2; tx++) {
        const g = world(tx);
        if (g.group !== 'thieves' || sizes.has(g.n)) continue;
        sizes.add(g.n);
        const { entry, cand } = fixture(tx, g.sid);
        const opts = { tileEdgeM: edge, caughtSet: new Set() };
        Difficulty.setMode('hard');
        const guards = L.garrisonFor(entry, cand, opts);
        assert.eq(guards.length, g.n);
        guards.forEach(c => {
          assert.eq(c.kind, 'thief'); assert.eq(c.group, 'thieves');
          assert.eq(c.lair, g.sid);
          assert.truthy(EnemyRoster.get(c.kind).ambush);
          assert.eq(Combat.monster(c.kind).hitAndRun.coins, 15);
        });
        Difficulty.setMode('easy');
        assert.eq(JSON.stringify(L.garrisonFor(entry, cand, opts)), JSON.stringify(guards));
        assert.eq(JSON.stringify(L.garrisonFor(entry, cand, { ...opts, caughtSet: new Set([guards[0].id]) })),
          JSON.stringify(guards.slice(1)), 'defeats remove thieves without rerolling survivors');
        entry._spawnOpts.spawnWhy.fill(W.SPAWN_WHY.QUIET);
        assert.eq(L.garrisonFor(entry, cand, opts).length, 0, 'protected ground excludes thieves');
      }
      assert.eq([...sizes].sort().join(), '1,2');
      assert.falsy(L.groupRows(11, 1, true).includes('thieves'));
      assert.falsy(L.groupRows(12, 1, true).includes('thieves'));
    } finally { Difficulty.setMode(prev); }
  });

  test('wreck groups: occupancy stays fixed and no seeded wreck generates a goblin gang', () => {
    let held = 0;
    for (let tx = 0; tx < 10000; tx++) {
      const g = world(tx);
      if (!g.held) continue;
      held++;
      assert.falsy(g.group === 'grunt_gang');
      assert.eq(JSON.stringify(g), JSON.stringify(world(tx)), 'structure selection stays deterministic');
    }
    assert.inRange(held / 10000, L.occupancyFor(9) - .02, L.occupancyFor(9) + .02);
    assert.falsy(L.GROUPS.grunt_gang);
    assert.falsy(L.GROUPS.street_goblin_gang);
    assert.falsy(L.TIER_GUARDS.street_goblin_gang);
    assert.falsy(L.FOCUS_RULES.street_goblin_gang);
    let draws = 0;
    const plan = L.expandGroup('splitter', 9, () => { draws++; return .5; });
    assert.eq(draws, 0, 'fixed groups preserve their count stream');
    assert.eq(plan.length, 1);
    assert.eq(plan[0].kind, 'split_slime');
  });
})();
