// Permanent backyard bedrock uses actual terrain collision, not only spawn refusal.
(function () {
  const W = WorldGen, T = W.T, S = W.SPAWN_WHY;
  function lot() {
    return { grid: new Uint8Array(49).fill(T.RESIDENTIAL), w: 7, h: 7,
      spawnWhy: new Uint32Array(49).fill(S.PRIVATE), roadMask: new Uint8Array(49),
      occupied: new Set(), coverage: new Uint16Array(49) };
  }
  function stamp(f) { return W.stampExclusionRock(f.grid, f.w, f.h, f); }
  test('exclusion bedrock: deep private lot gets one-cell clearance and blocks spawn', () => {
    const f = lot(); assert.eq(stamp(f), 25);
    assert.eq(f.grid[0], T.RESIDENTIAL); assert.eq(f.grid[24], T.EXCLUSION_ROCK);
    assert.falsy(W.isWalkable(f.grid[24]));
    assert.falsy(W.isSpawnCell(f.grid, 7, 7, 3, 3, f));
    assert.truthy(f.spawnWhy[24] & S.TERRAIN);
  });
  test('exclusion bedrock: roads paths buildings water and public ground keep clearance', () => {
    for (const type of [T.ROAD, T.ROAD_MD, T.PATH, T.BUILDING, T.WATER, T.PARK, T.COMMERCIAL]) {
      const f = lot(); f.grid[24] = type; stamp(f);
      assert.eq(f.grid[24], type); assert.eq(f.grid[23], T.RESIDENTIAL);
      assert.eq(f.grid[16], T.RESIDENTIAL);
    }
  });
  test('exclusion bedrock: props zones road bands and sensitive reasons stay open', () => {
    for (const edit of [f => f.occupied.add(24), f => f.coverage[24] = 1,
      f => f.roadMask[24] = 1, f => f.spawnWhy[24] |= S.RESTRICTED,
      f => f.spawnWhy[24] = 0]) {
      const f = lot(); edit(f); stamp(f);
      assert.eq(f.grid[24], T.RESIDENTIAL); assert.eq(f.grid[23], T.RESIDENTIAL);
    }
    const f = lot(); f.spawnWhy.fill(S.BEHIND_HOUSE); assert.eq(stamp(f), 25);
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
