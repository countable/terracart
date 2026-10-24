// Review-only source geometry: these tests exercise traffic/access decisions,
// not the game's painted terrain or current spawn generation.
(function () {
  const N=40,edge=280;
  const point=(x,y)=>({x,y});
  const line=(klass,pts,tags={})=>({type:2,tags:{class:klass,...tags},geom:[pts.map(p=>point(...p))]});
  const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]].map(p=>point(...p));
  const polygon=(klass,rings,tags={})=>({type:3,tags:{class:klass,...tags},geom:rings});
  const layer=(name,features)=>({name,extent:edge,features});
  const entry=(layers=[],tx=0)=>({tx,ty:0,cellsPerEdge:N,tileEdgeM:edge,layers,spawnWhy:new Uint16Array(N*N),grid:new Uint8Array(N*N).fill(WorldGen.T.GRASS)});
  const run=e=>GameplayTiers.build({tiles:[e]});
  const at=(r,x,y)=>r.tiles[0].tiers[Math.floor(y/7)*N+Math.floor(x/7)];
  test('gameplay tiers: unmapped grass is excluded; source park and woodland are distinct',()=>{
    const e=entry([layer('landcover',[polygon('grass',[rect(0,0,100,280)]),polygon('wood',[rect(100,0,180,280)])]),layer('landuse',[polygon('park',[rect(0,0,70,280)])])]);
    const r=run(e);
    assert.eq(at(r,35,35),1);assert.eq(at(r,84,35),2);assert.eq(at(r,140,35),2);assert.eq(at(r,245,35),4);
    assert.eq(r.stats.cells.reduce((a,b)=>a+b,0),N*N);
  });
  test('gameplay tiers: transportation area holes and recreation-ground landcover survive',()=>{
    const e=entry([layer('transportation',[polygon('pedestrian',[rect(0,0,140,140),rect(35,35,70,70)])]),layer('landcover',[polygon('grass',[rect(140,0,280,140)],{subclass:'recreation_ground'})])]);
    const r=run(e);assert.eq(at(r,14,14),1);assert.eq(at(r,49,49),4);assert.eq(at(r,210,49),1);
  });
  test('gameplay tiers: OMT path subclasses include plazas, cycling and platforms in core',()=>{
    const e=entry([layer('transportation',[polygon('path',[rect(0,0,140,100)],{subclass:'pedestrian'}),polygon('path',[rect(140,0,280,100)],{subclass:'footway'}),line('path',[[0,140],[280,140]],{subclass:'cycleway'}),line('path',[[0,210],[280,210]],{subclass:'platform'})])]);
    const r=run(e);assert.eq(at(r,35,35),1);assert.eq(at(r,210,35),1);assert.eq(at(r,140,140),1);assert.eq(at(r,140,210),1);
  });
  test('gameplay tiers: golf and allotments are not generic grassland destinations',()=>{
    const e=entry([layer('landcover',[polygon('grass',[rect(0,0,140,280)],{subclass:'golf_course'}),polygon('grass',[rect(140,0,280,280)],{subclass:'allotments'})])]);
    const r=run(e);assert.eq(at(r,35,35),4);assert.eq(at(r,210,35),4);
  });
  test('gameplay tiers: recognized park-family reserves are core; broad protected areas remain unknown',()=>{
    const e=entry([layer('park',[polygon('nature_reserve',[rect(0,0,70,280)]),polygon('national_park',[rect(70,0,140,280)]),polygon('protected_area',[rect(140,0,280,280)])])]);
    const r=run(e);assert.eq(at(r,35,35),1);assert.eq(at(r,105,35),1);assert.eq(at(r,210,35),4);
  });
  test('gameplay tiers: major street surface is excluded but its three-cell buffer is passing',()=>{
    const e=entry([layer('landuse',[polygon('park',[rect(0,0,280,280)])]),layer('transportation',[line('primary',[[0,140],[280,140]])])]);
    e.spawnWhy[20*N+20]=WorldGen.SPAWN_WHY.ROAD|WorldGen.SPAWN_WHY.KERB;
    const r=run(e);assert.eq(at(r,140,140),4);assert.eq(at(r,140,161),3);assert.eq(at(r,140,175),1);
  });
  test('gameplay tiers: major street surface excludes crossing paths',()=>{
    const e=entry([layer('transportation',[line('primary',[[0,140],[280,140]]),line('footway',[[140,0],[140,280]])])]);
    const r=run(e);assert.eq(at(r,140,140),4);assert.eq(at(r,70,140),4);assert.eq(at(r,140,42),1);
  });
  test('gameplay tiers: walking paths buffer one cell, including across tile edges, without overriding exclusions',()=>{
    const e=entry([layer('transportation',[line('footway',[[0,143.5],[280,143.5]]),line('footway',[[-3,0],[-3,70]])]),
      layer('building',[polygon('building',[rect(70,140,105,168)])])]);
    const r=run(e);assert.eq(at(r,140,147),1);assert.eq(at(r,140,154),4);
    assert.eq(at(r,3,35),1);assert.eq(at(r,84,154),4);
  });
  test('gameplay tiers: parallel path leaves the major road corridor passing',()=>{
    const e=entry([layer('transportation',[line('primary',[[0,140],[280,140]]),line('footway',[[0,126],[98,126]])])]);
    const r=run(e);assert.eq(at(r,35,140),4);assert.eq(at(r,224,140),4);assert.eq(at(r,35,126),1);
  });
  test('gameplay tiers: explicit sidewalks do not exempt a medium street surface',()=>{
    const e=entry([layer('transportation',[line('secondary',[[0,140],[280,140]],{sidewalk:'both'})])]);
    assert.eq(at(run(e),140,140),4);
  });
  test('gameplay tiers: retained parking lanes and parking polygons take precedence over parks',()=>{
    const transport=layer('transportation',[]);
    transport.parkingLanes=[{f:{tags:{class:'service'}},lines:[[point(35,140),point(245,140)]]}];
    const e=entry([layer('landuse',[polygon('park',[rect(0,0,280,280)]),polygon('parking',[rect(0,0,70,70)])]),transport]);
    const r=run(e);assert.eq(at(r,35,35),3);assert.eq(at(r,140,140),3);assert.eq(at(r,140,210),1);
  });
  test('gameplay tiers: private, source buildings and game access vetoes override proposed core',()=>{
    const e=entry([layer('landuse',[polygon('park',[rect(0,0,280,280)]),polygon('park',[rect(0,0,70,70)],{access:'private'})]),layer('building',[polygon('building',[rect(70,0,140,70)])])]);
    e.spawnWhy[20*N+20]=WorldGen.SPAWN_WHY.PRIVATE;
    const r=run(e);assert.eq(at(r,35,35),4);assert.eq(at(r,105,35),4);assert.eq(at(r,140,140),4);assert.eq(at(r,210,210),1);
  });
  test('gameplay tiers: permit and restricted pedestrian access cannot be core destinations',()=>{
    const e=entry([layer('landuse',[polygon('park',[rect(0,0,140,280)],{access:'permit'}),polygon('park',[rect(140,0,280,280)],{foot:'customers'})])]);
    const r=run(e);assert.eq(at(r,35,35),4);assert.eq(at(r,210,35),4);
  });
  test('gameplay tiers: only demonstrated residential dead ends drop to Tier 3',()=>{
    const e=entry([layer('transportation',[line('minor',[[0,140],[280,140]]),line('minor',[[140,140],[140,224]])])]);
    const r=run(e);assert.eq(at(r,35,140),2);assert.eq(at(r,140,210),3);
    const clipped=entry([layer('transportation',[line('minor',[[0,140],[280,140]])])]);
    assert.eq(at(run(clipped),140,140),2);
  });
  test('gameplay tiers: cycling and tracks are core with other mapped paths',()=>{
    const e=entry([layer('transportation',[line('cycleway',[[0,35],[280,35]]),line('track',[[0,140],[280,140]]),line('footway',[[0,245],[280,245]])])]);
    const r=run(e);assert.eq(at(r,140,35),1);assert.eq(at(r,140,140),1);assert.eq(at(r,140,245),1);
  });
  test('gameplay tiers: lot safety coverage is passing; Old Stones and absorbed lots are calm',()=>{
    const e=entry();
    e.roadClass=new Uint8Array(N*N).fill(WorldGen.ROAD_CLASS_LOT_BUFFER);
    e.zone={anchors:[{kind:'stones'}],coverage:new Uint16Array(N*N)};
    e.zone.coverage[10*N+9]=1;
    e.roadClass[10*N+9]=0;
    e.zone.coverage[10*N+10]=1;
    e.zone.coverage[10*N+11]=1;
    e.spawnWhy[10*N+11]=WorldGen.SPAWN_WHY.PRIVATE;
    const r=run(e);
    assert.eq(at(r,140,140),3);
    assert.eq(at(r,63,70),2);
    assert.eq(at(r,70,70),2);
    assert.eq(at(r,77,70),4);
    assert.eq(r.stats.cells[0],0);
    assert.eq(GameplayTiers.TIERS.some(t=>t.id===0),false);
  });
  test('gameplay tiers: street surfaces override paths, parking and Old Stones',()=>{
    for(const [klass,tags,tier] of [['primary',{},4],['secondary',{},4],['minor',{},2],['minor',{noexit:'yes',sidewalk:'both'},3]]) {
      const e=entry([layer('landuse',[polygon('parking',[rect(0,0,280,280)])]),
        layer('transportation',[line(klass,[[0,143.5],[280,143.5]],tags),line('footway',[[143.5,0],[143.5,280]])])]);
      e.zone={anchors:[{kind:'stones'}],coverage:new Uint16Array(N*N).fill(1)};
      const r=run(e);
      assert.eq(at(r,140,140),tier,klass+' surface wins crossing');
      assert.eq(at(r,140,112),1,'path away from street stays core');
      assert.eq(at(r,70,112),2,'Old Stones away from street stays calm');
    }
  });
  test('gameplay tiers: review is deterministic and leaves source geometry and spawn masks unchanged',()=>{
    const e=entry([layer('landuse',[polygon('park',[rect(0,0,280,280)])])]),before=JSON.stringify(e);
    const a=run(e),b=run(e);assert.eq(JSON.stringify(e),before);assert.eq(Array.from(a.tiles[0].tiers).join(','),Array.from(b.tiles[0].tiers).join(','));
    const area=(WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(e.ty)))**2/10000;
    assert.inRange(a.stats.ha.reduce((x,y)=>x+y,0),area-1e-6,area+1e-6);
  });
})();
