(function () {
  const WG = WorldGen, SV = StreetVariants, T = WG.T;
  function fixture(line = [{x:2.5,y:12.5},{x:27.5,y:12.5}]) {
    const N=32, grid=new Uint8Array(N*N).fill(T.GRASS);
    const rec={key:'puddle-lane',variant:'overgrown',size:'minor',halfW:3.5,line};
    const index={extent:N,lines:[rec],dressingLines:[rec]};
    return {N,grid,index,roadMask:new Uint8Array(N*N),spawnWhy:new Uint16Array(N*N),occupied:new Set()};
  }
  const paint=f=>WG.runSteps(SV.paintTerrainSteps(f));
  const water=f=>Array.from(f.grid, (t,i)=>t===T.WATER?i:-1).filter(i=>i>=0);
  test('Gone to Seed puddles occupy only the verge opposite its ordered trees',()=>{
    for(const line of [undefined,[{x:27.5,y:12.5},{x:2.5,y:12.5}],[{x:2.5,y:2.5},{x:27.5,y:27.5}]]) {
      const a=fixture(line),b=fixture(line);paint(a);paint(b);
      assert.eq(JSON.stringify(Array.from(a.grid)),JSON.stringify(Array.from(b.grid)),'deterministic');
      const cells=water(a);assert.gt(cells.length,0,'some puddles');
      const [start,end]=a.index.lines[0].line,dx=end.x-start.x,dy=end.y-start.y;
      for(const i of cells) {
        const x=i%a.N+.5,y=Math.floor(i/a.N)+.5;
        assert.gt(dx*(y-start.y)-dy*(x-start.x),0,'opposite right-hand tree row');
        const distance=Math.abs(dx*(y-start.y)-dy*(x-start.x))/Math.hypot(dx,dy);
        assert.gte(distance,1,'whole road footprint stays dry');
        assert.lte(distance,2.5,'puddles stay in two-cell verge');
      }
      assert.lt(cells.length,40,'dry gaps separate small puddles');
    }
  });
  test('Gone to Seed puddles preserve crossings, occupied cells and excluded ground',()=>{
    const base=fixture();paint(base);const cells=water(base);assert.gt(cells.length,6);
    const f=fixture(),[occupied,masked,restricted,nexus,covered,building]=cells;
    f.occupied.add(occupied);f.roadMask[masked]=1;
    f.spawnWhy[restricted]=WG.SPAWN_WHY.RESTRICTED;
    f.index.nexusCoverage=new Uint8Array(f.N*f.N);f.index.nexusCoverage[nexus]=1;
    f.zone={coverage:new Uint8Array(f.N*f.N)};f.zone.coverage[covered]=1;f.grid[building]=T.BUILDING;
    f.index.lines.push({key:'crossing',size:'minor',halfW:3.5,line:[{x:15.5,y:0},{x:15.5,y:31}]});
    paint(f);
    for(const i of [occupied,masked,restricted,nexus,covered,building])assert.falsy(f.grid[i]===T.WATER,'protected seat stays dry');
    for(let y=0;y<f.N;y++)assert.falsy(f.grid[y*f.N+15]===T.WATER,'crossing stays dry without raster road mask');
  });
})();
