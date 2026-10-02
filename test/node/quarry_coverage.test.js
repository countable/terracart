// Parking lanes are generation-only line sources: their metric buffer becomes
// rocky quarry ground without reviving roads, restoration or street lamps.
(() => {
  const N = 64, EXT = 4096, EDGE = N * 7, unit = EXT / N;
  const p = (x, y) => ({x:(x + .5) * unit, y:(y + .5) * unit});
  const lane = (cells, id = 1, extent = EXT) => ({
    f:{id, type:2, tags:{class:'service', service:'parking_aisle'}}, extent,
    lines:[cells.map(([x,y]) => ({x:p(x,y).x * extent / EXT, y:p(x,y).y * extent / EXT}))],
  });
  const grouped = (sources, key = 'confirmed-lot') => sources.map(source => ({...source, lineGroups:source.lines.map(() => [key])}));
  const run = it => { let r; do { r = it.next(); } while (!r.done); return r.value; };
  function build(parkingLanes, options = {}) {
    const grid = options.grid || new Uint8Array(N * N).fill(WorldGen.T.GRASS);
    return run(ZoneCoverage.quarrySteps({field:null, parkingLanes, tx:0, ty:0, N,
      grid, tileEdgeM:EDGE, roadMask:new Uint8Array(N * N), ...options}));
  }
  const owner = (f, x, y) => f?.anchors[f.coverage[y * N + x] - 1];
  const signature = f => Array.from(f.coverage, slot => {
    const a = f.anchors[slot - 1]; return a ? `${a.kind}:${a.key}:${a.variant}` : '-';
  }).join('|');

  test('quarry coverage: the 21 m buffer includes rounded ends, not a bounding rectangle', () => {
    const f = build([lane([[20,20],[30,20]])]);
    for (const [x,y] of [[20,20],[25,23],[17,20],[18,18],[32,22]]) {
      assert.eq(owner(f,x,y)?.kind, 'quarry', `${x},${y} within 21 m`);
    }
    for (const [x,y] of [[25,24],[16,20],[17,17],[33,23],[40,40]]) {
      assert.falsy(owner(f,x,y), `${x},${y} outside the rounded buffer`);
    }
  });

  test('quarry coverage: confirmed nearby lot rows form one quarry and distant buffers stay separate', () => {
    const f = build([...grouped([lane([[20,20],[30,20]],1), lane([[20,25],[30,25]],2)]), lane([[20,50],[30,50]],3)]);
    const a = owner(f,25,20), b = owner(f,25,25), c = owner(f,25,50);
    assert.eq(a.kind, 'quarry');
    assert.truthy(a.name.endsWith(' Quarry'), 'complete clusters have a stable site name');
    assert.eq(a.name, owner(build([lane([[20,20],[30,20]],1), lane([[20,25],[30,25]],2), lane([[20,50],[30,50]],3)]),25,20).name);
    assert.eq(a.key, b.key, 'overlapping 21 m buffers merge across a 35 m gap');
    assert.truthy(a.key !== c.key, 'separate lots do not share a local component');
  });

  test('quarry coverage: direction, feature order, source extent and frame scale preserve coverage and identity', () => {
    const a = lane([[20,20],[25,24],[30,20]],1), b = lane([[20,26],[30,26]],2);
    const original = JSON.stringify([a,b]);
    const baseline = signature(build([a,b]));
    const reversed = [b,a].map(record => ({...record, lines:record.lines.map(line => line.slice().reverse())}));
    assert.eq(signature(build(reversed)), baseline, 'input direction and order are irrelevant');
    const doubled = [a,b].map(record => ({...record, extent:8192,
      lines:record.lines.map(line => line.map(q => ({x:q.x*2,y:q.y*2})))}));
    assert.eq(signature(build(doubled)), baseline, 'native extent is normalized');
    assert.eq(signature(build([a,b], {tileEdgeM:EDGE*3})), baseline, 'save-relative metre frame cannot resize the real-world buffer');
    assert.eq(JSON.stringify([a,b]), original, 'cached source geometry stays untouched');
  });

  test('quarry coverage: existing zones win overlap without removing the uncovered quarry', () => {
    const coverage = new Uint16Array(N*N), idx = new Uint8Array(N*N);
    coverage[20*N+25] = idx[20*N+25] = 1;
    const grove = {kind:'grove',code:1,key:123,gx:p(25,20).x,gy:p(25,20).y,R:60,upm:EDGE/EXT};
    const f = build([lane([[20,20],[30,20]])], {field:{anchors:[grove],coverage,idx,s:new Float32Array(N*N),reach:[]}});
    assert.eq(owner(f,25,20), grove, 'pre-existing winner is retained');
    assert.eq(owner(f,20,20)?.kind, 'quarry', 'unclaimed neighbouring land still becomes quarry');
  });

  test('quarry coverage: roads, paths, buildings, water, sand and restricted sites stay excluded', () => {
    const T = WorldGen.T, W = WorldGen.SPAWN_WHY;
    const grid = new Uint8Array(N*N).fill(T.GRASS), roadMask = new Uint8Array(N*N), spawnWhy = new Uint16Array(N*N);
    const excluded = [T.ROAD,T.PATH,T.BUILDING,T.WATER,T.PIER,T.SAND];
    excluded.forEach((t,x) => { grid[20*N+20+x] = t; });
    roadMask[20*N+26] = 1;
    const hard = [W.RESTRICTED,W.QUIET,W.SENSITIVE_SITE,W.KINDERGARTEN];
    hard.forEach((reason,x) => { assert.truthy(reason, 'named hard reason exists'); spawnWhy[20*N+27+x] = reason; });
    const f = build([lane([[18,20],[34,20]])], {grid,roadMask,spawnWhy});
    for (let x=20;x<=30;x++) assert.falsy(owner(f,x,20), `protected cell ${x} stays outside quarry`);
    assert.eq(owner(f,32,20)?.kind,'quarry','ordinary ground remains eligible');
  });

  test('quarry coverage: removed lot lanes can claim inferred private land without lifting genuine restrictions', () => {
    const T=WorldGen.T, W=WorldGen.SPAWN_WHY;
    const grid = new Uint8Array(N*N).fill(T.COMMERCIAL), spawnWhy = new Uint16Array(N*N).fill(W.PRIVATE|W.BEHIND_HOUSE);
    spawnWhy[20*N+25] |= W.RESTRICTED;
    const f = build([lane([[20,20],[30,20]])], {grid,spawnWhy});
    assert.eq(owner(f,22,20)?.kind,'quarry','inferred commercial frontage no longer blocks the lot');
    assert.falsy(owner(f,25,20),'restricted site remains protected');
    run(ZoneCoverage.paintSteps(f,grid,N,{},null,spawnWhy));
    assert.eq(grid[20*N+22],T.ROCK);
    assert.eq(spawnWhy[20*N+22] & (W.PRIVATE|W.BEHIND_HOUSE),0);
    assert.truthy(spawnWhy[20*N+25] & W.RESTRICTED,'painting preserves hard restriction');
  });

  test('quarry coverage: clipped lane halves reach both sides of a tile seam without inventing road cells', () => {
    const left = build([lane([[60,20],[64,20]])]);
    const right = build([lane([[-1,20],[4,20]])],{tx:1});
    for (const y of [18,20,22]) {
      assert.eq(owner(left,63,y)?.kind,'quarry','left edge covered');
      assert.eq(owner(right,0,y)?.kind,'quarry','right edge covered');
      assert.eq(owner(left,63,y)?.variant, 'quarry-strip-mine');
      assert.eq(owner(right,0,y)?.variant, 'quarry-strip-mine');
      assert.falsy(owner(left,63,y)?.owned, 'clipped site cannot duplicate finite rewards');
      assert.falsy(owner(right,0,y)?.owned, 'neighbour does not invent a second owner');
    }
  });
  test('quarry coverage: short empty gaps join one site without widening its outside edges', () => {
    const sources = grouped([lane([[20,20],[30,20]],1), lane([[20,29],[30,29]],2)]);
    const f = build(sources), a = owner(f,25,20);
    assert.eq(owner(f,25,29)?.key, a.key, 'nearby strips share one site');
    assert.eq(owner(f,25,24)?.key, a.key, 'narrow internal gap becomes usable');
    assert.eq(owner(f,25,25)?.key, a.key, 'whole gap is filled');
    assert.gt(a.cluster.filledCells, 0);
    assert.falsy(owner(f,25,16), 'outside edge does not dilate');
    assert.falsy(owner(f,16,24), 'empty outer corners stay empty');
    assert.eq(signature(build(sources.slice().reverse())), signature(f), 'clustering is source-order independent');
    assert.eq(signature(build(sources)), signature(f), 'rebuild retains site identities');
    const far = build([sources[0], lane([[20,32],[30,32]],3)]);
    assert.truthy(owner(far,25,20).key !== owner(far,25,32).key, 'larger empty gaps remain separate');
    assert.falsy(owner(far,25,26), 'large gap is not enclosed');
  });

  test('quarry coverage: cluster bridges never cross retained roads, buildings, protected land or another nexus', () => {
    const T = WorldGen.T, W = WorldGen.SPAWN_WHY;
    for (const barrier of ['road','building','restricted','nexus']) {
      const grid = new Uint8Array(N*N).fill(T.GRASS), roadMask = new Uint8Array(N*N);
      const spawnWhy = new Uint16Array(N*N), coverage = new Uint16Array(N*N);
      for (let x=0;x<N;x++) {
        const i=25*N+x;
        if (barrier === 'road') roadMask[i]=1;
        if (barrier === 'building') grid[i]=T.BUILDING;
        if (barrier === 'restricted') spawnWhy[i]=W.RESTRICTED;
        if (barrier === 'nexus') coverage[i]=1;
      }
      const grove = {kind:'grove',code:1,key:123};
      const field = barrier === 'nexus' ? {anchors:[grove],coverage,idx:coverage.slice(),s:new Uint8Array(N*N)} : null;
      const f = build(grouped([lane([[20,20],[30,20]],1),lane([[20,29],[30,29]],2)]), {grid,roadMask,spawnWhy,field});
      assert.truthy(owner(f,25,20).key !== owner(f,25,29).key, `${barrier} separates sites`);
      assert.truthy(owner(f,25,25)?.kind !== 'quarry', `${barrier} stays unclaimed`);
    }
  });

  test('quarry coverage: barriers split an overlapping source footprint and preserve clipped reward safety', () => {
    const grid = new Uint8Array(N*N).fill(WorldGen.T.GRASS);
    for (let y=0;y<N;y++) grid[y*N+61]=WorldGen.T.ROAD;
    const f = build([lane([[55,20],[64,20]])],{grid});
    const inside = owner(f,58,20), edge = owner(f,63,20);
    assert.truthy(inside.key !== edge.key, 'road separates quarry components');
    assert.falsy(owner(f,61,20), 'road stays outside quarry');
    assert.truthy(inside.clipped, 'inland fragment retains incomplete source bounds');
    assert.falsy(inside.owned, 'splitting incomplete source never grants a finite site budget');
    assert.falsy(edge.owned, 'edge fragment remains reward-free');
  });
  test('quarry coverage: holes in one source lot keep a shared identity and finite budget', () => {
    const T = WorldGen.T, W = WorldGen.SPAWN_WHY;
    for (const hole of ['building','restricted','nexus']) {
      const grid = new Uint8Array(N*N).fill(T.GRASS), spawnWhy = new Uint16Array(N*N);
      const coverage = new Uint16Array(N*N), grove = {kind:'grove',code:1,key:123};
      for (let y=0;y<N;y++) {
        const i=y*N+25;
        if (hole === 'building') grid[i]=T.BUILDING;
        if (hole === 'restricted') spawnWhy[i]=W.RESTRICTED;
        if (hole === 'nexus') coverage[i]=1;
      }
      const field = hole === 'nexus' ? {anchors:[grove],coverage,idx:coverage.slice(),s:new Uint8Array(N*N)} : null;
      const f=build([lane([[20,20],[30,20]])], {grid,spawnWhy,field});
      assert.eq(owner(f,22,20).key, owner(f,28,20).key, `${hole} stays a hole in the same lot`);
      assert.truthy(owner(f,25,20)?.kind !== 'quarry', `${hole} is not painted`);
      assert.eq(f.anchors.filter(a => a.kind === 'quarry').length,1,'one site budget, not one per usable island');
    }
  });
  test('quarry coverage: tiny inland leftovers remain unpainted review evidence without a site budget', () => {
    const T=WorldGen.T, grid=new Uint8Array(N*N).fill(T.BUILDING);
    const cells=[20*N+20,20*N+21,21*N+20,21*N+21];
    for (const i of cells) grid[i]=T.GRASS;
    const f=build([lane([[20,20],[30,20]])],{grid});
    assert.eq(f.anchors.length,0,'no named site or finite budget for the leftover');
    for (const i of cells) assert.eq(f.coverage[i],0,'sliver remains unpainted');
    assert.eq(f.quarrySlivers.length,1,'one rejected footprint can be reviewed');
    assert.eq(f.quarrySlivers[0].reason,'below_minimum');
    assert.eq(f.quarrySlivers[0].cells.slice().sort((a,b)=>a-b).join(','),cells.slice().sort((a,b)=>a-b).join(','));
    assert.falsy(f.quarrySlivers[0].clipped,'complete inland sliver');
  });

  test('quarry coverage: tiny tile-edge fragments survive while incomplete inland slivers are rejected', () => {
    const T=WorldGen.T, grid=new Uint8Array(N*N).fill(T.BUILDING);
    grid[20*N+60]=T.GRASS;
    grid[20*N+61]=T.ROAD;
    grid[20*N+63]=T.GRASS;
    for (let y=0;y<N;y++) grid[y*N+61]=T.ROAD;
    const f=build([lane([[55,20],[64,20]])],{grid});
    assert.falsy(owner(f,60,20),'small inland fragment is not promoted to a site');
    assert.eq(owner(f,63,20)?.kind,'quarry','edge fragment could belong to a larger neighbouring lot');
    assert.falsy(owner(f,63,20).owned,'tile edge retains no finite budget');
    assert.eq(f.quarrySlivers.length,1);
    assert.truthy(f.quarrySlivers[0].clipped,'inland rejection retains source uncertainty');
  });
  test('quarry coverage: nearby disconnected lots keep separate identities despite overlapping buffers', () => {
    const a=lane([[20,20],[30,20]],7), b=lane([[20,25],[30,25]],7);
    const f=build([a,b]);
    assert.truthy(owner(f,25,20).key !== owner(f,25,25).key,'same MVT feature and touching buffers do not prove one property');
    assert.eq(owner(f,25,22).key,owner(f,25,20).key,'overlap follows nearest source network');
    assert.eq(owner(f,25,23).key,owner(f,25,25).key,'neighbour keeps its half of overlap');
    const reversed=[b,a].map(source => ({...source,lines:source.lines.map(line=>line.slice().reverse())}));
    assert.eq(signature(build(reversed)),signature(f),'nearest-source assignment is independent of input order and direction');
    const gapped=build([a,lane([[20,29],[30,29]],8)]);
    assert.falsy(owner(gapped,25,24),'bounded gap filling cannot merge unrelated properties');
  });

  test('quarry coverage: touching source geometry joins without feature ids or inferred group evidence', () => {
    const f=build([lane([[20,20],[30,20]],1),lane([[25,20],[25,30]],2)]);
    assert.eq(owner(f,20,20).key,owner(f,25,30).key,'T junction belongs to one source network');
    const crossed=build([lane([[20,20],[30,30]],3),lane([[20,30],[30,20]],4)]);
    assert.eq(owner(crossed,20,20).key,owner(crossed,20,30).key,'segment crossing joins even without an explicit shared vertex');
  });
})();
