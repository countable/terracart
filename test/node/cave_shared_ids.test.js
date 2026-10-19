// Exercise the authored planners and the live spawn pass together: IDs must
// remain valid on the multiplayer wire without changing saved defeat keys.
(() => {
  function spawn(entry, tx = 0, ty = 0, caught = []) {
    const scene = Object.assign(new SceneCreatures(), {
      tileEdgeM: entry.tileEdgeM, cellM: entry.tileEdgeM / entry.cellsPerEdge,
      depth: 2, save: { caught, opened: [], placedFloors: [], inv: [] },
      _raiseBoneCacheSkeleton() {},
    });
    scene.spawnCaveCreatures(entry, tx, ty, 2);
    return entry.creatures;
  }
  function entryFor(grid, N, edge, objects, wildplants = [], extra = {}) {
    return { depth: 2, grid, baseGrid: grid.slice(), cellsPerEdge: N, tileEdgeM: edge,
      objects, genObjects: objects.slice(), wildplants, genWildplants: wildplants.slice(), ...extra };
  }
  for (const variant of ['spring_cave', 'dungeon_maze']) {
    test(`shared cave enemies: generated ${variant} IDs retain defeat and wire eligibility`, () => {
      const W = WorldGen, N = 64, edge = N * W.CELL_M, tx = 940001, ty = 940101;
      let anchor;
      for (let n = 0; n < 1000; n++) {
        anchor = { kind: 'grove', owned: true,
          gx: tx * 4096 + (32.5 + n / 10000) * 4096 / N,
          gy: ty * 4096 + 32.5 * 4096 / N,
          lx: 32.5 * 4096 / N, ly: 32.5 * 4096 / N, upm: edge / 4096 };
        if (CaveAreas.select(anchor, 2) === variant) break;
      }
      assert.eq(CaveAreas.select(anchor, 2), variant);
      const surface = { grid: new Uint8Array(N * N).fill(W.T.PARK),
        zone: { anchors: [anchor], coverage: new Uint16Array(N * N).fill(1) } };
      const grid = new Uint8Array(N * N).fill(W.T.CAVE_FLOOR), objects = [], wildplants = [], occupied = new Set();
      const plan = CaveAreas.plan({ surface, grid, N, tx, ty, tileEdgeM: edge, depth: 2,
        objects, occupied, spawnWhy: new Uint32Array(N * N) });
      CaveAreas.apply(plan, grid, objects, wildplants, occupied);
      assert.gt(plan.encounters.length, 0);
      const makeEntry = () => entryFor(grid, N, edge, objects, wildplants, {
        caveAreas: plan, undergroundReserved: new Set([...occupied, ...plan.reserved]),
      });
      const creatures = spawn(makeEntry(), tx, ty).filter(c => c.caveArea);
      assert.eq(creatures.length, plan.encounters.length);
      for (const creature of creatures) {
        assert.truthy(plan.encounters.some(seat => seat.id === creature.id), 'generated persistent ID is unchanged');
        assert.truthy(EnemySpawns.SHARED_ID_RE.test(creature.id), creature.id);
        // Split slimes deliberately remain private; other authored foes share.
        if (EnemyRoster.get(creature.kind)?.ability?.type !== 'split')
          assert.truthy(EnemySpawns.isSharedId(creature), creature.id);
      }
      const defeated = creatures.map(c => c.id);
      assert.falsy(spawn(makeEntry(), tx, ty, defeated).some(c => c.caveArea), 'saved defeats still suppress authored enemies');
    });
  }
  test('shared cave enemies: generated bone gallery guard is marked and keeps its saved ID', () => {
    const W = WorldGen, N = 20, edge = 200;
    const grid = new Uint8Array(N * N).fill(W.T.CAVE_FLOOR);
    const cells = Array.from({ length: 14 }, (_, i) => 10 * N + 3 + i);
    const route = { id: 'bone-route', routeKey: 'underground-way/123/0/1', street: true,
      theme: 'bone_gallery', cells, owner: { x: 30, y: 100 } };
    const plan = { N, tx: 0, ty: 0, tileEdgeM: edge, depth: 2,
      data: { grid: new Uint8Array(N * N).fill(W.T.ROAD) }, routes: [route],
      routeAt: new Map(cells.map(i => [i, route])), lane: new Set(cells), streetCells: new Set(cells) };
    const objects = [];
    Underground.decorate(plan, grid, objects, [], new Set());
    assert.eq(plan.boneGuards.length, 1);
    const id = plan.boneGuards[0].id;
    assert.eq(id, 'underground-way/123/0/1/bone-guard');
    const makeEntry = () => entryFor(grid, N, edge, objects, [], { underground: plan });
    const guard = spawn(makeEntry()).find(c => c.id === id);
    assert.truthy(guard);
    assert.truthy(EnemySpawns.isSharedId(guard));
    assert.falsy(spawn(makeEntry(), 0, 0, [id]).some(c => c.id === id));
  });
})();
