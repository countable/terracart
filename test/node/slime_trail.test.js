(function () {
  const row = StreetVariants.VARIANT_BY_ID.slime_trail;
  function fixture(key = 'slime-test', length = 280, blocked = false) {
    const N = 64, edge = N * 7;
    const line = [{ x: 50, y: 220 }, { x: 50 + length, y: 220 }];
    const rec = { key, lineKey: key, line, halfW: 1.5, size: 'path', variant: row.id };
    const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
    const spawnOpts = { roadMask: new Uint8Array(N * N), roadClass: new Uint8Array(N * N),
      spawnWhy: new Uint16Array(N * N), occupied: new Set(), pois: [] };
    if (blocked) spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    const result = StreetVariants.dress({ index: { extent: edge, lines: [rec], dressingLines: [rec], hoardPois: [] },
      tx: 0, ty: 0, N, tileEdgeM: edge, grid, spawnOpts });
    return { result, grid, spawnOpts, N, edge };
  }
  test('slime trail: deterministic section species, finite posts and short-path fallback', () => {
    const a = fixture(), b = fixture();
    assert.eq(JSON.stringify(a.result.creatureRequests), JSON.stringify(b.result.creatureRequests));
    assert.eq(a.result.creatureRequests.length, 4, 'one post per 70 m');
    assert.eq(new Set(a.result.creatureRequests.map(l => l.rule)).size, 1, 'one species for the section');
    assert.truthy(a.result.creatureRequests.every(l => l._street === 'slime_trail'));
    assert.eq(fixture('short', 10).result.creatureRequests.length, 1, 'short trail gets its midpoint encounter');
    assert.eq(fixture('blocked', 280, true).result.creatureRequests.length, 0, 'spawn restrictions are respected');
    const species = new Set();
    for (let i = 0; i < 100; i++) species.add(fixture(`species-${i}`, 10).result.creatureRequests[0].rule);
    assert.eq(species.size, row.enemyKinds.length, 'different sections can select every species');
  });
  test('slime trail: each species uses the regular population with persistent pair identities', () => {
    const f = fixture();
    const entry = { cellsPerEdge:f.N,tileEdgeM:f.edge,grid:f.grid,objects:[],
      streetArea:new Uint8Array(f.N*f.N).fill(1),
      streetAreaVariants:new Uint8Array(f.N*f.N).fill(row.code),_spawnOpts:f.spawnOpts };
    const run = request => {
      const oldRoll=SpawnPipeline.roll;SpawnPipeline.roll=()=>false;
      entry.streetCreatureRequests=[request];
      try {return WorldGen.runSteps(HabitatSpawns.populationSteps({tileEdgeM:f.edge,save:{}},entry,0,0,
        {category:'enemy',skipLegacy:true,spawnOpts:{...f.spawnOpts,occupied:new Set()}}));}
      finally {SpawnPipeline.roll=oldRoll;}
    };
    for(const kind of row.enemyKinds) {
      const request={rule:`street_slime_trail_${kind}`,sid:`slime-pair-${kind}`,lx:220,ly:220,_street:row.id};
      const creatures=run(request);
      assert.eq(creatures.length,2,kind);
      assert.truthy(creatures.every(c=>c.kind===kind&&c._street===row.id&&!c.lair),'ordinary AI retains path species');
      assert.eq(creatures.map(c=>c.id).join(),[0,1].map(n=>`lair_${request.sid}_${n}`).join(),'existing captures keep their IDs');
      const caught=new Set(creatures.map(c=>c.id));
      assert.eq(run(request).filter(c=>SceneCreatures.prototype._habitatPopulationVisible.call({},c,caught,null)).length,0);
      assert.eq(JSON.stringify(run(request)),JSON.stringify(creatures),'allocation repeats without a lazy wake');
    }
    assert.eq(f.result.lairs.length,0,'no duplicate lair allocation remains');
  });
  test('slime trail: reactive splitting never consumes the melee attack cadence', () => {
    const c = { kind: 'split_slime', id: 'reactive-slime' }, roster = EnemyRoster.get(c.kind);
    for (let now = 1000; now < 10000; now += 100) {
      assert.falsy(enemySupportTick({}, c, roster, now, true));
    }
    assert.eq(c._abilityNextT, undefined, 'no invalid active-support timer');
    assert.eq(c._abilityWindupUntil, undefined, 'no active-support wind-up');
  });
  test('slime trail: worn and restored paving share glossy pools', () => {
    const fills = [];
    const cx = { globalAlpha: 1, save() { this.alpha = this.globalAlpha; }, restore() { this.globalAlpha = this.alpha; },
      beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, arc() {}, drawImage() {}, stroke() {},
      fill() { fills.push(this.fillStyle); }, fillRect() { fills.push(this.fillStyle); } };
    const old = document.createElement;
    document.createElement = () => ({ getContext: () => cx });
    try { for (const restored of [false, true]) {
      fills.length = 0;
      RoadOverlay.paintPavementTile(cx, 32, true, restored, row.id);
      assert.truthy(fills.includes(row.stone.accent), 'slime reflections');
      assert.truthy(fills.includes('#efffc9'), 'wet highlights');
      assert.eq(cx.globalAlpha, 1);
    } } finally { document.createElement = old; }
  });
})();
