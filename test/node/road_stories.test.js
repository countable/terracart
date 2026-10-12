(() => {
  test('road stories: entering medium then large roads tells each fixed story once', () => {
    const start = SCENE_SRC.indexOf('  _tickStreetFeet() {');
    const end = SCENE_SRC.indexOf('\n  }', start);
    const tick = new Function(SCENE_SRC.slice(SCENE_SRC.indexOf('{', start) + 1, end));
    const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    const N = 4, entry = { _spawned: true, cellsPerEdge: N, tileEdgeM: 40,
      grid: new Uint8Array(N * N).fill(WorldGen.T.ROAD_MD),
      streetMarks: new Uint8Array(N * N).fill(StreetVariants.STREET_VARIANTS[0].code),
      roadClass: new Uint8Array(N * N).fill(WorldGen.ROAD_CLASS_MAJOR_BAND) };
    entry.grid[1] = WorldGen.T.ROAD_LG;
    let x = 0;
    const stories = [];
    const scene = { save: { storySeen: {} }, depth: 0, startWorldM: { x: 0, y: 0 },
      cellM: 10, tileEdgeM: 40, playerToWorldCell: () => ({ tx: 0, ty: 0, cx: x, cy: 0 }),
      _tickStreetSight() {}, flash() {},
      _storySplashOnce(story, row) { stories.push({ story, ...row }); this.save.storySeen[story] = true; } };
    try {
      WorldGen.tileCache.set(key, entry);
      tick.call(scene); x = 1; tick.call(scene); x = 0; tick.call(scene);
      assert.eq(stories.length, 2, 'returning to an old road does not repeat its story');
      assert.eq(stories[0].title, 'Old Trade Road');
      assert.eq(stories[1].title, 'Ancient Highway');
      assert.eq(stories[0].story, 'street_bandit', 'existing saves retain the old trade road visit');
      assert.truthy(stories[1].story !== stories[0].story, 'the highway has its own first visit');
    } finally {
      if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
    }
  });
})();
