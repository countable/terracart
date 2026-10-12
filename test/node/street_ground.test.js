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
  test('street ground: every raster road tier and path uses one biome backdrop', () => {
    const f=fixture();
    for (const type of [WorldGen.T.ROAD,WorldGen.T.ROAD_MD,WorldGen.T.ROAD_LG,WorldGen.T.PATH]) {
      assert.eq(Render.roadBackdropType(f.scene,type,0,0),0,'explicit grass stays grass');
      assert.eq(Render.roadBackdropType(f.scene,type,1,0),5,'theme supplies fill and texture');
      f.entry.streetGround[0]=0;
      assert.eq(Render.roadBackdropType(f.scene,type,0,0),4,'un-themed road uses surrounding biome');
      f.entry.streetGround[0]=1;
    }
    assert.eq(Render.roadBackdropType({neighborNonRoadType:()=>null},WorldGen.T.PATH,0,0),WorldGen.T.GRASS,
      'missing neighbors never reveal raw path paving');
    assert.eq(Render.roadBackdropType(f.scene,WorldGen.T.ROCK,0,0),null,'ordinary ground keeps its own material');
  });
})();
