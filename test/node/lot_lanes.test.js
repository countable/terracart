// LOT LANES DO NOT EXIST (WorldGen.isLotLane / pruneLotLanesSteps).
//
// A parking-lot lane — a way tagged service=parking_aisle, or an unlabelled
// service way the tile's own data places clearly inside a lot — is cut out of
// the tile's transportation layer by the rasterizer's FIRST pass, so nothing
// downstream (terrain, roadMask, the street index, scenic, labels, the road
// overlay, restoration, lamps — all of which read that same layer object)
// ever meets one. Every OTHER service way stays an ordinary road.
//
// These drive the REAL rasterizer over a synthetic lot.
(function () {
const CPE = 64;
const TILE_EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;                          // 64 units = one 7 m cell
const at = (c) => c * CELL_MVT + CELL_MVT / 2;
const line = (cells) => cells.map(([cx, cy]) => ({ x: at(cx), y: at(cy) }));
const pt = (cx, cy) => [[{ x: at(cx), y: at(cy) }]];

// The lot: a lot parking POI at (40,40), 30 cells from any street; a tagged
// aisle beside it; unlabelled service ways inside it. Round it: a street-side
// parking POI on the street at row 10 with a courtyard way near it, a long
// service road passing the lot, and a plain service road far from any lot.
const AISLE   = line([[36, 38], [44, 38]]);
const IN_LOT  = line([[37, 41], [43, 41]]);             // ~3 cells off the lot POI
const IN_LOT2 = line([[38, 43], [42, 43]]);             // merged with FAR below
const FAR     = line([[5, 50], [12, 50]]);
const COURT   = line([[18, 12], [22, 12]]);             // near street-side parking only
const LONG    = line([[0, 36], [63, 36]]);              // 441 m: never inferred
const PLAIN   = line([[50, 55], [58, 55]]);
function layers() {
  return [
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'residential' }, geom: [line([[0, 0], [63, 0], [63, 63], [0, 63], [0, 0]])] },
    ] },
    { name: 'transportation', extent: EXTENT, features: [
      { id: 1, type: 2, tags: { class: 'minor' }, geom: [line([[0, 10], [63, 10]])] },
      { id: 2, type: 2, tags: { class: 'service', service: 'parking_aisle' }, geom: [AISLE] },
      { id: 3, type: 2, tags: { class: 'service' }, geom: [IN_LOT] },
      { id: 4, type: 2, tags: { class: 'service' }, geom: [IN_LOT2, FAR] },
      { id: 5, type: 2, tags: { class: 'service' }, geom: [COURT] },
      { id: 6, type: 2, tags: { class: 'service' }, geom: [LONG] },
      { id: 7, type: 2, tags: { class: 'service' }, geom: [PLAIN] },
    ] },
    { name: 'transportation_name', extent: EXTENT, features: [
      { type: 2, tags: { class: 'service', name: 'Lot Loop' }, geom: [IN_LOT] },
      { type: 2, tags: { class: 'service', name: 'Court Way' }, geom: [COURT] },
    ] },
    { name: 'poi', extent: EXTENT, features: [
      { type: 1, tags: { class: 'parking', subclass: 'parking' }, geom: pt(40, 40) },
      { type: 1, tags: { class: 'parking', subclass: 'parking' }, geom: pt(20, 10) },  // on the street
    ] },
  ];
}
function build() {
  const L = layers();
  const r = WorldGen.rasterizeTile(L, CPE, 0, 0, TILE_EDGE_M);
  const by = {};
  for (const l of L) by[l.name] = l;
  return { L, r, by };
}
const sameLine = (a, b) => a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
const hasLine = (layer, ln) => layer.features.some((f) => f.geom.some((g) => sameLine(g, ln)));
const cellsOf = (cells) => cells.map(([cx, cy]) => cy * CPE + cx);
const rowCells = (y, x0, x1) => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y]);

test('lot lanes: a tagged parking aisle is cut from the layer and stamps no road mask', () => {
  const { r, by } = build();
  assert.truthy(WorldGen.isLotLane({ class: 'service', service: 'parking_aisle' }), 'tags alone decide an aisle');
  assert.falsy(hasLine(by.transportation, AISLE), 'the aisle is gone from the layer the overlay / restore / lamps read');
  assert.falsy(by.transportation.features.some((f) => WorldGen.isLotLane(f.tags)), 'no lot lane survives');
  for (const i of cellsOf(rowCells(38, 37, 43))) {
    assert.eq(r.roadMask[i], 0, 'aisle cell is not road ground');
    assert.eq(r.roadClass[i] & WorldGen.ROAD_CLASS_MAJOR_BUFFER, 0, 'nor kerb');
  }
});

test('lot lanes: unlabelled service ways inside a lot are inferred and cut, per LINE', () => {
  const { r, by } = build();
  assert.falsy(hasLine(by.transportation, IN_LOT), 'the lane beside the lot POI is cut');
  assert.falsy(hasLine(by.transportation, IN_LOT2), 'so is the lot line of a merged feature');
  assert.truthy(hasLine(by.transportation, FAR), '…whose far line stays a road');
  for (const i of cellsOf(rowCells(41, 38, 42))) assert.eq(r.roadMask[i], 0, 'lot lane cell is ground');
  // The surviving line keeps its restore key: lineKey hashes the line and the
  // feature id, not the line's index in the (now shorter) feature.
  const kept = by.transportation.features.find((f) => f.id === 4);
  assert.eq(kept.geom.length, 1);
  const before = Streets.lineKey({ id: 4, tags: { class: 'service' }, geom: [IN_LOT2, FAR] }, 1);
  assert.eq(Streets.lineKey(kept, 0), before, 'restored metres on the far line survive the cut');
  // The lane's label went with it; a label on a kept way did not.
  const names = by.transportation_name.features.map((f) => f.tags.name);
  assert.falsy(names.includes('Lot Loop'), 'the lot lane has no label');
  assert.truthy(names.includes('Court Way'), 'a kept service way keeps its label');
});

test('lot lanes: street-side parking, a long service road and a plain service road stay roads', () => {
  const { r, by } = build();
  assert.truthy(hasLine(by.transportation, COURT), 'street-side parking vouches for no lot');
  assert.truthy(hasLine(by.transportation, LONG), 'a long service road past a lot is a road');
  assert.truthy(hasLine(by.transportation, PLAIN), 'a plain service road is a road');
  const plain = by.transportation.features.find((f) => f.id === 7);
  assert.falsy(WorldGen.isLotLane(plain.tags), 'not a lot lane');
  // Restorable: it survives in the layer app.js _rescanStreets walks, and its
  // metres inside the tile square are there to pay.
  const spans = Streets.tileSpans(PLAIN, TILE_EDGE_M / EXTENT, EXTENT);
  assert.gt(spans.reduce((s, sp) => s + (sp[1] - sp[0]), 0), 40, 'metres to restore');
  // And lamps: a restored plain service road is lit like any street.
  assert.gt(Streets.lampsAlong(LONG, TILE_EDGE_M / EXTENT).length, 0, 'lamps along a kept service road');
  let masked = 0;
  for (const i of cellsOf(rowCells(55, 51, 57))) masked += r.roadMask[i];
  assert.eq(masked, 7, 'a plain service road is road ground');
});

test('lot lanes: the cut is idempotent and deterministic', () => {
  const { L, by } = build();
  const n = by.transportation.features.length;
  const it = WorldGen.pruneLotLanesSteps(by, (CPE * WorldGen.CELL_M) / EXTENT);
  let s; while (!(s = it.next()).done);
  assert.eq(s.value.length, 0, 'a second cut finds nothing');
  assert.eq(by.transportation.features.length, n);
  const again = build().by.transportation.features.map((f) => f.id).join(',');
  assert.eq(by.transportation.features.map((f) => f.id).join(','), again, 'same data, same cut');
  assert.truthy(L);
});
})();
