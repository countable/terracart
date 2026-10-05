(function () {
  const wall = 1800000000000;
  const foe = (id, kind = 'zombie', x = 0) => ({ id, kind, x, y: 0 });
  function scene(creatures) {
    return Object.assign(new SceneFire(), { cellM: 7, tileEdgeM: 224, startWorldM: {x:0,y:0}, originPx: {x:0,y:0}, mPerPx:7, cellsPerTile:WorldGen.TILE_PX, depth: 2, save: { energy: 100, caught: [], armor: {} },
      cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
      _cellBlocked: () => false, _nearAny: () => false, isUnnoticed: () => false, _shots: [], hits: [],
      _losePlayerEnergy(n) { this.save.energy -= n; return n; },
      _damageEnemy(c, n, source, opts) {
        this.hits.push({ c, n, source }); Combat.damage(c, n, opts); return Combat.hp(c) <= 0;
      } });
  }
  function withClock(fn) {
    const real = Date.now; Date.now = () => wall;
    try { fn(); } finally { Date.now = real; }
  }
  test('flower status: sleep lasts sixty seconds and clears current movement and windup', () => {
    const c = foe('sleep'); c._attackWindupUntil = 100; c._moving = true; c._targetX = 50;
    assert.truthy(Combat.applySleep(c, wall));
    assert.eq(Combat.FLOWER_STATUS_MS, 60000);
    assert.truthy(Combat.isSleeping(c, wall + 59999));
    assert.falsy(Combat.isSleeping(c, wall + 60000));
    assert.eq(c._attackWindupUntil, null); assert.falsy(c._moving); assert.eq(c._targetX, c.x);
    assert.truthy(Combat.isEnemy(c, wall), 'sleep does not change hostility');
  });
  test('flower status: only real damage wakes sleep across ordinary and environmental hits', () => {
    for (const opts of [{}, { bypassArmor: true }]) {
      const c = foe('wake'); Combat.applySleep(c, wall);
      Combat.damage(c, 0, opts); assert.truthy(Combat.isSleeping(c, wall));
      Combat.damage(c, 1, opts); assert.falsy(Combat.isSleeping(c, wall));
    }
  });
  test('flower status: charm preserves enemy kind, excludes pets and autofire, and expires exactly', () => withClock(() => {
    const c = foe('charm', 'slime'); Combat.applyCharm(c, wall);
    assert.truthy(Combat.isEnemyKind(c.kind)); assert.falsy(Combat.isEnemy(c, wall));
    assert.truthy(Combat.isCharmed(c, wall + 59999)); assert.truthy(Combat.isEnemy(c, wall + 60000));
    assert.falsy(huntsPrey('dog', c)); assert.falsy(huntsPrey('spirit_raven', c));
    c.id = 'pest_slime_0_0'; assert.falsy(huntsPrey('spirit_raven', c), 'a charmed pest is still allied');
    assert.falsy(Combat.applyCharm({...foe('released_pet', 'slime'),pet:true}, wall));
    assert.falsy(Combat.applySleep(foe('cow', 'cow'), wall));
    assert.truthy(Combat.isPlayerKill('ally')); assert.falsy(Combat.isPlayerKill('enemy'));
    assert.eq(Combat.shotSource({ _sourceGuard: c }), 'ally');
  }));
  test('flower status: sleeping enemy cannot move or finish a pending attack', () => withClock(() => {
    const c = foe('still'), s = scene(), row = EnemyRoster.get(c.kind);
    Combat.applySleep(c, wall);
    rosterEnemyAttack(s, c, row, 10000, 1, 0, false, 0.1);
    rosterEnemyMove(s, c, row, 10000, 10, 0, false, false, null, 0.1);
    assert.eq(c.x, 0); assert.eq(s.save.energy, 100); assert.eq(s._shots.length, 0);
  }));
  test('flower status: charmed melee hits foes at its normal cadence and enemies retaliate', () => withClock(() => {
    const ally = foe('ally', 'brute'), hostile = foe('hostile', 'brute', 1), s = scene();
    Combat.applyCharm(ally, wall);
    const row = EnemyRoster.get(ally.kind);
    rosterEnemyAttack(s, ally, row, 10000, hostile.x, 0, false, 0.1, null, hostile);
    rosterEnemyAttack(s, ally, row, 10000 + row.windupSeconds * 1000, hostile.x, 0, false, 0.1, null, hostile);
    assert.eq(s.hits.length, 1); assert.eq(s.hits[0].source, 'ally'); assert.eq(s.hits[0].n, row.dmg);
    rosterEnemyAttack(s, ally, row, 10001 + row.windupSeconds * 1000, hostile.x, 0, false, 0.1, null, hostile);
    assert.eq(s.hits.length, 1, 'cooldown does not accelerate allied attacks');
    rosterEnemyAttack(s, hostile, row, 10000, ally.x, 0, false, 0.1, null, ally);
    rosterEnemyAttack(s, hostile, row, 10000 + row.windupSeconds * 1000, ally.x, 0, false, 0.1, null, ally);
    assert.eq(s.hits.length, 2); assert.eq(s.hits[1].source, 'enemy'); assert.eq(s.save.energy, 100);
    rosterEnemyAttack(s, ally, row, 20000, 1, 0, false, 0.1);
    assert.eq(s.save.energy, 100, 'an ally cannot enter the player-damage lane');
  }));
  test('flower status: zombie blight follows charm allegiance without hurting the caster side', () => withClock(() => {
    const ally = foe('ally'), fellow = foe('fellow', 'zombie', 5);
    const hostile = foe('hostile', 'zombie', 5), s = scene();
    Combat.applyCharm(ally, wall); Combat.applyCharm(fellow, wall);
    const row = EnemyRoster.get('zombie');
    rosterEnemyAttack(s, ally, row, 10000, hostile.x, 0, false, 1, null, hostile);
    assert.eq(s.hits.length, 1); assert.eq(s.hits[0].c, hostile);
    assert.eq(s.hits[0].source, 'ally'); assert.eq(s.hits[0].n, row.aura.rawDps);
    rosterEnemyAttack(s, ally, row, 10000, fellow.x, 0, false, 1, null, fellow);
    rosterEnemyAttack(s, ally, row, 10000, 5, 0, false, 1);
    assert.eq(s.hits.length, 1, 'allied blight cannot hurt another ally');
    assert.eq(s.save.energy, 100, 'allied blight cannot hurt the player');
    rosterEnemyAttack(s, hostile, row, 10000, ally.x, 0, false, 1, null, ally);
    assert.eq(s.hits.length, 2); assert.eq(s.hits[1].c, ally);
    assert.eq(s.hits[1].source, 'enemy'); assert.eq(s.hits[1].n, row.aura.rawDps);
  }));
  test('flower status: charmed archers produce allied projectiles with their source identity', () => withClock(() => {
    const c = foe('archer', 'goblin_archer'), target = foe('target', 'zombie', 14), s = scene();
    Combat.applyCharm(c, wall); const row = EnemyRoster.get(c.kind);
    rosterEnemyAttack(s, c, row, 10000, 14, 0, false, 0.1, null, target);
    rosterEnemyAttack(s, c, row, 10000 + row.windupSeconds * 1000, 14, 0, false, 0.1, null, target);
    assert.eq(s._shots.length, 1); assert.falsy(s._shots[0].hostile); assert.eq(s._shots[0]._sourceGuard, c);
    assert.eq(Combat.shotSource(s._shots[0]), 'ally');
  }));
  test('flower status: burning sleepers wake and charm does not prevent lava damage', () => withClock(() => {
    const c = foe('burn'), s = scene(); Combat.applySleep(c, wall); Combat.ignite(c, 1000, 'fire'); c._burnState.remainingMs = 15000;
    assert.truthy(flowerCreatureTick(s, c, 1500, 10, 0, new Set()));
    assert.truthy(Combat.isSleeping(c));
    assert.falsy(flowerCreatureTick(s, c, 2000, 10, 0, new Set()));
    assert.falsy(Combat.isSleeping(c)); assert.eq(s.hits.length, 1);
    Combat.applyCharm(c, wall); s.depth = 0; s.cellAt = () => ({loaded:true, type:WorldGen.T.CAVE_LAVA});
    const realEach = WorldGen.forEachItemNear; WorldGen.forEachItemNear = () => {};
    try { assert.truthy(flowerCreatureTick(s, c, 3000, 10, 0, new Set())); } finally { WorldGen.forEachItemNear = realEach; }
    assert.truthy(s.hits.some(hit => hit.source === 'lava'));
  }));
  test('flower status: faction targeting chooses live opponents, respects walls and charm expiry', () => withClock(() => {
    const ally = foe('ally'), otherAlly = foe('friend', 'zombie', 2), enemy = foe('enemy', 'zombie', 4);
    Combat.applyCharm(ally, wall); Combat.applyCharm(otherAlly, wall);
    const s = scene(), realEach = WorldGen.forEachItemNear;
    WorldGen.forEachItemNear = (kind, tx, ty, cb) => [ally, otherAlly, enemy].forEach(cb);
    try {
      assert.eq(flowerOpponent(s, ally, 100, 0, new Set()), enemy);
      assert.eq(flowerOpponent(s, enemy, 100, 0, new Set()), otherAlly);
      assert.eq(flowerOpponent(s, enemy, 100, 0, new Set(['friend'])), ally);
      s._cellBlocked = () => true; assert.eq(flowerOpponent(s, ally, 100, 0, new Set()), null);
      s._cellBlocked = () => false;
      assert.eq(flowerOpponent(s, enemy, 100, 0, new Set(), wall + 60000), null);
    } finally { WorldGen.forEachItemNear = realEach; }
  }));
  test('flower status: a hostile attacks what is NEAREST — a charmed ally, a neighbour or the player', () => withClock(() => {
    // One nearest scan (creature_ai.js nearestCreature) behind flowerOpponent
    // and NPC.enemyTarget: a foe with a charmed slime four cells off and a
    // neighbour one cell off goes for the neighbour; with the neighbour gone,
    // the ally; with the player nearer than both, the player.
    const hostile = foe('hostile'), ally = foe('ally', 'zombie', 28), s = scene();
    Combat.applyCharm(ally, wall); s._charmedOpponents = [ally];
    const neighbour = { kind: 'npc', id: 'npc_near', x: 7, y: 0, homeX: 7, homeY: 0 };
    s._npcCombatTargets = [neighbour];
    assert.eq(flowerOpponent(s, hostile, 1000, 0, new Set()), null, 'the neighbour one cell off wins over the ally four cells off');
    assert.eq(NPC.enemyTarget(s, hostile, EnemyRoster.get('zombie'), 1000, 0, false), neighbour);
    s._npcCombatTargets = [];
    assert.eq(flowerOpponent(s, hostile, 1000, 0, new Set()), ally, 'no neighbour: the ally within sight');
    assert.eq(flowerOpponent(s, hostile, 14, 0, new Set()), null, 'the player two cells off wins over the ally');
    s.isUnnoticed = () => true;
    assert.eq(flowerOpponent(s, hostile, 14, 0, new Set()), ally, 'unless the player is not there to be hunted');
  }));
  test('flower status: hostile ally pursuit keeps Home wards and lair stand-down', () => withClock(() => {
    const hostile = foe('hostile'), ally = foe('ally', 'zombie', 1), s = scene();
    Combat.applyCharm(ally, wall); s._charmedOpponents = [ally];
    assert.falsy(flowerCreatureTick(s, hostile, 10000, 100, 0, new Set(),
      { homePos: {x:0,y:0}, castleWards: [], radiusSq: 100 }));
    assert.eq(s.hits.length, 0); assert.eq(hostile.x, 0);
    hostile._wardFrom = {x:0,y:0};
    assert.falsy(flowerCreatureTick(s, hostile, 10000, 100, 0, new Set()));
    hostile._wardFrom = null; hostile.lair = 'keep';
    const real = Lairs.guardState; Lairs.guardState = () => 'return';
    try { assert.falsy(flowerCreatureTick(s, hostile, 10000, 100, 0, new Set())); }
    finally { Lairs.guardState = real; }
  }));
  test('flower status: fear prevents ally pursuit before and after a burning sleeper wakes', () => withClock(() => {
    const hostile = foe('afraid'), ally = foe('ally', 'zombie', 1), s = scene();
    Combat.applyCharm(ally, wall); s._charmedOpponents = [ally];
    hostile._fearUntilT = 30000;
    assert.falsy(flowerCreatureTick(s, hostile, 1000, 100, 0, new Set()), 'fear leaves movement to the retreat lane');
    assert.eq(hostile.x, 0); assert.eq(s.hits.length, 0);
    assert.falsy(hostile._attackWindupUntil, 'no attack starts on the ally');
    Combat.applySleep(hostile, wall); Combat.ignite(hostile, 1000, 'fire'); hostile._burnState.remainingMs = 15000;
    assert.truthy(flowerCreatureTick(s, hostile, 1500, 100, 0, new Set()), 'sleep still runs before fear');
    assert.truthy(Combat.isSleeping(hostile));
    assert.falsy(flowerCreatureTick(s, hostile, 2000, 100, 0, new Set()), 'the wake tick returns to retreat');
    assert.falsy(Combat.isSleeping(hostile), 'burn damage wakes the existing sleep debuff');
    assert.eq(s.hits.length, 1); assert.eq(s.hits[0].c, hostile, 'only the sleeper takes damage');
    assert.falsy(flowerCreatureTick(s, hostile, 2100, 100, 0, new Set()), 'the awakened foe still retreats from the ally');
    assert.falsy(hostile._attackWindupUntil); assert.eq(s.hits.length, 1);
    assert.truthy(flowerCreatureTick(s, hostile, 30000, 100, 0, new Set()), 'ordinary ally targeting resumes at fear expiry');
  }));
  test('flower status: creature pursuit ignores player-only visibility reduction', () => withClock(() => {
    const c = foe('ally'), target = foe('enemy', 'zombie', 20), s = scene();
    Combat.applyCharm(c, wall); const row = EnemyRoster.get(c.kind), real = Combat.seesPlayer;
    Combat.seesPlayer = () => false;
    try { rosterEnemyMove(s, c, row, 10000, target.x, target.y, false, false, null, 0.1, target); }
    finally { Combat.seesPlayer = real; }
    assert.gt(c.x, 0, 'the visible creature remains worth pursuing');
  }));
})();
