// Drive the real scene loop: plants remain rooted and spit from their declared range.
(function () {
  const CELL = 7;
  function setup(extra = {}) {
    const plant = { kind: 'plant', id: 'plant_0_0_1_1', x: 2 * CELL, y: 0, ...extra };
    const scene = {
      cellM: CELL, depth: 0, creatures: [plant],
      save: { energy: 1000, caught: [], armor: {}, planted: [], fires: [], released: [] },
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
      viewCenterX: 0, viewCenterY: 0, _shots: [],
      isShadowActive: () => false,
      isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
      homeWorldPos: () => null, _castleWardPoints: () => [],
      playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
      cellAt: () => ({ loaded: true, type: 0 }), _cellBlocked: () => false,
      _nearAny: () => false, placedRockSet: null,
      resolveDefeat() {}, _popEnergy() {}, _warnIfTiring() {}, _flashPlayerHit() {},
      _closeShopOnHit() {}, updateEnergyDOM() {}, flash() {}, _wildCrowTick() {},
      _losePlayerEnergy(d) {
        const before = this.save.energy;
        this.save.energy = Math.max(0, before - d);
        return before - this.save.energy;
      },
    };
    return { plant, scene };
  }
  function tick(scene, ms = 100) {
    const previous = [WorldGen.forEachItem, WorldGen.forEachItemNear, performance.now];
    scene._simT = (scene._simT || 1e6) + ms;
    const walk = (what, fn) => { if (what === 'creatures') scene.creatures.forEach(c => fn(c, 0, 0)); };
    WorldGen.forEachItem = walk;
    WorldGen.forEachItemNear = (what, tx, ty, fn) => walk(what, fn);
    performance.now = () => scene._simT;
    try { __wander.call(scene); }
    finally { [WorldGen.forEachItem, WorldGen.forEachItemNear, performance.now] = previous; }
  }

  test('park plant: roster declares a ranged surface and cave enemy with a giant', () => {
    const row = Combat.monster('plant');
    assert.truthy(Combat.isEnemy({ kind: 'plant', id: 'plant_0_0_1_1' }));
    assert.eq(row.attackType, 'projectile'); assert.eq(row.range, 2);
    assert.eq(row.movement.pattern, 'anchor_spit');
    assert.truthy(Combat.spawnsUnderground('plant'));
    assert.truthy(Combat.monster('giant_plant'));
    assert.gt(Combat.enemyBounty('plant', 0), 0);
    const { plant } = setup();
    Combat.damage(plant, Combat.hp(plant));
    assert.eq(Combat.hp(plant), 0);
  });
  test('park plant: a telegraphed single-hit projectile replaces the contact bite', () => {
    const { plant, scene } = setup();
    const row = EnemyRoster.get('plant');
    tick(scene);
    assert.eq(scene._shots.length, 0); assert.eq(scene.save.energy, 1000);
    assert.gt(plant._attackWindupUntil, scene._simT);
    tick(scene, row.windupSeconds * 1000);
    assert.eq(scene._shots.length, 1);
    assert.eq(scene._shots[0].hits, 1);
    assert.eq(plant._attackT0, scene._simT);
    assert.gt(plant._attackUntil, plant._attackT0);
    assert.eq(scene.save.energy, 1000, 'launching does not also deal contact damage');
    let impacts = 0;
    let shots = scene._shots.slice();
    for (let i = 0; i < 300 && shots.length; i++) {
      shots = Combat.stepShots(shots, 1 / 60, [], Combat.HIT_RADIUS_CELLS * CELL,
        (target, shot) => { impacts++; scene._losePlayerEnergy(Combat.incomingDamage(scene.save, shot.damage, shot.hits)); },
        { cellM: CELL, hostileTargets: [{ id: 'player', x: 0, y: 0 }], blocked: () => false });
    }
    assert.eq(impacts, 1); assert.lt(scene.save.energy, 1000);
    tick(scene, 100);
    assert.eq(scene._shots.length, 1, 'the row cooldown prevents another shot');
  });
  test('park plant: remains rooted outside range and fires when approached', () => {
    const { plant, scene } = setup({ x: 4 * CELL });
    for (let i = 0; i < 20; i++) tick(scene);
    assert.eq(plant.x, 4 * CELL);
    assert.inRange(plant.y, -1e-9, 1e-9); assert.eq(scene._shots.length, 0, 'outside declared range');
    plant.x = 2 * CELL;
    for (let i = 0; i < 10; i++) tick(scene);
    assert.eq(plant.x, 2 * CELL, 'holds its preferred firing distance');
    assert.gt(scene._shots.length, 0);
  });
  test('park plant: keeps attacking through repeated cooldowns while the player remains in range', () => {
    const { plant, scene } = setup();
    for (let i = 0; i < 120; i++) tick(scene);
    assert.gte(scene._shots.length, 4, 'at least four attacks across twelve seconds');
    assert.eq(plant.x, 2 * CELL);
    assert.eq(plant.y, 0);
  });
  test('park plant: Home, castle, shadow, downed, frozen and released safety', () => {
    for (const guard of ['home', 'castle', 'shadow', 'downed', 'frozen', 'released']) {
      const { plant, scene } = setup();
      if (guard === 'home') scene.homeWorldPos = () => ({ x: 0, y: 0 });
      if (guard === 'castle') scene._castleWardPoints = () => [{ x: 0, y: 0 }];
      if (guard === 'shadow') scene.isShadowActive = () => true;
      if (guard === 'downed') scene.save.energy = 0;
      if (guard === 'frozen') plant._frozenUntil = Date.now() + 60000;
      if (guard === 'released') plant.id = 'released_plant';
      const energy = scene.save.energy;
      for (let i = 0; i < 32; i++) tick(scene);
      assert.eq(scene.save.energy, energy, guard + ' prevents damage');
      assert.eq(scene._shots.length, 0, guard + ' prevents shooting');
      if (guard === 'home' || guard === 'castle') assert.eq(plant.x, 2 * CELL, guard + ' suppresses the rooted plant without moving it');
      if (guard === 'frozen') { assert.eq(plant.x, 2 * CELL); assert.eq(plant.y, 0); }
    }
  });
  test('park plant: a blocked line cancels wind-up; rooted foes cannot wander off', () => {
    const { plant, scene } = setup();
    tick(scene);
    scene._cellBlocked = () => true;
    tick(scene, 600);
    assert.eq(scene._shots.length, 0); assert.eq(plant._attackWindupUntil, null);
    scene._cellBlocked = () => false;
    plant._wanderOffInMs = 1;
    plant._wanderOffSimT = scene._simT;
    for (let i = 0; i < 30; i++) tick(scene);
    assert.eq(plant.x, 2 * CELL); assert.gt(scene._shots.length, 0);
    assert.falsy(plant._wanderOffUntilT, 'a rooted plant never enters the retreat pause');
  });
})();
