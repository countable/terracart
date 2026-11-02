// Habitat ownership chooses the population before safety chooses seats.
(() => {
  const kinds = profile => HabitatSpawns.faunaRows(profile).map(row => row.kind);
  const fixture = (terrain = WorldGen.T.GRASS, N = 64) => ({ cellsPerEdge: N,
    tileEdgeM: 640, grid: new Uint8Array(N * N).fill(terrain), objects: [] });
  const generate = (entry, caught = [], mode = 'easy', pestFree = null, sceneOptions = {}) => {
    const marker = SPAWN_IN_TILE_SRC.indexOf('    // (Starter-cow');
    assert.gte(marker, 0, 'the real habitat population pass precedes starter guarantees');
    const spawn = spawnPassFn(SPAWN_IN_TILE_SRC.slice(0, marker) + '\nreturn creatures;');
    const previous = Difficulty.mode(); Difficulty.setMode(mode);
    try {
      const scene = Object.assign(new SceneCreatures(), { tileEdgeM: 640, cellM: 10,
        depth: 0, save: { caught }, startWorldM: { x: -5000, y: 0 }, _pestFreeZone: () => pestFree }, sceneOptions);
      return spawn.call(scene, entry, 0, 0);
    } finally { Difficulty.setMode(previous); }
  };
  const signature = creatures => creatures.map(c => `${c.id}:${c.kind}@${c.x},${c.y}`).sort().join('|');
  test('habitat populations: eligible area drives declared species rates rather than a tile quota', () => {
    const entry = fixture(); generate(entry);
    const expected = HabitatSpawns.densityRows('Terrain:GRASS').filter(r => r.category === 'fauna')
      .reduce((sum, r) => sum + r.per1000 * 4096 / 1000, 0);
    assert.inRange(entry.habitatPopulation.totals.fauna.requested, expected / 2, expected * 2);
    assert.lt(entry.habitatPopulation.totals.fauna.requested, 112, 'retired tile budget is not topped up');
    assert.eq(entry.habitatPopulation.totals.fauna.requested,
      entry.habitatPopulation.totals.fauna.placed + entry.habitatPopulation.totals.fauna.shortfall);
  });

  test('habitat populations: different animal species share a three-cell spacing preference', () => {
    const entry = fixture();
    const animals = generate(entry, [], 'hard').filter(c => c._habitatSpawn && !c.id.startsWith('enemy_habitat_'));
    assert.gt(new Set(animals.map(c => c.kind)).size, 1, 'the fixture exercises multiple species');
    assert.gt(animals.length, 0);
    assert.lte(animals.length, entry.habitatPopulation.totals.fauna.requested, 'spacing may reject candidates without refill');
    for (let i = 0; i < animals.length; i++) for (let j = i + 1; j < animals.length; j++) {
      const a = animals[i]._habitatSpawn, b = animals[j]._habitatSpawn;
      assert.gte(Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy)), 3,
        `${animals[i].kind} and ${animals[j].kind} should spread apart on ample land`);
    }
  });
  test('habitat populations: a small eligible remnant does not refill the old tile allowance', () => {
    const entry = fixture();
    entry.spawnWhy = new Uint16Array(4096).fill(WorldGen.SPAWN_WHY.RESTRICTED);
    for (let y = 20; y < 25; y++) for (let x = 20; x < 25; x++) entry.spawnWhy[y * 64 + x] = 0;
    const animals = generate(entry, [], 'hard').filter(c => c._habitatSpawn && !c._surfaceSpawn);
    assert.lte(animals.length, 25);
    assert.lt(entry.habitatPopulation.totals.fauna.requested, 5, 'only the tiny eligible area rolls its rates');
    assert.eq(signature(generate(entry, [], 'hard').filter(c => c._habitatSpawn && !c._surfaceSpawn)), signature(animals));
  });

  test('habitat populations: shared spacing includes authored seats without wrapping tile edges', () => {
    const spacing = HabitatSpawns.faunaSpacing(8, [7]);
    assert.eq(spacing.clearance(7), 0);
    assert.eq(spacing.clearance(6), 1);
    assert.eq(spacing.clearance(2 * 8 + 5), 2, 'diagonal clearance is Chebyshev distance');
    assert.eq(spacing.clearance(8), 3, 'the next row does not wrap to the far edge');
    spacing.add(8);
    assert.eq(spacing.clearance(8), 0);
    assert.eq(spacing.clearance(0), 1);
  });
  test('habitat populations: previews use their actual cells without a second tile-budget scale', () => {
    const make = () => { const e = fixture(); e.zone = { coverage: new Uint16Array(4096).fill(1),
      anchors: [{ kind: 'grove', variant: 'meadow', key: 'preview_grove' }] }; return e; };
    const baseline = generate(make());
    for (const habitatTileAreaScale of [0, .1, 1]) assert.eq(signature(generate(make(), [], 'easy', null,
      { habitatTileAreaScale })), signature(baseline), 'obsolete budget scale cannot thin or top up cell rows');
  });

  test('habitat populations: common landcovers collectively supply the core companions', () => {
    const grass = kinds(HabitatSpawns.landProfile('GRASS'));
    const residential = kinds(HabitatSpawns.landProfile('RESIDENTIAL'));
    for (const kind of ['chicken', 'cow', 'butterfly', 'rabbit', 'horse']) assert.includes(grass, kind);
    for (const kind of ['cat', 'dog', 'chicken', 'deer']) assert.includes(residential, kind);
    const entry = fixture();
    assert.truthy(generate(entry).some(c => c.kind === 'rabbit'), 'ordinary Grass actually produces Rabbits');
  });
  test('habitat populations: sheep graze grassland and pigs forage wetland', () => {
    const grass = fixture(WorldGen.T.GRASS), wetland = fixture(WorldGen.T.WETLAND);
    const grassKinds = generate(grass).map(c => c.kind), wetKinds = generate(wetland).map(c => c.kind);
    assert.includes(grassKinds, 'sheep');
    assert.falsy(grassKinds.includes('pig'));
    assert.includes(wetKinds, 'pig');
    assert.falsy(wetKinds.includes('sheep'));
    for (const name of ['FOREST', 'FARMLAND', 'RESIDENTIAL', 'ROCK']) {
      const rows = kinds(HabitatSpawns.landProfile(name));
      assert.falsy(rows.includes('pig'), name);
      assert.falsy(rows.includes('sheep'), name);
    }
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
    // Grass has crows, and easy shows only Difficulty crowCountMul of them:
    // a visibility overlay, so hard shows a superset of the same seats.
    const hard = generate(fixture(), [], 'hard');
    const notCrow = cs => cs.filter(c => c.kind !== 'crow' && !c._landEnemyReserve);
    assert.eq(signature(notCrow(hard)), signature(notCrow(baseline)));
    const hardSeats = new Set(hard.map(c => `${c.id}:${c.kind}@${c.x},${c.y}`));
    assert.truthy(baseline.every(c => hardSeats.has(`${c.id}:${c.kind}@${c.x},${c.y}`)), 'easy crows are a subset of hard crows');
    assert.eq(signature(notCrow(generate(fixture(), [], 'easy', { has: () => true }))), signature(notCrow(baseline)),
      'personal amnesty is a visibility overlay rather than a population reroll (it hides crows, the crop raiders)');
  });
  test('habitat populations: hard shows half again the landcover enemies from a shared reserve', () => {
    const landEnemies = cs => cs.filter(c => c.id.startsWith('enemy_habitat_'));
    const easyEntry = fixture(), hardEntry = fixture();
    const easy = landEnemies(generate(easyEntry)), hard = landEnemies(generate(hardEntry, [], 'hard'));
    assert.gt(easyEntry.habitatPopulation.totals.reserve.requested, 0);
    assert.lt(easyEntry.habitatPopulation.totals.reserve.requested, 25, 'reserve derives from cell rates');
    assert.eq(hardEntry.habitatPopulation.totals.reserve.placed, easyEntry.habitatPopulation.totals.reserve.placed,
      'both modes generate the same reserve');
    assert.falsy(easy.some(c => c._landEnemyReserve), 'easy hides the reserve');
    assert.eq(hard.length - easy.length, hardEntry.habitatPopulation.totals.reserve.placed, 'hard shows the same generated reserve');
    assert.eq(signature(hard.filter(c => !c._landEnemyReserve)), signature(easy), 'the base population is untouched');
  });
  test('habitat populations: safety holes remove candidate cells without relocating or refilling quotas', () => {
    const plain = fixture(), holes = fixture();
    holes.spawnWhy = new Uint16Array(4096);
    for (let i = 0; i < 4096; i++) if (i % 4 === 0) holes.spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
    const baseline = generate(plain), relocated = generate(holes);
    assert.lt(relocated.length, baseline.length, 'excluded candidate cells reduce the population');
    assert.lt(holes.habitatPopulation.totals.fauna.requested, plain.habitatPopulation.totals.fauna.requested);
    assert.lte(holes.habitatPopulation.totals.enemies.requested, plain.habitatPopulation.totals.enemies.requested);
    for (const c of relocated) {
      const index = Math.floor(c.y / 10) * 64 + Math.floor(c.x / 10);
      assert.eq(holes.spawnWhy[index], 0, 'no creature stands in a forbidden hole');
    }
    assert.eq(new Set(relocated.map(c => `${c.x},${c.y}`)).size, relocated.length, 'habitat allocation shares occupancy');
  });
  test('habitat populations: fully blocked ground has zero candidates and cannot borrow another habitat', () => {
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
    assert.eq(region.fauna.requested + region.enemies.requested, 0);
    assert.eq(region.fauna.placed + region.enemies.placed, 0);
    assert.eq(region.fauna.shortfall, region.fauna.requested);
    assert.eq(region.enemies.shortfall, region.enemies.requested);
    assert.truthy(creatures.every(c => c.x >= 320), 'blocked Nexus inhabitants never spill into ordinary Grass');
    assert.falsy(creatures.some(c => c.kind === 'mushroom_monster'));
  });
  test('habitat populations: four eligible cells cannot create a full tile population', () => {
    const entry = fixture(); entry.spawnWhy = new Uint16Array(4096).fill(WorldGen.SPAWN_WHY.RESTRICTED);
    for (let i = 0; i < 4; i++) entry.spawnWhy[i] = 0;
    const creatures = generate(entry);
    assert.lte(creatures.length, 4, 'four legal cells cannot seat more than four inhabitants');
    assert.lte(entry.habitatPopulation.totals.fauna.requested + entry.habitatPopulation.totals.enemies.requested, 4,
      'eligibility is applied before rate rolls');
  });

  test('habitat populations: one legacy cell defeat suppresses only one migrated habitat identity', () => {
    const entry = fixture(), key = HabitatSpawns.resolve(entry, 0).key;
    const legacy = { id: 'enemy_surface_0_0_1_1', key };
    const populations = WorldGen.runSteps(HabitatSpawns.populationSteps({ tileEdgeM: 640, cellM: 10 }, entry, 0, 0,
      { N: 64, cellM: 10, grid: entry.grid, spawnOpts: {}, legacyEnemies: [legacy, legacy] }));
    assert.eq(populations.filter(c => c._legacyDefeatIds?.includes(legacy.id)).length, 1,
      'duplicate historical candidate seats represent one old enemy');
  });

  test('habitat populations: beach rows assign aquatic rates to water and crab rates to sand', () => {
    const water = HabitatSpawns.densityRows('Terrain:WATER'), sand = HabitatSpawns.densityRows('Terrain:SAND');
    assert.eq(water.find(row => row.kind === 'jellyfish').per1000, .5);
    assert.eq(sand.find(row => row.kind === 'giant_crab').per1000, .5);
    assert.falsy(sand.some(row => row.kind === 'jellyfish'));
    assert.falsy(water.some(row => row.kind === 'giant_crab'));
    const inland = HabitatSpawns.landProfile('SAND');
    assert.falsy(HabitatSpawns.enemyRows(inland, 'SAND').some(row => row.id === 'jellyfish'));
  });

  test('habitat populations: ordinary shoreline retains shore crabs while Excluded water refuses aquatic seats', () => {
    const entry = fixture(WorldGen.T.SAND), mask = new Uint8Array(4096);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = y * 64 + x;
      if (x % 4 === 0) entry.grid[i] = WorldGen.T.WATER;
      else mask[i] = 1;
    }
    entry.scenic = { shore: { mask } };
    const enemies = [];
    for (let tx = 0; tx < 8; tx++) enemies.push(...WorldGen.runSteps(HabitatSpawns.populationSteps(
      { tileEdgeM: 640, save: {} }, { ...entry }, tx, 0, { spawnOpts: {}, category: 'enemy' })));
    assert.truthy(enemies.some(c => c.kind === 'giant_crab'));
    assert.falsy(enemies.some(c => c.kind === 'jellyfish'));
    for (const c of enemies) {
      assert.includes(['giant_crab', 'jellyfish'], c.kind);
      const index = c._surfaceSpawn.cy * 64 + c._surfaceSpawn.cx;
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
  test('habitat populations: authored inhabitants reserve their own seats without granting another ambient allowance', () => {
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
    assert.eq(entry.habitatPopulation.totals.fauna.authored || 0, 0, 'authored features are separate requests, not budget credit');
    assert.gte(entry.habitatPopulation.totals.fauna.shortfall, 1);
    for (const authored of [{ ...chosen, kind: 'horse' }, { ...chosen, x: -10, y: -10 }]) {
      const other = make(), all = run(other, [authored]);
      assert.eq(all.length, authored.x < 0 ? baseline.length : baseline.length - 1, 'any authored occupant reserves its own seat; foreign seats do not');
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
      assert.eq(entry.habitatPopulation.totals.fauna.requested, entry.habitatPopulation.totals.fauna.placed + entry.habitatPopulation.totals.fauna.shortfall, 'crowded density candidates are accounted for without replacement');
    }
    assert.falsy(HabitatSpawns.allows('deer', WorldGen.T.ORCHARD), 'the Deer terrain restriction remains intact');
  });

  test('habitat populations: rare Owlbears belong only to Old Growth Paths with stable density candidates', () => {
    const profile = HabitatSpawns.roadProfile('old_growth_path');
    assert.includes(HabitatSpawns.enemyRows(profile, WorldGen.T.FOREST).map(row => row.id), 'owlbear');
    assert.includes(HabitatSpawns.enemyRows(profile, WorldGen.T.FOREST).map(row => row.id), 'treant');
    for (const name of Object.keys(HabitatSpawns.LAND_FAUNA)) {
      assert.falsy(HabitatSpawns.enemyRows(HabitatSpawns.landProfile(name), WorldGen.T[name])
        .some(row => row.id === 'owlbear'), 'not in ordinary ' + name);
    }
    for (const id of ['ancient_grove', 'spooky_woods', 'sacred_grove']) {
      assert.falsy(HabitatSpawns.enemyRows(HabitatSpawns.variantProfile(id, 'grove'), WorldGen.T.FOREST)
        .some(row => row.id === 'owlbear'), 'not borrowed by ' + id);
    }
    assert.eq(EnemyRoster.get('owlbear').cave, null);
    const run = (tx, blocked = false) => {
      const entry = fixture(WorldGen.T.FOREST, 16);
      entry.streetArea = new Uint8Array(256).fill(1);
      entry.streetAreaVariants = new Uint8Array(256).fill(StreetVariants.VARIANT_BY_ID.old_growth_path.code);
      if (blocked) entry.spawnWhy = new Uint16Array(256).fill(WorldGen.SPAWN_WHY.RESTRICTED);
      const scene = { depth: 0, tileEdgeM: 640, cellM: 40 };
      const steps = HabitatSpawns.populationSteps(scene, entry, tx, 0);
      let step; do { step = steps.next(); } while (!step.done);
      return { creatures: step.value, stats: entry.habitatPopulation.totals.enemies };
    };
    let requested = 0, firstTile = null;
    for (let tx = 0; tx < 200; tx++) {
      const result = run(tx);
      const owlbears = result.creatures.filter(c => c.kind === 'owlbear');
      requested += owlbears.length;
      if (owlbears.length && firstTile === null) firstTile = tx;
      for (const c of result.creatures.filter(c => c.kind === 'owlbear')) {
        assert.eq(c._habitatSpawn.key, 'street:old_growth_path');
        assert.truthy(EnemySpawns.surfaceActive(sceneForVisibility(), c), 'daytime encounter is visible');
      }
    }
    function sceneForVisibility() { return { depth: 0, save: {}, startWorldM: { x: -5000, y: 0 } }; }
    assert.inRange(requested, 10, 45, 'rare .5 per thousand cells across a broad deterministic sample');
    assert.truthy(firstTile !== null);
    assert.eq(signature(run(firstTile).creatures), signature(run(firstTile).creatures), 'revisits keep identities and seats');
    const nearHome = run(firstTile).creatures.find(c => c.kind === 'owlbear');
    assert.falsy(EnemySpawns.surfaceActive({ depth: 0, save: {}, startWorldM: nearHome._surfaceSpawn }, nearHome),
      'the shared tier safety rule still hides the Owlbear near Home');
    const blocked = run(firstTile, true);
    assert.eq(blocked.stats.requested, 0, 'ineligible cells do not roll density candidates');
    assert.eq(blocked.stats.placed, 0);
    assert.eq(blocked.creatures.filter(c => c.kind === 'owlbear').length, 0);
  });

  test('habitat populations: Variety snakes stay inside their corridor and remain ordinary enemies', () => {
    const make=()=>{
      const entry=fixture();entry.streetArea=new Uint8Array(4096);entry.streetAreaVariants=new Uint8Array(4096);
      for(let y=20;y<25;y++)for(let x=2;x<62;x++){
        const i=y*64+x;entry.streetArea[i]=1;entry.streetAreaVariants[i]=StreetVariants.VARIANT_BY_ID.way_of_variety.code;
      }
      return entry;
    };
    const varietySnake=c=>c.kind==='snake'&&c._habitatSpawn?.key==='street:way_of_variety';
    const a=make(), first=generate(a).filter(varietySnake), second=generate(make()).filter(varietySnake);
    assert.eq(first.length,3,'three safe slots for the existing section owner');
    assert.eq(signature(first),signature(second),'stable snake identities and positions');
    for(const c of first){const i=Math.floor(c.y/10)*64+Math.floor(c.x/10);assert.eq(a.streetArea[i],1,'inside winning corridor');}
    const row=EnemyRoster.ROWS.find(r=>r.id==='snake');
    assert.falsy(row.boss);assert.falsy(row.untargetable);assert.eq(row.movement.pattern,'pursue');
    assert.eq(generate(fixture()).filter(varietySnake).length,0,'no Variety-owned snake outside its corridor');
    assert.includes(row.surface.biomes,'GRASS','the corridor uses the shared native snake');
  });

})();
