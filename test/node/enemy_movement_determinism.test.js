// Exercise the shipped movers with two independent copies of a world enemy.
(function () {
  const scene = () => ({ cellM: 7, depth: 2, save: { energy: 100, armor: {} },
    cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
    _cellBlocked: () => false, _nearAny: () => false });
  const foe = (kind, id = 'mon_shared_2_1_1_0') => ({ kind, id, _sharedId: true, x: 0, y: 0 });
  const same = (a, b) => assert.eq(JSON.stringify(a), JSON.stringify(b));
  function move(s, c, now, px = 200, inactive = false, state = null) {
    rosterEnemyMove(s, c, EnemyRoster.get(c.kind), now, px, 0, inactive, false, state, 0.1);
  }
  test('shared roster wander agrees despite global RNG noise and other enemies interleaving', () => {
    const a = foe('goblin'), b = foe('goblin'), other = foe('goblin', 'mon_other');
    const sa = scene(), sb = scene(), old = Math.random;
    try {
      for (let t = 0; t <= 12000; t += 100) {
        Math.random = () => 0.01; move(sa, a, t);
        Math.random = () => 0.99; move(sb, other, t); move(sb, b, t);
        same(a, b);
      }
      assert.gt(a._movementDecisions.idle, 3);
      assert.truthy(a._idleAngle !== other._idleAngle, 'different enemy IDs choose different headings');
    } finally { Math.random = old; }
  });
  test('shared movement streams isolate idle choices from retreat and roadside decisions', () => {
    const a = foe('goblin'), b = foe('goblin');
    monsterRout(a, 1000, 7);
    for (let n = 0; n < 20; n++) enemyMovementRandom(a, 'roadside');
    move(scene(), a, 2000); move(scene(), b, 2000);
    assert.eq(a._idleAngle, b._idleAngle);
    assert.eq(a.x, b.x); assert.eq(a.y, b.y);
  });
  test('vision and guard return boundaries consume no idle decisions until wandering resumes', () => {
    const a = foe('goblin'), b = foe('goblin'), sa = scene(), sb = scene();
    for (const c of [a, b]) { c.seatX = 0; c.seatY = 0; }
    move(sa, a, 0); move(sb, b, 0);
    const first = a._idleAngle;
    for (let t = 100; t < 3000; t += 100) {
      move(sa, a, t, 7); move(sb, b, t, 7);
    }
    move(sa, a, 3000, 200, true, 'return'); move(sb, b, 3000, 200, true, 'return');
    assert.eq(a._movementDecisions.idle, 1, 'pursuit and returning do not spend idle rolls');
    // Sim-culling skips these calls entirely; elapsed clock time is not a draw count.
    move(sa, a, 60000, 200, true); move(sb, b, 60000, 200, true);
    same(a, b); assert.eq(a._movementDecisions.idle, 2);
    assert.truthy(a._idleAngle !== first);
  });
  test('shared foes choose the same obstacle avoidance side without spending per-frame rolls', () => {
    const a = foe('goblin'), b = foe('goblin'), sa = scene(), sb = scene(), old = Math.random;
    // The direct eastward approach is blocked, with room to slide north/south.
    sa._cellBlocked = sb._cellBlocked = (x, y) => x > 0.01 && Math.abs(y) < 0.5;
    try {
      Math.random = () => 0; move(sa, a, 0, 14);
      Math.random = () => 0.999; move(sb, b, 0, 14);
      same(a, b); assert.eq(a._movementDecisions.avoidance, 1);
      assert.truthy(Math.abs(a.y) > 0, 'the obstacle forces a lateral step');
      for (let t = 100; t <= 2000; t += 100) { move(sa, a, t, 14); move(sb, b, t, 14); }
      same(a, b); assert.eq(a._movementDecisions.avoidance, 1);
    } finally { Math.random = old; }
  });
  test('shared bat flights and pauses agree under unrelated RNG noise', () => {
    const a = foe('bat'), b = foe('bat'), sa = scene(), sb = scene(), old = Math.random;
    try {
      for (let t = 0; t <= 15000; t += 100) {
        Math.random = () => 0; move(sa, a, t, 14);
        Math.random = () => 0.999; move(sb, b, t, 14);
        same(a, b);
      }
      assert.gt(a._movementDecisions['bat-angle'], 2);
      assert.gt(a._movementDecisions['bat-pause'], 1);
    } finally { Math.random = old; }
  });
  test('shared burrow sites and timers agree independently of global randomness', () => {
    const a = foe('wurm'), b = foe('wurm'), row = EnemyRoster.get('wurm'), old = Math.random;
    a.burrowCells = [{ x: 7, y: 0 }, { x: 0, y: 7 }, { x: -7, y: 0 }];
    b.burrowCells = a.burrowCells.map(p => ({ ...p }));
    try {
      for (let t = 0; t < 60000; t += 250) {
        Math.random = () => 0.01; enemyBurrowTick(scene(), a, row, t);
        Math.random = () => 0.99; enemyBurrowTick(scene(), b, row, t);
        same(a, b);
      }
      assert.gt(a._movementDecisions['burrow-seat'], 1);
    } finally { Math.random = old; }
  });
  test('private creatures keep their existing random movement and do not acquire shared counters', () => {
    const c = { id: 'private', kind: 'goblin', x: 0, y: 0 }, old = Math.random;
    try {
      Math.random = () => 0.25; move(scene(), c, 0);
      assert.eq(c._idleAngle, Math.PI / 2); assert.falsy(c._movementDecisions);
    } finally { Math.random = old; }
  });
})();
