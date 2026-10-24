// Tidepools use real water cells and ordinary one-fish save identities.
(() => {
  function fixture() {
    const N = 64, a = { kind: 'beach', variant: 'mystic_reef', owned: true, key: 112,
      gx: 32.5 * 4096 / N, gy: 32.5 * 4096 / N,
      lx: 32.5 * 4096 / N, ly: 32.5 * 4096 / N,
      upm: N * WorldGen.CELL_M / 4096, R: 140, rotation: 0 };
    return { N, tx: 0, ty: 0, tileEdgeM: N * WorldGen.CELL_M,
      grid: new Uint8Array(N * N).fill(WorldGen.T.SAND), chests: [],
      field: { anchors: [a], coverage: new Uint16Array(N * N).fill(1),
        idx: new Uint16Array(N * N), under: new Uint8Array(N * N) },
      spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(N * N),
        roadMask: new Uint8Array(N * N), roadClass: new Uint8Array(N * N) } };
  }
  test('Mystic Reef tidepools: clustered water keeps dry banks, real fish policy and stable placement', () => {
    const ctx = fixture(), out = ZoneDressing.dress(ctx);
    assert.gt(out.tidepools.length, 20, 'the repeated clusters own pools');
    assert.eq(out.tidepools.filter(p => p.zoneLayer === 'find').length, 1, 'one finite pool retains the guarded find seat');
    const standing = [...out.objects, ...out.wildplants, ...out.guards];
    const occupied = new Set(standing.map(o => `${o._ix},${o._iy}`));
    for (const pool of out.tidepools) {
      const i = pool._iy * ctx.N + pool._ix;
      assert.eq(ctx.grid[i], WorldGen.T.WATER);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) assert.falsy(ctx.grid[(pool._iy + dy) * ctx.N + pool._ix + dx] === WorldGen.T.WATER, 'one-cell pool has a dry perimeter');
      }
      assert.falsy(occupied.has(`${pool.bankIx},${pool.bankIy}`), 'bank remains free after later dressing');
      assert.truthy(WorldGen.isSpawnCell(ctx.grid, ctx.N, ctx.N, pool.bankIx, pool.bankIy,
        { ...ctx.spawnOpts, occupied: null }, 'minor'), 'bank is reachable eligible ground');
      const id = fishSpotId(ctx.tx, ctx.ty, pool._ix, pool._iy), stock = out.fishStock[i];
      assert.truthy(fishSpotStocked(id, stock));
      assert.gte(fishTier(spotFish(id, stock)), 3);
    }
    assert.falsy(out.wildplants.some(p => ['flowers', 'starflower'].includes(p.crop)), 'reef flowers are replaced by coastal finds');
    const rebuilt = ZoneDressing.dress(fixture());
    assert.eq(JSON.stringify(rebuilt.tidepools), JSON.stringify(out.tidepools));
    assert.eq(JSON.stringify(rebuilt.fishStock), JSON.stringify(out.fishStock));
  });
  test('Mystic Reef tidepools: water carving preserves occupied, restricted and route cells', () => {
    const ctx = fixture(), before = ctx.grid.slice();
    for (let y = 0; y < ctx.N; y++) for (let x = 0; x < ctx.N; x++) {
      const i = y * ctx.N + x;
      if (x < 16) ctx.spawnOpts.spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
      else if (x < 24) ctx.spawnOpts.occupied.add(i);
      else if (x < 32) ctx.grid[i] = WorldGen.T.PATH;
      else if (x < 40) { ctx.grid[i] = WorldGen.T.ROAD; ctx.spawnOpts.roadMask[i] = 1; }
      before[i] = ctx.grid[i];
    }
    const out = ZoneDressing.dress(ctx);
    assert.gt(out.tidepools.length, 0);
    for (let y = 0; y < ctx.N; y++) for (let x = 0; x < 40; x++) {
      const i = y * ctx.N + x;
      assert.eq(ctx.grid[i], before[i], 'protected land and drawn routes keep their terrain');
    }
    const blocked = fixture(); blocked.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    assert.eq(ZoneDressing.dress(blocked).tidepools?.length || 0, 0);
    const narrow = fixture(); narrow.grid.fill(WorldGen.T.WATER);
    for (let y = 1; y < narrow.N - 1; y++) narrow.grid[y * narrow.N + 32] = WorldGen.T.SAND;
    assert.eq(ZoneDressing.dress(narrow).tidepools?.length || 0, 0, 'a one-cell bank is never carved into wider water');
  });
})();
