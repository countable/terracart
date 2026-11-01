(() => {
  const N = 64;
  const fixture = () => ({ cellsPerEdge: N, tileEdgeM: N * 7, grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), objects: [] });
  const run = (entry, tx = 0, options = {}, caught = []) => WorldGen.runSteps(HabitatSpawns.populationSteps(
    { tileEdgeM: entry.tileEdgeM, save: { caught } }, entry, tx, 0,
    { spawnOpts: { occupied: new Set(), spawnWhy: entry.spawnWhy, gameplayTiers: entry.gameplayTiers }, ...options }));
  test('shared spawn pipeline: winning ownership never falls back from an empty or incomplete zone', () => {
    const entry = fixture();
    entry.zone = { coverage: new Uint16Array(N * N).fill(1), anchors: [] };
    assert.eq(SpawnPipeline.ownerAt(entry, 0).key, 'Nexus:unassigned');
    assert.eq(run(entry).length, 0, 'missing zone rows cannot borrow Grass inhabitants');
    entry.zone.anchors.push({ kind: 'grove', variant: 'marine_meadow', key: 'empty' });
    const marine = run(entry);
    assert.gt(marine.length, 0, 'Marine Meadow now has its declared rare signature');
    assert.truthy(marine.every(c => c.kind === HabitatSpawns.SIGNATURE_ENEMIES['Nexus:marine_meadow'].kind), 'signature row does not borrow Grass fauna or enemies');
  });
  test('shared spawn pipeline: area loss removes only those enemy candidates and never refills survivors', () => {
    const complete = fixture(), half = fixture();
    half.spawnWhy = new Uint32Array(N * N);
    for (let i = 0; i < N * N; i++) if (i % N >= N / 2) half.spawnWhy[i] = WorldGen.SPAWN_WHY.FARM_INTERIOR;
    const full = run(complete, 0, { category: 'enemy' }), remaining = run(half, 0, { category: 'enemy' });
    const sig = cs => cs.map(c => `${c.id}:${c.x},${c.y}`).sort().join('|');
    assert.gt(full.length, remaining.length);
    assert.eq(sig(remaining), sig(full.filter(c => c._surfaceSpawn.cx < N / 2)), 'no relocation, reallocation or reroll on eligible cells');
  });
  test('shared spawn pipeline: another zone cannot change species or rate on residual terrain', () => {
    const complete = fixture(), withRoad = fixture();
    withRoad.streetArea = new Uint8Array(N * N); withRoad.streetAreaVariants = new Uint16Array(N * N);
    for (let i = 0; i < N * N; i++) if (i % N >= N / 2) {
      withRoad.streetArea[i] = 1; withRoad.streetAreaVariants[i] = StreetVariants.VARIANT_BY_ID.toadstool.code;
    }
    const sig = cs => cs.filter(c => c._surfaceSpawn?.cx < N / 2).map(c => c.id).sort().join('|');
    assert.eq(sig(run(complete, 0, { category: 'enemy' })), sig(run(withRoad, 0, { category: 'enemy' })));
    assert.eq(SpawnPipeline.ownerAt(withRoad, N - 1).key, 'Roads and paths:toadstool');
  });
  test('shared spawn pipeline: conditional fauna picks read the same explicit species rates', () => {
    const profile = HabitatSpawns.landProfile('GRASS');
    const declared = HabitatSpawns.densityRows('Terrain:GRASS').filter(r => r.category === 'fauna');
    assert.eq(JSON.stringify(HabitatSpawns.faunaRows(profile)), JSON.stringify(declared.map(r => ({ kind: r.kind, weight: r.per1000 }))));
    assert.eq(HabitatSpawns.pickFauna(HabitatSpawns.variantProfile('marine_meadow'), 'empty'), null);
  });
  test('shared spawn pipeline: historical aliases distribute across distinct current inhabitants before reuse', () => {
    const first = run(fixture(), 0, {}, ['chicken_0_0_0']);
    const chickens = first.filter(c => c.kind === 'chicken');
    assert.gte(chickens.length, 2);
    const assignments = new Map();
    for (const c of chickens) for (const alias of c._legacyDefeatIds || []) if (/^chicken_0_0_\d+$/.test(alias)) assignments.set(alias, c.id);
    const aliases = [...assignments.keys()].sort();
    assert.gte(aliases.length, chickens.length);
    assert.eq(new Set(aliases.slice(0, chickens.length).map(id => assignments.get(id))).size, chickens.length);
    const allAliases = first.flatMap(c => c._legacyDefeatIds || []);
    assert.eq(new Set(allAliases).size, allAliases.length, 'a historical ID must not hide two new bodies');
    const second = run(fixture(), 0, {}, ['chicken_0_0_2', 'chicken_0_0_0']);
    assert.eq(JSON.stringify(first), JSON.stringify(second), 'saved capture order cannot change generated records or migration');
  });
  test('shared spawn pipeline: cave species rows sum to depth rate and preserve giant share', () => {
    for (const depth of [1, 2, 5, 7, 10, 20]) {
      const rows = EnemySpawns.caveDensityRows(depth);
      assert.gt(rows.length, 0);
      const sum = rows.reduce((n, r) => n + r.per1000, 0);
      assert.lt(Math.abs(sum - EnemySpawns.caveDensityRate(depth)), 1e-9);
      const giants = rows.filter(r => EnemyRoster.get(r.kind).variantType === 'Giant');
      if (giants.length && giants.length < rows.length) assert.lt(Math.abs(giants.reduce((n, r) => n + r.per1000, 0) / sum - .05), 1e-9);
    }
  });
  test('shared spawn pipeline: party zombies preserve buried emergence metadata', () => {
    const entry = fixture();
    entry.zone = { coverage: new Uint16Array(N * N).fill(1), anchors: [{ kind: 'graveyard', variant: 'ordered_graves', key: 'graveyard-a' }] };
    entry.creatures = run(entry, 0, { category: 'enemy' });
    const groups = EnemyHabitats.groupsOf(entry).filter(g => g.baseKind === 'zombie');
    assert.gt(groups.length, 0);
    const extra = groups[0].extra(1);
    assert.truthy(extra);
    assert.truthy(extra.emergeFromGround);
    assert.truthy(extra._burrowed);
  });
  test('shared spawn pipeline: historical encounters never migrate across same-variant Nexus anchors', () => {
    const entry = fixture();
    entry.zone = { coverage: new Uint16Array(N * N), anchors: [
      { kind: 'grove', variant: 'orchard', key: 'orchard-a' },
      { kind: 'grove', variant: 'orchard', key: 'orchard-b' }] };
    entry.spawnWhy = new Uint16Array(N * N);
    for (let i = 0; i < N * N; i++) {
      entry.zone.coverage[i] = i % N < N / 2 ? 1 : 2;
      if (i % N < N / 2 && i !== 0) entry.spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
    }
    const legacy = WorldGen.runSteps(EnemyHabitats.legacySurfaceEncountersSteps(entry, 0, 0, new Set()));
    const leftIds = new Set(legacy.filter(c => c.x < entry.tileEdgeM / 2).flatMap(c => [c.id, ...(c._legacyDefeatIds || [])]));
    assert.gt(leftIds.size, 0, 'old block allocator had bodies in the small first anchor');
    const current = run(entry, 0, { category: 'enemy' }, ['zone_encounter_0_0_0_0_99']);
    assert.gt(current.length, 0);
    assert.eq(current.filter(c => c.x < entry.tileEdgeM / 2).length, 0, 'first anchor has no density body to inherit a defeat');
    assert.falsy(current.some(c => (c._legacyDefeatIds || []).some(id => leftIds.has(id))), 'a different orchard must never inherit first orchard defeats');
  });
})();
