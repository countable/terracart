(function () {
  function build(blocked=false, duplicate=false, variant='overgrown') {
    const WG=WorldGen,N=32,grid=new Uint8Array(N*N).fill(WG.T.FOREST);
    const rec={key:'overgrown-cache',variant,size:'minor',halfW:3.5,
      line:[{x:2.5,y:16.5},{x:29.5,y:16.5}]};
    const index={extent:N,lines:[rec],dressingLines:duplicate?[rec,{...rec}]:[rec]};
    const roadMask=new Uint8Array(N*N),spawnWhy=new Uint16Array(N*N);
    for(let x=2;x<30;x++){grid[16*N+x]=WG.T.ROAD;roadMask[16*N+x]=1;}
    if(blocked)spawnWhy.fill(WG.SPAWN_WHY.RESTRICTED);
    const out=StreetVariants.dress({index,N,tx:0,ty:0,tileEdgeM:N*7,grid,
      spawnOpts:{roadMask,spawnWhy,occupied:new Set()}});
    return {out,caches:out.objects.filter(o=>o.cache)};
  }
  test('concealed caches: configured routes get one safe themed container',()=>{
    for(const id of ['orchard','old_growth_path','haunted_forest_path','pilgrim','spider_path','paralysis_path','confusion_path']) {
      const a=build(false,false,id),b=build(false,false,id);
      assert.eq(a.caches.length,1,id);assert.eq(a.caches[0].cacheTheme,id);
      assert.eq(JSON.stringify(a.caches),JSON.stringify(b.caches));
      assert.eq(build(true,false,id).caches.length,0);
      assert.eq(build(false,true,id).caches.length,1);
      if(id==='orchard')assert.eq(Math.abs(Math.floor(a.caches[0].y/7)-16),1,'Orchard keeps first verge only');
    }
  });
  test('Gone to Seed cache: one deterministic concealed container in safe opposite verge',()=>{
    const a=build(),b=build();
    assert.eq(a.caches.length,1);assert.eq(JSON.stringify(a.caches),JSON.stringify(b.caches));
    assert.eq(build(false,true).caches.length,1,'duplicate fragments do not multiply caches');
    assert.eq(build(true).caches.length,0,'blocked terrain cannot host a cache');
    const c=a.caches[0],iy=Math.floor(c.y/7);
    assert.inRange(iy,17,19,'opposite the tree row and within influence');
    assert.truthy(c.concealed);assert.eq(c.cacheTheme,'overgrown');assert.falsy(c.fixedLoot);assert.falsy(c.crate);
    const others=a.out.objects.filter(o=>o.id!==c.id);
    assert.falsy(others.some(o=>Math.floor(o.x/7)===Math.floor(c.x/7)&&Math.floor(o.y/7)===iy),'no shared furniture cell');
  });
})();
