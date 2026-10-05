(() => {
  const W=WorldGen;
  test('quarry gems: one stable low-tier assignment per quarry, with all four kinds represented', () => {
    const kinds=new Set();
    for(let n=0;n<128;n++) {
      const id=`${n*4096},${n*2371}`,first=quarryGemDeposit(id);
      assert.includes(['quartz','topaz','amethyst','crystal'],first);
      assert.eq(quarryGemDeposit(id),first);
      assert.truthy(GEM_DEPOSITS[first].yieldTier<=4);
      kinds.add(first);
    }
    assert.eq(kinds.size,4);
  });

  test('quarry gems: surface dressing assigns every deposit from its stable quarry identity', () => {
    const N=64,grid=new Uint8Array(N*N).fill(W.T.ROCK);
    for(const [gx,gy] of [[2048,2048],[6144,2048],[10240,2048]]) {
      const anchor={kind:'quarry',variant:'quarry-strip-mine',generated:'parking_lanes',gx,gy,lx:2048,ly:2048,key:1,R:21,upm:N*7/4096,owned:true};
      const output=ZoneDressing.dress({N,tx:0,ty:0,tileEdgeM:N*7,grid:grid.slice(),
        field:{anchors:[anchor],coverage:new Uint16Array(N*N).fill(1)},chests:[],
        spawnOpts:{occupied:new Set(),spawnWhy:new Uint16Array(N*N)}});
      const gems=output.objects.filter(o=>mineralDeposit(o)),id=`${gx},${gy}`,expected=quarryGemDeposit(id);
      assert.gt(gems.length,0);
      for(const gem of gems) {
        assert.eq(gem.quarryId,id);assert.eq(gem.deposit,expected);
        assert.eq(gem._zoneObjectFrame,undefined,'old sapphire atlas cannot hide assigned gem art');
        assert.eq(gem.yieldTier,GEM_DEPOSITS[expected].yieldTier);
        assert.eq(gem.requiredTier,GEM_DEPOSITS[expected].requiredTier);
      }
    }
  });

  test('quarry gems: first-floor seats respect walls, reservations and finite source cells', () => {
    const N=8,edge=N*7,grid=new Uint8Array(N*N).fill(W.T.CAVE_FLOOR),occupied=new Set([10]);
    const source=(ix,iy,extra={})=>({kind:'mineralrock',zoneKind:'quarry',quarryId:'100,200',deposit:'crystal',
      x:(ix+.5)*7,y:(iy+.5)*7,...extra});
    grid[11]=W.T.CAVE_WALL;
    const sources=[source(1,1),source(1,1),source(2,1),source(3,1),source(4,1,{zoneKind:'grove'}),source(5,1,{deposit:undefined}),source(-1,1)];
    const out=W.caveQuarryGemsFrom(sources,grid,N,0,0,edge,1,occupied);
    assert.eq(out.length,1);assert.eq(out[0].deposit,quarryGemDeposit('100,200'));
    assert.eq(out[0].quarryId,'100,200');assert.eq(out[0].depth,1);assert.truthy(occupied.has(9));
    assert.eq(W.caveQuarryGemsFrom(sources,grid,N,0,0,edge,0,new Set()).length,0);
    assert.eq(W.caveQuarryGemsFrom(sources,grid,N,0,0,edge,2,new Set()).length,0);
    const reversed=W.caveQuarryGemsFrom([...sources].reverse(),grid,N,0,0,edge,1,new Set([10]));
    assert.eq(JSON.stringify(reversed),JSON.stringify(out),'order does not change a seam or its saved identity');
  });

  test('quarry gems: first-floor ordinary and ore rocks inherit only their surface quarry boundary', () => {
    const N=4,edge=N*7,coverage=new Uint16Array(N*N);
    coverage[0]=1;coverage[1]=1;coverage[2]=2;
    const surface={cellsPerEdge:N,zone:{coverage,anchors:[{kind:'quarry',gx:100,gy:200},{kind:'grove',gx:300,gy:400}]}};
    const make=()=>[0,1,2,3].map((ix)=>({kind:'mineralrock',x:(ix+.5)*7,y:3.5,yieldTier:ix===1?2:1}));
    const rocks=make(),other={kind:'chest',x:3.5,y:3.5};
    W.stampCaveQuarryRocks([...rocks,other],surface,N,0,0,edge,1);
    for(const rock of rocks.slice(0,2)) {
      assert.eq(rock.quarryId,'100,200');assert.eq(rock.depth,1);assert.eq(rock.zoneKind,'quarry');
      assert.eq(rock.deposit,undefined,'provenance does not turn ordinary rocks into guaranteed gems');
    }
    assert.eq(rocks[1].yieldTier,2,'ore tier is preserved');
    for(const rock of [rocks[2],rocks[3],other])assert.eq(rock.quarryId,undefined);
    for(const depth of [0,2,3]) {
      const deeper=make();W.stampCaveQuarryRocks(deeper,surface,N,0,0,edge,depth);
      assert.truthy(deeper.every(o=>o.quarryId===undefined));
    }
  });

  test('quarry gems: real cave loader reads generated seats once, ignoring live edits and deeper copies', async () => {
    const tx=910011,ty=910012,N=16,edge=N*7,key=W.tileKey(tx,ty),grid=new Uint8Array(N*N).fill(W.T.GRASS);
    const source={kind:'mineralrock',id:'surface-gem',zoneKind:'quarry',quarryId:'321,654',deposit:quarryGemDeposit('321,654'),
      x:tx*edge+4.5*7,y:ty*edge+4.5*7};
    W.setDepth(0).set(key,{status:'ready',grid,baseGrid:grid.slice(),cellsPerEdge:N,tileEdgeM:edge,depth:0,
      objects:[],genObjects:[source],wildplants:[],
      zone:{coverage:new Uint16Array(N*N).fill(1),anchors:[{kind:'quarry',gx:321,gy:654}]}});
    try {
      const first=await W.loadTile.atDepth(1,tx,ty,49.85);
      const gems=first.objects.filter(o=>mineralDeposit(o));
      const ordinary=first.objects.filter(o=>o.kind==='mineralrock'&&!mineralDeposit(o));
      assert.gt(ordinary.length,0);
      assert.truthy(ordinary.every(o=>o.quarryId==='321,654'&&o.depth===1),'ambient rocks receive source quarry provenance');
      assert.eq(gems.length,1);assert.eq(gems[0].deposit,source.deposit);
      assert.eq(gems[0].x,source.x);assert.eq(gems[0].y,source.y);
      assert.truthy(gems[0].id!==source.id,'separate mining ledger from surface');
      assert.eq(first.objects.filter(o=>o.x===source.x&&o.y===source.y).length,1,'ambient objects cannot overwrite the seat');
      const second=await W.loadTile.atDepth(2,tx,ty,49.85);
      assert.eq(second.objects.filter(o=>o.quarryId).length,0,'the seam stops after the first cave floor');
    } finally {
      for(const depth of [0,1,2])W.setDepth(depth).delete(key);
      W.setDepth(0);
    }
  });
})();
