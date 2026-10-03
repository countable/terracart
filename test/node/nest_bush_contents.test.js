(function () {
  test('shaking bushes: stable contents split 20% baby, 40% slime and 40% local fauna', () => {
    const counts = { baby: 0, slime: 0, fauna: 0 };
    for (let i = 0; i < 50000; i++) {
      const id = `bush_${i}`;
      if (!isNestBush('shrub', id)) continue;
      const content = nestBushContents(id);
      counts[content.type]++;
      assert.eq(JSON.stringify(nestBushContents(id)), JSON.stringify(content));
      if (content.type === 'baby') assert.includes(babyItems(), content.item);
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.inRange(counts.baby / total, 0.17, 0.23);
    assert.inRange(counts.slime / total, 0.36, 0.44);
    assert.inRange(counts.fauna / total, 0.36, 0.44);
  });
  function world(fn) {
    const N = 20, cellM = 7, edge = N * cellM;
    const entry = { grid: new Uint8Array(N * N).fill(WorldGen.T.FOREST), cellsPerEdge: N,
      creatures: [], _spawnOpts: { roadMask: new Uint8Array(N * N), occupied: new Set(), pois: [] } };
    const bush = { kind: 'wildplant', crop: 'shrub', id: 'nested', x: 73.5, y: 73.5 };
    const scene = { depth: 0, cellM, tileEdgeM: edge, save: {},
      cellAt: () => ({ loaded: true, type: WorldGen.T.FOREST }) };
    const get = WorldGen.tileCache.get;
    WorldGen.tileCache.get = key => key === WorldGen.tileKey(0, 0) ? entry : undefined;
    try { fn({ scene, entry, bush }); } finally { WorldGen.tileCache.get = get; }
  }
  test('shaking bushes: ordinary slime or local fauna emerges on a legal nearby cell, only once', () => world(({ scene, entry, bush }) => {
    const slime = spawnNestBushCreature(scene, bush, 'slime');
    assert.truthy(slime); assert.eq(slime.kind, 'slime'); assert.falsy(slime.shiny);
    assert.truthy(slime._surfaceSpawn);
    assert.eq(spawnNestBushCreature(scene, bush, 'slime'), null);
    const fauna = spawnNestBushCreature(scene, { ...bush, id: 'forest-fauna' }, 'fauna');
    assert.truthy(fauna); assert.falsy(Combat.isEnemyKind(fauna.kind));
    const row = BIOME_FAUNA[fauna.kind];
    assert.truthy(row.primary.includes(WorldGen.T.FOREST) || row.fallback.includes(WorldGen.T.FOREST));
    assert.eq(entry.creatures.length, 2);
  }));
  test('shaking bushes: roads, Home wards, fires and pest amnesty forbid slime emergence', () => {
    for (const block of ['road', 'home', 'fire', 'amnesty']) world(({ scene, entry, bush }) => {
      if (block === 'road') entry._spawnOpts.roadMask.fill(1);
      if (block === 'home') scene.homeWorldPos = () => ({ x: bush.x, y: bush.y });
      if (block === 'fire') scene._nearAny = () => true;
      if (block === 'amnesty') scene._pestFreeZone = () => ({ has: () => true });
      assert.eq(spawnNestBushCreature(scene, bush, 'slime'), null, block);
      assert.eq(entry.creatures.length, 0);
    });
  });
})();
