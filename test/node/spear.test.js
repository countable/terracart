// Run the scene action itself, then fly its shot through the shared combat lane.
(function () {
const CELL = 7;
function throwScene(overrides = {}) {
  const scene = {
    save: { energy: 50, inv: [{ id: 'throwing_spear', count: 2 }], selSlot: 0, relics: {} },
    startWorldM: { x: 100, y: 200 }, playerM: { x: 3, y: 4 },
    facing: { x: 3, y: 0 }, cellM: CELL, _shots: [], now: 1000,
    _dragonUntil: Date.now() + 60000,
    persisted: 0, rebuilt: 0,
    buildInventoryDOM() { this.rebuilt++; },
    flashMsg() {},
    isShadowActive() { return false; },
    ...overrides,
  };
  const names = ['throwCooldownLeft', 'throwActionLabel', 'canThrowItem', '_throwItem', 'useSpear', 'useJavelin', 'useRock', '_tickThrowButton', 'useForgetmenot', 'useWildrose', '_friendlyShotHitsEnemy', '_shotCanHit', '_shotHitsTarget'];
  const methods = names.map(name => {
    const method = SCENE_SRC.match(new RegExp('\\n  (' + name + '\\([^\\n]*\\) \\{\\n[\\s\\S]*?\\n  \\})\\n'));
    assert.truthy(method, `${name} exists`);
    return method[1];
  });
  Object.assign(scene, new Function('getSelectedSlot', 'consumeSelected', 'persistSave', 'reachCells', 'performance',
    'return ({' + methods.join(',') + '});')(s => s.inv?.[s.selSlot] || null,
      consumeSelected, () => scene.persisted++, () => 4, { now: () => scene.now }));
  return scene;
}
function throwSpear(overrides = {}) {
  const scene = throwScene(overrides);
  return { scene, result: scene.useSpear() };
}
function fly(shot, enemies, blocked = () => false, onHit = () => {}) {
  let shots = [shot];
  const hits = [];
  for (let i = 0; i < 6000 && shots.length; i++) {
    shots = Combat.stepShots(shots, 1 / 60, enemies, Combat.HIT_RADIUS_CELLS * CELL,
      (enemy, s) => { hits.push({ enemy, damage: s.damage }); onHit(enemy, s); }, { blocked, cellM: CELL });
  }
  assert.eq(shots.length, 0, 'the shot is spent');
  return hits;
}

test('spear: available as a consumable with an active throwing action', () => {
  assert.truthy(ITEM_BY_ID.throwing_spear, 'catalog entry');
  assert.eq(CONSUMABLE_SPEC.throwing_spear.method, 'useSpear');
  assert.eq(CONSUMABLE_SPEC.throwing_spear.damage, 20);
  assert.gt(PRICES.throwing_spear, 0);
  assert.truthy(ITEM_EFFECTS.throwing_spear);
  assert.truthy(MINERAL_ICON_SHEET.throwing_spear, 'inventory art');
});

test('spear: one use throws one 20-damage arrow-like shot without a bow or wood', () => {
  const { scene, result } = throwSpear();
  assert.eq(result, true);
  assert.eq(scene._shots.length, 1);
  const shot = scene._shots[0];
  const arrow = Combat.spawnShot('bow', 103, 204, scene.facing, CELL, 20, 1, 4);
  assert.eq(shot.projectile, 'throwing_spear', 'distinct flying art');
  for (const key of ['slot', 'x', 'y', 'vx', 'vy', 'speedMps', 'rangeM', 'pierce', 'damage']) {
    assert.eq(shot[key], arrow[key], key);
  }
  assert.eq(shot.damage, 20, 'a dragon buff does not scale the fixed damage');
  assert.eq(scene.save.inv[0].count, 1);
  assert.eq(scene.persisted, 1);
  assert.eq(scene.rebuilt, 1);
});

test('spear: last throw empties the hand without selecting the next stack', () => {
  const { scene, result } = throwSpear({ save: {
    energy: 50, inv: [{ id: 'throwing_spear', count: 1 }, { id: 'wood', count: 3 }], selSlot: 0,
  } });
  assert.eq(result, true);
  assert.eq(scene.save.inv.length, 1);
  assert.eq(scene.save.inv[0].id, 'wood');
  assert.eq(scene.save.inv[0].count, 3);
  assert.eq(scene.save.selSlot, -1);
});

test('spear: invalid selection, empty stack, downed or shadowed player, or absent heading keeps the item', () => {
  for (const overrides of [
    { save: { energy: 50, inv: [], selSlot: -1 } },
    { save: { energy: 50, inv: [{ id: 'wood', count: 2 }], selSlot: 0 } },
    { save: { energy: 50, inv: [{ id: 'throwing_spear', count: 0 }], selSlot: 0 } },
    { save: { energy: 0, inv: [{ id: 'throwing_spear', count: 2 }], selSlot: 0 } },
    { facing: { x: 0, y: 0 } },
    { isShadowActive: () => true },
  ]) {
    const before = overrides.save && JSON.stringify(overrides.save);
    const { scene, result } = throwSpear(overrides);
    assert.eq(result, false);
    assert.eq(scene._shots.length, 0);
    assert.eq(scene.persisted, 0);
    assert.eq(scene.rebuilt, 0);
    if (before) assert.eq(JSON.stringify(scene.save), before);
    else assert.eq(scene.save.inv[0].count, 2);
  }
});

test('spear: only the first enemy on its line takes the 20 damage', () => {
  const { scene } = throwSpear();
  const near = { id: 'near', kind: 'goblin', x: 117, y: 204 };
  const far = { id: 'far', kind: 'goblin', x: 131, y: 204 };
  const hits = fly(scene._shots[0], [far, near]);
  assert.eq(hits.length, 1);
  assert.eq(hits[0].enemy, near);
  assert.eq(hits[0].damage, 20);
});

test('spear: terrain stops it and a miss expires at arrow range', () => {
  const blocked = throwSpear().scene._shots[0];
  assert.eq(fly(blocked, [{ id: 'behind', kind: 'goblin', x: 131, y: 204 }],
    x => x >= 117).length, 0, 'a wall protects the enemy');
  const miss = throwSpear().scene._shots[0];
  assert.eq(fly(miss, [{ id: 'beyond', kind: 'goblin', x: miss.x + miss.rangeM + CELL, y: 204 }]).length,
    0, 'cannot hit beyond arrow range');
});

test('throws: rock does fixed 2 damage with arrow collision and consumes exactly one even on a miss', () => {
  const scene = throwScene({ save: { energy: 50, inv: [{ id: 'rubble', count: 3 }], selSlot: 0 } });
  assert.truthy(CONSUMABLE_SPEC.rubble.immediate);
  assert.truthy(CONSUMABLE_SPEC.rubble.usable(scene));
  assert.truthy(scene.useRock());
  assert.eq(scene._shots[0].damage, 2);
  assert.eq(scene._shots[0].projectile, 'rock');
  assert.eq(scene.save.inv[0].count, 2);
  const hits = fly(scene._shots[0], [{ id: 'near', kind: 'goblin', x: 117, y: 204 }]);
  assert.eq(hits.length, 1);
  assert.eq(hits[0].damage, 2);
  scene.now += 1000;
  assert.truthy(scene.useRock());
  assert.eq(fly(scene._shots[1], []).length, 0);
  assert.eq(scene.save.inv[0].count, 1, 'miss still spends one');
});

test('throws: shared cooldown follows the last weapon and survives stack switches', () => {
  const scene = throwScene({ save: { energy: 50,
    inv: [{ id: 'throwing_spear', count: 3 }, { id: 'rubble', count: 3 }, { id: 'throwing_spear', count: 2 }], selSlot: 0 } });
  assert.truthy(scene.useSpear());
  assert.eq(scene.throwCooldownLeft(), 3000);
  assert.includes(scene.throwActionLabel(), shortDuration(3000));
  scene.save.selSlot = 2;
  assert.falsy(scene.useSpear(), 'another stack cannot bypass cooldown');
  scene.save.selSlot = 1;
  scene.now += 2999;
  assert.falsy(CONSUMABLE_SPEC.rubble.usable(scene));
  assert.truthy(CONSUMABLE_SPEC.rubble.disabled(scene));
  assert.falsy(scene.useRock(), 'rocks must wait out the preceding spear');
  assert.eq(scene.save.inv[1].count, 3);
  scene.now++;
  assert.truthy(scene.useRock());
  assert.eq(scene.throwCooldownLeft(), 1000);
  scene.save.selSlot = 0;
  scene.now += 999;
  assert.falsy(scene.useSpear());
  scene.now++;
  assert.truthy(scene.useSpear(), 'spear can follow rock after one second');
  assert.eq(scene.throwCooldownLeft(), 3000);
  assert.eq(scene._shots.length, 3);
  assert.eq(scene.persisted, 3);
});

test('throws: refused rocks preserve inventory and do not start a cooldown', () => {
  for (const override of [{ energy: 0 }, { shadow: true }, { facing: { x: 0, y: 0 } }]) {
    const scene = throwScene({ save: { energy: override.energy ?? 50,
      inv: [{ id: 'rubble', count: 2 }], selSlot: 0 },
      isShadowActive: () => !!override.shadow, ...(override.facing ? { facing: override.facing } : {}) });
    assert.falsy(scene.useRock());
    assert.eq(scene.save.inv[0].count, 2);
    assert.eq(scene._shots.length, 0);
    assert.eq(scene.throwCooldownLeft(), 0);
    assert.eq(scene.persisted, 0);
  }
});

test('throws: cooldown button refreshes at displayed changes and re-enables without clicking', () => {
  const scene = throwScene();
  let refreshed = 0;
  scene.syncConsumableButton = () => refreshed++;
  scene.useSpear();
  scene._tickThrowButton();
  const first = refreshed;
  scene._tickThrowButton();
  assert.eq(refreshed, first, 'unchanged frame does not rebuild the button');
  scene.now += 1000;
  scene._tickThrowButton();
  assert.eq(refreshed, first + 1);
  scene.now += 2000;
  scene._tickThrowButton();
  assert.eq(refreshed, first + 2);
  assert.eq(scene.throwActionLabel(), 'Throw');
  assert.falsy(CONSUMABLE_SPEC.throwing_spear.disabled(scene));
});

test('flowers: a landed throw applies sleep or charm without dealing damage', () => {
  for (const [id, method, predicate] of [['forgetmenot', 'useForgetmenot', 'isSleeping'], ['wildrose', 'useWildrose', 'isCharmed']]) {
    const scene = throwScene({ save: { energy: 50, inv: [{ id, count: 2 }], selSlot: 0 },
      _damageEnemy() { throw new Error('a flower must never deal damage'); } });
    assert.truthy(CONSUMABLE_SPEC[id].immediate);
    assert.truthy(scene[method]());
    const shot = scene._shots[0];
    assert.eq(shot.damage, 0);
    assert.eq(shot.projectile, id, 'draws the flower itself');
    assert.eq(scene.save.inv[0].count, 1);
    assert.eq(scene.throwCooldownLeft(), 1000);
    const target = { id: 'foe', kind: 'goblin', x: 117, y: 204 };
    const beforeHP = Combat.hp(target);
    assert.eq(fly(shot, [target], undefined, (c, s) => scene._shotHitsTarget(c, s)).length, 1);
    assert.truthy(Combat[predicate](target));
    assert.eq(Combat.hp(target), beforeHP);
    assert.falsy(scene[method](), 'flower respects the shared recovery');
    scene.now += 1000;
    assert.truthy(scene[method]());
    const missed = { id: 'far', kind: 'goblin', x: 10000, y: 204 };
    assert.eq(fly(scene._shots[1], [missed], undefined, (c, s) => scene._shotHitsTarget(c, s)).length, 0);
    assert.falsy(Combat[predicate](missed));
    assert.eq(scene.save.inv.length, 0, 'a miss still consumes the second bloom');
  }
});

test('flowers: cooldown from a spear blocks flowers and flower cooldown blocks rocks', () => {
  const scene = throwScene({ save: { energy: 50,
    inv: [{ id: 'throwing_spear', count: 2 }, { id: 'forgetmenot', count: 2 }, { id: 'rubble', count: 2 }], selSlot: 0 } });
  assert.truthy(scene.useSpear());
  scene.save.selSlot = 1;
  assert.falsy(scene.useForgetmenot());
  assert.eq(scene.save.inv[1].count, 2);
  scene.now += 3000;
  assert.truthy(scene.useForgetmenot());
  scene.save.selSlot = 2;
  assert.falsy(scene.useRock());
  scene.now += 1000;
  assert.truthy(scene.useRock());
});

test('flower charm: later shots in the same frame spare newly allied creatures', () => {
  const scene = throwScene({ _damageEnemy() { throw new Error('friendly fire'); } });
  const target = { id: 'foe', kind: 'goblin', x: 117, y: 204 };
  assert.truthy(scene._shotHitsTarget(target, { effect: 'charm', damage: 0 }));
  assert.falsy(scene._shotCanHit(target, { damage: 25 }));
  assert.falsy(scene._shotHitsTarget(target, { damage: 25 }));
  const oldHostileShot = { hostile: true, _sourceGuard: target, damage: 10 };
  assert.falsy(scene._shotCanHit({ id: 'player' }, oldHostileShot), 'old hostile shot cannot hit player after its source is charmed');
  oldHostileShot.hostile = false;
  const other = { id: 'other', kind: 'goblin' };
  assert.truthy(scene._shotCanHit(other, oldHostileShot));
  target._charmUntil = 0;
  assert.falsy(scene._shotCanHit(other, oldHostileShot), 'an expired ally cannot keep shooting enemies as a friend');
});

test('charmed allies: hostile impacts damage the creature rather than the player', () => {
  const hits = [];
  const scene = throwScene({ _damageEnemy(c, amount, source) { hits.push({ c, amount, source }); },
    _shotHitsPlayer() { throw new Error('wrong target lane'); } });
  const ally = { id: 'ally', kind: 'goblin' };
  Combat.applyCharm(ally);
  const foe = { id: 'foe', kind: 'goblin' };
  scene._shotHitsTarget(ally, { hostile: true, _sourceGuard: foe, damage: 7 });
  assert.eq(hits.length, 1);
  assert.eq(hits[0].c, ally);
  assert.eq(hits[0].amount, 7);
  assert.eq(hits[0].source, 'enemy');
});

test('javelin: T4 supply and renamed T1 spear keep separate damage and shared recovery', () => {
  assert.eq(ITEM_BY_ID.throwing_spear.name, 'Throwing Spear');
  assert.eq(ITEM_BY_ID.throwing_spear.baseTier, 1);
  assert.eq(ITEM_BY_ID.javelin.baseTier, 4);
  assert.eq(CONSUMABLE_SPEC.javelin.damage, 40);
  assert.truthy(Shops.themedStock('supply', 4).includes('javelin'));
  const scene = throwScene({ save: { energy: 50,
    inv: [{ id: 'javelin', count: 2 }, { id: 'throwing_spear', count: 2 }], selSlot: 0 } });
  assert.truthy(scene.useJavelin());
  const shot = scene._shots[0];
  assert.eq(shot.projectile, 'javelin'); assert.eq(shot.damage, 40);
  assert.eq(scene.save.inv[0].count, 1);
  const hits = fly(shot, [{ id: 'first', kind: 'slime', x: 117, y: 204 },
    { id: 'second', kind: 'slime', x: 124, y: 204 }]);
  assert.eq(hits.length, 1); assert.eq(hits[0].damage, 40);
  scene.save.selSlot = 1;
  assert.falsy(scene.useSpear(), 'switching weapons does not bypass recovery');
  scene.now += 3000;
  assert.truthy(scene.useSpear()); assert.eq(scene._shots[1].damage, 20);
  scene.save.selSlot = 0;
  assert.falsy(scene.useJavelin(), 'the weaker spear also holds the shared cooldown');
  assert.eq(scene.save.inv[0].count, 1);
});

test('javelin: refused throw preserves ammo and a missed throw still spends it', () => {
  const scene = throwScene({ save: { energy: 0, inv: [{ id: 'javelin', count: 1 }], selSlot: 0 } });
  assert.falsy(scene.useJavelin()); assert.eq(scene.save.inv[0].count, 1);
  scene.save.energy = 50;
  assert.truthy(scene.useJavelin()); assert.eq(scene.save.inv.length, 0);
  assert.eq(fly(scene._shots[0], []).length, 0);
});

test('javelin: runtime steel recolour preserves alpha and registers the same sheet geometry', () => {
  const window = {}, pixels = new Uint8ClampedArray([0, 0, 0, 255, 160, 120, 60, 128, 255, 255, 255, 0]);
  let registered, written;
  const canvas = { getContext: () => ({ drawImage() {},
    getImageData: () => ({ data: pixels }), putImageData: image => { written = image.data; } }) };
  new Function('window', 'EnemyRoster', 'SpriteLayout', 'document', ASSETS_SRC)(window, EnemyRoster, SpriteLayout,
    { createElement: () => canvas });
  window.ASSETS.icon_javelin.onLoad({ textures: {
    get: () => ({ getSourceImage: () => ({ width: 32, height: 16 }) }), remove() {},
    addSpriteSheet: (key, source, frames) => { registered = { key, source, frames }; },
  } });
  assert.eq(registered.key, MINERAL_ICON_SHEET.javelin.sheet);
  assert.eq(registered.frames.frameWidth, 16); assert.eq(registered.frames.frameHeight, 16);
  assert.eq(canvas.width, 32); assert.eq(canvas.height, 16);
  assert.eq(written[3], 255); assert.eq(written[7], 128); assert.eq(written[11], 0);
  assert.gt(written[6], written[4], 'steel blue replaces the original warm shaft');
  assert.truthy(SCENE_SRC.includes("ITEM_DATA_URLS.javelin = bakeSheetFrame('icon_javelin', 0, 16, 16)"),
    'all DOM surfaces bake the same recoloured texture');
});

test('javelin: projectile sprite pool switches between both inventory art sheets', () => {
  const m = SCENE_SRC.match(/\n  (_drawShots\(\) \{\n[\s\S]*?\n  \})\n/);
  const draw = new Function('SHOT_DRAW_LIFT_PX', 'return ({' + m[1] + '})._drawShots;')(10);
  const sprite = { setTexture(sheet) { this.sheet = sheet; return this; },
    setScale() { return this; }, setVisible() { return this; }, setPosition() { return this; }, setRotation() { return this; } };
  const scene = { projGfx: { clear() {} }, _spearPool: [sprite], _boltPool: [], _drawStaffCharge() {},
    worldMetersToScreen: (x, y) => ({ x, y }), _shots: [] };
  for (const projectile of ['javelin', 'throwing_spear', 'javelin']) {
    scene._shots = [{ projectile, slot: 'bow', x: 0, y: 0, vx: 1, vy: 0 }];
    draw.call(scene);
    assert.eq(sprite.sheet, inventoryIconSource(projectile).sheet, 'pooled sprite uses the current item art');
  }
});

})();
