// Only Excluded private residential ground becomes permanent bedrock.
(function () {
  const W = WorldGen, T = W.T, S = W.SPAWN_WHY;
  function lot() {
    return { grid: new Uint8Array(49).fill(T.RESIDENTIAL), w: 7, h: 7,
      spawnWhy: new Uint32Array(49).fill(S.PRIVATE), roadMask: new Uint8Array(49),
      gameplayTiers: new Uint8Array(49).fill(4), occupied: new Set(), coverage: new Uint16Array(49) };
  }
  function stamp(f) { return W.stampExclusionRock(f.grid, f.w, f.h, f); }
  test('exclusion bedrock: excluded private residential ground becomes permanent rock, including tile edges', () => {
    const f = lot(), before = f.spawnWhy.slice(); assert.eq(stamp(f), 49);
    assert.eq(f.grid[0], T.EXCLUSION_ROCK); assert.eq(f.grid[24], T.EXCLUSION_ROCK);
    assert.falsy(W.isWalkable(f.grid[24]));
    assert.falsy(W.isSpawnCell(f.grid, 7, 7, 3, 3, f, 'minor'));
    assert.eq([...f.spawnWhy].join(), [...before].join(), 'painting preserves diagnostic evidence');
  });
  test('exclusion bedrock: roads and paths retain their appearance and reject all spawn classes', () => {
    for (const type of [T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH, T.PIER]) {
      const f = lot(); f.grid[24] = type; assert.eq(stamp(f), 48);
      assert.eq(f.grid[24], type); assert.eq(f.grid[23], T.EXCLUSION_ROCK);
      for (const cls of W.SPAWN_CLASSES)
        assert.falsy(W.isSpawnCell(f.grid, 7, 7, 3, 3, f, cls), cls + ' excluded on road');
    }
  });
  test('exclusion bedrock: source water and building footprints remain physical surfaces', () => {
    for (const type of [T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE, T.WATER]) {
      const f = lot(); f.grid[24] = type; stamp(f);
      assert.eq(f.grid[24], type); assert.eq(f.grid[23], T.EXCLUSION_ROCK);
      assert.falsy(W.isSpawnCell(f.grid, 7, 7, 3, 3, f, 'minor'));
    }
  });
  test('exclusion bedrock: building ownership protects cells even when their ground was repainted', () => {
    const f = lot();
    f.owners = new Uint16Array(49);
    f.owners[24] = 1;
    f.owners[25] = 1;
    f.residentialGrid = f.grid.slice();
    f.grid[25] = T.PARK;
    assert.eq(stamp(f), 47);
    assert.eq(f.grid[24], T.ROCKY_GROUND, 'trimmed house cell gets rocky ground');
    assert.eq(f.grid[25], T.ROCKY_GROUND, 'repainted footprint gets rocky ground');
    assert.eq(f.grid[23], T.EXCLUSION_ROCK, 'unoccupied private land still becomes rock');
  });
  test('exclusion bedrock: house coverage below 15% admits solid rock while the threshold stays passable', () => {
    const f = lot();
    f.cellWidthM = 10;
    f.buildingShapes = [{ ring: [39, 30, 41, 30, 41, 40, 39, 40] }];
    assert.eq(stamp(f), 49);
    assert.eq(f.grid[24], T.EXCLUSION_ROCK, '10% left sliver');
    assert.eq(f.grid[25], T.EXCLUSION_ROCK, '10% right sliver');
    assert.falsy(W.isWalkable(f.grid[24]), 'small slivers no longer create a passable gap');
    assert.falsy(isTillableCell({ type: f.grid[24] }));
    assert.eq(f.grid[23], T.EXCLUSION_ROCK, 'uncovered land still becomes rock');
    for (const [width, expected] of [[1.4999,T.EXCLUSION_ROCK],[1.5,T.ROCKY_GROUND],[1.5001,T.ROCKY_GROUND]]) {
      const edge = lot(); edge.cellWidthM = 10;
      edge.buildingShapes = [{ ring: [30,30,30+width,30,30+width,40,30,40] }];
      stamp(edge); assert.eq(edge.grid[24],expected,width+' metres of a ten-metre cell');
    }
  });
  test('exclusion bedrock: overlapping and duplicate houses use their union rather than summed coverage', () => {
    const rectangle = (left,right) => ({ ring: [left,30,right,30,right,40,left,40] });
    for (const [shapes,expected] of [
      [[rectangle(30,31),rectangle(30,31)],T.EXCLUSION_ROCK],
      [[rectangle(30,31),rectangle(30.4,31.4)],T.EXCLUSION_ROCK],
      [[rectangle(30,31),rectangle(30.5,31.5)],T.ROCKY_GROUND],
      [[rectangle(30,30.8),rectangle(39.2,40)],T.ROCKY_GROUND],
    ]) for (const ordered of [shapes,[...shapes].reverse()]) {
      const f=lot(); f.cellWidthM=10; f.buildingShapes=ordered;
      stamp(f); assert.eq(f.grid[24],expected,'union is independent of footprint order');
    }
  });
  test('exclusion bedrock: narrow diagonal slivers and clipped tile edges obey actual area', () => {
    const f=lot(); f.cellWidthM=10;
    f.buildingShapes=[{ring:[30,30,40,30,30,32]}, {ring:[-9,0,1,0,1,70,-9,70]}];
    f.owners=new Uint16Array(49); f.owners[24]=1;
    stamp(f);
    assert.eq(f.grid[24],T.EXCLUSION_ROCK,'10% triangular house sliver overrides conservative cell ownership');
    for(let y=0;y<7;y++) assert.eq(f.grid[y*7],T.EXCLUSION_ROCK,'10% seam sliver at row '+y);
    for(const [width,expected] of [[.14999,T.EXCLUSION_ROCK],[.15,T.ROCKY_GROUND]]) {
      const N=512,grid=new Uint8Array(N*N).fill(T.RESIDENTIAL);
      W.stampExclusionRock(grid,N,N,{cellWidthM:1,gameplayTiers:new Uint8Array(N*N).fill(4),
        spawnWhy:new Uint32Array(N*N).fill(S.PRIVATE),
        buildingShapes:[{ring:[500,500,500+width,500,500+width,501,500,501]}]});
      assert.eq(grid[500*N+500],expected,'coverage remains accurate far from the tile origin');
    }
  });
  test('exclusion bedrock: fills every footprint-free cell right up to an aligned building edge', () => {
    const f = lot();
    f.cellWidthM = 10;
    f.buildingShapes = [{ ring: [20, 20, 40, 20, 40, 50, 20, 50] }];
    assert.eq(stamp(f), 43, 'only the six intersecting cells trim solid rock');
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const trimmed = x >= 2 && x < 4 && y >= 2 && y < 5;
      assert.eq(f.grid[y * 7 + x], trimmed ? T.ROCKY_GROUND : T.EXCLUSION_ROCK,
        'no buffer beyond the footprint at ' + x + ',' + y);
    }
    assert.falsy(W.isSpawnCell(f.grid, 7, 7, 2, 2, { gameplayTiers: new Uint8Array(49).fill(1) }, 'minor'),
      'cached public tiers cannot seed props on rocky private ground');
  });
  test('exclusion bedrock: home clears every cell intersecting the 50m radius, without changing generated terrain', () => {
    const origin = HomeArea.worldM;
    try {
      HomeArea.setOrigin(0, 0);
      const entry = { cellsPerEdge: 10, grid: new Uint8Array(100).fill(T.EXCLUSION_ROCK),
        baseGrid: new Uint8Array(100).fill(T.EXCLUSION_ROCK),
        variantBaseGrid: new Uint8Array(100).fill(T.RESIDENTIAL) };
      assert.truthy(HomeArea.suppressExclusionRock(entry, 0, 0, 100) > 0);
      assert.eq(entry.grid[5], T.RESIDENTIAL, 'cell touching 50m boundary is clear');
      assert.eq(entry.grid[6], T.EXCLUSION_ROCK, 'beyond radius keeps rock');
      assert.eq(entry.grid[44], T.EXCLUSION_ROCK, 'radius is circular');
      assert.eq(entry.baseGrid[0], T.EXCLUSION_ROCK, 'shared generated grid is intact');
      assert.eq(HomeArea.suppressExclusionRock(entry, 0, 0, 100), 0, 'repeat is stable');
      entry.depth = 1; entry.grid.fill(T.EXCLUSION_ROCK);
      assert.eq(HomeArea.suppressExclusionRock(entry, 0, 0, 100), 0, 'surface only');
    } finally { HomeArea.worldM = origin; }
  });
  test('exclusion bedrock: other Excluded ground retains its material and blocks spawns', () => {
    for (const type of [T.WASTELAND, T.PARK, T.COMMERCIAL, T.GRASS]) {
      const f = lot(); f.grid.fill(type);
      assert.eq(stamp(f), 0, 'private evidence alone cannot turn other landcover into residential rock');
      assert.eq(f.grid[24], type);
      assert.falsy(W.isSpawnCell(f.grid, 7, 7, 3, 3, f, 'minor'));
    }
    const f = lot(); f.spawnWhy.fill(0);
    assert.eq(stamp(f), 0, 'Excluded residential ground needs private land evidence');
    f.spawnWhy.fill(S.PRIVATE); f.gameplayTiers.set([1,2,3]); stamp(f);
    for (let i = 0; i < 3; i++) assert.eq(f.grid[i], T.RESIDENTIAL, 'eligible tier keeps its surface');
  });
  test('exclusion bedrock: source private lots survive Nexus repaint but drawn routes stay clear', () => {
    for (const evidence of [S.PRIVATE, S.BEHIND_HOUSE, S.RESTRICTED]) {
      const f = lot(); f.residentialGrid = f.grid.slice(); f.grid.fill(T.PARK);
      f.spawnWhy.fill(evidence);
      f.roadMask[24] = 1; f.spawnWhy[25] |= S.ROAD;
      assert.eq(stamp(f), 47);
      assert.eq(f.grid[23], T.EXCLUSION_ROCK, 'paint does not erase private residential identity');
      assert.eq(f.grid[24], T.PARK, 'drawn route is not rock even if final paint is not road terrain');
      assert.eq(f.grid[25], T.PARK, 'source road footprint is also preserved');
    }
  });
  test('exclusion bedrock: registered tier field is shared with callers that only have a grid', () => {
    const f = lot(); W.registerGameplayTiers(f.grid, f.spawnWhy, f.gameplayTiers);
    delete f.gameplayTiers;
    assert.eq(stamp(f), 49);
    assert.falsy(W.isSpawnCell(f.grid, 7, 7, 3, 3, { spawnWhy: f.spawnWhy }, 'minor'));
    const unclassified = new Uint8Array(4).fill(T.RESIDENTIAL);
    assert.eq(W.stampExclusionRock(unclassified, 2, 2), 0, 'no invented classification without a tier field');
  });
  test('exclusion bedrock: tilling and planting gates refuse permanent rock with a clear label', () => {
    assert.falsy(isTillableCell({ type: T.EXCLUSION_ROCK }), 'hoe and planting share this gate');
    assert.eq(TERRAIN_FLAVOR[T.EXCLUSION_ROCK], 'Solid bedrock. No tilling.');
  });
  test('exclusion bedrock: surface movement blocks bedrock but still crosses roads and water', () => {
    const start = SCENE_SRC.indexOf('\n  _cellBlocked(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    const blocked = new Function('WorldGen', 'Arena', 'PushBlocks',
      'return ({' + SCENE_SRC.slice(start, end + 4) + '})._cellBlocked')
      (W, { DEPTH: -999 }, undefined);
    for (const type of [T.RESIDENTIAL, T.ROAD, T.WATER, T.EXCLUSION_ROCK]) {
      const scene = { depth: 0, cellAt: () => ({ loaded: true, type }) };
      assert.eq(blocked.call(scene, 0, 0), type === T.EXCLUSION_ROCK);
    }
    assert.falsy(blocked.call({ depth: 0, cellAt: () => ({ loaded: false }) }, 0, 0));
  });
})();
