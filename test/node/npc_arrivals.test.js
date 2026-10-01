// THE PEOPLE COME BACK AS THE PAST DOES. A tile's residents are drawn in
// full (NPC.spawn — the same people for every player) but none is about on
// a new save: the warden by the trailer is the one neighbour on screen. They
// return RETURN_PER_MEMORY per recovered memory, and linger inside Home's
// ring or within LINGER_CELLS of a restored house — a tile with neither gets
// nobody back. Keepers never left. Nobody is watched arriving. And the
// family's plea (MemoryStory.HOME) is the warden's on a tap, never a splash.
(function () {
  const T = WorldGen.T;
  const N = 40, CELL_M = 7, EDGE_M = N * CELL_M;
  const HOME = { kind: 'house', id: 'home_1', x: 10.5 * CELL_M, y: 10.5 * CELL_M };
  const MENDED = { kind: 'house', id: 'house_mended', x: 30.5 * CELL_M, y: 30.5 * CELL_M };
  const WRECK = { kind: 'house', id: 'house_wreck', x: 30.5 * CELL_M, y: 8.5 * CELL_M };
  const entry = (terrain = T.PARK) => ({
    grid: new Uint8Array(N * N).fill(terrain), cellsPerEdge: N, _spawned: true,
    objects: [HOME, MENDED, WRECK], genObjects: [], wildplants: [], creatures: [],
    roadMask: new Uint8Array(N * N), spawnWhy: new Uint8Array(N * N),
  });
  const scene = (save = {}, { home = true } = {}) => {
    const s = { tileEdgeM: EDGE_M, cellM: CELL_M, save: { caught: [], opened: [], discovered: {}, restoredHouses: {}, ...save } };
    s.homeWorldPos = () => (home ? HOME : null);
    s.inHomeRing = (x, y) => home && Math.hypot(x - HOME.x, y - HOME.y) <= 4 * CELL_M;
    return s;
  };
  const remember = (s, n) => { for (let i = Object.keys(s.save.discovered).length; i < n; i++) s.save.discovered[`m${i}`] = 1; };
  const draw = (s, e) => { e._residents = NPC.spawn(s, e, 0, 0, {}); e._residentsTile = { tx: 0, ty: 0 }; return e._residents; };
  const cheb = (a, b) => Math.max(Math.abs(Math.floor(a.x / CELL_M) - Math.floor(b.x / CELL_M)), Math.abs(Math.floor(a.y / CELL_M) - Math.floor(b.y / CELL_M)));

  test('arrivals: a new save has nobody about, however many residents the tile drew', () => {
    const s = scene(), e = entry();
    const people = draw(s, e);
    assert.eq(people.length, NPC.COUNT, 'the draw is untouched');
    assert.eq(NPC.arrivals(s, e, 0, 0).length, 0, 'no memories: no one returns');
    assert.eq(e.creatures.length, 0);
    assert.eq(NPC.returnedCount(s.save), 0);
  });

  test('arrivals: residents return two a memory, to Home\'s ring or a restored house, never a wreck', () => {
    const s = scene({ restoredHouses: { house_mended: 'plain' } }), e = entry();
    draw(s, e);
    remember(s, 3);
    const back = NPC.arrivals(s, e, 0, 0);
    assert.eq(back.length, 3 * NPC.RETURN_PER_MEMORY, 'two per memory');
    assert.eq(NPC.RETURN_PER_MEMORY, 2);
    assert.eq(e.creatures.length, back.length, 'seated on the tile');
    for (const c of back) {
      const nearHome = s.inHomeRing(c.x, c.y), nearMended = cheb(c, MENDED) <= NPC.LINGER_CELLS;
      assert.truthy(nearHome || nearMended, `${c.id} lingers by Home or the mended house`);
      assert.gt(cheb(c, WRECK), NPC.LINGER_CELLS, 'nobody goes back to a wreck');
      assert.eq(c.homeX, c.x); assert.eq(c.homeY, c.y);
      assert.truthy(c.name && c.role, 'the same person the draw named');
    }
    assert.eq(new Set(back.map(c => Math.floor(c.x / CELL_M) + ',' + Math.floor(c.y / CELL_M))).size, back.length, 'one to a cell');
    // Idempotent, and more come as the ledger grows — the earlier ones stay put.
    assert.eq(NPC.arrivals(s, e, 0, 0).length, 0);
    const seats = JSON.stringify(e.creatures.map(c => [c.id, c.x, c.y]));
    remember(s, 5);
    assert.eq(NPC.arrivals(s, e, 0, 0).length, 2 * NPC.RETURN_PER_MEMORY, 'two more memories, four more people');
    assert.eq(JSON.stringify(e.creatures.slice(0, back.length).map(c => [c.id, c.x, c.y])), seats, 'the first six never moved');
    remember(s, 40);
    NPC.arrivals(s, e, 0, 0);
    assert.eq(e.creatures.length, NPC.COUNT, 'in the end, everyone is home');
  });

  test('arrivals: the same ledger seats the same person on the same cell, for every player', () => {
    const a = scene({ restoredHouses: { house_mended: 'plain' } }), b = scene({ restoredHouses: { house_mended: 'plain' } });
    const ea = entry(), eb = entry();
    draw(a, ea); draw(b, eb);
    remember(a, 4); remember(b, 4);
    NPC.arrivals(a, ea, 0, 0); NPC.arrivals(b, eb, 0, 0);
    assert.eq(JSON.stringify(ea.creatures.map(c => [c.id, c.x, c.y])), JSON.stringify(eb.creatures.map(c => [c.id, c.x, c.y])));
  });

  test('arrivals: a tile with nothing restored and no Home gets nobody back', () => {
    const s = scene({}, { home: false }), e = entry();
    e.objects = [WRECK];
    draw(s, e);
    remember(s, 20);
    assert.eq(NPC.arrivals(s, e, 0, 0).length, 0, 'nowhere to come back to');
    assert.eq(NPC.anchorsIn(s, e, 0, 0).length, 0);
    s.save.restoredHouses.house_wreck = 'plain';
    assert.gt(NPC.arrivals(s, e, 0, 0).length, 0, 'mend it, and they come');
    assert.truthy(e.creatures.every(c => cheb(c, WRECK) <= NPC.LINGER_CELLS), 'all round the one restored house');
  });

  test('arrivals: a zone keeper never left', () => {
    const s = scene({}, { home: false }), e = entry(T.PARK);
    e.objects = [];
    e.zone = { idx: new Uint8Array(N * N).fill(1), s: new Uint8Array(N * N).fill(255), anchors: [{ kind: 'grove' }] };
    e.genObjects.push({ id: 'grove_shrine', kind: 'grove_shrine', x: 16 * CELL_M, y: 16 * CELL_M });
    const people = draw(s, e);
    const keeper = people.find(c => c.role === 'keeper');
    assert.truthy(keeper, 'the grove has a keeper');
    const back = NPC.arrivals(s, e, 0, 0);
    assert.eq(back.map(c => c.id).join(','), keeper.id, 'the keeper alone, on a new save with nothing restored');
    assert.eq(back[0].x, keeper.x); assert.eq(back[0].y, keeper.y);
    assert.gt(people.filter(c => c.role === 'keeper').length, 1, 'the lottery drew other keepers; only the zone\'s own stayed');
    assert.eq([...NPC.stayers(people)].join(','), keeper.id);
    assert.eq(NPC.stayers([{ id: 'k', role: 'keeper' }, { id: 's', role: 'scout', zoneKind: 'grove' }]).size, 0, 'a keeper off a plain shrine returns like anyone');
  });

  test('arrivals: nobody is watched appearing — a seat in view waits', () => {
    const s = scene(), e = entry();
    draw(s, e);
    remember(s, 2);
    assert.eq(NPC.arrivals(s, e, 0, 0, e._residents, { offscreen: () => false }).length, 0, 'in view: nobody');
    assert.eq(NPC.arrivals(s, e, 0, 0, e._residents, { offscreen: () => true }).length, 4, 'looked away: they are there');
    // The viewport test itself: half the view plus a cell, about the player.
    const eyes = Object.assign(scene(), { viewSize: 352, mPerPx: 1, startWorldM: { x: 0, y: 0 }, playerM: { x: 100, y: 100 }, cellM: 10 });
    const off = NPC.offscreenAt(eyes);
    assert.falsy(off(100 + 176, 100), 'the view\'s edge is in view');
    assert.truthy(off(100 + 176 + 11, 100), 'a cell past it is not');
    assert.truthy(NPC.offscreenAt(scene())(0, 0), 'no viewport (a test): hides nothing');
  });

  test('arrivals: the pass seats the due on every spawned surface tile, and the starter tile\'s story neighbours', () => {
    const s = Object.assign(scene({ starterCratesAt: { x: 20.5 * CELL_M, y: 20.5 * CELL_M } }), { depth: 0, _starterTrailAnchor: () => s.save.starterCratesAt });
    const e = entry();
    draw(s, e);
    e._starterTile = true;
    const cache = Array.from(WorldGen.tileCacheFor(0).entries());
    WorldGen.tileCacheFor(0).clear();
    WorldGen.tileCacheFor(0).set(WorldGen.tileKey(0, 0), e);
    try {
      remember(s, 3);
      assert.eq(NPC.tickArrivals(s, 1000), 3 * NPC.RETURN_PER_MEMORY + 2, 'six residents, the warden and the believer');
      assert.eq(NPC.tickArrivals(s, 1500), 0, 'throttled');
      assert.eq(NPC.tickArrivals(s, 4000), 0, 'and nothing new is due');
      s.depth = 1;
      remember(s, 4);
      assert.eq(NPC.tickArrivals(s, 8000), 0, 'not underground');
      s.depth = 0;
      assert.eq(NPC.tickArrivals(s, 12000), NPC.RETURN_PER_MEMORY, 'back on the surface: the next two');
    } finally {
      WorldGen.tileCacheFor(0).clear(); for (const [k, v] of cache) WorldGen.tileCacheFor(0).set(k, v);
    }
    // The call sites: the tile spawn hands the draw to arrivals, the update loop runs the pass.
    assert.truthy(/entry\._residents = NPC\.spawn\(this, entry, tx, ty, _spawnOpts\);/.test(SCENE_SRC), 'the draw is kept on the entry');
    assert.truthy(/NPC\.arrivals\(this, entry, tx, ty\);/.test(SCENE_SRC), 'and seated through arrivals');
    assert.falsy(/creatures\.push\(\.\.\.NPC\.spawn\(/.test(SCENE_SRC), 'never pushed whole');
    assert.truthy(/NPC\.tickArrivals\(this, Date\.now\(\)\);/.test(SCENE_SRC), 'the pass runs from update()');
  });

  test('home page: the warden says it on a tap; nothing splashes it', () => {
    assert.eq(typeof MemoryStory.enqueueHome, 'undefined', 'no queueing of the home page');
    assert.falsy(/enqueueHome/.test(ALL_SRC['starter.js']), 'seating the warden queues nothing');
    const w = { id: 'npc_warden_0_0', kind: 'npc', ...NPC.warden('npc_warden_0_0') };
    const talk = NPC.dialogue({ save: {} }, w);
    assert.truthy(talk.body.startsWith(MemoryStory.HOME.body), 'the family\'s plea opens the warden\'s talk');
    // An older save with the page queued: dropped, not shown.
    const shown = [];
    const s = { save: { memoryStory: { pending: [{ id: 'home', npc: { id: 'x' } }], act2Seen: [], visits: 0 } }, showMessageModal: m => shown.push(m) };
    const doc = globalThis.document;
    globalThis.document = { body: { classList: { contains: () => false } } };
    try {
      assert.eq(MemoryStory.drain(s), false, 'nothing to show');
      assert.eq(shown.length, 0);
      assert.eq(s.save.memoryStory.pending.length, 0, 'the stale record is gone');
      s.save.memoryStory.pending = [{ id: 'home' }, { id: 'memory:3', memory: 3, label: 'a thing' }];
      assert.eq(MemoryStory.drain(s), true, 'a real memory page still shows');
      assert.eq(shown[0].title, MemoryStory.SCENES[3].title);
    } finally { globalThis.document = doc; }
  });

  test('forge: the player notices the finished piece', () => {
    const FORGE = new Function(`${SCENE_SRC.match(/const FORGE_CEREMONY = \{[\s\S]*?\n\};/)[0]} return FORGE_CEREMONY;`)();
    assert.truthy(/smith.*finished gear/i.test(FORGE.sub), 'the smith presents the finished work');
    assert.falsy(/[“”]/.test(FORGE.sub), 'the panel uses the player’s narrator, not a separate speaker');
  });
})();
