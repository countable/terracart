// Exercise the shipped cave population pass: safety holes remove seats, and
// saved defeats remove bodies only after deterministic reservations exist.
(() => {
  const body = SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, '');
  const generate = new Function('entry', 'tx', 'ty', 'depth', body);
  const N = 80, edge = N * 7;
  const run = (blocked, caught = []) => {
    const grid = new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR);
    const spawnWhy = new Uint16Array(N * N);
    if (blocked) for (let i = 0; i < N * N; i++)
      if (i % N < 59 || i % N >= 65) spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
    const entry = { cellsPerEdge: N, tileEdgeM: edge, grid, spawnWhy, objects: [] };
    generate.call({ tileEdgeM: edge, save: { caught } }, entry, 0, 0, 1);
    return entry.creatures;
  };
  const inOnePocket = fn => {
    const original = EnemySpawns.caveContextAt;
    EnemySpawns.caveContextAt = () => ({ id: 'fixture_pocket', theme: 'natural', kinds: EnemyHabitats.FAMILIES.natural });
    try { fn(); } finally { EnemySpawns.caveContextAt = original; }
  };
  test('cave population: excluded seats preserve the pocket enemy and Rabbit budgets', () => inOnePocket(() => {
    const before = run(false), after = run(true);
    assert.gt(before.length, 60);
    assert.eq(after.filter(c => c.kind === 'rabbit').length, before.filter(c => c.kind === 'rabbit').length);
    assert.eq(after.filter(c => c.kind !== 'rabbit').length, before.filter(c => c.kind !== 'rabbit').length);
    assert.eq(after.map(c => c.kind).join('|'), before.map(c => c.kind).join('|'), 'safety changes seats, not the selected species');
    assert.eq(new Set(after.map(c => `${c.x},${c.y}`)).size, after.length);
    for (const c of after) assert.inRange(Math.floor(c.x / 7), 59, 64);
    assert.eq(JSON.stringify(after), JSON.stringify(run(true)));
  }));
  test('cave population: defeating a relocated body leaves every surviving reservation unchanged', () => inOnePocket(() => {
    const before = run(true);
    assert.gt(before.length, 0);
    const after = run(true, [before[0].id]);
    assert.eq(JSON.stringify(after), JSON.stringify(before.slice(1)));
  }));
  test('cave population: safety holes preserve request IDs and prior cell defeats', () => inOnePocket(() => {
    const before = run(false), after = run(true);
    const signature = bodies => bodies.map(c => `${c.id}:${c.kind}`).join('|');
    assert.eq(signature(after), signature(before));
    const enemies = before.filter(c => c.kind !== 'rabbit');
    const oldIds = enemies.map(c => c._legacyDefeatIds[0]);
    assert.eq(new Set(oldIds).size, oldIds.length, 'one old defeat belongs to one request');
    assert.eq(run(true, enemies.map(c => c.id)).filter(c => c.kind !== 'rabbit').length, 0,
      'new defeats stay respected after relocation');
    assert.eq(run(true, oldIds).filter(c => c.kind !== 'rabbit').length, 0,
      'prior cell-based defeats stay respected after relocation');
    const defeated = enemies[0];
    const survived = after.filter(c => c.id !== defeated.id);
    assert.eq(JSON.stringify(run(true, [defeated._legacyDefeatIds[0]])), JSON.stringify(survived),
      'one migrated defeat leaves every other seat and identity unchanged');
    const everyAlias = after.flatMap(c => c._legacyDefeatIds || []);
    assert.eq(new Set(everyAlias).size, everyAlias.length, 'current-cell compatibility cannot reuse a canonical alias');
  }));

  test('cave population: fully excluded floor scans legal ground once per spawn class', () => inOnePocket(() => {
    const gate = WorldGen.isSpawnCell;
    let calls = 0;
    WorldGen.isSpawnCell = (...args) => { calls++; return gate(...args); };
    try {
      const entry = { cellsPerEdge: N, tileEdgeM: edge,
        grid: new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR),
        spawnWhy: new Uint16Array(N * N).fill(WorldGen.SPAWN_WHY.RESTRICTED), objects: [] };
      generate.call({ tileEdgeM: edge, save: { caught: [] } }, entry, 0, 0, 1);
      assert.eq(entry.creatures.length, 0);
      assert.lt(calls, 4 * N * N + 5000,
        'blocked requests reuse class pools instead of rescanning a whole pocket for each member');
    } finally { WorldGen.isSpawnCell = gate; }
  }));

})();
