(function () {
  function fixture(kind, run) {
    const W=WorldGen, prior=new Map(W.tileCache);W.tileCache.clear();
    const N=32, cellM=7,edge=N*cellM;
    const e={cellsPerEdge:N,tileEdgeM:edge,grid:new Uint8Array(N*N).fill(W.T.GRASS),
      creatures:[],spawnWhy:new Uint32Array(N*N),_spawnOpts:{occupied:new Set()}};
    W.tileCache.set(W.tileKey(0,0),e);
    const key='summon-test',visit=1,id=`rare:${EnemySpawns.hash(key).toString(36)}:${visit}:${kind}`;
    const c={id,kind,x:108.5,y:108.5,_rareEncounter:{key,visit}};e.creatures.push(c);
    const state={behaviour:{}};
    const s={depth:0,cellM,tileEdgeM:edge,cellsPerTile:N,mPerPx:edge/W.TILE_PX,
      startWorldM:{x:0,y:0},originPx:{x:0,y:0},save:{caught:[],rareEncounters:{areas:{[key]:{seats:{[id]:state}}}}},
      _cellBlocked:()=>false,_nearAny:()=>false,
      cellAt(x,y){const ix=Math.floor(x/cellM),iy=Math.floor(y/cellM);return {loaded:ix>=0&&iy>=0&&ix<N&&iy<N,type:e.grid[iy*N+ix],tx:0,ty:0,ix,iy};}};
    try {run(s,e,c,state);} finally {W.tileCache.clear();for(const [k,v] of prior)W.tileCache.set(k,v);}
  }
  test('rare summons replace defeated children, cap living children and persist unique serials across reload',()=>{
    for(const kind of ['spook','nocturnus'])fixture(kind,(s,e,c,state)=>{
      const a=EnemyRoster.get(kind).ability;
      for(let i=0;i<a.maxMinions;i++)assert.truthy(enemySummon(s,c,a));
      assert.falsy(enemySummon(s,c,a));assert.eq(e.creatures.length,a.maxMinions+1);
      const dead=e.creatures[1];dead._hp=0;s.save.caught.push(dead.id);
      assert.truthy(enemySummon(s,c,a));assert.falsy(enemySummon(s,c,a));
      const serial=state.behaviour.summonSerial;assert.gt(serial,a.maxMinions);
      const oldIds=new Set(e.creatures.slice(1).map(p=>p.id));
      s.save.caught.push(...oldIds);e.creatures=[c];
      const reload={...c};delete reload._rareSummonState;
      assert.truthy(enemySummon(s,reload,a));
      assert.falsy(oldIds.has(e.creatures[1].id));assert.gt(state.behaviour.summonSerial,serial);
    });
  });
  test('renewable summon cap counts children outside the local tile ring and still uses geographic exclusions',()=>fixture('spook',(s,e,c,state)=>{
    const a=EnemyRoster.get(c.kind).ability;
    WorldGen.tileCache.set(WorldGen.tileKey(7,7),{creatures:Array.from({length:a.maxMinions},(_,i)=>({kind:'ghost',id:'away'+i,_summonerId:c.id,x:1700,y:1700}))});
    assert.falsy(enemySummon(s,c,a));WorldGen.tileCache.delete(WorldGen.tileKey(7,7));
    e.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    assert.falsy(enemySummon(s,c,a));assert.falsy(state.behaviour.summonSerial);
    e.spawnWhy.fill(0);assert.truthy(enemySummon(s,c,a));
  }));
  test('Tidal Force summons one shore-water jellyfish every five seconds and never onto land',()=>fixture('tidal_force',(s,e,c)=>{
    const row=EnemyRoster.get(c.kind),N=e.cellsPerEdge;
    assert.falsy(enemySummon(s,c,row.ability),'land rejects the aquatic child');
    // A one-cell water channel has land beside every valid jellyfish seat.
    for(let y=0;y<N;y++)e.grid[y*N+15]=WorldGen.T.WATER;
    e.gameplayTiers=new Uint8Array(N*N).fill(1); // mapped eligible shoreline proof
    assert.truthy(enemySupportTick(s,c,row,10000,true));assert.eq(e.creatures.length,2);
    assert.eq(e.creatures[1].kind,'jellyfish');assert.eq(s.cellAt(e.creatures[1].x,e.creatures[1].y).type,WorldGen.T.WATER);
    enemySupportTick(s,c,row,14999,true);assert.eq(e.creatures.length,2);
    enemySupportTick(s,c,row,15000,true);assert.eq(e.creatures.length,3);
  }));
})();
