(() => {
  const entry = (N = 64) => ({ cellsPerEdge: N, tileEdgeM: 640,
    baseGrid: new Array(N * N).fill(WorldGen.T.CAVE_FLOOR), genObjects: [] });
  const signature = rows => rows.map(c => `${c.id}:${c.x},${c.y}`).join('|');
  test('enemy habitats: cave themes agree at tile seams and demons/roosts respect depth', () => {
    const a = entry();
    for (let depth = 1; depth <= 12; depth++) {
      for (let y = 0; y < 64; y += 4) {
        const left = EnemyHabitats.caveAt(a, -1, 2, 63.5, y, depth);
        const right = EnemyHabitats.caveAt(a, 0, 2, -.5, y, depth);
        assert.eq(left.id, right.id);
        assert.eq(left.theme, right.theme);
      }
      const themes = new Set();
      for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) {
        themes.add(EnemyHabitats.caveAt(a, 0, 0, x, y, depth).theme);
      }
      if (depth <= 4) assert.falsy(themes.has('infernal'));
      if (depth < 9) assert.falsy(themes.has('roost'));
    }
  });
  test('enemy habitats: dragon roosts have one owner per region and reserve their generated seat', () => {
    const ids = new Set(); let count = 0;
    for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) {
      const e = entry(), occupied = new Set();
      const dragons = EnemyHabitats.caveSites(e, tx, ty, 9, occupied);
      assert.eq(signature(dragons), signature(EnemyHabitats.caveSites(entry(), tx, ty, 9, new Set())));
      for (const c of dragons) {
        assert.falsy(ids.has(c.id)); ids.add(c.id); count++;
        assert.eq(c.kind, 'red_dragon'); assert.truthy(c._cave); assert.falsy(c.lair);
        assert.eq(c.homeX, c.x); assert.eq(c.homeY, c.y);
        const cx = Math.floor((c.x - tx * 640) / 10), cy = Math.floor((c.y - ty * 640) / 10);
        assert.truthy(occupied.has(cy * 64 + cx));
        assert.eq(EnemyHabitats.caveAt(e, tx, ty, cx, cy, 9).id, c._habitatRegion);
      }
    }
    assert.gt(count, 0, 'the fixture exercises actual roosts');
    assert.eq(EnemyHabitats.caveSites(entry(), 0, 0, 8, new Set()).length, 0);
  });
  test('enemy habitats: roosts need floor chambers, avoid generated stairs, and ignore player edits', () => {
    const e = entry(), base = EnemyHabitats.caveSites(e, 0, 0, 9, new Set());
    assert.gt(base.length, 0);
    const edited = { ...entry(), grid: new Array(4096).fill(WorldGen.T.CAVE_WALL),
      objects: base.map(c => ({ kind: 'staircase', x: c.x, y: c.y, _synthetic: true })),
      save: { caught: base.map(c => c.id) } };
    assert.eq(signature(EnemyHabitats.caveSites(edited, 0, 0, 9, new Set())), signature(base),
      'defeats and live edits are caller filters, never a seat reroll');
    const blocked = entry(); blocked.baseGrid.fill(WorldGen.T.CAVE_WALL);
    assert.eq(EnemyHabitats.caveSites(blocked, 0, 0, 9, new Set()).length, 0);
    const stairs = entry(); stairs.genObjects = base.map(c => ({ kind: 'staircase', x: c.x, y: c.y }));
    const after = EnemyHabitats.caveSites(stairs, 0, 0, 9, new Set());
    for (const c of after) for (const s of stairs.genObjects) assert.gte(Math.hypot(c.x - s.x, c.y - s.y), 50);
    const occupied = new Set(Array.from({ length: 4096 }, (_, i) => i));
    assert.eq(EnemyHabitats.caveSites(entry(), 0, 0, 9, occupied).length, 0);
  });
})();

test('enemy habitats: actual beach spawn pass includes pirates and hostile crabs, never inland sand', () => {
  const body = SPAWN_IN_TILE_SRC.slice(0, SPAWN_IN_TILE_SRC.indexOf('    // (Starter-cow'));
  const generate = new Function('entry', 'tx', 'ty', body + '\nreturn creatures;');
  const run = (beach, caught = []) => {
    const scene = Object.assign(new SceneCreatures(), { tileEdgeM: 640, save: { caught },
      startWorldM: { x: -5000, y: 0 }, _pestFreeZone: () => null });
    const entry = { cellsPerEdge: 64, tileEdgeM: 640, grid: new Array(4096).fill(WorldGen.T.SAND), objects: [],
      scenic: beach ? { shore: { mask: new Uint8Array(4096).fill(1) } } : null };
    return generate.call(scene, entry, 0, 0).filter(c => c._surfaceSpawn);
  };
  const beach = run(true);
  assert.truthy(beach.some(c => c.kind === 'giant_crab'));
  assert.truthy(beach.some(c => c.kind === 'pirate_grunt' || c.kind === 'pirate_gunner'));
  assert.falsy(run(false).some(c => /pirate|giant_crab/.test(c.kind)));
  const sig = cs => cs.map(c => `${c.id}:${c.kind}:${c.x},${c.y}`).join('|');
  assert.eq(sig(run(true, [beach[0].id])), sig(beach.slice(1)), 'defeat removes one seat without rerolling survivors');
  assert.falsy(Combat.isEnemyKind('crab'), 'the tameable shore crab remains fauna');
});

test('enemy habitats: every selected cave theme has an eligible family through deep levels', () => {
  for (let depth = 1; depth <= 20; depth++) {
    const band = EnemyHabitats.THEME_BANDS.find(b => depth <= b.max);
    for (const theme of new Set(band.themes)) {
      const context = { kinds: EnemyHabitats.FAMILIES[theme] };
      const pool = EnemySpawns.caveRows(depth, context);
      assert.gt(pool.length, 0, `${theme} has residents at depth ${depth}`);
      for (const row of pool) {
        assert.falsy(row.retired); assert.falsy(row.id === 'red_dragon', 'dragons have finite roost seats');
        if (theme === 'infernal') assert.gte(depth, 5);
      }
    }
  }
  assert.truthy(EnemySpawns.caveRows(4, { kinds: EnemyHabitats.FAMILIES.warren }).some(r => r.id === 'bomb_goblin'));
});
