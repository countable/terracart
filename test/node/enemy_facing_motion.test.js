// Facing follows accepted movement, including collision-clipped sweeps.
(function () {
  // The facing a creature is TURNING to: a new one is pending until it has
  // been wanted for SpriteLayout.CREATURE_FACE_HOLD_MS (the debounce has its
  // own test in enemy_directions); these pin which motion is accepted.
  const heading = c => c._facePendingT != null ? c._facePending : c._facing;
  function scene() {
    return { cellM: 7, depth: 2, save: { energy: 100, armor: {} },
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false, _shots: [],
      _losePlayerEnergy(n) { this.save.energy -= n; return n; } };
  }
  test('enemy facing: partial sweep faces accepted motion; rejected and zero steps preserve it', () => {
    const s = scene(), row = EnemyRoster.get('bat');
    const c = { kind: 'bat', x: 0, y: 0, _facing: 'up' };
    s._cellBlocked = x => x >= 3;
    assert.falsy(enemySweep(s, c, row, 8, 0, 1000));
    assert.gt(c.x, 0);
    assert.lt(c.x, 3);
    assert.eq(heading(c), 'right');
    assert.gt(c._moveUntil, 1000);
    const until = c._moveUntil;
    s._cellBlocked = () => true;
    assert.falsy(enemySweep(s, c, row, c.x, 8, 2000));
    assert.eq(heading(c), 'right', 'rejected vertical motion cannot turn the body');
    assert.eq(c._moveUntil, until, 'rejected step cannot restart walking');
    s._cellBlocked = () => false;
    assert.truthy(enemySweep(s, c, row, c.x, c.y, 3000));
    assert.eq(c._moveUntil, until, 'zero-length step cannot restart walking');
  });
  test('enemy facing: bat flight stamps actual motion, not a selected destination', () => {
    const s = scene(), c = { kind: 'bat', x: 0, y: 0, _facing: 'left',
      _batFlight: { x: 0, y: 0, tx: 0, ty: -4, start: 1000, duration: 1000 } };
    enemyBatMove(s, c, EnemyRoster.get('bat'), 1000, 20, 0);
    assert.eq(heading(c), 'left', 'zero progress retains prior direction');
    enemyBatMove(s, c, EnemyRoster.get('bat'), 1500, 20, 0);
    assert.eq(heading(c), 'up');
    assert.gt(c._moveUntil, 1500);
  });
  test('enemy facing: direct ghost glide faces its accepted displacement and rests when hidden', () => {
    const s = scene(), now = __ghost.GHOST_HOVER_MS + 1000;
    const c = { kind: 'ghost', x: 0, y: 0, _facing: 'left',
      _spawnT: 0, _ghostT: now - 100, _burnT: now };
    __ghostTick(s, c, now, 0, -20, false, false, 0.001);
    assert.eq(heading(c), 'up');
    assert.lt(c.y, 0);
    const until = c._moveUntil;
    __ghostTick(s, c, now + 1, 20, 0, true, false, 0.001);
    assert.eq(heading(c), 'up');
    assert.eq(c._moveUntil, until);
  });
  test('enemy facing: stationary ranged windup faces target without marking movement or tracking hidden targets', () => {
    const s = scene(), c = { kind: 'plant', x: 0, y: 0, _facing: 'down' };
    const row = EnemyRoster.get('plant');
    rosterEnemyAttack(s, c, row, 10000, -7, 0, false, 0.1);
    assert.eq(heading(c), 'left');
    assert.eq(c._moveUntil, undefined);
    rosterEnemyAttack(s, c, row, 10100, 0, -7, true, 0.1);
    assert.eq(heading(c), 'left', 'hidden target cancels windup without turning');
  });
})();
