// The snake: a slow grass lurker whose bite poisons, seated in grassland
// and sometimes waiting in a clay pot.
(() => {
  const row = () => EnemyRoster.get('snake');
  function grassFixture(objects) {
    const old = WorldGen.tileCache.get(WorldGen.tileKey(0, 0));
    const scene = {
      depth: 0, cellM: 1, cellsPerTile: 256, mPerPx: 1, tileEdgeM: 256,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      playerM: { x: 0.5, y: 0.5 }, save: {}, brokenRockSet: new Set(), dugWallSet: new Set(),
      game: { loop: { frame: 1 } },
      cellAt: () => ({ loaded: true, type: 24 }),
    };
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), { objects, grid: new Uint8Array(256 * 256), wildplants: [] });
    return { scene, done() {
      if (old) WorldGen.tileCache.set(WorldGen.tileKey(0, 0), old);
      else WorldGen.tileCache.delete(WorldGen.tileKey(0, 0));
    } };
  }
  function attackScene() {
    return { cellM: 7, depth: 0, save: { energy: 100, armor: {} }, _shots: [],
      cellAt: () => ({ loaded: true, type: WorldGen.T.GRASS }),
      _cellBlocked: () => false, _nearAny: () => false,
      _losePlayerEnergy(n) { this.save.energy -= n; return n; },
      _applyCondition(id) { Conditions.apply(this.save, id); } };
  }

  test('snake: a slow mini-monsters-sheet grass lurker of the grassland biomes', () => {
    const r = row();
    assert.eq(r.art.path, 'assets/Enemy/spr_mini_monsters_spritesheet.png');
    assert.eq(r.art.directions.down.idle[0], 729);
    assert.eq(r.art.directions.left.move[0], 759);
    assert.eq(r.art.directions.right.move[0], 789);
    assert.eq(r.art.directions.up.move[0], 819);
    assert.eq(r.condition, 'poison', 'its bite poisons');
    assert.eq(r.attackType, 'melee');
    assert.lt(r.movement.speedMetersPerSecond, WALK_M_S, 'slower than a walk: it can be outpaced');
    assert.falsy(isFastMover({ kind: 'snake' }, 7), 'never a fast mover');
    assert.eq(r.ambush.hide, 'grass', 'lurks in long grass');
    assert.truthy(isAmbusher({ kind: 'snake' }));
    assert.eq(ambushHide({ kind: 'snake' }), 'grass');
    assert.eq(ambushHide({ kind: 'thief' }), 'cover', 'the thief keeps its bush');
    assert.eq(ambushHide({ kind: 'club_goblin', ambush: true }), 'cover', 'a garrison ambusher keeps its hedge');
    assert.eq(r.cave, null, 'surface only');
    assert.eq(r.surface.biomes.join(), 'GRASS,FARMLAND,WETLAND', 'where long grass grows thick');
    for (const biome of r.surface.biomes) assert.truthy(HabitatSpawns.landProfile(biome), `${biome} is land the sampler walks`);
    assert.truthy(HabitatSpawns.enemyRows(HabitatSpawns.landProfile('GRASS'), 'GRASS', {}).some(x => x.id === 'snake'),
      'the grassland pool offers it');
    assert.falsy(HabitatSpawns.enemyRows(HabitatSpawns.landProfile('COMMERCIAL'), 'COMMERCIAL', {}).some(x => x.id === 'snake'));
    assert.truthy(Combat.isEnemyKind('snake'));
    assert.truthy(SpriteLayout.creatureWanders('snake'));
  });

  test('snake: its bite lands poison through the roster attack', () => {
    const s = attackScene(), r = row(), c = { kind: 'snake', id: 'snake_bite', x: 0, y: 0 };
    rosterEnemyAttack(s, c, r, 10000, 2, 0, false, .1);
    assert.eq(s.save.energy, 100, 'a wind-up first');
    rosterEnemyAttack(s, c, r, 10400, 2, 0, false, .1);
    assert.eq(s.save.energy, 100 - r.dmg);
    assert.truthy(s.save.conditions?.poison, 'poisoned');
    assert.eq(s.save.conditions.poison.remainingMs, Conditions.DEFINITIONS.poison.durationMs);
  });

  test('snake: long grass is a grass hide that conceals nobody; the thief still takes the bush', () => {
    const grass = { id: 'lg', kind: 'wildplant', crop: 'longgrass', x: 4.5, y: 3.5 };
    const bush = { id: 'b', kind: 'wildplant', crop: 'shrub', x: 6.5, y: 1.5 };
    const f = grassFixture([grass, bush]);
    try {
      assert.truthy(Visibility.grassHide(grass));
      assert.falsy(Visibility.grassHide(bush));
      assert.falsy(Visibility.objectConceals(grass), 'knee-high grass hides no one');
      assert.eq(Visibility.playerCover(f.scene, 4.5, 3.5), Visibility.CLEAR);
      assert.falsy(Visibility.hidden(f.scene, 4.5, 3.5), 'a snake in the grass stays drawn');
      const g = Visibility.concealingCellNear(f.scene, 4.5, 1.5, 3, 'a', null, 'grass');
      assert.truthy(g && g.x === 4.5 && g.y === 3.5, 'the grass hide');
      const b = Visibility.concealingCellNear(f.scene, 4.5, 1.5, 3, 'a');
      assert.truthy(b && b.x === 6.5 && b.y === 1.5, 'the ordinary hide is the bush, never the grass');
      assert.eq(Visibility.concealingCellNear(f.scene, 4.5, 1.5, 1, 'a', null, 'grass'), null, 'out of reach');
      const snake = { id: 'snake_1', kind: 'snake', x: 4.5, y: 1.5 };
      const spot = lurkSpot(f.scene, snake, 0);
      assert.truthy(spot && spot.x === 4.5 && spot.y === 3.5, 'the snake lurks in the grass');
      const thief = { id: 'thief_1', kind: 'thief', x: 4.5, y: 1.5 };
      const hide = lurkSpot(f.scene, thief, 0);
      assert.truthy(hide && hide.x === 6.5 && hide.y === 1.5, 'the thief lurks in the bush');
      assert.truthy(Render.lurkBush(grass), 'the grass shivers over a foe');
      assert.truthy(Render.lurkBush({ crop: 'longgrass' }), 'as a plant pool record');
      assert.falsy(Render.lurkBush({ id: 'f', kind: 'wildplant', crop: 'flowers' }));
    } finally { f.done(); }
  });

  test('snake: one surface clay pot in five holds a snake, on a stream of its own', () => {
    const pot = (id, extra = {}) => ({ kind: 'chest', id, x: 10, y: 20, barrel: true, barrelStyle: 'clay_pot', ...extra });
    let n = 0;
    for (let i = 0; i < 10000; i++) {
      const o = pot('snake_pot_' + i);
      const hides = potHidesSnake(o);
      assert.eq(hides, potHidesSnake({ ...o }), 'reloading keeps the snake');
      assert.eq(barrelProfile(o).texKey, 'clay_pot', 'the look and the loot table are the pot\'s own');
      if (hides) n++;
    }
    assert.inRange(n, 1800, 2200);
    let o = null;
    for (let i = 0; !o; i++) if (potHidesSnake(pot('snake_find_' + i))) o = pot('snake_find_' + i);
    for (const extra of [{ barrelStyle: 'barrel' }, { barrelStyle: 'street_decor_dark_urn' },
      { barrelStyle: 'street_decor_pottery_stack' }, { depth: 1 }, { barrel: false }, { crate: true }]) {
      assert.falsy(potHidesSnake(pot(o.id, extra)), JSON.stringify(extra));
    }
    assert.falsy(chestHidesMimic(o), 'a pot never hides a mimic');
  });

  test('snake: smashing a snake pot frees the snake once and still rolls the pot', () => {
    let o = null;
    for (let i = 0; !o; i++) {
      const c = { kind: 'chest', id: 'snake_tap_' + i, x: 10, y: 20, barrel: true, barrelStyle: 'clay_pot' };
      if (potHidesSnake(c)) o = c;
    }
    const save = { opened: [], money: 0, relics: {}, armor: {} };
    const reveals = [], flashes = [];
    const originalRoll = globalThis.rollBarrel;
    let rolls = 0;
    const scene = makeScene({ _revealMimic(c, kind) { reveals.push([c.id, kind]); return true; },
      flash: (line) => flashes.push(line) });
    try {
      globalThis.rollBarrel = (c) => { rolls++; return originalRoll(c); };
      const ctx = makeCtx(scene, save);
      INTERACTABLES.chest.custom(ctx, o);
      assert.truthy(ctx.dirty);
      assert.eq(save.opened[0], o.id);
      assert.eq(reveals.length, 1);
      assert.eq(reveals[0][0], o.id); assert.eq(reveals[0][1], 'snake');
      assert.eq(rolls, 1, 'the pot\'s take is rolled as ever');
      assert.truthy(flashes.some(l => /snake/i.test(l)), 'the player is told');
      INTERACTABLES.chest.custom(makeCtx(scene, JSON.parse(JSON.stringify(save))), o);
      assert.eq(reveals.length, 1, 'a smashed pot frees nothing more');
      assert.eq(rolls, 1);
    } finally { globalThis.rollBarrel = originalRoll; }
  });

  test('snake: the reveal ledger carries the kind, and a record without one is a mimic', () => {
    const method = SCENE_CREATURES_SRC.match(/  _revealMimic\(o, kind = 'mimic'\) \{[\s\S]*?\n  \}/)[0];
    const reveal = new Function('WorldGen', 'performance', 'return function ' + method.trim())(WorldGen, { now: () => 100 });
    const restoreMethod = SCENE_CREATURES_SRC.match(/  _restoreMimics\(entry, tx, ty\) \{[\s\S]*?\n  \}/)[0];
    const restore = new Function('WorldGen', 'return function ' + restoreMethod.trim())(WorldGen);
    const scene = { depth: 0, tileEdgeM: 100, save: { caught: [] } };
    const o = { kind: 'chest', id: 'snake_scene_pot', x: 10, y: 20, barrel: true, barrelStyle: 'clay_pot' };
    const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    try {
      const entry = { creatures: [] };
      WorldGen.tileCache.set(key, entry);
      assert.truthy(reveal.call(scene, o, 'snake'));
      assert.truthy(reveal.call(scene, o, 'snake'));
      assert.eq(entry.creatures.length, 1);
      const c = entry.creatures[0];
      assert.eq(c.kind, 'snake');
      assert.eq(c.id, 'snake:' + o.id);
      assert.truthy(c._hunting);
      assert.truthy(Combat.isEnemy(c));
      assert.eq(scene.save.revealedMimics.length, 1);
      assert.eq(scene.save.revealedMimics[0].kind, 'snake');
      assert.eq(scene.save.revealedMimics[0].chestId, o.id);
      scene.save.revealedMimics.push({ id: 'mimic:old_chest', chestId: 'old_chest', x: 30, y: 40 });
      const reloaded = { ...scene, save: JSON.parse(JSON.stringify(scene.save)) };
      const fresh = { creatures: [] };
      restore.call(reloaded, fresh, 0, 0);
      assert.eq(fresh.creatures.map(x => x.kind).sort().join(), 'mimic,snake', 'each record restores its own kind');
      assert.eq(fresh.creatures.find(x => x.kind === 'snake').id, c.id);
    } finally {
      if (previous) WorldGen.tileCache.set(key, previous);
      else WorldGen.tileCache.delete(key);
    }
  });

  test('snake: the sandbox seats one and a pot that passes the real snake roll', () => {
    const built = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 3, ty: 4 });
    assert.truthy(built.entry.creatures.some(c => c.kind === 'snake'), 'a snake recipient');
    const pot = built.entry.objects.find(o => o.name === 'Sandbox Snake Pot');
    assert.truthy(pot && potHidesSnake(pot), 'the probe pot hides a snake');
    assert.truthy(built.entry.objects.some(o => o.name === 'Sandbox Clay Pot' && !potHidesSnake(o)), 'the plain pot does not');
  });
})();
