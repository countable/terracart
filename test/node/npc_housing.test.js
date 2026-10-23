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

  const deliver = (s, h, now = 1000) => {
    s.save.discovered['house:' + h.id] = now;
    NPC.markDelivery(s, h, now);
  };
  const settle = s => NPC.houseNeighbours(s, { now: 1000 + NPC.MOVE_IN_DELAY_MS });

  test('NPC housing: restored plain houses wait for delivery, and delivery waits for its delay', () => withWorld((s, origin, destination) => {
    const c = person(), h = house('delivered'); origin.creatures.push(c); restore(s, destination, h);
    assert.eq(NPC.houseNeighbours(s, { now: 1000 }), 0, 'restoration alone is insufficient');
    assert.eq(NPC.meetHomeNeighbour(s, c), false, 'talk does not trigger housing');
    assert.falsy(s.save.npcHomes[c.id]);
    deliver(s, h);
    assert.eq(NPC.houseNeighbours(s, { now: 1000 + NPC.MOVE_IN_DELAY_MS - 1 }), 0);
    assert.eq(settle(s), 1);
    assert.eq(s.save.npcHomes[c.id].houseId, h.id);
    assert.falsy(origin.creatures.includes(c)); assert.truthy(destination.creatures.includes(c));
    assert.eq(c.homeX, c.x); assert.eq(c.homeY, c.y);
    assert.truthy(MemoryStory.wandererHoused(s.save, c));
    assert.eq(NPC.houseResident(s, h), c);
  }));

  test('NPC housing: only a live available NPC can take a delivered house', () => withWorld((s, origin, destination) => {
    const h = house('waiting'); restore(s, destination, h); deliver(s, h);
    s.save.npcHomes = { ghost: { role: 'warden', x: HOME.x, y: HOME.y } };
    assert.eq(settle(s), 0, 'legacy pending records do not invent residents');
    assert.falsy(s.save.npcHomes.ghost.houseId);
    const c = person(); origin.creatures.push(c);
    assert.eq(settle(s), 1, 'an already arrived neighbour can move without a conversation');
    assert.eq(s.save.npcHomes[c.id].houseId, h.id);
    assert.falsy(s.save.npcHomes.ghost.houseId);
  }));

  test('NPC housing: house visits restore a resident\'s saved wound rest before granting help', () => withWorld((s, origin, destination) => {
    const c = person('resting-warden', 'warden'), h = house('resting-home');
    origin.creatures.push(c); restore(s, destination, h); deliver(s, h); settle(s);
    s.save.npcRestUntil = { [c.id]: Date.now() + 60000 };
    assert.truthy(NPC.isDormant(NPC.houseResident(s, h)), 'live resident respects durable wound rest');
    destination.creatures = [];
    const absent = NPC.houseResident(s, h);
    assert.truthy(NPC.isDormant(absent), 'inspection-only resident also respects durable wound rest');
    assert.eq(NPCBenefits.visit(s, absent).message, '', 'a resting resident grants no gift');
  }));

  test('NPC housing: player Home, specialty buildings, transient and wounded NPCs are unavailable', () => withWorld((s, origin, destination) => {
    const h = house('special'); restore(s, destination, h); s.save.restoredHouses[h.id] = 'blacksmith'; deliver(s, h);
    s.save.restoredHouses[HOME.id] = 'plain'; deliver(s, HOME);
    const c = person(); origin.creatures.push(c);
    assert.eq(settle(s), 0);
    const plain = house('plain'); restore(s, destination, plain); deliver(s, plain);
    origin.creatures = [person('stranger', 'stranger'), person('wounded')];
    origin.creatures[1]._npcRestUntilEpoch = Date.now() + 60000;
    assert.eq(settle(s), 0);
    assert.falsy(Object.values(s.save.npcHomes).some(row => row.houseId));
  }));

  test('NPC housing: invalid conversation-era claims release residents instead of hiding them', () => withWorld((s, origin, destination) => {
    const h = house('unfed'), id = 'npc_wanderer_0_0'; restore(s, destination, h);
    s.save.npcHomes = { [id]: { houseId: h.id, role: 'wanderer', culture: 'village', x: h.x + CELL_M, y: h.y } };
    assert.falsy(NPC.residentOf(s.save, h), 'an undelivered house cannot show a resident');
    assert.eq(settle(s), 0); assert.falsy(s.save.npcHomes[id].houseId);
    Starter.placeSafeAreaWarden(s, origin, 0, 0);
    assert.truthy(origin.creatures.some(c => c.id === id), 'the original story arrival is no longer suppressed');
    const generated = person('npc_generated', 'warden'); origin._residents = [generated]; s.save.discovered.memory = 1;
    s.save.npcHomes[generated.id] = { houseId: h.id, role: generated.role, culture: 'village', x: h.x, y: h.y };
    settle(s); NPC.arrivals(s, origin, 0, 0);
    assert.truthy(origin.creatures.some(c => c.id === generated.id), 'ordinary original arrivals recover too');
  }));

  test('NPC housing: one resident per house, with stable pins and preserved identity', () => withWorld((s, origin, destination) => {
    const first = person(), second = person('npc_warden_0_0', 'warden'), h = house('one');
    origin.creatures.push(first, second); restore(s, destination, h); deliver(s, h);
    const identity = JSON.stringify([first.id, first.name, first.role, first.npcVariant, first.tint, first.artScale]);
    assert.eq(settle(s), 1);
    const housed = destination.creatures[0], waiting = origin.creatures[0];
    assert.eq(destination.creatures.length, 1); assert.eq(origin.creatures.length, 1);
    const pin = JSON.stringify(s.save.npcHomes);
    assert.eq(settle(s), 0); assert.eq(JSON.stringify(s.save.npcHomes), pin);
    if (housed === first) assert.eq(JSON.stringify([first.id, first.name, first.role, first.npcVariant, first.tint, first.artScale]), identity);
    const later = house('two', 1, 30); restore(s, destination, later); deliver(s, later);
    assert.eq(settle(s), 1); assert.truthy(destination.creatures.includes(waiting));
    assert.eq(new Set(Object.values(s.save.npcHomes).map(row => row.houseId)).size, 2);
  }));

  test('NPC housing: blocked houses wait for safe ground and prefer the front entrance', () => withWorld((s, origin, destination) => {
    const c = person(), h = house('front'); origin.creatures.push(c); restore(s, destination, h); deliver(s, h);
    destination.grid.fill(WorldGen.T.WATER);
    assert.eq(settle(s), 0); assert.truthy(origin.creatures.includes(c));
    destination.grid.fill(WorldGen.T.PARK);
    destination.buildingShapes = [{ key: h.id, ring: [60, 60, 80, 60, 80, 80, 60, 80], door: { x: h.x - EDGE_M, y: h.y + 2 * CELL_M } }];
    assert.eq(settle(s), 1);
    const front = NPC.houseFront(s, destination, 1, 0, h);
    assert.eq(front.y, h.y + 2 * CELL_M);
    assert.lte(Math.hypot(c.x - front.x, c.y - front.y), CELL_M, 'closest safe entrance cell');
    assert.eq(s.save.npcHomes[c.id].houseX, h.x); assert.eq(s.save.npcHomes[c.id].houseY, h.y);
  }));

  test('NPC housing: visible residents have only a bounded extra delay', () => withWorld((s, origin, destination) => {
    const c = person(), h = house('visible'); origin.creatures.push(c); restore(s, destination, h); deliver(s, h);
    assert.eq(NPC.houseNeighbours(s, { now: 1000 + NPC.MOVE_IN_DELAY_MS, offscreen: () => false }), 0);
    assert.eq(NPC.houseNeighbours(s, { now: 1000 + NPC.MOVE_IN_DELAY_MS + 15000, offscreen: () => false }), 1, 'staying beside a house cannot block moving in forever');
  }));

  test('NPC housing: destination reload restores only assigned residents and suppresses duplicate arrivals', () => withWorld((s, origin, destination, cache) => {
    const c = person(), h = house('saved'); origin.creatures.push(c); restore(s, destination, h); deliver(s, h); settle(s);
    const saved = JSON.parse(JSON.stringify(s.save)), pin = [c.x, c.y, c.homeX, c.homeY].join(',');
    cache.clear();
    const loaded = entry(1); loaded.objects = destination.objects; cache.set(WorldGen.tileKey(1, 0), loaded); s.save = saved;
    assert.eq(settle(s), 1);
    const restored = loaded.creatures.find(o => o.id === c.id);
    assert.truthy(restored); assert.eq(restored.name, c.name); assert.eq(restored.artScale, c.artScale);
    assert.eq([restored.x, restored.y, restored.homeX, restored.homeY].join(','), pin);
    const returned = entry(); returned.objects = [HOME]; cache.set(WorldGen.tileKey(0, 0), returned);
    Starter.placeSafeAreaWarden(s, returned, 0, 0);
    returned._residents = [person()]; s.save.discovered.memory = 1; NPC.arrivals(s, returned, 0, 0); settle(s);
    assert.eq([...cache.values()].flatMap(e => e.creatures).filter(o => o.id === c.id).length, 1);
    assert.eq(NPC.residentOf(saved, h).name, c.name);
  }));

  test('NPC housing: Maud waits for her rescue reward; distant Orrin is available after arrival', () => withWorld((s, origin, destination) => {
    const maud = person('maud', 'witness'), orrin = person('orrin', 'archaeologist');
    delete maud._homeAnchor; delete orrin._homeAnchor;
    origin.creatures.push(maud); const h = house('rescue'); restore(s, destination, h); deliver(s, h);
    s.save.storyEncounter = { status: 'hunted' }; assert.eq(settle(s), 0);
    s.save.storyEncounter.status = 'rewarded'; assert.eq(settle(s), 1); assert.eq(s.save.npcHomes.maud.houseId, h.id);
    origin.creatures.push(orrin); const next = house('archaeologist', 1, 30); restore(s, destination, next); deliver(s, next);
    assert.eq(settle(s), 1); assert.eq(s.save.npcHomes.orrin.houseId, next.id);
  }));
})();
