(function () {
  const W = WorldGen, N = 32, edge = N * W.CELL_M;
  function context() {
    const coverage = new Uint16Array(N*N);
    for (let y=3;y<N-3;y++) for (let x=3;x<N-3;x++) coverage[y*N+x]=1;
    const gx=16.5*4096/N;
    return { N, tx:0, ty:0, tileEdgeM:edge, grid:new Uint8Array(N*N).fill(W.T.ROCK),
      field:{anchors:[{kind:'quarry',variant:'quarry-abandoned',generated:'parking_lanes',owned:true,
        gx,gy:gx,lx:gx,ly:gx,key:31,upm:edge/4096,R:21}],coverage},chests:[],
      spawnOpts:{occupied:new Set(),roadMask:new Uint8Array(N*N),spawnWhy:new Uint16Array(N*N)} };
  }
  const stairs = out => out.objects.filter(o => o.kind === 'staircase');
  const cell = o => o._iy*N+o._ix;
  test('quarry entrances: reduced deterministic functional shafts reserve their approaches before props', () => {
    const a=ZoneDressing.dress(context()), b=ZoneDressing.dress(context()), down=stairs(a);
    assert.eq(down.length,2);
    assert.eq(JSON.stringify(down),JSON.stringify(stairs(b)));
    const objects=[...a.objects,...a.wildplants,...a.guards];
    for (const o of down) {
      assert.eq(o.dir,'down'); assert.eq(o.depth,0); assert.falsy(o._synthetic);
      assert.eq(o.id,W.caveStairId('down',0,0,0,o._ix,o._iy));
      assert.eq(objects.filter(other => cell(other) === cell(o)).length,1);
      assert.truthy([cell(o)-N,cell(o)+N,cell(o)-1,cell(o)+1].some(i => !objects.some(other => cell(other) === i)), 'clear approach survives dressing');
    }
    const observer=context(); observer.field.anchors[0].owned=false;
    assert.eq(stairs(ZoneDressing.dress(observer)).length,0,'one owner holds the finite shaft budget');
  });
  test('quarry entrances: occupied and restricted seats relocate; fully blocked ground has no shafts', () => {
    const first=stairs(ZoneDressing.dress(context())), ctx=context();
    ctx.spawnOpts.occupied.add(cell(first[0]));
    ctx.spawnOpts.roadMask[cell(first[1])]=1;
    ctx.spawnOpts.spawnWhy[cell(first[1])]=W.SPAWN_WHY.SENSITIVE;
    const relocated=stairs(ZoneDressing.dress(ctx));
    assert.eq(relocated.length,2);
    for (const o of relocated) assert.falsy(first.some(old=>old.id===o.id));
    const blocked=context(); blocked.spawnOpts.spawnWhy.fill(W.SPAWN_WHY.SENSITIVE);
    const out=ZoneDressing.dress(blocked);
    assert.eq(stairs(out).length,0);
    assert.truthy(out.diagnostics.some(d=>d.shortfalls.includes('entrance:no-safe-seat')));
  });
  test('quarry entrances: site budgets retain 70% of shafts without moving the surviving identities', () => {
    const ctx=context(), variant=ZoneVariants.byId('quarry-abandoned');
    let count=0;
    for (let key=0;key<10000;key++) count+=QuarryLayout.entranceCount({variant,a:{key}});
    assert.inRange(count / (10000 * variant.entrances.count), .69, .71, '30% fewer shafts across sites');
    const reduced=stairs(ZoneDressing.dress(ctx));
    const settings=ZoneVariantData.quarryLayouts, original=settings.entranceCountScale;
    try {
      settings.entranceCountScale=1;
      const full=stairs(ZoneDressing.dress(context()));
      assert.eq(full.length,3);
      assert.eq(JSON.stringify(reduced),JSON.stringify(full.slice(0,reduced.length)), 'retained stairs keep their IDs and positions');
    } finally { settings.entranceCountScale=original; }
    assert.falsy(ZoneDressing.dress(context()).diagnostics.some(d=>d.shortfalls.includes('entrance:no-safe-seat')),
      'intentional reduction is not a placement shortfall');
  });
  test('quarry entrances: legacy cave pass respects authored shafts despite pre-dressing source', () => {
    const ctx=context(), down=stairs(ZoneDressing.dress(ctx));
    const entry={cellsPerEdge:N,grid:ctx.grid,objects:down.slice(),
      caveSource:{grid:ctx.grid,objects:[],wildplants:[]}};
    W.maybePlaceCaveEntrance(entry,0,0,edge,down,[]);
    const cells=entry.objects.filter(o=>o.kind==='staircase').map(o=>Math.floor(o.y/W.CELL_M)*N+Math.floor(o.x/W.CELL_M));
    assert.eq(new Set(cells).size,cells.length,'no generic stair overlaps a quarry shaft');
  });
  test('quarry entrances: generated shafts receive matching return ladders and deeper descents', async () => {
    const ctx=context(), down=stairs(ZoneDressing.dress(ctx));
    const tx=920001,ty=920002,key=W.tileKey(tx,ty);
    const objects=down.map(o=>({...o,x:o.x+tx*edge,y:o.y+ty*edge}));
    W.setDepth(0).set(key,{status:'ready',grid:ctx.grid,baseGrid:ctx.grid,cellsPerEdge:N,
      tileEdgeM:edge,depth:0,objects,genObjects:objects,wildplants:[]});
    try {
      const cave=await W.loadTile.atDepth(1,tx,ty,49.85);
      const up=cave.objects.filter(o=>o.kind==='staircase'&&o.dir==='up');
      assert.eq(up.length,2);
      for (const shaft of objects) assert.truthy(up.some(o=>o.x===shaft.x&&o.y===shaft.y),'return ladder mirrors its shaft');
      assert.eq(cave.objects.filter(o=>o.kind==='staircase'&&o.dir==='down').length,2);
    } finally { for (const depth of [0,1]) W.setDepth(depth).delete(key); W.setDepth(0); }
  });
})();
