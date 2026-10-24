// Shared geographic tier classification and its spawn-class policy.
(function () {
  const N=40,edge=280;
  const point=(x,y)=>({x,y});
  const line=(klass,pts,tags={})=>({type:2,tags:{class:klass,...tags},geom:[pts.map(p=>point(...p))]});
  const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]].map(p=>point(...p));
  const polygon=(klass,rings,tags={})=>({type:3,tags:{class:klass,...tags},geom:rings});
  const layer=(name,features)=>({name,extent:edge,features});
  const entry=(layers=[],tx=0)=>({tx,ty:0,cellsPerEdge:N,tileEdgeM:edge,layers,spawnWhy:new Uint32Array(N*N),grid:new Uint8Array(N*N).fill(WorldGen.T.GRASS)});
  const run=e=>GameplayTiers.build({tiles:[e]});
  const at=(r,x,y)=>r.tiles[0].tiers[Math.floor(y/7)*N+Math.floor(x/7)];
  test('gameplay tiers: unmapped grass is excluded; source park and woodland are distinct',()=>{
    const e=entry([layer('landcover',[polygon('grass',[rect(0,0,100,280)]),polygon('wood',[rect(100,0,180,280)])]),layer('landuse',[polygon('park',[rect(0,0,70,280)])])]);
    const r=run(e);
    assert.eq(at(r,35,35),1);assert.eq(at(r,84,35),2);assert.eq(at(r,140,35),2);assert.eq(at(r,245,35),4);
    assert.eq(r.stats.cells.reduce((a,b)=>a+b,0),N*N);
  });
  test('gameplay tiers: mapped school grounds qualify without a separate park polygon',()=>{
    for(const klass of ['school','college','university','education']) {
      const e=entry([layer('landuse',[polygon(klass,[rect(0,0,280,280)])]),
        layer('building',[polygon('school',[rect(0,0,70,70)])])]);
      e.spawnWhy[20*N+20]=WorldGen.SPAWN_WHY.KINDERGARTEN;
      const r=run(e);
      assert.eq(at(r,210,210),1,`${klass}: grounds are core`);
      assert.eq(at(r,35,35),4,'school building stays excluded');
      assert.eq(at(r,140,140),4,'kindergarten exclusion stays authoritative');
      e.layers[0].features[0].tags.access='private';
      assert.eq(at(run(e),210,210),4,'explicit private access stays excluded');
    }
    assert.eq(at(run(entry([layer('landuse',[polygon('kindergarten',[rect(0,0,280,280)])])])),210,210),4);
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
  test('gameplay tiers: private, source buildings and game access vetoes override core',()=>{
    const e=entry([layer('landuse',[polygon('park',[rect(0,0,280,280)]),polygon('park',[rect(0,0,70,70)],{access:'private'})]),layer('building',[polygon('building',[rect(70,0,140,70)])])]);
    e.spawnWhy[20*N+20]=WorldGen.SPAWN_WHY.RESTRICTED;
    const r=run(e);assert.eq(at(r,35,35),4);assert.eq(at(r,105,35),4);assert.eq(at(r,140,140),4);assert.eq(at(r,210,210),1);
  });
  test('gameplay tiers: classified ground replaces inferred frontage vetoes but explicit private access remains excluded',()=>{
    const e=entry([layer('landuse',[polygon('parking',[rect(0,0,140,280)]),polygon('park',[rect(140,0,280,280)])]),
      layer('transportation',[line('footway',[[0,143.5],[280,143.5]])])]);
    e.spawnWhy.fill(WorldGen.SPAWN_WHY.PRIVATE|WorldGen.SPAWN_WHY.BEHIND_HOUSE);
    const r=run(e);
    assert.eq(at(r,70,70),3);assert.eq(at(r,210,70),1);assert.eq(at(r,70,140),1);
    e.layers.push(layer('landuse',[polygon('parking',[rect(0,0,140,280)],{access:'private'})]));
    assert.eq(at(run(e),70,70),4);
  });
  test('gameplay tiers: conflicting duplicate path tags retain explicit restrictions regardless of source order',()=>{
    const publicPath=line('footway',[[0,143.5],[280,143.5]]);
    const privatePath=line('footway',[[0,143.5],[280,143.5]],{access:'private'});
    for(const features of [[publicPath,privatePath],[privatePath,publicPath]])
      assert.eq(at(run(entry([layer('transportation',features)])),140,140),4);
  });
  test('gameplay tiers: duplicate street records do not create fictitious junction buffers',()=>{
    const e=entry([layer('transportation',[
      line('minor',[[70,143.5],[210,143.5]],{name:'A'}),
      line('minor',[[70,143.5],[210,143.5]],{name:'B'}),
    ])]);
    assert.eq(at(run(e),70,175),4,'beyond ordinary street buffer remains Excluded');
  });
  test('gameplay tiers: service streets use Small-road calm and dead-end passing rules',()=>{
    for(const [tags,tier] of [[{},2],[{noexit:'yes'},3],[{service:'parking_aisle'},3]]) {
      const e=entry([layer('transportation',[line('service',[[0,143.5],[280,143.5]],tags)])]);
      assert.eq(at(run(e),140,140),tier);
    }
  });
  test('gameplay tiers: public piers are core decks over water; unverified piers and surrounding water remain excluded',()=>{
    const water=layer('water',[polygon('lake',[rect(0,0,280,280)])]);
    for(const [tags,tier] of [[{access:'yes'},1],[{},4],[{access:'private'},4]]) {
      const e=entry([water,layer('transportation',[line('pier',[[0,143.5],[280,143.5]],tags)])]);
      const r=run(e);assert.eq(at(r,140,140),tier);assert.eq(at(r,140,154),4);
    }
    const e=entry([water,layer('transportation',[line('pier',[[0,143.5],[280,143.5]],{foot:'designated'})]),
      layer('building',[polygon('building',[rect(126,126,154,154)])])]);
    assert.eq(at(run(e),140,140),4,'pier cannot reopen a building');
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
    e.spawnWhy[10*N+11]=WorldGen.SPAWN_WHY.RESTRICTED;
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
      assert.eq(at(r,70,105),2,'Old Stones away from street stays calm');
    }
  });
  test('gameplay tiers: nexus footprints classify point-only sites while road buffers retain passing precedence',()=>{
    for(const [kind,tier] of [['grove',1],['beach',1],['stones',2],['tar',2],['quarry',3]]) {
      const e=entry([layer('transportation',[line('primary',[[0,140],[280,140]])])]);
      e.zone={anchors:[{kind}],coverage:new Uint16Array(N*N).fill(1)};
      const r=run(e);
      assert.eq(at(r,70,70),tier,kind+' coverage');
      assert.eq(at(r,70,161),3,kind+' inside passing road buffer');
      assert.eq(at(r,70,140),4,kind+' cannot reopen road surface');
    }
  });
  test('gameplay tiers: intersection passing disk is wider than road buffers and paths interrupt it',()=>{
    const e=entry([layer('landuse',[polygon('park',[rect(0,0,280,280)])]),
      layer('transportation',[line('primary',[[0,140],[280,140]]),line('minor',[[140,0],[140,280]]),
        line('footway',[[0,182],[280,182]])])]);
    e.spawnWhy[24*N+24]=WorldGen.SPAWN_WHY.JUNCTION;
    const r=run(e);
    assert.eq(at(r,161,168),3,'junction extends beyond ordinary road buffer');
    assert.eq(at(r,168,175),1,'path interrupts the passing disk');
    assert.eq(at(r,140,140),4,'major street surface remains excluded');
    assert.eq(at(r,210,210),1,'park beyond junction remains core');
  });
  test('gameplay tiers: grade-separated streets do not create an intersection buffer',()=>{
    const e=entry([layer('landuse',[polygon('park',[rect(0,0,280,280)])]),
      layer('transportation',[line('primary',[[0,140],[280,140]],{brunnel:'bridge'}),line('minor',[[140,0],[140,280]])])]);
    assert.eq(at(run(e),168,168),1);
  });
  test('gameplay tiers: policy makes passing suppress hazards and fast movers without suppressing ordinary finds',()=>{
    for(const cls of ['hazard','streetObstacle','fastEnemy','fastFauna']) assert.eq(GameplayTiers.allowed(3,cls),false,cls);
    for(const cls of ['minor','fauna','enemy','reward','npc']) assert.eq(GameplayTiers.allowed(3,cls),true,cls);
    for(const cls of Object.keys(GameplayTiers.CLASS_TIERS)) {
      assert.eq(GameplayTiers.allowed(1,cls),true,cls+' allowed in core');
      assert.eq(GameplayTiers.allowed(4,cls),false,cls+' forbidden in Excluded');
    }
    assert.eq(GameplayTiers.allowed(1,'unregistered'),false);
    assert.eq(GameplayTiers.allowed(2,'fastEnemy'),false);
  });
  test('gameplay tiers: replay and cleanup retain authored record spawn classes',()=>{
    assert.eq(GameplayTiers.classForRecord({kind:'pressure_plate'}),'hazard');
    assert.eq(GameplayTiers.classForRecord({kind:'stakes'}),'streetObstacle');
    assert.eq(GameplayTiers.classForRecord({kind:'tar'}),'streetObstacle');
    assert.eq(GameplayTiers.classForRecord({kind:'bush',_spawnClass:'streetObstacle'}),'streetObstacle');
    assert.eq(GameplayTiers.classForRecord({kind:'bush'}),'minor');
    assert.eq(GameplayTiers.classForRecord({id:'trap'},'hazard'),'hazard');
    assert.eq(GameplayTiers.allowed(3,GameplayTiers.classForRecord({kind:'pressure_plate'})),false);
    assert.eq(GameplayTiers.allowed(3,GameplayTiers.classForRecord({kind:'tar'})),false);
  });
  test('gameplay tiers: per-tile generation and review share stored arrays independently of frame metre scale',()=>{
    const e=entry([layer('transportation',[line('primary',[[0,140],[280,140]])])]);
    const a=GameplayTiers.buildTile(e);
    e.tileEdgeM*=2;
    const b=GameplayTiers.buildTile(e);
    assert.eq(Array.from(a.tiers).join(','),Array.from(b.tiers).join(','));
    e.gameplayTiers=b.tiers;e.gameplayReasons=b.reasons;
    const shown=GameplayTiers.fromEntries({tiles:[e]});
    assert.eq(shown.tiles[0].tiers,e.gameplayTiers);
    assert.eq(shown.tiles[0].reasons,e.gameplayReasons);
    assert.eq(shown.stats.cells.reduce((a,b)=>a+b,0),N*N);
  });
  test('gameplay tiers: nexus coverage is authoritative before the initial POI cleanup',()=>{
    const n=64,edge=n*WorldGen.CELL_M,p=(x,y)=>[[{x:(x+.5)*64,y:(y+.5)*64}]];
    const library={type:1,tags:{class:'library',name:'Nearby library'},geom:p(35,32)};
    const park={type:1,tags:{class:'park',subclass:'park',name:'Point park'},geom:p(32,32)};
    for(const hasPark of [false,true]) {
      const layers=[{name:'poi',features:hasPark?[library,park]:[library]}];
      const r=WorldGen.rasterizeTile(layers,n,0,0,edge);
      assert.eq(r.gameplayTiers[32*n+35],hasPark?GameplayTiers.CORE:GameplayTiers.EXCLUDED);
      assert.eq(r.objects.some(o=>o.kind==='chest'&&o.name==='Nearby library'),hasPark,
        'source POI survives only when final geographic coverage permits it');
    }
  });
  test('gameplay tiers: review is deterministic and leaves source geometry and spawn masks unchanged',()=>{
    const e=entry([layer('landuse',[polygon('park',[rect(0,0,280,280)])])]),before=JSON.stringify(e);
    const a=run(e),b=run(e);assert.eq(JSON.stringify(e),before);assert.eq(Array.from(a.tiles[0].tiers).join(','),Array.from(b.tiles[0].tiers).join(','));
    const area=(WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(e.ty)))**2/10000;
    assert.inRange(a.stats.ha.reduce((x,y)=>x+y,0),area-1e-6,area+1e-6);
  });
})();
