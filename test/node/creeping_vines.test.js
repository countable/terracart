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
  test('road-seeded vines stay on their influence and preserve its identity after regrowth',()=>fixture((s,e)=>{
    const variant='paralysis_path';
    e.wildplants[0]._street=variant;
    e.streetIndex={extent:N,dressingLines:[{key:'vine-road',variant,size:'minor',halfW:cellM/2,
      line:[{x:1.5,y:6.5},{x:14.5,y:6.5}]}]};
    const painted=W.runSteps(StreetVariants.paintTerrainSteps({index:e.streetIndex,grid:e.grid,N,spawnWhy:e.spawnWhy}));
    for(let i=0;i<12;i++)advance(s);
    assert.gt(s.save.creepingVines.length,2,'growth continues along available influence cells');
    for(const p of s.save.creepingVines) {
      const at=worldMetersToTileCell(s,p.x,p.y);
      assert.eq(p._street,variant,'descendants retain their source road');
      assert.truthy(painted[at.iy*N+at.ix],'growth remains on the painted influence');
    }
    e.wildplants=e.wildplants.slice(0,1);delete e._vineSave;
    CreepingVines.tick(s,.1);
    assert.truthy(e.wildplants.every(p=>p._street===variant),'saved growth retains its road identity');
  }));
  test('road vine with blocked influence cannot grow into free land beyond its edge',()=>fixture((s,e)=>{
    e.wildplants[0]._street='paralysis_path';
    e.streetIndex={extent:N,dressingLines:[{key:'blocked-vine-road',variant:'paralysis_path',size:'minor',halfW:cellM/2,
      line:[{x:1.5,y:6.5},{x:14.5,y:6.5}]}]};
    for(const [x,y] of [[59.5,52.5],[66.5,59.5],[52.5,59.5]])e.objects.push({x,y,id:'blocked-'+x+'-'+y});
    advance(s);
    assert.eq(e.wildplants.length,1,'free cell outside the influence is refused');
  }));
  test('Toxic Seed is a T2 seed with seed-bag art, poison badge and ordinary seed acquisition', () => {
    assert.eq(ITEM_BY_ID.toxic_seed.kind, 'seed');
    assert.eq(itemTierOf('toxic_seed'), 2);
    assert.eq(itemValue('toxic_seed'), 5);
    assert.eq(inventoryIconSource('toxic_seed').sheet, 'crops');
    assert.eq(iconBadgeItem('toxic_seed'), 'poisonberry');
    assert.truthy(BUY_LIST.includes('toxic_seed'));
    assert.truthy(ChestThemes.eligible('parkSeeds', 2).includes('toxic_seed'));
    assert.falsy(ChestThemes.eligible('parkSeeds', 1).includes('toxic_seed'));
  });
  test('Toxic Seed planting consumes one seed, saves one live cell, then grows after visible time', () => fixture((s,e) => {
    e.wildplants = [];
    SaveState.defaults(s.save); s.save.planted = [];
    s.save.inv = [{id:'toxic_seed',count:2}]; s.save.selSlot = 0;
    s.tilledSet = new Set(['8_8']);
    s.spendEnergy = () => {s.spent = (s.spent || 0) + 1; return true;};
    s.buildInventoryDOM = () => {}; s.flash = () => {};
    const ctx = {scene:s,save:s.save,sx:0,sy:0,cellKey:'8_8',cwmx:59.5,cwmy:59.5,
      at:{furnitureIdx:-1,plantedIdx:-1}};
    assert.truthy(TAP_HANDLERS.find(h=>h.name==='plant').try(ctx));
    assert.eq(Inventory.count(s.save,'toxic_seed'),1); assert.eq(s.spent,1);
    assert.eq(e.wildplants.length,1); assert.eq(s.save.creepingVines.length,1);
    assert.eq(s.save.planted.length,0,'this is a live vine, not a watered farm crop');
    assert.falsy(s.tilledSet.has('8_8')); assert.truthy(ctx.dirty);
    const seed = e.wildplants[0];
    assert.eq(seed._vineColony,seed.id); assert.eq(seed._ix,8); assert.eq(seed._iy,8);
    assert.eq(walkHazardDamageRate(seed),1);
    assert.eq(s.save.vineGrowth[seed.id].count,1);
    s.save = JSON.parse(JSON.stringify(s.save));
    e.wildplants=[]; delete e._vineSave;
    CreepingVines.tick(s,.1);
    assert.eq(e.wildplants.length,1,'the seed rehydrates after tile/save reload');
    advance(s); assert.eq(e.wildplants.length,2,'one adjacent growth cell after20visible seconds');
  }));
  test('Toxic Seed can replace a harvested vine without reusing its spent identity', () => fixture((s,e) => {
    e.wildplants=[];SaveState.defaults(s.save);s.save.planted=[];
    s.save.inv=[{id:'toxic_seed',count:2}];s.save.selSlot=0;s.tilledSet=new Set(['8_8']);
    s.spendEnergy=()=>true;s.buildInventoryDOM=()=>{};s.flash=()=>{};
    const ctx={scene:s,save:s.save,sx:0,sy:0,cellKey:'8_8',cwmx:59.5,cwmy:59.5,
      at:{furnitureIdx:-1,plantedIdx:-1}};
    const plant=TAP_HANDLERS.find(h=>h.name==='plant');
    plant.try(ctx);const first=s.save.creepingVines[0];
    s.save.picked.push(first.id);
    assert.falsy(CreepingVines.seat(s,59.5,59.5),'natural growth still respects the cut barrier');
    s.tilledSet.add('8_8');plant.try(ctx);
    const second=s.save.creepingVines[1];assert.truthy(second);
    assert.falsy(first.id===second.id);assert.falsy(s.save.picked.includes(second.id));
    assert.eq(Inventory.count(s.save,'toxic_seed'),0);
    assert.eq(s.save.vineGrowth[second.id].count,1);
  }));
  test('Toxic Seed refuses blocked ground before charging or consuming and cannot start underground', () => fixture((s,e) => {
    e.wildplants=[]; SaveState.defaults(s.save);
    s.save.inv=[{id:'toxic_seed',count:1}];s.save.selSlot=0;s.tilledSet=new Set(['8_8']);
    s.spendEnergy=()=>{throw Error('blocked planting must not charge energy');};s.flash=()=>{};
    const ctx={scene:s,save:s.save,sx:0,sy:0,cellKey:'8_8',cwmx:59.5,cwmy:59.5,
      at:{furnitureIdx:-1,plantedIdx:-1}};
    e.grid.fill(W.T.WATER);
    assert.truthy(TAP_HANDLERS.find(h=>h.name==='plant').try(ctx));
    assert.eq(Inventory.count(s.save,'toxic_seed'),1);assert.eq(s.save.creepingVines.length,0);
    e.grid.fill(W.T.PARK);s.depth=1;
    assert.truthy(TAP_HANDLERS.find(h=>h.name==='plant').try(ctx));
    assert.eq(Inventory.count(s.save,'toxic_seed'),1);assert.eq(s.save.creepingVines.length,0);
  }));
})();
