// The browser sandbox is a maintained coverage surface. These tests build the
// same synthetic tile install() uses, so new map systems cannot silently fall
// out of its authored world.

test('sandbox coverage: the synthetic tile uses real map pipelines', () => {
  const built = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 3, ty: 4 });
  const e = built.entry;
  const terrain = new Set(Array.from(e.grid));
  for (const code of [
    WorldGen.T.GRASS, WorldGen.T.FOREST, WorldGen.T.SAND, WorldGen.T.WATER,
    WorldGen.T.FARMLAND, WorldGen.T.RESIDENTIAL, WorldGen.T.PARK,
    WorldGen.T.ROAD, WorldGen.T.PATH, WorldGen.T.BUILDING, WorldGen.T.ROCK,
    WorldGen.T.BUILDING_MED, WorldGen.T.BUILDING_LARGE, WorldGen.T.ROAD_LG,
    WorldGen.T.ROAD_MD, WorldGen.T.SCHOOL, WorldGen.T.COMMERCIAL,
    WorldGen.T.INDUSTRIAL, WorldGen.T.PLAYGROUND, WorldGen.T.PITCH,
    WorldGen.T.WETLAND, WorldGen.T.GOLF, WorldGen.T.ORCHARD, WorldGen.T.PIER,
    WorldGen.T.WASTELAND, WorldGen.T.GROVE, WorldGen.T.CHURCHYARD,
    WorldGen.T.TAR_YARD,
  ]) assert.truthy(terrain.has(code), `surface terrain ${code} is authored`);

  const transportation = e.layers.find((l) => l.name === 'transportation');
  assert.truthy(transportation && transportation.features.length >= 10,
    'decoded transportation geometry drives the overlay');
  for (const f of transportation.features) {
    assert.truthy(WorldGen.classifyLine('transportation', f.tags) != null,
      `${f.tags.name} has a real transportation class`);
  }

  const variants = new Set(e.streetIndex.lines.map((r) => r.variant).filter(Boolean));
  const expected = StreetVariants.STREET_VARIANTS
    .filter((r) => (r.size === 'minor' || r.size === 'major') && r.share > 0)
    .map((r) => r.id);
  for (const id of expected) assert.truthy(variants.has(id), `${id} has an authored street`);
  assert.truthy(e.streetIndex.lines.some((r) => r.size === 'major' && !r.variant),
    'an unthemed old trade road is present');

  assert.truthy(e.streetDress && e.streetMarks, 'the real street dresser ran');
  assert.truthy(e.slowCells && e.slowCells.size > 0, 'burned-road and tar-yard slow cells exist');
  assert.truthy(e.coinDrops.some((c) => c._street === 'golden'), 'Golden Road laid coins');
  assert.gt(e.streetLairs.length, 0, 'street lairs were authored');
  assert.truthy(e.streetLairs.some((l) => l.tier === 'cafe'), 'the café hoard has its guard lair');
  assert.truthy(e.extraTreasures.some((t) => String(t.id).includes('treasure_cafe')),
    'the café hoard uses the shared treasure lane');
  assert.truthy(e.objects.some((o) => o.wagonCandidate && o.banditStop),
    'the old trade road marks its bus stop as a wagon');
  assert.truthy(Array.from(e.roadClass).some((v) => v & WorldGen.ROAD_CLASS_MAJOR_BAND),
    'major-road bands are stamped');
  assert.truthy(Array.from(e.roadClass).some((v) => v & WorldGen.ROAD_CLASS_BANDIT_VERGE),
    'old-trade-road verges are stamped');

  assert.eq([...new Set(e.zone.anchors.map((a) => a.kind))].sort().join(','), 'grove,quarry,stones,tar',
    'all influence-zone kinds are present');
  assert.truthy(e.scenic.shore && e.scenic.lines.size > 0,
    'shore and park-path scenic data are present');
  const walkFi = transportation.features.findIndex((f) => f.tags.name === 'Common Walk');
  const walkStyles = StreetVariants.lineStyles(e, transportation.features[walkFi], walkFi, 0,
    e.tileEdgeM / transportation.extent);
  assert.truthy(walkStyles.some((s) => s.variant === 'parkpath'),
    'Common Walk resolves through the shared parkpath row');
  const lamps = RoadOverlay.lampSitesForTile(built.tx, built.ty, e);
  assert.gt(lamps.length, 0, 'vector roads produce street lamps');
  assert.gt(new Set(lamps.map((l) => l.glow)).size, 1, 'street variants produce distinct lamp colours');
  // The placer itself must furnish the traps (deterministic stream), so a
  // regression that stops it on synthetic fields fails here — no hand row
  // can mask it. The count is the shared density cap's honest answer for
  // this much ground, which is why it is compared, not inflated.
  const placed = Traps.spawnSurface(e.grid, e.roadClass, e.cellsPerEdge, e.cellsPerEdge,
    built.tx, built.ty, e.tileEdgeM, e._spawnOpts, 1, e.zone && e.zone.under);
  assert.gt(placed.length, 0, 'Traps.spawnSurface places traps on the synthetic spawn fields');
  assert.gte(e.traps.length, placed.length, 'the entry carries at least the placer\'s traps');
  assert.truthy(e.traps.some((t) => String(t.id).includes('trap_snare')),
    'Snare Lane laid its iron teeth through the shared dressing lane');

  const objectKinds = new Set(e.objects.map((o) => o.kind));
  for (const kind of ['grove_shrine', 'headstone', 'infoboard', 'waystone', 'stakes', 'torch', 'tar', 'vista_scope']) {
    assert.truthy(objectKinds.has(kind), `${kind} is visible in the sandbox`);
  }
  const creatureKinds = new Set(e.creatures.map((c) => c.kind));
  for (const kind of ['goblin', 'goblin_archer', 'zombie', 'skeleton', 'ghost',
    'copper_plant', 'fire_slime', 'giant_crab', 'gull']) {
    assert.truthy(creatureKinds.has(kind), `${kind} is available for interaction`);
  }
});

test('sandbox coverage: campfire and partial street restoration are seeded', () => {
  const built = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 5, ty: 6 });
  const save = {};
  const seeded = Sandbox.seedCoverageState(save, built.entry, built.originIX,
    built.originIY, built.tx, built.ty, built.cellM);
  assert.truthy(seeded.fire && save.fires.length === 1, 'one campfire is seeded');
  assert.truthy(seeded.lantern, 'Lantern Row is found by its shared variant row');
  const restored = Streets.restoredList(save, WorldGen.tileKey(built.tx, built.ty), seeded.lantern.lineKey);
  assert.eq(restored.length, 1, 'one continuous half-road is restored');
  assert.gt(restored[0][1] - restored[0][0], 0, 'restored street metres are positive');
});

test('sandbox coverage: the capture harness export hook stays stable', () => {
  assert.truthy(SANDBOX_JS_SRC.includes('global.Sandbox = { detect, install };'),
    'tools/sandbox_capture.js can expose LAYOUT');
});

test('sandbox destinations: every dashboard link resolves to its authored area', () => {
  const built = Sandbox.buildForTest({ cellsPerEdge: 128 });
  const layout = Sandbox.layoutForTest;
  for (const d of SandboxDestinations.entries) {
    const point = Sandbox.resolveDestination(d.id);
    assert.inRange(point.lx, 0, layout.width - 1, d.id);
    assert.inRange(point.ly, 0, layout.height - 1, d.id);
    if (d.scene) {
      const scene = layout.scenes.find(s => s.name === d.scene);
      assert.truthy(scene, d.id + ' references an existing scene');
      if (d.sub) assert.truthy(scene.subLabels.some(s => s.label === d.sub), d.id + ' has a matching caption');
      assert.inRange(point.lx, scene.lx, scene.lx + scene.w - 1, d.id);
      assert.inRange(point.ly, scene.ly, scene.ly + scene.h - 1, d.id);
    } else {
      const cell = (built.originIY + point.ly) * built.entry.cellsPerEdge + built.originIX + point.lx;
      assert.truthy([WorldGen.T.ROAD, WorldGen.T.ROAD_MD, WorldGen.T.ROAD_LG, WorldGen.T.PATH].includes(built.entry.grid[cell]),
        d.id + ' lands on its authored road or path');
    }
    assert.truthy(SandboxDestinations.href(d.id).endsWith(`?sandbox=true&sandboxZone=${encodeURIComponent(d.id)}`));
  }
  assert.eq(SandboxDestinations.find(' TAR_YARD ').id, 'tar');
  assert.eq(SandboxDestinations.find('road:orchard').id, 'orchard-road');
  assert.eq(SandboxDestinations.find('orchard').id, 'orchard');
  assert.eq(SandboxDestinations.href('not-a-place'), null);
  assert.eq(JSON.stringify(Sandbox.resolveDestination('not-a-place')), JSON.stringify(Sandbox.resolveDestination('plaza')));
  const civic = layout.scenes.find(s => s.name === 'CIVIC');
  assert.eq(Sandbox.resolveDestination('CIVIC').lx, civic.lx + Math.floor(civic.w / 2), 'old scene URLs remain supported');
  assert.truthy(Sandbox.resolveDestination('grove').ly < Sandbox.resolveDestination('tar').ly, 'subzones have distinct destinations');
});

test('sandbox coverage: practice yard stocks current mechanics and seeds real effects', () => {
  const built = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 3, ty: 4 });
  const yard = Sandbox.layoutForTest.scenes.find(s => s.name === 'PRACTICE');
  const farm = Sandbox.layoutForTest.scenes.find(s => s.name === 'FARMLAND');
  assert.eq(yard.ly, farm.ly, 'practice is beside the farm');
  assert.lte(Math.hypot(yard.spawn.dx - 6, yard.spawn.dy - 6), EnemyRoster.get('plant').range,
    'practice spawn stays inside the ordinary plant range');
  const entry = built.entry;
  const plants = entry.creatures.filter(c => c.id.includes('_PRACTICE_plant_'));
  assert.eq(plants.length, 3, 'two affected targets and one ordinary comparison');
  for (const plant of plants) {
    const ix = Math.floor((plant.x - built.tx * entry.tileEdgeM) / built.cellM);
    const iy = Math.floor((plant.y - built.ty * entry.tileEdgeM) / built.cellM);
    assert.falsy(entry.roadClass[iy * entry.cellsPerEdge + ix] & WorldGen.ROAD_CLASS_MAJOR_BUFFER,
      'practice targets remain outside the major-road safety buffer');
  }
  const fuel = entry.objects.filter(o => o.id.includes('_PRACTICE_'));
  assert.truthy(fuel.some(o => o.kind === 'tree' && GroundFire.survives(o)));
  assert.truthy(fuel.some(o => o.kind === 'tar' && GroundFire.flammable(o)));
  for (const tar of fuel.filter(o => o.kind === 'tar')) {
    const ix = Math.floor((tar.x - built.tx * entry.tileEdgeM) / built.cellM);
    const iy = Math.floor((tar.y - built.ty * entry.tileEdgeM) / built.cellM);
    assert.eq(entry.slowCells.get(iy * entry.cellsPerEdge + ix), 'tar',
      'authored tar participates in movement slowing');
  }
  const scene = { save: { energy: 100, groundFire: { old: {} }, burnedObjects: ['old'],
    potionEffects: { old: {} }, tomeDays: { tome_fire_wall: 'today' }, tomeReadyAt: Date.now() + 99999, tomeMagicCd: { tome_fire_wall: Date.now() + 99999 } } };
  // Coordinate/scene fire integration is exercised in the browser probe; this
  // fixture drives the actual recipient path and verifies reload cleanup.
  Sandbox.seedMechanicsState(scene, { creatures: plants, objects: [] });
  assert.eq(PotionEffects.scaleMul(plants[0]), CONSUMABLE_SPEC.giant_potion.scaleMul);
  assert.eq(PotionEffects.scaleMul(plants[1]), CONSUMABLE_SPEC.shrinking_potion.scaleMul);
  assert.eq(PotionEffects.scaleMul(plants[2]), 1);
  assert.eq(Object.keys(scene.save.groundFire).length, 0);
  assert.eq(scene.save.burnedObjects.length, 0);
  assert.falsy(scene.save.potionEffects.old);
  assert.falsy(scene.save.tomeDays);
  assert.falsy(scene.save.tomeReadyAt);
  assert.falsy(scene.save.tomeMagicCd);
  Sandbox.stockInventoryForTest(scene);
  for (const id of ['explosive_flask', 'tome_fire_wall', 'ember_ring', 'sleep_powder',
    'blank_scroll', ...ITEMS.filter(i => i.potion || i.scroll).map(i => i.id)]) {
    assert.eq(scene.save.inv.find(i => i.id === id)?.count, 5, `${id} is ready to use`);
  }
});

test('sandbox coverage: authored castle, fort and house floors reach the live polygon renderer', () => {
  const { entry: e, tx, ty, cellM } = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 3, ty: 4 });
  const castle = e.buildingShapes.find((s) => s.tier === WorldGen.T.BUILDING_LARGE);
  const fort = e.buildingShapes.find((s) => s.tier === WorldGen.T.BUILDING_MED);
  assert.truthy(castle, 'castle has a source polygon, so its floor is not suppressed without a replacement');
  assert.truthy(fort, 'fort has a source polygon too');
  assert.inRange(castle.areaM2 / (cellM * cellM), 39.99, 40.01, 'five by eight castle court');
  assert.inRange(fort.areaM2 / (cellM * cellM), 31.99, 32.01, 'four by eight fort deck');
  for (const shape of e.buildingShapes) {
    const ix = Math.round(shape.ring[0] / cellM), iy = Math.round(shape.ring[1] / cellM);
    assert.eq(e.grid[iy * e.cellsPerEdge + ix], shape.tier, 'polygon agrees with authored terrain');
    assert.eq(e.ownerKeys[e.owners[iy * e.cellsPerEdge + ix]], shape.key, 'floor and cell agree on ownership');
  }
  const towers = e.objects.filter((o) => o.kind === 'tower');
  assert.eq(towers.filter((o) => o.castle === castle.key).length, 4, 'all castle towers share the floor claim');
  assert.eq(towers.filter((o) => o.flagPost).length, 1, 'one banner for the footprint');
  for (const house of e.objects.filter((o) => o.kind === 'house' && o.id.includes('_RESIDENTIAL_'))) {
    const ix = Math.floor((house.x - tx * e.tileEdgeM) / cellM);
    const iy = Math.floor((house.y - ty * e.tileEdgeM) / cellM);
    if (e.grid[iy * e.cellsPerEdge + ix] === WorldGen.T.BUILDING) {
      assert.truthy(e.buildingShapes.some((s) => s.key === house.id), `residential house ${house.id} also keeps its floor`);
    }
  }
});


test('sandbox coverage: current restoration choices and repeatable wrecks use real ledgers', () => {
  const { entry } = Sandbox.buildForTest({ cellsPerEdge: 128 });
  const save = {};
  Sandbox.seedHouseState(save, entry);
  const houses = entry.objects.filter(o => o.kind === 'house');
  const wrecks = houses.filter(o => o._sandboxWreck);
  assert.eq(wrecks.length, 2);
  for (const house of houses.filter(o => !o._sandboxWreck)) {
    assert.eq(typeof save.restoredHouses[house.id], 'string');
    if (house._sandboxBuild?.includes(':')) {
      assert.eq(Shops.shopTier(save, house, Houses.houseShopRole(save, house)), Number(house._sandboxBuild.split(':').pop()));
    }
  }
  assert.truthy(save.bookshopId && save.petshopId);
  assert.truthy(houses.some(h => Houses.houseShopRole(save, h) === 'turret'));
  assert.truthy(Houses.restoreAs(save, wrecks[0], 'blacksmith:1', { hammer: true }));
  assert.truthy(save.shinyHouses[wrecks[0].id]);
  Sandbox.seedHouseState(save, entry);
  for (const house of wrecks) {
    assert.falsy(save.restoredHouses[house.id]);
    assert.falsy(save.shinyHouses[house.id]);
  }
});

test('sandbox coverage: recent zone layouts and enemy recipients are authored', () => {
  const { entry: e } = Sandbox.buildForTest({ cellsPerEdge: 128 });
  for (const variant of ['meadow', 'quarry-crater', 'quarry-strip-mine', 'quarry-stronghold']) {
    assert.truthy(e.zone.anchors.some(a => a.variant === variant && a.owned));
    assert.truthy(e.zoneDress.diagnostics.some(d => d.zoneVariant === variant && d.placed > 0));
  }
  assert.truthy(chestHidesMimic(e.objects.find(o => o._sandboxProbe === 'mimic')));
  assert.truthy(e.objects.some(o => o.zoneVariant === 'quarry-crater' && o.shrineKind === 'ember_altar'));
  assert.truthy(Array.from(e.grid).includes(WorldGen.T.CAVE_LAVA), 'crater creates real surface lava');
  for (const kind of ['mushroom_monster', 'treant', 'fire_elemental', 'mimic', 'wurm']) {
    assert.truthy(e.creatures.some(c => c.kind === kind), kind);
  }
  assert.truthy(e.creatures.some(c => c.kind === 'zombie' && c.emergeFromGround));
  assert.truthy(e.creatures.some(c => c.kind === 'wurm' && c.burrowCells?.length > 1));
  for (const kind of MACRO_KINDS) assert.truthy(e.objects.some(o => macroFor(o)?.kind === kind), kind);
});


test('sandbox coverage: authored fixtures stay within their scene and tile bounds', () => {
  const built = Sandbox.buildForTest({ cellsPerEdge: 128 });
  const { entry, originIX, originIY, cellM, tx, ty } = built;
  const layout = Sandbox.layoutForTest;
  assert.lte(layout.width, entry.cellsPerEdge);
  assert.lte(layout.height, entry.cellsPerEdge);
  for (const scene of layout.scenes) {
    const records = [...entry.objects, ...entry.creatures, ...entry.wildplants]
      .filter(o => o.id.includes(`_${scene.name}_`));
    for (const o of records) {
      const dx = (o.x - tx * entry.tileEdgeM) / cellM - originIX - scene.lx;
      const dy = (o.y - ty * entry.tileEdgeM) / cellM - originIY - scene.ly;
      assert.inRange(dx, 0, scene.w, o.id);
      assert.inRange(dy, 0, scene.h, o.id);
    }
  }
  assert.truthy(entry.wildplants.some(p => p._sandboxProbe === 'nest' && isNestBush(p.crop, p.id)));
  assert.truthy(entry.extraTreasures.some(o => o.zoneVariant === 'quarry-strip-mine' && o.coverRockId));
  assert.truthy(entry.objects.some(o => o.kind === 'stronghold_wall'));
  assert.truthy(entry.objects.some(o => o._sandboxProbe === 'daily-crate' && restocks(o)));
});

test('sandbox coverage: hazard yard uses live web, vent, plate and fall records', () => {
  const built = Sandbox.buildForTest({ cellsPerEdge: 128 });
  const yard = Sandbox.layoutForTest.scenes.find(s => s.name === 'HAZARDS');
  const entry = built.entry, key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
  const origin = { cellIX: built.originIX + yard.lx, cellIY: built.originIY + yard.ly };
  const scene = { depth: 0, cellM: built.cellM, cellsPerTile: 128,
    mPerPx: entry.tileEdgeM / WorldGen.TILE_PX, originPx: { x: 0, y: 0 },
    startWorldM: { x: 0, y: 0 },
    save: { energy: 100 },
    cellAt(x, y) {
      const ix = Math.floor(x / this.cellM), iy = Math.floor(y / this.cellM);
      return { tx: 0, ty: 0, ix, iy, cellIX: ix, cellIY: iy, loaded: true,
        type: entry.grid[iy * 128 + ix] };
    },
  };
  WorldGen.tileCache.set(key, entry);
  try {
    const surface = Sandbox.seedHazardState(scene, origin);
    assert.truthy(entry.creatures.some(c => c._sandboxProbe === 'web-spider'));
    assert.eq(surface.find(h => h._sandboxProbe === 'sinkhole').phase, 'warning');
    assert.eq(surface.find(h => h._sandboxProbe === 'ground-web').depth, 0);
    Sandbox.seedHazardState(scene, origin);
    assert.eq(SpiderWebs.lists(scene).webs.length, 1, 'reset replaces the authored web');
    scene.depth = 1;
    entry.grid.fill(WorldGen.T.CAVE_FLOOR);
    const litAt = Date.now();
    const cave = Sandbox.seedHazardState(scene, origin);
    assert.gte(Buffs.until('torch', scene.save, scene), litAt + CONSUMABLE_SPEC.torch.durationMs,
      'cave arrival lights the normal torch for its full shared duration');
    assert.eq(EnvironmentHazards.lists(scene).vents.length, Object.keys(EnvironmentHazards.VENTS).length);
    assert.eq(EnvironmentHazards.lists(scene).caveins.length, 2);
    for (const kind of ['ball', 'wall']) {
      const trap = cave.find(h => h._sandboxProbe === 'pressure-' + kind);
      const plate = cave.find(h => h._sandboxProbe === 'plate-' + kind);
      assert.eq(trap.state, 'parked');
      assert.eq(plate.trapId, trap.id);
      assert.eq(PressureTraps.clearSegment(scene, trap, plate).x, plate.x,
        'pressure lanes reach their plates through the shared ground gate');
    }
    assert.eq(SpiderWebs.lists(scene).webs.length, 0, 'surface silk does not follow into cave');
  } finally {
    if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
  }
});
