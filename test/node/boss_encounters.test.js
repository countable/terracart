// THE BOSS ROUTINE (src/boss_encounters.js) and its two kinds: the citadel's
// garrison (houses.js) and the serpent a Serpent Idol raises (scene_boss.js).
// A fight is time limited; it resets — and can be started again later — when
// it times out, or when the player who started it goes down or leaves its
// floor; winning spends the trigger for good. The serpent comes in a ladder
// of tiers (EnemyRoster.SERPENT_TIERS), one idol each; its head can be
// beaten but not slain.
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
    Inventory.add(s.save, 'wood_serpent_idol', 1);
    return s;
  };
  const partOf = c => EnemyRoster.get(c.kind)?.bossPart;
  const coilsOf = entry => entry.creatures.filter(c => partOf(c) === 'coil');

  test('serpent piece gather stays on its registered host tile', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const s = bossScene(entry), now = Date.now();
      BossEncounters.start(s.save, 'serpent', KEY, { own: true, depth: 0 }, now);
      s._spawnSerpent(KEY, { x: 20, y: 0, h: Math.PI });
      for (let i = 0; i < 100; i++) WorldGen.tileCache.set(`unrelated_${i}`, { creatures: [] });
      const values = WorldGen.tileCache.values.bind(WorldGen.tileCache);
      let fullScans = 0;
      WorldGen.tileCache.values = () => { fullScans++; return values(); };
      const pieces = s._serpentPieces(KEY);
      assert.truthy(pieces.head && pieces.tail);
      assert.eq(pieces.coils.length, BossEncounters.KINDS.serpent.coils);
      assert.eq(fullScans, 0, 'gather cost follows the chain, not cached world size');
    });
  });

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
      assert.eq(Inventory.count(s.save, 'wood_serpent_idol'), 1, 'raising it does not spend it');
      assert.falsy(s._useSerpentIdol(), 'one serpent at a time');
      // Going down resets the fight: the serpent is gone, the idol stays.
      s.save.caught.push(coilsOf(entry)[0].id);
      s.save.energy = 0;
      s._tickBossEncounters(Date.now());
      assert.eq(entry.creatures.length, 0, 'the serpent sinks away');
      assert.eq(s.save.caught.length, 0, 'its slain coils are forgotten');
      assert.eq(Inventory.count(s.save, 'wood_serpent_idol'), 1, 'the idol is still yours');
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
      assert.eq(Inventory.count(s.save, 'wood_serpent_idol'), 1);
      s.depth = 0;
      assert.truthy(s._useSerpentIdol(), 'and it can be raised again later');
    });
  });

  test('serpent: slain coils shorten it; the tail cannot be struck; it dies as head and tail and leaves a plain chest of its tier', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const s = bossScene(entry);
      assert.truthy(s._useSerpentIdol());
      const head = entry.creatures.find(c => partOf(c) === 'head');
      const tail = entry.creatures.find(c => partOf(c) === 'tail');
      assert.truthy(head.kind === 'wood_serpent_head' && tail.kind === 'wood_serpent_tail', 'the Wood idol raises the Wood rows');
      assert.truthy(Combat.isConcealed(tail), 'the tail tip takes no strike');
      assert.eq(Combat.damageDealt(tail, 99), 0);
      assert.falsy(Combat.isConcealed(head), 'the head is struck like a coil');
      const coil = coilsOf(entry)[0];
      assert.falsy(Combat.isConcealed(coil));
      assert.eq(Combat.maxHp(coil), 10, 'ten hp a Wood coil');
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
      assert.eq(Inventory.count(s.save, 'wood_serpent_idol'), 1);
      s.save.caught.push(coils.at(-1).id);
      s._tickBossEncounters(Date.now());
      assert.eq(entry.creatures.length, 0, 'only head and tail left: it dies');
      assert.eq(Inventory.count(s.save, 'wood_serpent_idol'), 0, 'the idol is spent by the kill');
      assert.eq(BossEncounters.list(s.save).length, 0, 'and the fight is over for good');
      const chest = entry.objects.find(o => o.kind === 'chest');
      assert.truthy(chest && chest.bossChest, 'a hoard is left');
      assert.eq(chestTier(chest), 1, 'a chest of the Wood serpent\'s tier');
      assert.eq(chestThemeFor(chest), 'boss', 'equipment or a unique relic');
      assert.falsy(chest.name || chest.poiClass, 'a plain chest: no label, no point of interest');
      assert.truthy(/\(o\.name \|\| POI_CLASS_FALLBACK\[o\.poiClass\]\)/.test(RENDER_SRC), 'render.js labels only named or classed chests');
      // A rebuilt tile gets its unopened hoard back; an opened one is gone.
      entry.objects = [];
      s._ensureBossChests();
      assert.truthy(entry.objects.some(o => o.id === chest.id), 'survives a tile rebuild');
      s.save.opened.push(chest.id);
      s._ensureBossChests();
      assert.falsy(s.save.bossChests[chest.id], 'opened: the record goes');
      // A hoard recorded before the ladder (no tier) is still the T4 it was.
      s.save.bossChests.legacy_hoard = { x: 0, y: 0, depth: 0 };
      s._ensureBossChests();
      assert.eq(chestTier(entry.objects.find(o => o.id === 'legacy_hoard')), 4);
    });
  });

  test('serpent: the head is struck and, beaten, slows the serpent by half without ending the fight', () => {
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const s = bossScene(entry), now = Date.now();
      const record = BossEncounters.start(s.save, 'serpent', KEY, { own: true, depth: 0 }, now);
      s._spawnSerpent(KEY, { x: 20, y: 0, h: Math.PI });
      const { head, coils } = s._serpentPieces(KEY);
      assert.eq(Combat.maxHp(head), 3 * Combat.maxHp(coils[0]), 'three coils\' worth of hp');
      assert.falsy(s._bossPieceFelled(coils[0]), 'a coil\'s fall is an ordinary kill');
      assert.eq(Combat.damageDealt(head, Combat.maxHp(head)), Combat.maxHp(head), 'blows land on the head');
      assert.truthy(s._bossPieceFelled(head), 'struck to zero it is beaten, not caught');
      assert.truthy(head._beaten && record.headBeaten);
      assert.truthy(Combat.isConcealed(head), 'and takes nothing more');
      assert.eq(Combat.damageDealt(head, 99), 0);
      assert.truthy(s._bossPieceFelled(head), 'a late blow on a beaten head is still never a kill');
      assert.eq(s.save.caught.length, 0);
      assert.truthy(/idol is still yours/.test(s.flashes.at(-1)) === false && /head drops/.test(s.flashes.at(-1)));
      const x = head.x, y = head.y, dt = 0.1;
      s._tickSerpent(KEY, dt, 0, record, now);
      const speed = EnemyRoster.get(head.kind).movement.speedMetersPerSecond;
      assert.lt(Math.abs(Math.hypot(head.x - x, head.y - y) - speed * dt * BossEncounters.KINDS.serpent.headBeatenSpeedMul), 1e-8,
        'half pace with the head down');
      assert.eq(BossEncounters.list(s.save, now).length, 1, 'the fight goes on');
      assert.falsy(entry.objects.some(o => o.bossChest), 'no chest for a head alone');
      // A reload re-raises it beaten.
      entry.creatures = [];
      s._tickSerpent(KEY, dt, 1, record, now);
      const again = s._serpentPieces(KEY).head;
      assert.truthy(again && again._beaten && Combat.hp(again) === 0, 'the record remembers the beaten head');
      assert.truthy(/if \(this\._bossPieceFelled\?\.\(c, source\)\) return true;\n\s*this\.resolveDefeat\(c, source\);/.test(APP_JS_SRC),
        'a felled piece is offered to its fight before resolveDefeat');
    });
  });

  test('serpent ladder: each idol raises the serpent of its tier, in that tier\'s rows, and leaves a chest of that tier', () => {
    assert.eq(SERPENT_IDOLS.length, EnemyRoster.SERPENT_TIERS.length);
    assert.eq(SERPENT_IDOLS.map(i => i.id).join(), 'wood_serpent_idol,copper_serpent_idol,iron_serpent_idol,gold_serpent_idol,platinum_serpent_idol,crimson_serpent_idol,frost_serpent_idol');
    for (const idol of SERPENT_IDOLS) {
      const t = EnemyRoster.serpentTier(idol.bossTier);
      assert.eq(idol.name, `${t.name} Serpent Idol`);
      assert.eq(ITEM_BY_ID[idol.id].baseTier, t.tier, 'the idol sits at its serpent\'s tier');
      assert.eq(MATERIAL_TIERS.find(m => m.tier === t.tier).name, t.name, 'the ladder\'s names are the material ladder\'s');
      assert.truthy(idol.findOnly && idol.dropWeight === SERPENT_IDOL_DROP_WEIGHT && !idol.progressionOnly, 'a scarce find, never a ware');
      assert.gt(PRICES[idol.id], 0);
      assert.truthy(ITEM_EFFECTS[idol.id] && MINERAL_ICON_SHEET[idol.id], 'flavour and an icon');
      assert.eq(CONSUMABLE_SPEC[idol.id].method, '_useSerpentIdol');
      assert.eq(serpentIdolId(t.tier), idol.id);
      for (const part of ['head', 'coil', 'tail']) {
        const row = EnemyRoster.get(EnemyRoster.serpentKind(t.tier, part));
        assert.truthy(row && row.boss === 'serpent' && row.bossPart === part && row.tier === t.tier, `${t.name} ${part}`);
        assert.eq(row.hp, part === 'head' ? 3 * t.hp : t.hp);
        assert.eq(row.dmg, t.dmg);
        assert.eq(row.movement.speedMetersPerSecond, t.speed);
        assert.eq(row.palette, t.palette, 'the tier\'s colour recolours the one atlas');
        assert.eq(row.art.path, 'assets/Enemy/SegmentedSerpent/parts.png');
      }
    }
    const wood = EnemyRoster.serpentTier(1);
    assert.truthy(wood.hp === 10 && wood.dmg === 4 && wood.speed === 3.9, 'the Wood serpent is the original tuning');
    for (let i = 1; i < EnemyRoster.SERPENT_TIERS.length; i++) {
      const a = EnemyRoster.SERPENT_TIERS[i - 1], b = EnemyRoster.SERPENT_TIERS[i];
      assert.truthy(b.hp > a.hp && b.dmg > a.dmg && b.speed > a.speed, 'every rung up is tougher, harder-biting and faster');
    }
    assert.falsy(Shops.THEME_POOL.potion().some(id => ITEM_BY_ID[id].findOnly), 'no idol on a shop shelf');
    // Raise the Gold serpent and kill it: Gold rows, the Gold idol spent, a T4 chest.
    const entry = { creatures: [], objects: [] };
    withWorld(entry, () => {
      const s = bossScene(entry);
      Inventory.add(s.save, 'gold_serpent_idol', 1);
      assert.falsy(s._useSerpentIdol('frost_serpent_idol'), 'no Frost idol in the bag');
      assert.truthy(s._useSerpentIdol('gold_serpent_idol'));
      assert.truthy(entry.creatures.every(c => c.kind.startsWith('gold_serpent_')), 'the Gold rows');
      const coil = coilsOf(entry)[0];
      assert.eq(Combat.maxHp(coil), EnemyRoster.serpentTier(4).hp);
      assert.eq(BossEncounters.list(s.save)[0].record.tier, 4, 'the record carries the tier');
      for (const c of coilsOf(entry)) s.save.caught.push(c.id);
      s._tickBossEncounters(Date.now());
      assert.eq(Inventory.count(s.save, 'gold_serpent_idol'), 0, 'the Gold idol is spent');
      assert.eq(Inventory.count(s.save, 'wood_serpent_idol'), 1, 'the Wood one is not');
      const chest = entry.objects.find(o => o.kind === 'chest');
      assert.eq(chestTier(chest), 4, 'a chest of the Gold serpent\'s tier');
    });
  });

  test('serpent ladder: a save from before it holds the Wood idol; the ladder is on the wire', () => {
    const old = migrateSave({ inv: [{ id: 'serpent_idol', count: 1 }, { id: 'torch', count: 2 }] });
    assert.eq(old.inv.map(s => s.id).join(), 'wood_serpent_idol,torch');
    assert.falsy(ITEM_BY_ID.serpent_idol, 'the old id is gone from the catalogue');
    assert.truthy(/tier: e\.record\.tier \|\| 1/.test(ALL_SRC['multiplayer.js']), 'the feed names the serpent\'s rung');
  });

  test('serpent: its pieces draw head-most on top wherever nothing lies between them', () => {
    const piece = (link, groundY) => ({ it: { link }, chain: 'serpent_1', link, groundY, rank: 3 });
    // Heading north: the tail is southmost, so a bare ground sort would put it on top.
    const head = piece(-1, 5), c0 = piece(0, 6), c1 = piece(1, 7), tail = piece(2, 8);
    let rows = [tail, c1, c0, head];
    Render.sortWorldDepth(rows);
    assert.eq(rows.map(r => r.link).join(), '2,1,0,-1', 'tail beneath, each coil over the one behind it, the head over all');
    // A prop between two coils splits the chain: the ground order holds across it.
    const prop = { it: {}, groundY: 6.5, rank: 1 };
    rows = [tail, c1, prop, c0, head];
    Render.sortWorldDepth(rows);
    assert.eq(rows.map(r => r.link ?? 'prop').join(), '0,-1,prop,2,1');
    // Another serpent's pieces are their own chain.
    const other = { it: {}, chain: 'serpent_2', link: 3, groundY: 5.5, rank: 3 };
    rows = [tail, other, head, c0];
    Render.sortWorldDepth(rows);
    assert.eq(rows.map(r => r.chain === 'serpent_2' ? 'other' : r.link).join(), '-1,other,2,0');
    assert.truthy(/chain: it\.c\.boss, link: it\.c\.segIndex/.test(RENDER_SRC), 'creature rows name their chain');
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
        const dt = 1 / hz, speed = EnemyRoster.get('wood_serpent_head').movement.speedMetersPerSecond;
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
      const head = entry.creatures.find(c => partOf(c) === 'head');
      const leash = EnemyRoster.get('wood_serpent_head').movement.leashCells * s.cellM;
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
      assert.eq(EnemyRoster.get('wood_serpent_body').dmg, 4, 'four a coil');
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
      assert.truthy(peer._adoptSerpent(key, now - 1000, 0, pose, now, 2), 'adopted');
      const record = BossEncounters.get(peer.save, 'serpent', key);
      assert.eq(record.own, false, 'not this player\'s to end');
      assert.eq(record.tier, 2, 'at the starter\'s tier');
      assert.eq(record.startedAt, now - 1000, 'the starter\'s clock');
      peer._tickBossEncounters(now);
      const head = entry.creatures.find(c => partOf(c) === 'head');
      assert.truthy(head && Math.hypot(head.x - 30, head.y - 40) < 1e-6, 'raised on the starter\'s pose');
      assert.eq(head.kind, 'copper_serpent_head', 'in the starter\'s rows');
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
      assert.eq(Inventory.count(peer.save, 'wood_serpent_idol'), 1, 'a helper keeps their own idol');
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
    assert.truthy(Multiplayer.onBoss(scene, { id: 3, key: 'serpent_5', startedAt: 5, d: 0, x: 10, y: 20, h: 1, tier: 3 }));
    assert.eq(JSON.stringify(calls[0].slice(0, 4)), JSON.stringify(['serpent_5', 5, 0, { x: 20, y: 40, h: 1 }]));
    assert.eq(calls[0][5], 3, 'the feed\'s tier reaches the adopter');
    assert.truthy(Multiplayer.onBoss(scene, { id: 3, key: 'serpent_6', startedAt: 5, d: 0, x: 10, y: 20, h: 1 }));
    assert.eq(calls[1][5], 1, 'a feed from before the ladder is the Wood serpent');
    assert.falsy(Multiplayer.onBoss(scene, { id: 3, key: 'b_1_2', startedAt: 5, d: 0, x: 1, y: 1, h: 0 }), 'not a boss key');
    assert.truthy(Multiplayer.BOSS_KEY_RE.test(`serpent_${Date.now()}`), 'the key the idol mints is the wire\'s');
    assert.truthy(/flushBattles\(scene, now\);\n\s*flushBosses\(scene, now\);/.test(ALL_SRC['multiplayer.js']), 'sent from the online tick');
  });

  test('serpent: the status row and the per-frame tick are wired', () => {
    assert.truthy(/this\._tickBossEncounters\(\);/.test(APP_JS_SRC), 'the frame runs the boss routine');
    assert.truthy(/BossEncounters\.list\(this\.save\)/.test(APP_JS_SRC), 'the status row shows each fight\'s clock');
    assert.truthy(/if \(EnemyRoster\.get\(c\.kind\)\?\.boss\) return;/.test(SCENE_SRC), 'the wander loop leaves boss pieces to their tick');
    assert.eq(CONSUMABLE_SPEC.wood_serpent_idol.method, '_useSerpentIdol');
    assert.truthy(/this\[row\.method\]\(id\)/.test(SCENE_SRC), 'a consumable\'s method is handed its id');
  });
})();
