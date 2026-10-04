// Exercise the shipped scene methods. Only map loading, drawing and persistence
// are replaced; placement, travel, trial evaluation and rewards run unchanged.
(function () {
  const source = SCENE_SRC.match(/class SceneArena \{[\s\S]*?\n\}/)[0];
  function fixture() {
    const cache = new Map(), writes = [], doc = {hidden:false};
    const world = {
      ...WorldGen, tileCache:cache, setDepth(depth) { this.depth=depth; },
    };
    for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)
      cache.set(world.tileKey(x,y),{grid:new Uint8Array(4),layers:[]});
    const Scene = new Function('WorldGen','persistSave','playerWorldM','worldMetersToTile','document',
      `return (${source});`)(world, save=>writes.push(JSON.parse(JSON.stringify(save))),
        s=>({x:s.startWorldM.x+s.playerM.x,y:s.startWorldM.y+s.playerM.y}),
        ()=>({tx:0,ty:0}),doc);
    const scene = Object.assign(new Scene(), {
      depth:0, save:{energy:100,inv:[{id:'portal_stone',count:1}]},
      startWorldM:{x:1000,y:2000}, playerM:{x:0,y:-3},feetOffsetM:3,
      originPx:{x:64,y:128},mPerPx:2,
      isTooFast:()=>false,ensureTilesAround:async()=>{},
      cellAt:()=>({loaded:true,type:WorldGen.T.PARK,underRoad:false}),
      flashAtPlayer(){},syncMoveTarget(){},_dialogOpen:()=>false,
      cameras:{main:{setBackgroundColor(){}}},
      showConfirmModal(modal){this.confirm=modal;},showMessageModal(modal){this.message=modal;},
      openArenaMenu(){this.menuOpened=(this.menuOpened||0)+1;},
      addToInv(id,qty){return Inventory.add(this.save,id,qty).accepted;},
    });
    // Encode a real transportation line in a neighbouring tile's MVT extent.
    // Non-zero origin, tile index and scale detect coordinate-frame mistakes.
    function road(distance, tx=1, ty=-1) {
      const width=world.roadOverlayWidthM({class:'primary'}), edge=world.TILE_PX;
      const points=[{x:900,y:2000+distance+width/2},{x:1100,y:2000+distance+width/2}];
      cache.get(world.tileKey(tx,ty)).layers=[{name:'transportation',extent:4096,features:[{
        type:2,tags:{class:'primary'},geom:[points.map(p=>({
          x:((p.x-1000)/2+64-tx*edge)*4096/edge,
          y:((p.y-2000)/2+128-ty*edge)*4096/edge,
        }))],
      }]}];
    }
    return {scene,world,cache,writes,doc,road};
  }
  test('portal placement: actual MVT roads enforce 50m from road edges across tile boundaries',async()=>{
    const f=fixture(),s=f.scene;
    s.save.arena={portal:{x:10,y:20}};
    f.road(49.99);
    assert.eq(await s.usePortalStone(),false);
    assert.eq(s.save.arena.portal.x,10,'failed relocation preserves old portal');
    assert.eq(f.writes.length,0);
    f.road(50);
    assert.eq(await s.usePortalStone(),true,'exact boundary qualifies');
    assert.eq(s.save.arena.portal.x,1000);
    assert.eq(s.save.arena.portal.y,2000,'feet, not sprite centre');
    assert.eq(Inventory.count(s.save,'portal_stone'),1);
    s.playerM.x+=10;
    assert.eq(await s.usePortalStone(),true);
    assert.eq(s.save.arena.portal.x,1010,'one saved anchor is replaced');
    assert.eq(f.writes.at(-1).arena.portal.x,1010,'new anchor persisted');
    s.confirm.onAccept();
    assert.eq(s.depth,Arena.DEPTH,'confirmation enters the realm');
  });
  test('portal placement: absent or incomplete neighbour data never grants permission',async()=>{
    for(const missing of ['tile','grid','layers']) {
      const f=fixture(),key=f.world.tileKey(-1,1);
      if(missing==='tile')f.cache.delete(key);else delete f.cache.get(key)[missing];
      assert.eq(await f.scene.usePortalStone(),false,missing);
      assert.falsy(f.scene.save.arena);assert.eq(f.writes.length,0);
    }
  });
  test('portal placement: terrain, ownership, speed and depth failures leave the save unchanged',async()=>{
    const cases=[
      s=>{s.depth=1;},s=>{s.depth=Arena.DEPTH;},s=>{s.save.inv=[];},
      s=>{s.save.energy=0;},s=>{s.isTooFast=()=>true;},
      s=>{s.cellAt=()=>({loaded:false});},
      s=>{s.cellAt=()=>({loaded:true,type:WorldGen.T.WATER});},
      s=>{s.cellAt=()=>({loaded:true,type:WorldGen.T.PARK,underRoad:true});},
      s=>{s.ensureTilesAround=async()=>{throw Error('offline');};},
    ];
    for(const configure of cases){
      const f=fixture();configure(f.scene);const before=JSON.stringify(f.scene.save);
      assert.eq(await f.scene.usePortalStone(),false);
      assert.eq(JSON.stringify(f.scene.save),before);assert.eq(f.writes.length,0);
    }
  });
  test('portal placement: state is rechecked after asynchronous map loading',async()=>{
    for(const mutate of [s=>{s.depth=3;},s=>{s.save.inv=[];},s=>{s.save.energy=0;},s=>{s.isTooFast=()=>true;}]) {
      const f=fixture();let loaded;
      f.scene.ensureTilesAround=()=>new Promise(resolve=>{loaded=resolve;});
      const placing=f.scene.usePortalStone();mutate(f.scene);loaded();
      assert.eq(await placing,false);assert.falsy(f.scene.save.arena);assert.eq(f.writes.length,0);
    }
  });
  test('arena travel: distant entry is refused, round trip uses original feet anchor and clears transient combat',()=>{
    const f=fixture(),s=f.scene;s.save.arena={portal:{x:1000,y:2000}};
    s.playerM.x=12.01;assert.eq(s.enterArena(),false);assert.eq(f.writes.length,0);
    s.playerM.x=12;s._shots=[{}];s._autoMineKey='rock';
    assert.eq(s.enterArena(),true);assert.eq(f.world.depth,Arena.DEPTH);
    assert.eq(s._shots.length,0);assert.eq(s._autoMineKey,null);
    assert.eq(s.playerM.y,-3);assert.eq(s.menuOpened,1);
    s.startArenaChallenge('race');s.playerM.x=40;
    s.save.arena.portal={x:3000,y:4000};
    assert.eq(s.exitArena(),true);assert.eq(s.depth,0);assert.eq(f.world.depth,0);
    assert.eq(s.playerM.x,0);assert.eq(s.playerM.y,-3);
    assert.falsy(s._arenaTrial);assert.falsy(s.save.arenaRun);
    assert.eq(f.writes.at(-1).depth,0);
  });
  function play(s,id) {
    assert.eq(s.startArenaChallenge(id),true);
    const c=Arena.CHALLENGES.find(c=>c.id===id),p=s.save.arena.portal;
    const step=(x,y)=>{s.playerM.x=p.x+x-s.startWorldM.x;s.playerM.y=p.y+y-s.startWorldM.y-s.feetOffsetM;s._tickArena(.1);};
    if(c.points)for(const q of c.points)step(q.x,q.y);
    else for(let i=0;i<700&&s._arenaTrial;i++) {
      const t=s._arenaTrial.elapsed+.1;
      if(id==='beams')step(Math.sin(t*.7)>0?-40:40,0);
      else step((t*9)%60<15?20:0,0);
    }
    assert.falsy(s._arenaTrial,`${id} ends through the scene tick`);
    assert.truthy(s.save.dungeonProgression.challenges.includes(id),`${id} victory recorded`);
  }
  test('arena campaign: all five real trials award exactly one permanent key across serialized sessions',()=>{
    const f=fixture(),s=f.scene;s.save.arena={portal:{x:1000,y:2000}};s.enterArena();
    for(let i=0;i<Arena.CHALLENGES.length;i++) {
      play(s,Arena.CHALLENGES[i].id);
      assert.eq(!!s.save.dungeonProgression.level4Key,i===4);
      // Simulate the save boundary between visits, retaining no object aliases.
      s.save=JSON.parse(JSON.stringify(s.save));
      assert.eq(DungeonProgression.canEnterDepth(s.save,4),i===4);
      if(i===0){play(s,'sparks');assert.eq(s.save.dungeonProgression.challenges.length,1);}
    }
    assert.eq(Inventory.count(s.save,'depth_key'),1);
    play(s,'sparks');assert.eq(Inventory.count(s.save,'depth_key'),1,'replays never duplicate key');
    assert.truthy(f.writes.at(-1).dungeonProgression.level4Key);
  });
  test('arena campaign: failed or interrupted trials cannot advance previous victories',()=>{
    const f=fixture(),s=f.scene;s.save.arena={portal:{x:1000,y:2000}};s.enterArena();play(s,'sparks');
    s.startArenaChallenge('race');for(let n=0;n<602;n++)s._tickArena(.1);
    assert.falsy(s._arenaTrial);assert.eq(s.message.title,'Try again');
    assert.eq(s.save.dungeonProgression.challenges.length,1);
    s.startArenaChallenge('runes');s.exitArena();
    assert.eq(s.save.dungeonProgression.challenges.length,1);assert.falsy(s.save.dungeonProgression.level4Key);
    assert.eq(Inventory.count(s.save,'depth_key'),0);
  });
  test('arena recovery: boot restores a serialized interrupted visit without losing earlier wins or key',()=>{
    for(const hasReturn of [true,false]) {
      const f=fixture(),s=f.scene;
      s.save={depth:Arena.DEPTH,energy:100,inv:[{id:'depth_key',count:1}],
        dungeonProgression:{challenges:['sparks','runes','race','beams','vigil'],level4Key:true},
        arena:{portal:{x:1100,y:2200}}};
      if(hasReturn)s.save.arenaRun={return:{x:1030,y:2040}};
      s.save=JSON.parse(JSON.stringify(s.save));
      s._recoverArenaRun();
      assert.eq(s.save.depth,0);assert.falsy(s.save.arenaRun);
      assert.eq(s.playerM.x,hasReturn?30:100);assert.eq(s.playerM.y,hasReturn?40:200);
      assert.eq(s.save.dungeonProgression.challenges.length,5);
      assert.truthy(DungeonProgression.canEnterDepth(s.save,4));
      assert.eq(Inventory.count(s.save,'depth_key'),1);
      assert.eq(f.writes.at(-1).depth,0,'recovery is persisted before normal startup');
      const count=f.writes.length;s._recoverArenaRun();assert.eq(f.writes.length,count,'second boot is idempotent');
    }
  });
  test('arena recovery: ordinary dungeon saves are untouched and missing anchors recover safely',()=>{
    for(const depth of [0,1,2,3,4]) {
      const f=fixture();f.scene.save.depth=depth;
      const before=JSON.stringify(f.scene.save);f.scene._recoverArenaRun();
      assert.eq(JSON.stringify(f.scene.save),before);assert.eq(f.writes.length,0);
    }
    const f=fixture();f.scene.save.depth=Arena.DEPTH;f.scene._recoverArenaRun();
    assert.eq(f.scene.save.depth,0);assert.eq(f.scene.playerM.x,0);
  });
})();
