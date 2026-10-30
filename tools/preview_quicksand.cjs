#!/usr/bin/env node
// A live cave-area plan and hazard settings for the variant dashboard.
const vm = require('node:vm');
const { loadGame } = require('./loot-walk-model.js');
const context = loadGame();
const result = vm.runInContext(`(() => {
  const W = WorldGen, N = 64, centre = 32, extent = 4096, edge = N * W.CELL_M;
  const depths = W.FLOOR_PROFILES.map(row => row.depth).filter(depth =>
    W.floorProfile(depth).caveAreas?.weights.some(row => row.id === 'quicksand_cavern' && row.weight > 0));
  if (!depths.length) throw new Error('Quicksand cavern has no runtime floor');
  const depth = depths[0], ty = 950101;
  let tx, anchor;
  for (tx = 950201; tx < 960201; tx++) {
    const local = (centre + .5) * extent / N;
    anchor = { kind: 'grove', owned: true, gx: tx * extent + local, gy: ty * extent + local,
      lx: local, ly: local, upm: edge / extent };
    if (CaveAreas.select(anchor, depth) === 'quicksand_cavern') break;
  }
  if (tx === 960201) throw new Error('No deterministic quicksand fixture found');
  const source = new Uint8Array(N * N).fill(W.T.PARK);
  const surface = { status:'ready', depth:0, cellsPerEdge:N, tileEdgeM:edge,
    grid:source.slice(), baseGrid:source.slice(), objects:[], genObjects:[], wildplants:[],
    zone:{ anchors:[anchor], coverage:new Uint16Array(N*N).fill(1),
      caveSource:{grid:source,objects:[],wildplants:[],spawnWhy:new Uint16Array(N*N)} } };
  const plan = CaveAreas.plan({surface,grid:new Uint8Array(N*N).fill(W.T.CAVE_FLOOR),
    N,tx,ty,tileEdgeM:edge,depth,objects:[],occupied:new Set(),spawnWhy:new Uint16Array(N*N)});
  if (!plan.quicksand.size || !plan.areas.some(area => area.kind === 'quicksand_cavern'))
    throw new Error('Quicksand fixture failed to place');
  const cells = set => [...set].map(i => [i % N - centre, Math.floor(i / N) - centre]);
  return { id:'quicksand_cavern', depths, depth, cellM:W.CELL_M,
    config:EnvironmentHazards.CONFIG.quicksand, quicksand:cells(plan.quicksand),
    reserved:cells(plan.reserved), fixture:{tx,ty,N}, diagnostics:plan.diagnostics };
})()`, context);
process.stdout.write(JSON.stringify(result));
