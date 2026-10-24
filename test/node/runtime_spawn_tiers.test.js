// Runtime births must read the same cell policy as tile generation.
(function () {
  function withEntry(entry, fn) {
    const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    WorldGen.tileCache.set(key, entry);
    try { fn(); }
    finally {
      if (previous) WorldGen.tileCache.set(key, previous);
      else WorldGen.tileCache.delete(key);
    }
  }
  test('runtime spawn tiers: generated tile policy reaches the shared gate', () => {
    const tiers = Uint8Array.of(1, 2, 3, 4);
    const entry = { cellsPerEdge: 2, grid: new Uint8Array(4).fill(WorldGen.T.GRASS), gameplayTiers: tiers };
    const original = WorldGen.isSpawnCell;
    withEntry(entry, () => {
      let seen;
      WorldGen.isSpawnCell = (grid, w, h, x, y, opts, cls) => { seen = { opts, x, y, cls }; return true; };
      try {
        assert.truthy(CreatureSpawns.gateAt({ tileEdgeM: 14, cellM: 7 }, 10, 10, 'slime'));
        assert.eq(seen.opts.gameplayTiers, tiers);
        assert.eq(seen.x, 1); assert.eq(seen.y, 1);
        assert.eq(seen.cls, creatureSpawnClass('slime'));
      } finally { WorldGen.isSpawnCell = original; }
    });
  });
  test('runtime spawn tiers: partial tiles project the correct tier and full reason bits', () => {
    const entry = { cellsPerEdge: 2, gameplayTiers: Uint8Array.of(1, 2, 3, 4),
      spawnWhy: Uint32Array.of(0, 0, 0, WorldGen.SPAWN_WHY.BUILDING_MOAT) };
    const original = WorldGen.isSpawnCell;
    withEntry(entry, () => {
      let seen;
      WorldGen.isSpawnCell = (grid, w, h, x, y, opts) => { seen = opts; return false; };
      try {
        assert.falsy(CreatureSpawns.gateAt({ tileEdgeM: 14, cellM: 7,
          cellAt: () => ({ loaded: true, type: WorldGen.T.GRASS }) }, 10, 10, 'slime'));
        assert.eq(seen.gameplayTiers.length, 1);
        assert.eq(seen.gameplayTiers[0], 4);
        assert.eq(seen.spawnWhy[0], WorldGen.SPAWN_WHY.BUILDING_MOAT);
      } finally { WorldGen.isSpawnCell = original; }
    });
  });
  test('runtime spawn tiers: live terrain culling delegates to the shared gate', () => {
    const N = 2, generated = new Uint8Array(N*N).fill(WorldGen.T.GRASS);
    const entry = { grid: generated.slice(), gameplayTiers: Uint8Array.of(2, 4, 1, 1), objects: [] };
    entry.grid[0] = WorldGen.T.ROAD;
    entry.grid[1] = WorldGen.T.ROAD_MD;
    const creatures = [{kind:'slime',x:3.5,y:3.5}, {kind:'slime',x:10.5,y:3.5}];
    const scene = Object.assign(new SceneCreatures(), {tileEdgeM:14,save:{}});
    const original = WorldGen.isSpawnCell, seen = [];
    WorldGen.isSpawnCell = (grid,w,h,x,y,opts,cls) => {
      seen.push({tiers:opts.gameplayTiers,cls});
      return opts.gameplayTiers[y*w+x] !== 4;
    };
    try {
      scene._cullOffLiveGround(entry,0,0,N,7,generated,[],creatures);
      assert.eq(creatures.length,1);
      assert.eq(creatures[0].x,3.5);
      assert.eq(seen.length,2);
      for(const call of seen) {
        assert.eq(call.tiers,entry.gameplayTiers);
        assert.eq(call.cls,creatureSpawnClass('slime'));
      }
    } finally { WorldGen.isSpawnCell = original; }
  });
  test('runtime spawn tiers: bone and mimic triggers cannot bypass Excluded ground', () => {
    const entry={cellsPerEdge:2,grid:new Uint8Array(4).fill(WorldGen.T.GRASS),
      gameplayTiers:new Uint8Array(4).fill(4),creatures:[]};
    const scene=Object.assign(new SceneCreatures(),{depth:0,tileEdgeM:14,save:{caught:[]}});
    const trigger={id:'tier_trigger',x:3.5,y:3.5,depth:0};
    withEntry(entry,()=>{
      scene._raiseBoneCacheSkeleton(trigger);
      assert.falsy(scene._revealMimic(trigger));
      scene.save.revealedMimics=[{id:'mimic:tier_trigger',x:3.5,y:3.5}];
      scene._restoreMimics(entry,0,0);
      assert.eq(entry.creatures.length,0);
      entry.gameplayTiers.fill(1);
      scene._raiseBoneCacheSkeleton(trigger);
      assert.truthy(scene._revealMimic(trigger));
      assert.eq(entry.creatures.length,2);
      entry.baseGrid=entry.grid.slice();
      entry.grid[0]=WorldGen.T.BUILDING;
      assert.falsy(CreatureSpawns.gateAtEntry(scene,entry,3.5,3.5,'slime'),
        'a live wall overrides the cached core tier and generated grass');
    });
  });
})();
