// Execute the same helpers the live wander loop calls, with terrain and the
// energy writer stubbed; no alternate movement or damage implementation.
(function () {
  function scene(cellM = 7) {
    return { cellM, depth: 2, save: { energy: 100, armor: {} },
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false, _shots: [],
      // The scene's writer banks fractions into whole pips (app.js
      // _losePlayerEnergy); an aura's rate arrives fractional.
      _losePlayerEnergy(n) {
        const whole = bankWhole(this, '_incomingDamageFraction', n);
        this.save.energy -= whole; return whole;
      } };
  }
  function foe(kind, x = 0, y = 0) { return { kind, id: `ai_${kind}`, x, y }; }

  test('gelatinous cube overlaps player and deals contact damage', () => {
    const s = scene(), c = foe('gelatinous_cube'), row = EnemyRoster.get(c.kind);
    for (let i = 0; i < 100; i++) rosterEnemyMove(s,c,row,i*100,3,0,false,false,null,0.1);
    assert.inRange(c.x, 2.99, 3.01);
    rosterEnemyAttack(s,c,row,10000,3,0,false,0.1);
    assert.lt(s.save.energy,100);
    const before = s.save.energy;
    rosterEnemyAttack(s,c,row,12000,3,0,true,0.1);
    assert.eq(s.save.energy,before);
  });
  test('golden slime circles and leaves persistent damaging marks expiring after ten minutes', () => {
    const s=scene(), c=foe('golden_slime',11.2,0), row=EnemyRoster.get(c.kind);
    for (let i=0;i<100;i++) rosterEnemyMove(s,c,row,i*100,0,0,false,false,null,0.1);
    assert.gt(Math.abs(c.y),1);
    assert.inRange(Math.hypot(c.x,c.y),10,13);
    const marks=Object.values(s.save.slimeTrails);
    assert.gt(marks.length,10);
    const mark=marks[0];
    assert.eq(mark.expiresAt-mark.createdAt,600000);
    for (let i=0;i<60;i++) enemySlimeTrailTick(s,mark.x,mark.y,1/60,mark.createdAt);
    assert.lt(s.save.energy,100);
    const before=s.save.energy;
    enemySlimeTrailTick(s,mark.x,mark.y,1,Math.max(...marks.map(p=>p.expiresAt)));
    assert.eq(s.save.energy,before);
    assert.eq(Object.keys(s.save.slimeTrails).length,0);
  });
  test('wurm emerges only in allowed mine cells, waits through emergence then burrows again', () => {
    const s=scene(), c=foe('wurm'), row=EnemyRoster.get(c.kind);
    c.burrowCells=[{x:7,y:0}];
    assert.truthy(enemyBurrowTick(s,c,row,1000));
    assert.truthy(c._burrowed);
    assert.falsy(Combat.isEnemy(c));
    assert.truthy(enemyBurrowTick(s,c,row,c._burrowNextT));
    assert.falsy(c._burrowed);
    assert.eq(c.x,7);
    assert.gt(c._emergeUntil,c._emergeT0);
    rosterEnemyAttack(s,c,row,c._emergeT0,7,0,false,0.1);
    assert.eq(s.save.energy,100);
    assert.falsy(enemyBurrowTick(s,c,row,c._emergeUntil));
    assert.truthy(enemyBurrowTick(s,c,row,c._burrowNextT));
    assert.truthy(c._burrowed);
  });
  test('graveyard zombie waits for a visible player then emerges once', () => {
    const s=scene(), c=foe('zombie'), row=EnemyRoster.get(c.kind);
    Object.assign(s,{startWorldM:{x:0,y:0},playerM:{x:7,y:0},isUnnoticed:()=>true});
    c.emergeFromGround=true;
    assert.truthy(enemyBurrowTick(s,c,row,1000));
    assert.truthy(c._burrowed);
    s.isUnnoticed=()=>false;
    assert.truthy(enemyBurrowTick(s,c,row,2000));
    assert.falsy(c._burrowed);
    assert.truthy(c._hasEmerged);
    assert.falsy(enemyBurrowTick(s,c,row,c._emergeUntil));
    assert.falsy(enemyBurrowTick(s,c,row,10000));
    const body=RENDER_SRC.match(/Render\.applyEmergence = function \(sprite, creature, now\) \{([\s\S]*?)\n\};/)[1];
    const animate=new Function('sprite','creature','now',body);
    for (const progress of [0,0.5,1]) {
      const sprite={y:100,scaleY:2,frame:{realHeight:16,realWidth:16},
        setCrop(...args) { this.crop=args; }};
      animate(sprite,c,c._emergeT0+(c._emergeUntil-c._emergeT0)*progress);
      assert.eq(sprite.y,100+32*(1-progress));
      if (progress<1) assert.eq(sprite.crop[3],Math.max(1,16*progress));
      else assert.eq(sprite.crop.length,0,'pooled sprite crop resets after emergence');
    }
  });
  test('metal slime: flees instead of attacking, with very high HP and a fixed 75-coin bounty', () => {
    const row=EnemyRoster.get('metal_slime'), c=foe('metal_slime'), s=scene();
    assert.eq(row.hp,375);
    assert.gt(row.hp,EnemyRoster.get('red_dragon').hp);
    assert.eq(row.dmg,0); assert.falsy(row.eliteEligible);
    for(const depth of [0,1,12]) for(const mul of [1,2]) assert.eq(Combat.enemyBounty(c.kind,depth,mul),75);
    for(let i=0;i<10;i++) {
      rosterEnemyAttack(s,c,row,i*100,7,0,false,0.1);
      rosterEnemyMove(s,c,row,i*100,7,0,false,false,null,0.1);
    }
    assert.lt(c.x,-2,'moves away from the player');
    assert.eq(s.save.energy,100,'never attacks');
    assert.eq(s._shots.length,0);
    assert.eq(SpriteLayout.creatureArt(c.kind).sheet,c.kind);
    const assets = new Function('window','EnemyRoster','SpriteLayout',ASSETS_SRC+'\nreturn ASSETS;')({},EnemyRoster,SpriteLayout);
    assert.truthy(assets[c.kind].onLoad,'canonical palette recolor supplies silver art');
  });
  test('enemy AI: walk distance uses absolute metres, independent of cell size', () => {
    const row = EnemyRoster.get('zombie');
    const positions = [];
    for (const cellM of [5, 10]) {
      const s = scene(cellM), c = foe('zombie');
      for (let i = 0; i < 10; i++) rosterEnemyMove(s, c, row, i * 100, 20, 0, false, false, null, 0.1);
      positions.push(c.x);
    }
    assert.inRange(positions[0], row.movement.speedMetersPerSecond - 1e-9, row.movement.speedMetersPerSecond + 1e-9);
    assert.eq(positions[0], positions[1]);
  });
  test('enemy AI: attack wind-up cancels on lost interest, cooldown includes wind-up', () => {
    const c = foe('brute'), row = EnemyRoster.get('brute');
    assert.falsy(enemyAttackReady(c, row, 10000, true));
    assert.falsy(enemyAttackReady(c, row, 10500, false));
    assert.eq(c._attackWindupUntil, null);
    assert.falsy(enemyAttackReady(c, row, 11000, true));
    assert.falsy(enemyAttackReady(c, row, 14000, true));
    assert.truthy(enemyAttackReady(c, row, 15100, true));
    assert.falsy(enemyAttackReady(c, row, 15101, true));
  });
  test('enemy rendering: attack wind-ups keep the body palette and status tints', () => {
    const body = RENDER_SRC.match(/    const frozen = c\._frozenUntil[\s\S]*?Render\.setShine\(s, [^;]+;/);
    assert.truthy(body, 'live creature tint block exists');
    const paint = new Function('c', 's', 'performance', 'Date', 'Combat', 'Conditions',
      'FROZEN_TINT', 'SHINY_TINT', 'npcArt', 'creatureTint', 'Render', 'scene', body[0]);
    const renderTint = (c, now) => {
      const sprite = { tint: null, fill: false,
        setTint(tint) { this.tint = tint; this.fill = false; },
        setTintFill(tint) { this.tint = tint; this.fill = true; } };
      paint(c, sprite, { now: () => now }, { now: () => now },
        { burning: () => !!c.burning, statusFlashTint: () => null, poisoned: () => !!c.poisoned },
        { conditionTintOn: () => true, DEFINITIONS: { burning: { tint: 0xff5500 }, poison: { tint: 0x9fdc8c } } },
        0x99ccff, 0xffd23a, null, () => 0x123456, { setShine() {} }, {});
      return sprite;
    };
    for (const windup of ['_attackWindupUntil', '_lungeWindupUntil', '_abilityWindupUntil']) {
      for (const now of [1000, 1100, 1200]) {
        const c = { kind: 'goblin', [windup]: 2000 };
        const normal = renderTint(c, now);
        assert.eq(normal.tint, 0x123456, `${windup} keeps its palette`);
        assert.falsy(normal.fill, 'no attack tint fill');
        assert.eq(renderTint({ ...c, shiny: true }, now).tint, 0xffd23a, 'elite sheen remains');
        assert.eq(renderTint({ ...c, burning: true }, now).tint, 0xff5500, 'burning remains visible');
        assert.eq(renderTint({ ...c, _frozenUntil: 2000 }, now).tint, 0x99ccff, 'ice remains visible');
        assert.eq(renderTint({ ...c, _supportUntil: 2000 }, now).tint, 0x8cefa0, 'support remains visible');
      }
    }
  });
  test('enemy AI: ranged row fires a single mitigated hit after its own wind-up', () => {
    const s = scene(), c = foe('lich'), row = EnemyRoster.get('lich');
    rosterEnemyAttack(s, c, row, 10000, 14, 0, false, 0.1);
    assert.eq(s._shots.length, 0);
    rosterEnemyAttack(s, c, row, 10800, 14, 0, false, 0.1);
    assert.eq(s._shots.length, 1);
    assert.eq(s._shots[0].hits, 1);
    assert.eq(s._shots[0].projectile, 'blight_magic');
    rosterEnemyAttack(s, c, row, 12000, 14, 0, false, 0.1);
    assert.eq(s._shots.length, 1);
  });
  test('enemy AI: draining aura banks fractions and stops for hidden or downed targets', () => {
    const s = scene(), c = foe('lich');
    const row = { ...EnemyRoster.get('lich'), dmg: 0 };
    const expected = Math.floor(Combat.playerDamageRate(2 * Combat.powerMul(c), {}, 1) + 1e-9);
    for (let i = 0; i < 60; i++) rosterEnemyAttack(s, c, row, 10000 + i * 1000 / 60, 1, 0, false, 1 / 60);
    assert.eq(100 - s.save.energy, expected);
    const before = s.save.energy;
    rosterEnemyAttack(s, c, row, 12000, 1, 0, true, 1);
    assert.eq(s.save.energy, before);
    s.save.energy = 0;
    rosterEnemyAttack(s, c, row, 13000, 1, 0, false, 1);
    assert.eq(s.save.energy, 0);
  });
  test('enemy AI: draining aura shield expires on the wall-clock boundary', () => {
    const realDateNow = Date.now;
    const wallNow = 1800000000000;
    let current = wallNow + 999;
    try {
      Date.now = () => current;
      const row = { ...EnemyRoster.get('lich'), dmg: 0 };
      const active = scene(), activeFoe = foe('lich');
      active.save.shieldPotionUntil = wallNow + 1000;
      rosterEnemyAttack(active, activeFoe, row, 10000, 1, 0, false, 1);

      current = wallNow + 1001;
      const expired = scene(), expiredFoe = foe('lich');
      expired.save.shieldPotionUntil = wallNow + 1000;
      rosterEnemyAttack(expired, expiredFoe, row, 10000, 1, 0, false, 1);

      assert.eq(100 - expired.save.energy, 2 * (100 - active.save.energy),
        'expiry restores the full aura rate after the final protected millisecond');
    } finally { Date.now = realDateNow; }
  });
  test('enemy AI: swept movement stops at a wall even with a clear endpoint', () => {
    const s = scene(), c = foe('bat'), row = EnemyRoster.get('bat');
    s._cellBlocked = x => x >= 3 && x <= 5;
    assert.falsy(enemySweep(s, c, row, 8, 0));
    assert.lt(c.x, 3);
  });
  test('enemy AI: crow-eased bat flight never exceeds declared peak metres/second', () => {
    for (const kind of ['bat', 'vampire_bat']) {
      for (const cellM of [5, 10]) {
        const s = scene(cellM), c = foe(kind), row = EnemyRoster.get(kind);
        assert.lte(row.movement.speedMetersPerSecond, WILD_SPEED_CEILING_MPS);
        enemyBatMove(s, c, row, 10000, 20, 0);
        const f = c._batFlight;
        assert.lte(2 * Math.hypot(f.tx - f.x, f.ty - f.y) / (f.duration / 1000), row.movement.speedMetersPerSecond + 1e-9);
        let previous = { x: c.x, y: c.y };
        for (let t = 10010; t < 10000 + f.duration; t += 10) {
          enemyBatMove(s, c, row, t, 20, 0);
          assert.lte(Math.hypot(c.x - previous.x, c.y - previous.y) / 0.01, row.movement.speedMetersPerSecond + 1e-9);
          previous = { x: c.x, y: c.y };
        }
      }
    }
  });
  test('shiny movement: walking and raven/bat flight are exactly 1.5x', () => {
    const originalRandom = Math.random;
    try {
      Math.random = () => 0.5;
      const normal = foe('zombie'), gold = { ...normal, shiny: true };
      for (const c of [normal, gold]) rosterEnemyMove(scene(), c, EnemyRoster.get(c.kind), 10000, 40, 0, false, false, null, 0.1);
      assert.inRange(gold.x / normal.x, 1.5 - 1e-9, 1.5 + 1e-9);
      for (const kind of ['raven', 'bat', 'vampire_bat']) {
        const plain = foe(kind), shiny = { ...plain, shiny: true };
        for (const c of [plain, shiny]) enemyBatMove(scene(), c, EnemyRoster.get(kind), 10000, 40, 0);
        assert.inRange(plain._batFlight.duration / shiny._batFlight.duration, 1.5 - 1e-9, 1.5 + 1e-9);
        assert.inRange(Math.hypot(shiny._batFlight.tx, shiny._batFlight.ty) / Math.hypot(plain._batFlight.tx, plain._batFlight.ty), 1 - 1e-9, 1 + 1e-9);
      }
    } finally { Math.random = originalRandom; }
  });
  test('shiny stats: all fauna and raven double health and attack, only eligible foes gain elite rewards', () => {
    for (const kind of [...Object.keys(Combat.FAUNA_HP), 'raven']) {
      const plain = { kind }, shiny = { kind, shiny: true };
      assert.eq(Combat.maxHp(shiny), 2 * Combat.maxHp(plain), kind);
      assert.eq(Combat.petBlow(shiny), 2 * Combat.petBlow(plain), kind);
      assert.eq(Combat.shinySpeedMul(shiny), 1.5);
      assert.eq(Combat.shinySpeedMul(plain), 1);
    }
    assert.falsy(Combat.isElite({ kind: 'raven', shiny: true }));
  });
  test('deep ghosts: enlarged white and pink ghosts double power once; shiny is a separate bonus', () => {
    for (const kind of ['ghost', 'pink_ghost']) {
      const plain = { kind }, deep = { kind, _artScale: EnemyRoster.ghostProfile(6).sizeMultiplier };
      assert.eq(Combat.maxHp(deep), 2 * Combat.maxHp(plain));
      assert.eq(Combat.powerMul(deep), 2);
      assert.eq(Combat.powerMul({ ...deep, shiny: true }), 4);
      assert.eq(Combat.ghostSizeMul({ kind, _artScale: 1 }), 1);
      assert.eq(Combat.shinySpeedMul(deep), 1, 'size alone does not quicken ghosts');
    }
    assert.eq(Combat.ghostSizeMul({ kind: 'brute', _artScale: 1.5 }), 1);
  });
  test('enemy AI: scuttle has a real pause; anchored plant holds firing distance', () => {
    const s = scene(), c = foe('spider'), row = EnemyRoster.get('spider');
    rosterEnemyMove(s, c, row, 10000, 20, 0, false, false, null, 0.1);
    const x = c.x, y = c.y;
    rosterEnemyMove(s, c, row, 11300, 20, 0, false, false, null, 0.1);
    assert.eq(c.x, x); assert.eq(c.y, y);
    const p = foe('plant');
    rosterEnemyMove(s, p, EnemyRoster.get('plant'), 10000, 14, 0, false, false, null, 0.1);
    assert.eq(p.x, 0); assert.eq(p.y, 0);
  });
  test('enemy AI: dungeon ghost count changes at four and visual size at six', () => {
    assert.eq(EnemyRoster.ghostProfile(2).groupMax, 3);
    assert.eq(EnemyRoster.ghostProfile(4).groupMax, 4);
    assert.eq(EnemyRoster.ghostProfile(4).nearMax, 8);
    assert.eq(EnemyRoster.ghostProfile(4).sizeMultiplier, 1);
    assert.eq(EnemyRoster.ghostProfile(6).sizeMultiplier, 1.5);
    assert.eq(EnemyRoster.ghostProfile(20).sizeMultiplier, 1.5);
  });
  test('enemy AI: purple slime keeps its poison condition and attack animation', () => {
    const s = scene(), c = foe('purple_slime'), row = EnemyRoster.get('purple_slime');
    const conditions = [];
    s._applyCondition = condition => conditions.push(condition);
    rosterEnemyAttack(s, c, row, 10000, 1, 0, false, 0.1);
    rosterEnemyAttack(s, c, row, 10000 + row.windupSeconds * 1000, 1, 0, false, 0.1);
    assert.eq(conditions.join(','), 'poison');
    assert.truthy(c._attackUntil > c._attackT0);
  });

  test('enemy AI: rooted plants never move when idle, too near, too far, warded or returning', () => {
    for (const kind of ['plant', 'bone_plant', 'giant_plant', 'copper_plant']) {
      const row = EnemyRoster.get(kind);
      for (const [px, inactive, routed, state] of [[1,false,false,null], [40,false,false,null],
        [14,true,false,null], [1,false,true,null], [14,false,false,'return']]) {
        const c = foe(kind); c.seatX = 10; c.seatY = 10;
        rosterEnemyMove(scene(), c, row, 10000, px, 0, inactive, routed, state, 1);
        assert.eq(c.x, 0); assert.eq(c.y, 0);
      }
    }
  });
  test('enemy AI: surface buildings cancel a plant wind-up even when cave collision is clear', () => {
    const s = scene(), c = foe('plant'), row = EnemyRoster.get('plant');
    rosterEnemyAttack(s, c, row, 10000, 14, 0, false, 0.1);
    s.cellAt = x => ({loaded:true, type: x > 3 && x < 10 ? WorldGen.T.BUILDING : WorldGen.T.CAVE_FLOOR});
    rosterEnemyAttack(s, c, row, 11000, 14, 0, false, 0.1);
    assert.eq(s._shots.length, 0);
    assert.eq(c._attackWindupUntil, null);
  });
  test('enemy AI: demon area locks its tell and can be dodged', () => {
    const row = EnemyRoster.get('purple_demon');
    for (const dodge of [false, true]) {
      const s = scene(), c = foe(row.id);
      rosterEnemyAttack(s, c, row, 10000, 14, 0, false, 0.1);
      assert.eq(c._attackAim.x, 14);
      rosterEnemyAttack(s, c, row, 10000 + row.windupSeconds * 1000,
        dodge ? 0 : 14, dodge ? 14 : 0, false, 0.1);
      if (dodge) assert.eq(s.save.energy, 100); else assert.lt(s.save.energy, 100);
    }
  });
  test('enemy AI: breath has a committed direction and cover blocks damage', () => {
    const row = EnemyRoster.get('red_dragon');
    for (const avoid of ['side', 'wall', 'none']) {
      const s = scene(), c = foe(row.id);
      rosterEnemyAttack(s, c, row, 10000, 14, 0, false, 0.1);
      if (avoid === 'wall') s._cellBlocked = x => x > 3 && x < 10;
      rosterEnemyAttack(s, c, row, 10000 + row.windupSeconds * 1000,
        avoid === 'side' ? 0 : 14, avoid === 'side' ? 14 : 0, false, 0.1);
      if (avoid === 'none') assert.lt(s.save.energy, 100); else assert.eq(s.save.energy, 100);
    }
  });
  test('enemy AI: minotaur commits before charging and recovers on wall collision', () => {
    const row = EnemyRoster.get('minotaur'), s = scene(), c = foe(row.id);
    rosterEnemyMove(s,c,row,10000,14,0,false,false,null,0.1);
    assert.eq(c._lungeAngle, 0);
    rosterEnemyMove(s,c,row,11200,0,14,false,false,null,0.1);
    assert.eq(c._lungeAngle, 0);
    s._cellBlocked = x => x >= 0.1;
    rosterEnemyMove(s,c,row,11300,0,14,false,false,null,0.1);
    assert.eq(c._lungeUntil, null);
    assert.gt(c._lungeRecoverUntil, 11300);
    assert.eq(c.y,0);
  });
  test('enemy AI: a boar hurts only by running into you mid-charge, and stands still between charges', () => {
    const row = EnemyRoster.get('boar'), m = row.movement, s = scene(), c = foe(row.id);
    assert.truthy(m.pattern === 'lunge_recover' && m.chargeOnly, 'the minotaur charge, with no blow of its own');
    // Adjacent but not charging: no bite.
    rosterEnemyAttack(s, c, row, 10000, 3.5, 0, false, 0.1);
    assert.eq(s.save.energy, 100, 'no hit outside a charge');
    rosterEnemyMove(s, c, row, 10000, 3.5, 0, false, false, null, 0.1);   // tell
    assert.eq(c.x, 0, 'winds up in place');
    const go = 10000 + m.lungeWindupSeconds * 1000;
    rosterEnemyMove(s, c, row, go, 3.5, 0, false, false, null, 0.1);      // commit
    rosterEnemyMove(s, c, row, go + 100, 3.5, 0, false, false, null, 0.1);
    assert.inRange(c.x, m.lungeSpeedMetersPerSecond * 0.1 - 1e-9, m.lungeSpeedMetersPerSecond * 0.1 + 1e-9, 'charges at its lunge speed');
    rosterEnemyAttack(s, c, row, go + 100, 3.5, 0, false, 0.1);
    assert.eq(s.save.energy, 100 - row.dmg, 'the collision lands');
    rosterEnemyAttack(s, c, row, go + 200, 3.5, 0, false, 0.1);
    assert.eq(s.save.energy, 100 - row.dmg, 'once a charge');
    // After the charge and its recovery, it waits out the cooldown in place.
    const after = go + m.lungeSeconds * 1000 + 50;
    rosterEnemyMove(s, c, row, after, 20, 0, false, false, null, 0.1);
    const rested = after + m.lungeWindupSeconds * 1000 + 50, x = c.x;
    rosterEnemyMove(s, c, row, rested, 20, 0, false, false, null, 1);
    rosterEnemyMove(s, c, row, rested + 1000, 20, 0, false, false, null, 1);
    assert.eq(c.x, x, 'pauses instead of walking at the player');
    assert.lt(rested + 1000, c._lungeNextT, 'still inside the cooldown');
  });
  test('enemy AI: crab returns to its territory and stops attacking beyond it', () => {
    const row=EnemyRoster.get('giant_crab'), s=scene(), c=foe(row.id,7,0);
    c.homeX=0;c.homeY=0;
    rosterEnemyAttack(s,c,row,10000,28,0,false,0.1);
    assert.eq(c._attackWindupUntil,null);
    rosterEnemyMove(s,c,row,10000,28,0,false,false,null,1);
    assert.lt(c.x,7); assert.eq(c.y,0);
  });
  test('enemy AI: pirate gunner remains still while reloading after a shot', () => {
    const row=EnemyRoster.get('pirate_gunner'), s=scene(), c=foe(row.id);
    rosterEnemyAttack(s,c,row,10000,14,0,false,0.1);
    const fired=10000+row.windupSeconds*1000;
    rosterEnemyAttack(s,c,row,fired,14,0,false,0.1);
    assert.eq(s._shots.length,1);
    rosterEnemyMove(s,c,row,fired+100,7,0,false,false,null,1);
    assert.eq(c.x,0);assert.eq(c.y,0);
  });
  test('enemy AI: damage interrupts a necromancer summon and does not restart it immediately', () => {
    const row=EnemyRoster.get('necromancer'), s=scene(), c=foe(row.id);
    assert.truthy(enemySupportTick(s,c,row,10000,true));
    c._lastDamagedT=12345;
    assert.falsy(enemySupportTick(s,c,row,10500,true));
    assert.eq(c._abilityWindupUntil,null);
    assert.falsy(enemySupportTick(s,c,row,11500,true));
  });
  test('enemy AI: hidden players do not awaken finite memorial ghosts', () => {
    const s=scene(), c=foe('ghost'); c.proximityCells=4;
    assert.eq(ghostTick(s,c,10000,7,0,true,false,0.01),null);
    assert.falsy(c._awakened);
    assert.eq(ghostTick(s,c,20000,35,0,false,false,0.01),null);
    assert.falsy(c._awakened);
  });
  test('enemy AI: projectile collision receives source identity for own-keep exceptions', () => {
    const c=foe('pirate_gunner'), s=scene(), row=EnemyRoster.get(c.kind);
    rosterEnemyAttack(s,c,row,10000,14,0,false,0.1);
    rosterEnemyAttack(s,c,row,10000+row.windupSeconds*1000,14,0,false,0.1);
    let observed=null;
    Combat.stepShots(s._shots,1,[],1,()=>{}, {cellM:7,blocked:(x,y,shot)=>{observed=shot;return true;}});
    assert.eq(observed._sourceGuard,c);
  });

  test('enemy AI: shaman heals one injured ally, capped at max HP, and cannot heal through cover', () => {
    const s=scene(), c=foe('orc_shaman',14,14), ally=foe('orc',21,14);
    Object.assign(s,{startWorldM:{x:0,y:0},originPx:{x:0,y:0},mPerPx:7,cellsPerTile:WorldGen.TILE_PX});
    const row=EnemyRoster.get(c.kind), previous=WorldGen.forEachItemNear;
    ally._hp=Combat.maxHp(ally)-1;
    WorldGen.forEachItemNear=(what,tx,ty,fn)=>[c,ally].forEach(fn);
    try {
      assert.truthy(enemySupportTick(s,c,row,10000,true));
      enemySupportTick(s,c,row,11200,true);
      assert.eq(Combat.hp(ally),Combat.maxHp(ally));
      ally._hp-=10;s._cellBlocked=()=>true;
      assert.falsy(enemySupportTick(s,c,row,20000,true));
      assert.eq(Combat.hp(ally),Combat.maxHp(ally)-10);
    } finally { WorldGen.forEachItemNear=previous; }
  });
  test('enemy AI: necromancer has two lifetime summon slots, surviving reload and caught ledger', () => {
    const s=scene(), c=foe('necromancer',14,14), n=WorldGen.TILE_PX;
    Object.assign(s,{startWorldM:{x:0,y:0},originPx:{x:0,y:0},mPerPx:7,cellsPerTile:n});
    const key=WorldGen.tileKey(0,0), old=WorldGen.tileCache.get(key), previous=WorldGen.forEachItemNear;
    const entry={cellsPerEdge:n,grid:new Uint8Array(n*n).fill(WorldGen.T.CAVE_FLOOR),
      creatures:[c],_spawnOpts:{}};
    WorldGen.tileCache.set(key,entry);
    WorldGen.forEachItemNear=(what,tx,ty,fn)=>entry.creatures.forEach(fn);
    try {
      const a=EnemyRoster.get(c.kind).ability;
      assert.truthy(enemySummon(s,c,a));
      assert.truthy(enemySummon(s,c,a));
      assert.falsy(enemySummon(s,c,a));
      assert.eq(entry.creatures.length,3);
      s.save.caught=entry.creatures.slice(1).map(child=>child.id);
      entry.creatures=[c];
      const reloaded={...c};
      assert.falsy(enemySummon(s,reloaded,a));
      assert.eq(entry.creatures.length,1);
    } finally {
      WorldGen.forEachItemNear=previous;
      if(old) WorldGen.tileCache.set(key,old); else WorldGen.tileCache.delete(key);
    }
  });
  test('enemy AI: a summon inherits its master\'s garrison, ground and hunt — the one list a split twin reads', () => {
    const s=scene(), c=foe('necromancer',14,14), n=WorldGen.TILE_PX;
    Object.assign(s,{startWorldM:{x:0,y:0},originPx:{x:0,y:0},mPerPx:7,cellsPerTile:n});
    Object.assign(c, { lair: 'ruin', aggroCells: 3, homeX: 14, homeY: 14, _surfaceSpawn: { x: 14, y: 14, tx: 0, ty: 0, cx: 2, cy: 2 },
      habitat: 'crypt', zoneVariant: 'tar', _hunting: true });
    const key=WorldGen.tileKey(0,0), old=WorldGen.tileCache.get(key), previous=WorldGen.forEachItemNear;
    const entry={cellsPerEdge:n,grid:new Uint8Array(n*n).fill(WorldGen.T.CAVE_FLOOR),creatures:[c],_spawnOpts:{}};
    WorldGen.tileCache.set(key,entry);
    WorldGen.forEachItemNear=(what,tx,ty,fn)=>entry.creatures.forEach(fn);
    try {
      assert.truthy(enemySummon(s,c,EnemyRoster.get(c.kind).ability));
      const child = entry.creatures[1];
      for (const key of garrisonInherit()) assert.eq(child[key], c[key], `${key} inherited`);
      assert.includes(garrisonInherit(), '_surfaceSpawn'); assert.includes(garrisonInherit(), 'habitat');
      assert.includes(garrisonInherit(), 'zoneVariant'); assert.includes(garrisonInherit(), '_hunting');
      if (typeof Lairs !== 'undefined' && Lairs.GARRISON_INHERIT) assert.eq(garrisonInherit(), Lairs.GARRISON_INHERIT, 'lairs.js owns the list');
    } finally {
      WorldGen.forEachItemNear=previous;
      if(old) WorldGen.tileCache.set(key,old); else WorldGen.tileCache.delete(key);
    }
  });
  test('enemy AI: summons refuse the shared occupied spawn gate', () => {
    const s=scene(),c=foe('necromancer',14,14),n=WorldGen.TILE_PX;
    Object.assign(s,{startWorldM:{x:0,y:0},originPx:{x:0,y:0},mPerPx:7,cellsPerTile:n});
    const key=WorldGen.tileKey(0,0),old=WorldGen.tileCache.get(key),previous=WorldGen.forEachItemNear;
    const entry={cellsPerEdge:n,grid:new Uint8Array(n*n).fill(WorldGen.T.CAVE_FLOOR),
      creatures:[c],_spawnOpts:{occupied:new Set(Array.from({length:n*n},(_,i)=>i))}};
    WorldGen.tileCache.set(key,entry);WorldGen.forEachItemNear=(what,tx,ty,fn)=>entry.creatures.forEach(fn);
    try { assert.falsy(enemySummon(s,c,EnemyRoster.get(c.kind).ability)); }
    finally { WorldGen.forEachItemNear=previous;if(old)WorldGen.tileCache.set(key,old);else WorldGen.tileCache.delete(key); }
  });

  test('enemy AI: bomb fuse is avoidable and spending the carrier records its finite identity', () => {
    const row=EnemyRoster.get('bomb_goblin'),s=scene(),c=foe(row.id);
    rosterEnemyAttack(s,c,row,10000,7,0,false,0.1);
    assert.gt(c._attackWindupUntil,10000);
    rosterEnemyAttack(s,c,row,10000+row.windupSeconds*1000,21,0,false,0.1);
    assert.eq(s.save.energy,100);
    assert.includes(s.save.caught,c.id);
  });
  test('enemy AI: own keep permits guard fire but a different building blocks it', () => {
    const s=scene(),c=foe('pirate_gunner');
    s.cellAt=()=>({loaded:true,type:WorldGen.T.BUILDING});
    Object.assign(c,{lair:'fort',lairX:0,lairY:0,keepHW:7,keepHH:7});
    assert.falsy(enemySightBlocked(s,c,3,0));
    assert.truthy(enemySightBlocked(s,c,14,0));
  });

  test('enemy AI: a telegraphed charge hits once on contact without stopping for a second tell', () => {
    const row=EnemyRoster.get('minotaur'),s=scene(),c=foe(row.id);
    rosterEnemyMove(s,c,row,10000,7,0,false,false,null,0.1);
    rosterEnemyAttack(s,c,row,10500,1,0,false,0.1);
    assert.eq(s.save.energy,100);
    rosterEnemyMove(s,c,row,11200,7,0,false,false,null,0.1);
    rosterEnemyAttack(s,c,row,11300,1,0,false,0.1);
    const after=s.save.energy;assert.lt(after,100);
    assert.eq(c._attackWindupUntil,null);
    rosterEnemyAttack(s,c,row,11400,1,0,false,0.1);
    assert.eq(s.save.energy,after);
  });

})();
