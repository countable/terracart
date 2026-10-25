(function () {
  const N = 40, cellM = 7, edge = N * cellM, homeM = { x: -5000, y: 0 };
  function fixture(side) {
    let cx = 140, cy = 140;
    for (let x = 10; x < 30; x++) {
      const rng = WorldGen.makeRng(Lairs.hashKey(Lairs.structureKey(0, 0, x, 20)));
      if (rng() >= Lairs.occupancyFor(9)) continue;
      const strength = rng();
      if (Lairs.groupFor(9, strength, rng, true)) continue;
      cx = x * cellM; break;
    }
    const h = 14, ring = new Float32Array([cx-h,cy-h,cx+h,cy-h,cx+h,cy+h,cx-h,cy+h]);
    const shape = { key: 'frontage-house', tier: 9, ring, areaM2: 4*h*h };
    const entry = { cellsPerEdge:N, tileEdgeM:edge, grid:new Uint8Array(N*N),
      buildingShapes:[shape], objects:[], roadMask:new Uint8Array(N*N), spawnWhy:new Uint32Array(N*N) };
    for (let y=0;y<N;y++) for(let x=0;x<N;x++)
      if (Math.abs((x+.5)*cellM-cx)<h && Math.abs((y+.5)*cellM-cy)<h) entry.grid[y*N+x]=WorldGen.T.BUILDING_SMALL;
    entry._spawnOpts={roadMask:entry.roadMask,spawnWhy:entry.spawnWhy};
    const normal = {east:[1,0],west:[-1,0],south:[0,1],north:[0,-1]}[side];
    if (normal) {
      const at={x:cx+normal[0]*(h+21),y:cy+normal[1]*(h+21)};
      const line=normal[0] ? [{x:at.x,y:cy-50},{x:at.x,y:cy+50}] : [{x:cx-50,y:at.y},{x:cx+50,y:at.y}];
      entry.layers=[{name:'transportation',extent:edge,features:[{type:2,id:1,tags:{class:'minor'},geom:[line]}]}];
    }
    const cand=[...Lairs.buildIndex(entry,0,0,cellM,edge).buckets.values()].flat()[0];
    return {entry,cand,cx,cy,h,normal};
  }
  const wake = f => Lairs.garrisonFor(f.entry,f.cand,{tileEdgeM:edge,homeM});
  test('guard frontage: shared door side seats guards ahead of all four facades', () => {
    const original=BuildingLowPoly.streetDoor; let calls=0;
    BuildingLowPoly.streetDoor=(...args)=>{calls++;return original(...args);};
    try {
      for(const side of ['east','west','south','north']) {
        const f=fixture(side), guards=wake(f);
        assert.gt(guards.length,0,side+' has a legal frontage guard');
        for(const g of guards) {
          const outward=(g.x-f.cx)*f.normal[0]+(g.y-f.cy)*f.normal[1];
          assert.gt(outward,f.h,side+' is beyond its doorway wall');
          assert.lte(outward,f.h+21,side+' stays on this side of the street');
        }
        assert.eq(JSON.stringify(guards),JSON.stringify(wake(f)),'repeated wakes are deterministic');
      }
      assert.eq(calls,4,'each facade asks the shared doorway selector once across repeated wakes');
    } finally { BuildingLowPoly.streetDoor=original; }
  });
  test('guard frontage: tile streets are shared and rebuilt geometry chooses a fresh doorway', () => {
    const streetDoor=BuildingLowPoly.streetDoor, transportLines=RoadOverlay.transportLines;
    let doors=0, streets=0;
    BuildingLowPoly.streetDoor=(...args)=>{doors++;return streetDoor(...args);};
    RoadOverlay.transportLines=function* (...args){streets++;yield* transportLines(...args);};
    try {
      const f=fixture('east'), first=wake(f);
      assert.gt(first.length,0);
      assert.eq(JSON.stringify(wake(f)),JSON.stringify(first),'cached doorway preserves guard identities and seats');
      assert.eq(doors,1,'repeat wake reuses doorway geometry');
      assert.eq(streets,1,'repeat wake reuses street conversion');
      const other={...f,cand:{...f.cand,shape:{...f.cand.shape}}};
      assert.eq(JSON.stringify(wake(other)),JSON.stringify(first),'another footprint uses identical source streets');
      assert.eq(doors,2,'another shape selects its own doorway');
      assert.eq(streets,1,'another shape shares the tile street conversion');
      const west=fixture('west'), expected=wake(west);
      f.entry.layers=west.entry.layers;
      assert.eq(JSON.stringify(wake(f)),JSON.stringify(expected),'replacing source geometry invalidates cached streets and doorway');
      assert.eq(doors,4);
      assert.eq(streets,3);
    } finally {
      BuildingLowPoly.streetDoor=streetDoor; RoadOverlay.transportLines=transportLines;
    }
  });
  test('guard frontage: blocked front never relocates guards behind the house', () => {
    const f=fixture('east'), guards=wake(f);
    assert.gt(guards.length,0);
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if((x+.5)*cellM>f.cx+f.h)
      f.entry.spawnWhy[y*N+x]=WorldGen.SPAWN_WHY.RESTRICTED;
    assert.eq(wake(f).length,0,'legal rear ground cannot replace an excluded frontage');
    f.entry.spawnWhy.fill(0);
    assert.eq(JSON.stringify(wake(f)),JSON.stringify(guards),'removing the exclusion restores stable identities and seats');
  });
  test('guard frontage: batch occupancy matches fresh checks and ordinary wakes observe live objects', () => {
    const f=fixture('east');
    f.entry.genObjects=[];
    const first=wake(f);
    assert.gt(first.length,0);
    f.entry.objects=first.map(g=>({kind:'rock',x:g.seatX,y:g.seatY}));
    const liveOccupied=Lairs.liveOccupiedFor(f.entry,0,0,edge);
    const batch=Lairs.garrisonFor(f.entry,f.cand,{tileEdgeM:edge,homeM,liveOccupied});
    assert.eq(batch.length,0,'live objects claim all generated guard seats');
    assert.eq(JSON.stringify(batch),JSON.stringify(wake(f)),'batch snapshot matches ordinary live occupancy checks');
    f.entry.objects=[];
    assert.eq(JSON.stringify(wake(f)),JSON.stringify(first),'ordinary wake observes removed live objects without rerolling seats');
  });
  test('guard frontage: fort and castle formations keep their existing seats', () => {
    for (const tier of [11,12]) {
      const f=fixture('east');
      f.cand.tier=tier; f.cand.shape.tier=tier;
      if(tier===12) f.cand.key=f.cand.shape.key='citadel';
      const guards=wake(f);
      assert.gt(guards.length,0,'held keep has a formation');
      delete f.entry.layers;
      assert.eq(JSON.stringify(wake(f)),JSON.stringify(guards),'street direction does not move keep formations');
    }
  });
  test('guard frontage: road masks still refuse a detected front', () => {
    const f=fixture('south');
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if((y+.5)*cellM>f.cy+f.h)f.entry.roadMask[y*N+x]=1;
    assert.eq(wake(f).length,0,'doorway selection never overrides the road spawn gate');
  });
})();
