(function () {
  function fixture(kind, run) {
    const W=WorldGen, prior=new Map(W.tileCache);W.tileCache.clear();
    const N=32,cellM=7,edge=N*cellM;
    const c={kind,id:'rare-ai-'+kind,x:108.5,y:108.5};
    const e={cellsPerEdge:N,tileEdgeM:edge,grid:new Uint8Array(N*N).fill(W.T.GRASS),creatures:[c],_spawnOpts:{}};
    W.tileCache.set(W.tileKey(0,0),e);
    const s={depth:0,cellM,tileEdgeM:edge,cellsPerTile:N,mPerPx:edge/W.TILE_PX,
      originPx:{x:0,y:0},startWorldM:{x:0,y:0},save:{energy:1000,armor:{},caught:[]},_shots:[],conditions:[],
      cellAt:()=>({loaded:true,type:W.T.GRASS}),_cellBlocked:()=>false,_nearAny:()=>false,
      _losePlayerEnergy(n){this.save.energy-=n;return n;},_applyCondition(...args){this.conditions.push(args);}};
    try{run(s,c,EnemyRoster.get(kind),e);}finally{W.tileCache.clear();for(const [k,v] of prior)W.tileCache.set(k,v);}
  }
  const methodStart=SCENE_SRC.indexOf('\n  _damageEnemy(');
  const methodEnd=SCENE_SRC.indexOf('\n  }\n',methodStart);
  const damageEnemy=new Function('return {'+SCENE_SRC.slice(methodStart+1,methodEnd+4)+'}._damageEnemy')();
  const attack=(s,c,row,now,x,y)=>{rosterEnemyAttack(s,c,row,now,x,y,false,.1);rosterEnemyAttack(s,c,row,now+row.windupSeconds*1000,x,y,false,.1);};
  test('Sproutling regenerates rapidly, lands one attack, runs away and retires without a defeat reward',()=>fixture('sproutling',(s,c,row)=>{
    c._hp=10;rareEnemyTick(s,c,row,1000,1,c.x+2,c.y);assert.eq(c._hp,18);
    c._hp=row.hp-1;rareEnemyTick(s,c,row,2000,1,c.x+2,c.y);assert.eq(c._hp,row.hp);
    attack(s,c,row,10000,c.x+2,c.y);assert.lt(s.save.energy,1000);
    assert.truthy(rareEnemyState(s,c).spentAttack);
    const energy=s.save.energy,x=c.x;
    rosterEnemyMove(s,c,row,11000,x+2,c.y,false,false,null,.1);assert.lt(c.x,x);
    attack(s,c,row,15000,c.x+2,c.y);assert.eq(s.save.energy,energy);
    rareEnemyTick(s,c,row,25000,12,c.x+2,c.y);assert.truthy(c._rareInactive);assert.eq(s.save.caught.length,0);
  }));
  test('Fungusaur gains actual melee damage and art scale as HP is lost',()=>fixture('fungusaur',(s,c,row)=>{
    const fullScale=rareEnemyDamageMul(c,row);assert.eq(fullScale,1);
    attack(s,c,row,10000,c.x+2,c.y);const fullDamage=1000-s.save.energy;
    c._hp=Combat.maxHp(c)/2;rareEnemyTick(s,c,row,11000,0,c.x+2,c.y);
    assert.eq(rareEnemyDamageMul(c,row),2);assert.eq(c._artScale,1.4);assert.eq(SpriteLayout.creatureInstScale(c),1.4);
    s.save.energy=1000;attack(s,c,row,20000,c.x+2,c.y);
    assert.gt(1000-s.save.energy,fullDamage*1.8);
  }));
  test('Corrupticore and Gargirl resume attacks after their retreat interval',()=>{
    for(const kind of ['corrupticore','gargirl'])fixture(kind,(s,c,row)=>{
      attack(s,c,row,10000,c.x+2,c.y);const energy=s.save.energy;assert.lt(energy,1000);
      assert.gt(rareEnemyState(s,c).retreatMs,0);
      attack(s,c,row,15000,c.x+2,c.y);assert.eq(s.save.energy,energy);
      rareEnemyTick(s,c,row,16000,row.rareBehaviour.retreatAfterHitSeconds,c.x+2,c.y);
      attack(s,c,row,20000,c.x+2,c.y);assert.lt(s.save.energy,energy);assert.falsy(c._rareInactive);
    });
  });
  test('Watcher and Darkling keep their distance without attacking and leave on their configured clock',()=>{
    for(const kind of ['watcher','darkling'])fixture(kind,(s,c,row)=>{
      const x=c.x;rosterEnemyMove(s,c,row,1000,x+7,c.y,false,false,null,.1);assert.lt(c.x,x);
      attack(s,c,row,10000,c.x+2,c.y);assert.eq(s.save.energy,1000);assert.eq(s._shots.length,0);
      rareEnemyTick(s,c,row,11000,row.rareBehaviour.despawnSeconds-.1,c.x+2,c.y);assert.falsy(c._rareInactive);
      rareEnemyTick(s,c,row,12000,.1,c.x+2,c.y);assert.truthy(c._rareInactive);assert.eq(s.save.caught.length,0);
    });
  });
  test('Cockathrice gaze requires looking toward it and a clear line of sight',()=>fixture('cockathrice',(s,c,row)=>{
    const x=c.x-21,y=c.y;
    s.facing={x:-1,y:0};rosterEnemyAttack(s,c,row,10000,x,y,false,.1);assert.eq(s.conditions.length,0);
    s.facing={x:1,y:0};s._cellBlocked=()=>true;rosterEnemyAttack(s,c,row,12000,x,y,false,.1);assert.eq(s.conditions.length,0);
    s._cellBlocked=()=>false;rosterEnemyAttack(s,c,row,14000,x,y,false,.1);assert.eq(s.conditions[0][0],'petrified');
  }));
  test('Nighthop fires three diverging curse stars with fresh per-shot seeds and ten-second doses',()=>fixture('nighthop',(s,c,row)=>{
    attack(s,c,row,10000,c.x+28,c.y);assert.eq(s._shots.length,3);
    assert.eq(new Set(s._shots.map(p=>p.vy)).size,3);assert.eq(new Set(s._shots.map(p=>p.curseSeed)).size,3);
    for(const p of s._shots){assert.eq(p.projectile,'curse_star');assert.eq(p.conditionDurationMs,10000);}
    const old=s._shots.map(p=>p.curseSeed);attack(s,c,row,20000,c.x+28,c.y);
    assert.eq(s._shots.length,6);assert.truthy(s._shots.slice(3).every(p=>!old.includes(p.curseSeed)));
  }));
  test('Infernal fireballs actually explode and damage adjacent hostile targets once',()=>fixture('infernal',(s,c,row)=>{
    attack(s,c,row,10000,c.x+21,c.y);assert.eq(s._shots.length,1);
    const shot=s._shots[0];assert.gt(shot.blastRadiusM,7);
    const targets=[{id:'player',x:c.x+21,y:c.y},{id:'nearby',x:c.x+21,y:c.y+5},{id:'far',x:c.x+21,y:c.y+30}];
    const hit=[],exploded=[];
    const alive=Combat.stepShots([shot],5,[],1,(target,p)=>hit.push({id:target.id,damage:p.damage}),
      {cellM:7,hostileTargets:targets,onExplode:p=>exploded.push(p)});
    assert.eq(alive.length,0);assert.eq(exploded.length,1);assert.eq(hit.length,2);
    assert.truthy(hit.every(h=>h.damage>0));assert.falsy(hit.some(h=>h.id==='far'));
  }));
  test('Spectrus creates charging illusions that cannot attack or be caught and vanish on contact',()=>fixture('spectrus',(s,c,row,e)=>{
    rareEnemySpecialAttack(s,c,row,10000,c.x+28,c.y,true,.1);
    const copies=e.creatures.filter(p=>p._rareIllusion);assert.eq(copies.length,3);
    for(const [i,copy] of copies.entries()){
      assert.falsy(Pets.catchable(copy));
      const energy=s.save.energy;rosterEnemyAttack(s,copy,row,11000,copy.x+2,copy.y,false,.1);assert.eq(s.save.energy,energy);
      assert.eq(foeBlowLands(s,copy,20),0);
      const x=copy.x;rareEnemyTick(s,copy,row,11000,.1,x+28,copy.y);assert.gt(copy.x,x);
      if(i===2) {assert.truthy(damageEnemy.call(s,copy,1));assert.truthy(copy.dead);}
      rareEnemyTick(s,copy,row,11100,.1,i===2?copy.x+28:copy.x,copy.y);assert.falsy(e.creatures.includes(copy));
    }
    assert.eq(s.save.caught.length,0);
  }));
  test('Leviathan crosses onto land only after ink lands; Locylady never crosses and Dire Toad can',()=>{
    for(const kind of ['leviathan','locylady','dire_toad'])fixture(kind,(s,c,row)=>{
      const border=c.x+3;
      s.cellAt=(x,y)=>({loaded:true,type:x<border?WorldGen.T.WATER:WorldGen.T.GRASS});
      assert.truthy(enemyCanStep(s,c,row,c.x-1,c.y));
      assert.eq(enemyCanStep(s,c,row,c.x+7,c.y),kind==='dire_toad');
      if(kind==='leviathan'){
        rareEnemyLanded(s,c,row,1000);
        assert.truthy(enemyCanStep(s,c,row,c.x+7,c.y));
        rareEnemyTick(s,c,row,12000,11,c.x+14,c.y);
        assert.falsy(enemyCanStep(s,c,row,c.x+7,c.y));
      }
    });
  });
  test('thorn ambush approaches its ring before attacking, waits for siblings, and bounds blocked formations',()=>fixture('thorn_ball',(s,c,row,e)=>{
    c._rareSurround={group:'picked-berry',ordinal:0,count:4,cells:2};
    const peer={...c,id:'thorn-peer',_rareSurround:{...c._rareSurround,ordinal:1}};e.creatures.push(peer);
    rareEnemyTick(s,c,row,1000,.1,c.x+2,c.y);
    assert.truthy(rareEnemyForming(s,c,1000));
    attack(s,c,row,2000,c.x+2,c.y);assert.eq(s.save.energy,1000);
    c._rareRingReady=true;assert.truthy(rareEnemyForming(s,c,3000));
    peer._rareRingReady=true;assert.falsy(rareEnemyForming(s,c,3001));
    attack(s,c,row,4000,c.x+2,c.y);assert.lt(s.save.energy,1000);
    delete peer._rareRingReady;rareEnemyTick(s,peer,row,1000,.1,c.x+2,c.y);
    assert.truthy(rareEnemyForming(s,peer,1000));
    rareEnemyTick(s,peer,row,22000,21,c.x+2,c.y);assert.falsy(rareEnemyForming(s,peer,22000));
  }));
})();
