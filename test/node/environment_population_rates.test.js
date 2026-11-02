(function () {
  function method(name) {
    const at = SCENE_SRC.indexOf('  ' + name + '('), end = SCENE_SRC.indexOf('\n  }\n', at);
    return new Function(`return ({ ${SCENE_SRC.slice(at, end + 4)} });`)()[name];
  }
  function sample() {
    const totals = {shore: {}, path: {}}, counts = [], signatures = [];
    const add = (type, list, tag) => {
      for (const c of list) totals[type][c.kind] = (totals[type][c.kind] || 0) + 1;
      counts.push([tag,list.length]);
      signatures.push(list.map(c => `${c.id}:${c.kind}:${c.x}:${c.y}`).join('|'));
    };
    for (const N of [24,48,80,128]) for (let seed=0;seed<16;seed++) {
      const cellM=7,edge=N*cellM,tx=seed-8,ty=3,scene={tileEdgeM:edge};
      for (const mode of ['open','holes','nexus']) {
        const grid=new Uint8Array(N*N).fill(WorldGen.T.GRASS),cells=[],waterline=[];
        const coverage=new Uint16Array(N*N),spawnWhy=new Uint32Array(N*N);
        for(let y=0;y<N;y++) for(let x=N-7;x<N-2;x++) {
          const i=y*N+x;grid[i]=WorldGen.T.SAND;cells.push(i);
          if(x===N-3)waterline.push(i);
          if(mode==='holes'&&y<N/2)spawnWhy[i]=WorldGen.SPAWN_WHY.RESTRICTED;
          if(mode==='nexus'&&y<N/2)coverage[i]=1;
        }
        const out=[];method('spawnShoreFauna').call(scene,out,{cells,waterline,shoreM:N*7},[],N,tx,ty,cellM,grid,{spawnWhy},{spawnWhy},new Set(),coverage);
        add('shore',out,`shore:${N}:${seed}:${mode}`);
      }
      for(const variant of ['promenade','greenway','parkpath']) for(const mode of ['open','holes']) {
        const grid=new Uint8Array(N*N).fill(WorldGen.T.PARK),cells=[],spawnWhy=new Uint32Array(N*N),x=Math.floor(N/2);
        for(let y=0;y<N;y++) { const i=y*N+x;grid[i]=WorldGen.T.PATH;cells.push(i);if(mode==='holes'&&y<N/2) {spawnWhy[i-1]=WorldGen.SPAWN_WHY.RESTRICTED;spawnWhy[i+1]=WorldGen.SPAWN_WHY.RESTRICTED;} }
        const entry={grid,cellsPerEdge:N,tileEdgeM:edge,streetArea:new Uint8Array(N*N).fill(1),streetAreaVariants:new Uint8Array(N*N).fill(StreetVariants.VARIANT_BY_ID[variant].code)};
        const out=method('spawnPathVariantFauna').call(scene,[],cells,N,tx,ty,cellM,grid,{spawnWhy},new Set(),entry);
        add('path',out,`path:${N}:${seed}:${variant}:${mode}`);
      }
    }
    return {totals,samples:counts.length,countsHash:fnv1a(JSON.stringify(counts)),identitiesAndSeatsHash:fnv1a(JSON.stringify(signatures))};
  }
  // Recorded from main64cda139 before consolidation: 576 layouts spanning
  // four lengths,16 world seeds, restricted shoreline/verge holes and Nexus
  // coverage. Compare per-kind totals AND every case's count/identity/seat.
  test('environment populations: consolidation preserves baseline rates, identities and seats across576 layouts', () => {
    const result = sample();
    assert.eq(result.samples,576);
    assert.eq(JSON.stringify(result.totals), JSON.stringify({
      shore:{crab:2176,gull:448,sea_turtle:656},
      path:{deer:384,azure_butterfly:104,violet_butterfly:32,amber_butterfly:88,pink_butterfly:48,metal_slime:128},
    }));
    assert.eq(result.countsHash,3104163229,'every layout retains its count');
    assert.eq(result.identitiesAndSeatsHash,3891409059,'all baseline IDs and seats remain stable');
  });
  test('environment populations: shared finite requests reserve before captures and reject only solid props', () => {
    const N=8,cellM=7,edge=N*cellM,grid=new Uint8Array(N*N).fill(WorldGen.T.GRASS);
    const run = (solid,caught=new Set()) => {
      const entry={grid,cellsPerEdge:N,tileEdgeM:edge,objects:[{kind:'rock',pushable:solid,x:17.5,y:17.5}]};
      const reserved=new Set(),creatures=[];
      const result=EnvironmentalPopulations.run({tileEdgeM:edge},{entry,creatures,N,tx:0,ty:0,cellM,grid,
        opts:{occupied:new Set([18,19])},reserved,caughtSet:caught},{
        source:'shore-fauna',owner:'finite-test',kind:'crab',count:2,
        member:n=>({id:'finite-'+n}),candidates:(member,n)=>[18+n],
      });
      return {result,reserved,creatures};
    };
    const ordinary=run(false),captured=run(false,new Set(['finite-0'])),solid=run(true);
    assert.eq(ordinary.result.placed,2,'passable props do not lower the finite quota');
    assert.eq(captured.result.placed,2,'captures do not free generated reservations');
    assert.eq(captured.creatures.length,1);
    assert.truthy(captured.reserved.has(18));
    assert.eq(solid.result.placed,1);
    assert.eq(solid.result.shortfall,1,'solid blockers drop the affected request without topping up');
    assert.eq(solid.creatures[0].id,'finite-1');
  });
})();
