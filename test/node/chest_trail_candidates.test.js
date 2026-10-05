(function () {
  const chest = (id, x, extra = {}) => ({ id, kind: 'chest', x, y: 0, tierSeed: 3, ...extra });
  function withChests(objects, fn) {
    const prior = [...WorldGen.tileCache];
    WorldGen.tileCache.clear();
    WorldGen.tileCache.set('trail-test', { objects });
    try { fn(); } finally {
      WorldGen.tileCache.clear();
      for (const [key, value] of prior) WorldGen.tileCache.set(key, value);
    }
  }
  test('chest trails: only unopened surface treasure of tier three or above near Home qualifies', () => {
    const anchor = { x: 0, y: 0 }, scene = { save: { opened: ['opened'] }, cellM: 7, depth: 0 };
    withChests([
      chest('good', 10), chest('higher', 20, { tierSeed: 5 }),
      chest('low', 3, { tierSeed: 2 }), chest('opened', 4),
      chest('chest_start_relic', 5), chest('crate', 6, { crate: true }),
      chest('far', (HomeArea.RING_MAX_CELLS + 1) * 7),
      chest('deep', 7, { depth: 1 }), chest('wagon', 8, { banditStop: true }),
    ], () => {
      assert.eq(HomeArea.chestTrailCandidates(scene, anchor).map(o => o.id).join(), 'good,higher');
      scene.save.opened.push('good');
      assert.eq(HomeArea.chestTrailCandidates(scene, anchor).map(o => o.id).join(), 'higher');
      scene.depth = 1;
      assert.eq(HomeArea.chestTrailCandidates(scene, anchor).length, 0);
    });
  });
  test('chest trails: five destinations maximum in stable order regardless of tile insertion', () => {
    const scene = { save: {}, cellM: 7 }, anchor = { x: 0, y: 0 };
    const objects = Array.from({ length: 7 }, (_, i) => chest('chest' + i, 10));
    withChests(objects.slice().reverse(), () => {
      const first = HomeArea.chestTrailCandidates(scene, anchor).map(o => o.id).join();
      assert.eq(first, 'chest0,chest1,chest2,chest3,chest4');
      WorldGen.tileCache.set('trail-test', { objects });
      WorldGen.tileCache.set('duplicate', { objects: [objects[0]] });
      assert.eq(HomeArea.chestTrailCandidates(scene, anchor).map(o => o.id).join(), first);
    });
  });
})();
