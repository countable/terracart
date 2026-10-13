(function () {
  const kinds = ['poison', 'fire', 'paralysis', 'confusion'];
  function dressing(kind, reason = 0, short = false, blockedMiddle = false) {
    const N = 64, extent = 4096;
    const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
    const spawnOpts = { occupied: new Set(), roadMask: new Uint8Array(N * N),
      roadClass: new Uint8Array(N * N), spawnWhy: new Uint16Array(N * N).fill(reason), pois: [] };
    if (blockedMiddle) for (let iy = 0; iy < N; iy++) for (let ix = 20; ix <= 44; ix++)
      spawnOpts.spawnWhy[iy * N + ix] = WorldGen.SPAWN_WHY.PRIVATE;
    const rec = { variant: `${kind}_path`, key: `geyser-test-${kind}`, lineKey: `geyser-test-${kind}`, size: 'path',
      line: [{ x: 512, y: 2048 }, { x: short ? 576 : 3584, y: 2048 }], halfW: 1.5 };
    const index = { extent, lines: [rec], vehicleLines: [], hoardPois: [] };
    return StreetVariants.dress({ index, tx: 0, ty: 0, N, tileEdgeM: N * 7, grid, spawnOpts });
  }
  test('geyser paths: every kind has deterministic verge hazards and a related daily shrine', () => {
    for (const kind of kinds) {
      const a = dressing(kind), b = dressing(kind);
      assert.eq(JSON.stringify(a.vents), JSON.stringify(b.vents));
      assert.gt(a.vents.length, 4);
      assert.eq(new Set(a.vents.map(v => v.id)).size, a.vents.length);
      assert.truthy(a.vents.every(v => v.kind === kind && v._street === `${kind}_path`));
      const shrines = a.objects.filter(o => o.kind === 'grove_shrine');
      assert.eq(shrines.length, 1);
      assert.eq(shrines[0].shrineKind, `${kind}_path_shrine`);
      assert.truthy(a.vents.every(v => v.x !== shrines[0].x || v.y !== shrines[0].y));
      for (let i = 0; i < 30; i++) assert.truthy(StreetVariants.streetShrineChosen(`section-${i}`, `${kind}_path`));
      assert.eq(Shrines.SHRINE_KINDS[`${kind}_path_shrine`].streetChance, 1);
    }
  });
  test('geyser paths: shrines search beyond a blocked midpoint', () => {
    for (const kind of kinds) {
      const a = dressing(kind, 0, false, true);
      assert.eq(a.objects.filter(o => o.kind === 'grove_shrine').length, 1);
    }
  });
  test('geyser paths: a short section retains its geyser and shrine where safe', () => {
    for (const kind of kinds) {
      const a = dressing(kind, 0, true);
      assert.eq(a.vents.length, 1);
      assert.eq(a.objects.filter(o => o.kind === 'grove_shrine').length, 1);
    }
  });
  test('geyser paths: private ground rejects all pieces and kerbs reject hazards', () => {
    for (const kind of kinds) {
      const privateGround = dressing(kind, WorldGen.SPAWN_WHY.PRIVATE);
      assert.eq(privateGround.vents.length, 0);
      assert.eq(privateGround.objects.length, 0);
      assert.eq(dressing(kind, WorldGen.SPAWN_WHY.KERB).vents.length, 0);
    }
  });
})();
