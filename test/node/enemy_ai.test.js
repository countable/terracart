// Execute the same helpers the live wander loop calls, with terrain and the
// energy writer stubbed; no alternate movement or damage implementation.
(function () {
  function scene(cellM = 7) {
    return { cellM, depth: 2, save: { energy: 100, armor: {} },
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false, _shots: [],
      _losePlayerEnergy(n) { this.save.energy -= n; return n; } };
  }
  function foe(kind, x = 0, y = 0) { return { kind, id: `ai_${kind}`, x, y }; }

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
  test('enemy AI: swept movement stops at a wall even with a clear endpoint', () => {
    const s = scene(), c = foe('bat'), row = EnemyRoster.get('bat');
    s._cellBlocked = x => x >= 3 && x <= 5;
    assert.falsy(enemySweep(s, c, row, 8, 0));
    assert.lt(c.x, 3);
  });
  test('enemy AI: crow-eased bat flight never exceeds declared peak metres/second', () => {
    for (const kind of ['bat', 'vampire_bat', 'mini_vampire_bat']) {
      for (const cellM of [5, 10]) {
        const s = scene(cellM), c = foe(kind), row = EnemyRoster.get(kind);
        assert.lte(row.movement.speedMetersPerSecond, 6);
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

})();
