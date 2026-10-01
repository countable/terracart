// THE STORY NEIGHBOURS by the starting trailer (Starter.placeSafeAreaWarden
// seats NPC.STORY_NEIGHBOURS; MemoryStory.npcDialogue speaks for them), and
// the ROLE-DRIVEN residents: the mason off the restoration ledger, the
// lamplighter off the lamp ledger, the zone keeper off Zones.ZONE_KINDS.
(function () {
  const T = WorldGen.T;
  const N = 40, CELL_M = 7, EDGE_M = N * CELL_M;
  const scene = (save = {}) => ({ tileEdgeM: EDGE_M, cellM: CELL_M, save: { caught: [], opened: [], ...save } });
  const starterEntry = () => ({
    grid: new Uint8Array(N * N).fill(T.GRASS), cellsPerEdge: N, _spawned: true,
    objects: [], wildplants: [], creatures: [], roadMask: new Uint8Array(N * N), spawnWhy: new Uint8Array(N * N),
  });
  const cellOf = c => ({ cx: Math.floor(c.x / CELL_M), cy: Math.floor(c.y / CELL_M) });
  const cheb = (a, b) => Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));
  const person = (role, id = `npc_${role}_0_0`) => ({ id, kind: 'npc', x: 0, y: 0, ...NPC.storyNeighbour(id, role) });
  const towerSave = (memories, { second = false, restored = 15 } = {}) => {
    const save = { discovered: {}, restoredHouses: {}, wizardTowers: { firstId: 'tower_1', secondId: second ? 'tower_2' : null } };
    for (let i = 0; i < memories; i++) save.discovered[`m${i}`] = 1;
    for (let i = 0; i < restored; i++) save.restoredHouses[`h${i}`] = i === 14 ? 'wizard' : 'plain';
    save.restoredHouses.tower_1 = 'wizard';
    if (second) save.restoredHouses.tower_2 = 'wizard';
    return save;
  };

  test('story neighbours: the warden alone on a new save; the rest come in as memories return', () => {
    const entry = starterEntry(), anchor = { x: 20.5 * CELL_M, y: 20.5 * CELL_M };
    const save = { starterCratesAt: anchor, discovered: {} };
    const s = { tileEdgeM: EDGE_M, save, _starterTrailAnchor: () => anchor };
    const remember = (n) => { for (let i = Object.keys(save.discovered).length; i < n; i++) save.discovered[`m${i}`] = 1; };
    const present = () => NPC.STORY_NEIGHBOURS.filter(role => entry.creatures.some(c => c.id === `npc_${role}_0_0`));
    assert.eq(JSON.stringify(NPC.STORY_NEIGHBOURS), JSON.stringify(['warden', 'witness', 'wanderer', 'believer', 'archaeologist']), 'existing neighbours retain their order');
    assert.eq(Starter.placeSafeAreaWarden(s, entry, 0, 0), 1, 'one person seated');
    assert.eq(present().join(','), 'warden', 'the first morning: the warden is the one neighbour');
    assert.eq(JSON.stringify(cellOf(entry.creatures[0])), JSON.stringify({ cx: 17, cy: 17 }), 'the warden keeps the first legal ring-3 cell it always had');
    assert.eq(Starter.placeSafeAreaWarden(s, entry, 0, 0), 0, 'idempotent while nothing is due');
    // The gates, in the owner's order: the wizard's believer first, at three.
    assert.eq(NPC.STORY_ROLES.warden.minMemories, 0);
    assert.eq(NPC.STORY_ROLES.believer.minMemories, 3, 'the soothsayer of the wizard comes at memory three');
    assert.gt(NPC.STORY_ROLES.witness.minMemories, NPC.STORY_ROLES.believer.minMemories);
    assert.gt(NPC.STORY_ROLES.wanderer.minMemories, NPC.STORY_ROLES.witness.minMemories);
    remember(2);
    Starter.placeSafeAreaWarden(s, entry, 0, 0);
    assert.eq(present().join(','), 'warden', 'two memories: still alone');
    remember(3);
    assert.eq(Starter.placeSafeAreaWarden(s, entry, 0, 0), 1);
    assert.eq(present().join(','), 'warden,believer', 'three: the believer is by the trailer');
    remember(NPC.STORY_ROLES.witness.minMemories);
    Starter.placeSafeAreaWarden(s, entry, 0, 0);
    assert.eq(present().join(','), 'warden,witness,believer');
    remember(NPC.STORY_ROLES.wanderer.minMemories);
    Starter.placeSafeAreaWarden(s, entry, 0, 0);
    const placed = NPC.STORY_NEIGHBOURS.filter(role => !NPC.STORY_ROLES[role].radiusM).map(role => entry.creatures.find(c => c.id === `npc_${role}_0_0`));
    assert.truthy(placed.every(Boolean), 'all four are here in the end');
    assert.eq(JSON.stringify(cellOf(placed[0])), JSON.stringify({ cx: 17, cy: 17 }), 'the warden never moved');
    for (const c of placed) {
      assert.inRange(cheb(cellOf(c), { cx: 20, cy: 20 }), 3, 8, `${c.role} stands a few cells from the trailer`);
      assert.eq(c.roleLabel, NPC.STORY_ROLES[c.role].label);
      assert.truthy(c.name && c.name.length >= 3, 'a name of their own');
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      assert.gte(cheb(cellOf(placed[i]), cellOf(placed[j])), 2, `${placed[i].role} and ${placed[j].role} do not queue on one ring`);
    }
    const before = JSON.stringify(entry.creatures);
    Starter.placeSafeAreaWarden(s, entry, 0, 0);
    assert.eq(JSON.stringify(entry.creatures), before, 'idempotent');
    // Nobody is watched arriving: a seat on screen waits for the player to
    // look away.
    const shy = starterEntry();
    assert.eq(Starter.placeSafeAreaWarden(s, shy, 0, 0, { offscreen: () => false }), 0, 'every seat is in view: nobody seated');
    assert.eq(Starter.placeSafeAreaWarden(s, shy, 0, 0, { offscreen: () => true }), 4, 'looked away: all four');
    assert.truthy(shy._starterTile, 'the tile is marked for the arrivals pass');
    // The runtime paths: a banked memory seats through the scene's starter-tile
    // lookup (off screen only), and the arrivals pass calls back later.
    const late = starterEntry();
    const ls = { ...s, _starterTileEntry: () => ({ entry: late, tx: 0, ty: 0 }) };
    assert.eq(Starter.seatStoryNeighbours(ls), 4, 'a banked memory seats whoever is due');
    ls._starterTileEntry = () => null;
    assert.eq(Starter.seatStoryNeighbours(ls), 0, 'underground or before the tile is up: a no-op');
    assert.truthy(/MemoryStory\.enqueue\(this\.save, this\.memoriesTotal\(\), label\);\n\s*this\._seatStoryNeighbours\(\);/.test(SCENE_SRC), 'the one memory writer seats the arrival');
    assert.truthy(/_seatStoryNeighbours\(\) \{ return Starter\.seatStoryNeighbours\(this\); \}/.test(SCENE_SRC), 'through the scene wrapper');
  });

  test('story neighbours: the survivor tells of the Warmonger, one act at a time, never the secret', () => {
    const w = person('witness');
    const act1 = NPC.dialogue(scene({ discovered: {}, restoredHouses: {} }), w).body;
    assert.truthy(/Warmonger/.test(act1) && /roofs/.test(act1), 'the night the roofs went');
    assert.eq(act1, MemoryStory.NEIGHBOURS.witness[1]);
    assert.eq(NPC.dialogue(scene(towerSave(12)), w).body, MemoryStory.NEIGHBOURS.witness[2]);
    const late = towerSave(30, { second: true }); late.memoryStory = { act3Started: true };
    assert.eq(NPC.dialogue(scene(late), w).body, MemoryStory.NEIGHBOURS.witness[3]);
    assert.truthy(/· Survivor$/.test(NPC.dialogue(scene(), w).title));
    const every = [...Object.values(MemoryStory.NEIGHBOURS.witness), ...Object.values(MemoryStory.NEIGHBOURS.wanderer), ...Object.values(MemoryStory.NEIGHBOURS.believer),
      ...Object.values(Zones.ZONE_KINDS).flatMap(k => k.keeper || []), ...NPC.KEEPER_DEFAULT].join(' ');
    assert.falsy(/dragon|conquer|scales|wings|fire breath/i.test(every), 'no neighbour spoils the second tower');
  });

  test('story neighbours: the wanderer is homeless until the next restoration after you meet them', () => {
    const w = person('wanderer');
    const s = scene({ discovered: {}, restoredHouses: { h0: 'blacksmith' } });
    assert.eq(NPC.dialogue(s, w).body, MemoryStory.NEIGHBOURS.wanderer.homeless, 'sad on the first meeting even after a restoration they never saw');
    assert.eq(s.save.memoryStory.met[w.id], 1, 'the meeting is stamped with the day\'s count');
    assert.eq(NPC.dialogue(s, w).body, MemoryStory.NEIGHBOURS.wanderer.homeless, 'still sad tomorrow');
    s.save.restoredHouses.h1 = 'trader';
    assert.eq(NPC.dialogue(s, w).body, MemoryStory.NEIGHBOURS.wanderer.housed, 'the next restoration gives them a roof');
    assert.eq(s.save.memoryStory.met[w.id], 1, 'the stamp never moves');
    const later = scene(towerSave(12)); later.save.memoryStory = { met: { [w.id]: 3 } };
    assert.eq(NPC.dialogue(later, w).body, MemoryStory.NEIGHBOURS.wanderer.settled, 'settled by the second act');
    assert.truthy(/· Wanderer$/.test(NPC.dialogue(s, w).title));
  });

  test('story neighbours: the wanderer is a child, drawn at seven tenths through the instance-size lane', () => {
    assert.eq(NPC.CHILD_SCALE, 0.7);
    const child = person('wanderer');
    assert.eq(child.artScale, NPC.CHILD_SCALE, 'the row stamps the instance size');
    assert.eq(SpriteLayout.creatureInstScale(child), NPC.CHILD_SCALE, 'the one lane every reader of drawn size uses');
    assert.eq(SpriteLayout.creatureScale('npc', SpriteLayout.creatureInstScale(child)), SpriteLayout.creatureScale('npc') * NPC.CHILD_SCALE);
    for (const role of ['warden', 'witness', 'believer']) {
      const grown = person(role);
      assert.eq(grown.artScale, undefined, `${role} is grown`);
      assert.eq(SpriteLayout.creatureInstScale(grown), 1);
    }
    for (const line of Object.values(MemoryStory.NEIGHBOURS.wanderer)) {
      assert.lte(Math.max(...line.split(/[.!?]\s+/).map(t => t.split(' ').length)), 14, 'a child speaks in short sentences');
    }
  });

  test('story neighbours: the believer follows the tower — ruin, sealed, open, abandoned, moved', () => {
    const b = person('believer'), L = MemoryStory.NEIGHBOURS.believer;
    assert.eq(NPC.dialogue(scene({ discovered: {}, restoredHouses: {} }), b).body, L.ruin);
    assert.truthy(/wise wizard/.test(L.ruin) && /tower/.test(L.ruin) && /come/.test(L.ruin), 'lauds him, and the tower may bring him back');
    assert.eq(NPC.dialogue(scene(towerSave(4)), b).body, L.locked);
    assert.eq(NPC.dialogue(scene(towerSave(12)), b).body, L.open);
    assert.eq(NPC.dialogue(scene(towerSave(24)), b).body, L.abandoned);
    assert.eq(NPC.dialogue(scene(towerSave(30, { second: true })), b).body, L.moved);
    const late = towerSave(30, { second: true }); late.memoryStory = { act3Started: true };
    assert.eq(NPC.dialogue(scene(late), b).body, L.moved, 'never learns what the player learns');
    assert.truthy(/· Believer$/.test(NPC.dialogue(scene(), b).title));
  });

  test('story neighbours: the warden still opens with the family and the safe area', () => {
    const w = person('warden');
    const talk = NPC.dialogue(scene({}), w);
    assert.truthy(talk.body.includes(NPC.WARDEN_LINE) && talk.body.includes(MemoryStory.HOME.body));
    assert.eq(JSON.stringify(NPC.warden('npc_warden_1_2')), JSON.stringify(NPC.storyNeighbour('npc_warden_1_2', 'warden')));
  });

  test('roles: every zone labels every role, and the new roles are drawn', () => {
    const roles = new Set(Object.values(NPC.PROFILES).flatMap(p => p.roles));
    for (const role of ['mason', 'lamplighter', 'keeper']) assert.truthy(roles.has(role), `${role} is in a profile`);
    for (const [zone, labels] of Object.entries(NPC.LABELS)) for (const role of roles) assert.truthy(labels[role], `${zone} labels ${role}`);
    const seen = new Set();
    for (let i = 0; i < 600; i++) seen.add(NPC.identity(`npc_3_3_${i}_2`, 'village').role);
    for (const role of ['mason', 'lamplighter', 'scholar', 'scout', 'merchant', 'trader']) assert.truthy(seen.has(role), `a village draws a ${role}`);
  });

  test('roles: the mason counts the restoration ledger and points at the nearest wreck', () => {
    const c = Object.assign({ id: 'npc_1_1_1_1', x: 0, y: 0 }, NPC.identity('npc_1_1_1_1'), { role: 'mason', roleLabel: 'Mason' });
    const realWalk = WorldGen.forEachItemInBox;
    const cache = Array.from(WorldGen.tileCache.entries());
    WorldGen.tileCache.clear(); WorldGen.tileCache.set('0,0', {});
    const houses = [
      { kind: 'house', tier: 9, id: 'near', x: 0, y: -30 }, { kind: 'house', tier: 9, id: 'far', x: 10000, y: 0 },
      { kind: 'house', tier: 9, id: 'mended', x: 5, y: 0 }, { kind: 'house', tier: 11, id: 'fort', x: 3, y: 0 },
    ];
    WorldGen.forEachItemInBox = (tile, kind, x0, y0, x1, y1, fn) => { if (kind === 'objects') houses.forEach(fn); };
    try {
      const s = scene({ restoredHouses: { mended: 'plain' } });
      const talk = NPC.dialogue(s, c, Date.UTC(2026, 8, 28));
      assert.truthy(/One roof stands again/.test(talk.body), 'the ledger, in words');
      assert.truthy(/wreck .*north of here/.test(talk.body), 'the nearest wreck that still waits, not the mended one or the fort');
      s.save.restoredHouses = { mended: 'plain', b: 'plain', c: 'plain' };
      assert.truthy(/3 roofs stand again/.test(NPC.dialogue(s, c).body));
      s.save.restoredHouses = {};
      assert.truthy(/wreck/.test(NPC.dialogue(s, c).body), 'nothing mended yet: the wrecks are waiting');
      houses.length = 0;
      assert.truthy(/No wreck near here/.test(NPC.dialogue(s, c).body));
      assert.truthy(/· Mason$/.test(NPC.dialogue(s, c).title));
    } finally {
      WorldGen.forEachItemInBox = realWalk;
      WorldGen.tileCache.clear(); for (const [key, value] of cache) WorldGen.tileCache.set(key, value);
    }
  });

  test('roles: the lamplighter reads the living-lamp ledger', () => {
    const c = Object.assign({ id: 'npc_1_1_2_1', x: 0, y: 0 }, NPC.identity('npc_1_1_2_1'), { role: 'lamplighter' });
    const dark = NPC.dialogue(scene({}), c).body;
    assert.truthy(/lamp/i.test(dark) && !/\d/.test(dark), 'no lamps yet: an invitation, not a count');
    const lit = NPC.dialogue(scene({ lampVisits: { a: 1, b: 2, c: 3 } }), c).body;
    assert.truthy(/3 lamps burn brighter/.test(lit));
    assert.truthy(lit.includes(shortDuration(Streets.LAMP_FADE_MS)), 'the fade is the owning constant');
    assert.truthy(/One lamp burns/.test(NPC.dialogue(scene({ lampVisits: { a: 1 } }), c).body));
  });

  test('roles: every named zone with residents has a keeper, who tells that zone\'s story', () => {
    for (const kind of ['grove', 'stones', 'beach']) {
      const e = {
        cellsPerEdge: 32, grid: new Uint8Array(32 * 32).fill(T.PARK), objects: [], genObjects: [], wildplants: [], roadMask: new Uint8Array(32 * 32),
        zone: { idx: new Uint8Array(32 * 32).fill(1), s: new Uint8Array(32 * 32).fill(255), anchors: [{ kind }] },
      };
      e.genObjects.push({ id: 'grove_shrine', kind: 'grove_shrine', x: 16 * 7, y: 16 * 7 });
      const s = { tileEdgeM: 32 * 7, cellM: 7, save: { caught: [], opened: [] } };
      const residents = NPC.spawn(s, e, 0, 0, {});
      assert.eq(residents.length, NPC.COUNT);
      assert.truthy(residents.every(c => c.zoneKind === kind), 'residents know their zone');
      const keepers = residents.filter(c => c.role === 'keeper');
      assert.gt(keepers.length, 0, `${kind} has a keeper`);
      assert.eq(keepers[0].roleLabel, NPC.LABELS.shrine.keeper);
      const talk = NPC.dialogue(s, keepers[0]);
      assert.includes(Zones.ZONE_KINDS[kind].keeper, talk.body, `${kind}'s keeper tells its story`);
      const again = NPC.spawn(s, e, 0, 0, {});
      assert.eq(JSON.stringify(again.map(c => [c.id, c.role])), JSON.stringify(residents.map(c => [c.id, c.role])), 'the keeper is the same person every build');
    }
    // The guarantee reseats only when the roll left a zone without one.
    const people = [{ id: 'a', zone: 'shrine', zoneKind: 'grove', role: 'scout' }, { id: 'b', zone: 'shrine', zoneKind: 'grove', role: 'keeper' }, { id: 'c', zone: 'village', zoneKind: 'grove', role: 'scout' }];
    NPC.seatKeepers(people);
    assert.eq(people.map(p => p.role).join(','), 'scout,keeper,scout', 'a keeper already drawn is enough; villagers stay villagers');
    const plain = Object.assign({ id: 'npc_9_9_9_9', x: 0, y: 0 }, NPC.identity('npc_9_9_9_9', 'shrine'), { role: 'keeper' });
    assert.includes(NPC.KEEPER_DEFAULT, NPC.dialogue(scene(), plain).body, 'a keeper off a plain shrine has the default lines');
    for (const [kind, row] of Object.entries(Zones.ZONE_KINDS)) assert.truthy(Array.isArray(row.keeper) && row.keeper.length, `${kind} row carries its keeper column`);
  });
})();
