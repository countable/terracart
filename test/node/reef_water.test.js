(() => {
  const N=32,T=WorldGen.T,W=WorldGen.SPAWN_WHY;
  const run=it=>{let r;do {r=it.next();}while(!r.done);return r.value;};
  function fixture(owned=true) {
    const grid=new Uint8Array(N*N).fill(T.SAND),coverage=new Uint16Array(N*N),spawnWhy=new Uint16Array(N*N);
    for(let y=0;y<N;y++)for(let x=0;x<N;x++) {
      const i=y*N+x;
      if(x>=12) {grid[i]=T.WATER;spawnWhy[i]=W.TERRAIN;}
      if(x>=5&&x<12&&y>=6&&y<=26)coverage[i]=1;
    }
    const a={kind:'beach',variant:'mystic_reef',owned,key:12345,lx:1100,ly:2000,gx:1100,gy:2000,upm:N*7/4096};
    return {field:{anchors:[a],coverage},zoneDress:{objects:[],corals:[]},N,tx:0,ty:0,tileEdgeM:N*7,grid,
      spawnOpts:{spawnWhy,roadMask:new Uint8Array(N*N),occupied:new Set()}};
  }
  test('reef water: Excluded water retains its appearance and receives no scenery or finite finds',()=>{
    const ctx=fixture(),original=ctx.grid.slice();run(ReefLayout.dressSteps(ctx));
    assert.eq(ctx.zoneDress.corals.length,0,'Excluded refuses coral scenery');
    assert.eq(ctx.zoneDress.objects.filter(o=>o.kind==='chest').length,0,'shore reach does not grant a water exception');
    for(const o of ctx.zoneDress.objects) assert.truthy(ctx.grid[o._iy*N+o._ix]!==T.WATER,'remaining reef content stays on eligible land');
    assert.eq(ctx.grid.join(','),original.join(','),'water remains visibly water');
  });
  test('reef water: rebuilds preserve the surviving dry-land records across metre scales',()=>{
    const a=fixture(),b=fixture();b.tileEdgeM*=3;
    run(ReefLayout.dressSteps(a));run(ReefLayout.dressSteps(b));
    const signature=ctx=>ctx.zoneDress.objects.map(o=>`${o.id}:${o.kind}:${o.vista||o.deposit}`).sort().join('|');
    assert.gt(a.zoneDress.objects.length,0,'dry shore shrine/resources remain');
    assert.eq(signature(a),signature(b),'save-relative metre scale cannot reroll surviving reef records');
  });
  test('reef water: observer anchors cannot bypass Excluded for scenery or duplicate finite rewards',()=>{
    const ctx=fixture(false);run(ReefLayout.dressSteps(ctx));
    assert.eq(ctx.zoneDress.corals.length,0);
    assert.eq(ctx.zoneDress.objects.length,0,'neighbour fragment owns neither chests nor ore');
  });
  test('reef shrine: a park-shore site gets one gated daily shrine without duplicating a nexus', () => {
    const ctx = fixture(); ctx.field.anchors[0].parkShore = true;
    ctx.zoneDress.nexus = [
      { zoneAnchor: ctx.field.anchors[0].key, zoneKind: 'grove', zoneVariant: 'orchard', poiId: 'inland-park-shrine' },
      { zoneAnchor: ctx.field.anchors[0].key, zoneKind: 'beach', zoneVariant: 'mystic_reef', poiId: null }
    ];
    run(ReefLayout.dressSteps(ctx));
    const shrines = ctx.zoneDress.objects.filter(o => o.kind === 'grove_shrine');
    assert.eq(shrines.length, 1);
    const shrine = shrines[0];
    assert.eq(shrine._zoneObjectFrame, 38);
    assert.eq(shrine.shrineKind, Shrines.kindForZoneVariant('mystic_reef'));
    assert.eq(ctx.grid[shrine._iy * N + shrine._ix], T.SAND);
    assert.truthy(WorldGen.isSpawnCell(ctx.grid, N, N, shrine._ix, shrine._iy,
      { ...ctx.spawnOpts, occupied: null }, 'reward'));
    const rebuilt = fixture(); run(ReefLayout.dressSteps(rebuilt));
    assert.eq(rebuilt.zoneDress.objects.find(o => o.kind === 'grove_shrine').id, shrine.id);
    const existing = fixture();
    existing.zoneDress.nexus = [{ zoneAnchor: existing.field.anchors[0].key, zoneKind: 'beach', zoneVariant: 'mystic_reef', poiId: 'existing-daily-shrine' }];
    run(ReefLayout.dressSteps(existing));
    assert.eq(existing.zoneDress.objects.filter(o => o.kind === 'grove_shrine').length, 0, 'existing POI shrine remains the only daily shrine');
    const blocked = fixture();
    for (let i = 0; i < N * N; i++) if (blocked.field.coverage[i]) blocked.spawnOpts.spawnWhy[i] |= W.RESTRICTED;
    run(ReefLayout.dressSteps(blocked));
    assert.eq(blocked.zoneDress.objects.filter(o => o.kind === 'grove_shrine').length, 0, 'protected land refuses shrine');
    const occupied = fixture();
    for (let i = 0; i < N * N; i++) if (occupied.field.coverage[i]) occupied.spawnOpts.occupied.add(i);
    run(ReefLayout.dressSteps(occupied));
    assert.eq(occupied.zoneDress.objects.filter(o => o.kind === 'grove_shrine').length, 0, 'occupied shore refuses shrine');
  });
  test('reef water: no spawn class or waterOnly flag can reopen Excluded water',()=>{
    const ctx=fixture(),opts={...ctx.spawnOpts,waterOnly:true,gameplayTiers:new Uint8Array(N*N).fill(4)};
    for(const cls of WorldGen.SPAWN_CLASSES) {
      assert.falsy(WorldGen.isSpawnCell(ctx.grid,N,N,12,12,ctx.spawnOpts,cls),'water excluded for '+cls);
      assert.falsy(WorldGen.isSpawnCell(ctx.grid,N,N,12,12,opts,cls),'waterOnly cannot override '+cls);
    }
    opts.gameplayTiers.fill(1);
    assert.falsy(WorldGen.isSpawnCell(ctx.grid,N,N,12,12,opts,'reward'),'live water still rejects an erroneous cached Core tier');
  });
  test('reef water: tide reservations cannot move dry resources into Excluded water',()=>{
    const ctx=fixture();
    for(let i=0;i<N*N;i++)if(ctx.field.coverage[i])ctx.spawnOpts.occupied.add(i);
    run(ReefLayout.dressSteps(ctx));
    assert.eq(ctx.zoneDress.corals.length,0,'water scenery remains excluded');
    assert.eq(ctx.zoneDress.objects.filter(o=>o.kind==='chest').length,0,'no water reward fallback');
    assert.eq(ctx.zoneDress.objects.filter(o=>o.kind==='mineralrock').length,0,'dry ore still respects every occupied cell');
  });
})();
