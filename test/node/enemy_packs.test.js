(() => {
  const N = 24, edge = N * 7, ownerKey = 'Nexus:broken_masonry', kind = 'club_goblin';
  const fixture = () => ({ cellsPerEdge: N, tileEdgeM: edge, grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS),
    gameplayTiers: new Uint8Array(N * N).fill(GameplayTiers.CORE), objects: [],
    zone: { coverage: new Uint16Array(N * N).fill(1), anchors: [{ kind: 'graveyard', variant: 'broken_masonry', key: 'pack-a' }] } });
  const key = index => `0|0|${ownerKey}|enemy|${kind}|${index}`;
  const anchor = predicate => {
    for (let i = N * 4; i < N * (N - 4); i++) if (i % N >= 4 && i % N < N - 4
      && HabitatSpawns.packSize(kind, key(i)) === 4 && (!predicate || predicate(i))) return i;
    throw new Error('fixture needs a four-member pack anchor');
  };
  const run = (entry, index, caught = [], probabilities = []) => {
    const oldRoll = SpawnPipeline.roll;
    SpawnPipeline.roll = (id, probability) => {
      if (id === key(index)) { probabilities.push(probability); return true; }
      return false;
    };
    try {
      return WorldGen.runSteps(HabitatSpawns.populationSteps({ tileEdgeM: edge, save: { caught } }, entry, 0, 0,
        { category: 'enemy', skipLegacy: true, spawnOpts: { occupied: new Set(), gameplayTiers: entry.gameplayTiers } }));
    } finally { SpawnPipeline.roll = oldRoll; }
  };
  test('enemy packs: table keeps expected individual density and mixes groups with solos', () => {
    let total = 0, grouped = 0;
    for (let i = 0; i < 20000; i++) {
      const size = HabitatSpawns.packSize(kind, 'distribution-' + i);
      assert.inRange(size, 1, 4); total += size; if (size > 1) grouped++;
    }
    assert.lt(Math.abs(total / 20000 - HabitatSpawns.packMean(kind)), .03);
    assert.lt(Math.abs(grouped / 20000 - HabitatSpawns.ENEMY_PACKS[kind].chance), .02);
    const index = anchor(), probabilities = [], entry = fixture();
    run(entry, index, [], probabilities);
    const row = HabitatSpawns.densityRows(ownerKey).find(r => r.kind === kind);
    assert.eq(probabilities[0], row.per1000 / 1000 / HabitatSpawns.packMean(kind));
    for (const solitary of ['red_dragon', 'jellyfish', 'giant_bear', 'chicken']) {
      assert.eq(HabitatSpawns.packMean(solitary), 1);
      assert.eq(HabitatSpawns.packSize(solitary, 'test'), 1);
    }
  });
  test('enemy packs: actual population places nearby stable members and registers each once', () => {
    const index = anchor(), entry = fixture(), creatures = run(entry, index);
    assert.eq(creatures.length, 4);
    assert.eq(entry.habitatPopulation.totals.enemies.requested, 4);
    assert.eq(new Set(creatures.map(c => c.id)).size, 4);
    assert.eq(EnemyHabitats.groupsOf(entry).length, 4, 'party policy has one registration per body, no extra pack allowance');
    for (const c of creatures) {
      assert.eq(c.kind, kind); assert.eq(c._spawnPack.id, creatures[0].id);
      assert.lte(Math.max(Math.abs(c._surfaceSpawn.cx - index % N), Math.abs(c._surfaceSpawn.cy - Math.floor(index / N))), 3);
      assert.truthy(EnemySpawns.SHARED_ID_RE.test(c.id));
    }
    assert.eq(JSON.stringify(creatures), JSON.stringify(run(fixture(), index)), 'rebuilds repeat identities and seats');
    const partyIds = EnemyHabitats.groupsOf(entry).map(group => group.extra(1)?.id).filter(Boolean);
    assert.eq(new Set([...creatures.map(c => c.id), ...partyIds]).size, creatures.length + partyIds.length);
  });
  test('enemy packs: blocked member drops without relocating or refilling its group', () => {
    const index = anchor(), before = run(fixture(), index), blocked = fixture();
    const child = before.find(c => c._spawnPack.ordinal === 1);
    blocked.gameplayTiers[child._surfaceSpawn.cy * N + child._surfaceSpawn.cx] = GameplayTiers.EXCLUDED;
    const after = run(blocked, index);
    assert.eq(JSON.stringify(after), JSON.stringify(before.filter(c => c.id !== child.id)));
    assert.eq(blocked.habitatPopulation.totals.enemies.shortfall, 1);
    const noAnchor = fixture(); noAnchor.gameplayTiers[index] = GameplayTiers.EXCLUDED;
    assert.eq(run(noAnchor, index).length, 0, 'a blocked anchor cannot create orphaned pack children');
  });
  test('enemy packs: nearby same-variant Nexus instances do not share members', () => {
    const index = anchor(i => HabitatSpawns.packCells(kind, key(i), i, N).some(j => j % N >= N / 2) && i % N < N / 2);
    const entry = fixture(); entry.zone.anchors.push({ kind: 'graveyard', variant: 'broken_masonry', key: 'pack-b' });
    for (let i = 0; i < N * N; i++) if (i % N >= N / 2) entry.zone.coverage[i] = 2;
    const creatures = run(entry, index);
    assert.gt(creatures.length, 0); assert.lt(creatures.length, 4);
    for (const c of creatures) assert.lt(c._surfaceSpawn.cx, N / 2);
  });
  test('enemy packs: saved defeats cannot alter generated pack reservations', () => {
    const index = anchor(), before = run(fixture(), index);
    assert.eq(JSON.stringify(before), JSON.stringify(run(fixture(), index, [before[1].id])));
    const children = before.filter(c => c._spawnPack.ordinal);
    assert.truthy(children.every(c => c._legacyDefeatIds?.length === 1), 'children retain their old singleton cell identity');
    const aliases = children.flatMap(c => c._legacyDefeatIds);
    assert.eq(new Set(aliases).size, aliases.length);
  });
  test('enemy packs: caves use the same grouped rate and preserve defeated child identities', () => {
    const caveKind = 'rat', prefix = 'enemy_cave_1_0_0_density_rat_';
    let index = N * 5 + 5;
    while (HabitatSpawns.packSize(caveKind, prefix + index) !== 4) index++;
    const oldRows = EnemySpawns.caveDensityRows, oldContext = EnemySpawns.caveContextAt, oldRoll = SpawnPipeline.roll;
    const probabilities = [];
    EnemySpawns.caveDensityRows = () => [{ kind: caveKind, per1000: 4.6 }];
    EnemySpawns.caveContextAt = () => ({ id: 'same-pocket', theme: 'natural', kinds: [caveKind] });
    SpawnPipeline.roll = (id, p) => { if (id === prefix + index) { probabilities.push(p); return true; } return false; };
    const cave = caught => {
      const entry = { cellsPerEdge: N, tileEdgeM: edge, grid: new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR), objects: [] };
      SceneCreatures.prototype.spawnCaveCreatures.call({ tileEdgeM: edge, save: { caught } }, entry, 0, 0, 1);
      return entry;
    };
    try {
      const entry = cave([]), before = entry.creatures;
      assert.eq(before.length, 4); assert.eq(entry.cavePopulation.requested, 4);
      assert.eq(probabilities[0], .0046 / HabitatSpawns.packMean(caveKind));
      assert.truthy(before.every(c => c._spawnPack?.id === prefix + index));
      const child = before.find(c => c._spawnPack.ordinal === 1);
      assert.eq(JSON.stringify(cave([child.id]).creatures), JSON.stringify(before.filter(c => c.id !== child.id)));
      assert.eq(JSON.stringify(cave([child._legacyDefeatIds[1]]).creatures), JSON.stringify(before.filter(c => c.id !== child.id)),
        'former singleton defeat also suppresses its replacement pack child');
      const aliases = before.flatMap(c => c._legacyDefeatIds);
      assert.eq(new Set(aliases).size, aliases.length);
    } finally { EnemySpawns.caveDensityRows = oldRows; EnemySpawns.caveContextAt = oldContext; SpawnPipeline.roll = oldRoll; }
  });
  test('enemy packs: cave members cannot cross a neighbouring habitat', () => {
    const kind = 'rat', prefix = 'enemy_cave_1_0_0_density_rat_';
    let index;
    for (let i = N * 4; i < N * (N - 4); i++) if (i % N < N / 2 && HabitatSpawns.packSize(kind, prefix + i) === 4
      && HabitatSpawns.packCells(kind, prefix + i, i, N).some(j => j % N >= N / 2)) { index = i; break; }
    assert.truthy(index != null);
    const oldRows = EnemySpawns.caveDensityRows, oldContext = EnemySpawns.caveContextAt, oldRoll = SpawnPipeline.roll;
    EnemySpawns.caveDensityRows = () => [{ kind, per1000: 4.6 }];
    EnemySpawns.caveContextAt = (_, __, ___, cx) => ({ id: cx < N / 2 ? 'left' : 'right', theme: 'natural', kinds: [kind] });
    SpawnPipeline.roll = id => id === prefix + index;
    try {
      const entry = { cellsPerEdge: N, tileEdgeM: edge, grid: new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR), objects: [] };
      SceneCreatures.prototype.spawnCaveCreatures.call({ tileEdgeM: edge, save: { caught: [] } }, entry, 0, 0, 1);
      assert.gt(entry.creatures.length, 0); assert.lt(entry.creatures.length, 4);
      assert.truthy(entry.creatures.every(c => c._spawnOwner === 'Underground:1:left' && c.x / 7 < N / 2));
    } finally { EnemySpawns.caveDensityRows = oldRows; EnemySpawns.caveContextAt = oldContext; SpawnPipeline.roll = oldRoll; }
  });
})();
