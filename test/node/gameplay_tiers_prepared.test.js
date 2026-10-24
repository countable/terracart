// One tile build shares source geography while zone/access overlays stay live.
(function () {
  const N=40,edge=N*WorldGen.CELL_M;
  const ring=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1},{x:x0,y:y0}];
  const polygon=(klass,geom,tags={})=>({type:3,tags:{class:klass,...tags},geom:[geom]});
  const line=(klass,geom,tags={})=>({type:2,tags:{class:klass,...tags},geom});
  function fixture() {
    const transport={name:'transportation',extent:edge,features:[
      line('primary',[[{x:-7,y:140},{x:287,y:140}]]),
      line('footway',[[{x:105,y:-7},{x:105,y:287}]]),
      line('pier',[[{x:7,y:35},{x:56,y:35}]],{access:'yes'}),
      line('minor',[[{x:210,y:0},{x:210,y:280}]],{access:'private'})],
      parkingLanes:[{f:{tags:{class:'service'}},lines:[[{x:0,y:210},{x:140,y:210}]]}]};
    return {tx:0,ty:0,cellsPerEdge:N,tileEdgeM:edge,
      grid:new Uint8Array(N*N),spawnWhy:new Uint32Array(N*N),roadClass:new Uint16Array(N*N),layers:[
        {name:'landuse',extent:edge,features:[polygon('park',ring(0,0,280,280)),polygon('parking',ring(0,175,70,280))]},
        {name:'water',extent:edge,features:[polygon('water',ring(0,0,70,70))]},
        {name:'building',extent:edge,features:[polygon('building',ring(28,28,49,49))]},transport]};
  }
  const drain=steps=>WorldGen.runSteps(steps);
  const compare=(a,b,label)=>{
    assert.eq(Array.from(a.tiers).join(','),Array.from(b.tiers).join(','),label+' tiers');
    assert.eq(Array.from(a.reasons).join(','),Array.from(b.reasons).join(','),label+' reasons');
    assert.eq(JSON.stringify(a.stats),JSON.stringify(b.stats),label+' counts and area');
  };
  test('gameplay tiers prepared: reuse source geometry across zone and live-access changes',()=>{
    const entry=fixture(),prepared=drain(GameplayTiers.prepareTileSteps(entry));
    compare(drain(GameplayTiers.buildTileSteps(entry,prepared)),GameplayTiers.buildTile(entry),'initial');
    const anchors=['grove','stones','tar','quarry','beach'].map(kind=>({kind}));
    const coverage=Uint16Array.from({length:N*N},(_,i)=>Math.floor(i/13)%6);
    const zoned={...entry,zone:{anchors,coverage}};
    zoned.spawnWhy[10*N+10]=WorldGen.SPAWN_WHY.RESTRICTED;
    zoned.roadClass[30*N+30]=WorldGen.ROAD_CLASS_LOT_BUFFER;
    compare(drain(GameplayTiers.buildTileSteps(zoned,prepared)),GameplayTiers.buildTile(zoned),'final');
    // Access and lot restrictions can disappear without poisoning the prepared masks.
    zoned.spawnWhy.fill(0);zoned.roadClass.fill(0);
    compare(drain(GameplayTiers.buildTileSteps(zoned,prepared)),GameplayTiers.buildTile(zoned),'released restrictions');
    compare(drain(GameplayTiers.buildTileSteps(entry,prepared)),GameplayTiers.buildTile(entry),'zones removed');
  });
  test('gameplay tiers prepared: source passes run once and final overlay remains sliced',()=>{
    const entry=fixture(),labels=[];
    const it=GameplayTiers.prepareTileSteps(entry);let step;
    do{step=it.next();if(!step.done)labels.push(step.value);}while(!step.done);
    const prepared=step.value;
    assert.truthy(labels.includes('gameplay source geometry'));
    for(let pass=0;pass<2;pass++) {
      const overlays=GameplayTiers.buildTileSteps(entry,prepared),overlayLabels=[];
      do{step=overlays.next();if(!step.done)overlayLabels.push(step.value);}while(!step.done);
      assert.eq(overlayLabels.join(','),'gameplay tier tile','only the live overlay is repeated');
    }
  });
})();
