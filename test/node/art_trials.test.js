// Exercise URL opt-in in isolated scopes: ordinary play must never change.
(() => {
  function trial(search) {
    const assets = { existing: { path: 'unchanged.png' } };
    const layout = { ART_BOUNDS: {} };
    const art = new Function('location', 'window', 'ASSETS', 'SpriteLayout', 'treeArtFrame',
      ART_TRIALS_SRC + '\nreturn ArtTrials;')({ search }, {}, assets, layout, treeArtFrame);
    return { art, assets, layout };
  }
  test('art trials: no opt-in leaves assets and tree appearance unchanged', () => {
    for (const search of ['', '?artTrial=unknown', '?artTree=ALT-0176']) {
      const { art, assets, layout } = trial(search);
      assert.eq(Object.keys(assets).length, 1);
      assert.eq(Object.keys(layout.ART_BOUNDS).length, 0);
      assert.eq(art.tree({ id: 'oak', size: 'large' }), null);
      assert.falsy(art.water);
    }
  });
  test('art trials: stable mature tree options preserve species and growth', () => {
    const { art, assets, layout } = trial('?artTrial=trees-water');
    assert.eq(art.tree({ species: 'pine', size: 'large' }).alternativeId, 'ALT-0168');
    for (const size of ['bush', 'small', 'medium']) assert.eq(art.tree({ size }), null);
    assert.eq(art.tree({ planted_t: Date.now(), species: 'pine' }), null);
    const choices = new Set();
    for (let i = 0; i < 100; i++) {
      const object = { id: 'tree/' + i, species: 'maple', size: 'large' };
      const before = JSON.stringify(object), chosen = art.tree(object);
      assert.eq(JSON.stringify(object), before);
      assert.eq(art.tree({ ...object }).key, chosen.key);
      assert.truthy(assets[chosen.key]);
      assert.truthy(layout.ART_BOUNDS[chosen.key + ':0']);
      choices.add(chosen.alternativeId);
    }
    assert.eq(choices.size, 3);
    assert.truthy(art.water);
    assert.eq(assets[art.waterKey].frameWidth, 16);
  });
  test('art trials: independent water and forced broadleaf comparisons', () => {
    const water = trial('?artTrial=water');
    assert.eq(Object.keys(water.assets).length, 2);
    assert.eq(water.art.tree({ size: 'large' }), null);
    const trees = trial('?artTrial=trees&artTree=ALT-0176');
    assert.falsy(trees.art.water);
    assert.eq(trees.art.tree({ size: 'large' }).alternativeId, 'ALT-0176');
    assert.eq(trees.art.tree({ species: 'pine', size: 'large' }).alternativeId, 'ALT-0168');
  });
  test('art trials: renderer uses trial frames and seats native tree bounds', () => {
    const { art, layout } = trial('?artTrial=trees-water');
    const start = RENDER_SRC.indexOf('    tree:   { key: (o) => {');
    const end = RENDER_SRC.indexOf('    // Which look', start);
    assert.truthy(start >= 0 && end > start);
    const source = RENDER_SRC.slice(start, end);
    const spec = new Function('ArtTrials', 'treeArtFrame', 'treeScale',
      'return ({' + source + '}).tree;')(art, treeArtFrame, treeScale);
    for (const species of ['pine', 'maple']) {
      for (const size of ['small', 'medium', 'large']) {
        const object = { id: species + size, species, size };
        const key = spec.key(object), frame = spec.frame(object);
        const bounds = layout.ART_BOUNDS[key + ':' + frame];
        assert.eq(spec.scale(object), treeScale(object));
        if (size !== 'large') {
          assert.eq(key, species === 'pine' ? 'pine_tree' : 'trees');
          assert.eq(frame, treeArtFrame(object));
          continue;
        }
        assert.truthy(bounds);
        assert.eq(frame, 0);
        const origin = spec.origin(object), scale = spec.scale(object);
        const seat = SpriteLayout.contactSeat(bounds, ...origin, scale, scale, false);
        const bottom = (bounds.maxY - origin[1] * bounds.fh) * scale + seat.dyPx;
        const expectedBottom = 5 * scale;
        assert.truthy(Math.abs(bottom - expectedBottom) < 0.000001);
      }
    }
  });
})();
