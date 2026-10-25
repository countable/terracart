// Run the shipped final cave pass, retaining safety and occupancy precedence.
(() => {
  const row = WorldGen.CAVE_PASSES.find(r => r.id === 'grass');
  const N = 64, edge = N * 7;
  function run(depth = 5, blocked = false, surfaceGrid = new Uint8Array(N*N).fill(WorldGen.T.GRASS), surfacePlants = []) {
    const grid = new Uint8Array(N * N).fill(WorldGen.T.CAVE_FLOOR);
    const spawnWhy = new Uint16Array(N * N), occupied = new Set();
    for (let i = 0; i < N * N; i++) {
      if (i % N < 4) grid[i] = WorldGen.T.CAVE_WALL;
      if (i % N >= 4 && i % N < 8) occupied.add(i);
      if (blocked && i % N >= 32) spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
    }
    const level = WorldGen.cavePassLevel(grid, N, -3, 8, edge, depth, occupied, { spawnWhy, surface: { baseGrid: surfaceGrid, genWildplants: surfacePlants, wildplants: [] } });
    WorldGen.runCavePass(row, level);
    return level;
  }
  test('Underdark grass: floor profile enables stable grass stands on eligible empty floor only', () => {
    const before = run(), after = run(5, true), plants = after.wildplants;
    assert.gt(plants.length, 100);
    assert.eq(JSON.stringify(plants), JSON.stringify(run(5, true).wildplants));
    const byId = new Map(before.wildplants.map(p => [p.id, p]));
    const ids = new Set();
    for (const plant of plants) {
      assert.eq(plant.crop, 'longgrass'); assert.eq(plant.depth, 5);
      assert.truthy(WorldGen.isGrassCover(plant));
      assert.truthy(plant.id.startsWith('cgrass_5_'));
      assert.inRange(plant._ix, 8, 31);
      assert.eq(after.grid[plant._iy * N + plant._ix], WorldGen.T.CAVE_FLOOR);
      assert.eq(JSON.stringify(plant), JSON.stringify(byId.get(plant.id)), 'safety does not move surviving grass');
      assert.falsy(ids.has(plant.id)); ids.add(plant.id);
    }
    assert.eq(row, WorldGen.CAVE_PASSES[WorldGen.CAVE_PASSES.length - 1], 'all existing floor content gets first claim');
  });
  test('Underdark grass: follows grassy surface regions and generated grass on other terrain', () => {
    const surface = new Uint8Array(N*N).fill(WorldGen.T.ROCKY_GROUND);
    for(let y=0;y<N;y++)for(let x=8;x<32;x++)surface[y*N+x]=WorldGen.T.GRASS;
    const fields=run(5,false,surface).wildplants;
    assert.gt(fields.length,50);
    assert.truthy(fields.every(p=>p._ix>=8 && p._ix<32),'no independent stands under non-grass regions');
    const point={x:-3*edge+40.5*7,y:8*edge+20.5*7};
    const plants=[{id:'lane-grass',crop:'longgrass',x:point.x,y:point.y}];
    const withLane=run(5,false,surface,plants).wildplants;
    assert.truthy(withLane.some(p=>p._ix===40 && p._iy===20),'surface grass outside field terrain is mirrored');
    const reeds=run(5,false,surface,[{...plants[0],_plantArt:'reeds'}]).wildplants;
    assert.falsy(reeds.some(p=>p._ix===40 && p._iy===20),'reeds are not fungal grass');
  });
  test('Underdark grass: the surface generated snapshot survives harvesting and live terrain edits', () => {
    const sourceStart = WORLDGEN_SRC.indexOf('      entry.baseGrid = grid.slice();');
    const sourceEnd = WORLDGEN_SRC.indexOf('      entry.parkingTreasures', sourceStart);
    assert.gt(sourceStart, 0); assert.gt(sourceEnd, sourceStart);
    const snapshot = new Function('entry', 'grid', 'spawnWhy', 'gameplayTiers', 'registerGameplayTiers',
      WORLDGEN_SRC.slice(sourceStart, sourceEnd));
    const grid = new Uint8Array(N*N).fill(WorldGen.T.ROCKY_GROUND);
    const plant = {kind:'wildplant',crop:'longgrass',x:-3*edge+40.5*7,y:8*edge+20.5*7};
    const surface = {grid,objects:[],wildplants:[plant]};
    snapshot(surface,grid,new Uint16Array(N*N),null,()=>{});
    const level = {tx:-3,ty:8,N,tileEdgeM:edge,surface};
    const before = Array.from(row.setup(level));
    assert.eq(before[20*N+40],1);
    surface.wildplants.splice(0,1);
    surface.grid.fill(WorldGen.T.GRASS);
    assert.eq(Array.from(row.setup(level)).join(),before.join(),'live harvesting and repaint cannot reroll the Underdark');
    assert.eq(surface.genWildplants.length,1);
  });

  test('Underdark grass: other floors retain their existing flora', () => {
    for (const depth of [1, 2, 3, 4, 6, 7, 8, 9]) assert.eq(run(depth).wildplants.length, 0);
  });
})();
