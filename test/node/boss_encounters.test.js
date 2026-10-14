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

  for (const hz of [60, 120]) for (const shared of [false, true]) {
    test(`serpent: ${shared ? 'fed' : 'owned'} coils follow a curved trail at ${hz}Hz`, () => {
      const entry = { creatures: [], objects: [] };
      withWorld(entry, () => {
        const s = bossScene(entry), now = Date.now(), radius = 20;
        const start = { x: radius, y: 0, h: Math.PI / 2 };
        const record = BossEncounters.start(s.save, 'serpent', KEY, { own: !shared, depth: 0 }, now);
        if (shared) { record.pose = start; record.heardAt = now; }
        assert.truthy(s._spawnSerpent(KEY, start));
        const { head, coils, tail } = s._serpentPieces(KEY);
        if (!shared) s._serpentGoal = h => h._goal || { x: h.x, y: h.y };
        const history = [{ x: head.x, y: head.y }];
        const dt = 1 / hz, speed = EnemyRoster.get('serpent_head').movement.speedMetersPerSecond;
        const angleStep = 2 * Math.asin(speed * dt / (2 * radius));
        const realNow = performance.now;
        let t = 0, nextFeed = 0;
        try {
          performance.now = () => t;
          s._tickSerpents(now);
          for (let i = 0; i < 60 * hz; i++) {
            t = (i + 1) * dt * 1000;
            if (shared) {
              // The network publishes at its own cadence; the scene smooths
              // that pose on every display frame.
              if (t >= nextFeed) {
                const a = speed * t / 1000 / radius;
                record.pose = { x: radius * Math.cos(a), y: radius * Math.sin(a), h: a + Math.PI / 2 };
                record.heardAt = now + t;
                nextFeed += BossEncounters.KINDS.serpent.feedMs;
              }
            } else {
              // Drive the real head mover around a circle with tangent goals,
              // leaving its speed, turning and body tick untouched.
              const heading = (i + .5) * angleStep + Math.PI / 2;
              head._goal = { x: head.x + 30 * Math.cos(heading), y: head.y + 30 * Math.sin(heading) };
              head._goalUntil = t + 1000;
            }
            s._tickSerpents(now + t);
            history.push({ x: head.x, y: head.y });
          }
        } finally { performance.now = realNow; }
        // Independent reference: retain every frame of the actual head path.
        const backAlongHistory = distance => {
          for (let i = history.length - 1; i > 0; i--) {
            const a = history[i], b = history[i - 1], length = Math.hypot(b.x - a.x, b.y - a.y);
            if (distance <= length) {
              const u = distance / length;
              return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
            }
            distance -= length;
          }
          throw new Error('The head did not walk far enough to seat the full chain');
        };
        const chain = [...coils, tail], spacing = BossEncounters.KINDS.serpent.spacingCells * s.cellM;
        let previous = head;
        chain.forEach((piece, i) => {
          const expected = backAlongHistory((i + 1) * spacing);
          assert.lt(Math.hypot(piece.x - expected.x, piece.y - expected.y), .1,
            'each coil follows the head history instead of a straight spawn chord');
          assert.inRange(Math.hypot(piece.x - previous.x, piece.y - previous.y), spacing * .95, spacing * 1.01,
            'adjacent pieces remain evenly spaced around the curve');
          previous = piece;
        });
        const length = head._trail.slice(1).reduce((sum, point, i) =>
          sum + Math.hypot(point.x - head._trail[i].x, point.y - head._trail[i].y), 0);
        const needed = (chain.length + 2) * spacing;
        assert.inRange(length, needed, needed + .2 * s.cellM, 'old history trims at the chain margin');
        assert.lt(head._trail.length, needed / (.15 * s.cellM) + 4, 'sampling stays bounded at either frame rate');
      });
    });
  }

  test('serpent modes: eight-second phases repeat and keep their phase after a reload', () => {
    const s = bossScene({ creatures: [], objects: [] }), record = { startedAt: 1000 };
    s.peekM = { x: 5, y: -5 };
    const head = { x: 20, y: 0 }, p = { x: 0, y: 0 };
    const goalAt = elapsed => s._serpentGoal(head, p, record, record.startedAt + elapsed, elapsed);
    const roam = goalAt(0), half = (VIEW_CELLS / 2 - BossEncounters.KINDS.serpent.viewportMarginCells) * s.cellM;
    assert.eq(head._movementMode, 'roam');
    assert.inRange(roam.x, 5 - half, 5 + half);
    assert.inRange(roam.y, -5 - half, -5 + half);
    goalAt(7999); assert.eq(head._movementMode, 'roam');
    const orbit = goalAt(8000);
    assert.eq(head._movementMode, 'encircle');
    assert.lt(Math.abs(Math.hypot(orbit.x, orbit.y) - 2 * s.cellM), 1e-8);
    assert.gt(Math.abs(orbit.y), 0, 'circle goal leads around the player instead of toward them');
    goalAt(15999); assert.eq(head._movementMode, 'encircle');
    const charge = goalAt(16000);
    assert.eq(head._movementMode, 'charge');
    assert.lt(charge.x, p.x, 'charge goes through and beyond the player');
    p.y = 10;
    assert.eq(goalAt(16500), charge, 'moving aside does not drag a committed charge sideways');
    head.x = charge.x; head.y = charge.y;
    const nextCharge = goalAt(17000);
    assert.gt(nextCharge.y, p.y, 'next pass aims through the new player position');
    const reloaded = { x: 20, y: 0 };
    s._serpentGoal(reloaded, p, record, record.startedAt + 17000, 0);
    assert.eq(reloaded._movementMode, 'charge', 'reloading does not restart roaming');
    goalAt(23999); assert.eq(head._movementMode, 'charge');
    goalAt(24000); assert.eq(head._movementMode, 'roam', 'cycle repeats');
  });

  test('serpent modes: real head movement accelerates only during the charge phase', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const s = bossScene(entry), now = Date.now();
      const record = BossEncounters.start(s.save, 'serpent', KEY, { own: true, depth: 0 }, now);
      s._spawnSerpent(KEY, { x: 20, y: 0, h: Math.PI });
      const head = s._serpentPieces(KEY).head, dt = 0.1;
      for (const [elapsed, mode, mul] of [[0, 'roam', 1], [8000, 'encircle', 1], [16000, 'charge', 1.6], [24000, 'roam', 1]]) {
        const x = head.x, y = head.y;
        s._tickSerpent(KEY, dt, elapsed, record, now + elapsed);
        assert.eq(head._movementMode, mode);
        assert.lt(Math.abs(Math.hypot(head.x - x, head.y - y) - 3.9 * dt * mul), 1e-8);
      }
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
      assert.eq(EnemyRoster.get('serpent_body').dmg, 4, 'four a coil');
      coil.x = 0; coil.y = 0; coil._touchNextT = 0;
      const before = s.lost;
      foeBlowLands(s, coil, Combat.meleeBlow(coil, EnemyRoster.get(coil.kind).dmg));
      assert.eq(s.lost - before, Combat.incomingDamage(s.save, 4), 'through the one blow writer');
    });
  });

  test('serpent (shared): a nearby player adopts it, follows the feed, helps kill it, and is paid a hoard of their own', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const peer = bossScene(entry), now = Date.now(), key = `serpent_${now - 1000}`;
      const pose = { x: 30, y: 40, h: 1 };
      assert.falsy(peer._adoptSerpent(key, now - 1000, 1, pose, now), 'another floor: not ours to join');
      assert.truthy(peer._adoptSerpent(key, now - 1000, 0, pose, now), 'adopted');
      const record = BossEncounters.get(peer.save, 'serpent', key);
      assert.eq(record.own, false, 'not this player\'s to end');
      assert.eq(record.startedAt, now - 1000, 'the starter\'s clock');
      peer._tickBossEncounters(now);
      const head = entry.creatures.find(c => c.kind === 'serpent_head');
      assert.truthy(head && Math.hypot(head.x - 30, head.y - 40) < 1e-6, 'raised on the starter\'s pose');
      const coil = coilsOf(entry)[0];
      assert.truthy(EnemySpawns.isSharedId(coil, peer.save), 'its coils are shared enemies while the fight is live');
      assert.falsy(EnemySpawns.isSharedId(coil, { caught: [] }), 'and never to a save without the fight');
      peer._adoptSerpent(key, now - 1000, 0, { x: 33, y: 40, h: 0 }, now + 100);
      for (let i = 0; i < 30; i++) peer._tickSerpent(key, 0.05, 1000 + i * 50);
      assert.lt(Math.hypot(head.x - 33, head.y - 40), 0.5, 'the head follows the feed');
      // The kills arrive (shared hits); its own idol is not the one spent.
      for (const c of coilsOf(entry)) peer.save.caught.push(c.id);
      peer._tickBossEncounters(now + 200);
      assert.eq(entry.creatures.length, 0, 'it dies here too');
      assert.eq(Inventory.count(peer.save, 'serpent_idol'), 1, 'a helper keeps their own idol');
      assert.truthy(entry.objects.some(o => o.bossChest), 'and gets a hoard of their own');
    });
  });

  test('serpent (shared): a silent feed ends the adopted copy; the starter\'s own fight never goes stale', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const peer = bossScene(entry), now = Date.now(), key = `serpent_${now}`;
      assert.truthy(peer._adoptSerpent(key, now, 0, { x: 0, y: 0, h: 0 }, now));
      peer._tickBossEncounters(now);
      assert.gt(entry.creatures.length, 0);
      peer._tickBossEncounters(now + BossEncounters.KINDS.serpent.staleMs + 1);
      assert.eq(entry.creatures.length, 0, 'the starter won, reset or walked off: this copy goes');
      assert.eq(BossEncounters.list(peer.save, now).length, 0);
      assert.falsy(peer.flashes.some(f => /idol is still yours/.test(f)), 'no word about an idol it never raised');
      const own = bossScene(entry);
      assert.truthy(own._useSerpentIdol());
      own._tickBossEncounters(Date.now() + BossEncounters.KINDS.serpent.staleMs + 1);
      assert.eq(BossEncounters.list(own.save).length, 1, 'the starter drives its own fight');
    });
  });

  test('serpent (shared): a peer\'s boss frame reaches the scene in world metres; our own feed is sent every tick', () => {
    const calls = [];
    const scene = { save: { caught: [] }, mPerPx: 2, _adoptSerpent: (...a) => (calls.push(a), true) };
    assert.truthy(Multiplayer.onBoss(scene, { id: 3, key: 'serpent_5', startedAt: 5, d: 0, x: 10, y: 20, h: 1 }));
    assert.eq(JSON.stringify(calls[0].slice(0, 4)), JSON.stringify(['serpent_5', 5, 0, { x: 20, y: 40, h: 1 }]));
    assert.falsy(Multiplayer.onBoss(scene, { id: 3, key: 'b_1_2', startedAt: 5, d: 0, x: 1, y: 1, h: 0 }), 'not a boss key');
    assert.truthy(Multiplayer.BOSS_KEY_RE.test(`serpent_${Date.now()}`), 'the key the idol mints is the wire\'s');
    assert.truthy(/flushBattles\(scene, now\);\n\s*flushBosses\(scene, now\);/.test(ALL_SRC['multiplayer.js']), 'sent from the online tick');
  });

  test('serpent: the status row and the per-frame tick are wired', () => {
    assert.truthy(/this\._tickBossEncounters\(\);/.test(APP_JS_SRC), 'the frame runs the boss routine');
    assert.truthy(/BossEncounters\.list\(this\.save\)/.test(APP_JS_SRC), 'the status row shows each fight\'s clock');
    assert.truthy(/if \(EnemyRoster\.get\(c\.kind\)\?\.boss\) return;/.test(SCENE_SRC), 'the wander loop leaves boss pieces to their tick');
    assert.eq(CONSUMABLE_SPEC.serpent_idol.method, '_useSerpentIdol');
  });
})();
