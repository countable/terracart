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
  test('partial cover hides the target fully past hearing; within two cells a foe hears it', () => {
    const s = scene(), c = { kind: 'goblin', x: 0, y: 0 };
    withCover(0, () => assert.truthy(Combat.seesTarget(s, c, 42, 0, 6)));
    withCover(1, () => {
      assert.truthy(Combat.seesTarget(s, c, 14, 0, 6), 'heard at two cells, the boundary included');
      assert.falsy(Combat.seesTarget(s, c, 14.01, 0, 6));
      assert.falsy(Combat.seesTarget(s, c, 28, 0, 6), 'no longer seen through a tree at four cells');
      assert.falsy(Combat.seesTarget(s, c, 7.01, 0, 1), 'hearing never outranges the sight asked for');
    });
  });
  test('a foe that loses sight walks to its last sighting, then gives up', () => {
    const s = scene(), row = EnemyRoster.get('goblin');
    s.cellAt = () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR });
    s.save.caught = [];
    const c = { kind: 'goblin', id: 'g_seen', x: 0, y: 0 };
    withCover(0, () => rosterEnemyMove(s, c, row, 1000, 21, 0, false, false, null, 0.01));
    assert.truthy(c._lastSeen && c._lastSeen.x === 21, 'the look is remembered');
    const before = c.x;
    withCover(2, () => rosterEnemyMove(s, c, row, 1100, 0, 40, false, false, null, 0.1));
    assert.gt(c.x, before, 'it heads for where it saw the player, not where they are');
    withCover(2, () => rosterEnemyMove(s, c, row, 1000 + 9000, 0, 40, false, false, null, 0.1));
    assert.eq(c._lastSeen, null, 'past LAST_SEEN_MS the trail is dropped');
  });
  test('an unsprung ambusher notices only within hearing, then springs', () => {
    const s = scene(), row = EnemyRoster.get('thief');
    assert.truthy(row.ambush, 'the thief is an ambusher');
    assert.truthy(row.surface.biomes.includes('COMMERCIAL'), 'and walks commercial ground');
    const c = { kind: 'thief', id: 'amb', x: 0, y: 0 };
    withCover(0, () => rosterEnemyMove(s, c, row, 1000, 28, 0, false, false, null, 0.01));
    assert.falsy(c._sprung, 'four cells off in the open, it waits');
    withCover(0, () => rosterEnemyMove(s, c, row, 1100, c.x + 13, c.y, false, false, null, 0.01));
    assert.truthy(c._sprung, 'two cells off, it springs');
    const guard = { kind: 'goblin_runt', id: 'hg', ambush: true, lair: 'l', x: 0, y: 0, seatX: 0, seatY: 0,
      lairX: 0, lairY: 0, lairR: 0, aggroCells: 6 };
    withCover(0, () => assert.eq(enemyGuardState(s, guard, { x: 28, y: 0 }, true), 'hold', 'a hedge ambusher ignores its ring'));
    withCover(0, () => assert.eq(enemyGuardState(s, guard, { x: 14, y: 0 }, true), 'hunt', 'but not a body within hearing'));
    assert.eq(Lairs.GROUPS.street_hedgerow.members[0].ambush, true, 'the hedged lane fields ambushers');
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
