// These are game rules shared by every entrance, not UI snapshots.
(function () {
  test('dungeon progression: five distinct arena victories open L5', () => {
    const save = {};
    assert.truthy(DungeonProgression.canEnterDepth(save, 4), 'the fourth depth is open');
    assert.falsy(DungeonProgression.canEnterDepth(save, 5));
    for (let n = 0; n < 4; n++) DungeonProgression.completeChallenge(save, `trial${n}`);
    DungeonProgression.completeChallenge(save, 'trial0');
    assert.falsy(DungeonProgression.canEnterDepth(save, 5), 'repeats never count');
    DungeonProgression.completeChallenge(save, 'trial4');
    assert.truthy(DungeonProgression.canEnterDepth(save, 5));
    assert.truthy(DungeonProgression.canEnterDepth(JSON.parse(JSON.stringify(save)), 6));
  });
  test('dungeon progression: L1 descent requires rope or repaired lift route', () => {
    assert.falsy(DungeonProgression.canUseDescent({}, 1, 2, 'sapphire'));
    assert.falsy(DungeonProgression.canUseDescent({}, 1, 2, 'stairs'));
    assert.truthy(DungeonProgression.canUseDescent({}, 1, 2, 'rope'));
    assert.falsy(DungeonProgression.canUseDescent({}, 1, 2, 'elevator'));
    assert.truthy(DungeonProgression.canUseDescent({ elevators: { repaired: true, partsFound: true } }, 1, 2, 'elevator'));
    assert.truthy(DungeonProgression.canUseDescent({}, 1, 0, 'stairs'));
    assert.falsy(DungeonProgression.canUseDescent({}, 3, 4, 'rope'));
    assert.truthy(DungeonProgression.canUseDescent({}, 5, 4, 'rope'), 'older saves can still climb out');
    assert.truthy(DungeonProgression.canUseDescent({ dungeonProgression: { level4Key: true } }, 5, 6, 'rope'), 'open segments keep the rope');
  });
  test('dungeon progression: the rope never breaks a sealed segment', () => {
    assert.falsy(DungeonProgression.canUseDescent({}, 2, 3, 'rope'), '2 -> 3 is the elevator');
    assert.falsy(DungeonProgression.canUseDescent({}, 6, 7, 'rope'), '6 -> 7 is the wizard key');
    assert.falsy(DungeonProgression.canUseDescent({ dungeonProgression: { level4Key: true } }, 6, 7, 'rope'),
      'the arena key never lends the rope a seal');
    assert.truthy(DungeonProgression.canUseDescent({ elevators: { repaired: true, partsFound: true } }, 2, 3, 'elevator'),
      'the sealed segment keeps its elevator');
    assert.truthy(DungeonProgression.ropeCanDescend(1) && DungeonProgression.ropeCanDescend(5)
      && DungeonProgression.ropeCanDescend(7) && DungeonProgression.ropeCanDescend(8));
    assert.falsy(DungeonProgression.ropeCanDescend(2) || DungeonProgression.ropeCanDescend(3)
      || DungeonProgression.ropeCanDescend(4) || DungeonProgression.ropeCanDescend(6));
  });
  test('dungeon progression: stone requires L4, T3+, and at least one kilometre', () => {
    const eligible = { depth: 4, tier: 4, distanceM: 1000 };
    assert.truthy(DungeonProgression.portalStoneDue({}, eligible));
    assert.falsy(DungeonProgression.portalStoneDue({}, { ...eligible, distanceM: 999.99 }));
    assert.falsy(DungeonProgression.portalStoneDue({}, { ...eligible, tier: 3 }), 'effective T3 is the floor-4 minimum and never enough');
    assert.falsy(DungeonProgression.portalStoneDue({}, { ...eligible, depth: 3 }));
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
    assert.eq(Elevators.unlockedFloors(save).join(','), '1');
    assert.falsy(DungeonProgression.canUseDescent(save, 1, 2, 'elevator'));
    assert.truthy(DungeonProgression.canUseDescent(save, 0, 1, 'elevator'));
    assert.falsy(Elevators.repair(save), 'repair cannot charge twice');
  });
  test('lift: tenth L1 chest grants permanent parts despite a full bag, once only', () => {
    const original = globalThis.pickReward;
    const save = { inv: [], opened: [], relics: {}, armor: {}, money: 0, elevators: { repaired: true } };
    let story, rolls = 0;
    const scene = makeScene({ depth: 1, save, invRoomFor: () => 0,
      showMessageModal(value) { story = value; } });
    const ctx = makeCtx(scene, save);
    const open = (id, depth = 1, extra = {}) => {
      scene.depth = depth;
      INTERACTABLES.chest.custom(ctx, { kind: 'chest', id, depth, tierSeed: 5, x: 0, y: 0, ...extra });
    };
    try {
      globalThis.pickReward = () => { rolls++; return {kind: 'cash', amount: 1}; };
      open('surface', 0); open('deeper', 2); open('barrel', 1, {barrel: true});
      assert.falsy(save.elevators.level1Chests);
      for (let n = 0; n < 9; n++) open('lift_' + n);
      assert.eq(save.elevators.level1Chests, 9);
      open('lift_0');
      assert.eq(save.elevators.level1Chests, 9, 'reopening never counts');
      assert.eq(Elevators.unlockedFloors(save).join(','), '1');
      const before = rolls;
      open('lift_parts');
      assert.eq(rolls, before, 'parts replace the tenth reward regardless of rarity');
      assert.eq(story.header, 'Elevator parts');
      assert.eq(Elevators.unlockedFloors(save).join(','), '1,2,3');
      assert.eq(Elevators.unlockedFloors(JSON.parse(JSON.stringify(save))).join(','), '1,2,3');
      open('lift_parts');
      assert.eq(save.elevators.level1Chests, 10);
      open('lift_next');
      assert.eq(rolls, before + 1, 'ordinary rewards resume');
    } finally { globalThis.pickReward = original; }
  });
  test('lift: parts found before the wood and stone repair survive it', () => {
    const save = { inv: [{id: 'wood', count: 9}, {id: 'rubble', count: 9}] };
    for (let n = 0; n < 10; n++) Elevators.recordChest(save);
    assert.eq(Elevators.unlockedFloors(save).length, 0);
    assert.truthy(Elevators.repair(save));
    assert.eq(Elevators.unlockedFloors(save).join(','), '1,2,3');
  });
  test('dungeon progression: first eligible chest grants one stone and ordinary loot resumes', () => {
    const original = globalThis.pickReward;
    const save = { inv: [], opened: [], relics: {}, armor: {}, money: 0 };
    let modal;
    const scene = makeScene({
      depth: 4, save, _elevatorHomePosition: () => ({ x: 0, y: 0 }),
      invRoomFor: id => Inventory.roomFor(save, id),
      addToInv: (id, qty) => Inventory.add(save, id, qty).accepted,
      showChestRewardModal(value) { modal = value; },
    });
    try {
      globalThis.pickReward = () => ({ kind: 'item', id: 'potato', qty: 1 });
      const ctx = makeCtx(scene, save);
      const chest = { kind: 'chest', id: 'progression_first', x: 1000, y: 0, depth: 4, tierSeed: 3 };
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
  test('dungeon progression: actual rope preserves inventory and walls at locked L5', () => {
    const scene = ropeScene(5);
    assert.eq(scene.useRope(1), false);
    assert.eq(scene.depth, 5);
    assert.eq(scene.save.inv[0].count, 1);
    assert.eq(scene.dugWallSet.size, 0);
    scene.save.dungeonProgression.level4Key = true;
    assert.eq(scene.useRope(1), true);
    assert.eq(scene.depth, 6);
    assert.eq(scene.save.inv[0].count, 0);
    assert.truthy(scene.dugWallSet.has('6:1_2'));
  });
  test('dungeon progression: central transition blocks stairs, multi-floor bypasses and unearned lift', () => {
    const scene = ropeScene(1), anchor = {x: 0,y: 0};
    scene.changeDepth(1, anchor);
    assert.eq(scene.depth, 1);
    scene.changeDepth(2, { ...anchor, descentSource: 'rope' });
    assert.eq(scene.depth, 1);
    scene.changeDepth(2, { ...anchor, elevator: true });
    assert.eq(scene.depth, 1);
    scene.save.elevators = {repaired: true, partsFound: true};
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

  function chestHarness(over = {}) {
    const save = { inv: [], opened: [], relics: {}, armor: {}, money: 0 };
    const harness = {save, modal: null, room: null};
    const scene = makeScene({
      depth: 4, save, _elevatorHomePosition: () => ({x: 0,y: 0}),
      invRoomFor: id => harness.room ?? Inventory.roomFor(save,id),
      addToInv: (id,qty) => Inventory.add(save,id,qty).accepted,
      showChestRewardModal(value) { harness.modal = value; }, ...over,
    });
    harness.open = (chestOver = {}) => {
      const original = globalThis.pickReward;
      try {
        globalThis.pickReward = () => ({kind: 'item',id: 'potato',qty: 1});
        return INTERACTABLES.chest.custom(makeCtx(scene,save), {
          kind: 'chest',id: 'boundary_chest',x: 1000,y: 0,depth: scene.depth,tierSeed: 3,...chestOver,
        });
      } finally { globalThis.pickReward = original; }
    };
    return harness;
  }
  test('dungeon progression: actual chest boundaries reject near-home, other depths and low-tier treasure', () => {
    for (const candidate of [
      {name: 'just short', scene: {}, chest: {x: 999.999}},
      {name: 'surface', scene: {depth: 0}, chest: {}},
      {name: 'L3', scene: {depth: 3}, chest: {}},
      {name: 'L5', scene: {depth: 5}, chest: {}},
      {name: 'T2', scene: {}, chest: {tierSeed: 1}},
      {name: 'supply box', scene: {}, chest: {crate: true}},
    ]) {
      const h = chestHarness(candidate.scene);
      h.open(candidate.chest);
      assert.eq(Inventory.count(h.save,'portal_stone'),0,candidate.name);
      assert.falsy(h.save.dungeonProgression?.portalStoneFound,candidate.name);
      assert.eq(Inventory.count(h.save,'potato'),1,candidate.name+' keeps normal reward');
    }
    for (const point of [{x: 1000,y: 0},{x: 600,y: 800},{x: -1000,y: 0}]) {
      const h = chestHarness(); h.open({...point,tierSeed: 2});
      assert.eq(Inventory.count(h.save,'portal_stone'),1,'exact one kilometre at effective T4');
    }
  });
  test('dungeon progression: searched chest and unknown home cannot award the portal stone', () => {
    const opened = chestHarness(); opened.save.opened.push('boundary_chest'); opened.open();
    assert.eq(Inventory.count(opened.save,'portal_stone'),0);
    const originalHome = HomeArea.worldM;
    try {
      HomeArea.worldM = null;
      const unknown = chestHarness({_elevatorHomePosition: () => null}); unknown.open();
      assert.eq(Inventory.count(unknown.save,'portal_stone'),0);
    } finally { HomeArea.worldM = originalHome; }
  });
  test('dungeon progression: full ordinary stacks do not prevent a unique portal reward', () => {
    const h = chestHarness();
    Inventory.add(h.save,'potato',Inventory.stackCap(h.save));
    Inventory.add(h.save,'wood',Inventory.stackCap(h.save));
    h.open();
    assert.eq(Inventory.count(h.save,'portal_stone'),1,'capacity is per item, not a global bag limit');
    assert.truthy(h.save.dungeonProgression.portalStoneFound);
  });
  test('dungeon progression: deferred portal reward survives leave, retry and repeated chest taps', () => {
    const h = chestHarness(); h.room = 0; h.open();
    assert.eq(Inventory.count(h.save,'portal_stone'),0);
    assert.falsy(h.save.dungeonProgression?.portalStoneFound);
    h.modal.actions[0].onClick();
    assert.eq(h.save.chestHold.boundary_chest.id,'portal_stone');
    assert.falsy(h.save.opened.includes('boundary_chest'));
    h.room = 1; h.open(); h.open();
    assert.eq(Inventory.count(h.save,'portal_stone'),1);
    assert.truthy(h.save.dungeonProgression.portalStoneFound);
    assert.eq(h.save.opened.filter(id => id === 'boundary_chest').length,1);
    assert.falsy(h.save.chestHold.boundary_chest);
  });
  test('dungeon progression: every repaired elevator route reaches the requested stop at the home anchor', () => {
    for (const partsFound of [false, true]) for (const from of Elevators.FLOORS) for (const to of (partsFound ? Elevators.FLOORS : [0, 1])) {
      if (from === to) continue;
      const scene = ropeScene(from);
      scene.save.elevators = {repaired: true, partsFound};
      scene.save.homeElevator = {x: 123,y: 456};
      const buttons = [];
      const node = label => ({label,style: {},addEventListener(type,handler) { this.click = handler; }});
      scene.makeModalShell = () => ({wrap: {remove() {}},box: {appendChild() {}},mount() {},mkBtn(label) {const button = node(label);buttons.push(button);return button;}});
      const open = liftedMethod('openElevator', {
        Elevators, document: {createElement: () => node('description')}, persistSave() {}, cellKeyFromAbsCell: (x,y) => `${x}_${y}`,
      });
      open.call(scene, {});
      if (!partsFound) {
        assert.falsy(buttons.some(button => button.label === 'Floor 2' || button.label === 'Floor 3'));
      }
      const destination = buttons.find(button => button.label === (to === 0 ? 'Home' : `Floor ${to}`));
      assert.truthy(destination,`${from} has a menu route to ${to}`);
      destination.click({stopPropagation() {}});
      assert.eq(scene.depth,to,`${from} to ${to}`);
      assert.eq(scene.playerM.x,123); assert.eq(scene.playerM.y,456);
      assert.eq(scene.save.inv[0].count,1,'lift uses no rope');
      if (to > 0) assert.truthy(scene.dugWallSet.has(`${to}:1_2`),'arrival is open');
    }
  });
  test('dungeon progression: rope early refusals preserve both supplies and terrain', () => {
    for (const [depth,delta,setup] of [
      [0,-1,() => {}], [1,1,s => {s.save.energy = 0;}], [1,1,s => {s._selectedConsumable = () => false;}],
    ]) {
      const scene = ropeScene(depth); setup(scene);
      assert.eq(scene.useRope(delta),false);
      assert.eq(scene.depth,depth); assert.eq(scene.save.inv[0].count,1); assert.eq(scene.dugWallSet.size,0);
    }
    const escape = ropeScene(1); escape.save.energy = 0;
    assert.eq(escape.useRope(-1),true,'exhaustion never traps the player underground');
    assert.eq(escape.depth,0); assert.eq(escape.save.inv[0].count,0);
  });
  test('dungeon progression: refused rope travel rolls back only its new landing', () => {
    for (const wasDug of [false,true]) {
      const scene = ropeScene(1); scene.changeDepth = () => false;
      if (wasDug) scene.dugWallSet.add('2:1_2');
      assert.eq(scene.useRope(1),false);
      assert.eq(scene.depth,1); assert.eq(scene.save.inv[0].count,1);
      assert.eq(scene.dugWallSet.has('2:1_2'),wasDug,'preexisting terrain survives; failed new landing does not');
    }
  });
})();
