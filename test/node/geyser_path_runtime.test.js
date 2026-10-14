(function () {
  async function fixture(run) {
    const W = WorldGen, cache = new Map(W.tileCache), veto = W.privateVetoAt, rng = W.makeRng;
    W.tileCache.clear(); W.privateVetoAt = () => false; W.makeRng = () => () => .99;
    const entry = { cellsPerEdge: 8, grid: new Uint8Array(64).fill(W.T.GRASS), objects: [], creatures: [],
      _spawnOpts: { roadMask: new Uint8Array(64), spawnWhy: new Uint32Array(64), occupied: new Set() },
      pathVents: ['poison', 'fire', 'paralysis', 'confusion'].map((kind, i) =>
        ({ id: `path-vent-${kind}`, x: 12 + i * 8, y: 28, kind, _street: `${kind}_path` })) };
    W.tileCache.set(W.tileKey(0, 0), entry);
    for (let i = 1; i <= 4; i++) entry._spawnOpts.occupied.add(3 * 8 + i);
    const scene = { depth: 0, cellsPerTile: 8, cellM: 8, mPerPx: 64 / W.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 60, y: 60 }, save: { energy: 100 },
      cellAt(x, y) { const tx = Math.floor(x / 64), ty = Math.floor(y / 64);
        const ix = Math.floor(x / 8) - tx * 8, iy = Math.floor(y / 8) - ty * 8;
        const e = W.tileCache.get(W.tileKey(tx, ty));
        return { tx, ty, ix, iy, cellIX: tx * 8 + ix, cellIY: ty * 8 + iy,
          loaded: !!e, type: e?.grid[iy * 8 + ix] }; },
      _losePlayerEnergy(n) { this.save.energy -= n; return n; }, _popEnergy() {} };
    try { await run(scene, entry); } finally {
      W.tileCache.clear(); for (const [key, e] of cache) W.tileCache.set(key, e);
      W.privateVetoAt = veto; W.makeRng = rng;
    }
  }
  test('geyser paths: authored seats retain clocks, reload inactive, and never enter another depth or save', () => fixture((s, entry) => {
    EnvironmentHazards.observe(s);
    const vents = () => EnvironmentHazards.lists(s).vents;
    assert.eq(vents().length, 4, 'each kind exists outside a crater despite its own occupancy claim');
    vents()[0].elapsedMs = 1234;
    EnvironmentHazards.observe(s); assert.eq(vents().length, 4); assert.eq(vents()[0].elapsedMs, 1234);
    s.depth = 1; EnvironmentHazards.observe(s); assert.eq(vents().length, 0);
    s.depth = 0; EnvironmentHazards.observe(s); assert.eq(vents()[0].elapsedMs, 1234);
    WorldGen.tileCache.clear(); EnvironmentHazards.observe(s); assert.eq(vents().length, 0);
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry); EnvironmentHazards.observe(s);
    assert.eq(vents().length, 4); assert.truthy(vents().every(h => h.phase === 'inactive' && h.elapsedMs === 0));
    assert.eq(JSON.stringify(s.save), '{"energy":100}');
    entry.pathVents = []; EnvironmentHazards.observe(s); assert.eq(vents().length, 0, 'replaced tile removes old seats');
  }));
  test('geyser paths: eruption uses matching gas/fire and validates live safety before emission', () => fixture((s, entry) => {
    const emit = MushroomGas.emit, calls = [], fires = [];
    MushroomGas.emit = (_s, x, y, density, kind) => calls.push(kind);
    s._igniteGroundCell = cell => fires.push(cell);
    try {
      EnvironmentHazards.observe(s);
      for (const h of EnvironmentHazards.lists(s).vents) {
        h.elapsedMs = (EnvironmentHazards.VENTS[h.kind].gas ? 20000 : 5000) + 3000 - 100;
        EnvironmentHazards.update(h);
      }
      EnvironmentHazards.tick(s, .1);
      assert.eq(calls.sort().join(), 'confusion,paralysis,poison'); assert.eq(fires.length, 5);
      calls.length = 0; fires.length = 0;
      for (const h of EnvironmentHazards.lists(s).vents) {
        h.elapsedMs = (EnvironmentHazards.VENTS[h.kind].gas ? 20000 : 5000) + 3000 - 100;
        EnvironmentHazards.update(h);
        entry.objects.push({ x: h.x, y: h.y, kind: 'rock' });
      }
      EnvironmentHazards.tick(s, .1);
      assert.eq(calls.length, 0); assert.eq(fires.length, 0);
      assert.eq(EnvironmentHazards.lists(s).vents.length, 0);
    } finally { MushroomGas.emit = emit; }
  }));
  test('geyser paths: private, kerb, junction and live terrain vetoes survive authored ownership', () => fixture((s, entry) => {
    for (const reason of ['PRIVATE', 'KERB', 'JUNCTION', 'JUNCTION_SOFT']) {
      entry._spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY[reason]);
      s._environmentHazards = new Map(); EnvironmentHazards.observe(s);
      assert.eq(EnvironmentHazards.lists(s).vents.length, 0, reason);
    }
    entry._spawnOpts.spawnWhy.fill(0); entry.grid.fill(WorldGen.T.WATER);
    EnvironmentHazards.observe(s); assert.eq(EnvironmentHazards.lists(s).vents.length, 0);
  }));
  test('geyser paths: authored eligibility follows the generation gate on additional walkable ground', () => fixture((s, entry) => {
    for (const type of [WorldGen.T.INDUSTRIAL, WorldGen.T.WASTELAND]) {
      entry.grid.fill(type); s._environmentHazards = new Map();
      EnvironmentHazards.observe(s);
      assert.eq(EnvironmentHazards.lists(s).vents.length, 4, 'authored vents retain generator-accepted ground');
      assert.falsy(EnvironmentHazards.suitable(type, 0), 'ambient terrain restriction is unchanged');
    }
    entry.grid.fill(WorldGen.T.WATER); s._environmentHazards = new Map();
    EnvironmentHazards.observe(s); assert.eq(EnvironmentHazards.lists(s).vents.length, 0, 'water remains excluded');
  }));
  test('geyser paths: a quarry adds no ambient vent beside an authored one', () => fixture((s, entry) => {
    entry.pathVents = [entry.pathVents[1]];
    s.playerM = { x: 20, y: 28 };
    entry.zone = { anchors: [{ kind: 'quarry', variant: 'quarry-crater' }], coverage: new Uint16Array(64).fill(1) };
    // Even a roll that would choose the authored cell finds no ambient vent.
    entry._spawnOpts.occupied.clear();
    WorldGen.makeRng = () => { let n = 0; return () => n++ ? .5 : 0; };
    EnvironmentHazards.observe(s);
    assert.eq(EnvironmentHazards.lists(s).vents.length, 1);
    assert.eq(EnvironmentHazards.lists(s).vents[0].id, 'path-vent-fire');
  }));
})();
