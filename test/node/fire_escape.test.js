(function () {
  function scene() {
    const s = { cellM: 1, depth: 2, cellsPerTile: WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, mPerPx: 1,
      save: { groundFire: {} }, cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false,
      _groundFireAtWorld(x, y) { return this.save.groundFire[GroundFire.key(2, Math.floor(x), Math.floor(y))]; },
      _groundFireFuel: () => [] };
    return s;
  }
  const row = () => EnemyRoster.get('zombie');
  // Burning, exposed (so the clock never runs out under the test's short ticks).
  const foe = () => ({ id: 'fire_escape_zombie', kind: 'zombie', x: 0.5, y: 0.5,
    _burnState: { remainingMs: 60000, nextTickMs: 1000 }, _burnAtT: 0, _burnExposed: true });
  function light(s, x, y) { GroundFire.ignite(s.save, 2, x, y, Date.now() - 1, () => 1); }

  test('fire escape: ordinary movement cannot enter or hop across a burning cell', () => {
    const s = scene(), c = foe(); light(s, 1, 0);
    assert.falsy(fireStepAllowed(s, c, 1.5, 0.5));
    assert.falsy(fireStepAllowed(s, c, 2.5, 0.5), 'safe endpoint cannot skip over fire');
    enemySweep(s, c, row(), 2.5, 0.5, 0);
    assert.lt(c.x, 1, 'sweep stops before the burning tile');
  });
  test('fire escape: crosses fuel to reach nonflammable ground', () => {
    const s = scene(), c = foe();
    s._groundFireFuel = p => p.cellIX < 3 ? [{ kind: 'tree' }] : [];
    s.cellAt = (x, y) => ({ loaded: y >= 0 && y < 1 && x >= 0, type: WorldGen.T.CAVE_FLOOR });
    const route = enemyFireEscapeRoute(s, c, row());
    assert.eq(route.length, 3);
    assert.eq(route[2].x, 3.5);
    for (let i = 0; i < 60; i++) assert.truthy(enemyFireEscapeTick(s, c, row(), i * 100, 0.1));
    assert.gte(c.x, 3, 'a burning foe flees along the route');
    assert.lt(c.x, 4, 'it holds on safe ground while burning');
  });
  test('fire escape: enemy in the middle of a 3x3 fire can leave', () => {
    const s = scene(), c = foe();
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) light(s, x, y);
    const route = enemyFireEscapeRoute(s, c, row());
    assert.eq(route.length, 2);
    for (let i = 0; i < 60; i++) enemyFireEscapeTick(s, c, row(), i * 100, 0.1);
    assert.truthy(enemyFireSafe(s, c.x, c.y));
    light(s, 3, 0);
    assert.falsy(fireStepAllowed(s, { x: 1.5, y: 0.5 }, 3.5, 0.5, true),
      'escape must not reenter flames after reaching dry ground');
  });
  test('fire escape: chooses dry detour, respects walls, and stops searching if trapped', () => {
    const s = scene(), c = foe(); light(s, 0, 0); light(s, 1, 0);
    s._groundFireFuel = p => p.cellIX === 2 && p.cellIY === 0 ? [] : [{ kind: 'tree' }];
    const route = enemyFireEscapeRoute(s, c, row());
    assert.gt(route.length, 2, 'takes a longer dry route instead of crossing extra fire');
    for (const p of route) assert.falsy(GroundFire.active(s._groundFireAtWorld(p.x, p.y), Date.now()));
    s._cellBlocked = (x, y) => Math.floor(x) !== 0 || Math.floor(y) !== 0;
    assert.eq(enemyFireEscapeRoute(s, c, row()).length, 0);
  });
  test('fire escape: burned ground under a surviving tree is safe and extinguished enemies resume', () => {
    const s = scene(), c = foe(); light(s, 0, 0);
    s._groundFireAtWorld(c.x, c.y).extinguished = true;
    s._groundFireFuel = () => [{ kind: 'tree' }];
    assert.truthy(enemyFireSafe(s, c.x, c.y));
    assert.truthy(enemyFireEscapeTick(s, c, row(), 100, 0.1));
    assert.eq(c.x, 0.5);
    PotionEffects.extinguish(c);
    assert.falsy(enemyFireEscapeTick(s, c, row(), 200, 0.1));
  });
})();
