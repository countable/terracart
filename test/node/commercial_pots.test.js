(function () {
  const W = WorldGen, N = 64, edge = N * 7, unit = 4096 / N;
  const point = (x, y) => ({ x: (x + .5) * unit, y: (y + .5) * unit });
  const commercial = { name: 'landuse', features: [{ type: 3, tags: { class: 'commercial' },
    geom: [[point(0, 0), point(63, 0), point(63, 63), point(0, 63), point(0, 0)]] }] };
  const poi = (kind, x, y) => ({ type: 1, tags: { class: kind }, geom: [[point(x, y)]] });
  const publicPois = { name: 'poi', features: [poi('clothing_store', 20, 32), poi('office', 48, 32)] };
  const roads = { name: 'transportation', features: [{ type: 2, tags: { class: 'primary' },
    geom: [[point(30, 0), point(30, 63)]] }] };
  const pots = out => out.objects.filter(o => o.id.startsWith('hmpot_'));
  const cell = o => [Math.floor(o.x / 7), Math.floor(o.y / 7)];

  test('commercial pots: aligned pillar substitutions preserve hedge passages and ordinary pot rewards', () => {
    const out = W.rasterizeTile([commercial, publicPois], N, 0, 0, edge);
    const rows = pots(out), bushes = out.wildplants.filter(o => o.id.startsWith('hm_'));
    assert.gt(rows.length, 12, 'public commercial paving has regular pot rows');
    assert.gt(bushes.length, rows.length * 3, 'bushes remain the majority of the maze');
    const salt = BiomeProfiles.flora(W.T.COMMERCIAL).find(f => f.pattern === 'hedgemaze').salt;
    for (const o of rows) {
      const [x, y] = cell(o);
      assert.eq(x % 6, 0); assert.eq(y % 6, 0);
      assert.truthy(W.hedgeMazeCell(x, y, salt), 'pot replaces an existing hedge pillar, not a path');
      assert.eq(o.kind, 'chest'); assert.eq(o.barrel, true);
      assert.eq(o.barrelStyle, 'clay_pot'); assert.eq(barrelProfile(o).texKey, 'clay_pot');
      assert.falsy(bushes.some(b => b.x === o.x && b.y === o.y), 'no bush shares its pot cell');
    }
    const again = W.rasterizeTile([commercial, publicPois], N, 0, 0, edge);
    assert.eq(JSON.stringify(rows), JSON.stringify(pots(again)), 'stable identities and placement on rebuild');
    for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) {
      if (W.hedgeMazePotCell(x, y)) assert.truthy(W.hedgeMazeCell(x, y, salt), 'negative coordinates retain the same lattice');
    }
  });

  test('commercial pots: private ground and roads refuse pots; special areas clear them as ambient fill', () => {
    const closed = W.rasterizeTile([commercial], N, 0, 0, edge);
    assert.eq(pots(closed).length, 0, 'a pot cannot make private commercial land public');
    const out = W.rasterizeTile([commercial, publicPois, roads], N, 0, 0, edge);
    assert.gt(pots(out).length, 0, 'public roadside paving still gets pots');
    for (const o of pots(out)) {
      const [x, y] = cell(o), i = y * N + x;
      assert.falsy(out.roadMask[i], 'never in the road band');
      assert.falsy(out.spawnWhy[i] & W.SPAWN_WHY.PRIVATE, 'never on the office side');
    }
    const list = pots(out), area = new Uint8Array(N * N).fill(1);
    const clear = W.clearStreetAmbientSteps({ area, objects: list, wildplants: [], tx: 0, ty: 0, N, tileEdgeM: edge });
    while (!clear.next().done) {}
    assert.eq(list.length, 0, 'authored street areas retain their empty passages');
  });
  test('industrial salvage: public empty seats hold stable barrels, private lots do not', () => {
    const industrial={...commercial,features:commercial.features.map(f=>({...f,tags:{class:'industrial'}}))};
    const salvage=out=>out.objects.filter(o=>o.id.startsWith('ibarrel_'));
    const out=W.rasterizeTile([industrial,publicPois,roads],N,0,0,edge), barrels=salvage(out);
    assert.gt(barrels.length,0,'public industrial frontage has salvage');
    assert.eq(salvage(W.rasterizeTile([industrial],N,0,0,edge)).length,0,'barrels cannot make private lots public');
    assert.eq(JSON.stringify(barrels),JSON.stringify(salvage(W.rasterizeTile([industrial,publicPois,roads],N,0,0,edge))),
      'barrel locations and identities survive rebuilding');
    for(const o of barrels){
      const [x,y]=cell(o),i=y*N+x;
      assert.falsy(out.roadMask[i]); assert.falsy(out.spawnWhy[i]&W.SPAWN_WHY.PRIVATE);
      assert.eq(out.grid[i],W.T.INDUSTRIAL);
      assert.eq([...out.objects,...out.wildplants].filter(p=>p.x===o.x&&p.y===o.y).length,1,'one object per seat');
      assert.eq(o.barrel,true);
    }
    const area=new Uint8Array(N*N).fill(1);
    const clear=W.clearStreetAmbientSteps({area,objects:barrels,wildplants:[],tx:0,ty:0,N,tileEdgeM:edge});
    while(!clear.next().done){}
    assert.eq(barrels.length,0,'authored street space clears ambient salvage');
  });

})();
