(() => {
  const point = (id, x, y, tags) => ({ id, type: 1, geom: [[{ x, y }]], tags });
  test('park zones: named park-layer points become POIs without changing source data or duplicating parks', () => {
    const existing = point(1, 100, 100, { class: 'park', subclass: 'park', name: 'Existing Park' });
    const poi = { name: 'poi', features: [existing] };
    const park = { name: 'park', features: [
      point(1, 110, 110, { class: 'park', name: 'Existing Park' }),
      point(2, 100, 100, { class: 'nature_reserve', name: 'Same point' }),
      point(3, 300, 300, { class: 'nature_reserve', name: 'Linear Park' }),
      point(4, 400, 400, { class: 'nature_reserve' }),
      point(5, 500, 500, { class: 'protected_area', name: 'Whole neighbourhood' }),
      point(6, 600, 600, { class: 'park', name: 'Gedenkstätte am Park' }),
      point(7, 6000, 6000, { class: 'park', name: 'Beyond the POI buffer' }),
      { ...point(8, 700, 700, { class: 'park', name: 'Polygon only' }), type: 3 },
    ] };
    const snapshot = JSON.stringify([poi, park]);
    const out = WorldGen.parkPoiLayer(poi, park);
    assert.eq(out.features.length, 2);
    assert.eq(out.features[0], existing, 'ordinary POI identity retained');
    assert.eq(out.features[1].id, 3);
    assert.eq(out.features[1].tags.class, 'park');
    assert.eq(out.features[1].tags.subclass, 'park');
    assert.eq(JSON.stringify([poi, park]), snapshot, 'decoded source layers are immutable');
    assert.eq(WorldGen.parkPoiLayer(out, park), out, 'normalization is idempotent');
    assert.eq(WorldGen.parkPoiLayer(poi, null), poi);
  });

  test('park zones: fallback anchors agree across buffered fixture tiles', () => {
    const seen = new Map();
    let shared = 0;
    for (const [key, bytes] of Object.entries(FIXTURE_TILES)) {
      const [tx, ty] = key.split('_').map(Number), layers = MVT.decodeTile(bytes);
      const poi = WorldGen.parkPoiLayer(layers.find(l => l.name === 'poi'), layers.find(l => l.name === 'park'));
      const all = Zones.resolveAnchors(Zones.collectAnchors(poi, tx, ty));
      for (const a of all) {
        const lx = a.gx - tx * 4096, ly = a.gy - ty * 4096;
        const pad = a.R * (1 + Zones.EDGE_JITTER) / a.upm;
        if (lx < -pad || ly < -pad || lx > 4096 + pad || ly > 4096 + pad) continue;
        const id = `${a.kind}|${a.gx}|${a.gy}`;
        const signature = `${a.key}|${a.q.toFixed(9)}|${a.R.toFixed(9)}|${ZoneVariants.pick(a).id}`;
        if (seen.has(id)) { shared++; assert.eq(signature, seen.get(id), `${id} from ${key}`); }
        else seen.set(id, signature);
      }
    }
    assert.gt(shared, 5);
  });

  test('park zones: Wilson Creek Linear Park receives a shrine, variant and polygon fringe coverage', () => {
    const tx = 2754, ty = 5567, layers = MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]);
    const N = WorldGen.cellsPerEdgeForTile(ty), edge = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
    const world = WorldGen.rasterizeTile(layers, N, tx, ty, edge);
    const anchors = world.zone.anchors.filter(a => a.name === 'Wilson Creek Linear Park');
    assert.eq(anchors.length, 1);
    const a = anchors[0], slot = world.zone.anchors.indexOf(a) + 1;
    assert.eq(a.gx, tx * 4096 + 1310); assert.eq(a.gy, ty * 4096 + 1505);
    assert.truthy(ZoneVariants.byId(a.variant));
    const shrine = world.objects.filter(o => o.name === a.name);
    assert.eq(shrine.length, 1); assert.eq(shrine[0].kind, 'grove_shrine');
    assert.eq(shrine[0].zoneVariant, a.variant);
    assert.truthy(world.zone.coverage.some((s, i) => s === slot && !world.zone.idx[i]), 'polygon/fringe reaches beyond the influence radius');
    const report = world.zoneDress.diagnostics.find(d => d.anchorKey === a.key);
    assert.gt(report.placed, 0, 'variant places actual interactables');
  });
})();
