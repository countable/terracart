// Run the scene action itself, then fly its shot through the shared combat lane.
(function () {
const CELL = 7;
function throwScene(overrides = {}) {
  const scene = {
    save: { energy: 50, inv: [{ id: 'spear', count: 2 }], selSlot: 0, relics: {} },
    startWorldM: { x: 100, y: 200 }, playerM: { x: 3, y: 4 },
    facing: { x: 3, y: 0 }, cellM: CELL, _shots: [], now: 1000,
    _dragonUntil: Date.now() + 60000,
    persisted: 0, rebuilt: 0,
    buildInventoryDOM() { this.rebuilt++; },
    flashMsg() {},
    isShadowActive() { return false; },
    ...overrides,
  };
  const names = ['throwCooldownLeft', 'throwActionLabel', 'canThrowItem', '_throwItem', 'useSpear', 'useRock', '_tickThrowButton'];
  const methods = names.map(name => {
    const method = APP_JS_SRC.match(new RegExp('\\n  (' + name + '\\([^\\n]*\\) \\{\\n[\\s\\S]*?\\n  \\})\\n'));
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
function fly(shot, enemies, blocked = () => false) {
  let shots = [shot];
  const hits = [];
  for (let i = 0; i < 6000 && shots.length; i++) {
    shots = Combat.stepShots(shots, 1 / 60, enemies, Combat.HIT_RADIUS_CELLS * CELL,
      (enemy, s) => hits.push({ enemy, damage: s.damage }), { blocked, cellM: CELL });
  }
  assert.eq(shots.length, 0, 'the shot is spent');
  return hits;
}

test('spear: available as a consumable with an active throwing action', () => {
  assert.truthy(ITEM_BY_ID.spear, 'catalog entry');
  assert.eq(CONSUMABLE_SPEC.spear.method, 'useSpear');
  assert.eq(CONSUMABLE_SPEC.spear.damage, 25);
  assert.gt(PRICES.spear, 0);
  assert.truthy(ITEM_EFFECTS.spear);
  assert.truthy(MINERAL_ICON_SHEET.spear, 'inventory art');
});

test('spear: one use throws one 25-damage arrow-like shot without a bow or wood', () => {
  const { scene, result } = throwSpear();
  assert.eq(result, true);
  assert.eq(scene._shots.length, 1);
  const shot = scene._shots[0];
  const arrow = Combat.spawnShot('bow', 103, 204, scene.facing, CELL, 25, 1, 4);
  assert.eq(shot.projectile, 'spear', 'distinct flying art');
  for (const key of ['slot', 'x', 'y', 'vx', 'vy', 'speedMps', 'rangeM', 'pierce', 'damage']) {
    assert.eq(shot[key], arrow[key], key);
  }
  assert.eq(shot.damage, 25, 'a dragon buff does not scale the fixed damage');
  assert.eq(scene.save.inv[0].count, 1);
  assert.eq(scene.persisted, 1);
  assert.eq(scene.rebuilt, 1);
});

test('spear: last throw empties the hand without selecting the next stack', () => {
  const { scene, result } = throwSpear({ save: {
    energy: 50, inv: [{ id: 'spear', count: 1 }, { id: 'wood', count: 3 }], selSlot: 0,
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
    { save: { energy: 50, inv: [{ id: 'spear', count: 0 }], selSlot: 0 } },
    { save: { energy: 0, inv: [{ id: 'spear', count: 2 }], selSlot: 0 } },
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

test('spear: only the first enemy on its line takes the 25 damage', () => {
  const { scene } = throwSpear();
  const near = { id: 'near', kind: 'goblin', x: 117, y: 204 };
  const far = { id: 'far', kind: 'goblin', x: 131, y: 204 };
  const hits = fly(scene._shots[0], [far, near]);
  assert.eq(hits.length, 1);
  assert.eq(hits[0].enemy, near);
  assert.eq(hits[0].damage, 25);
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
  const scene = throwScene({ save: { energy: 50, inv: [{ id: 'rockfruit', count: 3 }], selSlot: 0 } });
  assert.truthy(CONSUMABLE_SPEC.rockfruit.immediate);
  assert.truthy(CONSUMABLE_SPEC.rockfruit.usable(scene));
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
    inv: [{ id: 'spear', count: 3 }, { id: 'rockfruit', count: 3 }, { id: 'spear', count: 2 }], selSlot: 0 } });
  assert.truthy(scene.useSpear());
  assert.eq(scene.throwCooldownLeft(), 3000);
  assert.includes(scene.throwActionLabel(), shortDuration(3000));
  scene.save.selSlot = 2;
  assert.falsy(scene.useSpear(), 'another stack cannot bypass cooldown');
  scene.save.selSlot = 1;
  scene.now += 2999;
  assert.falsy(CONSUMABLE_SPEC.rockfruit.usable(scene));
  assert.truthy(CONSUMABLE_SPEC.rockfruit.disabled(scene));
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
      inv: [{ id: 'rockfruit', count: 2 }], selSlot: 0 },
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
  assert.falsy(CONSUMABLE_SPEC.spear.disabled(scene));
});
})();
