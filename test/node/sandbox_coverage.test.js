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

  assert.eq(e.zone.anchors.map((a) => a.kind).sort().join(','), 'grove,stones,tar',
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
  assert.eq(e.traps.length, placed.length, 'the entry carries exactly the placer\'s traps');

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
