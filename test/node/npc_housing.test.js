// A delivered house is the player's to offer: talk shows "(offer home)", nothing moves in by timer.
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

  const deliver = (s, h, now = 1000) => { s.save.discovered['house:' + h.id] = now; };
  const settle = s => NPC.houseNeighbours(s);

  test('NPC housing: first restored home keeps its ordinary one-potato delivery', () => withWorld((s, origin, destination) => {
    const c = person(), h = house('first'); origin.creatures.push(c); restore(s, destination, h);
    NPC.meetHomeNeighbour(s, c);
    assert.eq(JSON.stringify(Delivery.wantedProduce(s.save, h)), JSON.stringify(['potato']));
    assert.eq(NPC.homeOffer(s, c), null, 'meeting Tilly never bypasses her home delivery');
    deliver(s, h);
    assert.eq(NPC.homeOffer(s, c), h);
    assert.eq(NPC.offerHome(s, c), h);
    assert.eq(NPC.residentOf(s.save, h).id, c.id);
  }));

  test('NPC housing: nobody moves in without the offer, however long the roof waits', () => withWorld((s, origin, destination) => {
    const tilly = person('z_tilly'), warden = person('a_warden', 'warden');
    const h = house('waiting'); restore(s, destination, h); deliver(s, h);
    origin.creatures.push(warden, tilly);
    for (const c of origin.creatures) NPC.meetHomeNeighbour(s, c);
    assert.eq(settle(s), 0);
    NPC.tickArrivals(s, Date.now() + 3600e3);
    assert.falsy(NPC.residentOf(s.save, h));
    assert.falsy(Object.values(s.save.npcHomes).some(row => row.houseId));
  }));

  test('NPC housing: the player picks who moves in; the nearest open roof is offered', () => withWorld((s, origin, destination) => {
    const tilly = person('z_tilly'), warden = person('a_warden', 'warden');
    origin.creatures.push(tilly, warden);
    const far = house('far', 1, 30), near = house('near', 1, 4);
    restore(s, destination, far); deliver(s, far); restore(s, destination, near); deliver(s, near);
    assert.eq(NPC.offerHome(s, warden), near, 'Bryn may take a roof before Tilly');
    assert.eq(NPC.residentOf(s.save, near).id, warden.id);
    assert.eq(NPC.homeOffer(s, warden), null, 'a housed neighbour has nothing to be offered');
    assert.eq(NPC.homeOffer(s, tilly), far, 'a claimed roof is not offered again');
    assert.eq(NPC.offerHome(s, tilly), far);
    const other = person('other', 'farmer'); origin.creatures.push(other);
    assert.eq(NPC.homeOffer(s, other), null, 'every delivered roof is taken');
    assert.eq(new Set(Object.values(s.save.npcHomes).map(row => row.houseId)).size, 2);
  }));

  test('NPC housing: the offer records the meeting and survives reload', () => withWorld((s, origin, destination) => {
    const c = person(), h = house('unmet'); origin.creatures.push(c); restore(s, destination, h); deliver(s, h);
    assert.eq(NPC.offerHome(s, c), h);
    assert.truthy(s.save.npcMet[c.id]);
    s.save = JSON.parse(JSON.stringify(s.save));
    assert.eq(NPC.residentOf(s.save, h).id, c.id);
    assert.falsy(NPC.meetHomeNeighbour(s, c), 'repeated talk leaves one durable meeting fact');
  }));

  test('NPC housing: without a delivered plain house, skip anchor scans but clear obsolete live claims', () => withWorld((s, origin, destination) => {
    const c = person(); c._homeAnchor = 'old-conversation-claim'; origin.creatures.push(c);
    Object.defineProperty(destination, 'objects', { get() { throw new Error('unnecessary house-anchor scan'); } });
    assert.eq(NPC.houseNeighbours(s), 0);
    assert.eq(c._homeAnchor, '', 'cleanup is independent of whether a house can accept anyone');
    assert.eq(NPC.homeOffer(s, c), null);
  }));

  test('NPC housing: restored plain houses wait for delivery before they are offered', () => withWorld((s, origin, destination) => {
    const c = person(), h = house('delivered'); origin.creatures.push(c); restore(s, destination, h);
    assert.eq(NPC.homeOffer(s, c), null, 'restoration alone is insufficient');
    assert.eq(NPC.offerHome(s, c), null);
    assert.falsy(s.save.npcHomes[c.id]);
    deliver(s, h);
    assert.eq(NPC.offerHome(s, c), h);
    assert.eq(s.save.npcHomes[c.id].houseId, h.id);
    assert.falsy(origin.creatures.includes(c)); assert.truthy(destination.creatures.includes(c));
    assert.eq(c.homeX, c.x); assert.eq(c.homeY, c.y);
    assert.truthy(MemoryStory.wandererHoused(s.save, c));
    assert.eq(NPC.houseResident(s, h), c);
  }));

  test('NPC housing: legacy pending records do not invent residents', () => withWorld((s, origin, destination) => {
    const h = house('waiting'); restore(s, destination, h); deliver(s, h);
    s.save.npcHomes = { ghost: { role: 'warden', x: HOME.x, y: HOME.y } };
    assert.eq(settle(s), 0);
    assert.falsy(s.save.npcHomes.ghost.houseId);
    const c = person(); origin.creatures.push(c);
    assert.eq(NPC.offerHome(s, c), h);
    assert.falsy(s.save.npcHomes.ghost.houseId);
  }));

  test('NPC housing: house visits restore a resident\'s saved wound rest before granting help', () => withWorld((s, origin, destination) => {
    const c = person('resting-warden', 'warden'), h = house('resting-home');
    origin.creatures.push(c); restore(s, destination, h); deliver(s, h);
    NPC.offerHome(s, c);
    s.save.npcRestUntil = { [c.id]: Date.now() + 60000 };
    assert.truthy(NPC.isDormant(NPC.houseResident(s, h)), 'live resident respects durable wound rest');
    destination.creatures = [];
    const absent = NPC.houseResident(s, h);
    assert.truthy(NPC.isDormant(absent), 'inspection-only resident also respects durable wound rest');
    assert.eq(NPCBenefits.visit(s, absent).message, '', 'a resting resident grants no gift');
  }));

  test('NPC housing: player Home, specialty buildings, transient and wounded NPCs are never offered', () => withWorld((s, origin, destination) => {
    const h = house('special'); restore(s, destination, h); s.save.restoredHouses[h.id] = 'blacksmith'; deliver(s, h);
    s.save.restoredHouses[HOME.id] = 'plain'; deliver(s, HOME);
    const c = person(); origin.creatures.push(c);
    assert.eq(NPC.homeOffer(s, c), null);
    const plain = house('plain'); restore(s, destination, plain); deliver(s, plain);
    const stranger = person('stranger', 'stranger'), wounded = person('wounded');
    origin.creatures = [stranger, wounded];
    wounded._npcRestUntilEpoch = Date.now() + 60000;
    assert.eq(NPC.homeOffer(s, stranger), null); assert.eq(NPC.offerHome(s, stranger), null);
    assert.eq(NPC.homeOffer(s, wounded), null); assert.eq(NPC.offerHome(s, wounded), null);
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
    assert.eq(NPC.offerHome(s, first), h);
    assert.eq(NPC.offerHome(s, second), null, 'the roof is taken');
    assert.eq(destination.creatures.length, 1); assert.eq(origin.creatures.length, 1);
    const pin = JSON.stringify(s.save.npcHomes);
    assert.eq(settle(s), 0); assert.eq(JSON.stringify(s.save.npcHomes), pin);
    assert.eq(JSON.stringify([first.id, first.name, first.role, first.npcVariant, first.tint, first.artScale]), identity);
    const later = house('two', 1, 30); restore(s, destination, later); deliver(s, later);
    assert.eq(NPC.offerHome(s, second), later); assert.truthy(destination.creatures.includes(second));
  }));

  test('NPC housing: blocked houses wait for safe ground and prefer the front entrance', () => withWorld((s, origin, destination) => {
    const c = person(), h = house('front'); origin.creatures.push(c); restore(s, destination, h); deliver(s, h);
    destination.grid.fill(WorldGen.T.WATER);
    assert.eq(NPC.offerHome(s, c), null); assert.truthy(origin.creatures.includes(c));
    assert.falsy(s.save.npcHomes[c.id]?.houseId);
    destination.grid.fill(WorldGen.T.PARK);
    destination.buildingShapes = [{ key: h.id, ring: [60, 60, 80, 60, 80, 80, 60, 80], door: { x: h.x - EDGE_M, y: h.y + 2 * CELL_M } }];
    assert.eq(NPC.offerHome(s, c), h);
    const front = NPC.houseFront(s, destination, 1, 0, h);
    assert.eq(front.y, h.y + 2 * CELL_M);
    assert.lte(Math.hypot(c.x - front.x, c.y - front.y), CELL_M, 'closest safe entrance cell');
    assert.eq(s.save.npcHomes[c.id].houseX, h.x); assert.eq(s.save.npcHomes[c.id].houseY, h.y);
  }));

  test('NPC housing: destination reload restores only assigned residents and suppresses duplicate arrivals', () => withWorld((s, origin, destination, cache) => {
    const c = person(), h = house('saved'); origin.creatures.push(c); restore(s, destination, h); deliver(s, h);
    NPC.offerHome(s, c);
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

  test('NPC housing: Maud is offered a roof after her rescue reward; Orrin and Cobb whenever met', () => withWorld((s, origin, destination) => {
    const maud = person('maud', 'witness'), orrin = person('orrin', 'archaeologist'), cobb = person('cobb', 'miner');
    delete maud._homeAnchor; delete orrin._homeAnchor;
    origin.creatures.push(maud, orrin, cobb); const h = house('rescue'); restore(s, destination, h); deliver(s, h);
    s.save.storyEncounter = { status: 'hunted' }; assert.eq(NPC.homeOffer(s, maud), null);
    s.save.storyEncounter.status = 'rewarded'; assert.eq(NPC.offerHome(s, maud), h);
    const next = house('archaeologist', 1, 30); restore(s, destination, next); deliver(s, next);
    assert.eq(NPC.offerHome(s, cobb), next); assert.eq(NPC.residentOf(s.save, next).name, 'Cobb');
    assert.eq(NPC.homeOffer(s, orrin), null);
  }));

  test('NPC housing: talk shows "(offer home)" only while a roof is open, and taking it moves in', () => withWorld((s, origin, destination) => {
    let message;
    Object.assign(s, { showMessageModal(panel) { message = panel; }, houseShopRole: () => null, worldMetersToScreen: () => ({ x: 0, y: 0 }) });
    const c = person('ordinary', 'farmer'); origin.creatures.push(c);
    const h = house('talk'); restore(s, destination, h);
    NPC.interact(s, c, 0, 0);
    assert.falsy(message.actions, 'no CTA before a delivery');
    message.onDismiss();
    deliver(s, h);
    NPC.interact(s, c, 0, 0);
    const cta = message.actions?.find(a => a.label === NPC.OFFER_HOME_LABEL);
    assert.truthy(cta);
    message.onDismiss(); cta.onClick();
    assert.eq(NPC.residentOf(s.save, h).id, c.id);
    assert.eq(message.body, NPC.MOVE_IN_LINE);
    message.onDismiss();
    NPC.interact(s, c, 0, 0);
    assert.falsy(message.actions, 'a housed neighbour is offered nothing');
  }));
})();
