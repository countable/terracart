(() => {
  const start = SCENE_SRC.indexOf('  _coinBurstInteract(sx, sy, poi) {');
  const end = SCENE_SRC.indexOf('  _coinCellsNearPlayer(count, r, taken) {', start);
  const burst = new Function('VIEW_CELLS','COIN_BURST_NEAR_PLAYER','COIN_BURST_NEAR_R','COIN_BURST_LIFE_MS','sameSideAs',
    'return ({'+SCENE_SRC.slice(start,end)+'})._coinBurstInteract;')(11,3,2,600000,(_scene,x)=>x<100);
  function fixture(blocked=false) {
    const N=16,edge=80,save={};
    const entries=[0,1].map(tx=>({tx,ty:0,cellsPerEdge:N,grid:new Uint8Array(N*N).fill(WorldGen.T.GRASS),
      spawnWhy:new Uint16Array(N*N),roadMask:new Uint8Array(N*N),_spawnOpts:{occupied:new Set()},coinDrops:[]}));
    if(blocked)for(const entry of entries)entry.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    const scene=makeScene({save,tileEdgeM:edge,cellM:5,cellsPerTile:N,startWorldM:{x:0,y:0},originPx:{x:0,y:0},
      mPerPx:edge/WorldGen.TILE_PX,playerM:{x:77.5,y:42.5},_coinBurstInteract:burst,
      _coinCellsNearPlayer:()=>[],coinIconEl:()=>null});
    const poi={kind:'grove_shrine',zoneVariant:'mystic_reef',_zoneObjectFrame:38,id:'reef_daily_test',x:77.5,y:42.5};
    return {scene,save,entries,poi};
  }
  const withCache=fn=>{const old=new Map(WorldGen.tileCache);WorldGen.tileCache.clear();try{fn()}finally{WorldGen.tileCache.clear();for(const [k,v]of old)WorldGen.tileCache.set(k,v)}};
  test('reef treasury: distinct reward replaces Tide Bell reach without altering other bells',()=>{
    const row=Shrines.kindForObject({kind:'grove_shrine',zoneVariant:'mystic_reef',shrineKind:'tide_bell'});
    assert.eq(row,Shrines.REWARD_KINDS.mystic_reef);assert.eq(row.reward,'coins');assert.truthy(row.fillScreen);
    assert.eq(Shrines.kindForZoneVariant('mystic_reef'),null);
    assert.eq(Shrines.kindForZoneVariant('shellwater_strand'),'tide_bell');
    assert.eq(Shrines.kindForStreet('promenade'),'tide_bell');
  });
  test('reef treasury: dense visible coins cross tile seams, respect gates and pay once daily',()=>withCache(()=>{
    const {scene,save,entries,poi}=fixture();for(const entry of entries)WorldGen.tileCache.set(WorldGen.tileKey(entry.tx,0),entry);
    entries[1]._spawnOpts.occupied.add(8*16+1);
    entries[1].spawnWhy[7*16+1]=WorldGen.SPAWN_WHY.RESTRICTED;
    entries[1].roadMask[6*16+1]=1;
    const existing={id:'existing',x:87.5,y:27.5,expiresAt:Date.now()+600000};entries[1].coinDrops.push(existing);
    const now=Date.now();INTERACTABLES.grove_shrine.custom(makeCtx(scene,save),poi);
    const coins=entries.flatMap(e=>e.coinDrops).filter(o=>o!==existing);
    assert.gt(coins.length,potCoinsFor(1)*2,'more than twice the largest ordinary pot');
    assert.gt(entries[0].coinDrops.length,0);assert.gt(entries[1].coinDrops.length,1,'both sides of the tile seam');
    const keys=new Set();
    for(const coin of coins){
      assert.lte(Math.abs(coin.x-scene.playerM.x),27.5);assert.lte(Math.abs(coin.y-scene.playerM.y),27.5);
      assert.lt(coin.x,100,'same-side gate is retained');assert.inRange(coin.expiresAt-now,600000,601000);
      assert.falsy(keys.has(`${coin.x},${coin.y}`));keys.add(`${coin.x},${coin.y}`);
    }
    for(const y of [42.5,37.5,32.5,27.5])assert.falsy(keys.has(`87.5,${y}`),'occupied, restricted, road and existing coin seats stay clear');
    assert.truthy(Macros.usedToday(save,poi.id));
    INTERACTABLES.grove_shrine.custom(makeCtx(scene,save),poi);
    assert.eq(entries.flatMap(e=>e.coinDrops).length,coins.length+1,'same-day tap cannot scatter again');
    assert.falsy(save.reachPotionUntil,'no Tide Bell boon');
  }));
  test('reef treasury: no eligible ground preserves the daily claim for a later attempt',()=>withCache(()=>{
    const {scene,save,entries,poi}=fixture(true);for(const e of entries)WorldGen.tileCache.set(WorldGen.tileKey(e.tx,0),e);
    INTERACTABLES.grove_shrine.custom(makeCtx(scene,save),poi);
    assert.eq(entries.flatMap(e=>e.coinDrops).length,0);assert.falsy(Macros.usedToday(save,poi.id));
    for(const e of entries)e.spawnWhy.fill(0);
    INTERACTABLES.grove_shrine.custom(makeCtx(scene,save),poi);
    assert.gt(entries.flatMap(e=>e.coinDrops).length,0);assert.truthy(Macros.usedToday(save,poi.id));
  }));
})();
