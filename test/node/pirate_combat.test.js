// Exercise the shipping combat predicates, AI, and projectile impact gate.
(function () {
  const kinds = ['pirate_grunt', 'pirate_gunner', 'pirate_captain'];
  function foe(kind, extra = {}) { return { id: 'peace_' + kind, kind, x: 0, y: 0, ...extra }; }
  function scene() {
    return { cellM: 7, depth: 2, save: { energy: 100, armor: {} },
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false, _shots: [],
      _losePlayerEnergy(n) { this.save.energy -= n; return n; } };
  }

  test('pirate peace: every pirate is neutral until the exact expiry, without becoming an ally', () => {
    for (const kind of kinds) {
      const c = foe(kind, { _piratePeaceUntil: 2000 });
      assert.truthy(Combat.monster(kind).pirate);
      assert.truthy(Combat.isPacified(c, 1999));
      assert.falsy(Combat.isEnemy(c, 1999));
      assert.falsy(Combat.isCharmed(c, 1999), 'payment never recruits a pirate');
      assert.falsy(Combat.isPacified(c, 2000));
      assert.truthy(Combat.isEnemy(c, 2000), 'hostility resumes at expiry');
      c._pirateParleyPending = true;
      assert.truthy(Combat.isPacified(c, 2000), 'the transaction pauses combat');
      assert.falsy(Combat.isEnemy(c, 2000));
    }
    assert.falsy(Combat.isPacified(null));
    const goblin = foe('goblin', { _piratePeaceUntil: 2000, _pirateParleyPending: true });
    assert.falsy(Combat.isPacified(goblin, 1000), 'peace applies only to pirates');
    assert.truthy(Combat.isEnemy(goblin, 1000));
  });

  test('pirate peace: negotiating and paid pirates neither attack nor advance attack cadence', () => {
    for (const kind of kinds) for (const status of [
      { _piratePeaceUntil: Date.now() + 60000 }, { _pirateParleyPending: true },
    ]) {
      const s = scene(), c = foe(kind, { ...status, _attackNextT: 9000 });
      const row = EnemyRoster.get(kind);
      for (const now of [10000, 11000, 20000]) rosterEnemyAttack(s, c, row, now, 1, 0, false, 0.1);
      assert.eq(s.save.energy, 100, kind + ' causes no melee damage');
      assert.eq(s._shots.length, 0, kind + ' fires no shots');
      assert.eq(c._attackNextT, 9000, 'suppression does not spend an attack');
      assert.falsy(c._attackWindupUntil, 'suppression starts no windup');
    }
  });

  test('pirate peace: payment suppresses a gunner shot already winding up', () => {
    const s = scene(), c = foe('pirate_gunner'), row = EnemyRoster.get(c.kind);
    rosterEnemyAttack(s, c, row, 10000, 14, 0, false, 0.1);
    assert.truthy(c._attackWindupUntil);
    c._piratePeaceUntil = Date.now() + 60000;
    rosterEnemyAttack(s, c, row, 11000, 14, 0, false, 0.1);
    assert.eq(s._shots.length, 0);
  });

  test('pirate peace: allied creatures do not attack paid pirates', () => {
    const s = scene(), c = foe('goblin', { _charmUntil: Date.now() + 60000 });
    const target = foe('pirate_grunt', { _piratePeaceUntil: Date.now() + 60000 });
    s._damageEnemy = () => { throw new Error('ally attacked a neutral pirate'); };
    for (const now of [10000, 11000, 20000]) {
      rosterEnemyAttack(s, c, EnemyRoster.get(c.kind), now, 1, 0, false, 0.1, null, target);
    }
    assert.falsy(c._attackWindupUntil);
  });

  test('pirate peace: negotiating holds position and paid pirates wander instead of pursuing', () => {
    const s = scene(), c = foe('pirate_grunt', { _pirateParleyPending: true });
    const row = EnemyRoster.get(c.kind);
    rosterEnemyMove(s, c, row, 10000, 28, 0, false, false, null, 1);
    assert.eq(c.x, 0); assert.eq(c.y, 0);
    c._pirateParleyPending = false;
    c._piratePeaceUntil = Date.now() + 60000;
    c._idleAngle = Math.PI; c._idleTurnT = 20000;
    rosterEnemyMove(s, c, row, 11000, 28, 0, false, false, null, 1);
    assert.lt(c.x, 0, 'follows the idle heading, away from the player');
    c._piratePeaceUntil = 0;
    const before = c.x;
    rosterEnemyMove(s, c, row, 12000, 28, 0, false, false, null, 1);
    assert.gt(c.x, before, 'pursuit resumes after expiry');
  });

  test('pirate peace: airborne shots respect payment at impact in both directions', () => {
    const method = SCENE_SRC.match(/\n  (_shotCanHit\([^\n]*\) \{\n[\s\S]*?\n  \})\n/);
    assert.truthy(method);
    const s = new Function('return ({' + method[1] + '});')();
    const pirate = foe('pirate_gunner'), player = { id: 'player' };
    const bullet = { hostile: true, _sourceGuard: pirate, damage: 10 };
    assert.truthy(s._shotCanHit(player, bullet));
    assert.truthy(s._shotCanHit(pirate, { damage: 10 }));
    for (const status of ['_piratePeaceUntil', '_pirateParleyPending']) {
      pirate[status] = status === '_piratePeaceUntil' ? Date.now() + 60000 : true;
      assert.falsy(s._shotCanHit(player, bullet), 'already airborne bullet cannot hurt player');
      assert.falsy(s._shotCanHit(pirate, { damage: 10 }), 'player shot spares the neutral pirate');
      pirate[status] = 0;
    }
    assert.truthy(s._shotCanHit(player, bullet), 'expired peace restores hostile impacts');
    assert.truthy(s._shotCanHit(pirate, { damage: 10 }));
  });

  function hitScene(money = 20) {
    const s = scene();
    s.save.money = money;
    s.persisted = 0;
    s._flashPlayerHit = () => {};
    s._closeShopOnHit = () => {};
    const methods = ['_losePlayerCoins', '_shotCanHit', '_shotHitsTarget', '_shotHitsPlayer'].map(name => {
      const match = SCENE_SRC.match(new RegExp('\\n  (' + name + '\\([^\\n]*\\) \\{\\n[\\s\\S]*?\\n  \\})\\n'));
      assert.truthy(match, name + ' exists');
      return match[1];
    });
    Object.assign(s, new Function('persistSave', 'return ({' + methods.join(',') + '});')(() => s.persisted++));
    return s;
  }
  function attack(s, c, start, px = 1) {
    const row = EnemyRoster.get(c.kind);
    rosterEnemyAttack(s, c, row, start, px, 0, false, 0.1);
    rosterEnemyAttack(s, c, row, start + row.windupSeconds * 1000, px, 0, false, 0.1);
  }
  function fire(s) {
    const c = foe('pirate_gunner');
    attack(s, c, 10000, 14);
    assert.eq(s._shots.length, 1);
    assert.eq(s._shots[0].projectile, 'bullet');
    assert.eq(s._shots[0]._sourceGuard, c);
    return c;
  }
  function fly(s, player = { id: 'player', x: 14, y: 0 }) {
    for (let i = 0; i < 600 && s._shots.length; i++) {
      s._shots = Combat.stepShots(s._shots, 1 / 60, [], Combat.HIT_RADIUS_CELLS * s.cellM,
        (target, shot) => s._shotHitsTarget(target, shot), {
          cellM: s.cellM, hostileTargets: [player], canHit: (target, shot) => s._shotCanHit(target, shot),
        });
    }
    assert.eq(s._shots.length, 0, 'bullet finishes its flight');
  }

  test('pirate hits: grunt and captain take five coins on every landed melee hit', () => {
    for (const kind of ['pirate_grunt', 'pirate_captain']) {
      const s = hitScene(), c = foe(kind);
      attack(s, c, 10000);
      assert.eq(s.save.money, 15);
      assert.lt(s.save.energy, 100);
      const energy = s.save.energy;
      attack(s, c, 20000);
      assert.eq(s.save.money, 10, 'repeat hits still cost five');
      assert.lt(s.save.energy, energy);
      assert.eq(s.persisted, 2, 'each coin loss is persisted');
      assert.falsy(s.save.thefts, 'pirates never become daily-sated thieves');
    }
  });

  test('pirate hits: small purses clamp to zero and empty purses still take combat damage', () => {
    const s = hitScene(3), c = foe('pirate_grunt');
    attack(s, c, 10000);
    assert.eq(s.save.money, 0);
    const energy = s.save.energy;
    attack(s, c, 20000);
    assert.eq(s.save.money, 0);
    assert.lt(s.save.energy, energy);
    assert.eq(s.persisted, 1, 'empty purse has no coin mutation');
  });

  test('pirate hits: gunner bullets charge five coins only when their flight hits the player', () => {
    const s = hitScene();
    fire(s);
    assert.eq(s.save.money, 20, 'firing itself costs nothing');
    assert.eq(s.save.energy, 100);
    fly(s);
    assert.eq(s.save.money, 15);
    assert.lt(s.save.energy, 100);
    assert.eq(s.persisted, 1);
    assert.falsy(s.save.thefts);
    const miss = hitScene();
    fire(miss); fly(miss, { id: 'player', x: 14, y: 14 });
    assert.eq(miss.save.money, 20, 'dodging the bullet costs nothing');
    assert.eq(miss.save.energy, 100);
  });

  test('pirate hits: truce, negotiation, charm and hits causing no energy loss never take coins', () => {
    for (const status of [
      { _piratePeaceUntil: Date.now() + 60000 }, { _pirateParleyPending: true },
      { _charmUntil: Date.now() + 60000 },
    ]) {
      const s = hitScene(), c = foe('pirate_grunt', status);
      attack(s, c, 10000);
      assert.eq(s.save.money, 20);
      const gun = hitScene(), gunner = fire(gun);
      Object.assign(gunner, status); fly(gun);
      assert.eq(gun.save.money, 20, 'status is rechecked on projectile impact');
    }
    const noLoss = hitScene();
    noLoss._losePlayerEnergy = () => 0;
    attack(noLoss, foe('pirate_grunt'), 10000);
    fire(noLoss); fly(noLoss);
    assert.eq(noLoss.save.money, 20, 'zero actual damage cannot charge coins');
    const downed = hitScene();
    fire(downed); downed.save.energy = 0; fly(downed);
    assert.eq(downed.save.money, 20, 'downed player takes no new charge');
  });

  test('pirate hits: ordinary monster melee and arrows never charge pirate coins', () => {
    const s = hitScene();
    attack(s, foe('goblin'), 10000);
    assert.lt(s.save.energy, 100);
    assert.eq(s.save.money, 20);
    const arrow = Combat.monsterShot(0, 0, 14, 0, s.cellM, 10);
    arrow._sourceGuard = foe('goblin_archer');
    s._shots.push(arrow); fly(s);
    assert.eq(s.save.money, 20);
    assert.eq(s.persisted, 0);
  });
})();
