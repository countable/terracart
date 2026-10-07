(() => {
  test('floor viewer variants: catalog and wrap follow the displayed floor profile', () => {
    const V = FloorViewerVariants;
    assert.eq(V.options(0).length, ZoneVariantData.variants.length + 1);
    assert.eq(V.select(0, -1).id, V.options(0).at(-1).id);
    for (let d = 1; d <= 8; d++) {
      const profile = WorldGen.floorProfile(d);
      const weights = 'caveAreas' in profile ? profile.caveAreas?.weights : CaveAreas.DEPTH_WEIGHTS?.[d];
      assert.eq(V.options(d).length, weights ? weights.filter(r => r.weight > 0).length + 2 : 0);
      assert.eq(V.select(d, V.options(d).length)?.id, V.select(d, 0)?.id);
    }
  });
  test('floor viewer variants: legacy cave weights restore and explicit empty profiles take precedence', async () => {
    const originalProfile = WorldGen.floorProfile, originalWeights = CaveAreas.DEPTH_WEIGHTS;
    const weights = [{ id: 'spring_cave', weight: 1 }, { id: 'goblin_warrens', weight: 1 }];
    CaveAreas.DEPTH_WEIGHTS = { 2: weights };
    WorldGen.floorProfile = () => ({});
    try {
      assert.eq(FloorViewerVariants.options(2).length, 4);
      try {
        await FloorViewerVariants.withSelection(2, 2, async () => {
          assert.eq(CaveAreas.DEPTH_WEIGHTS[2][0].id, 'goblin_warrens');
          assert.eq(CaveAreas.DEPTH_WEIGHTS[2].length, 1);
          throw new Error('test build failure');
        });
      } catch (error) { assert.eq(error.message, 'test build failure'); }
      assert.eq(CaveAreas.DEPTH_WEIGHTS[2], weights);
      WorldGen.floorProfile = () => ({ caveAreas: null });
      assert.eq(FloorViewerVariants.options(2).length, 0);
    } finally {
      WorldGen.floorProfile = originalProfile;
      if (originalWeights === undefined) delete CaveAreas.DEPTH_WEIGHTS;
      else CaveAreas.DEPTH_WEIGHTS = originalWeights;
    }
  });
  test('floor viewer variants: real selectors receive the chosen input and restore after failure', async () => {
    const V = FloorViewerVariants, originalPick = ZoneVariants.pick, originalProfile = WorldGen.floorProfile;
    const index = V.options(0).findIndex(row => row.id === 'seep');
    await V.withSelection(0, index, async () => {
      assert.eq(ZoneVariants.pick({ kind: 'tar', variant: 'black_ring' }).id, 'seep');
    });
    assert.eq(ZoneVariants.pick, originalPick);
    for (let i = 1; i < V.options(2).length; i++) {
      await V.withSelection(2, i, async selected => {
        const anchor = { kind: selected.kind, gx: 123, gy: 456 };
        assert.eq(CaveAreas.select(anchor, 2), selected.id);
        assert.eq(WorldGen.floorProfile(1), originalProfile(1));
      });
    }
    let failed = false;
    try { await V.withSelection(2, 1, async () => { throw new Error('test build failure'); }); }
    catch (_) { failed = true; }
    assert.truthy(failed);
    assert.eq(ZoneVariants.pick, originalPick);
    assert.eq(WorldGen.floorProfile, originalProfile);
  });
})();
