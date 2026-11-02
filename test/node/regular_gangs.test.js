(function () {
  const N = 24, cellM = 7, edge = N * cellM, kind = 'goblin_runt';
  const variants = ['goblin_gang', 'barricade', 'snare'];
  const fixture = variant => ({ cellsPerEdge: N, tileEdgeM: edge,
    grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), objects: [],
    gameplayTiers: new Uint8Array(N * N).fill(GameplayTiers.CORE),
    streetArea: new Uint8Array(N * N).fill(1),
    streetAreaVariants: new Uint8Array(N * N).fill(StreetVariants.VARIANT_BY_ID[variant].code) });
  const request = (variant, i) => `0|0|Roads and paths:${variant}|enemy|${kind}|${i}`;
  function anchor(variant) {
    for (let i = N * 5 + 5; i < N * (N - 5); i++)
      if (i % N > 4 && i % N < N - 5 && HabitatSpawns.packSize(kind, request(variant, i)) === 4) return i;
    throw new Error('fixture needs a four-member gang');
  }
  function run(entry, variant, index, probabilities = []) {
    const oldRoll = SpawnPipeline.roll;
    SpawnPipeline.roll = (key, probability) => {
      if (key !== request(variant, index)) return false;
      probabilities.push(probability); return true;
    };
    try {
      return WorldGen.runSteps(HabitatSpawns.populationSteps({ tileEdgeM: edge, save: {} }, entry, 0, 0,
        { category: 'enemy', skipLegacy: true, spawnOpts: { gameplayTiers: entry.gameplayTiers } }));
    } finally { SpawnPipeline.roll = oldRoll; }
  }
  test('regular gangs: all three street variants use the shared pack draw and individual rate', () => {
    for (const variant of variants) {
      const i = anchor(variant), probabilities = [], entry = fixture(variant);
      const creatures = run(entry, variant, i, probabilities);
      const row = HabitatSpawns.densityRows('Roads and paths:' + variant).find(r => r.kind === kind);
      assert.eq(probabilities[0], row.per1000 / 1000 / HabitatSpawns.packMean(kind));
      assert.eq(creatures.length, 4);
      assert.eq(entry.habitatPopulation.totals.enemies.requested, 4);
      assert.truthy(creatures.every(c => c.kind === kind && c._spawnPack && c._spawnOwner === 'Roads and paths:' + variant));
      assert.eq(JSON.stringify(creatures), JSON.stringify(run(fixture(variant), variant, i)), 'stable ordinary spawn identities');
      assert.truthy(creatures.every(c => !c._lairId && !c.group), 'no authored gang is added');
    }
  });
  test('regular gangs: blocked and neighbouring-owner seats lose members without refill', () => {
    const variant = 'goblin_gang', i = anchor(variant), before = run(fixture(variant), variant, i);
    for (const block of ['terrain', 'owner']) {
      const entry = fixture(variant), child = before.find(c => c._spawnPack.ordinal === 1);
      const at = child._surfaceSpawn.cy * N + child._surfaceSpawn.cx;
      if (block === 'terrain') entry.grid[at] = WorldGen.T.CAVE_WALL;
      else entry.streetAreaVariants[at] = StreetVariants.VARIANT_BY_ID.orchard.code;
      const after = run(entry, variant, i);
      assert.eq(JSON.stringify(after), JSON.stringify(before.filter(c => c.id !== child.id)), block);
      assert.eq(entry.habitatPopulation.totals.enemies.shortfall, 1);
    }
  });
})();
