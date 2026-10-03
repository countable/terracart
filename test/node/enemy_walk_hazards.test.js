(function () {
const exposure = new Function('x0', 'y0', 'x1', 'y1', 'visit',
  SCENE_SRC.match(/\n  _walkHazardExposure\(x0, y0, x1, y1, visit\) \{([\s\S]*?)\n  \}\n/)[1]);
const occupied = new Function('tx', 'ty', 'cx', 'cy',
  SCENE_SRC.match(/\n  _walkHazardCell\(tx, ty, cx, cy\) \{([\s\S]*?)\n  \}\n/)[1]);
function scene(rate = () => 0) {
  return { cellM: 1, depth: 2, cellsPerTile: WorldGen.TILE_PX,
    originPx: {x: 0, y: 0}, startWorldM: {x: 0, y: 0}, mPerPx: 1,
    save: {energy: 100}, cellAt: () => ({loaded: true, type: WorldGen.T.CAVE_FLOOR}),
    _cellBlocked: () => false, _nearAny: () => false,
    _walkHazardCell: rate, _walkHazardExposure: exposure,
    _damageEnemy(c, damage, source) { c._hp -= damage; this.source = source; return c._hp <= 0; } };
}
const foe = () => ({kind: 'zombie', id: 'hazard_zombie', x: .5, y: .5, _hp: 100});

test('enemy walk hazards: one-cell detour clears a shrub without crossing it or exceeding pace', () => {
  const s = scene((tx,ty,x,y) => x === 1 && y === 0 ? 1 : 0), c = foe();
  let exposureSum = 0;
  for (let i=0;i<100;i++) {
    const dx=4.5-c.x, dy=.5-c.y, distance=Math.hypot(dx,dy);
    if (distance < .1) break;
    const x=c.x,y=c.y,step=Math.min(.1,distance);
    enemySweep(s,c,EnemyRoster.get(c.kind),x+dx/distance*step,y+dy/distance*step,i*50);
    assert.lte(Math.hypot(c.x-x,c.y-y),step+1e-9,'detour spends the same movement budget');
    exposureSum += exposure.call(s,x,y,c.x,c.y);
  }
  assert.gt(c.x,3,'rounds the shrub and resumes pursuit');
  assert.eq(exposureSum,0,'no sharp-cell crossing');
});

test('enemy walk hazards: broad belt is passable when no single-cell detour fits', () => {
  const s=scene(()=>1),c=foe();
  enemySweep(s,c,EnemyRoster.get(c.kind),2.5,.5,0);
  assert.eq(c.x,2.5); assert.eq(c.y,.5);
  s._cellBlocked = (x,y)=>x>=3;
  enemySweep(s,c,EnemyRoster.get(c.kind),4.5,.5,100);
  assert.lt(c.x,3,'soft hazards never bypass a hard obstacle');
});

test('enemy walk hazards: fractional health damage follows movement time at different frame rates', () => {
  for (const rate of [1,2]) for (const fps of [10,30,60,144]) {
    const s=scene(()=>rate),c=foe();
    enemyWalkHazardTick(s,c,0);
    for(let i=1;i<=fps*3;i++) { c.x += 1/fps; enemyWalkHazardTick(s,c,i*1000/fps); }
    assert.eq(c._hp,100-3*rate,rate+' damage/s at '+fps+' fps');
    assert.eq(s.save.energy,100,'enemy hazards consume HP, not player energy');
    assert.eq(s.source,'obstacle'); assert.falsy(Combat.isPlayerKill(s.source));
    enemyWalkHazardTick(s,c,10000);
    assert.eq(c._hp,100-3*rate,'standing still does not hurt');
  }
});

test('enemy walk hazards: live overlap uses max damage and stops after burning or cutting', () => {
  const s=scene(); s.cellM=8;s.cellsPerTile=32;s.tileEdgeM=256;s._walkHazardCell=occupied;
  const key=WorldGen.tileKey(0,0),previous=WorldGen.tileCache.get(key);
  const bramble={id:'enemy_bramble',kind:'wildplant',crop:'shrub',_streetArt:'bramble',x:4,y:4};
  const spikes={id:'enemy_spikes',kind:'stakes',_street:'burned',x:4,y:4};
  WorldGen.tileCache.set(key,{_spawned:true,cellsPerEdge:32,tileEdgeM:256,objects:[spikes],wildplants:[bramble]});
  const c=foe();c.x=2;c.y=4;enemyWalkHazardTick(s,c,0);
  const walk=(start)=>{for(let i=1;i<=10;i++){c.x+=.1;enemyWalkHazardTick(s,c,start+i*100);}};
  try {
    walk(0);assert.eq(c._hp,98,'two overlapping hazards cost max two');
    s.save.burnedObjects=[spikes.id];walk(1000);assert.eq(c._hp,97,'burned spikes no longer hurt');
    s.save.picked=[bramble.id];walk(2000);assert.eq(c._hp,97,'cut bramble no longer hurts');
    assert.eq(enemyWalkHazardRate(s,4,4),0,'removed hazards also stop steering');
  } finally {if(previous)WorldGen.tileCache.set(key,previous);else WorldGen.tileCache.delete(key);}
});
test('enemy walk hazards: real damage handler bypasses armour and keeps environmental kill credit', () => {
  const start=SCENE_SRC.indexOf("  _damageEnemy(c, amount, source = 'player'");
  const end=SCENE_SRC.indexOf('\n  }\n',start)+'\n  }'.length;
  const damage = new Function('ENEMY_HEALTH_RING_MS','DMG_POPUP_BEAT_MS','enemySplit',
    'return ({'+SCENE_SRC.slice(start,end)+'})._damageEnemy;')(1000,100,
      ()=>{throw new Error('an obstacle must not trigger slime splitting');});
  const c={kind:'armoured_demon',id:'armoured_hazard',x:.5,y:.5};
  assert.gt(Combat.monster(c.kind).armor,0,'exercise armour');
  const s=scene(()=>2);s._damageEnemy=damage;s._popDamageNumber=()=>{};
  s.resolveDefeat=(victim,source)=>{s.deathSource=source;};
  const hp=Combat.hp(c);
  enemyWalkHazardTick(s,c,0);
  for(let i=1;i<=10;i++){c.x+=.01;enemyWalkHazardTick(s,c,i*100);}
  assert.eq(Combat.hp(c),hp-2,'armour cannot reduce environmental damage');
  c._hp=1;
  for(let i=11;i<=20;i++){c.x+=.01;enemyWalkHazardTick(s,c,i*100);}
  assert.eq(s.deathSource,'obstacle');
  assert.falsy(Combat.isPlayerKill(s.deathSource),'kill does not earn player quest or elite credit');
});
})();
