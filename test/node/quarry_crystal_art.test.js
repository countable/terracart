(() => {
  test('quarry crystal art: generated deposits use their assigned gem art', () => {
    let crystals = 0;
    for (const row of ZoneVariants.forKind('quarry')) {
      assert.eq(JSON.stringify(row.materialFrames.crystal), '[59]', row.id);
      const N = 48, c = 24, center = (c + .5) * 4096 / N;
      const anchor = { kind: 'quarry', variant: row.id, generated: 'parking_lanes', owned: true,
        gx: center, gy: center, lx: center, ly: center, key: 18,
        upm: N * WorldGen.CELL_M / 4096, R: 21 };
      const coverage = new Uint16Array(N * N);
      for (let y = 3; y < N - 3; y++) for (let x = 3; x < N - 3; x++) coverage[y * N + x] = 1;
      const out = ZoneDressing.dress({ N, tx: 0, ty: 0, tileEdgeM: N * WorldGen.CELL_M,
        grid: new Uint8Array(N * N).fill(WorldGen.T.ROCK), field: { anchors: [anchor], coverage },
        chests: [], spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(N * N), roadMask: new Uint8Array(N * N) } });
      for (const o of out.objects) {
        assert.falsy(o._zoneObjectFrame === 58, 'quartz appearance is disabled');
        if (!mineralDeposit(o)) continue;
        crystals++;
        assert.eq(o.deposit, quarryGemDeposit(`${anchor.gx},${anchor.gy}`));
        assert.eq(o._zoneObjectFrame, undefined, 'legacy frame cannot override assigned art');
        const gem = mineralDeposit(o);
        if (gem.item === 'sapphire') assert.eq(gem.art.frame, 59);
      }
    }
    assert.gt(crystals, 0, 'the artwork change does not remove the deposits');
  });
})();
