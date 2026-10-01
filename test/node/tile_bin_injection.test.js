// Cached decoration must not change the generated layer caves derive from,
// or mutate a bin shared by later builds and other world frames.
(function () {
  const N = 32;
  const T = WorldGen.T;
  function entry(cellM = 7) {
    const grid = new Uint8Array(N * N).fill(T.GRASS);
    return { cellsPerEdge: N, tileEdgeM: N * cellM, grid,
      roadMask: new Uint8Array(N * N), objects: [], wildplants: [],
      parkingTreasures: [], roadLabels: {}, baseGrid: grid.slice(), genObjects: [] };
  }
  const point = (ix, iy, cellM = 7) => ({ x: (ix + 0.5) * cellM, y: (iy + 0.5) * cellM });

  test('tile bin: cached rows survive relocation and reuse in a different world frame', () => {
    const bin = { trees: [
      { kind: 'tree', id: 'tree_osm_3', lix: 10, liy: 10, crown_m: 3 },
      { kind: 'tree', id: 'tree_osm_8', lix: 10, liy: 10, crown_m: 8 },
    ] };
    const before = JSON.stringify(bin);
    for (const cellM of [7, 9]) {
      const e = entry(cellM);
      e.roadMask[10 * N + 10] = 1;
      WorldGen.injectTileBin(e, bin, 0, 0);
      assert.eq(e.objects.length, 2);
      assert.eq(e.objects[0].crown_m, 8, 'largest crown wins first choice');
      assert.eq(e.objects[0].x, point(11, 10, cellM).x, 'first free neighbour east');
      assert.eq(e.objects[1].x, point(9, 10, cellM).x, 'next tree takes west');
      assert.eq(e.objects[0].id, 'tree_osm_8');
      assert.eq(e.objects[1].id, 'tree_osm_3');
      assert.eq(JSON.stringify(bin), before, 'shared bin remains unchanged');
    }
  });

  test('tile bin: destinations displace scenery but cannot displace structures', () => {
    const e = entry();
    const rock = { kind: 'mineralrock', id: 'rock', ...point(5, 5) };
    const house = { kind: 'house', id: 'house', ...point(20, 20) };
    e.objects.push(rock, house);
    e.wildplants.push({ id: 'grass', crop: 'shrub', ...point(5, 5) });
    e.genObjects = e.objects.slice();
    WorldGen.injectTileBin(e, { chests: [
      { kind: 'chest', id: 'destination', poiClass: 'bus', lix: 5, liy: 5 },
      { kind: 'chest', id: 'blocked', poiClass: 'bus', lix: 20, liy: 20 },
    ], poles: [{ kind: 'pole', id: 'late-pole', lix: 5, liy: 5 }] }, 0, 0);
    assert.eq(e.objects.map(o => o.id).join(','), 'house,destination');
    assert.eq(e.wildplants.length, 0, 'displaced plants are removed');
    assert.eq(e.genObjects.length, 2, 'generated snapshots keep original scenery');
    assert.eq(e.genObjects[0], rock);
    assert.eq(e.genObjects[1], house);
  });

  test('tile bin: a well repaints live road terrain without changing the cave source', () => {
    const e = entry();
    const idx = 10 * N + 10;
    e.grid[idx] = T.ROAD;
    e.baseGrid = e.grid.slice();
    e.roadLabels['10_10'] = 'Old Road';
    const bin = { wells: [{ kind: 'well', id: 'fountain', lix: 10, liy: 10 }] };
    WorldGen.injectTileBin(e, bin, 0, 0);
    assert.eq(e.objects[0].id, 'fountain');
    assert.eq(e.grid[idx], T.GRASS);
    assert.eq(e.baseGrid[idx], T.ROAD);
    assert.eq(e.genObjects.length, 0);
    assert.eq(e.roadLabels['10_10'], undefined);
    assert.eq(bin.wells[0].lix, 10);
    assert.eq(bin.wells[0].x, undefined);
  });
  test('tile bin: disabled detected timber and fruit trees leave road and zone layouts intact', () => {
    for (const cellM of [7, 9]) for (const owner of ['street', 'zone']) {
      const e = entry(cellM), cell = 10 * N + 10, here = point(10, 10, cellM), away = point(15, 15, cellM);
      if (owner === 'street') e.streetArea = new Uint8Array(N*N).fill(1);
      else {
        const under = new Uint8Array(N*N);
        under.present = new Uint8Array(N*N);under.present[cell]=1;
        e.zone = {coverage:new Uint16Array(N*N).fill(1),under};
        e.grid[cell] = T.ROCK; // decorative paint must preserve a detected tree on grass (code 0)
      }
      const dress = {objects:[{kind:'tree',id:'authored-tree',...here}],
        wildplants:[{crop:'shrub',id:'authored-plant',...here},{crop:'shrub',id:'keep',...away}],
        traps:[{id:'trap',...here}],guards:[{id:'plant',...here}, {id:'guard',...away,homeX:here.x,homeY:here.y}],
        coins:[{id:'coin',...here}],treasures:[{id:'treasure',...here}],
        lairs:[{sid:'lair',lx:here.x,ly:here.y},{sid:'keep-lair',lx:away.x,ly:away.y}],
        marks:new Uint8Array(N*N).fill(1),slowCells:new Map([[cell,'tar']])};
      e[owner === 'street' ? 'streetDress' : 'zoneDress'] = dress;
      const generatedRock = {kind:'mineralrock',id:'street-rock',_street:'rocks',...here};
      e.objects.push(generatedRock);e.genObjects=e.objects.slice();
      const bin={trees:[{kind:'tree',lix:10,liy:10,crown_m:8}],
        fruittrees:[{kind:'fruittree',lix:20,liy:20,_treeSource:'deepforest'}]};
      const before=JSON.stringify(bin), originalDress=JSON.stringify(dress);
      WorldGen.injectTileBin(e,bin,0,0);
      assert.eq(e.objects.length,1);
      assert.eq(e.objects[0],generatedRock,'existing scenery stays in place');
      assert.eq(JSON.stringify(dress),originalDress,'detected trees cannot evict variant pieces');
      assert.eq(e.genObjects[0],generatedRock,'cave snapshot is unchanged');
      assert.eq(JSON.stringify(bin),before,'cached source rows are not mutated');
    }
  });

  test('tile bin: disabled detections stay out of ordinary ground, including legacy cached bins', () => {
    const e=entry();
    const bin={trees:[
      {kind:'tree',lix:5,liy:5,_treeSource:'deepforest'},
      {kind:'tree',lix:10,liy:10,crown_m:8},
      {kind:'tree',lix:15,liy:15,size:'large'},
      {kind:'tree',lix:20,liy:20,individual:true},
      {kind:'tree',id:'tree_osm_123',lix:25,liy:25,individual:true},
    ],fruittrees:[{kind:'fruittree',lix:5,liy:20,_treeSource:'deepforest'}]};
    const before=JSON.stringify(bin);
    WorldGen.injectTileBin(e,bin,0,0);
    assert.eq(e.objects.length,1);
    assert.eq(e.objects[0].id,'tree_osm_123','mapped OSM trees remain enabled');
    assert.eq(JSON.stringify(bin),before,'source data remains available for re-enabling');
  });

  test('tile bin: disabled detections preserve authored footprints and neighbours', () => {
    const e=entry();e.zone={coverage:new Uint16Array(N*N).fill(1)};
    e.zoneDress={objects:[{kind:'tar',id:'wide',_footprintCells:{width:3,height:1},...point(9,10)},
      {kind:'tree',id:'neighbour',...point(12,10)}],wildplants:[]};
    WorldGen.injectTileBin(e,{trees:[{kind:'tree',lix:10,liy:10,crown_m:8}]},0,0);
    assert.eq(e.zoneDress.objects.map(o=>o.id).join(),'wide,neighbour');
  });

})();
