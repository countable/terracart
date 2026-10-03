// Exercise the scene lookup directly: explicit street ground must win over
// cached neighbourhood samples without leaking through inherited cave data.
(function () {
  function lift(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(wcx, wcy) {');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return SCENE_SRC.slice(start + 1, end + 4);
  }
  function fixture() {
    const entry = { depth: 0, streetGround: new Uint8Array([1, 6]) };
    const world = { tileCache: new Map([['tile', entry]]), tileKey: () => 'tile' };
    const methods = new Function('WorldGen', 'absCellToTile', 'absCellOffset',
      `return {${lift('streetGroundType')},${lift('neighborNonRoadType')}}`)(world,
      (_s, x, _y, out) => Object.assign(out, { tx: 0, ty: 0, ix: x, iy: 0, n: 2 }),
      () => { throw new Error('cached fallback should avoid neighbourhood scan'); });
    const scene = Object.assign({ depth: 0, _neighborZoneCache: new Map([[0, 4], [8388608, 4]]) }, methods);
    return { entry, scene, read: (x=0) => scene.neighborNonRoadType(x, 0) };
  }
  test('street ground: explicit terrain including grass wins over memoized fallback', () => {
    const f=fixture();
    assert.eq(f.read(),0,'terrain+1 represents grass without colliding with absent');
    assert.eq(f.read(1),5);
    f.entry.streetGround[0]=0;
    assert.eq(f.read(),4,'unpainted cell keeps the sampled fallback');
  });
  test('street ground: underground lookup ignores inherited surface decoration', () => {
    const f=fixture();
    f.scene.depth=1;
    assert.eq(f.read(),4);
    f.scene.depth=0;f.entry.depth=1;
    assert.eq(f.read(),4,'a cave cache entry cannot supply surface ground');
  });
})();
