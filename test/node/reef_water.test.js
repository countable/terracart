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
  test('reef water: scenery stays in connected shallow water and finite chests are reachable from dry shore',()=>{
    const ctx=fixture(),original=ctx.grid.slice();run(ReefLayout.dressSteps(ctx));
    const corals=ctx.zoneDress.corals,chests=ctx.zoneDress.objects.filter(o=>o.kind==='chest');
    assert.gt(corals.length,0);assert.eq(chests.length,2);
    for(const o of corals) {
      assert.includes([0,1,2,3,4,5,6], o.variant, 'only selected coral frames spawn');
      assert.eq(ctx.grid[o._iy*N+o._ix],T.WATER,'coral only decorates water');
      assert.lte(o._ix,16,'five-cell water extension stays bounded');
    }
    for(const o of chests) {
      assert.eq(ctx.grid[o._iy*N+o._ix],T.WATER);
      let reachable=false;
      for(let i=0;i<N*N;i++) if(ctx.field.coverage[i]&&WorldGen.isSpawnCell(ctx.grid,N,N,i%N,Math.floor(i/N),ctx.spawnOpts,'reward')) {
        if((i%N-o._ix)**2+(Math.floor(i/N)-o._iy)**2<=4)reachable=true;
      }
      assert.truthy(reachable,'ordinary two-cell reach from eligible shore');
      assert.falsy(corals.some(c=>c._ix===o._ix&&c._iy===o._iy),'chest does not collide with coral sprite');
    }
    assert.eq(ctx.grid.join(','),original.join(','),'water never repainted to land');
  });
  test('reef water: rebuilds preserve tier, identity and normal opened ledger outside quota seeding',()=>{
    const a=fixture(),b=fixture();b.tileEdgeM*=3;
    run(ReefLayout.dressSteps(a));run(ReefLayout.dressSteps(b));
    const signature=ctx=>ctx.zoneDress.objects.map(o=>`${o.id}:${o.kind}:${o.vista||o.deposit}`).sort().join('|');
    assert.eq(signature(a),signature(b),'save-relative metre scale cannot reroll reef finds');
    const chests=a.zoneDress.objects.filter(o=>o.kind==='chest');
    WorldGen.seedChestTiers(chests);
    assert.eq(chests.map(o=>chestTier(o)).sort().join(','),'2,3','ordinary quota does not promote authored reef tiers');
    for(const o of chests) {
      assert.falsy(restocks(o),'finite chest is not a daily crate');
      assert.truthy(isSpent(o,spentSets(null,{opened:[o.id]})),'existing opened ledger consumes chest');
    }
  });
  test('reef water: observer anchors decorate but never duplicate finite site rewards',()=>{
    const ctx=fixture(false);run(ReefLayout.dressSteps(ctx));
    assert.gt(ctx.zoneDress.corals.length,0);
    assert.eq(ctx.zoneDress.objects.length,0,'neighbour fragment owns neither chests nor ore');
  });
  test('reef shrine: a park-shore site gets one gated daily shrine without duplicating a nexus', () => {
    const ctx = fixture(); ctx.field.anchors[0].parkShore = true;
    ctx.zoneDress.nexus = [
      { zoneAnchor: ctx.field.anchors[0].key, kind: 'grove', variant: 'orchard', poiId: 'inland-park-shrine' },
      { zoneAnchor: ctx.field.anchors[0].key, kind: 'beach', variant: 'mystic_reef', poiId: null }
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
    existing.zoneDress.nexus = [{ zoneAnchor: existing.field.anchors[0].key, kind: 'beach', variant: 'mystic_reef', poiId: 'existing-daily-shrine' }];
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
  test('reef water: explicit water spawn gate preserves protection, occupancy and road bands',()=>{
    const ctx=fixture(),i=12+12*N,opts={...ctx.spawnOpts,waterOnly:true};
    assert.falsy(WorldGen.isSpawnCell(ctx.grid,N,N,12,12,ctx.spawnOpts,'reward'),'ordinary spawns still refuse water');
    assert.truthy(WorldGen.isSpawnCell(ctx.grid,N,N,12,12,opts,'reward'),'explicit water mode permits terrain only');
    for(const bit of [W.RESTRICTED,W.QUIET,W.SENSITIVE_SITE,W.KINDERGARTEN,W.KERB]) {
      ctx.spawnOpts.spawnWhy[i]=W.TERRAIN|bit;
      assert.falsy(WorldGen.isSpawnCell(ctx.grid,N,N,12,12,opts,'reward'),'other safety reasons survive water exception');
    }
    ctx.spawnOpts.spawnWhy[i]=W.TERRAIN;ctx.spawnOpts.roadMask[i]=1;
    assert.falsy(WorldGen.isSpawnCell(ctx.grid,N,N,12,12,opts,'reward'));
    ctx.spawnOpts.roadMask[i]=0;ctx.spawnOpts.occupied.add(i);
    assert.falsy(WorldGen.isSpawnCell(ctx.grid,N,N,12,12,opts,'reward'));
    assert.falsy(WorldGen.isSpawnCell(ctx.grid,N,N,11,12,opts,'reward'),'water-only mode cannot admit arbitrary land');
  });
  test('reef water: tide pickup reservations do not erase the shoreline or water extension',()=>{
    const ctx=fixture();
    for(let i=0;i<N*N;i++)if(ctx.field.coverage[i])ctx.spawnOpts.occupied.add(i);
    run(ReefLayout.dressSteps(ctx));
    assert.gt(ctx.zoneDress.corals.length,0,'inactive potential tide seats do not hide coral');
    assert.eq(ctx.zoneDress.objects.filter(o=>o.kind==='chest').length,2,'ground pickup reservations do not block shore reach');
    assert.eq(ctx.zoneDress.objects.filter(o=>o.kind==='mineralrock').length,0,'dry ore still respects every occupied cell');
  });
})();
