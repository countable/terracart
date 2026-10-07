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
  test('chest trails: only unopened surface treasure of tier two or above near Home qualifies', () => {
    const anchor = { x: 0, y: 0 }, scene = { save: { opened: ['opened'] }, cellM: 7, depth: 0 };
    withChests([
      chest('good', 10), chest('higher', 20, { tierSeed: 5 }),
      chest('low', 3, { tierSeed: 1 }), chest('two', 2, { tierSeed: 2 }), chest('opened', 4),
      chest('chest_start_relic', 5), chest('crate', 6, { crate: true }),
      chest('far', (HomeArea.RING_MAX_CELLS + 1) * 7),
      chest('deep', 7, { depth: 1 }), chest('wagon', 8, { banditStop: true }),
    ], () => {
      assert.eq(HomeArea.chestTrailCandidates(scene, anchor).map(o => o.id).join(), 'two,good,higher');
      scene.save.opened.push('good');
      assert.eq(HomeArea.chestTrailCandidates(scene, anchor).map(o => o.id).join(), 'two,higher');
      scene.depth = 1;
      assert.eq(HomeArea.chestTrailCandidates(scene, anchor).length, 0);
    });
  });
  test('chest trails: CHEST_TRAIL_LIMIT destinations maximum in stable order regardless of tile insertion', () => {
    const scene = { save: {}, cellM: 7 }, anchor = { x: 0, y: 0 }, L = HomeArea.CHEST_TRAIL_LIMIT;
    assert.eq(L, 10);
    const objects = Array.from({ length: L + 2 }, (_, i) => chest('chest' + String(i).padStart(2, '0'), 10));
    withChests(objects.slice().reverse(), () => {
      const first = HomeArea.chestTrailCandidates(scene, anchor).map(o => o.id).join();
      assert.eq(first, objects.slice(0, L).map(o => o.id).join());
      WorldGen.tileCache.set('trail-test', { objects });
      WorldGen.tileCache.set('duplicate', { objects: [objects[0]] });
      assert.eq(HomeArea.chestTrailCandidates(scene, anchor).map(o => o.id).join(), first);
    });
  });
  test('chest trails: the chest at a trail\'s end rolls a tier higher, within its cap', () => {
    const scene = { save: { starterCratesAt: { x: 0, y: 0 } }, cellM: 7, depth: 0 };
    withChests([chest('end', 10), chest('far', (HomeArea.RING_MAX_CELLS + 1) * 7)], () => {
      assert.truthy(HomeArea.isTrailChest(scene, { id: 'end' }));
      assert.falsy(HomeArea.isTrailChest(scene, { id: 'far' }));
    });
    assert.eq(HomeArea.CHEST_TRAIL_TIER_BONUS, 1);
    assert.truthy(/HomeArea\.isTrailChest\?\.\(scene, o\)[\s\S]{0,400}?chestTierMaxFor\(o\.depth\)[\s\S]{0,200}?\+ \(trailEnd \? HomeArea\.CHEST_TRAIL_TIER_BONUS : 0\)/.test(INTERACTABLES_SRC),
      'the chest roll adds the bonus, clamped to the depth cap');
  });
})();
