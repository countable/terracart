// Drive the whole shipping spawn pass: authored road rewards survive while
// general fill respects the corridor even when no furniture occupies it.
(() => {
  function fixture(reserved, terrain = WorldGen.T.PARK, objects = [], wildplants = [], dressing = {}) {
    const N = 64;
    const scene = Object.assign(new SceneCreatures(), {
      tileEdgeM: N * 10, cellsPerTile: N, save: { caught: [] },
      startWorldM: { x: -5000, y: 0 }, _pestFreeZone: () => null,
      _starterTrailAnchor: () => null, _provisionStarterHome() {}, _carveStarterPond() {},
    });
    const hoard = { id: 'authored_street_hoard', x: 105, y: 105 };
    const entry = { cellsPerEdge: N, grid: new Array(N * N).fill(terrain),
      objects, wildplants, roadClass: new Uint8Array(N * N),
      streetArea: new Uint8Array(N * N).fill(reserved ? 1 : 0),
      streetDress: { objects: [], wildplants: [], lairs: [], treasures: [hoard],
        marks: new Uint8Array(N * N).fill(reserved ? 1 : 0) },
      ...dressing,
    };
    const prior = window.__TEST_MODE;
    window.__TEST_MODE = false;
    try { scene.spawnInTile(entry, 0, 0); } finally { window.__TEST_MODE = prior; }
    return { entry, hoard, scene, N };
  }

  test('variant priority: empty road corridor excludes runtime generic rewards and enemies, retaining its hoard and fauna', () => {
    const { entry, hoard, N } = fixture(true);
    assert.eq(entry._ambientSpawnOpts.occupied.size, N * N);
    assert.eq(entry._spawnOpts.occupied.size, 1, 'road area is not a hard block for story or authored placements');
    assert.eq(entry.traps.length, 0);
    assert.eq(entry.treasure, null);
    assert.eq(entry.extraTreasures.length, 1);
    assert.eq(entry.extraTreasures[0].id, hoard.id);
    assert.falsy(entry.creatures.some(c => c.id.startsWith('plant_') || c._surfaceSpawn));
    assert.gt(entry.creatures.filter(c => c.kind === 'crow').length, 0, 'fauna still share the road variant area');
    assert.gt(fixture(false).entry.extraTreasures.length, 1, 'the same unreserved terrain actually produces generic treasure');
  });

  test('variant priority: road reservations exclude sand bonus treasure without suppressing authored street rewards', () => {
    const { entry, hoard } = fixture(true, WorldGen.T.SAND);
    assert.eq(entry.treasure, null);
    assert.eq(entry.extraTreasures.length, 1);
    assert.eq(entry.extraTreasures[0].id, hoard.id);
  });
  test('variant priority: runtime occupancy reserves every cell of large objects and wild plants', () => {
    const object = { id: 'wreck', kind: 'chest', x: 235, y: 235,
      _footprintCells: { width: 3, height: 3 } };
    const plant = { id: 'wide_plant', crop: 'shrub', x: 355, y: 355,
      _footprintCells: { width: 3, height: 1 } };
    const { entry, N } = fixture(false, WorldGen.T.PARK, [object], [plant]);
    const cells = entry._spawnOpts.occupied;
    for (let y = 22; y <= 24; y++) for (let x = 22; x <= 24; x++) {
      assert.truthy(cells.has(y * N + x), `wreck extent ${x},${y}`);
    }
    for (let x = 34; x <= 36; x++) assert.truthy(cells.has(35 * N + x), 'plant extent');
  });
  test('variant priority: landmark extent beats zone and road pieces at different anchors', () => {
    const landmark = { id: 'landmark', kind: 'chest', x: 205, y: 205,
      _footprintCells: { width: 3, height: 3 } };
    const road = { id: 'road_piece', kind: 'tree', x: 195, y: 205 };
    const zone = { id: 'zone_piece', kind: 'tree', x: 215, y: 205 };
    const { entry } = fixture(true, WorldGen.T.PARK, [], [], {
      scenicDress: { objects: [landmark], wildplants: [] },
      zoneDress: { objects: [zone], wildplants: [] },
      streetDress: { objects: [road], wildplants: [], treasures: [], lairs: [] },
    });
    assert.truthy(entry.objects.some(o => o.id === landmark.id));
    assert.falsy(entry.objects.some(o => o.id === road.id || o.id === zone.id));
  });
  test('variant priority: zone extent wins over a conflicting road piece', () => {
    const zone = { id: 'zone_piece', kind: 'tree', x: 205, y: 205,
      _footprintCells: { width: 3, height: 1 } };
    const road = { id: 'road_piece', kind: 'tree', x: 195, y: 205 };
    const { entry } = fixture(true, WorldGen.T.PARK, [], [], {
      zoneDress: { objects: [zone], wildplants: [] },
      streetDress: { objects: [road], wildplants: [], treasures: [], lairs: [] },
    });
    assert.truthy(entry.objects.some(o => o.id === zone.id));
    assert.falsy(entry.objects.some(o => o.id === road.id));
  });
})();
