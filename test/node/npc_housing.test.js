// A conversation moves a Home neighbour into one free restored house.
(function () {
  const N = 40, CELL_M = 7, EDGE_M = N * CELL_M;
  const HOME = { kind: 'house', id: 'player_home', x: 10.5 * CELL_M, y: 10.5 * CELL_M };
  const house = (id, tx = 1, cx = 12) => ({ kind: 'house', id, x: tx * EDGE_M + (cx + 0.5) * CELL_M, y: 20.5 * CELL_M });
  const entry = (tx = 0) => ({
    grid: new Uint8Array(N * N).fill(WorldGen.T.PARK), cellsPerEdge: N, _spawned: true,
    objects: [], genObjects: [], wildplants: [], creatures: [], _residents: [], _residentsTile: { tx, ty: 0 },
    roadMask: new Uint8Array(N * N), spawnWhy: new Uint8Array(N * N),
  });
  const scene = () => {
    const s = { tileEdgeM: EDGE_M, cellM: CELL_M, depth: 0,
      save: { caught: [], opened: [], discovered: {}, restoredHouses: {}, starterCratesAt: { x: HOME.x, y: HOME.y } },
      homeWorldPos: () => HOME, inHomeRing: (x, y) => Math.hypot(x - HOME.x, y - HOME.y) <= 8 * CELL_M,
      _dialogOpen: () => false,
    };
    s._starterTrailAnchor = () => s.save.starterCratesAt;
    return s;
  };
  const person = (id = 'npc_wanderer_0_0', role = 'wanderer') => WorldGen.makeCreature('npc', HOME.x + 3 * CELL_M, HOME.y, id,
    { ...NPC.storyNeighbour(id, role), homeX: HOME.x + 3 * CELL_M, homeY: HOME.y, _homeAnchor: '' });
  const withWorld = fn => {
    const cache = WorldGen.tileCacheFor(0), previous = [...cache];
    cache.clear();
    try {
      const s = scene(), origin = entry(), destination = entry(1);
      origin.objects.push(HOME);
      cache.set(WorldGen.tileKey(0, 0), origin);
      cache.set(WorldGen.tileKey(1, 0), destination);
      fn(s, origin, destination, cache);
    } finally {
      cache.clear(); for (const [key, value] of previous) cache.set(key, value);
    }
  };
  const restore = (s, e, h) => { e.objects.push(h); s.save.restoredHouses[h.id] = 'plain'; };

  test('NPC housing: a Home conversation claims the nearest free roof and moves the same person across tiles', () => withWorld((s, origin, destination) => {
    const c = person(), near = house('near'), far = house('far', 1, 32);
    origin.creatures.push(c);
    restore(s, destination, far); restore(s, destination, near);
    s.save.restoredHouses[HOME.id] = 'plain';
    const identity = JSON.stringify([c.id, c.name, c.role, c.npcVariant, c.tint, c.artScale]);
    NPC.meetHomeNeighbour(s, c);
    assert.eq(s.save.npcHomes[c.id].houseId, near.id, 'nearest eligible restored roof, excluding player Home');
    assert.falsy(origin.creatures.some(o => o.id === c.id), 'removed from original tile');
    assert.truthy(destination.creatures.includes(c), 'the live NPC moves, preserving identity and state');
    assert.eq(JSON.stringify([c.id, c.name, c.role, c.npcVariant, c.tint, c.artScale]), identity);
    assert.eq(c.homeX, c.x); assert.eq(c.homeY, c.y);
    assert.lte(Math.max(Math.abs(c.x - near.x), Math.abs(c.y - near.y)), NPC.LINGER_CELLS * CELL_M);
    assert.falsy(c.x === near.x && c.y === near.y, 'stands beside the building');
    const pin = JSON.stringify([c.x, c.y, c.homeX, c.homeY, s.save.npcHomes[c.id]]);
    NPC.meetHomeNeighbour(s, c); NPC.houseNeighbours(s);
    assert.eq(JSON.stringify([c.x, c.y, c.homeX, c.homeY, s.save.npcHomes[c.id]]), pin, 'subsequent conversations do not move a housed neighbour');
    assert.truthy(MemoryStory.wandererHoused(s.save, c), 'actual housing updates Tilly even without a later restoration');
  }));

  test('NPC housing: a neighbour in view is not moved by the conversation, only once off screen', () => withWorld((s, origin, destination) => {
    const c = person(); origin.creatures.push(c);
    const h = house('later_move'); restore(s, destination, h);
    // A viewport centred on the speaker; the destination tile is beyond it.
    Object.assign(s, { viewSize: 20, mPerPx: 1, startWorldM: { x: 0, y: 0 }, playerM: { x: c.x, y: c.y } });
    const pin = [c.x, c.y].join(',');
    NPC.meetHomeNeighbour(s, c);
    assert.truthy(s.save.npcHomes[c.id], 'the meeting is recorded');
    assert.falsy(s.save.npcHomes[c.id].houseId, 'no roof claimed while the speaker is watched');
    assert.truthy(origin.creatures.includes(c)); assert.eq([c.x, c.y].join(','), pin, 'the speaker stays put');
    s.playerM = { x: c.x - 200, y: c.y + 200 };
    s._npcArrivalsNext = 0;
    NPC.tickArrivals(s);
    assert.eq(s.save.npcHomes[c.id].houseId, h.id, 'moves once out of sight');
    assert.truthy(destination.creatures.includes(c));
  }));

  test('NPC housing: one house has one assignment and a prior conversation waits for another roof', () => withWorld((s, origin, destination) => {
    const first = person(), second = person('npc_warden_0_0', 'warden');
    origin.creatures.push(first, second);
    const h = house('only'); restore(s, destination, h);
    NPC.meetHomeNeighbour(s, first); NPC.meetHomeNeighbour(s, second);
    assert.eq(s.save.npcHomes[first.id].houseId, h.id);
    assert.truthy(s.save.npcHomes[second.id], 'meeting retained even without a spare roof');
    assert.falsy(s.save.npcHomes[second.id].houseId, 'occupied roof is unavailable');
    assert.truthy(origin.creatures.includes(second), 'unhoused neighbour remains at Home');
    const later = house('later', 1, 30); restore(s, destination, later);
    NPC.houseNeighbours(s);
    assert.eq(s.save.npcHomes[second.id].houseId, later.id, 'no second conversation is needed');
    assert.eq(new Set(Object.values(s.save.npcHomes).map(row => row.houseId)).size, 2);
  }));

  test('NPC housing: blocked seats keep the meeting pending until safe ground is available', () => withWorld((s, origin, destination) => {
    const c = person(); origin.creatures.push(c);
    restore(s, destination, house('blocked'));
    destination.grid.fill(WorldGen.T.WATER);
    NPC.meetHomeNeighbour(s, c);
    assert.truthy(s.save.npcHomes[c.id]);
    assert.falsy(s.save.npcHomes[c.id].houseId, 'a roof without a legal seat is not claimed');
    assert.truthy(origin.creatures.includes(c));
    destination.grid.fill(WorldGen.T.PARK);
    NPC.houseNeighbours(s);
    assert.eq(s.save.npcHomes[c.id].houseId, 'blocked');
  }));

  test('NPC housing: destination reload restores identity without the original tile and prevents duplicate arrivals', () => withWorld((s, origin, destination, cache) => {
    const c = person(); origin.creatures.push(c);
    restore(s, destination, house('saved'));
    NPC.meetHomeNeighbour(s, c);
    const saved = JSON.parse(JSON.stringify(s.save));
    const pin = [c.x, c.y, c.homeX, c.homeY].join(',');
    cache.clear();
    const loaded = entry(1); loaded.objects = destination.objects;
    cache.set(WorldGen.tileKey(1, 0), loaded);
    s.save = saved;
    NPC.houseNeighbours(s);
    const restored = loaded.creatures.find(o => o.id === c.id);
    assert.truthy(restored, 'destination alone can reconstruct the resident');
    assert.eq(restored.name, c.name); assert.eq(restored.role, c.role); assert.eq(restored.artScale, c.artScale);
    assert.eq([restored.x, restored.y, restored.homeX, restored.homeY].join(','), pin);
    const returned = entry(); returned.objects = [HOME];
    cache.set(WorldGen.tileKey(0, 0), returned);
    Starter.placeSafeAreaWarden(s, returned, 0, 0);
    returned._residents = [person()]; s.save.discovered.memory = 1;
    NPC.arrivals(s, returned, 0, 0);
    NPC.houseNeighbours(s);
    assert.eq([...cache.values()].flatMap(e => e.creatures).filter(o => o.id === c.id).length, 1, 'neither starter placement nor arrivals duplicates an assigned ID');
  }));

  test('NPC housing: a full first conversation triggers housing, previews and unfinished pages do not', () => withWorld((s, origin, destination) => {
    const c = person('npc_warden_0_0', 'warden'), shown = [];
    origin.creatures.push(c); restore(s, destination, house('talk'));
    s.showMessageModal = modal => shown.push(modal);
    // Previewing dialogue may advance its story ledger, but cannot assign a roof.
    const preview = { ...s, save: JSON.parse(JSON.stringify(s.save)) };
    NPC.offerArt(preview, c);
    assert.falsy(preview.save.npcHomes?.[c.id], 'preview is not a conversation');
    NPC.interact(s, c, 0, 0);
    assert.eq(shown.length, 1);
    assert.falsy(s.save.npcHomes?.[c.id], 'opening the first page does not move the speaker');
    for (let page = 0; page < shown.length; page++) {
      assert.falsy(s.save.npcHomes?.[c.id], 'conversation must finish before the NPC moves');
      shown[page].onDismiss();
    }
    assert.eq(s.save.npcHomes[c.id].houseId, 'talk');
  }));

  test('NPC housing: a saved claim excludes normal arrivals even while its owner is absent', () => withWorld((s, origin, destination) => {
    const h = house('claimed'); restore(s, destination, h);
    s.save.npcHomes = { absent_neighbour: { houseId: h.id, role: 'wanderer', culture: 'village', x: h.x + CELL_M, y: h.y } };
    s.save.discovered.memory = 1;
    destination._residents = [person('returning_neighbour')];
    assert.eq(NPC.arrivals(s, destination, 1, 0).length, 0, 'a claimed roof is unavailable to ordinary arrivals');
    assert.eq(destination.creatures.length, 0);
  }));

  test('NPC housing: an existing resident at a restored house keeps that house occupied', () => withWorld((s, origin, destination) => {
    const h = house('occupied'); restore(s, destination, h);
    const resident = person('existing_resident'), waiting = person('waiting_neighbour');
    Object.assign(resident, { x: h.x + CELL_M, y: h.y, homeX: h.x + CELL_M, homeY: h.y, _homeAnchor: h.id });
    destination.creatures.push(resident); origin.creatures.push(waiting);
    NPC.meetHomeNeighbour(s, waiting);
    assert.truthy(s.save.npcHomes[waiting.id]);
    assert.falsy(s.save.npcHomes[waiting.id].houseId, 'an existing house anchor reserves the roof');
    assert.truthy(origin.creatures.includes(waiting));
    assert.eq(resident.homeX, h.x + CELL_M); assert.eq(resident.homeY, h.y);
  }));

  test('NPC housing: other anchors and wounded neighbours retain their pins without claiming a home', () => withWorld((s, origin, destination) => {
    restore(s, destination, house('free'));
    const away = person('other'), resting = person('resting');
    away._homeAnchor = 'old_house';
    resting._npcRestUntilEpoch = Date.now() + 60000;
    origin.creatures.push(away, resting);
    const before = JSON.stringify(origin.creatures.map(c => [c.x, c.y, c.homeX, c.homeY]));
    NPC.meetHomeNeighbour(s, away); NPC.meetHomeNeighbour(s, resting);
    assert.falsy(s.save.npcHomes?.[away.id]); assert.falsy(s.save.npcHomes?.[resting.id]);
    assert.eq(JSON.stringify(origin.creatures.map(c => [c.x, c.y, c.homeX, c.homeY])), before);
  }));

  test('NPC housing: Home spawners label eligible neighbours, while restored-house arrivals retain their anchor', () => withWorld((s, origin, destination) => {
    Starter.placeSafeAreaWarden(s, origin, 0, 0);
    assert.eq(origin.creatures.find(c => c.role === 'wanderer')._homeAnchor, '');
    const r = person('npc_generated_home', 'warden'); delete r._homeAnchor;
    origin._residents = [r]; s.save.discovered.memory = 1;
    NPC.arrivals(s, origin, 0, 0);
    assert.eq(origin.creatures.find(c => c.id === r.id)._homeAnchor, '');
    const h = house('arrival_anchor'); restore(s, destination, h);
    const distant = person('npc_generated_away', 'warden'); delete distant._homeAnchor;
    destination._residents = [distant];
    NPC.arrivals(s, destination, 1, 0);
    assert.eq(destination.creatures.find(c => c.id === distant.id)._homeAnchor, h.id);
  }));
})();
