(function () {
  const N = 24, edge = N * WorldGen.CELL_M;
  function context(tx = 0) {
    const center = 12.5 * 4096 / N;
    const a = { kind: 'quarry', variant: 'quarry-stronghold', generated: 'parking_lanes', owned: true,
      gx: tx * 4096 + center, gy: center, lx: center, ly: center, key: tx + 5,
      upm: N * WorldGen.CELL_M / 4096, R: 21 };
    const coverage = new Uint16Array(N * N);
    for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) coverage[y * N + x] = 1;
    return { N, tx, ty: 0, tileEdgeM: edge, grid: new Uint8Array(N * N).fill(WorldGen.T.ROCK),
      field: { anchors: [a], coverage }, chests: [],
      spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(N * N), roadMask: new Uint8Array(N * N) } };
  }
  const shrine = out => out.objects.find(o => o.zoneLayer === 'shrine');
  const records = out => [...out.objects, ...out.wildplants, ...out.guards, ...out.treasures];
  test('crater altar: centered dry island within a rounded five-cell lava pool', () => {
    const ctx=context(); ctx.field.anchors[0].variant='quarry-crater';
    const out=ZoneDressing.dress(ctx), altar=shrine(out);
    assert.truthy(altar); assert.eq(altar.shrineKind,'ember_altar');
    assert.eq(out.objects.filter(o=>o.kind==='lava_vent').length,20);
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++) {
      const i=(altar._iy+dy)*N+altar._ix+dx;
      const corner = Math.abs(dx) === 2 && Math.abs(dy) === 2;
      assert.eq(ctx.grid[i],(dx||dy) && !corner ? WorldGen.T.CAVE_LAVA : WorldGen.T.ROCK);
    }
    assert.eq(records(out).filter(o=>o._ix===altar._ix&&o._iy===altar._iy).length,1);
    for(const field of ['owned','clipped']) {
      const blocked=context();blocked.field.anchors[0].variant='quarry-crater';
      blocked.field.anchors[0][field]=field==='clipped';
      assert.falsy(shrine(ZoneDressing.dress(blocked)));
    }
    const blocked=context();blocked.field.anchors[0].variant='quarry-crater';
    blocked.spawnOpts.spawnWhy[altar._iy*N+altar._ix]=WorldGen.SPAWN_WHY.SENSITIVE;
    assert.falsy(shrine(ZoneDressing.dress(blocked)),'center-only altar cannot move to a safe rim');
  });
  test('stronghold rewards: three tier-two chests, some foundation pots and no shrine', () => {
    const out=ZoneDressing.dress(context()), finds=out.objects.filter(o=>o.zoneLayer==='find');
    assert.eq(finds.length,3);assert.eq(out.treasures.length,0);assert.falsy(shrine(out));
    assert.falsy(Shrines.kindForZoneVariant('quarry-stronghold'));
    for(const o of finds){assert.eq(o.kind,'chest');assert.eq(o.tierSeed,2);assert.eq(chestTier(o),2);assert.falsy(o.zoneNexus);assert.falsy(o.fixedLoot);assert.falsy(o.daily);assert.falsy(o.crate);}
    assert.gt(out.objects.filter(o=>o.barrelStyle==='clay_pot').length,0);
    assert.eq(new Set(records(out).map(o=>o._ix+','+o._iy)).size,records(out).length);
  });
})();
