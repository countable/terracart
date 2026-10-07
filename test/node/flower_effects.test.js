(function () {
  const CELL = 7;
  const plant = (crop, more = {}) => ({ crop, x: 0, y: 0, stage: Crops.maxStage(), ...more });
  const foe = (x, more = {}) => ({ id: 'foe', kind: 'goblin', x, y: 0, ...more });
  function tick(p, units, now = 1000, clocks = new WeakMap(), blocked) {
    return Crops.tickPlantEffect(p, units, {}, null, CELL, now, clocks, blocked);
  }
  test('magical flowers: only mature crops and wild blooms have effects', () => {
    for (const crop of ['fireflower', 'iceflower']) {
      assert.falsy(Crops.effectFor(plant(crop, { stage: 0 })));
      assert.falsy(Crops.effectFor(plant(crop, { stage: Crops.maxStage() - 1 })));
      assert.truthy(Crops.effectFor(plant(crop)));
      assert.truthy(Crops.effectFor({ crop, kind: 'wildplant' }));
    }
    assert.falsy(Crops.effectFor(plant('sunflower')));
  });
  test('fireflower: nearest hostile, range, walls and independent firing clocks', () => {
    const p = plant('fireflower'), clocks = new WeakMap();
    const near = foe(7, { y: 7 }), far = foe(21);
    const pet = foe(1, { pet: true, id: 'released_pet' });
    const shot = tick(p, [pet, far, near, foe(0, { kind: 'cow' })], 1000, clocks);
    assert.eq(shot.projectile, 'fireball');
    assert.eq(shot.damage, CONSUMABLE_SPEC.fireball_scroll.damage);
    assert.eq(shot.rangeM, Crops.EFFECTS.fireflower.rangeCells * CELL);
    assert.eq(shot.vx, shot.vy, 'nearest hostile is diagonal');
    assert.eq(Combat.shotSource(shot), 'flower');
    assert.falsy(tick(p, [near], 1001, clocks));
    assert.truthy(tick(plant('fireflower'), [near], 1001, clocks));
    assert.truthy(tick(p, [near], 1000 + Crops.EFFECTS.fireflower.intervalMs, clocks));
    assert.falsy(tick(p, [foe(1000)]));
    assert.falsy(tick(p, [far], 1000, new WeakMap(), x => x > 5));
    assert.falsy(tick(p, [foe(7, { hidden: true })]));
  });
  test('fireflower: emitted fireball uses shared swept collision and blast damage', () => {
    const target = foe(14), shot = tick(plant('fireflower'), [target]);
    const hits = [];
    const live = Combat.stepShots([shot], 10, [target], CELL * Combat.HIT_RADIUS_CELLS,
      (c, s) => hits.push({ c, damage: s.damage }), { cellM: CELL });
    assert.eq(live.length, 0);
    assert.eq(hits.length, 1);
    assert.eq(hits[0].c, target);
    assert.eq(hits[0].damage, CONSUMABLE_SPEC.fireball_scroll.damage);
  });
  test('iceflower: radius reaches all bodies and overlapping blooms do not stack', () => {
    const p = plant('iceflower'), r = auraRadiusCells(Crops.EFFECTS.iceflower.aura) * CELL;
    const units = [foe(r), foe(2, { kind: 'npc' }), foe(3, { kind: 'cow', pet: true, id: 'released_cow' }), foe(r + 0.01)];
    const save = {}, player = { x: r, y: 0 }, clocks = new WeakMap();
    Crops.tickPlantEffect(p, units, save, player, CELL, 1000, clocks);
    assert.truthy(units.slice(0, 3).every(c => c._frozenUntil === 11000));
    assert.falsy(units[3]._frozenUntil);
    assert.eq(save.conditions.frozen.remainingMs, 10000);
    Conditions.tick(save, 4000);
    Crops.tickPlantEffect(plant('iceflower'), units, save, player, CELL, 5000, clocks);
    assert.eq(units[0]._frozenUntil, 11000);
    assert.eq(save.conditions.frozen.remainingMs, 6000);
  });
  test('flower scene scan: depth, picked/burned plants, removal and caught creatures', () => {
    const oldCache = new Map(WorldGen.tileCache);
    const p = plant('fireflower');
    const wild = { kind: 'wildplant', crop: 'fireflower', id: 'wild', x: 0, y: 0 };
    const target = foe(7);
    const scene = { save: { planted: [p, plant('fireflower', { depth: 1 })], picked: ['wild'] }, depth: 0,
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, cellM: CELL,
      playerToWorldCell: () => ({ tx: 0, ty: 0 }), _shots: [], _cellBlocked: () => false };
    try {
      WorldGen.tileCache.clear();
      WorldGen.tileCache.set(WorldGen.tileKey(0, 0), { wildplants: [wild], creatures: [target] });
      Crops.tickEffects(scene, 1000);
      assert.eq(scene._shots.length, 1, 'picked wild and wrong-depth crops cannot shoot');
      scene.save.planted = [];
      scene.save.picked = [];
      scene.save.burnedObjects = ['wild'];
      Crops.tickEffects(scene, 5000);
      assert.eq(scene._shots.length, 1, 'harvested and burned plants stop');
      scene.save.burnedObjects = [];
      scene.save.caught = ['foe'];
      Crops.tickEffects(scene, 9000);
      assert.eq(scene._shots.length, 1, 'caught creature cannot be targeted');
      scene.save.caught = [];
      Crops.tickEffects(scene, 13000);
      assert.eq(scene._shots.length, 2, 'live wild flower fires');
    } finally {
      WorldGen.tileCache.clear();
      for (const [key, value] of oldCache) WorldGen.tileCache.set(key, value);
    }
  });
})();
