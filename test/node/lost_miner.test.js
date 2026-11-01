// THE LOST MINER (lost_miner.js): one seat on the level under the trailer,
// found by a talk, up to the trailer with the story neighbours, housed for
// torches (npc_benefits.test.js has the gift; npc_housing.test.js the roof).
(function () {
  const T = WorldGen.T;
  const N = 40, CELL_M = 7, EDGE_M = N * CELL_M;
  const ANCHOR = { x: 20.5 * CELL_M, y: 20.5 * CELL_M };
  const caveEntry = () => {
    const grid = new Uint8Array(N * N).fill(T.CAVE_FLOOR);
    for (let i = 0; i < N; i++) { grid[i] = T.CAVE_WALL; grid[(N - 1) * N + i] = T.CAVE_WALL; grid[i * N] = T.CAVE_WALL; grid[i * N + N - 1] = T.CAVE_WALL; }
    const stair = { kind: 'staircase', dir: 'up', id: 'stair', x: ANCHOR.x, y: ANCHOR.y };
    return { grid, baseGrid: grid, cellsPerEdge: N, tileEdgeM: EDGE_M, _spawned: true,
      objects: [stair], genObjects: [stair], wildplants: [], creatures: [],
      spawnWhy: new Uint32Array(N * N), _spawnOpts: { spawnWhy: new Uint32Array(N * N), occupied: new Set() } };
  };
  const scene = (depth = 1, save = {}) => ({ depth, tileEdgeM: EDGE_M, cellM: CELL_M,
    save: { caught: [], opened: [], discovered: {}, starterCratesAt: ANCHOR, ...save },
    _dialogOpen: () => false, showMessageModal(p) { this.shown = p; } });
  const cellOf = c => ({ cx: Math.floor(c.x / CELL_M), cy: Math.floor(c.y / CELL_M) });

  test('lost miner: one deterministic seat on the first level under the trailer, out of sight of the stairs', () => {
    const s = scene(), entry = caveEntry(), creatures = [], occupied = new Set();
    const c = LostMiner.seat(s, entry, 0, 0, 1, creatures, occupied);
    assert.truthy(c, 'seated');
    assert.eq(c.id, 'npc_miner_0_0', 'the starter tile\'s id, as the trailer will know him');
    assert.eq(c.kind, 'npc'); assert.eq(c.role, 'miner'); assert.eq(c.name, 'Cobb'); assert.eq(c.roleLabel, 'Miner'); assert.eq(c.depth, 1);
    assert.eq(creatures.length, 1); assert.eq(occupied.size, 1, 'the seat is reserved');
    const { cx, cy } = cellOf(c);
    assert.eq(entry.grid[cy * N + cx], T.CAVE_FLOOR);
    assert.gt(Math.max(Math.abs(cx - 20), Math.abs(cy - 20)), LostMiner.STAIR_CLEAR_CELLS, 'lost: never within sight of the way up');
    const again = LostMiner.seat(scene(), caveEntry(), 0, 0, 1, [], new Set());
    assert.eq(JSON.stringify(cellOf(again)), JSON.stringify({ cx, cy }), 'the same cell on every build');
    assert.eq(LostMiner.seat(s, entry, 0, 0, 1, creatures, occupied), null, 'idempotent by id');
    assert.eq(LostMiner.seat(s, caveEntry(), 0, 0, 2, [], new Set()), null, 'the first level only');
    assert.eq(LostMiner.seat(s, caveEntry(), 1, 0, 1, [], new Set()), null, 'the tile under the trailer only');
    assert.eq(LostMiner.seat(scene(1, { lostMiner: { status: 'found' } }), caveEntry(), 0, 0, 1, [], new Set()), null, 'found: he is up on the lane');
    const taken = caveEntry(), held = new Set([cy * N + cx]);
    const moved = LostMiner.seat(scene(), taken, 0, 0, 1, [], held);
    assert.truthy(moved && JSON.stringify(cellOf(moved)) !== JSON.stringify({ cx, cy }), 'a held cell is refused, not re-rolled onto');
    assert.falsy(NPC.storyNeighbourDue(s.save, 'miner'), 'not due by the trailer until found');
  });

  test('lost miner: the talk that finds him marks the save, makes him eligible for a roof and sends him up', () => {
    const cache = WorldGen.tileCacheFor(1), previous = [...cache];
    cache.clear();
    try {
      const s = scene(), entry = caveEntry();
      cache.set(WorldGen.tileKey(0, 0), entry);
      const c = LostMiner.seat(s, entry, 0, 0, 1, entry.creatures, new Set());
      s.depth = 0;
      assert.falsy(LostMiner.interact(s, c), 'on the surface his talk is NPC.dialogue\'s');
      s.depth = 1;
      assert.falsy(LostMiner.interact(s, { ...c, role: 'scout' }), 'only the miner');
      s._dialogOpen = () => true;
      assert.truthy(LostMiner.interact(s, c)); assert.falsy(s.save.lostMiner?.status, 'a modal already open: nothing found');
      s._dialogOpen = () => false;
      assert.truthy(LostMiner.interact(s, c));
      assert.eq(s.save.lostMiner.status, 'found');
      assert.truthy(s.save.npcMet['npc_miner_0_0'], 'eligible for a roof at once');
      assert.eq(s.shown.kind, 'talk'); assert.eq(s.shown.kindLabel, 'Cobb, Miner');
      assert.truthy(s.shown.body.includes(LostMiner.LOST) && s.shown.body.includes(LostMiner.FOUND), 'lost, then found');
      assert.eq(s.shown.portrait, 'assets/portraits/stonemason.png', 'the stonemason\'s face');
      assert.truthy(entry.creatures.includes(c), 'he stays until the talk closes');
      s.shown.onDismiss();
      assert.falsy(entry.creatures.includes(c), 'then follows the light up');
      assert.truthy(NPC.storyNeighbourDue(s.save, 'miner'), 'due by the trailer now');
      entry.creatures.push(c);
      assert.truthy(LostMiner.interact(s, c), 'found already: a leftover body only leaves');
      assert.falsy(entry.creatures.includes(c));
    } finally { cache.clear(); for (const [k, v] of previous) cache.set(k, v); }
  });

  test('lost miner: found, the trailer seats him with the story neighbours and he talks of torches', () => {
    const entry = { grid: new Uint8Array(N * N).fill(T.GRASS), cellsPerEdge: N, _spawned: true,
      objects: [], wildplants: [], creatures: [], roadMask: new Uint8Array(N * N), spawnWhy: new Uint8Array(N * N) };
    const s = { tileEdgeM: EDGE_M, cellM: CELL_M, depth: 0, save: { caught: [], opened: [], discovered: {}, starterCratesAt: ANCHOR }, _starterTrailAnchor: () => ANCHOR };
    assert.eq(Starter.placeSafeAreaWarden(s, entry, 0, 0), 1, 'a new save: Tilly alone');
    s.save.lostMiner = { status: 'found' };
    assert.eq(Starter.placeSafeAreaWarden(s, entry, 0, 0), 1, 'found: Cobb comes up to the trailer');
    const cobb = entry.creatures.find(c => c.id === 'npc_miner_0_0');
    assert.truthy(cobb); assert.eq(cobb.name, 'Cobb'); assert.eq(cobb.roleLabel, 'Miner');
    assert.eq(SpriteLayout.npcSheet(cobb).idle, 'npc_stonemason_idle', 'the stonemason\'s sheet');
    assert.eq(SpriteLayout.npcSheet(cobb).tint, 0xffffff, 'untinted');
    assert.eq(NPC.portrait(s, cobb), 'assets/portraits/stonemason.png');
    const talk = NPC.dialogue(s, cobb, Date.UTC(2026, 10, 1));
    assert.eq(talk.title, 'Cobb, Miner');
    assert.truthy(LostMiner.WAITING.includes(talk.body), 'waiting for a roof');
    s.save.npcHomes = { npc_miner_0_0: { houseId: 'roof' } };
    s.save.houseLuxury = { roof: { score: 2 } };
    const housed = NPC.dialogue(s, cobb, Date.UTC(2026, 10, 1));
    assert.truthy(LostMiner.HOUSED.some(line => housed.pages[0] === line), 'under a roof');
    assert.eq(housed.pages[1], '1 Torch each day. Visit or talk to collect.');
    assert.eq(NPCBenefits.GIFTS.miner.id, 'torch');
  });
})();
