(function () {
  const T = WorldGen.T;
  function sample(depth = 2, cls = 'minor', id = 42, tx = 0, points = [{ x: 100, y: 2050 }, { x: 4000, y: 2050 }]) {
    const N = 64, edge = N * 7, grid = new Uint8Array(N * N).fill(T.CAVE_FLOOR);
    const surface = { baseGrid: new Uint8Array(N * N).fill(T.GRASS), spawnWhy: new Uint16Array(N * N),
      layers: [{ name: 'transportation', extent: 4096, features: [{ id, type: 2, tags: { class: cls }, geom: [points] }] }] };
    if (cls === 'minor') for (let x = 0; x < N; x++) {
      const i = 32 * N + x; surface.baseGrid[i] = T.ROAD; grid[i] = T.CAVE_WALL;
      surface.spawnWhy[i] = WorldGen.SPAWN_WHY.ROAD | WorldGen.SPAWN_WHY.TERRAIN;
    }
    return { N, edge, grid, surface, plan: Underground.project(surface, grid, N, tx, 0, edge, depth) };
  }
  test('underground: street projection and dressing follow a relocated profile', () => {
    const original = WorldGen.floorProfile;
    WorldGen.floorProfile = depth => depth === 4 ? original(2) : { ...original(depth), streetMirror: false };
    try {
      assert.eq(sample(2).plan.routes.length, 0, 'old floor loses projection');
      const s = sample(4), objects = [];
      assert.truthy(s.plan.streetCells.size > 0, 'new floor projects streets');
      Underground.decorate(s.plan, s.grid, objects, [], new Set());
      assert.truthy(objects.length > 0, 'new floor receives dressing');
    } finally { WorldGen.floorProfile = original; }
  });
  test('underground: narrow streets carve only small roads and leave room for side hazards', () => {
    const s = sample();
    assert.truthy(s.plan.streetCells.size > s.N * 2, 'side floor participates even with a one-cell physical band');
    assert.eq(s.grid[32 * s.N + 20], T.CAVE_FLOOR, 'small street opens');
    const out = []; Underground.decorate(s.plan, s.grid, out, [], new Set());
    const hazards = out.filter(o => ['ground_hole', 'stalagmites', 'inactive_poison_vent'].includes(o.kind));
    assert.truthy(hazards.length > 5, 'street has all three scatter candidates at real cell scale');
    for (const o of hazards) {
      const i = Math.floor(o.y / 7) * s.N + Math.floor(o.x / 7);
      assert.truthy(!s.plan.lane.has(i), 'through lane is clear');
    }
  });
  test('underground: suppression, buildings, large roads and water defeat small-road projection', () => {
    const s = sample();
    const cells = [T.BUILDING, T.ROAD_MD, T.ROAD_LG, T.WATER];
    cells.forEach((t, n) => { s.surface.baseGrid[32 * s.N + 10 + n] = t; s.grid[32 * s.N + 10 + n] = T.CAVE_WALL; });
    const suppressed = 32 * s.N + 20; s.surface.spawnWhy[suppressed] |= WorldGen.SPAWN_WHY.RESTRICTED;
    s.grid[suppressed] = T.CAVE_WALL;
    const plan = Underground.project(s.surface, s.grid, s.N, 0, 0, s.edge, 2);
    for (let n = 0; n < cells.length; n++) assert.eq(s.grid[32 * s.N + 10 + n], T.CAVE_WALL);
    assert.eq(s.grid[suppressed], T.CAVE_WALL);
    assert.truthy(!plan.streetCells.has(suppressed));
    const deep = sample(3); assert.eq(deep.plan.routes.length, 0); assert.eq(deep.grid[32 * deep.N + 20], T.CAVE_WALL);
  });
  test('underground: gem tiers stop at floor depth and ordinary D2 respects suppression and bonus land', () => {
    for (let n = 0; n < 100; n++) {
      assert.eq(Underground.gem(1, n).yieldTier, 1);
      assert.truthy(Underground.gem(2, n).yieldTier <= 2);
    }
    function count(terrain, suppressed) {
      const N = 100, edge = 700, grid = new Uint8Array(N * N).fill(T.CAVE_FLOOR);
      const surface = { baseGrid: new Uint8Array(N * N).fill(terrain), spawnWhy: new Uint16Array(N * N).fill(suppressed ? WorldGen.SPAWN_WHY.SENSITIVE : 0) };
      const objects = Array.from({ length: N * N }, (_, i) => ({ kind: 'mineralrock', id: `r${i}`, x: (i % N + .5) * 7, y: (Math.floor(i / N) + .5) * 7, caveVariant: 0 }));
      Underground.decorate(Underground.project(surface, grid, N, 0, 0, edge, 2), grid, objects, [], new Set(objects.map((_, i) => i)));
      return objects.filter(o => o.deposit).length;
    }
    const ordinary = count(T.GRASS, false), beach = count(T.SAND, false), commercial = count(T.COMMERCIAL, false);
    assert.truthy(ordinary > 500 && ordinary < 1100);
    assert.truthy(beach > ordinary * 1.7 && beach < ordinary * 2.3);
    assert.eq(commercial, beach); assert.eq(count(T.SAND, true), 0);
  });
  test('underground: routes own one shrine and duplicate MVT buffer endpoints do not own another', () => {
    let chosen;
    for (let id = 1; id < 30; id++) {
      const s = sample(2, 'path', id), objects = [];
      Underground.decorate(s.plan, s.grid, objects, [], new Set());
      const shrines = objects.filter(o => o.kind === 'grove_shrine');
      assert.truthy(shrines.length <= 1);
      if (shrines.length) { chosen = id; break; }
    }
    assert.truthy(chosen);
    const neighbor = sample(2, 'path', chosen, 1, [{ x: -3996, y: 2050 }, { x: 4000, y: 2050 }]);
    const objects = []; Underground.decorate(neighbor.plan, neighbor.grid, objects, [], new Set());
    assert.eq(objects.filter(o => o.kind === 'grove_shrine').length, 0, 'outside original endpoint cannot own shrine');
    const s = sample(), a = [], b = [];
    Underground.decorate(s.plan, s.grid.slice(), a, [], new Set());
    Underground.decorate(s.plan, s.grid.slice(), b, [], new Set());
    assert.eq(JSON.stringify(a), JSON.stringify(b), 'same source produces same objects');
  });
  test('underground: real loader keeps carved streets shallow and preserves staircase inheritance', async () => {
    const s = sample(), tx = 920021, ty = 920022, key = WorldGen.tileKey(tx, ty);
    const stair = { kind: 'staircase', dir: 'down', id: 'underground-test-stair', depth: 0,
      x: tx * s.edge + 10.5 * 7, y: ty * s.edge + 10.5 * 7 };
    const surface = { ...s.surface, status: 'ready', grid: s.surface.baseGrid.slice(), cellsPerEdge: s.N,
      tileEdgeM: s.edge, objects: [stair], genObjects: [stair], wildplants: [], depth: 0 };
    WorldGen.setDepth(0).set(key, surface);
    try {
      const first = await WorldGen.loadTile.atDepth(1, tx, ty, 49.85);
      const second = await WorldGen.loadTile.atDepth(2, tx, ty, 49.85);
      const third = await WorldGen.loadTile.atDepth(3, tx, ty, 49.85);
      const drills = entry => entry.genObjects.filter(o => o.shrineKind === 'drill');
      for (const entry of [first, second, third]) {
        assert.eq(drills(entry).length, 10, 'ten drill shrines on each underground depth');
        const occupied = [...entry.genObjects, ...entry.wildplants];
        for (const drill of drills(entry)) {
          assert.eq(drill.kind, 'grove_shrine');
          assert.eq(drill.depth, entry.depth);
          const cell = o => Math.floor((o.y - ty * s.edge) / 7) * s.N + Math.floor((o.x - tx * s.edge) / 7);
          assert.eq(entry.grid[cell(drill)], T.CAVE_FLOOR);
          assert.eq(occupied.filter(o => cell(o) === cell(drill)).length, 1, 'drills occupy free cells');
        }
      }
      assert.truthy(drills(first)[0].id !== drills(second)[0].id, 'daily visit IDs are depth-qualified');
      const drillArt = SpriteLayout.groveShrineArt(drills(first)[0]);
      assert.eq(drillArt.key, 'cave_props'); assert.eq(drillArt.frame, 6);
      const road = 32 * s.N + 20;
      assert.eq(first.grid[road], T.CAVE_FLOOR); assert.eq(second.grid[road], T.CAVE_FLOOR);
      assert.eq(first.geologyGrid[road], T.CAVE_WALL);
      assert.eq(third.grid[road], T.CAVE_FLOOR, 'the Underdark remains the owning open stratum');
      assert.falsy(first.genObjects.some(o => o.kind === 'staircase' && o.dir === 'down'),
        'the first cave retains main’s deliberate break in the generated stair chain');
      const down = second.genObjects.find(o => o.kind === 'staircase' && o.dir === 'down');
      assert.truthy(down);
      assert.truthy(third.genObjects.some(o => o.kind === 'staircase' && o.dir === 'up' && o.x === down.x && o.y === down.y));
      // Live digging and restoration cannot affect an uncached next floor.
      first.grid[road] = T.WATER; surface.grid[road] = T.GRASS;
      WorldGen.setDepth(2).delete(key);
      const rebuilt = await WorldGen.loadTile.atDepth(2, tx, ty, 49.85);
      assert.eq(rebuilt.grid[road], T.CAVE_FLOOR);
      assert.eq(JSON.stringify(drills(rebuilt)), JSON.stringify(drills(second)), 'drill placement survives uncached rebuild');
    } finally {
      for (const depth of [0, 1, 2, 3]) WorldGen.setDepth(depth).delete(key);
      WorldGen.setDepth(0);
    }
  });
  test('underground: each existing path theme gets the 50 percent shrine roll', () => {
    const counts = {};
    for (let id = 1; id <= 500; id++) {
      const s = sample(2, 'path', id), objects = [];
      Underground.decorate(s.plan, s.grid, objects, [], new Set());
      const theme = s.plan.routes[0].theme, count = counts[theme] || (counts[theme] = [0, 0]);
      count[0]++; count[1] += objects.filter(o => o.kind === 'grove_shrine').length;
    }
    assert.eq(Object.keys(counts).length, 5);
    for (const [theme, [total, shrines]] of Object.entries(counts)) {
      assert.truthy(shrines / total > .35 && shrines / total < .65, `${theme}: ${shrines}/${total}`);
    }
  });
  test('underground: hazard placement respects occupied seats and the whole stair approach', () => {
    const s = sample(), stair = { kind: 'staircase', id: 'stair', x: 20.5 * 7, y: 31.5 * 7 },
      blocker = { kind: 'torch', id: 'blocker', x: 30.5 * 7, y: 30.5 * 7 };
    const objects = [stair, blocker];
    Underground.decorate(s.plan, s.grid, objects, [], new Set([31 * s.N + 20, 30 * s.N + 30]));
    const seats = new Set();
    for (const o of objects) {
      const x = Math.floor(o.x / 7), y = Math.floor(o.y / 7), i = y * s.N + x;
      assert.truthy(!seats.has(i), 'never overlap an occupied object'); seats.add(i);
      if (['ground_hole', 'stalagmites', 'inactive_poison_vent'].includes(o.kind)) {
        assert.truthy(Math.max(Math.abs(x - 20), Math.abs(y - 31)) > 1, 'reserve full stair approach');
      }
    }
  });
})();
