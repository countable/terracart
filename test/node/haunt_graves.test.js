(function () {
  test('Haunt graves: seeded selection marks a stable subset without changing headstone identity',()=>{
    const N=48,WG=WorldGen;
    const build=tx=>{
      const rec={key:'haunt-graves',variant:'haunted_forest_path',size:'minor',halfW:3.5,
        line:[{x:2.5,y:24.5},{x:45.5,y:24.5}]};
      const grid=new Uint8Array(N*N).fill(WG.T.FOREST),roadMask=new Uint8Array(N*N);
      for(let x=2;x<46;x++){grid[24*N+x]=WG.T.ROAD;roadMask[24*N+x]=1;}
      return StreetVariants.dress({index:{extent:N,lines:[rec],dressingLines:[rec]},N,tx,ty:0,tileEdgeM:N*7,grid,
        spawnOpts:{roadMask,spawnWhy:new Uint16Array(N*N),occupied:new Set()}}).objects.filter(o=>o.kind==='headstone');
    };
    let marked=0,ordinary=0;
    for(let tx=0;tx<12;tx++) {
      const a=build(tx),b=build(tx);assert.gt(a.length,0);
      assert.eq(JSON.stringify(a),JSON.stringify(b),'same headstones and triggers on reload');
      for(const o of a)if(o.graveGhostRadiusCells!=null){assert.eq(o.graveGhostRadiusCells,1);marked++;}else ordinary++;
    }
    assert.gt(marked,0,'some graves can raise a ghost');assert.gt(ordinary,marked,'most graves remain ordinary');
  });
})();
