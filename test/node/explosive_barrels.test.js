(function () {
  function fixture(run) {
    const W=WorldGen,key=W.tileKey(0,0),old=W.tileCache.get(key),predicate=globalThis.isExplosiveBarrel;
    const entry={depth:0,cellsPerEdge:8,creatures:[]};W.tileCache.set(key,entry);
    globalThis.isExplosiveBarrel=o=>o.barrel===true;
    const fire=[],hits=[],blasts=[];
    const scene={save:{energy:100},depth:0,cellM:8,cellsPerTile:8,tileEdgeM:64,mPerPx:64/W.TILE_PX,
      startWorldM:{x:0,y:0},originPx:{x:0,y:0},playerM:{x:28,y:28},time:{now:100},
      cellAt(x,y){return {tx:0,ty:0,ix:Math.floor(x/8),iy:Math.floor(y/8),loaded:true};},
      _losePlayerEnergy(n){this.save.energy-=n;return n;},_popEnergy(){},
      _damageBurningUnit(c,n,source){hits.push({id:c.id,n,source});},
      _igniteGroundCell(c,now,opts){fire.push({...c,...opts});},_blastAt(x,y,opts){blasts.push({x,y,...opts});}};
    const barrel={id:'explosive-test',kind:'chest',barrel:true,x:28,y:28};
    try {run({scene,barrel,entry,fire,hits,blasts});} finally {
      globalThis.isExplosiveBarrel=predicate;if(old)W.tileCache.set(key,old);else W.tileCache.delete(key);
    }
  }
  const advance=(s,ms)=>{for(let n=0;n<ms;n+=100)ExplosiveBarrels.tick(s,Math.min(100,ms-n)/1000);};
  test('explosive barrels: saved five-second foreground fuse cannot restart or detonate twice',()=>fixture(({scene:s,barrel:b,blasts})=>{
    assert.truthy(ExplosiveBarrels.arm(s,b));assert.eq(ExplosiveBarrels.countdown(s,b),5);
    advance(s,1000);assert.eq(ExplosiveBarrels.countdown(s,b),4);
    assert.truthy(ExplosiveBarrels.arm(s,b));assert.eq(ExplosiveBarrels.countdown(s,b),4,'retap never resets');
    s.save=JSON.parse(JSON.stringify(s.save));assert.eq(ExplosiveBarrels.countdown(s,b),4,'reload keeps remaining foreground time');
    const hidden=document.hidden;document.hidden=true;
    try {advance(s,5000);assert.eq(ExplosiveBarrels.countdown(s,b),4,'background tabs pause the fuse');}
    finally {document.hidden=hidden;}
    s.depth=1;advance(s,5000);assert.eq(ExplosiveBarrels.countdown(s,b),4,'other floors pause');s.depth=0;
    const lookup=s.cellAt;s.cellAt=()=>({loaded:false});advance(s,5000);assert.eq(ExplosiveBarrels.countdown(s,b),4,'unloaded cells pause');s.cellAt=lookup;
    advance(s,3900);assert.eq(blasts.length,0);assert.eq(ExplosiveBarrels.countdown(s,b),1);
    advance(s,100);assert.eq(blasts.length,1);assert.includes(s.save.opened,b.id);
    assert.falsy(ExplosiveBarrels.arm(s,b));advance(s,6000);assert.eq(blasts.length,1);
  }));
  test('explosive barrels: circular one-cell blast damages and burns bodies, lights five cells and reuses blast art',()=>fixture(({scene:s,barrel:b,entry,fire,hits,blasts})=>{
    entry.creatures=[{id:'inside',kind:'goblin_runt',x:32,y:28},{id:'edge',kind:'goblin_runt',x:36,y:28},
      {id:'diagonal',kind:'goblin_runt',x:36,y:36},{id:'outside',kind:'goblin_runt',x:36.01,y:28}];
    ExplosiveBarrels.arm(s,b);advance(s,5000);
    assert.eq(s.save.energy,80);assert.eq(s.save.conditions.burning.remainingMs,6000);
    assert.eq(hits.map(h=>h.id).sort().join(),'edge,inside');assert.truthy(hits.every(h=>h.n===20&&h.source==='player'));
    assert.eq(entry.creatures[0]._burnState.remainingMs,6000);assert.falsy(entry.creatures[2]._burnState);
    assert.eq(fire.length,5);assert.truthy(fire.every(c=>c.durationMs===10000&&Math.hypot(c.cellIX-3,c.cellIY-3)<=1));
    assert.eq(blasts.length,1);assert.eq(blasts[0].sparks,'trailspark');assert.eq(blasts[0].chips,'timber');
  }));
  test('explosive barrels: chest interaction arms without loot and damage uses armour plus shielding',()=>fixture(({scene:s,barrel:b})=>{
    s.save.opened=[];s.save.armor={chestplate:{tier:3},helmet:{tier:2}};
    s.save.shieldPotionUntil=Date.now()+60000;
    const expected=Conditions.fireDamage({...s.save},Combat.incomingDamage(s.save,20));
    assert.lt(expected,20,'armour and shielding mitigate the blast');
    s.flash=()=>{};
    const ctx={scene:s,save:s.save,sx:0,sy:0,dirty:false};
    assert.truthy(INTERACTABLES.chest.custom(ctx,b));
    assert.eq(ExplosiveBarrels.countdown(s,b),5);assert.eq(s.save.opened.length,0);
    assert.falsy(ctx.dirty,'no loot transaction runs');assert.falsy(s.save.inventory);
    advance(s,5000);assert.eq(s.save.energy,100-expected);
  }));
  test('explosive barrels: immunity prevents injury and countdown flashes without changing idle ordinary barrels',()=>fixture(({scene:s,barrel:b,entry,hits})=>{
    s.save.fireResistancePotionUntil=Date.now()+60000;
    entry.creatures=[{id:'immune',kind:'goblin_runt',x:28,y:28,fireResistancePotionUntil:Date.now()+60000}];
    assert.eq(ExplosiveBarrels.tint(s,b),null);assert.eq(ExplosiveBarrels.tint(s,{...b,redBarrel:true}),0xff2424);
    ExplosiveBarrels.arm(s,b);const tint=ExplosiveBarrels.tint(s,b);advance(s,200);
    assert.truthy(ExplosiveBarrels.tint(s,b)!==tint);
    advance(s,4800);assert.eq(s.save.energy,100);assert.eq(hits.length,0);assert.falsy(entry.creatures[0]._burnState);
  }));
})();
