(function () {
  function fixture(run) {
    const N=32,cellM=7,edge=N*cellM;
    const entry={cellsPerEdge:N,tileEdgeM:edge,grid:new Uint8Array(N*N).fill(WorldGen.T.GRASS),objects:[],
      gameplayTiers:new Uint8Array(N*N).fill(1),_spawnOpts:{occupied:new Set(Array.from({length:N*N},(_,i)=>i))}};
    const scene={depth:0,cellM,tileEdgeM:edge,cellsPerTile:N,mPerPx:edge/WorldGen.TILE_PX,
      startWorldM:{x:0,y:0},originPx:{x:0,y:0},save:{caught:[]}};
    run(scene,entry,108.5,108.5,15*N+15);
  }
  test('creature gate: animals, regular foes and rares share passable props without opening prop placement',()=>fixture((s,e,x,y,i)=>{
    e.objects=[{kind:'rock',x,y},{kind:'chest',x,y},{kind:'floor_torch',x,y}];
    for(const kind of ['cat','goblin','wolfling'])assert.truthy(CreatureSpawns.gateAtEntry(s,e,x,y,kind),kind);
    assert.falsy(WorldGen.isSpawnCell(e.grid,32,32,15,15,{...e._spawnOpts,gameplayTiers:e.gameplayTiers},'minor'));
    assert.truthy(e._spawnOpts.occupied.has(i),'prop ledger remains intact');
    assert.falsy(CreatureSpawns.gateAtEntry(s,e,x,y,'goblin',{creatureCells:new Set([i])}));
  }));
  test('creature gate: pushable objects and placed rocks stay solid',()=>fixture((s,e,x,y)=>{
    e.objects=[{kind:'rock',pushable:true,x,y}];
    for(const kind of ['cat','goblin','wolfling'])assert.falsy(CreatureSpawns.gateAtEntry(s,e,x,y,kind));
    e.objects=[];const at=worldMetersToAbsCell(s,x,y);s.placedRockSet=new Set([cellKeyFromAbsCell(at.cellIX,at.cellIY)]);
    assert.falsy(CreatureSpawns.gateAtEntry(s,e,x,y,'goblin'));
    s.placedRockSet.clear();assert.truthy(CreatureSpawns.gateAtEntry(s,e,x,y,'goblin'));
  }));
  test('creature gate: walls remain blocked and only declared water species use water',()=>fixture((s,e,x,y,i)=>{
    for(const terrain of [WorldGen.T.CAVE_WALL,WorldGen.T.BUILDING,WorldGen.T.EXCLUSION_ROCK]){
      e.grid[i]=terrain;assert.falsy(CreatureSpawns.gateAtEntry(s,e,x,y,'goblin'));
    }
    e.grid[i]=WorldGen.T.WATER;
    for(const kind of ['cat','goblin','gargirl'])assert.falsy(CreatureSpawns.gateAtEntry(s,e,x,y,kind,{waterOnly:true}),kind);
    for(const kind of ['jellyfish','dire_toad','leviathan','locylady','tidal_force'])assert.truthy(CreatureSpawns.gateAtEntry(s,e,x,y,kind),kind);
    e.grid[i]=WorldGen.T.GRASS;
    assert.falsy(CreatureSpawns.gateAtEntry(s,e,x,y,'jellyfish',{waterOnly:false}));
  }));
})();
