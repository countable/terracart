(() => {
  test('zone spawn override: Windermere fringe uses zone eligibility without changing cave eligibility', () => {
    const tx = 2754, ty = 5566, N = WorldGen.cellsPerEdgeForTile(ty);
    const edge = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
    const r = WorldGen.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]), N, tx, ty, edge);
    const W = WorldGen.SPAWN_WHY, inferred = W.PRIVATE | W.BEHIND_HOUSE;
    const source = r.zone.caveSource;
    assert.truthy(source.spawnWhy, 'cave generation retains the original source mask');
    assert.falsy(source.spawnWhy === r.spawnWhy, 'surface adjustments never mutate the cave mask');
    const poi = r.objects.find(o => /windermere park/i.test(o.name || ''));
    const a = r.zone.anchors.find(a => `${a.lx},${a.ly}` === poi._poiAt);
    const slot = r.zone.anchors.indexOf(a) + 1;
    let reopened = 0;
    for (let i = 0; i < N * N; i++) {
      const changed = source.spawnWhy[i] ^ r.spawnWhy[i];
      assert.eq(changed & ~inferred, 0, `cell ${i}: source site and geometry reasons stay intact`);
      if (!changed) continue;
      assert.truthy(r.zone.coverage[i], `cell ${i}: no override outside the union`);
      if (r.grid[i] === WorldGen.T.CAVE_LAVA) {
        const winner = r.zone.anchors[r.zone.coverage[i] - 1];
        assert.eq(ZoneVariants.pick(winner).id, 'quarry-crater', 'only crater layouts paint surface lava');
        assert.truthy(r.zoneDress.objects.some(o => o.kind === 'lava_vent' && o._iy * N + o._ix === i), 'lava has an authored hazard marker');
      } else assert.includes(Zones.zoneTerrains(), r.grid[i], `cell ${i}: only zone-painted ground opens`);
      if (r.zone.coverage[i] === slot && !(r.spawnWhy[i] & WorldGen.SPAWN_WHY_HARD)) reopened++;
    }
    assert.gt(reopened, 5, 'real residential fringe cells now accept the declared pattern');
    for (const o of [...r.zoneDress.objects, ...r.zoneDress.wildplants]) {
      const x = Math.floor((o.x - tx * edge) / (edge / N));
      const y = Math.floor((o.y - ty * edge) / (edge / N));
      if (r.zone.coverage[y * N + x] !== slot) continue;
      assert.truthy(WorldGen.isSpawnCell(r.grid, N, N, x, y,
        { roadMask: r.roadMask, spawnWhy: r.spawnWhy }, 'minor'), `${o.id}: runtime sees the same eligibility`);
    }
  });
})();
