// THE STRANGER — Ayo in human form (story bible §2, NPC.STORY_ROLES.stranger).
// In town by the trailer from eleven memories: white hair, no name, knows the
// Hood and will not say so. The lane gossips about her, each neighbour once
// (MemoryStory.STRANGER_RUMOURS), and nobody says what she is.
(function () {
  const T = WorldGen.T, N = 40, CELL_M = 7, EDGE_M = N * CELL_M;
  const save = (memories, extra = {}) => {
    const s = { caught: [], opened: [], discovered: {}, restoredHouses: {}, ...extra };
    for (let i = 0; i < memories; i++) s.discovered[`m${i}`] = 1;
    return s;
  };
  const scene = s => ({ tileEdgeM: EDGE_M, cellM: CELL_M, save: s });
  const person = (role, id = `npc_${role}_0_0`) => ({ id, kind: 'npc', x: 0, y: 0, ...NPC.storyNeighbour(id, role) });
  const pagesOf = talk => talk.pages || [talk.body];

  test('stranger: a nameless white-haired newcomer, by the trailer from eleven memories', () => {
    const row = NPC.STORY_ROLES.stranger;
    assert.eq(row.minMemories, 11);
    assert.falsy(row.radiusM || row.arrives, 'seated in town with the trailer neighbours');
    assert.falsy(/Ayo/i.test(row.name + row.label), 'her shown name never gives her away');
    assert.truthy(/white-haired/i.test(row.name));
    const entry = { grid: new Uint8Array(N * N).fill(T.GRASS), cellsPerEdge: N, _spawned: true, objects: [], wildplants: [],
      creatures: [], roadMask: new Uint8Array(N * N), spawnWhy: new Uint8Array(N * N) };
    const anchor = { x: 20.5 * CELL_M, y: 20.5 * CELL_M }, s = save(10, { starterCratesAt: anchor });
    const sc = { tileEdgeM: EDGE_M, save: s, _starterTrailAnchor: () => anchor };
    Starter.placeSafeAreaWarden(sc, entry, 0, 0);
    assert.falsy(entry.creatures.some(c => c.role === 'stranger'), 'ten memories: not yet');
    s.discovered.m10 = 1;
    Starter.placeSafeAreaWarden(sc, entry, 0, 0);
    const her = entry.creatures.find(c => c.role === 'stranger');
    assert.truthy(her, 'eleven: she is in town');
    assert.eq(her.name, row.name);
    const cell = { cx: Math.floor(her.x / CELL_M), cy: Math.floor(her.y / CELL_M) };
    assert.inRange(Math.max(Math.abs(cell.cx - 20), Math.abs(cell.cy - 20)), 3, 8, 'a few cells from the trailer');
  });

  test('stranger: her own sheet, white-haired, and her sprite for a portrait', () => {
    const sheet = SpriteLayout.npcSheet(person('stranger'));
    assert.eq(sheet.role, 'stranger');
    assert.eq(sheet.path, 'assets/NPC/Ayo_human_idle.png');
    assert.eq(sheet.tint, 0xffffff, 'the white is baked into the sheet, not a tint');
    assert.falsy(NPC.STORY_ROLES.stranger.art, 'no painting yet');
  });

  test('stranger: she almost knows you, and denies it; she never moves into a house', () => {
    const s = scene(save(11)), her = person('stranger');
    const first = NPC.dialogue(s, her);
    assert.eq(JSON.stringify(first.pages), JSON.stringify(MemoryStory.STRANGER.first), 'two pages on first meeting');
    assert.truthy(/thought you were someone I knew/.test(first.pages[0]));
    assert.truthy(/don’t give it/.test(first.pages[1]), 'she gives no name');
    const seen = new Set();
    for (let i = 0; i < MemoryStory.STRANGER.warm.length; i++) seen.add(NPC.dialogue(s, her).body);
    assert.eq(seen.size, MemoryStory.STRANGER.warm.length, 'later talks rotate through her lines');
    for (const line of seen) assert.truthy(MemoryStory.STRANGER.warm.includes(line));
    const cold = scene(save(MemoryStory.LEAVE_MEMORIES, { memoryStory: { stranger: { met: true } } }));
    assert.truthy(MemoryStory.STRANGER.cold.includes(NPC.dialogue(cold, her).body), 'after the tower goes cold');
    const live = { ...her, _homeAnchor: '' };
    assert.falsy(NPC.meetHomeNeighbour({ depth: 0, save: s.save }, live), 'passing through: no roof');
    assert.falsy(s.save.npcHomes, 'nothing recorded for her');
  });

  test('stranger: each neighbour gossips about her once, and not before she comes', () => {
    const early = scene(save(10, { memoryStory: { wardenMet: true } }));
    const bryn = person('warden');
    assert.falsy(pagesOf(NPC.dialogue(early, bryn)).some(p => /white-haired/.test(p)), 'no gossip before she arrives');
    const s = scene(save(11, { memoryStory: { wardenMet: true } }));
    const talk = pagesOf(NPC.dialogue(s, bryn));
    assert.eq(talk[talk.length - 1], MemoryStory.STRANGER_RUMOURS.arrival.warden, 'the rumour is the last page');
    assert.falsy(pagesOf(NPC.dialogue(s, bryn)).includes(MemoryStory.STRANGER_RUMOURS.arrival.warden), 'told once');
    for (const role of ['witness', 'believer', 'wanderer']) {
      assert.truthy(pagesOf(NPC.dialogue(s, person(role))).includes(MemoryStory.STRANGER_RUMOURS.arrival[role]), `${role} gossips`);
    }
    for (let i = 11; i < MemoryStory.LEAVE_MEMORIES; i++) s.save.discovered[`m${i}`] = 1;
    assert.truthy(pagesOf(NPC.dialogue(s, bryn)).includes(MemoryStory.STRANGER_RUMOURS.cold.warden), 'a second round once the tower goes cold');
    assert.eq(JSON.stringify(Object.keys(s.save.memoryStory.strangerRumours).sort()),
      JSON.stringify(['arrival:believer', 'arrival:wanderer', 'arrival:warden', 'arrival:witness', 'cold:warden']));
  });

  test('stranger: nobody, herself included, says what she or the Hood is', () => {
    const copy = [...Object.values(MemoryStory.STRANGER).flat(),
      ...Object.values(MemoryStory.STRANGER_RUMOURS).flatMap(Object.values)].join(' ');
    assert.falsy(/dragon|conquer|scales|wings|fire breath|sister|brother|father|Tiamat|Ayo|white one/i.test(copy));
    for (const line of copy.split(' \n')) assert.falsy(/<(?!\/?em>)/.test(line), 'only <em> markup');
  });
})();
