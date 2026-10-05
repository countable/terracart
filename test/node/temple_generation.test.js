(() => {
  const N = 64, EXT = 4096, edge = N * WorldGen.CELL_M;
  const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 },
    { x: x1, y: y1 }, { x: x0, y: y1 }];
  function generate(tx = 0, buildings = [rect(1900, 1900, 2300, 2300)]) {
    const shift = ring => ring.map(p => ({ x: p.x - tx * EXT, y: p.y }));
    return WorldGen.rasterizeTile([
      { name: 'landuse', features: [{ type: 3, tags: { class: 'residential' }, geom: [rect(0, 0, EXT, EXT)] }] },
      { name: 'park', features: [{ type: 3, tags: { class: 'park' }, geom: [shift(rect(1600, 1400, 4300, 2600))] }] },
      { name: 'building', features: buildings.map(ring => ({ type: 3, tags: {}, geom: [shift(ring)] })) },
      { name: 'poi', features: [{ type: 1, tags: { class: 'park', subclass: 'park', name: 'Temple Park' },
        geom: [[{ x: 2100 - tx * EXT, y: 2100 }]] }] },
    ], N, tx, 0, edge);
  }
  test('temple generation: nexus footprints replace buildings and never produce turrets', () => {
    const out = generate();
    const shape = out.buildingShapes[0];
    assert.eq(shape.kind, 'temple');
    assert.eq(shape.tier, WorldGen.T.BUILDING_LARGE);
    const temple = out.objects.find(o => o.kind === 'temple');
    assert.truthy(temple, 'temple survives building cleanup');
    assert.eq(shape.key, temple.id);
    assert.eq(shape.templeZone, temple.templeZone);
    assert.eq(String(temple.templeAnchor.key), temple.templeZone);
    assert.falsy(out.objects.some(o => o.kind === 'house' || o.kind === 'tower'));
    assert.truthy(Array.from(out.owners).some(owner => out.ownerKeys[owner] === temple.id));
  });
  test('temple generation: any overlapping footprint cell qualifies, and distant buildings remain ordinary', () => {
    const out = generate(0, [rect(1200, 1800, 1800, 2200), rect(100, 100, 500, 500)]);
    assert.eq(out.buildingShapes[0].kind, 'temple');
    assert.falsy(out.buildingShapes[1].kind === 'temple');
  });
  test('temple generation: a seam temple has one stable owner and no turrets on either tile', () => {
    const ring = rect(4000, 1900, 4240, 2300);
    const west = generate(0, [ring]), east = generate(1, [ring]);
    assert.eq(west.buildingShapes[0].kind, 'temple');
    assert.eq(east.buildingShapes[0].kind, 'temple');
    assert.eq(west.buildingShapes[0].key, east.buildingShapes[0].key);
    assert.eq([...west.objects, ...east.objects].filter(o => o.kind === 'temple').length, 1);
    assert.falsy([...west.objects, ...east.objects].some(o => o.kind === 'tower' || o.kind === 'house'));
  });
  test('temple generation: only nexus kinds raise temples - quarry holes and shore buildings stay ordinary', () => {
    // The owning table: grove (generated marine groves included), stones, tar.
    assert.truthy(Zones.ZONE_KINDS.grove.temple && Zones.ZONE_KINDS.stones.temple && Zones.ZONE_KINDS.tar.temple);
    assert.falsy(Zones.ZONE_KINDS.beach.temple || Zones.ZONE_KINDS.quarry.temple, 'the shore and the quarry never claim a building');
    // A quarry's building-shaped hole keeps its ordinary building.
    const lane = { f: { id: 1, type: 2, tags: { class: 'service', service: 'parking_aisle' } },
      extent: EXT, lines: [[{ x: 20.5 * 64, y: 20.5 * 64 }, { x: 30.5 * 64, y: 20.5 * 64 }]] };
    const out = WorldGen.rasterizeTile([
      { name: 'transportation', features: [], parkingLanes: [lane] },
      { name: 'building', features: [{ type: 3, tags: {}, geom: [rect(24 * 64, 20 * 64, 26 * 64, 22 * 64)] }] },
    ], N, 0, 0, edge);
    assert.falsy(out.buildingShapes[0].kind === 'temple', 'the quarry building is no temple');
    assert.falsy(out.objects.some(o => o.kind === 'temple'), 'no temple is minted on quarry ground');
    assert.truthy(out.objects.some(o => o.kind === 'house'), 'the building keeps its ordinary roof');
    // A shore anchor's field may cover the ground, but never claims a building.
    const shore = WorldGen.rasterizeTile([
      { name: 'poi', features: [{ type: 1, tags: { class: 'beach', name: 'The shore' },
        geom: [[{ x: 2100, y: 2100 }]] }] },
      { name: 'building', features: [{ type: 3, tags: {}, geom: [rect(1900, 1900, 2300, 2300)] }] },
    ], N, 0, 0, edge);
    assert.falsy(shore.buildingShapes[0].kind === 'temple', 'the shore building is no temple');
    assert.falsy(shore.objects.some(o => o.kind === 'temple'));
  });

  test('temple generation: a school building keeps its castle - education ground is never a zone temple', () => {
    const layers = (education) => ([
      { name: 'landuse', features: education
        // No full-tile residential base here: paintCell is priority-gated, and
        // residential (4) would block the education paint (1.5) that the guard
        // reads. Real campuses paint school over grass, as here.
        ? [{ type: 3, tags: { class: 'education' }, geom: [rect(1500, 1700, 2800, 2800)] }]
        : [] },
      { name: 'park', features: [{ type: 3, tags: { class: 'park' }, geom: [rect(1600, 1400, 4300, 2600)] }] },
      { name: 'building', features: [{ type: 3, tags: {}, geom: [rect(1600, 1800, 2600, 2600)] }] },
      { name: 'poi', features: [{ type: 1, tags: { class: 'park', subclass: 'park', name: 'Temple Park' },
        geom: [[{ x: 2100, y: 2100 }]] }] },
    ]);
    const school = WorldGen.rasterizeTile(layers(true), N, 0, 0, edge);
    assert.falsy(school.buildingShapes[0].kind === 'temple', 'the school castle is not claimed as the zone temple');
    assert.falsy(school.objects.some(o => o.kind === 'temple'), 'no temple is minted on education ground');
    assert.eq(school.buildingShapes[0].tier, WorldGen.T.BUILDING_LARGE, 'the building keeps its castle tier');
    const control = WorldGen.rasterizeTile(layers(false), N, 0, 0, edge);
    assert.eq(control.buildingShapes[0].kind, 'temple', 'without the education ground the same park claims the same building');
  });
})();
