// Parking retains its ground and treasure identity and shares the MD/LG kerb
// buffer's suppression at every hour, but never its night zone. Exercise
// generation rather than synthetic bits.
(function () {
  const W = WorldGen, N = 64, extent = 4096, edge = N * W.CELL_M;
  const point = (x, y) => ({ x: (x + .5) * extent / N, y: (y + .5) * extent / N });
  const feature = (type, tags, coords) => ({ type, tags, geom: [coords.map(([x, y]) => point(x, y))] });
  const build = layers => W.rasterizeTile([
    { name: 'landcover', features: [feature(3, { class: 'grass', subclass: 'grass' }, [[0,0],[63,0],[63,63],[0,63],[0,0]])] },
    ...layers,
  ], N, 0, 0, edge);
  test('parking safety: mapped lots suppress hazards and fast movers while keeping ordinary ground', () => {
    const e = build([{ name: 'landuse', features: [feature(3, { class: 'parking' }, [[20,20],[40,20],[40,40],[20,40],[20,20]])] }]);
    const i = 30 * N + 30, opts = W.spawnOptsOf(e, { pois: [{ ix: 30, iy: 30 }] });
    assert.truthy(e.roadClass[i] & W.ROAD_CLASS_MAJOR_BUFFER, 'the kerb buffer suppression');
    assert.truthy(e.roadClass[i] & W.ROAD_CLASS_LOT_BUFFER, 'marked as a lot-only buffer');
    assert.falsy(W.nightZoneBits(e.roadClass[i]), 'no night zone');
    assert.truthy(e.spawnWhy[i] & W.SPAWN_WHY.KERB);
    assert.falsy(e.roadMask[i], 'parking is not a carriageway');
    assert.falsy(e.roadClass[i] & W.ROAD_CLASS_MAJOR_ROAD, 'standing-on-road warning remains road-only');
    for (const cls of ['fastEnemy', 'fastFauna', 'hazard'])
      assert.falsy(W.isSpawnCell(e.grid, N, N, 30, 30, opts, cls), cls);
    for (const cls of ['minor', 'enemy', 'fauna'])
      assert.truthy(W.isSpawnCell(e.grid, N, N, 30, 30, opts, cls), cls);
    assert.falsy(e.roadClass[10 * N + 10] & W.ROAD_CLASS_MAJOR_BUFFER, 'outside stays open');
    const key = W.tileKey(0, 0), before = W.tileCache.get(key);
    W.tileCache.set(key, { ...e, cellsPerEdge: N });
    const x = 30.5 * W.CELL_M, scene = { depth: 0, cellsPerTile: N, tileEdgeM: edge,
      startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, mPerPx: edge / W.TILE_PX };
    try {
      assert.falsy(RoadSafety.nightRoadZone(scene, x, x, 0, 0), 'no blood aura or night drain after hours');
      assert.falsy(RoadSafety.nightRoadZone(scene, x, x, 0, 1), 'nor by day');
      assert.falsy(RoadSafety.objectHidden(scene, { x, y: x }, true), 'interactions stay visible at night');
    } finally { if (before) W.tileCache.set(key, before); else W.tileCache.delete(key); }
  });
  test('parking safety: pruned aisles and standalone lot POIs retain suppression evidence', () => {
    const layers = [{ name: 'transportation', features: [feature(2, { class: 'service', service: 'parking_aisle' }, [[20,20],[40,20]])] },
      { name: 'poi', features: [feature(1, { class: 'parking' }, [[30,40]])] }];
    const e = build(layers);
    for (const [x,y] of [[30,20],[30,21],[30,40],[32,40]]) {
      assert.truthy(e.spawnWhy[y*N+x] & W.SPAWN_WHY.KERB, `${x},${y}`);
      assert.falsy(e.roadMask[y*N+x]);
    }
    const again = build(layers);
    assert.eq(Array.from(again.roadClass).join(','), Array.from(e.roadClass).join(','), 'replaying pruned layers retains the same mask');
  });
  test('parking safety: a lot never removes a road kerb buffer\'s night zone', () => {
    const e = build([{ name: 'transportation', features: [feature(2, { class: 'primary' }, [[5,30],[58,30]])] },
      { name: 'landuse', features: [feature(3, { class: 'parking' }, [[20,26],[40,26],[40,40],[20,40],[20,26]])] }]);
    const road = 30 * N + 30, lot = 38 * N + 30;
    assert.truthy(W.nightZoneBits(e.roadClass[road]), 'the road buffer keeps its night zone inside the lot');
    assert.truthy(e.roadClass[lot] & W.ROAD_CLASS_MAJOR_BUFFER);
    assert.falsy(W.nightZoneBits(e.roadClass[lot]), 'lot-only cells stay calm at night');
  });
  test('parking safety: streetside parking pins do not invent a lot around a Small road', () => {
    const e = build([{ name: 'transportation', features: [feature(2, { class: 'minor' }, [[5,30],[58,30]])] },
      { name: 'poi', features: [feature(1, { class: 'parking' }, [[30,31]])] }]);
    assert.falsy(e.roadClass[33*N+30] & W.ROAD_CLASS_LOT_BUFFER);
  });
  test('parking safety: a real parking crater keeps its quarry and finds without lava', () => {
    const choose = QuarryLayout.variantForSteps;
    QuarryLayout.variantForSteps = function* () { return 'quarry-crater'; };
    try {
      const e = build([
        { name: 'landcover', features: [feature(3, { class: 'parking' }, [[4,4],[59,4],[59,59],[4,59],[4,4]])] },
        { name: 'transportation', features: [feature(2, { class: 'service', service: 'parking_aisle' }, [[20,20],[40,20],[40,40],[20,40],[20,20]])] },
      ]);
      assert.truthy(e.zone.anchors.some(a => a.kind === 'quarry' && a.variant === 'quarry-crater'), 'parking remains a crater quarry');
      assert.truthy(e.zone.coverage.some(Boolean), 'quarry still owns its footprint');
      assert.falsy(e.grid.some(t => t === W.T.CAVE_LAVA), 'suppression leaves dry crater ground');
      assert.falsy(e.zoneDress.objects.some(o => o.kind === 'lava_vent'), 'no damaging ground marker');
      assert.eq(e.zoneDress.objects.filter(o => o.zoneVariant === 'quarry-crater' && o.zoneLayer === 'find').length, 2, 'finite ore budget survives');
      assert.truthy(e.zoneDress.objects.some(o => o.shrineKind === 'ember_altar'), 'dry crater retains its altar');
    } finally { QuarryLayout.variantForSteps = choose; }
  });
})();
