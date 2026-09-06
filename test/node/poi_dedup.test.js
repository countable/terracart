// One real-world place, one chest (src/worldgen.js › isDupPoiChest).
//
// The Overpass sidecar turns every OSM point feature it carries into a chest.
// OSM does not map one crossing as one node: a signalised crossing is a node
// per carriageway and turn lane it crosses, so Gordon Dr at KLO Rd is SIX
// highway=crossing nodes inside 8 m, and a bank of bike lockers is a node per
// locker 2 m apart. Each node became its own chest; snapped to 5 m cells they
// landed in adjacent cells, and the cell-only occupancy check kept them all —
// "some POI are duplicated side by side". These pin the shared distance rule
// and that the injection loop actually uses it.

(function () {
const WG = WorldGen;
const chest = (poiClass, x, y) => ({ kind: 'chest', poiClass, x, y, id: `${poiClass}_${x}_${y}` });

test('poi dedupe: the Gordon-at-KLO crossing cluster collapses to one chest', () => {
  // The six real nodes, in metres from the first (from data/satextract_osm.geojson).
  const nodes = [[0, 0], [1.5, 0], [5.5, 1], [5.6, -1], [5.9, 2], [8.2, 4]];
  const kept = [];
  for (const [x, y] of nodes) {
    const ch = chest('crossing', x, y);
    if (!WG.isDupPoiChest(kept, ch)) kept.push(ch);
  }
  assert.eq(kept.length, 1, `six nodes inside 8 m are one crossing, got ${kept.length} chests`);
});

test('poi dedupe: a bank of bike lockers is one stand', () => {
  const kept = [chest('bicycle_parking', 0, 0)];
  assert.truthy(WG.isDupPoiChest(kept, chest('bicycle_parking', 2.2, 0)), 'the next locker along');
});

test('poi dedupe: two stops on opposite sides of the street both survive', () => {
  // Distinct real furniture sits ~15 m apart across a street; the point radius
  // has to stay under that or the far stop disappears.
  assert.lt(WG.POI_DUP_POINT_M, 15, 'the point radius must not reach across the street');
  const kept = [chest('bus', 0, 0)];
  assert.falsy(WG.isDupPoiChest(kept, chest('bus', 15, 0)), 'the stop across the road is a second stop');
  // …and the four legs of an intersection are four crossings.
  const legs = [chest('crossing', 0, 0)];
  assert.falsy(WG.isDupPoiChest(legs, chest('crossing', 18, 0)), 'the crossing on the next leg is its own place');
});

test('poi dedupe: a field is matched at the wider area radius', () => {
  // MVT label point vs sidecar way centroid put the same pitch's two chests
  // several metres apart (the Children's Yard / Tourney Grounds duplicates).
  assert.gt(WG.POI_DUP_AREA_M, WG.POI_DUP_POINT_M, 'a field is bigger than a post');
  const kept = [chest('pitch', 0, 0)];
  assert.truthy(WG.isDupPoiChest(kept, chest('pitch', 20, 0)), 'the same pitch from the other pipeline');
  assert.falsy(WG.isDupPoiChest(kept, chest('pitch', 40, 0)), 'the next pitch over is a second field');
  assert.eq(WG.poiDupRadiusM('pitch'), WG.POI_DUP_AREA_M);
  assert.eq(WG.poiDupRadiusM('crossing'), WG.POI_DUP_POINT_M);
});

test('poi dedupe: only the same class merges', () => {
  // A signal post beside a crossing is two places; the rule is about one
  // feature mapped twice, never about thinning the street furniture.
  const kept = [chest('traffic_signals', 0, 0), chest('stop', 3, 0)];
  assert.falsy(WG.isDupPoiChest(kept, chest('crossing', 1, 0)), 'a crossing beside a signal is kept');
});

test('poi dedupe: the sidecar injection loop consults the rule', () => {
  // The helper is only worth anything if loadTile's chest loop calls it
  // before pushing the chest — a local reimplementation there would drift.
  assert.truthy(SX_CHEST_INJECT_SRC.includes('isDupPoiChest(entry.objects, ch)'),
    'loadTile must ask isDupPoiChest against the tile\'s live objects before injecting a sidecar chest');
});
})();
