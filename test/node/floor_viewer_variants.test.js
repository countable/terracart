(() => {
  test('floor viewer variants: every family advances together and wraps independently', () => {
    const V = FloorViewerVariants;
    for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const families = V.families(depth), count = V.count(depth);
      if (!families.length) { assert.eq(count, 0); assert.eq(V.select(depth, 1), null); continue; }
      assert.eq(V.select(depth, 0).id, null);
      assert.eq(V.select(depth, count).id, null);
      assert.eq(V.select(depth, -1).index, count - 1);
      const length = Math.max(...families.map(f => f.rows.length));
      for (let index = 1; index <= length + 1; index++) {
        const selection = V.select(depth, index);
        for (const family of families) {
          const selected = [...selection.nexuses, ...selection.roads].find(row => row.type === family.type && row.kind === family.kind);
          assert.eq(selected.id, family.rows[(index - 1) % family.rows.length].id);
        }
      }
    }
  });
  test('floor viewer variants: simultaneous selectors restore after failed generation', async () => {
    const originalPick = ZoneVariants.pick, originalRoad = StreetVariants.variantFor, originalScenic = Scenic.classify;
    let failed = false;
    try {
      await FloorViewerVariants.withSelection(0, 2, async selected => {
        for (const row of selected.nexuses) assert.eq(ZoneVariants.pick({ kind: row.kind }).id, row.id);
        for (const row of selected.roads.filter(row => row.kind !== 'path')) assert.eq(StreetVariants.variantFor('preview', '', row.kind), row.id);
        throw new Error('test build failure');
      });
    } catch (error) { failed = error.message === 'test build failure'; }
    assert.truthy(failed);
    assert.eq(ZoneVariants.pick, originalPick); assert.eq(StreetVariants.variantFor, originalRoad); assert.eq(Scenic.classify, originalScenic);
  });
  test('floor viewer variants: legacy cave weights restore and explicit empty profiles take precedence', async () => {
    const originalProfile = WorldGen.floorProfile, originalWeights = CaveAreas.DEPTH_WEIGHTS;
    const weights = [{ id: 'spring_cave', weight: 1 }, { id: 'goblin_warrens', weight: 1 }];
    CaveAreas.DEPTH_WEIGHTS = { 2: weights };
    WorldGen.floorProfile = () => ({});
    try {
      assert.eq(FloorViewerVariants.count(2), 3);
      try {
        await FloorViewerVariants.withSelection(2, 2, async () => {
          assert.eq(CaveAreas.DEPTH_WEIGHTS[2][0].id, 'goblin_warrens');
          throw new Error('test build failure');
        });
      } catch (error) { assert.eq(error.message, 'test build failure'); }
      assert.eq(CaveAreas.DEPTH_WEIGHTS[2], weights);
      WorldGen.floorProfile = () => ({ caveAreas: null });
      assert.eq(FloorViewerVariants.count(2), 0);
    } finally {
      WorldGen.floorProfile = originalProfile;
      if (originalWeights === undefined) delete CaveAreas.DEPTH_WEIGHTS;
      else CaveAreas.DEPTH_WEIGHTS = originalWeights;
    }
  });
  test('floor viewer variants: cave nexus and route selections reach the real selectors', async () => {
    const originalProfile = WorldGen.floorProfile, originalProject = Underground.project;
    for (let index = 1; index <= 6; index++) await FloorViewerVariants.withSelection(2, index, async selected => {
      for (const row of selected.nexuses) assert.eq(CaveAreas.select({ kind: row.kind, gx: 123, gy: 456 }, 2), row.id);
      const N = 8, grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
      const surface = { grid, cellsPerEdge: N, layers: [{ name: 'transportation', extent: 4096, features: [
        { type: 2, tags: { class: 'minor' }, geom: [[{ x: 0, y: 1024 }, { x: 4096, y: 1024 }]] },
        { type: 2, tags: { class: 'footway' }, geom: [[{ x: 0, y: 3072 }, { x: 4096, y: 3072 }]] }
      ] }] };
      const plan = Underground.project(surface, new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR), N, 0, 0, N * 7, 2);
      assert.gt(plan.routes.length, 0);
      for (const route of plan.routes) assert.eq(route.theme, selected.roads.find(row => row.kind === (route.street ? 'minor' : 'path')).id);
    });
    assert.eq(WorldGen.floorProfile, originalProfile); assert.eq(Underground.project, originalProject);
  });
})();
