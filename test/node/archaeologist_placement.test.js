(function () {
  const T = WorldGen.T, N = 100, CELL = 7, EDGE = N * CELL;
  const entry = (fill = T.WATER) => ({ cellsPerEdge: N, _spawned: true,
    grid: new Uint8Array(N * N).fill(fill), objects: [], wildplants: [], creatures: [],
    roadMask: new Uint8Array(N * N), spawnWhy: new Uint16Array(N * N), _residents: [] });
  const scene = (anchor = { x: 97.5 * CELL, y: 50.5 * CELL }) => ({ depth: 0, tileEdgeM: EDGE,
    cellM: CELL, save: { starterCratesAt: anchor, discovered: {}, restoredHouses: {} } });
  const cache = (rows, fn) => {
    const live = WorldGen.tileCacheFor(0), previous = new Map(live);
    live.clear();
    for (const [tx, ty, e] of rows) {
      e._residentsTile = { tx, ty };
      live.set(WorldGen.tileKey(tx, ty), e);
    }
    try { fn(live); } finally { live.clear(); for (const [k, v] of previous) live.set(k, v); }
  };
  const corridor = () => {
    const home = entry(), east = entry();
    for (let x = 95; x < N; x++) home.grid[50 * N + x] = T.PATH;
    for (let x = 0; x < 65; x++) east.grid[50 * N + x] = T.PATH;
    return { home, east };
  };

  test('Orrin: available at zero memories across a tile seam, and only once', () => {
    const { home, east } = corridor(), s = scene();
    cache([[0, 0, home]], live => {
      assert.eq(Starter.placeDistantStoryNeighbours(s), 0, 'missing neighbouring map is not invented');
      assert.falsy(s.save.storyNeighbourSeats?.archaeologist, 'no premature seat');
      east._residentsTile = { tx: 1, ty: 0 };
      live.set(WorldGen.tileKey(1, 0), east);
      assert.eq(NPC.tickArrivals(s, 1000), 1, 'a streamed tile brings Orrin without a memory gate');
      const c = east.creatures[0];
      assert.eq(c.name, 'Orrin'); assert.eq(c.role, 'archaeologist');
      assert.eq(c.roleLabel, 'Dragon Archaeologist');
      assert.eq(c.id, 'npc_archaeologist_0_0', 'identity belongs to original Home');
      assert.eq(c.zone, 'village', 'existing human identity');
      assert.inRange(Math.hypot(c.x - s.save.starterCratesAt.x, c.y - s.save.starterCratesAt.y), 225, 275);
      assert.eq(c.homeX, c.x); assert.eq(c.homeY, c.y);
      assert.eq(home.creatures.length, 0);
      assert.eq(NPC.tickArrivals(s, 4000), 0);
      assert.eq(Starter.placeDistantStoryNeighbours(s), 0);
      assert.eq(east.creatures.length, 1);
      const saved = JSON.parse(JSON.stringify(s.save));
      const position = { x: c.x, y: c.y };
      const rebuilt = corridor().east;
      live.clear(); live.set(WorldGen.tileKey(1, 0), rebuilt);
      assert.eq(Starter.placeDistantStoryNeighbours({ ...s, save: saved, startWorldM: { x: 5000, y: 5000 } }), 1,
        'frozen seat rebuilds even when original Home tile is unloaded and Home has moved');
      assert.eq(JSON.stringify({ x: rebuilt.creatures[0].x, y: rebuilt.creatures[0].y }), JSON.stringify(position));
      assert.eq(rebuilt.creatures[0].id, c.id);
    });
  });

  test('Orrin: prefers a reachable path, refuses occupied and restricted seats', () => {
    const e = entry(T.GRASS), s = scene({ x: 50.5 * CELL, y: 50.5 * CELL });
    // A north-going path wins over equally distant open grass.
    for (let y = 0; y < N; y++) e.grid[y * N + 50] = T.PATH;
    for (let y = 0; y < 25; y++) e.spawnWhy[y * N + 50] = WorldGen.SPAWN_WHY.RESTRICTED;
    e.objects.push({ x: 50.5 * CELL, y: 85.5 * CELL });
    cache([[0, 0, e]], () => {
      assert.eq(Starter.placeDistantStoryNeighbours(s), 1);
      const c = e.creatures[0], cx = Math.floor(c.x / CELL), cy = Math.floor(c.y / CELL);
      assert.truthy(Math.abs(cx - 50) <= 1, 'on path or adjacent verge');
      assert.truthy(WorldGen.isSpawnCell(e.grid, N, N, cx, cy, { spawnWhy: e.spawnWhy, roadMask: e.roadMask }, 'npc'));
      assert.falsy(e.objects.some(o => o.x === c.x && o.y === c.y), 'no overlap');
    });
  });

  test('Orrin: a legal cell beyond water is not a reachable dig', () => {
    const e = entry(), s = scene({ x: 50.5 * CELL, y: 50.5 * CELL });
    e.grid[50 * N + 50] = T.PATH;
    e.grid[50 * N + 86] = T.GRASS;
    cache([[0, 0, e]], () => {
      assert.eq(Starter.placeDistantStoryNeighbours(s), 0);
      assert.falsy(s.save.storyNeighbourSeats?.archaeologist);
    });
  });

  test('Orrin: offscreen and passing people defer; a permanent obstruction relocates the dig', () => {
    const { home, east } = corridor(), s = scene();
    cache([[0, 0, home], [1, 0, east]], () => {
      assert.eq(Starter.placeDistantStoryNeighbours(s, { offscreen: () => false }), 0);
      const seat = { ...s.save.storyNeighbourSeats.archaeologist };
      assert.eq(Starter.placeDistantStoryNeighbours(s, { offscreen: () => true }), 1);
      east.creatures = [{ id: 'passing_person', ...seat }];
      assert.eq(Starter.placeDistantStoryNeighbours(s), 0);
      assert.eq(JSON.stringify(s.save.storyNeighbourSeats.archaeologist), JSON.stringify(seat), 'a passing person never moves the dig');
      east.creatures = [];
      east.objects.push({ ...seat });
      assert.eq(Starter.placeDistantStoryNeighbours(s), 1, 'find another reachable legal seat');
      const next = s.save.storyNeighbourSeats.archaeologist;
      assert.truthy(next.x !== seat.x || next.y !== seat.y);
      assert.inRange(Math.hypot(next.x - s.save.starterCratesAt.x, next.y - s.save.starterCratesAt.y), 225, 275);
      s.depth = 1; east.creatures = [];
      assert.eq(Starter.placeDistantStoryNeighbours(s), 0, 'never under ground');
    });
  });

  test('Orrin: malformed saved positions recover, and sandbox Home stays out of the real save', () => {
    const { home, east } = corridor(), s = scene();
    s.save.storyNeighbourSeats = { archaeologist: { x: 'bad', y: 0 } };
    cache([[0, 0, home], [1, 0, east]], () => {
      assert.eq(Starter.placeDistantStoryNeighbours(s), 1);
      assert.truthy(Number.isFinite(s.save.storyNeighbourSeats.archaeologist.x));
      east.creatures = [];
      const sandbox = { ...s, _sandboxMode: true, save: {}, homeWorldPos: () => s.save.starterCratesAt };
      assert.eq(Starter.placeDistantStoryNeighbours(sandbox), 1);
      assert.eq(east.creatures[0].name, 'Orrin');
      assert.eq(JSON.stringify(sandbox.save), '{}', 'preview placement never freezes a real-save anchor or seat');
      assert.truthy(sandbox._sandboxStoryNeighbourSeats.archaeologist);
    });
  });
})();
