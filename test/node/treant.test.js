(() => {
  const creature = () => ({ id: 'grove_treant', kind: 'treant', x: 0, y: 0 });
  test('treant: stays disguised until one cell away, then remains revealed', () => {
    const c = creature(), scene = { cellM: 7 };
    assert.truthy(Combat.isDisguised(c));
    assert.falsy(Combat.isEnemy(c), 'bows and allies do not target a bramble');
    assert.falsy(Combat.applyCharm(c));
    assert.falsy(Combat.canBurn(c));
    assert.falsy(huntsPrey('mercenary', c));
    assert.eq(Combat.damageDealt(c, 20), 0);
    assert.truthy(enemyDisguiseTick(scene, c, 7.01, 0));
    assert.eq(c.x, 0); assert.eq(c.y, 0);
    assert.falsy(enemyDisguiseTick(scene, c, 7, 0));
    assert.truthy(Combat.isEnemy(c));
    assert.falsy(Combat.isDisguised(c));
    assert.falsy(enemyDisguiseTick(scene, c, 100, 100), 'walking away does not restore camouflage');
    assert.gt(Combat.damageDealt(c, 20), 0);
  });

  test('treant: attacks and pursues normally after its ambush reveals it', () => {
    const c = creature(), row = EnemyRoster.get(c.kind);
    const scene = { cellM: 7, depth: 0, save: { energy: 100, armor: {} },
      cellAt: () => ({ loaded: true, type: WorldGen.T.PARK }),
      _cellBlocked: () => false, _nearAny: () => false,
      _losePlayerEnergy(n) { this.save.energy -= n; return n; } };
    rosterEnemyAttack(scene, c, row, 0, 3, 0, false, 0.1);
    rosterEnemyMove(scene, c, row, 0, 7, 0, false, false, null, 1);
    assert.eq(scene.save.energy, 100); assert.eq(c.x, 0);
    enemyDisguiseTick(scene, c, 3, 0);
    rosterEnemyAttack(scene, c, row, 1000, 3, 0, false, 0.1);
    rosterEnemyAttack(scene, c, row, 1600, 3, 0, false, 0.1);
    assert.lt(scene.save.energy, 100);
    rosterEnemyMove(scene, c, row, 2000, 7, 0, false, false, null, 1);
    assert.gt(c.x, 0);
  });

  test('treant: camouflage uses the surrounding bramble art and visibly wiggles', () => {
    const c = creature();
    const sprite = { anims: { stop() {} },
      setTexture(sheet, frame) { this.sheet = sheet; this.frame = frame; return this; },
      setCrop() { return this; }, setOrigin() { return this; },
      setScale(scale) { this.scale = scale; return this; }, setPosition() { return this; },
      setRotation(rotation) { this.rotation = rotation; return this; },
      setFlipX() { return this; }, setTint() { return this; }, setAlpha() { return this; } };
    assert.truthy(Render.drawCreatureDisguise(sprite, c, 0, 0, 0));
    const bramble = wildplantSprite({ crop: 'shrub', _plantArt: 'bramble' });
    assert.eq(sprite.sheet, bramble.sheet); assert.eq(sprite.scale, bramble.scale);
    const angle = sprite.rotation;
    Render.drawCreatureDisguise(sprite, c, 0, 0, 237);
    assert.truthy(Math.abs(angle - sprite.rotation) > 0.001);
    c._disguiseRevealed = true;
    assert.falsy(Render.drawCreatureDisguise(sprite, c, 0, 0, 300));
    const creaturePass = RENDER_SRC.indexOf('Render.renderPool(scene, scene.creaturePool');
    const invocation = RENDER_SRC.indexOf('if (Render.drawCreatureDisguise(s, c,');
    assert.gt(invocation, creaturePass, 'only the creature renderer calls the disguise helper');
    assert.lt(invocation, RENDER_SRC.indexOf('const npcArt', creaturePass));
  });

  test('treant: a hidden bramble does not acquire aim or absorb a passing arrow', () => {
    const c = creature(); c.x = 1;
    assert.falsy(Combat.anyEnemyWithin(0, 0, [c], 100));
    assert.eq(Combat.aimAtNearest(0, 0, [c], 100), null);
    const shot = Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, 7, 10, 1);
    let hits = 0;
    const alive = Combat.stepShots([shot], 0.01, [c], 4, () => hits++);
    assert.eq(hits, 0);
    assert.eq(alive.length, 1, 'camouflage does not consume the arrow');
    c._disguiseRevealed = true;
    Combat.stepShots(alive, 0, [c], 4, () => hits++);
    assert.eq(hits, 1, 'the same nearby arrow can hit the revealed monster');
  });

  test('treant: replaces Ancient Grove plants only and stays out of ambient biomes', () => {
    const grove = ZoneVariants.byId('ancient_grove'), hedge = ZoneVariants.byId('hedge_garden');
    assert.truthy(grove.background.slots.some(s => s.material === 'treant'));
    assert.falsy(grove.background.slots.some(s => s.material === 'carnivorous_plant'));
    assert.truthy(hedge.background.slots.some(s => s.material === 'carnivorous_plant'));
    assert.includes(grove.guards.kinds, 'treant');
    assert.includes(EnemyHabitats.BUILDING_FAMILIES.ancient_grove, 'treant');
    assert.falsy(EnemyHabitats.BUILDING_FAMILIES.ancient_grove.includes('plant'));
    assert.includes(EnemyHabitats.BUILDING_FAMILIES.hedge_garden, 'plant');
    assert.eq(EnemyRoster.get('treant').surface.biomes.length, 0);
    assert.eq(SpriteLayout.creatureArt('treant').directions.down.idle[0], 483);
  });
})();
