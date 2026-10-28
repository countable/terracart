(function () {
  const W = WorldGen, N = 16, cellM = 7, edge = N*cellM;
  function fixture(run) {
    const prior = new Map(W.tileCache); W.tileCache.clear();
    const e = {status:'ready',depth:0,cellsPerEdge:N,tileEdgeM:edge,grid:new Uint8Array(N*N).fill(W.T.PARK),objects:[],wildplants:[],roadMask:new Uint8Array(N*N),spawnWhy:new Uint32Array(N*N)};
    W.tileCache.set(W.tileKey(0,0),e);
    const s = {depth:0,cellsPerTile:N,cellM,tileEdgeM:edge,mPerPx:edge/W.TILE_PX,originPx:{x:0,y:0},startWorldM:{x:0,y:0},playerM:{x:59.5,y:59.5},viewSize:240,save:{}};
    e.wildplants.push(W.makeWildplant('creeping_vine',59.5,59.5,'vine-seed',{_creepingVine:true,_vineColony:'vine-seed',_plantArt:'creeping_vine'}));
    try {run(s,e);} finally { W.tileCache.clear();for (const [k,v] of prior) W.tileCache.set(k,v); }
  }
  const advance = s => {for(let i=0;i<200;i++)CreepingVines.tick(s,.1);};
  test('creeping vines grow once per visible 20 seconds and never catch up offline',()=>fixture((s,e)=>{
    CreepingVines.tick(s,3600); assert.eq(e.wildplants.length,1);
    assert.eq(s.save.vineGrowth['vine-seed'].elapsedMs,100);
    advance(s); assert.eq(e.wildplants.length,2);
    assert.eq(s.save.creepingVines.length,1);
    s.playerM={x:5000,y:5000}; advance(s);assert.eq(e.wildplants.length,2);
    s.playerM={x:59.5,y:59.5}; s.depth=1;advance(s);assert.eq(e.wildplants.length,2);
  }));
  test('creeping vines respect circular clipping, occupied terrain, cuts and finite colony budgets',()=>fixture((s,e)=>{
    const r=s.viewSize/2/CELL_PX*s.cellM;
    assert.falsy(CreepingVines.visible(s,{x:59.5+r*.8,y:59.5+r*.8}));
    e.grid.fill(W.T.WATER); advance(s);assert.eq(e.wildplants.length,1);
    e.grid.fill(W.T.PARK); e.spawnWhy.fill(W.SPAWN_WHY.RESTRICTED);
    advance(s); assert.eq(e.wildplants.length,1); e.spawnWhy.fill(0);
    e.roadMask.fill(1); advance(s); assert.eq(e.wildplants.length,1); e.roadMask.fill(0);
    e.zone={coverage:new Uint8Array(N*N).fill(1)};advance(s);assert.eq(e.wildplants.length,1);delete e.zone;
    for (const [x,y] of [[59.5,52.5],[66.5,59.5],[59.5,66.5],[52.5,59.5]]) e.objects.push({x,y,id:`block${x}${y}`});
    advance(s);assert.eq(e.wildplants.length,1);e.objects=[];
    s.save.picked=['vine-seed'];advance(s);assert.eq(e.wildplants.length,1);
    s.save.picked=[];s.save.vineGrowth['vine-seed'].count=CreepingVines.CONFIG.maxCells;
    advance(s);assert.eq(e.wildplants.length,1);
  }));
  test('creeping vine growth survives tile regeneration and shares axe harvest and contact hazard rules',()=>fixture((s,e)=>{
    advance(s);const p=s.save.creepingVines[0];assert.truthy(p);
    e.wildplants=e.wildplants.slice(0,1);delete e._vineSave;
    CreepingVines.tick(s,.1);assert.eq(e.wildplants.length,2);
    assert.eq(walkHazardDamageRate(p),1);
    assert.eq(wildplantRule(p.crop).workRelic,'axe');assert.eq(wildplantRule(p.crop).output,'wood');
    assert.falsy(wildplantRule(p.crop).nest);
  }));
})();
