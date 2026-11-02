(function () {
  const lift = name => {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) throw new Error('Missing scene method ' + name);
    return SCENE_SRC.slice(start + 1, end + 4);
  };
  const methods = new Function(`${SCENE_SRC.match(/const TRAPPER_LAY_SLACK_CELLS[^;]+;/)[0]}
    return {${['_trapperLay','_veloxGrowThorns','_tickSummonedThorns','_walkHazardCell'].map(lift).join(',')}};`)();
  function fixture(run) {
    const W = WorldGen, prior = new Map(W.tileCache); W.tileCache.clear();
    const N = 16, cellM = 7, edge = N * cellM;
    const e = {status:'ready',_spawned:true,depth:0,cellsPerEdge:N,tileEdgeM:edge,
      grid:new Uint8Array(N*N).fill(W.T.PARK),objects:[],wildplants:[],
      roadMask:new Uint8Array(N*N),spawnWhy:new Uint32Array(N*N)};
    W.tileCache.set(W.tileKey(0,0),e);
    const s = {...methods,depth:0,cellsPerTile:N,cellM,tileEdgeM:edge,mPerPx:edge/W.TILE_PX,
      originPx:{x:0,y:0},startWorldM:{x:0,y:0},playerM:{x:59.5,y:59.5},viewSize:240,save:{}};
    const c = {kind:'velox',id:'velox-test',x:45.5,y:59.5};
    try {run(s,e,c);} finally {W.tileCache.clear();for(const [k,v] of prior) W.tileCache.set(k,v);}
  }
  test('Velox attacks create visible brambles on the player with normal thorn damage and axe harvest',()=>fixture((s,e,c)=>{
    s._trapperLay(c,10000,59.5,59.5);
    assert.eq(e.wildplants.length,1);
    const p=e.wildplants[0];
    assert.eq(p.crop,'shrub');assert.eq(p._plantArt,'bramble');
    assert.eq(p.x,59.5);assert.eq(p.y,59.5);
    assert.eq(wildplantRule(p.crop).workRelic,'axe');
    assert.eq(wildplantRule(p.crop).output,'wood');
    assert.eq(s._walkHazardCell(0,0,8,8),1);
    assert.eq((e.laidTraps || []).length,0,'no invisible metal trap');
    s._trapperLay(c,10001,66.5,59.5);assert.eq(e.wildplants.length,1,'attack cadence applies');
    s.save.picked=[p.id];
    assert.eq(s._walkHazardCell(0,0,8,8),0,'normal harvest immediately disables contact damage');
    s._tickSummonedThorns();assert.eq(e.wildplants.length,0);assert.eq(s._summonedThorns.length,0);
  }));
  test('Velox thorns expire without a living caster and invalidate retained plant paint',()=>fixture((s,e,c)=>{
    s._trapperLay(c,10000,59.5,59.5);
    const p=e.wildplants[0], revision=s._vineRevision;
    s._tickSummonedThorns(p._thornExpiresAt-1);assert.eq(e.wildplants.length,1);
    s._tickSummonedThorns(p._thornExpiresAt);assert.eq(e.wildplants.length,0);
    assert.eq(s._walkHazardCell(0,0,8,8),0);
    assert.gt(s._vineRevision,revision);
  }));
  test('Velox bounds active thorns and respects protected cells, water, roads and placed structures',()=>fixture((s,e,c)=>{
    for(let i=0;i<5;i++) {
      const x=45.5+i*7;c.x=x-14;
      s._trapperLay(c,10000+i*7000,x,59.5);
    }
    assert.eq(e.wildplants.length,4);
    s._tickSummonedThorns(Date.now()+31000);assert.eq(e.wildplants.length,0);
    c.x=45.5;
    let now=60000;
    const refuse=()=>{s._trapperLay(c,now+=7000,59.5,59.5);assert.eq(e.wildplants.length,0);};
    e.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);refuse();e.spawnWhy.fill(0);
    e.grid.fill(WorldGen.T.WATER);refuse();e.grid.fill(WorldGen.T.PARK);
    e.roadMask.fill(1);refuse();e.roadMask.fill(0);
    e.objects.push({id:'occupied',x:59.5,y:59.5});refuse();e.objects=[];
    s.save.furniture=[{id:'furniture',x:59.5,y:59.5,depth:0}];refuse();s.save.furniture=[];
    s._trapperLay(c,now+7000,59.5,59.5);assert.eq(e.wildplants.length,1);
  }));
})();
