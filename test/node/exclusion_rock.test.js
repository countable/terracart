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
