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

  test('fire slime: accepted cell exits light only departed cells, including long sweeps', () => {
    const s = scene(), c = { kind: 'fire_slime', id: 'fire-trail', x: 0.5, y: 0.5 };
    const row = EnemyRoster.get(c.kind), calls = [];
    s._igniteGroundCell = (cell, now, opts) => {
      calls.push(cell.cellIX);
      return GroundFire.ignite(s.save, 2, cell.cellIX, cell.cellIY, now, () => 0, opts);
    };
    enemySweep(s, c, row, 0.8, 0.5, 0);
    assert.eq(calls.length, 0, 'moving inside one cell leaves no fire');
    enemySweep(s, c, row, 3.5, 0.5, 1);
    assert.eq(calls.join(), '0,1,2', 'every cell exited burns once');
    assert.falsy(s.save.groundFire[GroundFire.key(2, 3, 0)], 'current cell stays clear');
    assert.truthy(fireStepAllowed(s, c, 0.5, 0.5), 'its trail cannot trap it');
    enemySweep(s, c, null, 2.5, 0.5, 2);
    assert.eq(calls.at(-1), 3, 'shared movement without a supplied roster row still leaves fire');
    const before = calls.length;
    s._cellBlocked = () => true;
    enemySweep(s, c, row, 1.5, 0.5, 3);
    assert.eq(calls.length, before, 'refused motion cannot ignite cells');
    s._cellBlocked = () => false;
    const old = s.save.groundFire[GroundFire.key(2, 2, 0)];
    old.until = Date.now() - 1;
    enemySweep(s, c, row, 3.5, 0.5, 4);
    assert.truthy(GroundFire.active(s.save.groundFire[GroundFire.key(2, 2, 0)], Date.now()), 'returning can relight expired fire');
    const normal = { kind: 'slime', id: 'normal', x: 4.5, y: 0.5 };
    const prior = calls.length;
    enemySweep(s, normal, EnemyRoster.get(normal.kind), 5.5, 0.5, 5);
    assert.eq(calls.length, prior, 'ordinary slimes leave no burning ground');
  });

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
  // A lit campfire's hearth is fire for every grounded mover (fireStepAllowed),
  // not only the entry-level kinds its warmth ring turns back (fireAverse).
  function campScene(fires) {
    const s = scene();
    s.save.fires = fires;
    s._nearAny = function (key, x, y, cells) {
      return (this.save[key] || []).some(f => Math.hypot(f.x - x, f.y - y) < cells * this.cellM);
    };
    return s;
  }
  test('campfire hazard: no grounded body walks onto a hearth, and fliers pass over', () => {
    const s = campScene([{ x: 3, y: 0.5 }]);
    for (const c of [foe(), { id: 'g', kind: 'club_goblin', x: 0.5, y: 0.5, lair: 'guard' },
      { id: 'p', kind: 'cat', x: 0.5, y: 0.5, ally: true }]) {
      assert.falsy(fireStepAllowed(s, c, 3, 0.5), c.kind + ' refuses the hearth');
      assert.falsy(fireStepAllowed(s, c, 5.5, 0.5), c.kind + ' cannot hop across it');
      assert.truthy(fireStepAllowed(s, c, 2, 0.5), c.kind + ' may stand beside it');
    }
    assert.falsy(fireAverse({ kind: 'zombie' }, EnemyRoster.get('zombie')), 'a deep kind ignores the warmth ring...');
    assert.truthy(creatureStepRefused(s, foe(), 3, 0.5, { row: row() }), '...but still never steps into the fire');
    const bat = { id: 'b', kind: 'bat', x: 0.5, y: 0.5 };
    assert.truthy(Conditions.flying(bat), 'bats fly');
    assert.truthy(fireStepAllowed(s, bat, 5.5, 0.5), 'a flier passes over');
  });
  test('campfire hazard: a body already in the hearth walks out, never back in', () => {
    const s = campScene([{ x: 0.5, y: 0.5 }]), c = foe();
    assert.truthy(fireStepAllowed(s, c, 2.5, 0.5), 'leaving the fire is allowed');
    assert.falsy(fireStepAllowed(s, { ...c, x: 2.5 }, 0.5, 0.5), 'and re-entering is not');
  });
  test('campfire hazard: a chasing foe jogs around the fire instead of stopping in it', () => {
    const s = campScene([{ x: 1.5, y: 0.5 }]), c = foe();
    enemySweep(s, c, row(), 2.5, 0.5, 0);
    assert.gt(Math.hypot(c.x - 1.5, c.y - 0.5), FIRE_TOUCH_CELLS, 'never ends inside the hearth');
    assert.truthy(Math.abs(c.y - 0.5) > 0.5, `it sidestepped round the hearth (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
  });
})();
