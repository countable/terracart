(() => {
  const scene = (extra = {}) => ({ depth: 0, tileEdgeM: 200, startWorldM: { x: 100, y: 100 }, save: { starterCratesAt: { x: 100, y: 100 } }, ...extra });
  const object = (id, x = 105, y = 105, extra = {}) => ({ id, kind: 'tree', x, y, ...extra });
  function entry() {
    const baseGrid = new Uint8Array(400).fill(2);
    return { cellsPerEdge: 20, grid: baseGrid.slice(), baseGrid,
      variantBaseGrid: new Uint8Array(400).fill(1), objects: [], wildplants: [], creatures: [], _spawned: true };
  }
  test('Home variant: exactly 50 metres around the frozen starter anchor, surface only', () => {
    const s = scene({ save: { starterCratesAt: { x: 0, y: 0 } } });
    assert.eq(HomeVariant.RADIUS_M, 50);
    assert.truthy(HomeVariant.contains(s, 30, 40));
    assert.falsy(HomeVariant.contains(s, 30, 40.01));
    assert.falsy(HomeVariant.contains(s, 40, 40));
    assert.falsy(HomeVariant.contains({ ...s, depth: 1 }, 0, 0));
    assert.truthy(HomeVariant.contains({ ...s, homeWorldPos: () => ({ x: 999, y: 999 }) }, 0, 0));
  });
  test('Home variant: a projection origin without a frozen Home does not claim terrain', () => {
    const s = scene({ save: {} }), e = entry();
    e.objects = [object('incidental')];
    assert.eq(HomeVariant.anchor(s), null);
    assert.falsy(HomeVariant.contains(s, 100, 100));
    assert.falsy(HomeVariant.apply(s, e, 0, 0));
    assert.eq(e.homeVariant, undefined); assert.eq(e.objects.length, 1);
    assert.truthy(HomeVariant.allows(s, e.objects[0]));
  });
  test('Home variant: only authored starter content, mapped homes and player possessions remain', () => {
    const s = scene(), e = entry();
    const kept = [object('chest_start_1_2_1'), object('stash_start_1_2_1'), object('starter_tree_1_2'),
      object('chicken_greeter_1_2', 105, 105, { kind: 'chicken' }),
      object('npc_wanderer_1_2', 105, 105, { kind: 'npc' }), object('pet', 105, 105, { pet: true }),
      object('planted', 105, 105, { planted: true }), object('mapped', 105, 105, { kind: 'house' }),
      object('outside', 180, 180)];
    e.objects = [...kept, object('forest'), object('nexus', 105, 105, { zoneVariant: 'grove' }), object('road', 105, 105, { _street: 'lantern' })];
    e.creatures = [object('ambient_chicken', 105, 105, { kind: 'chicken' }), kept[3], kept[4]];
    HomeVariant.apply(s, e, 0, 0);
    assert.eq(e.objects.map(o => o.id).join(','), kept.map(o => o.id).join(','));
    assert.eq(e.creatures.map(o => o.id).join(','), `${kept[3].id},${kept[4].id}`);
    assert.falsy(HomeVariant.allows(s, object('ambient')));
    assert.truthy(HomeVariant.allows(s, kept[4]));
  });
  test('Home variant: clears all live content streams and overlapping multi-cell footprints', () => {
    const s = scene(), e = entry();
    const wide = object('wide', 155, 105, { _footprintCells: { width: 3, height: 1 } });
    for (const key of ['objects', 'wildplants', 'traps', 'extraTreasures', 'parkingTreasures', 'streetLairs', 'reefCorals', 'spiderPathWebs', 'pathVents']) {
      e[key] = [wide, object('outside', 180, 180)];
    }
    e.treasure = object('treasure');
    HomeVariant.apply(s, e, 0, 0);
    for (const key of ['objects', 'wildplants', 'traps', 'extraTreasures', 'parkingTreasures', 'streetLairs', 'reefCorals', 'spiderPathWebs', 'pathVents']) assert.eq(e[key].length, 1, key);
    assert.eq(e.treasure, null);
  });
  test('Home variant: restores surface ground without changing generated snapshots or player terrain', () => {
    const s = scene(), e = entry(), index = 10 * 20 + 10;
    e.grid[index + 1] = 9;
    e.genObjects = [object('world_tree')]; e.objects = e.genObjects.slice();
    e.zone = { coverage: new Uint8Array(400).fill(1) };
    e.streetArea = new Uint8Array(400).fill(1);
    const marks = new Uint8Array(400).fill(7);
    e.streetMarks = marks; e.streetDress = { marks };
    const ground = new Uint8Array(400).fill(3); e.streetGround = ground;
    e.slowCells = new Map([[index, 'tar'], [0, 'tar']]);
    HomeVariant.apply(s, e, 0, 0);
    assert.eq(e.grid[index], 1); assert.eq(e.grid[index + 1], 9);
    assert.eq(e.baseGrid[index], 2); assert.eq(e.genObjects.length, 1);
    assert.eq(e.zone.coverage[index], 1); assert.eq(e.streetArea[index], 1);
    assert.eq(e.streetDress.marks[index], 7); assert.eq(ground[index], 3);
    assert.eq(e.streetMarks[index], 0); assert.eq(e.streetGround[index], 0);
    assert.falsy(e.slowCells.has(index)); assert.truthy(e.slowCells.has(0));
    assert.eq(WorldGen.variantOwnerAt(e, index), 'home');
    assert.eq(HabitatSpawns.resolve(e, index).variant, 'home');
    assert.falsy(Traps.canLay(e, 10, 10), 'trappers cannot add hazards inside Home');
    e._homeVariantGenerating = true;
    assert.eq(WorldGen.variantOwnerAt(e, index), 'zone', 'shared generation retains original ownership');
    delete e._homeVariantGenerating;
    HomeVariant.apply(s, e, 0, 0);
    assert.eq(e.grid[index], 1); assert.eq(e.grid[index + 1], 9);
  });
  test('Home variant: prepare leaves shared creature draws intact, final keeps later starter placements', () => {
    const s = scene(), e = entry();
    e.creatures = [object('wild')]; e.objects = [object('wild')];
    HomeVariant.apply(s, e, 0, 0, { phase: 'prepare' });
    assert.eq(e.creatures.length, 1); assert.eq(e.objects.length, 0);
    e.objects.push(object('chest_start_0_0_1'));
    HomeVariant.apply(s, e, 0, 0);
    assert.eq(e.creatures.length, 0); assert.eq(e.objects.length, 1);
  });
  test('Home variant: saved Nexus discoveries stay in the ledger but cannot be seen or interacted with inside Home', () => {
    const s = scene(), spirit = object('shrine_spirit_1', 105, 105, { kind: 'shrine_spirit' });
    s.save.hiddenObjects = [spirit];
    assert.eq(HiddenObjects.saved(s).length, 0);
    assert.eq(s.save.hiddenObjects[0], spirit);
    spirit.x = 180;
    assert.eq(HiddenObjects.saved(s)[0], spirit);
  });
  test('Home variant: local lair coordinates and footprints crossing a tile seam yield to Home', () => {
    const s = scene({ save: { starterCratesAt: { x: 240, y: 100 } } }), e = entry();
    e.objects = [object('wide', 185, 105, { footprintCells: { width: 3, height: 1 } })];
    e.streetLairs = [{ sid: 'guard', lx: 195, ly: 105 }];
    HomeVariant.apply(s, e, 0, 0);
    assert.eq(e.objects.length, 0); assert.eq(e.streetLairs.length, 0);
  });
  test('Home variant: the starter audit retains natural resources deliberately adopted for Home', () => {
    const s = scene({ save: { starterCratesAt: { x: 100, y: 100 }, starterHome: { tamed: ['adopted'] } } }), e = entry();
    e.objects = [object('adopted'), object('incidental')];
    HomeVariant.apply(s, e, 0, 0);
    assert.eq(e.objects.length, 1); assert.eq(e.objects[0].id, 'adopted');
  });
  test('Home variant: underground entries and underground scenes are untouched', () => {
    for (const undergroundScene of [true, false]) {
      const s = scene({ depth: undergroundScene ? 1 : 0 }), e = entry();
      e.depth = undergroundScene ? 0 : 1; e.objects = [object('cave')];
      assert.falsy(HomeVariant.apply(s, e, 0, 0));
      assert.eq(e.objects.length, 1); assert.eq(e.homeVariant, undefined);
    }
  });
})();

test('Home ownership: runtime Nexus hazards and harvest reactions yield without changing source coverage', () => {
  const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
  const N = 20, homeVariant = new Uint8Array(N * N), index = 10 * N + 10;
  homeVariant[index] = 1;
  const entry = { depth: 0, tileEdgeM: 200, cellsPerEdge: N, homeVariant,
    zone: { coverage: new Uint8Array(N * N).fill(1), anchors: [{ kind: 'tar', variant: 'seep', gx: 0, gy: 0 }] } };
  WorldGen.tileCache.set(key, entry);
  try {
    assert.eq(EnvironmentHazards.caveInVariant(entry, 10, 10), null);
    assert.eq(EnvironmentHazards.caveInVariant(entry, 0, 0), 'seep');
    assert.eq(EnemyHabitats.zoneAnchorAt(200, 105, 105), null);
    assert.truthy(EnemyHabitats.zoneAnchorAt(200, 5, 5));
    const scene = { depth: 0, save: { starterCratesAt: { x: 100, y: 100 } } };
    const source = { id: 'starter_mushroom', x: 105, y: 105, gasEmitter: true };
    assert.falsy(MushroomGas.sourcePresent(scene, source), 'cached source tags cannot emit in Home');
    assert.truthy(MushroomGas.sourcePresent({ ...scene, depth: 2 }, source), 'surface override never changes caves');
    assert.eq(entry.zone.coverage[index], 1); assert.truthy(source.gasEmitter);
  } finally {
    if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
  }
});
