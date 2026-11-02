(() => {
  const rows = key => HabitatSpawns.DENSITY_ROWS[key] || [];
  const total = (key, category) => rows(key).filter(r => r.category === category).reduce((n,r) => n+r.per1000,0);
  test('density tuning: curated fauna retain the approved zone totals and remove repeated residents', () => {
    assert.lt(Math.abs(total('Terrain:GRASS','fauna')-13.76),1e-9);
    assert.eq(rows('Terrain:GRASS').find(r => r.kind === 'sheep').per1000, 2,
      'new grassland sheep add their own density without thinning existing fauna');
    assert.lt(Math.abs(total('Nexus:meadow','fauna')-16.5),1e-9);
    assert.eq(rows('Nexus:meadow').filter(r=>r.category==='fauna').map(r=>r.kind).sort().join(','),'butterfly,rabbit');
    assert.lt(Math.abs(rows('Terrain:GRASS').find(r=>r.kind==='slime').per1000-.9527777777777778),1e-9);
  });
  test('density tuning: all geographic signatures resolve to a live species and one declared or owned source', () => {
    const signatures = HabitatSpawns.SIGNATURE_ENEMIES;
    assert.eq(Object.keys(signatures).length,83);
    for(const [key,signature] of Object.entries(signatures)) {
      const monster=EnemyRoster.get(signature.kind);
      assert.truthy(monster,key);assert.falsy(monster.retired,key+' cannot silently use a retired kind');
      assert.truthy(signature.owned || rows(key).some(r=>r.category==='enemy'&&r.kind===signature.kind&&r.signature),key);
    }
    for(const [key,table] of Object.entries(HabitatSpawns.DENSITY_ROWS)) {
      assert.eq(new Set(table.map(r=>r.category+':'+r.kind)).size,table.length,key+' has one row per species');
      for(const r of table) assert.gt(r.per1000,0,key);
    }
  });
  test('density tuning: shoreline additions combine with sand signature without duplicating identities', () => {
    const N=4,entry={grid:new Uint8Array(16).fill(WorldGen.T.SAND),cellsPerEdge:N,scenic:{shore:{mask:new Uint8Array(16)}}};
    entry.scenic.shore.mask[0]=1;
    const at=i=>HabitatSpawns.densityRows('Terrain:SAND',entry,i).filter(r=>r.kind==='giant_crab');
    assert.eq(at(0).length,1);assert.eq(at(0)[0].per1000,1.48);assert.eq(at(1)[0].per1000,.5);
    assert.eq(HabitatSpawns.densityRows('Terrain:WATER').find(r=>r.kind==='jellyfish').per1000,.5);
  });
  test('density tuning: park character replaces only the residual park signature', () => {
    const code=BiomeProfiles.PARK_CHARACTER_IDS.indexOf('wooded')+1;
    const entry={parkCharacters:new Uint8Array([code])};
    const park=HabitatSpawns.densityRows('Terrain:PARK',entry,0);
    const expected=rows('Park character:park_character_wooded')[0];
    assert.eq(park.filter(r=>r.signature).length,1);assert.eq(park.find(r=>r.signature).kind,expected.kind);
    assert.eq(park.filter(r=>r.category==='fauna').length,rows('Terrain:PARK').filter(r=>r.category==='fauna').length);
    assert.eq(JSON.stringify(HabitatSpawns.densityRows('Nexus:meadow',entry,0)),JSON.stringify(rows('Nexus:meadow')));
  });
  test('density tuning: only approved retired signatures reactivate and stay out of generic cave replay', () => {
    for(const kind of ['mini_slime','moss_slime','sand_skeleton']) {
      assert.falsy(EnemyRoster.get(kind).retired);assert.truthy(EnemyRoster.get(kind).signatureOnly);
      for(let depth=1;depth<=10;depth++) assert.falsy(EnemySpawns.caveRows(depth).some(r=>r.id===kind));
    }
    for(const kind of ['mini_spider','giant_slime','copper_plant','obsidian_brute']) assert.truthy(EnemyRoster.get(kind).retired);
  });
  test('density tuning: cave-only surface signatures need an actual owner declaration', () => {
    const creature={kind:'goblin_runt',_spawnSource:'zone-density',_spawnOwner:'Roads and paths:trade',_surfaceSpawn:{tx:0,ty:0,cx:1,cy:1,x:2000,y:2000}};
    const declared=Object.entries(HabitatSpawns.DENSITY_ROWS).find(([key,table])=>table.some(r=>r.kind==='goblin_runt'));
    assert.truthy(declared);creature._spawnOwner=declared[0];
    assert.truthy(HabitatSpawns.enemyDeclaration(creature));
    const scene={save:{},depth:0};assert.truthy(EnemySpawns.surfaceActive(scene,creature));
    creature._spawnOwner='Terrain:GRASS';assert.eq(HabitatSpawns.enemyDeclaration(creature),null);
    assert.falsy(EnemySpawns.surfaceActive(scene,creature));
  });
  test('density tuning: higher-tier signatures unlock exactly at the final Home band boundary', () => {
    const owner=Object.entries(HabitatSpawns.DENSITY_ROWS).find(([key,table])=>table.some(r=>r.kind==='dryad'&&r.signature))[0];
    const boundary=EnemyRoster.SURFACE_TIERS[EnemyRoster.SURFACE_TIERS.length-1].minDistance;
    const scene={save:{starterCratesAt:{x:0,y:0}},depth:0};
    const c={kind:'dryad',_spawnSource:'zone-density',_spawnOwner:owner,_surfaceSpawn:{tx:0,ty:0,cx:1,cy:1,x:boundary-1,y:0}};
    assert.falsy(EnemySpawns.surfaceActive(scene,c));assert.falsy(EnemySpawns.homeEligible(scene,c));
    c._surfaceSpawn.x=boundary;assert.truthy(EnemySpawns.surfaceActive(scene,c));assert.truthy(EnemySpawns.homeEligible(scene,c));
    c._spawnOwner='Terrain:GRASS';assert.falsy(EnemySpawns.surfaceActive(scene,c));
    assert.falsy(EnemySpawns.homeAllows('dryad',boundary),'ordinary Home policy remains unchanged');
  });
  test('density tuning: party extras inherit a declared higher-tier signature without changing their source', () => {
    const owner='Nexus:sacred_grove', N=20, edge=N*7;
    const entry={grid:new Uint8Array(N*N).fill(WorldGen.T.PARK),cellsPerEdge:N,tileEdgeM:edge,objects:[],zone:{coverage:new Uint16Array(N*N).fill(1),anchors:[{kind:'grove',variant:'sacred_grove',key:'signature-grove'}]}};
    const at={tx:20,ty:0,cx:10,cy:10,x:20*edge+73.5,y:73.5};
    const c={id:'zone_encounter_density_20_0_signature_dryad_210_0',kind:'dryad',zoneVariant:'sacred_grove',_spawnSource:'zone-density',_spawnOwner:owner,_surfaceSpawn:at,_habitatSpawn:{...at,key:HabitatSpawns.resolve(entry,210).key}};
    const owners=Array.from({length:N*N},(_,i)=>SpawnPipeline.ownerAt(entry,i));
    EnemyHabitats.registerDensityEncounter(entry,c,new Set([210]),owners);
    const extra=EnemyHabitats.groupsOf(entry)[0].extra(1);assert.truthy(extra);
    assert.eq(extra._spawnSource,'party-scaling');assert.eq(extra._densityParent,c.id);
    assert.truthy(HabitatSpawns.enemyDeclaration(extra));
    const scene={save:{starterCratesAt:{x:0,y:0}},depth:0};assert.truthy(EnemySpawns.surfaceActive(scene,extra));assert.truthy(EnemySpawns.homeEligible(scene,extra));
  });
  test('density tuning: a declared pink ghost keeps its night gate', () => {
    const original=Lighting.daylight, key=WorldGen.tileKey(0,0), previous=WorldGen.tileCache.get(key);
    // This test owns its geographic fixture; prior tests may leave a major-road
    // tile at 0,0, whose independent dusk suppression must not mask the night gate.
    WorldGen.tileCache.delete(key);
    const c={kind:'pink_ghost',_spawnSource:'zone-density',_spawnOwner:'Roads and paths:confusion_path',_surfaceSpawn:{tx:0,ty:0,cx:1,cy:1,x:2000,y:2000}};
    try {
      Lighting.daylight=()=>1;assert.falsy(EnemySpawns.surfaceActive({save:{},depth:0},c));
      Lighting.daylight=()=>0;assert.truthy(EnemySpawns.surfaceActive({save:{},depth:0},c));
    } finally {Lighting.daylight=original;if(previous)WorldGen.tileCache.set(key,previous);else WorldGen.tileCache.delete(key);}
  });
})();
