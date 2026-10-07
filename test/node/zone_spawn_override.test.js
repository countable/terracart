(() => {
  test('zone exclusions: Windermere fringe preserves surface and cave eligibility', () => {
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
    let excluded = 0;
    for (let i = 0; i < N * N; i++) {
      assert.eq(r.spawnWhy[i], source.spawnWhy[i], `cell ${i}: nexus painting preserves source exclusions`);
      if (r.zone.coverage[i] === slot && (source.spawnWhy[i] & inferred)) excluded++;
    }
    assert.gt(excluded, 5, 'real residential fringe exercises retained exclusions');
    for (const o of [...r.zoneDress.objects, ...r.zoneDress.wildplants]) {
      const x = Math.floor((o.x - tx * edge) / (edge / N));
      const y = Math.floor((o.y - ty * edge) / (edge / N));
      if (r.zone.coverage[y * N + x] !== slot) continue;
      assert.truthy(WorldGen.isSpawnCell(r.grid, N, N, x, y,
        { roadMask: r.roadMask, spawnWhy: r.spawnWhy }, 'minor'), `${o.id}: runtime sees the same eligibility`);
    }
  });
})();
