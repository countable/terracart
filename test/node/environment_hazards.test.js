(function () {
  async function fixture(run) {
    const W = WorldGen, originals = new Map(), veto = W.privateVetoAt, rng = W.makeRng;
    const entries = [];
    for (let tx = 0; tx < 2; tx++) {
      const key = W.tileKey(tx, 0); originals.set(key, W.tileCache.get(key));
      const entry = { cellsPerEdge: 8, grid: new Uint8Array(64).fill(W.T.CAVE_FLOOR), objects: [], creatures: [],
        _spawnOpts: { roadMask: new Uint8Array(64), spawnWhy: new Uint32Array(64), occupied: new Set() } };
      W.tileCache.set(key, entry); entries.push(entry);
    }
    W.privateVetoAt = () => false; W.makeRng = () => () => .99;
    const scene = { depth: 1, cellsPerTile: 8, cellM: 8, mPerPx: 64 / W.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 28, y: 28 },
      save: { energy: 100 },
      cellAt(x, y) { const tx = Math.floor(x / 64), ty = Math.floor(y / 64);
        const ix = Math.floor(x / 8) - tx * 8, iy = Math.floor(y / 8) - ty * 8;
        const e = W.tileCache.get(W.tileKey(tx, ty));
        return { tx, ty, ix, iy, cellIX: tx * 8 + ix, cellIY: ty * 8 + iy,
          loaded: !!e, type: e?.grid[iy * 8 + ix] }; },
      _losePlayerEnergy(n) { this.save.energy -= n; return n; }, _popEnergy() {},
    };
    try { await run(scene, entries); } finally {
      for (const [key, before] of originals) { if (before) W.tileCache.set(key, before); else W.tileCache.delete(key); }
      W.privateVetoAt = veto; W.makeRng = rng;
    }
  }
  const advance = (s, ms) => { for (let t = 0; t < ms; t += 100) EnvironmentHazards.tick(s, Math.min(100, ms - t) / 1000); };
  test('environment hazards: vent cycles repeat exact inactive warning active intervals', () => fixture(s => {
    const h = EnvironmentHazards.create(s, 'vent', { cellIX: 3, cellIY: 3 }, 'v', () => .5, 'fire');
    const list = EnvironmentHazards.lists(s); list.vents.push(h);
    const cases = [[0, 'inactive', 5], [4999, 'inactive', 5], [5000, 'warning', 6],
      [6500, 'warning', 7], [7999, 'warning', 7], [8000, 'active', 8], [11000, 'inactive', 5]];
    for (const [ms, phase, frame] of cases) {
      h.elapsedMs = ms; EnvironmentHazards.update(h); assert.eq(h.phase, phase); assert.eq(h.frame, frame);
    }
    h.elapsedMs = 0; advance(s, 7900); assert.eq(s.save.energy, 100, 'warning does no damage');
    advance(s, 100); assert.lt(s.save.energy, 100);
    const after = s.save.energy; advance(s, 900); assert.eq(s.save.energy, after, 'one-second contact cadence');
    advance(s, 100); assert.lt(s.save.energy, after);
    assert.eq(s.save.conditions.burning.remainingMs, 6000);
  }));
  test('environment hazards: each active vent applies its explicit condition duration', () => fixture(s => {
    for (const [kind, condition, duration] of [['poison', 'poison', 30000], ['paralysis', 'paralysis', 5000]]) {
      s.save.conditions = {};
      const h = EnvironmentHazards.create(s, 'vent', { cellIX: 3, cellIY: 3 }, kind, () => .5, kind);
      h.elapsedMs = 7900; EnvironmentHazards.lists(s).vents = [h]; EnvironmentHazards.tick(s, .1);
      assert.eq(s.save.conditions[condition].remainingMs, duration);
    }
  }));
  test('environment hazards: sealed floors never open sinkholes', () => fixture((s) => {
    s.depth = 2;
    const sealed = EnvironmentHazards.create(s, 'sinkhole', { cellIX: 3, cellIY: 3 }, 'hole');
    assert.falsy(EnvironmentHazards.eligible(s, sealed), '2 -> 3 belongs to the elevator');
    s.depth = 6;
    const wizard = EnvironmentHazards.create(s, 'sinkhole', { cellIX: 3, cellIY: 3 }, 'hole');
    assert.falsy(EnvironmentHazards.eligible(s, wizard), '6 -> 7 belongs to the wizard key');
    s.depth = 5;
    const open = EnvironmentHazards.create(s, 'sinkhole', { cellIX: 3, cellIY: 3 }, 'hole');
    assert.truthy(EnvironmentHazards.eligible(s, open), '5 -> 6 keeps its pits');
  }));
  test('environment hazards: sinkhole 2x2 footprint crosses seams and refuses every blocked cell', () => fixture((s, entries) => {
    const h = EnvironmentHazards.create(s, 'sinkhole', { cellIX: 7, cellIY: 3 }, 'hole');
    assert.eq(h.x, 64); assert.eq(h.y, 32);
    assert.eq(EnvironmentHazards.footprint(s, h).length, 4);
    assert.truthy(EnvironmentHazards.eligible(s, h));
    entries[1].grid[4 * 8] = WorldGen.T.BUILDING;
    assert.falsy(EnvironmentHazards.eligible(s, h), 'far corner across seam blocks whole region');
    entries[1].grid[4 * 8] = WorldGen.T.CAVE_FLOOR;
    for (const why of ['RESTRICTED', 'FARM_INTERIOR', 'QUIET']) {
      entries[1]._spawnOpts.spawnWhy[4 * 8] = WorldGen.SPAWN_WHY[why];
      assert.falsy(EnvironmentHazards.eligible(s, h), why);
    }
    entries[1]._spawnOpts.spawnWhy.fill(0); entries[1]._spawnOpts.roadMask[4 * 8] = 1;
    assert.falsy(EnvironmentHazards.eligible(s, h)); entries[1]._spawnOpts.roadMask.fill(0);
    entries[1].objects.push({ x: 68, y: 36, kind: 'house' });
    assert.falsy(EnvironmentHazards.eligible(s, h), 'newly placed structure blocks');
  }));
  test('environment hazards: clocks pause with foreground ticks and retain depth-local state', () => fixture(s => {
    const h = EnvironmentHazards.create(s, 'sinkhole', { cellIX: 3, cellIY: 3 }, 'hole', () => 0);
    EnvironmentHazards.lists(s).sinkholes.push(h);
    assert.eq(h.openMs, 5000); h.elapsedMs = 4900;
    EnvironmentHazards.tick(s, 0); assert.eq(h.elapsedMs, 4900);
    s.playerM = { x: 4, y: 4 }; EnvironmentHazards.tick(s, 600); assert.eq(h.elapsedMs, 5000, 'suspension contributes at most one bounded foreground slice');
    assert.eq(h.phase, 'opening'); assert.eq(h.frame, 3); s.depth = 2; advance(s, 1000); assert.eq(h.elapsedMs, 5000);
    s.depth = 1; h.elapsedMs = 10240; EnvironmentHazards.update(h); assert.eq(h.phase, 'closing');
    advance(s, 600); assert.eq(EnvironmentHazards.lists(s).sinkholes.length, 0);
  }));
  test('environment hazards: falling retries failed destinations and only marks a successful descent', () => fixture(async s => {
    const old = globalThis.HazardFalls, h = EnvironmentHazards.create(s, 'sinkhole', { cellIX: 3, cellIY: 3 }, 'hole', () => 1);
    let calls = 0; globalThis.HazardFalls = { fall: async () => { calls++; return calls > 1; } };
    try {
      EnvironmentHazards.lists(s).sinkholes.push(h); h.elapsedMs = 5140;
      EnvironmentHazards.tick(s, .1); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      assert.eq(calls, 1); assert.falsy(h.fallTriggered);
      advance(s, 900); assert.eq(calls, 1);
      advance(s, 100); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      assert.eq(calls, 2); assert.truthy(h.fallTriggered);
      advance(s, 1000); assert.eq(calls, 2);
    } finally { globalThis.HazardFalls = old; }
  }));
  test('environment hazards: seeded visit generation is stable and vents never appear on surface', () => fixture(s => {
    WorldGen.makeRng = () => () => 0;
    EnvironmentHazards.observe(s);
    const before = JSON.stringify(EnvironmentHazards.lists(s).vents);
    assert.eq(EnvironmentHazards.lists(s).vents.length, 1);
    EnvironmentHazards.lists(s).vents = []; EnvironmentHazards.observe(s);
    assert.eq(EnvironmentHazards.lists(s).vents.length, 0, 'standing cannot reroll');
    s._environmentHazards = new Map(); EnvironmentHazards.observe(s);
    assert.eq(JSON.stringify(EnvironmentHazards.lists(s).vents), before);
    s.depth = 0; EnvironmentHazards.observe(s); assert.eq(EnvironmentHazards.lists(s).vents.length, 0);
  }));
  test('environment hazards: immunity protects contact damage and live structures cancel warning holes', () => fixture((s, entries) => {
    const v = EnvironmentHazards.create(s, 'vent', { cellIX: 3, cellIY: 3 }, 'v', () => .5, 'fire');
    EnvironmentHazards.lists(s).vents = [v]; s.save.fireResistancePotionUntil = Date.now() + 100000;
    v.elapsedMs = 7900; EnvironmentHazards.tick(s, .1);
    assert.eq(s.save.energy, 100); assert.falsy(Conditions.active(s.save, 'burning'));
    v.kind = 'poison'; v.nextContactMs = 0; s.save.immortalPotionUntil = Date.now() + 100000;
    EnvironmentHazards.tick(s, .1); assert.eq(s.save.energy, 100);
    const h = EnvironmentHazards.create(s, 'sinkhole', { cellIX: 3, cellIY: 3 }, 'hole');
    EnvironmentHazards.lists(s).sinkholes.push(h); h.elapsedMs = 4900;
    entries[0].objects.push({ x: 36, y: 36, kind: 'house' });
    EnvironmentHazards.tick(s, .1); assert.eq(h.phase, 'closed');
    assert.eq(EnvironmentHazards.lists(s).sinkholes.length, 0);
  }));
  test('environment hazards: sinkholes cannot enter or occupy the reserved arena floor', () => fixture(s => {
    for (const depth of [WorldGen.ARENA_DEPTH - 1, WorldGen.ARENA_DEPTH]) {
      s.depth = depth;
      const h = EnvironmentHazards.create(s, 'sinkhole', { cellIX: 3, cellIY: 3 }, 'arena');
      assert.falsy(EnvironmentHazards.eligible(s, h));
    }
  }));
  test('environment hazards: a full vent budget follows travel and revisits restore deterministic seats', () => fixture((s, entries) => {
    WorldGen.makeRng = () => () => 0;
    EnvironmentHazards.observe(s);
    const first = EnvironmentHazards.lists(s).vents[0], id = first.id;
    for (let i = 1; i < EnvironmentHazards.CONFIG.vent.maxPresent; i++) {
      EnvironmentHazards.lists(s).vents.push(EnvironmentHazards.create(s, 'vent', { cellIX: 4, cellIY: 4 }, `old${i}`));
    }
    const key = WorldGen.tileKey(8, 0), old = WorldGen.tileCache.get(key);
    WorldGen.tileCache.set(key, entries[1]);
    try {
      s.playerM.x += 512; EnvironmentHazards.observe(s);
      const nearby = EnvironmentHazards.lists(s).vents;
      assert.eq(nearby.length, 1, 'old distant vents release the full budget');
      assert.truthy(nearby[0].x > 512, 'walking into the next region still discovers vents');
      s.playerM.x -= 512; EnvironmentHazards.observe(s);
      assert.eq(EnvironmentHazards.lists(s).vents[0].id, id);
      assert.eq(EnvironmentHazards.lists(s).vents[0].phase, 'inactive');
    } finally { if (old) WorldGen.tileCache.set(key, old); else WorldGen.tileCache.delete(key); }
  }));
  test('environment hazards: idle validation is throttled but dangerous transitions always recheck', () => fixture((s, entries) => {
    const gate = WorldGen.isSpawnCell; let checks = 0;
    WorldGen.isSpawnCell = (...args) => { checks++; return gate(...args); };
    try {
      const h = EnvironmentHazards.create(s, 'vent', { cellIX: 3, cellIY: 3 }, 'v');
      EnvironmentHazards.lists(s).vents.push(h);
      for (let i = 0; i < 60; i++) EnvironmentHazards.tick(s, 1 / 60);
      assert.eq(checks, 1, 'one object/spawn scan per second, not one per rendered frame');
      h.elapsedMs = 7900; h.nextValidationMs = 99999;
      entries[0].objects.push({ x: 28, y: 28, kind: 'house' });
      EnvironmentHazards.tick(s, .1);
      assert.eq(checks, 2, 'active transition bypasses the validation timer');
      assert.eq(EnvironmentHazards.lists(s).vents.length, 0);
      assert.eq(s.save.energy, 100);
    } finally { WorldGen.isSpawnCell = gate; }
  }));
  test('environment hazards: sinkhole plays both opening frames before its timed open hold', () => fixture(s => {
    const h = EnvironmentHazards.create(s, 'sinkhole', { cellIX: 3, cellIY: 3 }, 'opening', () => 0);
    for (const [time, phase, frame] of [[4999, 'warning', 2], [5000, 'opening', 3],
      [5120, 'opening', 4], [5240, 'open', 5], [10240, 'closing', 7], [10840, 'closed', 11]]) {
      h.elapsedMs = time; EnvironmentHazards.update(h); assert.eq(h.phase, phase); assert.eq(h.frame, frame);
    }
  }));
  function quarry(s, entries, variant = 'quarry-abandoned') {
    s.depth = 0;
    for (const e of entries) {
      e.grid.fill(WorldGen.T.ROCK);
      e.zone = { anchors: [{ kind: 'quarry', variant }], coverage: new Uint16Array(64).fill(1) };
    }
    WorldGen.makeRng = () => () => 0;
  }
  test('environment hazards: stepped quarry cracks become permanent single-cell pits after exactly five foreground seconds', () => fixture((s, entries) => {
    quarry(s, entries);
    assert.eq(EnvironmentHazards.lists(s).caveins.length, 0, 'hidden until stepped on');
    EnvironmentHazards.observe(s);
    const h = EnvironmentHazards.lists(s).caveins[0];
    assert.truthy(h); assert.eq(h.cellIX, 3); assert.eq(h.cellIY, 3);
    assert.eq(EnvironmentHazards.footprint(s, h).length, 1);
    assert.eq(h.phase, 'warning'); assert.eq(h.frame, 0);
    WorldGen.makeRng = () => () => .99; s.playerM = { x: 4, y: 4 };
    advance(s, 4900); assert.eq(h.phase, 'warning'); assert.lt(h.frame, 56);
    advance(s, 100); assert.eq(h.phase, 'open'); assert.eq(h.frame, 63);
    advance(s, 30000); assert.eq(h.phase, 'open', 'pit never closes');
    const saved = JSON.parse(JSON.stringify(s.save));
    s.save = saved; s._environmentHazards = new Map();
    const restored = EnvironmentHazards.lists(s).caveins[0];
    assert.eq(restored.id, h.id); assert.eq(restored.phase, 'open'); assert.eq(restored.frame, 63);
    assert.eq(restored.cellIX, 3); assert.eq(restored.widthCells, 1);
  }));
  test('environment hazards: saved quarry warnings resume their foreground clock without a new roll', () => fixture((s, entries) => {
    quarry(s, entries); EnvironmentHazards.observe(s);
    const h = EnvironmentHazards.lists(s).caveins[0];
    WorldGen.makeRng = () => () => .99; s.playerM = { x: 4, y: 4 };
    advance(s, 2200); s.save = JSON.parse(JSON.stringify(s.save)); s._environmentHazards = new Map();
    const restored = EnvironmentHazards.lists(s).caveins[0];
    assert.eq(restored.elapsedMs, 2200); assert.eq(restored.id, h.id);
    advance(s, 2700); assert.eq(restored.phase, 'warning');
    advance(s, 100); assert.eq(restored.phase, 'open');
  }));
  test('environment hazards: quarry cave-ins keep shared spawn exclusions and live structure protection', () => fixture((s, entries) => {
    quarry(s, entries); const e = entries[0];
    for (const reason of ['PRIVATE', 'BEHIND_HOUSE', 'RESTRICTED', 'FARMLAND', 'GOLF']) {
      s._environmentHazards = new Map(); e._spawnOpts.spawnWhy[27] = WorldGen.SPAWN_WHY[reason];
      EnvironmentHazards.observe(s); assert.eq(EnvironmentHazards.lists(s).caveins.length, 0, reason);
    }
    e._spawnOpts.spawnWhy.fill(0); e.objects.push({ kind: 'house', x: 28, y: 28 });
    s._environmentHazards = new Map(); EnvironmentHazards.observe(s);
    assert.eq(EnvironmentHazards.lists(s).caveins.length, 0, 'occupied quarry floor remains protected');
    e.objects.length = 0; e.grid[27] = WorldGen.T.CAVE_LAVA;
    s._environmentHazards = new Map(); EnvironmentHazards.observe(s);
    assert.eq(EnvironmentHazards.lists(s).caveins.length, 0, 'crater lava cannot cave in');
  }));
  test('environment hazards: strip mines mint random sinkholes instead of permanent cave-ins', () => fixture((s, entries) => {
    quarry(s, entries, 'quarry-strip-mine'); EnvironmentHazards.observe(s);
    assert.eq(EnvironmentHazards.lists(s).caveins.length, 0);
    const holes = EnvironmentHazards.lists(s).sinkholes;
    assert.eq(holes.length, 1); assert.eq(holes[0].widthCells, 2);
    const first = JSON.stringify(holes);
    s._environmentHazards = new Map(); EnvironmentHazards.observe(s);
    assert.eq(JSON.stringify(EnvironmentHazards.lists(s).sinkholes), first, 'stable placement and duration');
    s._environmentHazards = new Map(); entries[0].zone.coverage.fill(0); entries[0].zone.coverage[27] = 1;
    EnvironmentHazards.observe(s);
    assert.eq(EnvironmentHazards.lists(s).sinkholes.length, 0, 'whole sinkhole stays inside strip-mine coverage');
  }));
  test('environment hazards: live obstructions suppress permanent pits without erasing their save', () => fixture((s, entries) => {
    quarry(s, entries); EnvironmentHazards.observe(s);
    const h = EnvironmentHazards.lists(s).caveins[0];
    WorldGen.makeRng = () => () => .99; s.playerM = { x: 4, y: 4 };
    entries[0].objects.push({ kind: 'house', x: 28, y: 28 });
    advance(s, 5000);
    assert.eq(h.phase, 'open'); assert.truthy(h.blocked);
    assert.eq(s.save.caveIns[h.id].elapsedMs, 5000);
    assert.eq(EnvironmentHazards.lists(s).caveins.length, 1);
    entries[0].objects.length = 0; advance(s, 1000);
    assert.falsy(h.blocked); assert.eq(h.phase, 'open');
    assert.eq(EnvironmentHazards.lists(s).caveins[0].id, h.id);
  }));
  test('environment hazards: permanent cave-ins can cause another fall after returning', () => fixture(async (s, entries) => {
    quarry(s, entries); EnvironmentHazards.observe(s);
    const h = EnvironmentHazards.lists(s).caveins[0], old = globalThis.HazardFalls;
    h.elapsedMs = 4900; let calls = 0;
    globalThis.HazardFalls = { fall: async () => { calls++; s.depth = 1; return true; } };
    try {
      EnvironmentHazards.tick(s, .1); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      assert.eq(calls, 1); assert.eq(h.phase, 'open');
      s.depth = 0; advance(s, 1000);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      assert.eq(calls, 2, 'returning to the same open pit falls again');
      assert.eq(s.save.caveIns[h.id].elapsedMs, 5000);
    } finally { globalThis.HazardFalls = old; }
  }));
  test('environment hazards: cave-ins cannot consume a live pressure feature', () => fixture((s, entries) => {
    quarry(s, entries);
    const original = PressureTraps.lists;
    PressureTraps.lists = () => ({ plates: [{ x: 28, y: 28 }], traps: [] });
    try {
      EnvironmentHazards.observe(s);
      assert.eq(EnvironmentHazards.lists(s).caveins.length, 0);
    } finally { PressureTraps.lists = original; }
  }));
  test('flight: fire vents are harmless but poison and paralysis gas still affect the player', () => fixture(s => {
    s.save.flightPotionUntil = Date.now() + 60000;
    for (const kind of ['fire', 'poison', 'paralysis']) {
      s.save.energy = 100; s.save.conditions = {};
      const h = EnvironmentHazards.create(s, 'vent', { cellIX: 3, cellIY: 3 }, kind, () => .5, kind);
      h.elapsedMs = 8000;
      EnvironmentHazards.lists(s).vents = [h];
      EnvironmentHazards.tick(s, .1);
      if (kind === 'fire') {
        assert.eq(s.save.energy, 100); assert.falsy(s.save.conditions.burning);
      } else {
        assert.lt(s.save.energy, 100); assert.truthy(s.save.conditions[kind]);
      }
    }
  }));

})();
