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
    assert.eq(JSON.stringify(a.result.lairs), JSON.stringify(b.result.lairs));
    assert.eq(a.result.lairs.length, 4, 'one post per 70 m');
    assert.eq(new Set(a.result.lairs.map(l => l.tier)).size, 1, 'one species for the section');
    assert.truthy(a.result.lairs.every(l => l._street === 'slime_trail'));
    assert.eq(fixture('short', 10).result.lairs.length, 1, 'short trail gets its midpoint encounter');
    assert.eq(fixture('blocked', 280, true).result.lairs.length, 0, 'spawn restrictions are respected');
    const species = new Set();
    for (let i = 0; i < 100; i++) species.add(fixture(`species-${i}`, 10).result.lairs[0].tier);
    assert.eq(species.size, row.enemyKinds.length, 'different sections can select every species');
  });
  test('slime trail: each species wakes a persistent pair with path provenance', () => {
    const f = fixture();
    const entry = { cellsPerEdge: f.N, grid: f.grid, objects: [], buildingShapes: [], _spawnOpts: f.spawnOpts };
    for (const kind of row.enemyKinds) {
      const cand = { tier: `street_slime_trail_${kind}`, sid: `slime-pair-${kind}`, tx: 0, ty: 0,
        ox: 0, oy: 0, wx: 220, wy: 220, lx: 220, ly: 220, ix: 31, iy: 31, halfW: 0, halfH: 0, _street: row.id };
      const guards = Lairs.garrisonFor(entry, cand, { tileEdgeM: f.edge });
      assert.eq(guards.length, 2, kind);
      assert.truthy(guards.every(g => g.kind === kind && g._street === row.id));
      assert.falsy(Lairs.DAILY_TIERS.has(cand.tier));
      assert.eq(Lairs.garrisonFor(entry, cand, { tileEdgeM: f.edge, caughtSet: new Set(guards.map(g => g.id)) }).length, 0);
    }
    const family = EnemyHabitats.buildingKinds;
    EnemyHabitats.buildingKinds = () => ['goblin'];
    try {
      const c = { tier: 'street_slime_trail_slime', sid: 'nexus-slime', tx: 0, ty: 0,
        ox: 0, oy: 0, wx: 220, wy: 220, lx: 220, ly: 220, ix: 31, iy: 31, halfW: 0, halfH: 0, _street: row.id };
      assert.truthy(Lairs.garrisonFor(entry, c, { tileEdgeM: f.edge }).every(g => g.kind === 'slime'),
        'Nexus habitat cannot replace the path-authored species');
    } finally { EnemyHabitats.buildingKinds = family; }
    entry.streetLairs = f.result.lairs;
    const index = Lairs.buildIndex(entry, 0, 0, 7, f.edge);
    assert.truthy([...index.buckets.values()].flat().every(c => c._street === row.id), 'index preserves path provenance');
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
