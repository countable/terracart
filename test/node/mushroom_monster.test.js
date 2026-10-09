(() => {
  function scene() {
    return { cellM:7, depth:2, save:{energy:100,armor:{}}, _shots:[],
      cellAt:()=>({loaded:true,type:WorldGen.T.CAVE_FLOOR}),
      _cellBlocked:()=>false, _nearAny:()=>false,
      _losePlayerEnergy(n) {this.save.energy-=n;return n;},
      _applyCondition(id) {Conditions.apply(this.save,id);} };
  }
  test('mushroom monster: themed mushroom encounters use its own animated atlas art', () => {
    const row=EnemyRoster.get('mushroom_monster');
    assert.eq(row.art.path,'assets/Enemy/spr_mini_monsters_spritesheet.png');
    assert.eq(row.art.directions.down.idle[0],144);
    assert.eq(row.art.directions.left.move[0],174);
    assert.eq(row.art.directions.right.move[0],204);
    assert.eq(row.art.directions.up.move[0],234);
    assert.eq(row.surface.biomes.length,0,'no unrelated biome scatter');
    const n=64;
    const entry={cellsPerEdge:n,tileEdgeM:n*7,grid:new Array(n*n).fill(WorldGen.T.PARK),objects:[],
      zone:{coverage:new Uint8Array(n*n).fill(1),anchors:[{variant:'mushroom_grove'}]}};
    const monsters=EnemyHabitats.surfaceEncounters(entry,0,0,new Set()).filter(c=>c.kind===row.id);
    assert.gt(monsters.length,0,'the actual habitat sampler places mushrooms');
    assert.truthy(monsters.every(c=>c.zoneVariant==='mushroom_grove'));
    entry.zone.anchors[0].variant='meadow';
    assert.falsy(EnemyHabitats.surfaceEncounters(entry,0,0,new Set()).some(c=>c.kind===row.id));
  });
  test('mushroom monster: visible puff carries confusion and weak melee does not renew it', () => {
    const s=scene(), row=EnemyRoster.get('mushroom_monster'), c={kind:row.id,id:'test_mushroom',x:0,y:0};
    rosterEnemyAttack(s,c,row,10000,14,0,false,.1);
    assert.eq(s._shots.length,0,'puff winds up first');
    rosterEnemyAttack(s,c,row,10700,14,0,false,.1);
    assert.eq(s._shots.length,1);
    assert.eq(s._shots[0].projectile,'confusion_puff');
    assert.eq(s._shots[0].condition,'confused');
    assert.eq(s._shots[0].speedMps,row.projectileSpeedMetersPerSecond);
    assert.truthy(s._shots[0].hostile);
    s.save.conditions={confused:{remainingMs:9000}};
    rosterEnemyAttack(s,c,row,10800,2,0,false,.1);
    rosterEnemyAttack(s,c,row,10950,2,0,false,.1);
    assert.eq(s.save.energy,98,'weak melee deals its declared two damage');
    assert.eq(s._shots.length,1,'no puff while already confused');
    assert.eq(s.save.conditions.confused.remainingMs,9000,'melee does not refresh confusion');
    delete s.save.conditions.confused;
    rosterEnemyAttack(s,c,row,11000,14,0,false,.1);
    assert.eq(s._shots.length,1,'original puff cooldown survives attack-mode switching');
    rosterEnemyAttack(s,c,row,16000,14,0,false,.1);
    rosterEnemyAttack(s,c,row,16700,14,0,false,.1);
    assert.eq(s._shots.length,2,'puff resumes after confusion ends');
  });
  test('mushroom monster: puffs require at least one cell of target separation', () => {
    const s=scene(), row=EnemyRoster.get('mushroom_monster'), c={kind:row.id,id:'range_mushroom',x:0,y:0};
    rosterEnemyAttack(s,c,row,10000,s.cellM-.01,0,false,.1);
    rosterEnemyAttack(s,c,row,11000,s.cellM-.01,0,false,.1);
    assert.eq(s._shots.length,0,'no close-range puff');
    assert.truthy(c._attackWindupUntil == null,'cannot begin winding up inside one cell');
    rosterEnemyAttack(s,c,row,12000,s.cellM,0,false,.1);
    rosterEnemyAttack(s,c,row,12700,s.cellM,0,false,.1);
    assert.eq(s._shots.length,1,'exactly one cell permits the puff');
  });
  test('mushroom monster: moving inside one cell cancels a pending puff', () => {
    const s=scene(), row=EnemyRoster.get('mushroom_monster'), c={kind:row.id,id:'cancel_mushroom',x:0,y:0};
    rosterEnemyAttack(s,c,row,10000,s.cellM*2,0,false,.1);
    assert.truthy(c._attackWindupUntil != null);
    rosterEnemyAttack(s,c,row,10700,s.cellM/2,0,false,.1);
    assert.eq(s._shots.length,0,'range is checked again when the shot would fire');
    assert.truthy(c._attackWindupUntil == null);
    rosterEnemyAttack(s,c,row,11000,s.cellM*2,0,false,.1);
    assert.eq(s._shots.length,0,'moving away preserves the original cooldown');
    rosterEnemyAttack(s,c,row,16000,s.cellM*2,0,false,.1);
    assert.eq(s._shots.length,0,'the next eligible attack starts a fresh wind-up');
    rosterEnemyAttack(s,c,row,16700,s.cellM*2,0,false,.1);
    assert.eq(s._shots.length,1);
  });
  test('mushroom monster: closes for weak melee only while player is confused and respects suppression', () => {
    const s=scene(), row=EnemyRoster.get('mushroom_monster'), c={kind:row.id,id:'test_mushroom',x:0,y:0,_attackTargetKey:'player'};
    rosterEnemyMove(s,c,row,10000,7,0,false,false,null,.1);
    assert.lt(c.x,0,'holds puff distance normally');
    c.x=0;s.save.conditions={confused:{remainingMs:10000}};
    rosterEnemyMove(s,c,row,10100,7,0,false,false,null,.1);
    assert.gt(c.x,0,'closes for a confused target');
    rosterEnemyAttack(s,c,row,10200,2,0,true,.1);
    rosterEnemyAttack(s,c,row,10400,2,0,true,.1);
    assert.eq(s.save.energy,100,'warded/hidden target is safe from the melee switch');
    delete s.save.conditions.confused;
    s._cellBlocked=()=>true;
    rosterEnemyAttack(s,c,row,17000,14,0,false,.1);
    rosterEnemyAttack(s,c,row,18000,14,0,false,.1);
    assert.eq(s._shots.length,0,'walls stop the puff wind-up');
  });
  test('mushroom monster: a grove resident stands down until struck or its grove is harvested', () => {
    const n=8, edge=n*7, tx=9101, ty=9102, key=WorldGen.tileKey(tx,ty), previous=WorldGen.tileCache.get(key);
    const coverage=new Uint8Array(n*n).fill(1); for (let i=0;i<n;i++) coverage[i*n+n-1]=2;
    const at=(cx,cy)=>({x:tx*edge+(cx+.5)*7,y:ty*edge+(cy+.5)*7});
    const mk=(id,cx,zoneVariant='mushroom_grove')=>{const p=at(cx,1);
      return {kind:'mushroom_monster',id,...p,zoneVariant,_surfaceSpawn:{tx,ty,cx,cy:1,...p}};};
    const grove=mk('grove_a',1), other=mk('grove_b',n-1), cave={kind:'mushroom_monster',id:'cave',x:0,y:0};
    WorldGen.tileCache.set(key,{cellsPerEdge:n,tileEdgeM:edge,depth:0,creatures:[grove,other],
      zone:{coverage,anchors:[{kind:'grove',gx:1,gy:1,variant:'mushroom_grove'},{kind:'grove',gx:2,gy:2,variant:'mushroom_grove'}]}});
    try {
      assert.truthy(EnemyHabitats.unprovoked(grove),'a grove mushroom starts peaceful');
      assert.falsy(EnemyHabitats.unprovoked(cave),'a cave mushroom is hostile as ever');
      const p=at(2,3);
      assert.eq(EnemyHabitats.provokeZone(edge,p.x,p.y,'rainberry'),0,'other crops do not provoke');
      assert.eq(EnemyHabitats.provokeZone(edge,p.x,p.y,'giant_mushroom'),1,'chopping provokes its own grove only');
      assert.falsy(EnemyHabitats.unprovoked(grove));
      assert.truthy(EnemyHabitats.unprovoked(other),'a neighbouring grove stays calm');
      // The real damage handler: a world blow leaves it calm, a player's blow provokes.
      const start=SCENE_SRC.indexOf("  _damageEnemy(c, amount, source = 'player'");
      const end=SCENE_SRC.indexOf('\n  }\n',start)+'\n  }'.length;
      const damageEnemy=new Function('ENEMY_HEALTH_RING_MS','DMG_POPUP_BEAT_MS',
        'return ({'+SCENE_SRC.slice(start,end)+'})._damageEnemy;')(1000,100);
      const s={save:{boonUntil:{},relics:{}},_popDamageNumber(){},resolveDefeat(){}};
      damageEnemy.call(s,other,1,'burn');
      assert.truthy(EnemyHabitats.unprovoked(other),'the ground\'s own damage does not provoke');
      damageEnemy.call(s,other,1,'player');
      assert.falsy(EnemyHabitats.unprovoked(other),'a player\'s blow provokes');
      assert.truthy(/const standDown = [^;]*\bunprovoked\b/.test(SCENE_SRC),'unprovoked is a standDown reason');
    } finally { if (previous) WorldGen.tileCache.set(key,previous); else WorldGen.tileCache.delete(key); }
  });
})();
