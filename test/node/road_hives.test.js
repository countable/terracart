(function () {
  function fixture(run) {
    const W = WorldGen, key = W.tileKey(0, 0), old = W.tileCache.get(key);
    const house = { kind:'house', id:'hive-test', hive:'mushroom', tier:9, x:52, y:52 };
    const entry = { status:'ready', depth:0, tileEdgeM:128, cellsPerEdge:16,
      grid:new Uint8Array(256).fill(W.T.GRASS), objects:[house], creatures:[], _spawnOpts:{occupied:new Set([102])} };
    const scene = { save:{caught:[]}, depth:0, cellM:8, cellsPerTile:16, tileEdgeM:128,
      originPx:{x:0,y:0},mPerPx:128/W.TILE_PX, startWorldM:{x:0,y:0}, playerM:{x:52,y:52},
      _cellBlocked:()=>false, cellAt:()=>({loaded:true,type:W.T.GRASS}) };
    W.tileCache.set(key,entry);
    try { run({scene,house,entry}); }
    finally { if (old) W.tileCache.set(key,old); else W.tileCache.delete(key); }
  }
  const advance = (scene, ms) => { for (let n=0;n<ms;n+=100) Hives.tick(scene, .1); };
  test('hives: damage and destruction persist without changing wreck identity',()=>fixture(({scene:s,house:h})=>{
    assert.truthy(Hives.isActive(s.save,h));
    assert.eq(Hives.health(s.save,h),Hives.KINDS.mushroom.hp);
    assert.falsy(Hives.damage(s,h,25));
    s.save=JSON.parse(JSON.stringify(s.save));
    assert.eq(Hives.health(s.save,h),95);
    assert.truthy(Hives.damage(s,h,1000));
    assert.falsy(Hives.isActive(s.save,{...h}));
    assert.truthy(Houses.isHouseWreck(s.save,h));
    assert.eq(h.kind,'house');assert.eq(h.hive,'mushroom');
    assert.falsy(Hives.spawn(s,h));assert.falsy(Hives.damage(s,h,10));
    assert.falsy(s.save.restoredHouses,'destroying does not restore the building');
  }));
  test('hives: claimed and player-owned buildings never activate',()=>fixture(({scene:s,house:h})=>{
    s.save.starterShopId=h.id;assert.falsy(Hives.isActive(s.save,h));delete s.save.starterShopId;
    s.save.restoredHouses={[h.id]:'shop'};assert.falsy(Hives.isActive(s.save,h));delete s.save.restoredHouses;
    assert.falsy(Hives.isActive(s.save,{...h,placed:true}));
    assert.falsy(Hives.isActive(s.save,{...h,tier:11}));
  }));
  test('hives: one mushroom each minute, four alive, killed members can be replaced',()=>fixture(({scene:s,house:h,entry:e})=>{
    Hives.tick(s,.1);advance(s,59900);assert.eq(e.creatures.length,0);
    advance(s,100);assert.eq(e.creatures.length,1);
    advance(s,180000);assert.eq(e.creatures.length,4);
    advance(s,60000);assert.eq(e.creatures.length,4);
    const dead=e.creatures[0];s.save.caught.push(dead.id);dead._spent=true;
    advance(s,60000);assert.eq(e.creatures.length,5);assert.eq(Hives.living(s,h).length,4);
    assert.truthy(e.creatures.every(c=>c.kind==='mushroom_monster'&&c._hiveId===h.id&&!c._sharedId));
    assert.truthy(e.creatures[4].id!==dead.id,'new births never reuse saved defeat IDs');
    Hives.damage(s,h,1000);advance(s,120000);assert.eq(e.creatures.length,5);
  }));
  test('hives: background, inactive floors and distant houses do not produce catch-up waves',()=>fixture(({scene:s,entry:e})=>{
    Hives.tick(s,.1);const hidden=document.hidden;document.hidden=true;
    try {advance(s,120000);} finally {document.hidden=hidden;}
    s.depth=1;advance(s,120000);s.depth=0;
    assert.eq(e.creatures.length,0);
    s.playerM={x:400,y:400};advance(s,120000);s.playerM={x:52,y:52};
    advance(s,1000);assert.eq(e.creatures.length,0);
    advance(s,60000);assert.eq(e.creatures.length,1);
  }));
  test('hives: births obey shared terrain and live blocking gates',()=>fixture(({scene:s,house:h,entry:e})=>{
    e.grid.fill(WorldGen.T.WATER);assert.falsy(Hives.spawn(s,h));
    e.grid.fill(WorldGen.T.GRASS);s._cellBlocked=()=>true;assert.falsy(Hives.spawn(s,h));
    s._cellBlocked=()=>false;const child=Hives.spawn(s,h);assert.truthy(child);
    assert.truthy(child.x!==h.x||child.y!==h.y);
    const savedSerial=s.save.hives[h.id].serial;
    s.save=JSON.parse(JSON.stringify(s.save));e.creatures=[];
    const next=Hives.spawn(s,h);assert.truthy(next);assert.eq(s.save.hives[h.id].serial,savedSerial+1);
  }));
  test('hives: births leave clearance around the player at the first legal seat',()=>fixture(({scene:s,house:h})=>{
    s.playerM={x:44,y:44};
    const child=Hives.spawn(s,h);
    assert.truthy(child,'another legal seat is available');
    assert.truthy(Math.hypot(child.x-44,child.y-44)>=s.cellM*Hives.CONFIG.spawnClearanceCells,'a birth cannot overlap the player');
  }));
})();
