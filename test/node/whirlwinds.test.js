(function () {
  // Wall clocks either side of Whirlwinds.CONFIG.gust's local hours.
  const CALM = new Date(2026, 0, 1, 9).getTime(), GUST = new Date(2026, 0, 1, 15).getTime();
  function fixture(run) {
    const W = WorldGen, key = W.tileKey(0, 0), previous = W.tileCache.get(key);
    const rng = W.makeRng, nearby = W.forEachItemNear, veto = W.privateVetoAt, home = HomeArea.worldM;
    const weather = Weather.state();
    Weather.accept({ kind: 'none', precip: false, temp: null, windKph: null });
    HomeArea.worldM = null;
    const entry = { cellsPerEdge: 8, grid: new Uint8Array(64).fill(W.T.GRASS),
      creatures: [], _spawnOpts: { roadMask: new Uint8Array(64), spawnWhy: new Uint16Array(64), occupied: new Set() } };
    W.tileCache.set(key, entry);
    W.makeRng = () => () => 0;
    W.privateVetoAt = () => false;
    W.forEachItemNear = (kind, tx, ty, fn) => entry.creatures.forEach(fn);
    const scene = { depth: 0, cellM: 8, tileEdgeM: 64, startWorldM: { x: 0, y: 0 },
      playerM: { x: 24, y: 24 }, gpsM: { x: 20, y: 24 },
      _manualOffsetM: { x: 4, y: 0 }, _targetM: { x: 24, y: 24 },
      save: { energy: 100, caught: [] }, _whirlwinds: [], hits: [],
      cellAt(x, y) { const ix = Math.floor(x / 8), iy = Math.floor(y / 8);
        return { tx: 0, ty: 0, ix, iy, loaded: ix >= 0 && ix < 8 && iy >= 0 && iy < 8,
          type: entry.grid[iy * 8 + ix] }; },
      playerToWorldCell() { return { tx: 0, ty: 0 }; },
      findWalkableDestination(distance, opts) {
        assert.eq(distance, Whirlwinds.CONFIG.spawnDistanceCells);
        return opts.accept(40, 24) ? { x: 40, y: 24 } : null;
      },
      _losePlayerEnergy(n) { this.save.energy -= n; return n; }, _popEnergy() {},
      _damageEnemy(c, n, source) { this.hits.push({ c, n, source }); Combat.damageDealt(c, n); },
      _damageBurningUnit(c, n, source) { this._damageEnemy(c, n, source); },
    };
    try { run(scene, entry); } finally {
      if (previous) W.tileCache.set(key, previous); else W.tileCache.delete(key);
      W.makeRng = rng; W.forEachItemNear = nearby; W.privateVetoAt = veto; HomeArea.worldM = home;
      Weather.accept(weather);
    }
  }
  test('whirlwind: gusty afternoons raise a group, spaced apart, on a likelier roll', () => fixture((s, e) => {
    const G = Whirlwinds.CONFIG.gust;
    assert.falsy(Whirlwinds.gusty(CALM)); assert.truthy(Whirlwinds.gusty(GUST));
    const seats = [{ x: 40, y: 24 }, { x: 40, y: 32 }, { x: 40, y: 25 }, { x: 48, y: 24 }];
    s.findWalkableDestination = (d, opts) => seats.find(p => opts.accept(p.x, p.y)) || null;
    WorldGen.makeRng = () => () => Whirlwinds.CONFIG.chance * 2;   // misses a calm roll
    Whirlwinds.observe(s, 0, CALM); assert.eq(s._whirlwinds.length, 0, 'calm hours keep the plain chance');
    s.playerM = { x: 16, y: 24 };
    Whirlwinds.observe(s, 0, GUST);
    assert.eq(s._whirlwinds.length, G.maxActive, 'one gusty roll raises the whole group');
    for (const a of s._whirlwinds) for (const b of s._whirlwinds)
      if (a !== b) assert.gte(Math.hypot(a.x - b.x, a.y - b.y), s.cellM, 'never stacked');
    assert.eq(s._whirlwindNextEncounter, G.cooldownMs);
  }));
  test('whirlwind: weather wind raises larger groups across surface biomes with a shorter cooldown', () => fixture((s, e) => {
    const W = Whirlwinds.CONFIG.wind;
    assert.eq(W.maxActiveFor(10), 1); assert.eq(W.maxActiveFor(20), 2); assert.eq(W.maxActiveFor(30), 3);
    assert.eq(W.maxActiveFor(80), 3, 'phone-sized fields cap the group');
    assert.eq(W.cooldownFor(10), 45000); assert.eq(W.cooldownFor(20), 35000); assert.eq(W.cooldownFor(30), 25000);
    for (const type of [WorldGen.T.SAND, WorldGen.T.PARK, WorldGen.T.FOREST, WorldGen.T.WASTELAND]) {
      e.grid.fill(type);
      assert.truthy(Whirlwinds.ground(s, 24, 24, null, Whirlwinds.WEATHER_GROUND), `biome ${type}`);
    }
    e.grid.fill(WorldGen.T.SAND);
    Weather.accept({ kind: 'none', precip: false, windKph: 31 });
    const seats = [{ x: 40, y: 24 }, { x: 40, y: 32 }, { x: 48, y: 24 }];
    s.findWalkableDestination = (d, opts) => {
      assert.eq(opts.cls, 'hazard');
      return seats.find(p => opts.accept(p.x, p.y)) || null;
    };
    Whirlwinds.observe(s, 0, CALM);
    assert.eq(s._whirlwinds.length, 3, '31 km/h fixes a three-tornado group at the encounter roll');
    assert.eq(s._whirlwindNextEncounter, W.cooldownFor(31));
  }));
  test('whirlwind: rising wind never rerolls a cell whose calm visit already missed', () => fixture((s, e) => {
    WorldGen.makeRng = () => () => Whirlwinds.CONFIG.chance * 2;
    Weather.accept({ kind: 'none', precip: false, windKph: 9 });
    Whirlwinds.observe(s, 0, CALM); assert.eq(s._whirlwinds.length, 0);
    Weather.accept({ kind: 'none', precip: false, windKph: 10 });
    Whirlwinds.observe(s, 50000, CALM); assert.eq(s._whirlwinds.length, 0, 'exactly ten kilometres per hour is still calm');
    Weather.accept({ kind: 'none', precip: false, windKph: 40 });
    Whirlwinds.observe(s, 100000, CALM);
    assert.eq(s._whirlwinds.length, 0, 'the cell/day visit stays decided after the wind rises');
  }));
  test('whirlwind: weather wind keeps Home and shared hazard exclusions calm', () => fixture((s, e) => {
    e.grid.fill(WorldGen.T.SAND);
    HomeArea.setOrigin(0, 0);
    assert.falsy(Whirlwinds.ground(s, 24, 24, null, Whirlwinds.WEATHER_GROUND), 'starting area');
    assert.truthy(Whirlwinds.ground(s, 24, 24, null, true), 'the Scroll of Wind keeps its broader movement gate');
    HomeArea.worldM = null;
    e._spawnOpts.spawnWhy[27] = WorldGen.SPAWN_WHY.KINDERGARTEN;
    assert.falsy(Whirlwinds.ground(s, 24, 24, null, Whirlwinds.WEATHER_GROUND), 'kindergarten');
    e._spawnOpts.spawnWhy[27] = 0; e._spawnOpts.roadMask[27] = 1;
    assert.falsy(Whirlwinds.ground(s, 24, 24, null, Whirlwinds.WEATHER_GROUND), 'road');
  }));
  test('whirlwind: unmapped default grass (between houses) is not open turf', () => fixture((s, e) => {
    e.mappedLand = new Uint8Array(64);
    assert.falsy(Whirlwinds.ground(s, 24, 24), 'unmapped grass');
    assert.truthy(Whirlwinds.ground(s, 24, 24, null, true), 'a wind gust still crosses it');
    Whirlwinds.observe(s, 0, GUST); assert.eq(s._whirlwinds.length, 0);
    e.mappedLand.fill(1);
    assert.truthy(Whirlwinds.ground(s, 24, 24), 'a mapped lawn or field');
  }));
  test('whirlwind: never in the starting area; a wind gust still may', () => fixture((s, e) => {
    HomeArea.setOrigin(0, 0);
    const edge = HomeArea.NEAR_M;
    assert.falsy(Whirlwinds.ground(s, 24, 24), 'home turf is calm');
    assert.truthy(Whirlwinds.ground(s, 24, 24, null, true), 'a gust ignores the whirlwind rule');
    Whirlwinds.observe(s, 0, CALM); assert.eq(s._whirlwinds.length, 0, 'no encounter at the start');
    HomeArea.setOrigin(-edge, 24);
    assert.truthy(Whirlwinds.ground(s, 24, 24), 'open grass beyond the starting area');
  }));
  test('whirlwind: one visit roll, school permitted, kindergarten and road excluded', () => fixture((s, e) => {
    e.grid.fill(WorldGen.T.SCHOOL);
    assert.truthy(Whirlwinds.ground(s, 24, 24));
    Whirlwinds.observe(s, 0, CALM); assert.eq(s._whirlwinds.length, 1);
    s._whirlwinds = []; s._whirlwindNextEncounter = 0;
    Whirlwinds.observe(s, 100000, CALM); assert.eq(s._whirlwinds.length, 0, 'standing does not reroll');
    e._spawnOpts.spawnWhy[27] = WorldGen.SPAWN_WHY.KINDERGARTEN;
    assert.falsy(Whirlwinds.ground(s, 24, 24));
    e._spawnOpts.spawnWhy[27] = 0; e._spawnOpts.roadMask[27] = 1;
    assert.falsy(Whirlwinds.ground(s, 24, 24));
  }));
  test('whirlwind: shared parking and road suppression blocks hazards but preserves scroll gusts', () => fixture((s, e) => {
    e._spawnOpts.spawnWhy[27] = WorldGen.SPAWN_WHY.KERB;
    assert.falsy(Whirlwinds.ground(s, 24, 24));
    assert.truthy(Whirlwinds.ground(s, 24, 24, null, true), 'the scroll still uses its enemy movement gate');
  }));
  test('whirlwind: forms only on grass, pitch and schoolyard terrain', () => fixture((s, e) => {
    const T = WorldGen.T;
    for (const type of [T.GRASS, T.PITCH, T.SCHOOL]) {
      e.grid.fill(type); assert.truthy(Whirlwinds.ground(s, 24, 24), `type ${type} allowed`);
    }
    for (const type of [T.PARK, T.PLAYGROUND]) {
      e.grid.fill(type); assert.falsy(Whirlwinds.ground(s, 24, 24), `type ${type} excluded`);
      assert.truthy(Whirlwinds.ground(s, 24, 24, null, true), 'a gust still crosses it');
    }
  }));
  test('whirlwind: warning is harmless, active contact damages once per cooldown', () => fixture(s => {
    const h = Whirlwinds.create({ x: 24, y: 24 }, 0, () => .5, 'test');
    s._whirlwinds = [h];
    Whirlwinds.tick(s, 0, 1799, CALM); assert.eq(s.save.energy, 100); assert.eq(h.frame, 3);
    Whirlwinds.tick(s, 0, 1800, CALM); assert.lt(s.save.energy, 100); assert.eq(h.frame, 4);
    const after = s.save.energy;
    Whirlwinds.tick(s, 0, 1801, CALM); assert.eq(s.save.energy, after);
    Whirlwinds.tick(s, 0, 2900, CALM); assert.lt(s.save.energy, after);
  }));
  test('whirlwind: knockback preserves raw GPS and world anchor while shifting body and offset', () => fixture(s => {
    const h = Whirlwinds.create({ x: 20, y: 24 }, 0, () => 0, 'test');
    const gps = JSON.stringify(s.gpsM), anchor = JSON.stringify(s.startWorldM);
    Whirlwinds.impulse(s, s, h, 0, true);
    Whirlwinds.pushStep(s, s, .1, 100, true);
    assert.gt(s.playerM.x, 24);
    assert.eq(s._targetM.x, s.playerM.x);
    assert.eq(s.gpsM.x + s._manualOffsetM.x, s.playerM.x);
    assert.eq(JSON.stringify(s.gpsM), gps); assert.eq(JSON.stringify(s.startWorldM), anchor);
    assert.eq(s.save.energy, 100, 'forced motion adds no steering energy cost');
  }));
  test('whirlwind: swept pushes stop before excluded ground, not on its far side', () => fixture((s, e) => {
    e._spawnOpts.occupied.add(27);
    for (let y = 0; y < 8; y++) e._spawnOpts.spawnWhy[y * 8 + 4] = WorldGen.SPAWN_WHY.RESTRICTED;
    const end = Whirlwinds.sweep(s, { x: 24, y: 24 }, 24, 0);
    assert.lt(end.x, 32); assert.gte(end.x, 24);
  }));
  test('whirlwind: nearby fauna and a separately represented companion take environmental damage', () => fixture((s, e) => {
    const fauna = { id: 'wild', kind: 'cow', x: 24, y: 24, _hp: 100 };
    const ally = { id: 'ally', kind: 'mercenary', x: 24, y: 24, _hp: 100 };
    e.creatures.push(fauna); s._mercenary = ally;
    s.playerM = { x: 56, y: 56 };
    s._whirlwinds = [Whirlwinds.create({ x: 24, y: 24 }, 0, () => 0, 'test')];
    Whirlwinds.tick(s, .1, 1800, CALM);
    assert.eq(s.hits.length, 2);
    assert.truthy(s.hits.every(hit => hit.source === 'obstacle'));
    Whirlwinds.tick(s, .1, 1900, CALM);
    assert.gt(Math.hypot(fauna.x - 24, fauna.y - 24), 0);
    assert.gt(Math.hypot(ally.x - 24, ally.y - 24), 0);
  }));
  test('whirlwind: push distance is identical at 10, 30 and 60fps, including final partial frame', () => fixture(s => {
    const h = Whirlwinds.create({ x: 20, y: 24 }, 0, () => 0, 'test');
    for (const step of [100, 1000 / 30, 1000 / 60]) {
      s.playerM = { x: 24, y: 24 }; s._targetM = { ...s.playerM };
      s._manualOffsetM = { x: 4, y: 0 };
      Whirlwinds.impulse(s, s, h, 0, true);
      Whirlwinds.pushStep(s, s, step / 1000, 0, true);
      assert.eq(s.playerM.x, 24, 'no movement before contact time');
      for (let now = step; now < 350 + step; now += step) Whirlwinds.pushStep(s, s, step / 1000, now, true);
      assert.lt(Math.abs(s.playerM.x - (24 + Whirlwinds.CONFIG.pushCells * s.cellM)), 1e-8);
      assert.eq(s._whirlwindPush, null);
    }
  }));
  test('whirlwind: a pending impulse never crosses depth boundaries', () => fixture(s => {
    Whirlwinds.impulse(s, s, { x: 20, y: 24, heading: 0 }, 0, true);
    s.depth = 1; Whirlwinds.pushStep(s, s, .1, 100, true);
    assert.eq(s.playerM.x, 24); assert.eq(s._whirlwindPush, null);
  }));
  test('whirlwind: expires and clears on changing depth', () => fixture(s => {
    s._whirlwinds = [Whirlwinds.create({ x: 24, y: 24 }, 0, () => 0, 'test')];
    Whirlwinds.tick(s, 0, Whirlwinds.CONFIG.warningMs + Whirlwinds.CONFIG.activeMs, CALM);
    assert.eq(s._whirlwinds.length, 0);
    s._whirlwinds = [Whirlwinds.create({ x: 24, y: 24 }, 0, () => 0, 'test')];
    s.depth = 1; Whirlwinds.tick(s, 0, 1, CALM); assert.eq(s._whirlwinds.length, 0);
  }));
})();
