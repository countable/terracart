// Exercise the live AI predicates while varying the shared grid's answer.
(function () {
  function withCover(cover, fn) {
    const ray = Visibility.coverBetween;
    Visibility.coverBetween = () => cover;
    try { fn(); } finally { Visibility.coverBetween = ray; }
  }
  function scene() {
    return { cellM: 7, depth: 2, save: { energy: 100, armor: {} },
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false, _shots: [],
      _losePlayerEnergy(n) { this.save.energy -= n; return n; } };
  }
  test('full cover blocks enemy sight even inside attack range', () => {
    withCover(2, () => {
      const s = scene(), c = { kind: 'gelatinous_cube', id: 'cover_cube', x: 0, y: 0 };
      assert.falsy(Combat.seesTarget(s, c, 1, 0));
      c._attackWindupUntil = 1000;
      rosterEnemyAttack(s, c, EnemyRoster.get(c.kind), 2000, 1, 0, false, 1);
      assert.eq(s.save.energy, 100);
      assert.eq(c._attackWindupUntil, null);
    });
  });
  test('tree cover subtracts exactly two sight cells including the boundary', () => {
    const s = scene(), c = { kind: 'goblin', x: 0, y: 0 };
    withCover(0, () => assert.truthy(Combat.seesTarget(s, c, 42, 0, 6)));
    withCover(1, () => {
      assert.truthy(Combat.seesTarget(s, c, 28, 0, 6));
      assert.falsy(Combat.seesTarget(s, c, 28.01, 0, 6));
      assert.falsy(Combat.seesTarget(s, c, 7, 0, 1));
    });
  });
  test('range rejection avoids a visibility ray', () => {
    const ray = Visibility.coverBetween;
    Visibility.coverBetween = () => { throw new Error('outside range'); };
    try { assert.falsy(Combat.seesTarget(scene(), { x: 0, y: 0 }, 43, 0, 6)); }
    finally { Visibility.coverBetween = ray; }
  });
  test('a guard loses the live target behind full cover and returns home', () => {
    const s = scene(), c = { lair: true, x: 7, y: 0, seatX: 0, seatY: 0,
      lairX: 0, lairY: 0, lairR: 0, aggroCells: 6, _hunting: true };
    withCover(0, () => assert.eq(enemyGuardState(s, c, { x: 21, y: 0 }, true), 'hunt'));
    withCover(2, () => assert.eq(enemyGuardState(s, c, { x: 21, y: 0 }, true), 'return'));
    c._hunting = false;
    withCover(1, () => assert.eq(enemyGuardState(s, c, { x: 35, y: 0 }, true), 'return'));
  });
})();
