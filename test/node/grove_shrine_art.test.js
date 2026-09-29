test('grove shrine appearance is stable across save overlays and coordinate frames', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const o = { id: `grove-osm-${i}`, kind: 'grove_shrine', x: 0, y: 0 };
    const art = SpriteLayout.groveShrineArt(o);
    seen.add(art.key);
    assert.eq(SpriteLayout.groveShrineArt({ ...o, x: 9876, y: -4321, opened: true }), art);
    assert.truthy(SpriteLayout.ART_BOUNDS[`${art.key}:${art.frame}`]);
  }
  assert.eq(seen.size, SpriteLayout.GROVE_SHRINE_ART.length);
  assert.eq(seen.size, 2);
});
