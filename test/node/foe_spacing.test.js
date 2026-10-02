// Foes keep a little room between them (creature_ai.js FOE_SPACING_CELLS),
// inside their own pace, and the minor streets are no wall to the wild.
(function () {
  function scene() {
    return { cellM: 7, depth: 2, save: { energy: 100, armor: {} },
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false, _shots: [], _foeBodies: [],
      _losePlayerEnergy(n) { this.save.energy -= n; return n; } };
  }
  test('foe spacing: two stacked foes beside the player part to the spacing and no faster than their pace', () => {
    const s = scene(), row = EnemyRoster.get('zombie');
    const a = { kind: 'zombie', id: 'a', x: 7, y: 0 }, b = { kind: 'zombie', id: 'b', x: 7, y: 0 };
    s._foeBodies = [a, b];
    const dt = 1 / 60, pace = row.movement.speedMetersPerSecond * dt;
    for (let f = 0; f < 600; f++) {
      for (const c of [a, b]) {
        const x0 = c.x, y0 = c.y;
        rosterEnemyMove(s, c, row, 1000 + f * 16, 0, 0, false, false, null, dt);
        assert.truthy(Math.hypot(c.x - x0, c.y - y0) <= pace + 1e-9, 'within its pace');
      }
    }
    assert.truthy(Math.hypot(a.x - b.x, a.y - b.y) >= 0.8 * FOE_SPACING_CELLS * s.cellM, 'parted');
    for (const c of [a, b]) assert.truthy(Math.hypot(c.x, c.y) <= 1.2 * s.cellM, 'still at the player');
  });
  test('foe spacing: a lone foe, or one with room, feels no push', () => {
    const s = scene();
    const a = { kind: 'zombie', id: 'a', x: 0, y: 0 }, b = { kind: 'zombie', id: 'b', x: s.cellM, y: 0 };
    s._foeBodies = [a];
    assert.eq(foeSpacingPush(s, a), null);
    s._foeBodies = [a, b];
    assert.eq(foeSpacingPush(s, a), null);
    b.x = 0.3 * s.cellM;
    assert.lt(foeSpacingPush(s, a).x, 0, 'pushed away from its neighbour');
  });
  test('roads: minor streets and paths are crossable; the major tiers are not', () => {
    const T = WorldGen.T;
    assert.falsy(Combat.faunaBlocksCell(T.ROAD), 'minor street');
    assert.falsy(Combat.faunaBlocksCell(T.PATH), 'path');
    assert.truthy(Combat.faunaBlocksCell(T.ROAD_MD), 'medium road');
    assert.truthy(Combat.faunaBlocksCell(T.ROAD_LG), 'large road');
    const s = scene(), row = EnemyRoster.get('zombie'), c = { kind: 'zombie', x: 0, y: 0 };
    s.cellAt = () => ({ loaded: true, type: T.ROAD });
    assert.truthy(enemyCanStep(s, c, row, 3, 0), 'a foe steps onto a side street');
    s.cellAt = () => ({ loaded: true, type: T.ROAD_LG });
    assert.falsy(enemyCanStep(s, c, row, 3, 0), 'never onto a major road');
  });
})();
