// These are game rules shared by every entrance, not UI snapshots.
(function () {
  test('dungeon progression: five distinct arena victories open L4', () => {
    const save = {};
    assert.falsy(DungeonProgression.canEnterDepth(save, 4));
    for (let n = 0; n < 4; n++) DungeonProgression.completeChallenge(save, `trial${n}`);
    DungeonProgression.completeChallenge(save, 'trial0');
    assert.falsy(DungeonProgression.canEnterDepth(save, 4), 'repeats never count');
    DungeonProgression.completeChallenge(save, 'trial4');
    assert.truthy(DungeonProgression.canEnterDepth(save, 4));
    assert.truthy(DungeonProgression.canEnterDepth(JSON.parse(JSON.stringify(save)), 5));
  });
  test('dungeon progression: L1 descent requires rope or repaired lift route', () => {
    assert.falsy(DungeonProgression.canUseDescent({}, 1, 2, 'sapphire'));
    assert.falsy(DungeonProgression.canUseDescent({}, 1, 2, 'stairs'));
    assert.truthy(DungeonProgression.canUseDescent({}, 1, 2, 'rope'));
    assert.falsy(DungeonProgression.canUseDescent({}, 1, 2, 'elevator'));
    assert.truthy(DungeonProgression.canUseDescent({ elevators: { repaired: true } }, 1, 2, 'elevator'));
    assert.truthy(DungeonProgression.canUseDescent({}, 1, 0, 'stairs'));
    assert.falsy(DungeonProgression.canUseDescent({}, 3, 4, 'rope'));
    assert.truthy(DungeonProgression.canUseDescent({}, 5, 4, 'rope'), 'older saves can still climb out');
  });
  test('dungeon progression: stone requires L3, T3+, and at least one kilometre', () => {
    const eligible = { depth: 3, tier: 3, distanceM: 1000 };
    assert.truthy(DungeonProgression.portalStoneDue({}, eligible));
    assert.falsy(DungeonProgression.portalStoneDue({}, { ...eligible, distanceM: 999.99 }));
    assert.falsy(DungeonProgression.portalStoneDue({}, { ...eligible, tier: 2 }));
    assert.falsy(DungeonProgression.portalStoneDue({}, { ...eligible, depth: 2 }));
    assert.falsy(DungeonProgression.portalStoneDue({ dungeonProgression: { portalStoneFound: true } }, eligible));
  });
  test('dungeon progression: elevator repair is atomic, permanent and opens its routes', () => {
    const save = { inv: [{ id: 'wood', count: 9 }, { id: 'rubble', count: 8 }] };
    assert.falsy(Elevators.repair(save));
    assert.eq(Inventory.count(save, 'wood'), 9, 'failed repair spends nothing');
    save.inv[1].count = 9;
    assert.truthy(Elevators.repair(save));
    assert.eq(Inventory.count(save, 'wood'), 0);
    assert.eq(Inventory.count(save, 'rubble'), 0);
    assert.truthy(Elevators.isRepaired(JSON.parse(JSON.stringify(save))));
    assert.eq(Elevators.unlockedFloors(save).join(','), '1,2,3');
    assert.falsy(Elevators.repair(save), 'repair cannot charge twice');
  });
  test('dungeon progression: first eligible chest grants one stone and ordinary loot resumes', () => {
    const original = globalThis.pickReward;
    const save = { inv: [], opened: [], relics: {}, armor: {}, money: 0 };
    let modal;
    const scene = makeScene({
      depth: 3, save, _elevatorHomePosition: () => ({ x: 0, y: 0 }),
      invRoomFor: id => Inventory.roomFor(save, id),
      addToInv: (id, qty) => Inventory.add(save, id, qty).accepted,
      showChestRewardModal(value) { modal = value; },
    });
    try {
      globalThis.pickReward = () => ({ kind: 'item', id: 'potato', qty: 1 });
      const ctx = makeCtx(scene, save);
      const chest = { kind: 'chest', id: 'progression_first', x: 1000, y: 0, depth: 3, tierSeed: 3 };
      INTERACTABLES.chest.custom(ctx, chest);
      assert.eq(Inventory.count(save, 'portal_stone'), 1);
      assert.truthy(save.dungeonProgression.portalStoneFound);
      assert.eq(modal.art, 'progression_portal');
      INTERACTABLES.chest.custom(ctx, { ...chest, id: 'progression_second' });
      assert.eq(Inventory.count(save, 'portal_stone'), 1);
      assert.eq(Inventory.count(save, 'potato'), 1);
    } finally { globalThis.pickReward = original; }
  });
  function liftedMethod(name, deps) {
    const start = SCENE_SRC.indexOf(`\n  ${name}(`);
    const end = SCENE_SRC.indexOf('\n  }', start) + 4;
    return new Function(...Object.keys(deps), `return ({${SCENE_SRC.slice(start, end)}}).${name};`)(...Object.values(deps));
  }
  function ropeScene(depth, progress = {}) {
    const scene = {
      depth, save: { depth, energy: 50, inv: [{ id: 'rope', count: 1 }], dungeonProgression: progress },
      startWorldM: {x: 0,y: 0}, playerM: {x: 0,y: 0}, feetOffsetM: 0,
      dugWallSet: new Set(), cellAt: () => ({cellIX: 1,cellIY: 2}),
      _selectedConsumable: () => true, flashAtPlayer() {}, flash() {},
      buildInventoryDOM() {}, syncMoveTarget() {}, _storySplashOnce() {},
      cameras: {main: {setBackgroundColor() {}}}, ensureTilesAround: () => Promise.resolve(),
    };
    const deps = {
      DungeonProgression, Arena, WorldGen: {setDepth() {}},
      playerWorldM: () => ({x: 0,y: 0}), cellKeyFromAbsCell: (x,y) => `${x}_${y}`,
      persistSave() {}, consumeSelected(save) { save.inv[0].count--; },
    };
    scene.changeDepth = liftedMethod('changeDepth', deps);
    scene.useRope = liftedMethod('useRope', deps);
    return scene;
  }
  test('dungeon progression: actual rope preserves inventory and walls at locked L4', () => {
    const scene = ropeScene(3);
    assert.eq(scene.useRope(1), false);
    assert.eq(scene.depth, 3);
    assert.eq(scene.save.inv[0].count, 1);
    assert.eq(scene.dugWallSet.size, 0);
    scene.save.dungeonProgression.level4Key = true;
    assert.eq(scene.useRope(1), true);
    assert.eq(scene.depth, 4);
    assert.eq(scene.save.inv[0].count, 0);
    assert.truthy(scene.dugWallSet.has('4:1_2'));
  });
  test('dungeon progression: central transition blocks stairs, multi-floor bypasses and unearned lift', () => {
    const scene = ropeScene(1), anchor = {x: 0,y: 0};
    scene.changeDepth(1, anchor);
    assert.eq(scene.depth, 1);
    scene.changeDepth(2, { ...anchor, descentSource: 'rope' });
    assert.eq(scene.depth, 1);
    scene.changeDepth(2, { ...anchor, elevator: true });
    assert.eq(scene.depth, 1);
    scene.save.elevators = {repaired: true};
    scene.changeDepth(2, { ...anchor, elevator: true });
    assert.eq(scene.depth, 3);
    scene.save.dungeonProgression.level4Key = true;
    scene.changeDepth(1, { ...anchor, elevator: true });
    assert.eq(scene.depth, 3, 'even a repaired lift never extends below its stops');
  });
  test('dungeon progression: the broken elevator is available on L1 with a carved landing', () => {
    const entry = {_spawned: true, objects: []};
    const scene = {depth: 1, save: {homeElevator: {x: 100,y: 200}},
      _elevatorHomePosition: () => null, cellAt: () => ({cellIX: 7,cellIY: 8}), dugWallSet: new Set()};
    const ensure = liftedMethod('ensureDungeonElevatorObject', {
      Elevators, WorldGen: {tileKey: () => 'tile', tileCache: new Map([['tile',entry]])},
      worldMetersToTile: () => ({tx: 0,ty: 0}), cellKeyFromAbsCell: (x,y) => `${x}_${y}`,
    });
    ensure.call(scene); ensure.call(scene);
    assert.eq(entry.objects.length, 1, 'loading adjacent tiles never duplicates the lift');
    assert.truthy(entry.objects[0].elevator);
    assert.truthy(scene.dugWallSet.has('1:7_8'));
    scene.depth = 4;
    ensure.call(scene);
    assert.eq(entry.objects.length, 1, 'the lift never appears on a locked lower route');
  });
  test('dungeon progression: home fallback works before a starter shop or memo exists', () => {
    const fallback = {x: 10,y: 20};
    const position = liftedMethod('_elevatorHomePosition', {
      WorldGen: {tileCacheFor: () => new Map()}, HomeArea: {worldM: fallback},
    });
    const scene = {save: {}};
    assert.eq(position.call(scene), fallback, 'missing IDs must not match an absent memo');
    const crates = {x: 30,y: 40};
    scene.save.starterCratesAt = crates;
    assert.eq(position.call(scene), crates, 'starter supply anchor wins over the initial origin');
    scene.save.starterShopId = 'home';
    const memo = {x: 50,y: 60};
    scene._homePosMemo = {id: 'home',pos: memo};
    assert.eq(position.call(scene), memo, 'a matching real memo remains usable');
  });
})();
