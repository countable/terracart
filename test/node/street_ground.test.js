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
    const world = { tileCache: new Map([['tile', entry]]), tileKey: () => 'tile', isCobbleTerrain: WorldGen.isCobbleTerrain, isBuildingTerrain: WorldGen.isBuildingTerrain };
    const methods = new Function('WorldGen', 'absCellToTile', 'absCellOffset',
      `return {${lift('streetGroundType')},${lift('neighborNonRoadType')}}`)(world,
      (_s, x, _y, out) => Object.assign(out, { tx: 0, ty: 0, ix: x, iy: 0, n: 2 }),
      () => { throw new Error('cached fallback should avoid neighbourhood scan'); });
    const scene = Object.assign({ depth: 0, _neighborZoneCache: new Map([[0, 4], [8388608, 4]]) }, methods);
    return { entry, scene, read: (x=0) => scene.neighborNonRoadType(x, 0) };
  }
  test('street ground: neighbourhood sampling includes new rocky terrain and reuses its histogram', () => {
    const world = { T: WorldGen.T, tileCache: new Map(), tileKey: () => 'tile' };
    const method = new Function('WorldGen', 'absCellToTile', 'absCellOffset',
      `return ({${lift('neighborNonRoadType')}}).neighborNonRoadType`)(world,
      (_s, _x, _y, out) => Object.assign(out, { tx: 0, ty: 0, ix: 0, iy: 0, n: 1 }),
      (_s, x, y, dx, dy) => ({ cellIX: x + dx, cellIY: y + dy }));
    const scene = { streetGroundType: () => null };
    for (const type of [WorldGen.T.ROCKY_GROUND, WorldGen.T.EXCLUSION_ROCK, WorldGen.T.GRASS]) {
      world.tileCache.set('tile', { grid: new Uint8Array([type]) });
      scene._neighborZoneCache?.clear();
      assert.eq(method.call(scene, 0, 0), type, 'all terrain enum values can supply the road backdrop');
      assert.eq(scene._neighborTerrainCounts[type], 48, 'each sample starts with a cleared histogram');
    }
  });
  test('street ground: explicit terrain including grass wins over memoized fallback', () => {
    const f=fixture();
    assert.eq(f.read(),0,'terrain+1 represents grass without colliding with absent');
    assert.eq(f.read(1),5);
    f.entry.streetGround[0]=0;
    assert.eq(f.read(),4,'unpainted cell keeps the sampled fallback');
  });
  test('street ground: source landcover wins over surrounding majority, but themes win over source', () => {
    const f = fixture();
    f.entry.grid = new Uint8Array([WorldGen.T.ROAD, WorldGen.T.PATH]);
    f.entry.roadUnder = { '0_0': WorldGen.T.SAND };
    f.entry.pathUnder = { '1_0': WorldGen.T.FOREST };
    assert.eq(f.read(), 0, 'explicit theme overrides recorded landcover');
    f.entry.streetGround.fill(0);
    assert.eq(f.read(), WorldGen.T.SAND, 'road keeps its actual sand, not cached majority');
    assert.eq(f.read(1), WorldGen.T.FOREST, 'path retains its source forest');
    f.entry.roadUnder['0_0'] = WorldGen.T.PATH;
    f.entry.pathUnder['0_0'] = WorldGen.T.GRASS;
    assert.eq(f.read(), WorldGen.T.GRASS, 'crossing road looks through earlier path stamp to grass');
    f.entry.roadUnder['0_0'] = WorldGen.T.BUILDING;
    assert.eq(f.read(), WorldGen.T.GRASS, 'building stamp is not a ground material');
    f.entry.grid[0] = WorldGen.T.BUILDING;
    assert.eq(f.read(), 4, 'stale pavement metadata does not affect a building');
    f.entry.grid[0] = WorldGen.T.ROAD;
    f.scene.depth = 1;
    assert.eq(f.read(), 4, 'surface underlay never leaks underground');
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

(function () {
  test('rift ground: the full road suppression buffer is styled, not just paving', () => {
    const W = WorldGen;
    const entry = { depth: 0, cellsPerEdge: 3, roadClass: new Uint8Array(9) };
    entry.roadClass[4] = W.ROAD_CLASS_MAJOR_BUFFER;
    for (const type of [W.T.ROAD_MD, W.T.ROAD_LG, W.T.GRASS, W.T.FOREST,
      W.T.SAND, W.T.PATH, W.T.GROVE, W.T.WASTELAND]) {
      assert.truthy(Render.suppressedGround(entry, 1, 1, type), 'buffer earth shares rift palette');
      assert.falsy(Render.suppressedGround(entry, 0, 1, type), 'adjacent terrain beyond buffer retains biome');
    }
    entry.roadClass[4] |= W.ROAD_CLASS_LOT_BUFFER;
    assert.falsy(Render.suppressedGround(entry, 1, 1, W.T.GRASS), 'parking-only buffer is not the ancient road rift');
    entry.roadClass[4] = W.ROAD_CLASS_MAJOR_BAND;
    assert.falsy(Render.suppressedGround(entry, 1, 1, W.T.ROAD_MD), 'use actual suppression mask, not road tier');
  });
  test('rift ground: surface styling preserves water, structures and underground materials', () => {
    const W = WorldGen;
    const entry = { cellsPerEdge: 1, roadClass: new Uint8Array([W.ROAD_CLASS_MAJOR_BUFFER]) };
    for (const type of [W.T.WATER, W.T.PIER, W.T.BUILDING, W.T.BUILDING_MED,
      W.T.BUILDING_LARGE, W.T.CAVE_FLOOR, W.T.CAVE_WALL, W.T.CAVE_LAVA, 30]) {
      assert.falsy(Render.suppressedGround(entry, 0, 0, type), 'material stays intact');
    }
    assert.falsy(Render.suppressedGround(entry, 0, 0, W.T.GRASS, 1), 'scene depth excludes inherited surface bits');
    entry.depth = 1;
    assert.falsy(Render.suppressedGround(entry, 0, 0, W.T.GRASS), 'cache depth excludes inherited surface bits');
    assert.falsy(Render.suppressedGround(null, 0, 0, W.T.GRASS), 'unloaded terrain stays unmapped');
  });
})();
