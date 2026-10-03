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
  const winner = () => {
    for (let tx = 0; tx < 100; tx++) if (shrine(ZoneDressing.dress(context(tx)))) return tx;
    throw new Error('No stronghold shrine found');
  };
  test('stronghold altar: half of complete source sites deterministically receive the Ember altar', () => {
    assert.eq(ZoneVariants.byId('quarry-stronghold').shrineChance, .5);
    assert.eq(Shrines.kindForZoneVariant('quarry-stronghold'), 'ember_altar');
    let count = 0;
    for (let tx = 0; tx < 200; tx++) {
      const ctx = context(tx), out = ZoneDressing.dress(ctx), altar = shrine(out);
      const eligible = fnv1a(`zone-shrine|${ZoneVariants.identity(ctx.field.anchors[0])}`) / 4294967296 < .5;
      assert.eq(!!altar, eligible, 'the source identity owns the half-chance roll');
      if (!altar) continue;
      count++;
      assert.eq(altar.shrineKind, 'ember_altar');
      assert.eq(altar.kind, 'grove_shrine');
      assert.eq(records(out).filter(o => o._ix === altar._ix && o._iy === altar._iy).length, 1,
        'altar never overlaps a wall, finite find or guard');
      if (tx < 10) assert.eq(JSON.stringify(shrine(ZoneDressing.dress(context(tx)))), JSON.stringify(altar), 'rebuild is stable');
    }
    assert.inRange(count, 80, 120, 'roughly half the sites have an altar');
  });
  test('stronghold altar: ownership, clipping, reserved cells and spawn gates never mint an unsafe altar', () => {
    const tx = winner(), first = shrine(ZoneDressing.dress(context(tx))), i = first._iy * N + first._ix;
    const unowned = context(tx); unowned.field.anchors[0].owned = false;
    assert.falsy(shrine(ZoneDressing.dress(unowned)), 'neighbor fragments cannot duplicate the shrine');
    const clipped = context(tx); clipped.field.anchors[0].clipped = true;
    assert.falsy(shrine(ZoneDressing.dress(clipped)), 'incomplete sources never get a finite shrine');
    for (const reason of ['ROAD', 'PRIVATE', 'RESTRICTED', 'SENSITIVE']) {
      const blocked = context(tx); blocked.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY[reason]);
      assert.falsy(shrine(ZoneDressing.dress(blocked)), reason);
    }
    const reserved = context(tx); reserved.spawnOpts.occupied.add(i); reserved.tideSeats = new Set([i]);
    const moved = shrine(ZoneDressing.dress(reserved));
    assert.truthy(moved, 'a safe alternative retains the same site reward');
    assert.falsy(moved._ix === first._ix && moved._iy === first._iy, 'reserved entrance/tide cells stay clear');
    assert.eq(moved.id, first.id, 'moving its safe seat never changes the shrine ledger identity');
    const scaled = context(tx); scaled.tileEdgeM *= 1.75;
    const again = shrine(ZoneDressing.dress(scaled));
    assert.eq(again.id, first.id, 'a different player metre frame keeps the same site identity');
    assert.eq(again._ix, first._ix); assert.eq(again._iy, first._iy);
  });
})();
