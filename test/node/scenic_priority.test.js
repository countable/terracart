// Stress the shipping scheduler with a dense lower-priority layout. Scenic's
// real placer must retain its named landmark and tide seats before that fill.
(() => {
  test('scenic priority: a dense zone cannot consume viewpoint and tide seats', () => {
    const N = 32, extent = 4096, edge = N * WorldGen.CELL_M;
    const point = (x,y) => ({ x: (x + .5) * extent/N, y: (y + .5) * extent/N });
    const layers = [
      { name: 'landuse', extent, features: [{ type: 3, tags: { class: 'park' },
        geom: [[{x:0,y:0},{x:extent,y:0},{x:extent,y:extent},{x:0,y:extent},{x:0,y:0}]] }] },
      { name: 'poi', extent, features: [{ type: 1, tags: { class: 'park', subclass: 'park', name: 'Priority Grove' },
        geom: [[point(16,16)]] }] },
    ];
    const originalBuild = Scenic.buildSteps, originalDress = ZoneDressing.dressSteps;
    const waterline = [11*N+12, 11*N+13, 11*N+14];
    let result;
    try {
      Scenic.buildSteps = function* () {
        return { ext: extent, vistas: [{ owned:true, id:'test_viewpoint', lx:point(20,16).x, ly:point(20,16).y }],
          stretches: [], shore: { waterline, shoreM: 200 } };
      };
      ZoneDressing.dressSteps = function* (ctx) {
        const wildplants = [];
        for (let i=0; i<N*N; i++) {
          if (!ctx.field.coverage[i] || ctx.spawnOpts.occupied.has(i)) continue;
          const ix=i%N, iy=Math.floor(i/N);
          if (!WorldGen.isSpawnCell(ctx.grid,N,N,ix,iy,ctx.spawnOpts,'minor')) continue;
          ctx.spawnOpts.occupied.add(i);
          wildplants.push(WorldGen.makeWildplant('shell',(ix+.5)*WorldGen.CELL_M,(iy+.5)*WorldGen.CELL_M,`dense_${i}`));
        }
        return { objects:[], wildplants, guards:[], traps:[], lairs:[] };
      };
      result = WorldGen.rasterizeTile(layers,N,0,0,edge);
    } finally {
      Scenic.buildSteps=originalBuild; ZoneDressing.dressSteps=originalDress;
    }
    assert.gt(result.zone.coverage.filter(Boolean).length, 0, 'fixture has actual special-zone coverage');
    assert.eq(result.scenicDress.objects.filter(o=>o.kind==='vista_scope').length,1);
    assert.eq(result.scenicDress.objects.filter(o=>o.vista==='grail').length,1);
    assert.eq(result.scenicDress.wildplants.filter(o=>o.tide).length,waterline.length);
    const cell = o => Math.floor(o.y/WorldGen.CELL_M)*N+Math.floor(o.x/WorldGen.CELL_M);
    const landmarkCells = new Set([...result.scenicDress.objects,...result.scenicDress.wildplants].map(cell));
    assert.gt(result.zoneDress.wildplants.length,10,'the competing layout actually places content');
    assert.falsy(result.zoneDress.wildplants.some(o=>landmarkCells.has(cell(o))), 'no lower-priority overlap');
  });
})();
