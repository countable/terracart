// Drive the real scene loop: a rooted enemy still attacks but never pursues.
(function () {
  const CELL = 7;
  function setup(extra = {}) {
    const plant = { kind: 'plant', id: 'plant_0_0_1_1', x: CELL, y: 0, ...extra };
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
  function tick(scene, ms = 250) {
    const previous = [WorldGen.forEachItem, WorldGen.forEachItemNear, performance.now];
    scene._simT = (scene._simT || 1e6) + ms;
    const walk = (what, fn) => { if (what === 'creatures') scene.creatures.forEach(c => fn(c, 0, 0)); };
    WorldGen.forEachItem = walk;
    WorldGen.forEachItemNear = (what, tx, ty, fn) => walk(what, fn);
    performance.now = () => scene._simT;
    try { __wander.call(scene); }
    finally { [WorldGen.forEachItem, WorldGen.forEachItemNear, performance.now] = previous; }
  }
  test('park plant: registered melee enemy with bounty, no cave or giant variant', () => {
    assert.truthy(Combat.isEnemy({ kind: 'plant', id: 'plant_0_0_1_1' }));
    assert.eq(Combat.monster('plant').range, Combat.MELEE_REACH_CELLS);
    assert.truthy(Combat.monster('plant').stationary);
    assert.falsy(Combat.spawnsUnderground('plant'));
    assert.falsy(Combat.monster('giant_plant'));
    assert.gt(Combat.enemyBounty('plant', 0), 0);
    const { plant } = setup();
    const hp = Combat.hp(plant);
    Combat.damage(plant, hp);
    assert.eq(Combat.hp(plant), 0);
  });
  test('park plant: proximity bite has cooldown and art timing; leaving stops damage', () => {
    const { plant, scene } = setup();
    tick(scene);
    assert.lt(scene.save.energy, 1000);
    assert.eq(plant._attackT0, scene._simT);
    assert.eq(plant._attackUntil - plant._attackT0, 600);
    const energy = scene.save.energy;
    tick(scene, 100);
    assert.eq(scene.save.energy, energy, 'no repeated damage during cooldown');
    scene.playerM.x = -0.01;
    for (let i = 0; i < 160; i++) tick(scene);
    assert.eq(scene.save.energy, energy, 'outside one cell never bites');
    assert.eq(plant.x, CELL); assert.eq(plant.y, 0);
    scene.playerM.x = 0;
    tick(scene);
    assert.lt(scene.save.energy, energy, 'bites again when player returns');
  });
  test('park plant: provocation and wander-off timers never uproot it', () => {
    const { plant, scene } = setup({ _struckT: 1e6, _wanderOffInMs: 1, _wanderOffSimT: 1e6 });
    scene.playerM.x = -CELL * 4;
    for (let i = 0; i < 1400; i++) tick(scene);
    assert.eq(plant.x, CELL); assert.eq(plant.y, 0);
    assert.eq(scene.save.energy, 1000);
    assert.eq(plant._wanderOffUntilT, undefined, 'never schedules a wander-off');
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
      assert.eq(scene.save.energy, energy, guard + ' prevents attack');
      assert.eq(plant.x, CELL, guard + ' leaves roots in place');
      assert.eq(plant.y, 0);
    }
  });
  test('park plant: moving Home away clears suppression without requiring a retreat', () => {
    const { plant, scene } = setup();
    let home = { x: 0, y: 0 };
    scene.homeWorldPos = () => home;
    tick(scene);
    assert.eq(scene.save.energy, 1000);
    home = { x: CELL * 100, y: 0 };
    tick(scene);
    assert.lt(scene.save.energy, 1000);
    assert.falsy(plant._wardFrom);
  });
})();
