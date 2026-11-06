// The doorstep potato crate against Home's turned footing. The trail is laid
// before Home exists; Home then turns its house and firepit into the first
// compass heading, and clearHomeFooting sweeps that footing. At most headings
// the crate's north-up seat fell inside the sweep and was deleted on every
// build ("I can't find the tutorial seed crate"). A starter chest on the
// footing now moves off it (Starter.reseatStarterChest) instead.
(() => {
  const T = WorldGen.T, N = 44, CELL_M = 7, EDGE = N * CELL_M, SPAWN = 21;
  const KEY = WorldGen.tileKey(0, 0);
  const lift = (name) => liftSceneMethod(name, { BUILDING_TYPES: new Set([9, 11, 12]) });
  const anchor = { x: (SPAWN + 0.5) * CELL_M, y: (SPAWN + 0.5) * CELL_M };
  const cellOf = (o) => ({ dx: Math.floor(o.x / CELL_M) - SPAWN, dy: Math.floor(o.y / CELL_M) - SPAWN });
  const freshEntry = () => ({ cellsPerEdge: N, grid: new Uint8Array(N * N).fill(T.GRASS),
    objects: [], wildplants: [], roadMask: null });
  const scene = (save) => ({
    save, cellM: CELL_M, tileEdgeM: EDGE, cellsPerTile: N,
    mPerPx: CELL_M / (WorldGen.TILE_PX / N), originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, depth: 0,
    playerM: { ...anchor },
    _starterTrailAnchor() { return this.save.starterCratesAt; },
    _placeStarterRelicChest: placeStarterRelicChest,
    _carveStarterPlot() {}, _provisionStarterHome() {}, _scatterStarterStash() {}, _revealStarterTrail() {},
    _starterTrailerObj: null,
    _placeHome: lift('_placeHome'), _nearbyHomeBuilding: lift('_nearbyHomeBuilding'),
    _homeSiteClear: lift('_homeSiteClear'), _newHomeSite: lift('_newHomeSite'),
    _placePendingHomeFirepit: lift('_placePendingHomeFirepit'), _firepitGroundOK: lift('_firepitGroundOK'),
    _makeStarterTrailer: lift('_makeStarterTrailer'), _homeDoorSideToStreet: lift('_homeDoorSideToStreet'),
    _homeNearestStreet: lift('_homeNearestStreet'), ensureStarterTrailerObject: lift('ensureStarterTrailerObject'),
    clearHomeFooting: lift('clearHomeFooting'), _homeFootingAnchor: lift('_homeFootingAnchor'),
    _eraseHomeBuildings: lift('_eraseHomeBuildings'), _homeFootingAt: lift('_homeFootingAt'),
    _stampHomeFootprint: lift('_stampHomeFootprint'), _unstampHomeFootprint: lift('_unstampHomeFootprint'),
    homeInside: lift('homeInside'), homeInterior: lift('homeInterior'), homeWorldPos: lift('homeWorldPos'),
    ensureStarterShopId() {},
  });
  const potato = (entry) => entry.objects.find(o => o.crate && /^chest_start_0_0_1$/.test(o.id));

  test('starter doorstep crate: survives Home\'s footing sweep at every compass heading', () => {
    for (let heading = 0; heading < 360; heading += 15) {
      const entry = freshEntry();
      const s = scene({ starterCratesAt: anchor, homeCompassDetected: true });
      WorldGen.tileCache.set(KEY, entry);
      try {
        placeStarterTrail.call(s, entry, 0, 0);
        s._placeHome(anchor.x, anchor.y, heading);
        s._placePendingHomeFirepit();
        s.clearHomeFooting();
        const crate = potato(entry);
        assert.truthy(crate, `${heading}°: the potato crate was swept away`);
        const c = cellOf(crate), w = cellOf(s.save.starterTrailer), p = cellOf(s.save.homeFirepit);
        assert.truthy(Math.max(Math.abs(c.dx - w.dx), Math.abs(c.dy - w.dy)) > 1, `${heading}°: crate on the house sweep`);
        assert.falsy(c.dx === p.dx && c.dy === p.dy, `${heading}°: crate on the firepit`);
        assert.truthy(Math.max(Math.abs(c.dx), Math.abs(c.dy)) <= STARTER_DOORSTEP_CELLS,
          `${heading}°: crate left the doorstep radius (${c.dx},${c.dy})`);
        assert.eq(crate.fixedLoot.id, 'potato_seed');
        assert.eq(crate.fixedLoot.qty, 9);
        // A rebuild lays the trail on a fresh entry and the sweep runs again:
        // the crate lands on the same cell.
        const rebuilt = freshEntry();
        WorldGen.tileCache.set(KEY, rebuilt);
        s._starterTrailerObj = null;
        placeStarterTrail.call(s, rebuilt, 0, 0);
        s.ensureStarterTrailerObject();
        const again = potato(rebuilt);
        assert.truthy(again, `${heading}°: swept after a rebuild`);
        assert.eq(`${cellOf(again).dx},${cellOf(again).dy}`, `${c.dx},${c.dy}`, `${heading}°: rebuild moved the crate`);
      } finally { WorldGen.tileCache.delete(KEY); }
    }
  });

  test('starter doorstep crate: ordinary clutter on the footing is still swept', () => {
    const entry = freshEntry();
    const s = scene({ starterCratesAt: anchor, homeCompassDetected: true });
    WorldGen.tileCache.set(KEY, entry);
    try {
      s._placeHome(anchor.x, anchor.y, 0);
      const w = s.save.starterTrailer;
      entry.objects.push({ kind: 'mineralrock', id: 'rock_x', x: w.x + CELL_M, y: w.y });
      s.clearHomeFooting();
      assert.falsy(entry.objects.some(o => o.id === 'rock_x'), 'clutter stays swept');
    } finally { WorldGen.tileCache.delete(KEY); }
  });
})();
