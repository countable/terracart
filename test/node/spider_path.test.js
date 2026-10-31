(function () {
  function dressing(block, tier) {
    const N = 64, extent = 4096, edge = N * 7;
    const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
    const spawnOpts = { occupied: new Set(), roadMask: new Uint8Array(N * N),
      roadClass: new Uint8Array(N * N), spawnWhy: new Uint16Array(N * N), pois: [] };
    if (block) spawnOpts.spawnWhy.fill(block);
    if (tier) spawnOpts.gameplayTiers = new Uint8Array(N*N).fill(tier);
    const rec = { variant: 'spider_path', key: 'spider-test', lineKey: 'spider-test', size: 'path',
      line: [{x: 512, y: 2048}, {x: 3584, y: 2048}], halfW: 1.5 };
    const index = { extent, lines: [rec], vehicleLines: [], hoardPois: [] };
    const result = StreetVariants.dress({ index, tx: 0, ty: 0, N, tileEdgeM: edge, grid, spawnOpts });
    result.fixture = { grid, cellsPerEdge:N, tileEdgeM:edge, _spawnOpts:spawnOpts,
      streetLairs:result.lairs, buildingShapes:[], creatures:[] };
    return result;
  }
  test('Spider Path: deterministic webs and one two-spider garrison preserve path provenance', () => {
    const a = dressing(), b = dressing();
    assert.gt(a.webs.length, 0); assert.lt(a.webs.length, 40);
    assert.eq(JSON.stringify(a.webs), JSON.stringify(b.webs));
    assert.eq(new Set(a.webs.map(w => w.id)).size, a.webs.length);
    assert.truthy(a.webs.every(w => w.permanent && w._street === 'spider_path' && w.expiresAt == null));
    assert.eq(a.lairs.length, 1); assert.eq(a.lairs[0]._street, 'spider_path');
    assert.eq(Lairs.GROUPS.street_spider_path.members[0].kind, 'spider');
    assert.eq(Lairs.GROUPS.street_spider_path.members[0].n, 2);
  });
  test('Spider Path: Passing and Excluded reject hazards while Core paths interrupt old kerb buffers', () => {
    const spawn = result => {
      const entry = result.fixture;
      if (!entry.streetLairs.length) return [];
      const post = entry.streetLairs[0];
      Lairs.stepResidency([{entry,tx:0,ty:0}], {cellM:7,tileEdgeM:entry.tileEdgeM,
        playerM:{x:post.lx,y:post.ly},homeM:{x:-5000,y:0},caughtSet:new Set(),buildings:false});
      return entry.creatures;
    };
    const privateGround = dressing(WorldGen.SPAWN_WHY.PRIVATE);
    assert.eq(privateGround.webs.length,0);
    assert.eq(spawn(privateGround).length,0);
    const passing = dressing(WorldGen.SPAWN_WHY.KERB,3);
    assert.eq(passing.webs.length,0);
    assert.eq(spawn(passing).length,0,'an encounter post cannot grant fast spiders a Passing seat');
    const corePath = dressing(WorldGen.SPAWN_WHY.KERB,1);
    assert.gt(corePath.webs.length,0,'the core path overrides old kerb evidence');
    assert.gt(spawn(corePath).length,0,'its spiders use the same core tier');
  });
  function vergeDressing(tx = 0, options = {}) {
    const N=64, cell=7, edge=N*cell;
    const rec={variant:'spider_path',key:'verge-spider-'+tx,lineKey:'verge-spider-'+tx,size:'path',halfW:1.5,
      line:options.diagonal ? [{x:8.5,y:8.5},{x:55.5,y:55.5}] : [{x:8.5,y:32.5},{x:55.5,y:32.5}]};
    const grid=new Uint8Array(N*N).fill(WorldGen.T.GRASS);
    if (!options.diagonal) for(let x=8;x<=55;x++) grid[32*N+x]=WorldGen.T.PATH;
    const spawnOpts={occupied:new Set(options.occupied || []),roadMask:new Uint8Array(N*N),
      spawnWhy:new Uint32Array(N*N),...(options.tier ? {gameplayTiers:new Uint8Array(N*N).fill(options.tier)} : {})};
    const index={extent:N,lines:[rec],hoardPois:[],nexusCoverage:new Uint8Array(N*N)};
    if(options.exclusions) {
      for(let x=0;x<N;x++) {
        index.nexusCoverage[30*N+x]=1;
        spawnOpts.spawnWhy[34*N+x]=WorldGen.SPAWN_WHY.PRIVATE;
        spawnOpts.roadMask[31*N+x]=1;
      }
    }
    if(options.crossing) index.lines.push({key:'crossing',size:'path',variant:null,halfW:1.5,
      line:[{x:32.5,y:0},{x:32.5,y:64}]});
    const result=StreetVariants.dress({index,tx,ty:0,N,tileEdgeM:edge,grid,spawnOpts});
    const cells=w=>({ix:Math.floor(w.x/cell)-tx*N,iy:Math.floor(w.y/cell)});
    return {result,spawnOpts,index,cells,webs:result.webs.filter(w=>w.id.startsWith('verge_web'))};
  }
  test('Spider Path: about20% of eligible off-path cells receive deterministic permanent silk', () => {
    assert.eq(StreetVariants.VARIANT_BY_ID.spider_path.webDensity,.35);
    assert.eq(StreetVariants.VARIANT_BY_ID.spider_path.vergeWebDensity,.20);
    let eligible=0,placed=0;
    for(let tx=0;tx<24;tx++) {
      const a=vergeDressing(tx),b=vergeDressing(tx),webCells=new Set(a.webs.map(w=>{const c=a.cells(w);return c.iy*64+c.ix;}));
      assert.eq(JSON.stringify(a.webs),JSON.stringify(b.webs));
      for(const w of a.webs) {
        const {ix,iy}=a.cells(w);
        assert.falsy(iy===32 && ix>=8 && ix<=55,'verge roll cannot land on the actual path');
        assert.lte(Math.abs(iy-32),2,'two-cell influence only');
        assert.truthy(w.permanent && w.expiresAt==null && w._street==='spider_path');
      }
      // Ignore rounded end caps; measure the four complete verge rows.
      for(let ix=9;ix<55;ix++) for(const iy of [30,31,33,34]) {
        const i=iy*64+ix;
        if(a.spawnOpts.occupied.has(i) && !webCells.has(i)) continue;
        eligible++;if(webCells.has(i))placed++;
      }
    }
    assert.inRange(placed/eligible,.17,.23,'cell-hashed density approximates20%');
  });
  test('Spider Path: verge webs respect diagonal footprints, other paths, Nexus, private land and occupants', () => {
    const diagonal=vergeDressing(0,{diagonal:true,crossing:true});
    assert.gt(diagonal.webs.length,0);
    for(const w of diagonal.webs) {
      const {ix,iy}=diagonal.cells(w);
      if(ix>=9 && ix<=54 && iy>=9 && iy<=54)
        assert.inRange(Math.abs(ix-iy),2,3,'whole cell clears diagonal path while remaining in influence');
      assert.falsy(ix===32,'crossing path footprint stays clear even without a road mask');
    }
    const excluded=vergeDressing(1,{exclusions:true});
    assert.gt(excluded.webs.length,0,'remaining eligible verge still receives webs');
    assert.truthy(excluded.webs.every(w=>![30,31,34].includes(excluded.cells(w).iy)));
    const normal=vergeDressing(2),blocked=normal.webs.map(w=>{const c=normal.cells(w);return c.iy*64+c.ix;});
    const occupied=vergeDressing(2,{occupied:blocked});
    assert.falsy(occupied.webs.some(w=>{const c=occupied.cells(w);return blocked.includes(c.iy*64+c.ix);}), 'occupied cells remain clear');
    for(const tier of [3,4]) assert.eq(vergeDressing(3,{tier}).webs.length,0);
    for(const cache of normal.result.objects.filter(o=>o.concealed)) {
      const c=normal.cells(cache);
      assert.falsy(normal.result.webs.some(w=>{const p=normal.cells(w);return p.ix===c.ix&&p.iy===c.iy;}),'concealed cache takes its seat before webs');
    }
  });
  test('Spider Path: permanent silk survives days, shots, and reloading without save duplication', () => {
    const original = WorldGen.tileCache, cache = new Map();
    const list = [{ id: 'path_web_test', x: 28, y: 28, permanent: true, _street: 'spider_path' }];
    const s = { depth: 0, cellsPerTile: 8, cellM: 8, mPerPx: 64 / WorldGen.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 28, y: 28 },
      save: { energy: 100 }, cellAt: () => ({ loaded: true, type: WorldGen.T.GRASS }) };
    try {
      WorldGen.tileCache = cache; cache.set('0,0', { spiderPathWebs: list });
      const now = 1800000000000;
      assert.eq(SpiderWebs.lists(s, now).webs.length, 1);
      SpiderWebs.land(s, { depth: 0, cellIX: 3, cellIY: 3, targetX: 28, targetY: 28 }, now);
      assert.eq(s.save.spiderWebs, undefined);
      assert.eq(SpiderWebs.lists(s, now + 10 * 86400000).webs.length, 1);
      assert.truthy(SpiderWebs.contact(s, 'player', now));
      assert.eq(s.save.conditions.paralysis.remainingMs, 6000);
      delete s._spiderWebRuntime;
      assert.eq(SpiderWebs.lists(s, now).webs.length, 1);
      cache.clear(); assert.eq(SpiderWebs.lists(s, now).webs.length, 0);
      cache.set('0,0', { spiderPathWebs: list }); assert.eq(SpiderWebs.lists(s, now).webs.length, 1);
      s.depth = 1; assert.eq(SpiderWebs.lists(s, now).webs.length, 0);
    } finally { WorldGen.tileCache = original; }
  });
})();
