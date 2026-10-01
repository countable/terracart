// Parking lanes are generation-only line sources: their metric buffer becomes
// rocky quarry ground without reviving roads, restoration or street lamps.
(() => {
  const N = 64, EXT = 4096, EDGE = N * 7, unit = EXT / N;
  const p = (x, y) => ({x:(x + .5) * unit, y:(y + .5) * unit});
  const lane = (cells, id = 1, extent = EXT) => ({
    f:{id, type:2, tags:{class:'service', service:'parking_aisle'}}, extent,
    lines:[cells.map(([x,y]) => ({x:p(x,y).x * extent / EXT, y:p(x,y).y * extent / EXT}))],
  });
  const run = it => { let r; do { r = it.next(); } while (!r.done); return r.value; };
  function build(parkingLanes, options = {}) {
    const grid = options.grid || new Uint8Array(N * N).fill(WorldGen.T.GRASS);
    return run(ZoneCoverage.quarrySteps({field:null, parkingLanes, tx:0, ty:0, N,
      grid, tileEdgeM:EDGE, roadMask:new Uint8Array(N * N), ...options}));
  }
  const owner = (f, x, y) => f?.anchors[f.coverage[y * N + x] - 1];
  const signature = f => Array.from(f.coverage, slot => {
    const a = f.anchors[slot - 1]; return a ? `${a.kind}:${a.key}` : '-';
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

  test('quarry coverage: nearby lane buffers form one quarry and distant buffers stay separate', () => {
    const f = build([lane([[20,20],[30,20]],1), lane([[20,25],[30,25]],2), lane([[20,50],[30,50]],3)]);
    const a = owner(f,25,20), b = owner(f,25,25), c = owner(f,25,50);
    assert.eq(a.kind, 'quarry');
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
})();
