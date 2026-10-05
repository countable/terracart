(function () {
  const entry = () => ({ cellsPerEdge: 4, tileEdgeM: 64,
    grid: new Uint8Array(16).fill(WorldGen.T.CAVE_FLOOR), objects: [], traps: [] });
  const hole = { id: 'hole', kind: 'ground_hole', depth: 2, x: 24, y: 24 };
  function scene(energy = 100) {
    return { depth: 2, tileEdgeM: 64, save: { energy },
      showMessageModal(panel) { this.panel = panel; },
      _losePlayerEnergy(n) { const before = this.save.energy; Energy.set(this.save, before - n); return before - this.save.energy; },
      changeDepth(delta, destination, options) {
        assert.truthy(options.fall, 'fall bypasses voluntary descent energy gate');
        this.depth += delta; this.destination = destination; this.descents = (this.descents || 0) + 1;
      }, _popEnergy() {}, flash() {},
    };
  }
  test('cave holes: landing skips walls, traps, objects and creatures', () => {
    const e = entry(); e.grid.fill(WorldGen.T.CAVE_WALL);
    e.grid[5] = e.grid[6] = e.grid[9] = e.grid[10] = WorldGen.T.CAVE_FLOOR;
    e.objects = [{ x: 24, y: 24, kind: 'ground_hole' }];
    e.traps = [{ x: 40, y: 24 }]; e.creatures = [{ x: 24, y: 40 }];
    const p = CaveHazards.landing(e, hole, 64);
    assert.eq(p.x, 40); assert.eq(p.y, 40);
    e.grid[10] = WorldGen.T.CAVE_WALL;
    assert.eq(CaveHazards.landing(e, hole, 64), null);
  });
  test('cave holes: story precedes damage and low energy still falls exactly one floor once', async () => {
    const previous = WorldGen.loadTile.atDepth;
    WorldGen.loadTile.atDepth = async depth => { assert.eq(depth, 3); return entry(); };
    try {
      const s = scene(4);
      assert.truthy(await CaveHazards.fall(s, hole));
      assert.eq(s.save.energy, 4); assert.eq(s.depth, 2);
      assert.truthy(s._caveFallPending);
      assert.falsy(await CaveHazards.fall(s, hole));
      s.panel.onDismiss(); s.panel.onDismiss();
      assert.eq(s.save.energy, 0); assert.eq(s.depth, 3); assert.eq(s.descents, 1);
      assert.falsy(s._caveFallPending);
    } finally { WorldGen.loadTile.atDepth = previous; }
  });
  test('cave holes: damage uses one quarter maximum energy, not remaining energy', async () => {
    const previous = WorldGen.loadTile.atDepth;
    WorldGen.loadTile.atDepth = async () => entry();
    try {
      const s = scene(70);
      const damage = Combat.incomingDamage(s.save, Energy.maxEnergy(s.save) * CaveHazards.FALL_ENERGY_FRACTION);
      await CaveHazards.fall(s, hole); s.panel.onDismiss();
      assert.eq(s.save.energy, Math.max(0, 70 - damage));
    } finally { WorldGen.loadTile.atDepth = previous; }
  });
  test('cave holes: invalid or unavailable destination leaves energy and depth untouched', async () => {
    const previous = WorldGen.loadTile.atDepth;
    try {
      for (const fail of [false, true]) {
        WorldGen.loadTile.atDepth = async () => {
          if (fail) throw new Error('offline');
          const e = entry(); e.grid.fill(WorldGen.T.CAVE_WALL); return e;
        };
        const s = scene();
        assert.falsy(await CaveHazards.fall(s, hole));
        assert.eq(s.depth, 2); assert.eq(s.save.energy, 100);
        assert.falsy(s.panel); assert.falsy(s._caveFallPending);
      }
    } finally { WorldGen.loadTile.atDepth = previous; }
  });
  test('cave holes: far floor is not a landing and pending tile spawn is checked before falling', async () => {
    const far = { cellsPerEdge: 16, tileEdgeM: 256, grid: new Uint8Array(256).fill(WorldGen.T.CAVE_WALL) };
    far.grid[255] = WorldGen.T.CAVE_FLOOR;
    assert.eq(CaveHazards.landing(far, hole, 256), null);
    const previous = WorldGen.loadTile.atDepth;
    const e = { status: 'loading' };
    e.promise = Promise.resolve().then(() => Object.assign(e, entry(), { status: 'ready' }));
    WorldGen.loadTile.atDepth = async () => e;
    try {
      const s = scene();
      s.spawnCaveCreatures = (loaded, tx, ty, depth) => {
        assert.eq(loaded, e); assert.eq(depth, 3);
        loaded.grid.fill(WorldGen.T.CAVE_WALL);
      };
      assert.falsy(await CaveHazards.fall(s, hole));
      assert.eq(s.depth, 2); assert.eq(s.save.energy, 100);
    } finally { WorldGen.loadTile.atDepth = previous; }
  });
  test('cave holes: real depth transition permits a forced exhausted descent only', () => {
    const source = SCENE_SRC.match(/\n  changeDepth\(delta, stair, options = \{\}\) \{([\s\S]*?)\n  \}\n/)[1];
    const change = new Function('delta', 'stair', 'options = {}', source);
    const previous = WorldGen.setDepth;
    WorldGen.setDepth = () => {};
    try {
      const s = { save: { energy: 0 }, depth: 2, startWorldM: { x: 0, y: 0 },
        playerM: { x: 0, y: 0 }, feetOffsetM: 0, flash() {}, syncMoveTarget() {},
        cameras: { main: { setBackgroundColor() {} } }, ensureTilesAround: () => Promise.resolve(),
        _storySplashOnce() { throw new Error('A fall already has its story'); } };
      change.call(s, 1, hole);
      assert.eq(s.depth, 2);
      change.call(s, 1, hole, { fall: true });
      assert.eq(s.depth, 3); assert.eq(s.save.depth, 3);
      assert.eq(s.playerM.x, hole.x); assert.eq(s.playerM.y, hole.y);
      let stories = 0;
      s.save.energy = 100;
      s.save.dungeonProgression = { level4Key: true };
      s._storySplashOnce = key => { assert.eq(key, 'cave'); stories++; };
      change.call(s, 1, hole);
      assert.eq(s.depth, 4); assert.eq(stories, 1, 'ordinary descent retains the first-cave story');
    } finally { WorldGen.setDepth = previous; }
  });
  test('cave pits: same snare damage path and hidden until adjacent, even with perception', () => {
    const N = 64;
    const pits = Traps.spawnCave(new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR), N,
      0, 0, 256, 2, [{ lix: 32, liy: 32 }], new Set(), 1);
    assert.truthy(pits.length);
    const p = pits[0];
    assert.eq(p.kind, 'pit_trap'); assert.eq(p.hidden, true); assert.eq(p.depth, 2);
    assert.eq(Traps.trapPower(p), 1);
    assert.eq(Traps.trapAt({ traps: pits }, p._ix, p._iy), p);
    const s = { save: {}, depth: 2, tileEdgeM: 256, cellsPerTile: 16, cellM: 16,
      mPerPx: 1, originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 88, y: 88 } };
    const tr = { ...p, id: 'discovery-pit', x: 120, y: 88 };
    const perception = Gear.hasPerception;
    Gear.hasPerception = () => true;
    try {
      assert.falsy(HiddenObjects.reveal(s, tr));
      s.playerM.x = 104;
      assert.truthy(HiddenObjects.reveal(s, tr));
      assert.falsy(HiddenObjects.isHidden(s.save, tr));
      assert.truthy(Traps.springTrap(s.save, tr));
      assert.falsy(Traps.springTrap(s.save, tr));
    } finally { Gear.hasPerception = perception; }
  });
  test('cave pits: a newly spawned trap list reveals beside a stationary player', () => {
    const s = { save: {}, depth: 2, tileEdgeM: 256, cellsPerTile: 16, cellM: 16,
      mPerPx: 1, originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 88, y: 88 },
      playerToWorldCell: () => ({ tx: 0, ty: 0, cx: 5, cy: 5 }) };
    const key = WorldGen.tileKey(0, 0), old = WorldGen.tileCache.get(key);
    const e = { status: 'ready', objects: [] };
    const pit = { id: 'late-pit', kind: 'pit_trap', hidden: true, depth: 2, x: 104, y: 88 };
    WorldGen.tileCache.set(key, e);
    try {
      HiddenObjects.tick(s);
      e.traps = [pit];
      HiddenObjects.tick(s);
      assert.falsy(HiddenObjects.isHidden(s.save, pit));
    } finally {
      if (old) WorldGen.tileCache.set(key, old); else WorldGen.tileCache.delete(key);
    }
  });
})();
