(function () {
function method(name, deps = {}) {
  const match = APP_JS_SRC.match(new RegExp('\\n  ' + name + '\\(([^\\n]*)\\) \\{\\n([\\s\\S]*?)\\n  \\}\\n'));
  assert.truthy(match, name + ' exists');
  return new Function(...Object.keys(deps), 'return function(' + match[1] + '){' + match[2] + '}')(...Object.values(deps));
}
// The casts (fear, sleep) are CAST_ROWS rows cast by _castOnFoes; the table
// and the refusal formatter are lifted from app.js beside the methods.
const TABLE = (deps) => new Function(...Object.keys(deps),
  APP_JS_SRC.match(/\nconst CAST_ROWS = \{[\s\S]*?\n\};/)[0] + APP_JS_SRC.match(/\nfunction kept\(why, noun\) \{[^\n]*\n/)[0]
  + 'return { CAST_ROWS, kept };')(...Object.values(deps));
function scene(id, creatures = []) {
  const s = {
    save: { energy: 50, inv: [{ id, count: 2 }], selSlot: 0, caught: [] },
    startWorldM: { x: 100, y: 200 }, playerM: { x: 0, y: 0 }, depth: 3,
    facing: { x: 1, y: 0 }, cellM: 7, _shots: [], persisted: 0, rebuilt: 0,
    buildInventoryDOM() { this.rebuilt++; }, flash() {}, flashAtPlayer() {}, flashLoot() {},
    playerToWorldCell() { return { tx: 0, ty: 0 }; },
    worldMetersToScreen(x, y) { return { x, y }; },
  };
  const deps = {
    getSelectedSlot: save => save.inv[save.selSlot], consumeSelected,
    persistSave: () => s.persisted++, setOf: arr => new Set(arr || []),
    WorldGen: { forEachItemNear: (_kind, _tx, _ty, visit) => creatures.forEach(visit) },
    Particles: { onScreen: (_scene, x, y) => x >= 0 && x < 100 && y >= 0 && y < 100 },
    monsterRout: c => { c.routed = true; }, shortDuration: () => '15m',
    THUNDER_FLASH_MS: 350,
  };
  Object.assign(deps, TABLE(deps));
  for (const name of ['_selectedConsumable', '_consumeSelected', '_finishInventoryChange', '_spendScroll', '_enemiesWhere',
    '_onscreenEnemies', '_castOnFoes', 'useFireballScroll', 'useTreasureMap']) {
    s[name] = method(name, deps);
  }
  s.useFearScroll = () => s._castOnFoes('fear_scroll');
  s.useSleepPowder = () => s._castOnFoes('sleep_powder');
  return s;
}
function assertSpent(s, id, learned) {
  assert.eq(s.save.inv[0].count, 1);
  assert.eq(s.persisted, 1);
  assert.eq(s.rebuilt, 1);
  assert.eq((s.save.usedScrolls || []).includes(id), learned);
}

test('scroll actions: fireball success consumes and remembers recipe only once', () => {
  const s = scene('fireball_scroll');
  assert.eq(s.useFireballScroll(), true);
  assertSpent(s, 'fireball_scroll', true);
  assert.eq(s._shots.length, 1);
  assert.eq(s._shots[0].x, 100);
  assert.eq(s._shots[0].y, 200);
  assert.eq(s._shots[0].projectile, 'fireball');
  assert.eq(s.useFireballScroll(), true);
  assert.eq(s.save.usedScrolls.length, 1);
  assert.eq(s.save.inv.length, 0);
  assert.eq(s.save.selSlot, -1);
});

test('scroll actions: fireball invalid heading retains the item and recipe stays unknown', () => {
  const s = scene('fireball_scroll');
  s.facing = { x: 0, y: 0 };
  assert.eq(s.useFireballScroll(), false);
  assert.eq(s.save.inv[0].count, 2);
  assert.eq(s._shots.length, 0);
  assert.eq(s.persisted, 0);
  assert.eq(s.save.usedScrolls, undefined);
});

test('scroll actions: screen effects exclude offscreen enemies, caught foes, animals and pets', () => {
  const enemy = { id: 'enemy', kind: 'goblin', x: 80, y: 80 };
  const guard = { id: 'guard', kind: 'goblin', lair: 'ruin', x: 20, y: 20 };
  const creatures = [enemy, guard,
    { id: 'offscreen', kind: 'goblin', x: 101, y: 20 },
    { id: 'caught', kind: 'goblin', x: 20, y: 20 },
    { id: 'crow', kind: 'crow', x: 20, y: 20 },
    { id: 'released_pet', kind: 'slime', x: 20, y: 20 }];
  const s = scene('fear_scroll', creatures);
  s.save.caught = ['caught'];
  const targets = s._onscreenEnemies();
  assert.eq(targets.length, 2);
  assert.truthy(targets.includes(enemy));
  assert.truthy(targets.includes(guard));
});

test('scroll actions: fear retreats every visible foe and cancels pending attacks', () => {
  const c = { id: 'guard', kind: 'goblin', lair: 'ruin', x: 20, y: 30,
    _attackWindupUntil: 999, _lungeWindupUntil: 999, _abilityWindupUntil: 999 };
  const s = scene('fear_scroll', [c]);
  const before = performance.now();
  assert.eq(s.useFearScroll(), true);
  assertSpent(s, 'fear_scroll', true);
  assert.truthy(c.routed);
  assert.truthy(c._fearUntilT >= before + CONSUMABLE_SPEC.fear_scroll.durationMs);
  assert.eq(c._startX, 20); assert.eq(c._targetY, 30);
  assert.falsy(c._attackWindupUntil); assert.falsy(c._lungeWindupUntil); assert.falsy(c._abilityWindupUntil);
  assert.eq(c._statusPop?.label, Combat.STATUS_LOOKS.fear.label, 'the status announces itself (Combat.applyFear)');
});

test('scroll actions: sleep powder applies the existing sleep field without teaching a scroll', () => {
  const c = { id: 'enemy', kind: 'goblin', x: 80, y: 80, _attackWindupUntil: 999,
    _moving: true, _attackAim: { x: 1, y: 0 }, _batFlight: {}, _batSwooping: true };
  const s = scene('sleep_powder', [c]);
  const before = Date.now();
  assert.eq(s.useSleepPowder(), true);
  assertSpent(s, 'sleep_powder', false);
  assert.truthy(c._sleepUntil >= before + Combat.FLOWER_STATUS_MS);
  assert.truthy(Combat.isSleeping(c));
  assert.eq(c._startX, 80); assert.eq(c._targetY, 80);
  assert.eq(c._attackWindupUntil, null);
  assert.eq(c._attackAim, null);
  assert.eq(c._moving, false);
  assert.eq(c._batFlight, null);
  assert.eq(c._batSwooping, false);
  Combat.damage(c, 1);
  assert.falsy(Combat.isSleeping(c), 'existing sleep breaks when damaged');
});

test('scroll actions: no visible targets keeps fear scroll and sleep powder', () => {
  for (const [id, action] of [['fear_scroll', 'useFearScroll'], ['sleep_powder', 'useSleepPowder']]) {
    const s = scene(id, [{ id: 'far', kind: 'goblin', x: 200, y: 200 }]);
    assert.eq(s[action](), false);
    assert.eq(s.save.inv[0].count, 2);
    assert.eq(s.persisted, 0);
    assert.eq(s.save.usedScrolls, undefined);
  }
});

test('scroll actions: offensive consumables refuse use while downed or wrongly selected', () => {
  for (const [id, action] of [['fireball_scroll', 'useFireballScroll'], ['fear_scroll', 'useFearScroll'], ['sleep_powder', 'useSleepPowder']]) {
    for (const invalid of ['downed', 'wrong', 'empty']) {
      const c = { id: 'enemy', kind: 'goblin', x: 20, y: 20 };
      const s = scene(id, [c]);
      if (invalid === 'downed') s.save.energy = 0;
      if (invalid === 'wrong') s.save.inv[0].id = 'wood';
      if (invalid === 'empty') s.save.inv[0].count = 0;
      assert.eq(s[action](), false);
      assert.eq(s.persisted, 0);
      assert.eq(s._shots.length, 0);
      assert.eq(c.routed, undefined);
      assert.eq(c._sleepUntil, undefined);
    }
  }
});

test('scroll actions: map selects T4/T5, remembers depth, and lasts fifteen minutes', () => {
  const s = scene('treasure_map');
  s.findNearestUnopenedChest = tiers => {
    assert.eq(JSON.stringify(tiers), '[4,5]');
    return { id: 'treasure', x: 300, y: 400 };
  };
  const before = Date.now();
  assert.eq(s.useTreasureMap(), true);
  assertSpent(s, 'treasure_map', true);
  assert.eq(CONSUMABLE_SPEC.treasure_map.durationMs, 15 * 60 * 1000);
  assert.eq(s.save.treasureCompass.targetId, 'treasure');
  assert.eq(s.save.treasureCompass.depth, 3);
  assert.eq(s.save.treasureCompass.x, 300); assert.eq(s.save.treasureCompass.y, 400);
  assert.truthy(s.save.treasureCompass.until >= before + 15 * 60 * 1000);
  assert.truthy(s.save.treasureCompass.until <= Date.now() + 15 * 60 * 1000);
});

test('scroll actions: map without eligible chest retains item and existing marker', () => {
  const s = scene('treasure_map');
  const marker = s.save.treasureCompass = { targetId: 'old' };
  s.findNearestUnopenedChest = () => null;
  assert.eq(s.useTreasureMap(), false);
  assert.eq(s.save.inv[0].count, 2);
  assert.eq(s.save.treasureCompass, marker);
  assert.eq(s.persisted, 0);
  assert.eq(s.save.usedScrolls, undefined);
});

test('scroll actions: nearest chest uses only active level cache, tier and unspent chest filters', () => {
  const chest = (id, x, tier, extra = {}) => ({ id, kind: 'chest', x, y: 200, tier, ...extra });
  const surface = chest('surface', 101, 5);
  const far = chest('far', 130, 5), near = chest('near', 120, 4);
  const world = { tileCache: new Map([['surface', { objects: [surface] }]]),
    forEachItem(prop, fn) { for (const e of this.tileCache.values()) for (const o of e[prop] || []) if (fn(o, e)) return; } };
  const s = scene('treasure_map');
  s._nearestObject = method('_nearestObject', { WorldGen: world });
  const find = method('findNearestUnopenedChest', {
    WorldGen: world, spentSets: () => new Set(['spent']),
    chestTier: c => c.tier, isSpent: (c, spent) => spent.has(c.id),
    macroFor: c => c.macro, isBarrel: c => c.barrel,
    isBikeRack: c => c.bike, isPotOfGold: c => c.gold,
  });
  assert.eq(find.call(s, [4, 5]), surface);
  world.tileCache = new Map([['cave', { objects: [far, near,
    chest('low', 101, 3), chest('spent', 102, 5), chest('stall', 103, 5, { macro: true }),
    chest('barrel', 104, 4, { barrel: true }), chest('bike', 105, 4, { bike: true }),
    chest('gold', 106, 4, { gold: true }), { id: 'tree', kind: 'tree', x: 100, y: 200 }] }]]);
  assert.eq(find.call(s, [4, 5]), near, 'old level chest never considered');
  assert.eq(find.call(s, [5]), far);
  assert.eq(find.call(s).id, 'low', 'existing untiered compass stays compatible');
});
})();
