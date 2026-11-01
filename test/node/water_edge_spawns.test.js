(() => {
  const N=40, edge=N*7, W=WorldGen, T=W.T;
  const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1},{x:x0,y:y0}];
  const polygon=(x0,y0,x1,y1,tags={})=>({type:3,tags:{class:'lake',...tags},geom:[rect(x0,y0,x1,y1)]});
  const layer=(name,features)=>({name,extent:edge,features});
  const entry=(layers)=>({tx:0,ty:0,cellsPerEdge:N,tileEdgeM:edge,layers,grid:new Uint8Array(N*N).fill(T.WATER),spawnWhy:new Uint32Array(N*N)});
  const build=e=>{const r=GameplayTiers.build({tiles:[e]}).tiles[0]; e.gameplayTiers=r.tiers;e.waterEdges=r.waterEdges;return r;};
  const at=(e,x,y)=>e.gameplayTiers[y*N+x];
  test('water edge spawning: source union opens only its outer two cells and never a tile cut or repaint',()=>{
    const e=entry([layer('water',[polygon(-140,-140,140,420),polygon(140,-140,560,420)])]);
    build(e);
    assert.eq(at(e,0,20),4,'buffered footprint continues beyond tile boundary');
    assert.eq(at(e,19,20),4,'adjoining polygon seam is not shoreline');
    e.grid[20*N+20]=T.PATH;build(e);
    assert.eq(at(e,20,20),4,'later paint cannot create an interior water edge');
    const shore=entry([layer('water',[polygon(70,-140,560,420)])]);build(shore);
    assert.eq(at(shore,10,20),1);assert.eq(at(shore,11,20),1);
    assert.eq(at(shore,12,20),4,'third water cell is interior');
    assert.eq(at(shore,39,20),4,'far tile edge is not shoreline');
  });
  test('water edge spawning: access, buildings and source holes remain authoritative',()=>{
    const e=entry([layer('water',[{...polygon(-140,-140,560,420),geom:[rect(-140,-140,560,420),rect(70,70,140,140)]}]),
      layer('building',[polygon(56,70,70,140,{class:'building'})]),
      layer('landuse',[polygon(140,70,154,140,{class:'park',access:'private'})])]);build(e);
    assert.eq(at(e,10,9),1,'island bank creates actual water edge');
    assert.eq(at(e,9,15),4,'building on bank remains excluded');
    assert.eq(at(e,20,15),4,'private bank remains excluded');
    const denied=entry([layer('water',[polygon(70,-140,560,420,{access:'private'})])]);build(denied);
    assert.eq(at(denied,10,20),4,'water access restriction survives rim exemption');
  });
  test('water edge spawning: aquatic and terrestrial physical gates stay separate',()=>{
    const e=entry([layer('water',[polygon(70,-140,560,420)])]);build(e);
    for(let y=0;y<N;y++) for(let x=0;x<10;x++) e.grid[y*N+x]=T.SAND;
    const opts=W.spawnOptsOf(e);
    assert.truthy(W.isSpawnCell(e.grid,N,N,10,20,{...opts,waterOnly:true},'enemy'));
    assert.falsy(W.isSpawnCell(e.grid,N,N,12,20,{...opts,waterOnly:true},'enemy'));
    assert.falsy(W.isSpawnCell(e.grid,N,N,10,20,opts,'enemy'),'land row cannot float');
    e.grid[20*N+10]=T.SAND;
    assert.falsy(W.isSpawnCell(e.grid,N,N,10,20,{...opts,waterOnly:true},'enemy'),'aquatic row cannot seat on dry paint');
    assert.falsy(W.isSpawnCell(new Uint8Array(9).fill(T.WATER),3,3,0,0,{waterOnly:true},'enemy'),'unproved synthetic tile edge stays excluded');
  });
  test('water edge spawning: a proven source shoreline at the tile seam survives cloning, population and live checks',()=>{
    const e=entry([layer('water',[polygon(0,-140,560,420)])]);build(e);
    const opts=W.spawnOptsOf(e,{waterOnly:true});
    assert.truthy(W.isSpawnCell(e.grid,N,N,0,20,opts,'enemy'),'first source water cell at real shoreline');
    assert.truthy(W.isSpawnCell(e.grid,N,N,1,20,opts,'enemy'),'second source rim cell at real shoreline');
    assert.truthy(W.isShoreWaterCell(e.grid,N,N,0,20,opts),'cardinal bank is proven in source buffer');
    assert.falsy(W.isShoreWaterCell(e.grid,N,N,1,20,opts),'shore-only animals still require first water cell');
    const clone={...e,grid:e.grid.slice(),spawnWhy:e.spawnWhy.slice(),gameplayTiers:e.gameplayTiers.slice(),waterEdges:e.waterEdges.slice()};
    W.registerGameplayTiers(clone.grid,clone.spawnWhy,clone.gameplayTiers,clone.waterEdges);
    assert.truthy(W.isSpawnCell(clone.grid,N,N,0,20,{spawnWhy:clone.spawnWhy,waterOnly:true},'enemy'),'mask-only clone reads registered bank proof');
    const old=SpawnPipeline.roll;SpawnPipeline.roll=()=>true;
    try {
      const cs=W.runSteps(HabitatSpawns.populationSteps({tileEdgeM:edge,save:{}},clone,0,0,{category:'enemy',skipLegacy:true,spawnOpts:W.spawnOptsOf(clone,{occupied:new Set()})}));
      assert.truthy(cs.some(c=>c.kind==='jellyfish'&&c._surfaceSpawn.cx===0),'actual density pathway keeps seam residents');
    } finally {SpawnPipeline.roll=old;}
    const key=W.tileKey(0,0),had=W.tileCache.get(key);W.tileCache.set(key,clone);
    const c={kind:'jellyfish',x:3.5,y:143.5},row=EnemyRoster.get('jellyfish');
    const scene={cellM:7,depth:0,_cellBlocked:()=>false,cellAt:(x,y)=>({loaded:x>=0&&x<edge&&y>=0&&y<edge,type:T.WATER,tx:0,ty:0,ix:Math.floor(x/7),iy:Math.floor(y/7)})};
    try {
      assert.truthy(enemyCanStep(scene,c,row,c.x,c.y),'unloaded adjacent bank uses verified source proof');
      scene.cellAt=(x,y)=>({loaded:true,type:T.WATER,tx:0,ty:0,ix:Math.floor(x/7),iy:Math.floor(y/7)});
      assert.falsy(enemyCanStep(scene,c,row,c.x,c.y),'loaded changed water overrides original bank proof');
      const caster=Object.assign(new SceneCreatures(),{tileEdgeM:edge}),creatures=[{...c}];
      const base=clone.grid.slice();base[20*N]=T.SAND;
      caster._cullOffLiveGround(clone,0,0,N,7,base,[],creatures);
      assert.eq(creatures.length,1,'live physical gate keeps water seat with source bank');
    } finally {if(had)W.tileCache.set(key,had);else W.tileCache.delete(key);}
    const cut=entry([layer('water',[polygon(-140,-140,560,420)])]);build(cut);
    assert.falsy(W.isSpawnCell(cut.grid,N,N,0,20,W.spawnOptsOf(cut,{waterOnly:true}),'enemy'),'continuing water across tile cut never gains source proof');
    assert.falsy(W.isShoreWaterCell(cut.grid,N,N,0,20,W.spawnOptsOf(cut)));
  });
  test('water edge spawning: generated ponds retain only their physical rim over eligible dry tiers',()=>{
    const grid=new Uint8Array(100).fill(T.GRASS),tiers=new Uint8Array(100).fill(1);
    for(let y=1;y<9;y++)for(let x=1;x<9;x++)grid[y*10+x]=T.WATER;
    const opts={gameplayTiers:tiers,waterOnly:true};
    assert.truthy(W.isSpawnCell(grid,10,10,1,5,opts,'enemy'));
    assert.truthy(W.isSpawnCell(grid,10,10,2,5,opts,'enemy'));
    assert.falsy(W.isSpawnCell(grid,10,10,3,5,opts,'enemy'),'third pond cell remains excluded');
    assert.falsy(W.isSpawnCell(grid,10,10,5,5,opts,'enemy'),'eligible old grass cannot reopen pond centre');
    assert.falsy(W.isSpawnCell(new Uint8Array(100).fill(T.WATER),10,10,0,0,opts,'enemy'),'unknown cells beyond a tile are not a bank');
  });
  test('water edge spawning: beach and Nexus Jellyfish use their own legal water and cannot borrow a neighbour owner',()=>{
    const e=entry([layer('water',[polygon(140,-140,560,420)]),layer('landuse',[polygon(-140,-140,140,420,{class:'beach'})])]);
    e.scenic={shore:{mask:new Uint8Array(N*N)}};
    for(let y=0;y<N;y++) for(let x=0;x<20;x++){e.grid[y*N+x]=T.SAND;e.scenic.shore.mask[y*N+x]=1;}
    build(e);
    const old=SpawnPipeline.roll;SpawnPipeline.roll=()=>true;
    const run=()=>W.runSteps(HabitatSpawns.populationSteps({tileEdgeM:edge,save:{}},e,0,0,{category:'enemy',skipLegacy:true,spawnOpts:W.spawnOptsOf(e,{occupied:new Set()})}));
    try {
      const plain=run(),jellies=plain.filter(c=>c.kind==='jellyfish');
      assert.gt(jellies.length,0);assert.truthy(plain.some(c=>c.kind==='giant_crab'));
      for(const c of jellies){assert.eq(c._spawnOwner,'Terrain:WATER');assert.eq(c._surfaceSpawn.cx,20);}
      e.zone={coverage:new Uint16Array(N*N),anchors:[{kind:'beach',variant:'marine_meadow',key:'empty'}]};
      for(let y=0;y<N;y++) e.zone.coverage[y*N+20]=1;
      assert.eq(run().filter(c=>c.kind==='jellyfish').length,0,'empty specific water owner cannot fallback');
      e.zone.anchors[0].variant='mystic_reef';
      const owned=run().filter(c=>c.kind==='jellyfish');assert.gt(owned.length,0);
      for(const c of owned)assert.eq(c._spawnOwner,'Nexus:mystic_reef');
    } finally {SpawnPipeline.roll=old;}
  });
})();
