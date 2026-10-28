(function () {
  const N=32, cellM=WorldGen.CELL_M;
  const road=(key,variant,y)=>({key,variant,size:'minor',halfW:cellM/2,
    line:[{x:1.5,y},{x:30.5,y}]});
  const fixture=(variants,reverse=false)=>{
    const rows=variants.map((v,i)=>road('road-'+i,v,12.5+i*4));
    if(reverse)rows.reverse();
    return {extent:N,dressingLines:rows};
  };
  test('road partition: nearest theme and ties are independent of geometry order',()=>{
    const a=fixture(['thorny','orchard']),b=fixture(['thorny','orchard'],true);
    b.dressingLines.forEach(r=>r.line.reverse());
    const first=StreetVariants.variantOwner(a,N),second=StreetVariants.variantOwner(b,N);
    for(let y=0;y<N;y++)for(let x=0;x<N;x++) {
      assert.eq(first(x,y),second(x,y));
      assert.eq(first(x,y),y<=14?'thorny':'orchard');
    }
    const area=StreetVariants.area(a,N),other=StreetVariants.area(b,N);
    assert.eq([...area.variants].join(','),[...other.variants].join(','));
    assert.eq(area.variants[14*N+12],StreetVariants.VARIANT_BY_ID.thorny.code,'midpoint has one stable owner');
  });
  test('road partition: spatial tree retains exact owners across dense parallel lanes',()=>{
    const rows=Array.from({length:24},(_,i)=>road('lane-'+String(i).padStart(2,'0'),i%2?'orchard':'thorny',i+.5));
    const owner=StreetVariants.variantOwner({extent:N,dressingLines:rows.slice().reverse()},N);
    for(let y=0;y<24;y++)for(let x=0;x<N;x++)assert.eq(owner(x,y),rows[y].variant);
  });
  test('road partition: a plain parallel road keeps themed dressing out',()=>{
    const index=fixture(['thorny']);
    index.lines=[road('plain',null,16.5)];
    const owner=StreetVariants.variantOwner(index,N);
    assert.eq(owner(10,16),'plain');
    assert.eq(owner(10,12),'thorny');
  });
  test('road partition: all parallel-road dressing stays in its nearest variant',()=>{
    const kinds=new Set();
    for(const variants of [['thorny','grassy_lane'],['poison_path','spider_path'],
      ['berry_trail','trade'],['snare','goblin_gang'],['pilgrim','golden_path'],['overgrown','orchard']]) {
      for(const reverse of [false,true]) {
        const index=fixture(variants,reverse),owner=StreetVariants.variantOwner(index,N);
        const grid=new Uint8Array(N*N).fill(WorldGen.T.GRASS);
        const result=StreetVariants.dress({index,N,grid,tx:0,ty:0,tileEdgeM:N*cellM,
          spawnOpts:{roadMask:new Uint8Array(N*N),spawnWhy:new Uint16Array(N*N),occupied:new Set()}});
        for(const type of ['objects','wildplants','traps','webs','vents','lairs']) {
          for(const p of result[type]) {
            const variant=p._street || p._shrineStreet;
            assert.truthy(variant,type+' identifies its source theme');
            const x=Math.floor((p.x ?? p.lx)/cellM),y=Math.floor((p.y ?? p.ly)/cellM);
            assert.eq(owner(x,y),variant,type+' cannot invade a closer road');
            kinds.add(type);
          }
        }
        for(let i=0;i<N*N;i++)if(result.marks?.[i])
          assert.eq(result.marks[i],StreetVariants.VARIANT_BY_ID[owner(i%N,Math.floor(i/N))].code);
        for(const [key,seats] of result.coinSeats)for(const p of seats.values())
          assert.eq(owner(Math.floor(p.x/cellM),Math.floor(p.y/cellM)),index.dressingLines.find(r=>r.key===key).variant);
      }
    }
    for(const type of ['objects','wildplants','traps','webs','vents','lairs'])assert.truthy(kinds.has(type),'exercised '+type);
  });
  test('road partition: initial lair members cannot spread onto the parallel theme',()=>{
    const index=fixture(['goblin_gang','orchard']),owner=StreetVariants.variantOwner(index,N);
    const entry={cellsPerEdge:N,tileEdgeM:N*cellM,grid:new Uint8Array(N*N).fill(WorldGen.T.GRASS),
      streetIndex:index,streetArea:StreetVariants.area(index,N),objects:[],buildingShapes:[],
      _spawnOpts:{occupied:new Set(),roadMask:new Uint8Array(N*N),spawnWhy:new Uint16Array(N*N)}};
    let count=0;
    for(let i=0;i<30;i++) {
      const cand={tier:'street_goblin_gang',_street:'goblin_gang',sid:'partition-guard-'+i,
        tx:0,ty:0,ox:0,oy:0,lx:15.5*cellM,ly:14.5*cellM,ix:15,iy:14,halfW:0,halfH:0};
      const guards=Lairs.garrisonFor(entry,cand,{tileEdgeM:N*cellM});
      count+=guards.length;
      for(const guard of guards)assert.eq(owner(Math.floor(guard.x/cellM),Math.floor(guard.y/cellM)),'goblin_gang');
    }
    assert.gt(count,10,'formations still spawn on their own side');
  });
})();
