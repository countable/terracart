// THE BOSS ROUTINE (src/boss_encounters.js) and its two kinds: the citadel's
// garrison (houses.js) and the serpent a Serpent Idol raises (scene_boss.js).
// A fight is time limited; it resets — and can be started again later — when
// it times out, or when the player who started it goes down or leaves its
// floor; winning spends the trigger for good.
(function () {
  const KEY = 'serpent_1000';
  const withWorld = (entry, run) => {
    const prev = { cache: WorldGen.tileCache, toTile: globalThis.worldMetersToTile, kept: globalThis.kept };
    WorldGen.tileCache = new Map([[WorldGen.tileKey(0, 0), entry]]);
    globalThis.worldMetersToTile = () => ({ tx: 0, ty: 0 });
    globalThis.kept = prev.kept || ((why, noun) => `${why} — ${noun} kept.`);
    try { run(); } finally {
      WorldGen.tileCache = prev.cache; globalThis.worldMetersToTile = prev.toTile; globalThis.kept = prev.kept;
    }
  };
  const bossScene = (entry, save = {}) => {
    const s = Object.assign(Object.create(SceneBoss.prototype), {
      depth: 0, cellM: 10, startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      save: { caught: [], opened: [], inv: [], energy: 100, ...save },
      flashes: [], lost: 0,
      flashAtPlayer(m) { this.flashes.push(m); },
      _expireCitadelBattles(now) { Houses.expireCitadelBattles(this.save, now); },
      _serpentHostEntry() { return entry; },
      _losePlayerEnergy(d) { this.lost += d; return d; },
    });
    Inventory.add(s.save, 'serpent_idol', 1);
    return s;
  };
  const coilsOf = entry => entry.creatures.filter(c => c.kind === 'serpent_body');

  test('boss encounters: start, clock, timeout and abandonment are one routine for every kind', () => {
    const save = {}, now = 1000;
    for (const kind of Object.keys(BossEncounters.KINDS)) {
      const D = BossEncounters.KINDS[kind].durationMs;
      assert.truthy(BossEncounters.start(save, kind, 'a', { depth: 0 }, now));
      assert.falsy(BossEncounters.start(save, kind, 'a', {}, now), 'one fight per trigger');
      assert.truthy(BossEncounters.active(save, kind, 'a', now + D - 1));
      assert.eq(BossEncounters.expire(save, kind, now + D - 1).length, 0);
      assert.eq(BossEncounters.expire(save, kind, now + D).map(e => e.reason).join(), 'timeout');
      assert.truthy(BossEncounters.start(save, kind, 'a', {}, now + D), 'and can be started again');
    }
    assert.eq(BossEncounters.list(save, now + 10).length, Object.keys(BossEncounters.KINDS).length);
    // Down, or off the fight's floor: the starter's own fights end.
    const off = BossEncounters.abandon(save, { depth: 1 }, now + 10);
    assert.eq(off.length, Object.keys(BossEncounters.KINDS).length);
    assert.truthy(off.every(e => e.reason === 'left'));
    assert.eq(BossEncounters.list(save, now + 10).length, 0, 'an abandoned fight is no longer live');
    assert.eq(BossEncounters.expire(save, 'serpent', now + 10)[0].reason, 'left');
    BossEncounters.start(save, 'serpent', 'b', { depth: 0 }, now);
    assert.eq(BossEncounters.abandon(save, { depth: 0 }, now).length, 0, 'still on its floor and standing: it goes on');
    assert.eq(BossEncounters.abandon(save, { depth: 0, downed: true }, now)[0].reason, 'downed');
  });

  test('boss encounters: a citadel battle is the routine\'s — the starter\'s death resets it, an adopted one runs on', () => {
    const key = (() => { for (let i = 1; i < 500; i++) { const k = `b_${1462600 + i}_823800`; if (CastleStyles.get(k).guards) return k; } })();
    const save = {}, now = 5000;
    assert.truthy(Houses.startCitadelBattle(save, key, now));
    assert.eq(save.citadelBattles[key].own, true, 'started here');
    save.citadelBattles[key].guardIds = ['g1'];
    BossEncounters.abandon(save, { depth: 0, downed: true }, now + 1);
    const reset = Houses.expireCitadelBattles(save, now + 1);
    assert.eq(JSON.stringify(reset), JSON.stringify([{ key, guardIds: ['g1'] }]), 'reset before its clock ran out');
    assert.truthy(Houses.startCitadelBattle(save, key, now + 2), 'and the castle can be fought again');
    delete save.citadelBattles[key];
    assert.eq(Houses.adoptCitadelBattle(save, key, now, now), 'adopted');
    assert.eq(BossEncounters.abandon(save, { depth: 0, downed: true }, now + 1).length, 0, 'another player\'s battle is not ours to end');
    assert.eq(Houses.CITADEL_BATTLE_MS, BossEncounters.KINDS.citadel.durationMs);
  });

  test('serpent idol: refused near a busy road, kept on a reset, consumed by the kill', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const s = bossScene(entry);
      const road = RoadSafety.roadClassAt;
      try {
        RoadSafety.roadClassAt = () => WorldGen.ROAD_CLASS_MAJOR_BUFFER;
        assert.falsy(s._useSerpentIdol(), 'the kerb of a Major or Medium road');
        RoadSafety.roadClassAt = () => WorldGen.ROAD_CLASS_JUNCTION_EXCLUDE;
        assert.falsy(s._useSerpentIdol(), 'a busy junction');
        assert.truthy(/busy road — idol kept/.test(s.flashes.at(-1)));
      } finally { RoadSafety.roadClassAt = road; }
      assert.eq(entry.creatures.length, 0);
      assert.truthy(s._useSerpentIdol(), 'open ground');
      const row = BossEncounters.KINDS.serpent;
      assert.eq(coilsOf(entry).length, row.coils);
      assert.eq(entry.creatures.length, row.coils + 2, 'a head, the coils and a tail tip');
      assert.eq(Inventory.count(s.save, 'serpent_idol'), 1, 'raising it does not spend it');
      assert.falsy(s._useSerpentIdol(), 'one serpent at a time');
      // Going down resets the fight: the serpent is gone, the idol stays.
      s.save.caught.push(coilsOf(entry)[0].id);
      s.save.energy = 0;
      s._tickBossEncounters(Date.now());
      assert.eq(entry.creatures.length, 0, 'the serpent sinks away');
      assert.eq(s.save.caught.length, 0, 'its slain coils are forgotten');
      assert.eq(Inventory.count(s.save, 'serpent_idol'), 1, 'the idol is still yours');
      assert.truthy(/idol is still yours/.test(s.flashes.at(-1)));
    });
  });

  test('serpent: leaving its floor resets the fight', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const s = bossScene(entry);
      assert.truthy(s._useSerpentIdol());
      s.depth = 1;
      s._tickBossEncounters(Date.now());
      assert.eq(entry.creatures.length, 0, 'gone from the floor it was raised on');
      assert.eq(BossEncounters.list(s.save).length, 0);
      assert.eq(Inventory.count(s.save, 'serpent_idol'), 1);
      s.depth = 0;
      assert.truthy(s._useSerpentIdol(), 'and it can be raised again later');
    });
  });

  test('serpent: slain coils shorten it; head and tail cannot be struck; it dies as head and tail and leaves a T4 hoard', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const s = bossScene(entry);
      assert.truthy(s._useSerpentIdol());
      const head = entry.creatures.find(c => c.kind === 'serpent_head');
      const tail = entry.creatures.find(c => c.kind === 'serpent_tail');
      assert.truthy(Combat.isConcealed(head) && Combat.isConcealed(tail), 'the head and tail tip take no strike');
      assert.eq(Combat.damageDealt(head, 99), 0);
      const coil = coilsOf(entry)[0];
      assert.falsy(Combat.isConcealed(coil));
      assert.eq(Combat.maxHp(coil), 10, 'ten hp a coil');
      assert.truthy(Combat.isEnemy(coil));
      // Each tick lays the chain on the head's trail; slaying coils closes it up.
      for (let i = 0; i < 20; i++) s._tickBossEncounters(Date.now());
      const spacing = BossEncounters.KINDS.serpent.spacingCells * s.cellM;
      const before = Math.hypot(tail.x - head.x, tail.y - head.y);
      const coils = coilsOf(entry);
      for (const c of coils.slice(0, coils.length - 1)) s.save.caught.push(c.id);
      s._tickBossEncounters(Date.now());
      assert.truthy(Math.hypot(tail.x - head.x, tail.y - head.y) <= 2 * spacing + 1e-6, 'one coil left: the tail sits two pieces back');
      assert.truthy(before > 2 * spacing, 'it was longer before');
      assert.eq(Inventory.count(s.save, 'serpent_idol'), 1);
      s.save.caught.push(coils.at(-1).id);
      s._tickBossEncounters(Date.now());
      assert.eq(entry.creatures.length, 0, 'only head and tail left: it dies');
      assert.eq(Inventory.count(s.save, 'serpent_idol'), 0, 'the idol is spent by the kill');
      assert.eq(BossEncounters.list(s.save).length, 0, 'and the fight is over for good');
      const chest = entry.objects.find(o => o.kind === 'chest');
      assert.truthy(chest && chest.bossChest, 'a hoard is left');
      assert.eq(chestTier(chest), 4, 'a T4 chest');
      assert.eq(chestThemeFor(chest), 'boss', 'equipment or a unique relic');
      // A rebuilt tile gets its unopened hoard back; an opened one is gone.
      entry.objects = [];
      s._ensureBossChests();
      assert.truthy(entry.objects.some(o => o.id === chest.id), 'survives a tile rebuild');
      s.save.opened.push(chest.id);
      s._ensureBossChests();
      assert.falsy(s.save.bossChests[chest.id], 'opened: the record goes');
    });
  });

  test('serpent: it stays near the player and its coils bite for their dmg, once an interval', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const s = bossScene(entry);
      assert.truthy(s._useSerpentIdol());
      const head = entry.creatures.find(c => c.kind === 'serpent_head');
      const leash = EnemyRoster.get('serpent_head').movement.leashCells * s.cellM;
      let maxD = 0;
      const realNow = performance.now;
      let t = 0;
      try {
        performance.now = () => t;
        for (let i = 0; i < 3000; i++) {
          t += 50;
          s._tickSerpents(Date.now());
          maxD = Math.max(maxD, Math.hypot(head.x, head.y));
        }
      } finally { performance.now = realNow; }
      assert.lt(maxD, leash + 2 * s.cellM, 'it snakes about the player, inside its leash');
      assert.gt(s.lost, 0, 'and it passes through the player, biting');
      const coil = coilsOf(entry)[0];
      assert.eq(EnemyRoster.get('serpent_body').dmg, 2, 'two a coil');
      coil.x = 0; coil.y = 0; coil._touchNextT = 0;
      const before = s.lost;
      foeBlowLands(s, coil, Combat.meleeBlow(coil, 2));
      assert.eq(s.lost - before, Combat.incomingDamage(s.save, 2), 'through the one blow writer');
    });
  });

  test('serpent: the status row and the per-frame tick are wired', () => {
    assert.truthy(/this\._tickBossEncounters\(\);/.test(APP_JS_SRC), 'the frame runs the boss routine');
    assert.truthy(/BossEncounters\.list\(this\.save\)/.test(APP_JS_SRC), 'the status row shows each fight\'s clock');
    assert.truthy(/if \(EnemyRoster\.get\(c\.kind\)\?\.boss\) return;/.test(SCENE_SRC), 'the wander loop leaves boss pieces to their tick');
    assert.eq(CONSUMABLE_SPEC.serpent_idol.method, '_useSerpentIdol');
  });
})();
