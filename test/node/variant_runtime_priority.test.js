// Drive the whole shipping spawn pass: authored road rewards survive while
// general fill respects the corridor even when no furniture occupies it.
(() => {
  function fixture(reserved, terrain = WorldGen.T.PARK, objects = [], wildplants = [], dressing = {}, save = { caught: [] }) {
    const N = 64;
    const scene = Object.assign(new SceneCreatures(), {
      tileEdgeM: N * 10, cellsPerTile: N, save,
      startWorldM: { x: -5000, y: 0 }, _pestFreeZone: () => null,
      _starterTrailAnchor: () => null, _provisionStarterHome() {}, _carveStarterPond() {},
    });
    const hoard = { id: 'authored_street_hoard', x: 105, y: 105 };
    const entry = { cellsPerEdge: N, grid: new Array(N * N).fill(terrain),
      objects, wildplants, roadClass: new Uint8Array(N * N),
      streetArea: new Uint8Array(N * N).fill(reserved ? 1 : 0),
      streetDress: { objects: [], wildplants: [], lairs: [], treasures: [hoard],
        marks: new Uint8Array(N * N).fill(reserved ? StreetVariants.VARIANT_BY_ID.pilgrim.code : 0) },
      ...dressing,
    };
    entry.streetMarks = entry.streetDress.marks;
    const prior = window.__TEST_MODE;
    window.__TEST_MODE = false;
    try { scene.spawnInTile(entry, 0, 0); } finally { window.__TEST_MODE = prior; }
    return { entry, hoard, scene, N };
  }

  test('variant priority: empty road corridor excludes runtime generic rewards and enemies, retaining its hoard and fauna', () => {
    const { entry, hoard, N } = fixture(true);
    assert.eq(entry._ambientSpawnOpts.occupied.size, N * N);
    assert.eq(entry._spawnOpts.occupied.size, 1 + entry._spawnOpts.creatureCells.size, 'only the hoard and generated creature seats reserve ground');
    assert.lt(entry._spawnOpts.occupied.size, N * N, 'unused variant ground remains open for story and authored placements');
    assert.gte(entry._spawnOpts.creatureCells.size, entry.creatures.filter(c => c._habitatSpawn).length, 'generated reservations include every visible inhabitant');
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

  const roadCoin = (x = 205) => ({ kind: 'coindrop', x, y: 205,
    id: WorldGen.cellId('golden_coin', 0, 0, Math.floor(x / 10), 20),
    seeded: true, amount: 1, _street: 'golden' });
  const coinDress = coins => ({ objects: [], wildplants: [], treasures: [], lairs: [], coins });

  test('golden road coins: rebuild replaces authored coins without duplicating or discarding session drops', () => {
    const coin = roadCoin(), bounty = { kind: 'coindrop', id: 'bounty_foe', x: 305, y: 305, amount: 7 };
    const stale = roadCoin(405);
    const { entry } = fixture(true, WorldGen.T.PARK, [], [], {
      coinDrops: [bounty, coin, stale], streetDress: coinDress([coin, { ...coin }]),
    });
    assert.eq(entry.coinDrops.length, 2, 'one authoritative road coin plus the carried bounty');
    assert.eq(entry.coinDrops.filter(c => c.id === coin.id).length, 1);
    assert.eq(entry.coinDrops.find(c => c.id === bounty.id), bounty, 'session drop retained intact');
    assert.falsy(entry.coinDrops.some(c => c.id === stale.id), 'removed road seat does not survive rebuild');
    const fresh = fixture(true, WorldGen.T.PARK, [], [], {
      coinDrops: entry.coinDrops, streetDress: coinDress([]),
    }).entry;
    assert.eq(fresh.coinDrops.length, 1, 'removing the variant clears its old coins');
    assert.eq(fresh.coinDrops[0].id, bounty.id);
  });

  test('golden road coins: pickup pays once and a serialized save keeps the regenerated coin absent', () => {
    const coin = roadCoin();
    const { entry, scene } = fixture(true, WorldGen.T.PARK, [], [], { streetDress: coinDress([coin]) }, { caught: [], money: 0 });
    const priorCell = globalThis.worldMetersToAbsCell, priorFar = globalThis.tooFar;
    const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    globalThis.worldMetersToAbsCell = (s, x, y) => ({ cellIX: Math.floor(x / 10), cellIY: Math.floor(y / 10) });
    globalThis.tooFar = () => false;
    WorldGen.tileCache.set(key, entry);
    scene.playerToWorldCell = () => ({ tx: 0, ty: 0 });
    scene._popCellNumber = () => {};
    try {
      const ctx = { scene, save: scene.save, wm: { x: coin.x, y: coin.y }, sx: 0, sy: 0, dirty: false };
      const tap = TAP_HANDLERS.find(h => h.name === 'coindrop');
      assert.eq(tap.try(ctx), true);
      assert.eq(scene.save.money, 1);
      assert.truthy(ctx.dirty, 'normal interaction persistence is requested');
      assert.truthy(scene.save.foundTreasures.includes(coin.id));
      assert.eq(tap.try(ctx), false, 'second tap cannot pay again');
      const restored = JSON.parse(JSON.stringify(scene.save));
      const reloaded = fixture(true, WorldGen.T.PARK, [], [], { streetDress: coinDress([coin]) }, restored).entry;
      assert.falsy((reloaded.coinDrops || []).some(c => c.id === coin.id));
      assert.truthy(reloaded._spawnOpts.occupied.has(20 * 64 + 20), 'collected seat still reserves the generated layout');
      assert.eq(restored.money, 1);
    } finally {
      globalThis.worldMetersToAbsCell = priorCell; globalThis.tooFar = priorFar;
      if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
    }
  });

  test('golden road coins: empty zone coverage and zone object extents override carried road coins', () => {
    const first = roadCoin(), second = roadCoin(305), coverage = new Uint16Array(64 * 64);
    coverage[20 * 64 + 20] = 1;
    const zone = { id: 'zone_piece', kind: 'tree', x: 315, y: 205, _footprintCells: { width: 3, height: 1 } };
    const { entry } = fixture(true, WorldGen.T.PARK, [], [], {
      coinDrops: [first, second], zone: { coverage, anchors: [{ key: 'zone_coin_override', kind: 'stones', variant: 'silent_circle', gx: 20, gy: 20 }] }, zoneDress: { objects: [zone], wildplants: [] },
      streetDress: coinDress([first, second]),
    });
    assert.eq(entry.coinDrops.length, 0, 'both new and carried road coins yield to the zone');
  });
})();
