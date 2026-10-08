// Habitat ownership chooses the population before safety chooses seats.
(() => {
  const kinds = profile => HabitatSpawns.faunaRows(profile).map(row => row.kind);
  const fixture = (terrain = WorldGen.T.GRASS, N = 64) => ({ cellsPerEdge: N,
    tileEdgeM: 640, grid: new Uint8Array(N * N).fill(terrain), objects: [] });
  const generate = (entry, caught = [], mode = 'easy', pestFree = null) => {
    const marker = SPAWN_IN_TILE_SRC.indexOf('    // (Starter-cow');
    assert.gte(marker, 0, 'the real habitat population pass precedes starter guarantees');
    const spawn = spawnPassFn(SPAWN_IN_TILE_SRC.slice(0, marker) + '\nreturn creatures;');
    const previous = Difficulty.mode(); Difficulty.setMode(mode);
    try {
      const scene = Object.assign(new SceneCreatures(), { tileEdgeM: 640, cellM: 10,
        depth: 0, save: { caught }, startWorldM: { x: -5000, y: 0 }, _pestFreeZone: () => pestFree });
      return spawn.call(scene, entry, 0, 0);
    } finally { Difficulty.setMode(previous); }
  };
  const signature = creatures => creatures.map(c => `${c.id}:${c.kind}@${c.x},${c.y}`).sort().join('|');
  test('habitat populations: common landcovers collectively supply the core companions', () => {
    const grass = kinds(HabitatSpawns.landProfile('GRASS'));
    const residential = kinds(HabitatSpawns.landProfile('RESIDENTIAL'));
    for (const kind of ['chicken', 'cow', 'butterfly', 'rabbit', 'horse']) assert.includes(grass, kind);
    for (const kind of ['cat', 'dog', 'chicken', 'deer']) assert.includes(residential, kind);
    const entry = fixture();
    assert.truthy(generate(entry).some(c => c.kind === 'rabbit'), 'ordinary Grass actually produces Rabbits');
  });
  test('habitat populations: plain roads and paths have no population profile', () => {
    for (const type of [WorldGen.T.ROAD, WorldGen.T.PATH]) {
      if (type == null) continue;
      const owner = HabitatSpawns.resolve(fixture(type), 0);
      assert.falsy(owner.profile, 'plain transport ground does not choose species');
    }
    assert.truthy(HabitatSpawns.roadProfile('toadstool'), 'an authored Road Variant has its own profile');
  });
  test('habitat populations: Nexus fauna are explicit, including Crows', () => {
    const profile = HabitatSpawns.variantProfile('ancient_grove', 'grove');
    assert.includes(kinds(profile), 'crow');
    const entry = fixture(WorldGen.T.PARK);
    entry.zone = { coverage: new Uint16Array(4096).fill(1), anchors: [
      { kind: 'grove', variant: 'ancient_grove', key: 'ancient_test', gx: 10, gy: 10 }] };
    // Several deterministic owners distinguish a real supplied population
    // from a lucky one-species selection or an attraction-only declaration.
    let crows = 0;
    for (let i = 0; i < 16; i++) {
      entry.zone.anchors[0].key = `ancient_test_${i}`;
      crows += generate(entry).filter(c => c.kind === 'crow').length;
    }
    assert.gt(crows, 0, 'Nexus generation supplies Crows without borrowing them from landcover');
  });
  test('habitat populations: captures hide only their identity and modes share world seats', () => {
    const baseline = generate(fixture());
    assert.gt(baseline.length, 0);
    const removed = baseline.find(c => !Combat.monster(c.kind)) || baseline[0];
    assert.eq(signature(generate(fixture(), [removed.id])), signature(baseline.filter(c => c.id !== removed.id)));
    assert.eq(signature(generate(fixture(), [], 'hard')), signature(baseline));
    assert.eq(signature(generate(fixture(), [], 'easy', { has: () => true })), signature(baseline),
      'personal amnesty is a visibility overlay rather than a population reroll');
  });
  test('habitat populations: safety holes relocate seats without thinning habitat quotas', () => {
    const plain = fixture(), holes = fixture();
    holes.spawnWhy = new Uint16Array(4096);
    for (let i = 0; i < 4096; i++) if (i % 4 === 0) holes.spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
    const baseline = generate(plain), relocated = generate(holes);
    assert.eq(relocated.length, baseline.length, 'ample remaining ground carries the full population');
    assert.eq(holes.habitatPopulation.totals.fauna.requested, plain.habitatPopulation.totals.fauna.requested);
    assert.eq(holes.habitatPopulation.totals.enemies.requested, plain.habitatPopulation.totals.enemies.requested);
    for (const c of relocated) {
      const index = Math.floor(c.y / 10) * 64 + Math.floor(c.x / 10);
      assert.eq(holes.spawnWhy[index], 0, 'no creature stands in a forbidden hole');
    }
    assert.eq(new Set(relocated.map(c => `${c.x},${c.y}`)).size, relocated.length, 'habitat allocation shares occupancy');
  });
  test('habitat populations: fully blocked ground records shortfalls rather than borrowing another habitat', () => {
    const entry = fixture();
    entry.zone = { coverage: new Uint16Array(4096), anchors: [
      { kind: 'grove', variant: 'mushroom_grove', key: 'blocked_grove', gx: 10, gy: 10 }] };
    entry.spawnWhy = new Uint16Array(4096);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
      const i = y * 64 + x; entry.zone.coverage[i] = 1;
      entry.spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
    }
    const creatures = generate(entry);
    const region = entry.habitatPopulation.regions.find(r => /blocked_grove/.test(r.key));
    assert.truthy(region, 'the authored owner retains its population budget');
    assert.gt(region.fauna.requested + region.enemies.requested, 0);
    assert.eq(region.fauna.placed + region.enemies.placed, 0);
    assert.eq(region.fauna.shortfall, region.fauna.requested);
    assert.eq(region.enemies.shortfall, region.enemies.requested);
    assert.truthy(creatures.every(c => c.x >= 320), 'blocked Nexus inhabitants never spill into ordinary Grass');
    assert.falsy(creatures.some(c => c.kind === 'mushroom_monster'));
  });
  test('habitat populations: crowded ground keeps its raw budget and reports bounded placement', () => {
    const entry = fixture(); entry.spawnWhy = new Uint16Array(4096).fill(WorldGen.SPAWN_WHY.RESTRICTED);
    for (let i = 0; i < 4; i++) entry.spawnWhy[i] = 0;
    const creatures = generate(entry);
    assert.lte(creatures.length, 4, 'four legal cells cannot seat more than four inhabitants');
    assert.gt(entry.habitatPopulation.totals.fauna.requested + entry.habitatPopulation.totals.enemies.requested, 4,
      'eligibility never changes the raw habitat budget');
    assert.truthy(entry.habitatPopulation.regions.some(r => r.fauna.shortfall + r.enemies.shortfall > 0));
  });

  test('habitat populations: one legacy cell defeat suppresses only one migrated habitat identity', () => {
    const entry = fixture(), key = HabitatSpawns.resolve(entry, 0).key;
    const legacy = { id: 'enemy_surface_0_0_1_1', key };
    const populations = WorldGen.runSteps(HabitatSpawns.populationSteps({ tileEdgeM: 640, cellM: 10 }, entry, 0, 0,
      { N: 64, cellM: 10, grid: entry.grid, spawnOpts: {}, legacyEnemies: [legacy, legacy] }));
    assert.eq(populations.filter(c => c._legacyDefeatIds?.includes(legacy.id)).length, 1,
      'duplicate historical candidate seats represent one old enemy');
  });

  test('habitat populations: ordinary shoreline uses its explicit aquatic enemy pool and water seats', () => {
    const entry = fixture(WorldGen.T.SAND), mask = new Uint8Array(4096);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = y * 64 + x;
      if (x % 4 === 0) entry.grid[i] = WorldGen.T.WATER;
      else mask[i] = 1;
    }
    entry.scenic = { shore: { mask } };
    const enemies = generate(entry).filter(c => c._surfaceSpawn);
    assert.truthy(enemies.some(c => c.kind === 'giant_crab'));
    assert.truthy(enemies.some(c => c.kind === 'jellyfish'));
    for (const c of enemies) {
      assert.includes(['giant_crab', 'jellyfish'], c.kind);
      const index = Math.floor(c.y / 10) * 64 + Math.floor(c.x / 10);
      if (c.kind === 'jellyfish') assert.eq(entry.grid[index], WorldGen.T.WATER);
      else assert.eq(mask[index], 1);
    }
  });

  test('habitat populations: ownership tolerates incomplete fields and honours typed corridor codes', () => {
    const incomplete = fixture(); incomplete.zone = { coverage: new Uint16Array(4096).fill(1) };
    assert.falsy(HabitatSpawns.resolve(incomplete, 0).profile, 'an incomplete reserved owner cannot borrow underlying land');
    const alias = fixture(); alias.zone = { idx: new Uint16Array(4096).fill(1),
      anchors: [{ kind: 'grove', variant: 'ancient_grove', key: 'alias_grove' }] };
    assert.eq(HabitatSpawns.resolve(alias, 0).key, 'zone:grove|alias_grove');
    const road = fixture(); road.streetArea = new Uint8Array(4096).fill(1);
    road.streetAreaVariants = new Uint8Array(4096).fill(StreetVariants.VARIANT_BY_ID.pilgrim.code);
    road.streetMarks = new Uint8Array(4096).fill(StreetVariants.VARIANT_BY_ID.toadstool.code);
    assert.eq(HabitatSpawns.resolve(road, 0).profile.id, 'pilgrim', 'winning corridor ownership precedes crossing furniture marks');
  });
  test('habitat populations: authored fauna satisfy matching Nexus slots without changing other identities', () => {
    const make = () => {
      const entry = fixture(WorldGen.T.PARK);
      entry.zone = { coverage: new Uint16Array(4096).fill(1), anchors: [
        { kind: 'grove', variant: 'ancient_grove', key: 'authored_grove', gx: 0, gy: 0 }] };
      return entry;
    };
    const run = (entry, authoredCreatures = []) => WorldGen.runSteps(HabitatSpawns.populationSteps(
      { tileEdgeM: 640, cellM: 10 }, entry, 0, 0,
      { N: 64, cellM: 10, grid: entry.grid, spawnOpts: {}, authoredCreatures }));
    const baseline = run(make()), chosen = baseline[0];
    assert.truthy(chosen);
    const entry = make(), after = run(entry, [{ ...chosen, id: 'authored_animal' }]);
    const identity = c => `${c.id}:${c.kind}`;
    assert.eq(after.map(identity).sort().join('|'), baseline.filter(c => c.id !== chosen.id).map(identity).sort().join('|'));
    assert.eq(entry.habitatPopulation.totals.fauna.authored, 1);
    assert.eq(entry.habitatPopulation.totals.fauna.shortfall, 0);
    for (const authored of [{ ...chosen, kind: 'horse' }, { ...chosen, x: -10, y: -10 }]) {
      const other = make(), all = run(other, [authored]);
      assert.eq(all.length, baseline.length, 'unlisted species and foreign seats do not consume this owner budget');
      assert.eq(other.habitatPopulation.totals.fauna.authored || 0, 0);
    }
  });

  test('habitat populations: Orchard Road Variant supplies fauna compatible with its own ground', () => {
    for (const terrain of [WorldGen.T.GRASS, WorldGen.T.ORCHARD, WorldGen.T.FARMLAND]) {
      const entry = fixture(terrain);
      entry.streetArea = new Uint8Array(4096).fill(1);
      entry.streetAreaVariants = new Uint8Array(4096).fill(StreetVariants.VARIANT_BY_ID.orchard.code);
      entry.spawnWhy = new Uint16Array(4096);
      const creatures = generate(entry);
      assert.gt(creatures.length, 0, 'an inhabited Road Variant cannot declare only incompatible animals');
      assert.truthy(creatures.every(c => c.kind === 'rabbit'));
      assert.eq(entry.habitatPopulation.totals.fauna.shortfall, 0);
    }
    assert.falsy(HabitatSpawns.allows('deer', WorldGen.T.ORCHARD), 'the Deer terrain restriction remains intact');
  });

})();
