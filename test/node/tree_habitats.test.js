// Exercise the real scatter before authored Nexus layouts claim park cells.
(() => {
  const EXT = 4096, N = 64, EDGE = N * WorldGen.CELL_M;
  const ring = [{ x: 0, y: 0 }, { x: EXT, y: 0 }, { x: EXT, y: EXT }, { x: 0, y: EXT }, { x: 0, y: 0 }];
  const build = (tags, tx) => WorldGen.rasterizeTile([
    { name: 'landcover', features: [{ type: 3, tags, geom: [ring] }] },
  ], N, tx, 5, EDGE);

  test('tree habitats: forest scatter is pine across polygon seeds', () => {
    for (const tx of [2, 3, 4]) {
      const r = build({ class: 'wood' }, tx);
      const trees = (r.zone?.caveSource || r.caveSource || r).objects.filter(o => /^tree_/.test(o.id));
      assert.gt(trees.length, 20, 'real forest canopy');
      for (const o of trees) {
        assert.eq(o.species, 'pine');
        assert.eq(o.treeSpeciesFixed, true, 'home overlay preserves habitat');
      }
    }
  });

  test('tree habitats: wooded park scatter is maple across polygon seeds', () => {
    let checked = 0;
    for (let tx = 1; tx < 80 && checked < 3; tx++) {
      // Park character uses the polygon centroid in global MVT coordinates.
      if (BiomeProfiles.parkCharacterAt(tx * EXT + EXT * 0.5, 5 * EXT + EXT * 0.5) !== 'wooded') continue;
      const r = build({ class: 'grass', subclass: 'park' }, tx);
      const trees = (r.zone?.caveSource || r.caveSource || r).objects.filter(o => /^ptree_/.test(o.id));
      if (!trees.length) continue;
      checked++;
      assert.gt(trees.length, 10, 'real wooded park canopy');
      for (const o of trees) {
        assert.eq(o.species, 'maple');
        assert.eq(o.treeSpeciesFixed, true, 'home overlay preserves habitat');
      }
    }
    assert.eq(checked, 3, 'multiple wooded polygons exercised');
  });
})();
