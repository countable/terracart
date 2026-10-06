// LOT LANES DO NOT EXIST (WorldGen.isLotLane / pruneLotLanesSteps).
//
// A parking-lot lane — a way tagged service=parking_aisle, or an unlabelled
// service way the tile's own data places clearly inside a lot — is cut out of
// the tile's transportation layer by the rasterizer's FIRST pass, so nothing
// downstream (terrain, roadMask, the street index, scenic, labels, the road
// overlay, restoration, lamps — all of which read that same layer object)
// ever meets one. Removed geometry remains generation-only quarry input.
// Every OTHER service way stays an ordinary road.
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
test('lot lanes: removed tagged and inferred geometry remains generation-only quarry input', () => {
  const { r, by } = build();
  const removed = by.transportation.parkingLanes;
  assert.truthy(removed && removed.length, 'removed geometry survives outside the rendered features');
  const removedLines = removed.flatMap(record => record.lines);
  for (const expected of [AISLE, IN_LOT, IN_LOT2]) {
    assert.truthy(removedLines.some(actual => sameLine(actual, expected)), 'tagged and inferred lane both feed quarry coverage');
  }
  for (const road of [FAR, COURT, LONG, PLAIN]) {
    assert.falsy(removedLines.some(actual => sameLine(actual, road)), 'a surviving service road does not become quarry source');
  }
  const ownerAt = (x, y) => r.zone?.anchors[r.zone.coverage[y * CPE + x] - 1];
  for (const y of [41, 43]) {
    assert.falsy(ownerAt(40, y), 'removed lanes cannot claim an excluded residential lot');
    assert.truthy(r.spawnWhy[y * CPE + 40] & WorldGen.SPAWN_WHY.PRIVATE, 'lot retains its private-land exclusion');
    assert.falsy(WorldGen.isSpawnCell(r.grid, CPE, CPE, 40, y,
      { spawnWhy: r.spawnWhy, roadMask: r.roadMask }, 'minor'), 'no quarry dressing on excluded land');
  }
  assert.eq(r.roadMask[41 * CPE + 40], 0, 'the lane never regains a carriageway');
  assert.falsy(hasLine(by.transportation, IN_LOT), 'lamps, restoration and road overlays still cannot see the lane');
});

test('lot lanes: removal reasons distinguish tags, parking POIs and nearby aisles', () => {
  const {by}=build();
  const tagged=by.transportation.parkingLanes.find(row=>row.f.id===2);
  const inferred=by.transportation.parkingLanes.find(row=>row.f.id===3);
  assert.eq(JSON.stringify(tagged.reasons), JSON.stringify([['parking_aisle']]));
  assert.eq(JSON.stringify(tagged.lineGroups),JSON.stringify([[]]),'tags alone do not declare a same-lot group');
  assert.eq(JSON.stringify(inferred.lineGroups),JSON.stringify([[]]),'POI proximity alone does not merge lots');
  assert.eq(JSON.stringify(inferred.reasons), JSON.stringify([['parking_poi']]));
  for (const withPoi of [false,true]) {
    const L=layers();
    if (!withPoi) L.find(l=>l.name==='poi').features=[];
    const tl=L.find(l=>l.name==='transportation');
    tl.features.find(f=>f.id===3).geom=[line([[37,39],[43,39]])];
    WorldGen.rasterizeTile(L,CPE,0,0,TILE_EDGE_M);
    const row=tl.parkingLanes.find(row=>row.f.id===3);
    assert.eq(JSON.stringify(row.reasons),JSON.stringify([withPoi ? ['nearby_aisle','parking_poi'] : ['nearby_aisle']]));
    for(const removed of tl.parkingLanes) assert.eq(removed.reasons.length,removed.lines.length,'evidence aligns with removed lines');
  }
});

test('lot lanes: quarry coverage and identity survive rebuilding an already-pruned layer', () => {
  const { L, r: first, by } = build();
  const source = JSON.stringify(by.transportation.parkingLanes);
  const signature = result => Array.from(result.zone.coverage, slot => {
    const anchor = result.zone.anchors[slot - 1];
    return anchor ? `${anchor.kind}:${anchor.key}:${anchor.variant}` : '-';
  }).join('|');
  const before = signature(first);
  const second = WorldGen.rasterizeTile(L, CPE, 0, 0, TILE_EDGE_M);
  assert.eq(signature(second), before, 'source identity and covered cells survive a second build');
  assert.eq(JSON.stringify(by.transportation.parkingLanes), source, 'rebuild neither duplicates nor mutates the removed source');
  assert.eq(Array.from(second.roadMask).join(','), Array.from(first.roadMask).join(','), 'removed lanes remain absent on rebuild');
});
test('lot lanes: quarry ground and dressing preserve original cave entrances', () => {
  const quarrySteps = ZoneCoverage.quarrySteps;
  let before;
  try {
    ZoneCoverage.quarrySteps = function* ({field}) { return field; };
    before = build().r;
  } finally { ZoneCoverage.quarrySteps = quarrySteps; }
  const after = build().r;
  const source = result => result.zone?.caveSource || result.caveSource || result;
  assert.eq(Array.from(source(after).grid).join(','), Array.from(source(before).grid).join(','), 'new rocky paint is excluded from cave substrate');
  assert.eq(source(after).objects.map(o=>o.id).join(','), source(before).objects.map(o=>o.id).join(','), 'new quarry dressing does not replace original cave occupancy');
  const entrances = result => {
    const entry = {...result, objects:result.objects.slice(), cellsPerEdge:CPE, tileEdgeM:TILE_EDGE_M};
    WorldGen.maybePlaceCaveEntrance(entry,0,0,TILE_EDGE_M,result.objects,result.wildplants);
    return entry.objects.filter(o=>o.kind === 'staircase' && o.zoneLayer !== 'entrance').map(o=>`${o.id}:${o.x},${o.y}`).join('|');
  };
  assert.eq(entrances(after), entrances(before), 'existing mine mouths keep their positions and IDs');
});
})();

(function () {
  const spine = [{x:0,y:120},{x:150,y:120}];
  const row = x => [{x,y:120},{x,y:55}];
  function fixture(rows = [row(30), row(50), row(70)], tags = {class:'service'}) {
    return { transportation: {extent:4096,features:[
      {id:900,type:2,tags:{class:'service'},geom:[spine]},
      {id:901,type:2,tags,geom:rows},
    ]}};
  }
  function prune(by) { const it=WorldGen.pruneLotLanesSteps(by,1); let s; while(!(s=it.next()).done); return s.value; }
  test('lot lanes: three substantial rows sharing an access spine need no parking POI', () => {
    const by=fixture();
    const cut=prune(by);
    assert.eq(cut.length,1);
    assert.eq(cut[0].lines.length,3);
    assert.eq(JSON.stringify(cut[0].reasons),JSON.stringify([['connected_rows'],['connected_rows'],['connected_rows']]));
    assert.eq(by.transportation.features.length,1);
    assert.eq(by.transportation.features[0].id,900,'access spine remains a road');
    assert.eq(by.transportation.parkingLanes[0].lines.length,3,'rows remain quarry evidence');
    assert.eq(prune(by).length,0,'repeat is idempotent');
  });
  test('lot lanes: row comb preserves explicit driveways, short stubs and disconnected parallels', () => {
    for(const tags of [{class:'service',service:'driveway'},{class:'service',service:'alley'}]) {
      assert.eq(prune(fixture(undefined,tags)).length,0,'explicit service subtype survives');
    }
    assert.eq(prune(fixture([row(30),row(50)])).length,0,'two driveways prove no lot');
    assert.eq(prune(fixture([30,50,70].map(x=>[{x,y:120},{x,y:100}]))).length,0,'short courtyard stubs survive');
    assert.eq(prune(fixture([30,50,70].map(x=>[{x,y:110},{x,y:45}]))).length,0,'parallel rows must touch a common spine');
    assert.eq(prune(fixture([row(20),row(60),row(100)])).length,0,'widely separated access roads survive');
  });
  test('lot lanes: distinct combs on one access spine have stable geometry-owned groups', () => {
    const rows=[10,30,50,100,120,140].map(row);
    const first=fixture(rows), second=fixture(rows.map(points=>points.slice().reverse()).reverse());
    second.transportation.features.reverse();
    for (const f of second.transportation.features) f.id+=20;
    const a=prune(first), b=prune(second);
    const groups=a.flatMap(record=>record.lineGroups.flat());
    assert.eq(new Set(groups).size,2,'one long access spine does not merge distinct lots');
    for (const key of new Set(groups)) assert.eq(groups.filter(value=>value===key).length,3);
    assert.eq(JSON.stringify(groups.slice().sort()),JSON.stringify(b.flatMap(record=>record.lineGroups.flat()).sort()),'feature order/id, line order and direction do not affect groups');
    const stored=JSON.stringify(first.transportation.parkingLanes);
    prune(first);
    assert.eq(JSON.stringify(first.transportation.parkingLanes),stored,'group evidence survives repeat pruning');
  });
  test('lot lanes: a comb preserves unrelated lines merged into the same feature', () => {
    const unrelated=[{x:200,y:120},{x:200,y:55}];
    const by=fixture([row(30),row(50),row(70),unrelated]);
    prune(by);
    assert.eq(by.transportation.features.find(f=>f.id===901).geom.length,1);
    assert.eq(by.transportation.features.find(f=>f.id===901).geom[0],unrelated);
  });
  test('lot lanes: opposing, staggered and bent branches do not make a parking comb', () => {
    const opposite=[{x:70,y:120},{x:70,y:185}];
    assert.eq(prune(fixture([row(30),row(50),opposite])).length,0);
    const by=fixture([row(30),row(50),[{x:70,y:100},{x:70,y:35}]]);
    by.transportation.features[0].geom=[[{x:0,y:120},{x:50,y:120},{x:70,y:100},{x:160,y:100}]];
    assert.eq(prune(by).length,0,'poor longitudinal overlap is not a comb');
    assert.eq(prune(fixture([row(30),row(50),[{x:70,y:120},{x:85,y:90},{x:70,y:55}]])).length,0);
  });
})();

(function () {
  const hairpin=[{x:100,y:0},{x:100,y:145},{x:64,y:145},{x:64,y:70}];
  const centre=[{x:82,y:145},{x:82,y:0}];
  const access=[{x:20,y:70},{x:130,y:70}];
  function fixture(u=hairpin, middle=centre, subtype) {
    return {transportation:{extent:4096,features:[
      {id:910,type:2,tags:{class:'service',...(subtype?{service:subtype}:{})},geom:[u,middle]},
      {id:911,type:2,tags:{class:'service'},geom:[access]},
    ]}};
  }
  function prune(by) {const it=WorldGen.pruneLotLanesSteps(by,1); let s; while(!(s=it.next()).done); return s.value;}
  test('lot lanes: a substantial parking hairpin with a matching middle row needs no parking POI', () => {
    const by=fixture(), cut=prune(by);
    assert.eq(cut.length,1);
    assert.eq(cut[0].lines.length,2,'both the U and its middle row disappear');
    assert.eq(JSON.stringify(cut[0].reasons),JSON.stringify([['parking_hairpin'],['parking_hairpin']]));
    assert.eq(by.transportation.features.length,1);
    assert.eq(by.transportation.features[0].id,911,'separate access survives');
    assert.eq(by.transportation.parkingLanes[0].lines.length,2);
    assert.eq(prune(by).length,0);
  });
  test('lot lanes: a parking hairpin and its middle row share a stable declared group', () => {
    const a=prune(fixture()), b=prune(fixture(hairpin.slice().reverse(),centre.slice().reverse()));
    assert.eq(a[0].lineGroups.length,2);
    assert.eq(a[0].lineGroups[0].length,1);
    assert.eq(a[0].lineGroups[0][0],a[0].lineGroups[1][0]);
    assert.eq(JSON.stringify(a[0].lineGroups),JSON.stringify(b[0].lineGroups),'reversing geometry preserves membership');
  });
  test('lot lanes: hairpin evidence requires a connected interior row matching the far extent', () => {
    for (const middle of [
      [{x:82,y:140},{x:82,y:0}], // detached from crossbar
      [{x:82,y:145},{x:82,y:60}], // too short to match the long leg
      [{x:110,y:145},{x:110,y:0}], // outside the hairpin
      [{x:82,y:145},{x:95,y:0}], // central row approaches the outer leg
      [{x:82,y:145},{x:82,y:-20}], // continues beyond the lot
    ]) assert.eq(prune(fixture(hairpin,middle)).length,0);
    const noMiddle=fixture(); noMiddle.transportation.features[0].geom=[hairpin];
    assert.eq(prune(noMiddle).length,0,'an ordinary U-shaped road alone remains');
  });
  test('lot lanes: explicit driveways and irregular U-shaped access routes survive hairpin inference', () => {
    for (const subtype of ['driveway','alley']) assert.eq(prune(fixture(hairpin,centre,subtype)).length,0);
    const bent=[{x:100,y:0},{x:100,y:145},{x:64,y:145},{x:40,y:70}];
    assert.eq(prune(fixture(bent)).length,0,'outer legs must be parallel');
    const wide=[{x:130,y:0},{x:130,y:145},{x:64,y:145},{x:64,y:70}];
    assert.eq(prune(fixture(wide)).length,0,'an access loop wider than a parking lot remains');
  });
})();
