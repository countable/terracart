(function () {
  const W = WorldGen, N = 64, edge = N * W.CELL_M;
  const point = (x, y) => ({ x: x * 4096 / N, y: y * 4096 / N });
  const poi = (cls, x, y) => ({ name: 'poi', features: [
    { type: 1, tags: { class: cls }, geom: [[point(x, y)]] },
  ] });

  test('civic POIs: a point without a building footprint cannot create a castle', () => {
    for (const cls of ['school', 'college', 'university', 'sports_centre', 'ice_rink', 'stadium']) {
      for (const [x, y] of [[32, 32], [1, 1]]) {
        const out = W.rasterizeTile([poi(cls, x, y)], N, 0, 0, edge);
        assert.eq(out.grid.filter(t => W.isBuildingTerrain(t)).length, 0, cls);
        assert.eq(out.objects.filter(o => o.kind === 'tower').length, 0, cls);
        assert.eq(out.owners.filter(Boolean).length, 0, 'no invented building ownership');
      }
    }
  });

  test('civic POIs: Casorso school field fixture remains free of an invented castle', () => {
    const tx = 2754, ty = 5566, n = W.cellsPerEdgeForTile(ty);
    const layers = MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]);
    const x = Math.floor(1312 * n / 4096), y = Math.floor(3693 * n / 4096);
    const field = layers.find(l => l.name === 'poi').features.find(f =>
      f.tags.class === 'school' && f.geom.some(r => r[0].x === 1312 && r[0].y === 3693));
    assert.truthy(field, 'fixture still contains the school POI in the field');
    const out = W.rasterizeTile(layers, n, tx, ty, W.tileEdgeMeters(W.latOfRowCentre(ty)));
    const expected = `b_${tx * n + x}_${ty * n + y}`;
    assert.falsy(out.ownerKeys.includes(expected), 'the field POI does not own a castle');
    assert.eq(out.objects.filter(o => o.kind === 'tower' && o.castle === expected).length, 0);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -4; dx <= 4; dx++) {
      assert.falsy(W.isBuildingTerrain(out.grid[(y + dy) * n + x + dx]), 'the former 9×7 castle stays open');
    }
  });
})();
