// Boundary behavior is part of the deterministic world/save contract.
test('weighted selection: loot and creature adapters preserve exact boundaries', () => {
  const items = [{ weight: 0 }, { weight: 1 }, { weight: 1 }, { weight: 0 }];
  const weight = row => row.weight;
  let draws = 0;
  assert.eq(weightedPickBy(items, weight, () => { draws++; return .5; }), items[1]);
  assert.eq(draws, 1);
  assert.eq(CreatureSpawns.pickWeighted(items, .5, weight), items[2]);
  assert.eq(weightedPickAt(items, weight, .5), items[2]);
  assert.eq(weightedPickBy(items, weight, () => 0), items[1], 'zero weight is never drawn');
  assert.eq(CreatureSpawns.pickWeighted(items, -1, weight), items[1], 'creature roll clamps low');
  assert.eq(CreatureSpawns.pickWeighted(items, 2, weight), items[2], 'creature roll clamps high');
  assert.eq(weightedPickBy(items, weight, () => 1), items[2], 'loot retains last positive weight');
});

test('weighted selection: empty pools do not consume RNG and adapters retain zero-weight rules', () => {
  let draws = 0;
  const rng = () => { draws++; return .5; }, items = [{ weight: 0 }, { weight: 0 }];
  assert.eq(weightedPickBy([], row => row.weight, rng), null);
  assert.eq(weightedPickBy(items, row => row.weight, rng), null);
  assert.eq(draws, 0);
  assert.eq(weightedPickAt(items, row => row.weight, .5), null);
  assert.eq(CreatureSpawns.pickWeighted(items, .5, row => row.weight), items[0]);
  assert.eq(CreatureSpawns.pickWeighted([], .5), null);
});

test('polygon geometry: visibility and world containment agree on edges, concavity and holes', () => {
  const ring = [{x:0,y:0},{x:8,y:0},{x:8,y:2},{x:2,y:2},{x:2,y:8},{x:0,y:8}];
  for (const [x,y,inside] of [[1,1,true],[5,1,true],[1,5,true],[5,5,false],[0,0,true],[8,1,false]]) {
    assert.eq(PolygonGeometry.pointInRings([ring], x, y), inside);
    assert.eq(WorldGen.pointInRings([ring], x, y), inside);
    assert.eq(Render.pointInBuilding({x,y}, ring), inside);
    assert.eq(Render.pointInBuilding({x,y}, [...ring].reverse()), inside);
  }
  const hole = [{x:.5,y:.5},{x:1.5,y:.5},{x:1.5,y:1.5},{x:.5,y:1.5}];
  assert.falsy(WorldGen.pointInRings([ring,hole], 1, 1));
  assert.truthy(WorldGen.pointInRings([ring,hole], 1, 5));
});

test('polygon geometry: ear clipping covers concave footprints and preserves input vertices', () => {
  const ring = [{x:0,y:0},{x:4,y:0},{x:8,y:0},{x:8,y:2},{x:2,y:2},{x:2,y:8},{x:0,y:8}];
  const area = points => Math.abs(points.reduce((sum,p,i) => {
    const q = points[(i+1)%points.length]; return sum + p.x*q.y - p.y*q.x;
  }, 0))/2;
  const before = JSON.stringify(ring);
  for (const input of [ring, [...ring].reverse()]) {
    const mesh = BuildingLowPoly.triangulate(input);
    assert.eq(mesh.ring.length, 6, 'collinear midpoint is removed');
    assert.eq(mesh.triangles.length, 4);
    assert.eq(mesh.triangles.reduce((sum,triangle) => sum + area(triangle), 0), area(ring));
    for (const triangle of mesh.triangles) {
      const center = {x:triangle.reduce((n,p)=>n+p.x,0)/3, y:triangle.reduce((n,p)=>n+p.y,0)/3};
      assert.truthy(PolygonGeometry.pointInRings([ring], center.x, center.y), 'no face spans the concave notch');
      assert.truthy(triangle.every(p => mesh.ring.includes(p)));
    }
  }
  assert.eq(JSON.stringify(ring), before, 'building adapter leaves source footprint untouched');
  assert.eq(PolygonGeometry.triangulate(Array.from({length:4}, () => ({x:0,y:0}))).length, 0,
    'failed ear selection never returns a partial mesh');
});

test('polygon geometry: cell union integrates crossing edges, clipped strips and concave footprints exactly', () => {
  const ring = points => points.map(([x,y])=>({x,y}));
  const a=ring([[0,0],[1,0],[0,1]]), b=ring([[0,0],[1,0],[1,1]]);
  const area=(rings,expected)=>assert.inRange(PolygonGeometry.unionAreaInCell(rings,0,0),expected-1e-12,expected+1e-12);
  area([a,b],.75);
  area([b,a,a],.75);
  area([a,[...b].reverse()],.75);
  area([ring([[-1,.45],[2,.45],[2,.55],[-1,.55]])],.1);
  const concave=ring([[-1,0],[1,0],[1,.1],[-.5,.1],[-.5,.9],[1,.9],[1,1],[-1,1]]);
  area([concave],.2);
  area([concave,ring([[.4,-1],[.5,-1],[.5,2],[.4,2]])],.28);
});
