// WHAT A HOUSE SAYS UNDERFOOT (app.js _houseMutter): a wreck grumbles, a
// restored neighbour's house greets you — and HOME SAYS NOTHING. The starter
// trailer (and an adopted house) is a tier-9 house that isHouseWreck counts
// as restored, so without its own check it greeted the player on every pass
// through their own door ("Thanks for fixing my house!"). Home is the one
// verdict every surface reads, Houses.displayRole === 'trailer'.
//
// The pass is the SHIPPING method, lifted by run.js (__trailCounter).
(function () {
const SW = __trailCounter;
const N = 51, CELL_M = 7, TILE_EDGE_M = N * CELL_M;
const M_PER_PX = CELL_M * N / WorldGen.TILE_PX;
// Feet on cell (3, 3) of tile (0, 0); the house sits on the same cell's centre.
const CELL = 3;
const houseAt = (id, tier) => ({ kind: 'house', id, tier, x: (CELL + 0.5) * CELL_M, y: (CELL + 0.5) * CELL_M });
const scene = (save, objects) => ({
  depth: 0, save, cellM: CELL_M, cellsPerTile: N, mPerPx: M_PER_PX,
  originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, feetOffsetM: 0,
  playerM: { x: (CELL + 0.5) * CELL_M, y: (CELL + 0.5) * CELL_M },
  pops: [], _popCellNumber(text, color, ix, iy) { this.pops.push({ text, color, ix, iy }); },
  _houseMutter: SW._houseMutter,
});
const withTile = (objects, fn) => {
  const key = WorldGen.tileKey(0, 0);
  const had = WorldGen.tileCache.get(key);
  WorldGen.tileCache.set(key, { cellsPerEdge: N, tileEdgeM: TILE_EDGE_M, layers: [], objects });
  try { return fn(); }
  finally { if (had === undefined) WorldGen.tileCache.delete(key); else WorldGen.tileCache.set(key, had); }
};
// Walk the feet off the cell and back, so the per-cell latch re-arms.
const reenter = (s) => {
  const here = { ...s.playerM };
  s.playerM = { x: here.x + 3 * CELL_M, y: here.y }; s._houseMutter();
  s.playerM = here; s._houseMutter();
};

test('house mutter: a wreck grumbles and a restored neighbour greets, one line per entry', () => {
  const wreck = houseAt('h_wreck', 9);
  withTile([wreck], () => {
    const s = scene({ restoredHouses: {} }, [wreck]);
    s._houseMutter();
    assert.eq(s.pops.length, 1, 'stepping onto a wreck says one thing');
    assert.includes(HOUSE_WRECK_MUTTERS, s.pops[0].text, 'in the wreck\'s voice');
    assert.eq(s.pops[0].ix, CELL); assert.eq(s.pops[0].iy, CELL);
    s._houseMutter(); s._houseMutter();
    assert.eq(s.pops.length, 1, 'standing there says nothing more');
    reenter(s);
    assert.eq(s.pops.length, 2, 'walking off and back says it again');
  });
  const done = houseAt('h_done', 9);
  withTile([done], () => {
    const s = scene({ restoredHouses: { h_done: true } }, [done]);
    s._houseMutter();
    assert.eq(s.pops.length, 1, 'a restored house greets');
    assert.includes(HOUSE_RESTORED_MUTTERS, s.pops[0].text, 'in the neighbour\'s voice');
  });
  for (const line of [...HOUSE_WRECK_MUTTERS, ...HOUSE_RESTORED_MUTTERS]) {
    assert.lte(line.length, MAP_MSG_MAX, `fits a map line: "${line}"`);
  }
});

test('house mutter: HOME says nothing — the starter trailer and an adopted house alike', () => {
  // The synthetic trailer: ensureStarterTrailerObject's shape, a tier-9
  // house that is Home by starterShopId.
  const trailer = { kind: 'house', id: 'starter_trailer', tier: WorldGen.T.BUILDING,
    x: (CELL + 0.5) * CELL_M, y: (CELL + 0.5) * CELL_M, _synthetic: true };
  withTile([trailer], () => {
    const save = { starterShopId: 'starter_trailer', starterTrailer: { id: 'starter_trailer' }, restoredHouses: {} };
    assert.eq(Houses.displayRole(save, trailer), 'trailer', 'the trailer IS Home');
    assert.falsy(Houses.isHouseWreck(save, trailer), 'and reads as restored — the trap');
    const s = scene(save, [trailer]);
    s._houseMutter(); reenter(s); reenter(s);
    assert.eq(s.pops.length, 0, 'walking through the trailer prints nothing');
  });
  // An adopted real house is Home by the same key, and as quiet.
  const adopted = houseAt('h_home', 9);
  withTile([adopted], () => {
    const save = { starterShopId: 'h_home', restoredHouses: { h_home: true } };
    const s = scene(save, [adopted]);
    s._houseMutter(); reenter(s);
    assert.eq(s.pops.length, 0, 'an adopted Home prints nothing either');
    // …while the same house NOT adopted still greets: it is Home, not the
    // tier, that silences it.
    const s2 = scene({ restoredHouses: { h_home: true } }, [adopted]);
    s2._houseMutter();
    assert.eq(s2.pops.length, 1, 'the same house as a neighbour\'s greets');
  });
  // Source pin: Home is judged by the one display verdict, before the wreck test.
  const body = SCENE_SRC.slice(SCENE_SRC.indexOf('  _houseMutter() {'), SCENE_SRC.indexOf('  _visitStreetLamps(now) {'));
  const homeAt = body.indexOf("Houses.displayRole(this.save, house) === 'trailer'");
  const wreckAt = body.indexOf('Houses.isHouseWreck(this.save, house)');
  assert.truthy(homeAt > 0 && wreckAt > homeAt, 'Home (displayRole trailer) is checked before the wreck verdict');
});
})();
