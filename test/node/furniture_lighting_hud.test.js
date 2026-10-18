// Home luxury uses the existing sign pool, with independent instant text.
(() => {
  const start = RENDER_SRC.indexOf('Render.homeLuxuryLabel = function homeLuxuryLabel(scene) {');
  const end = RENDER_SRC.indexOf('\n};', start);
  const label = new Function('Furniture', 'const Render = {}; ' + RENDER_SRC.slice(start, end + 3)
    + '; return Render.homeLuxuryLabel;')({ luxuryOf: (save, key) => save.houseLuxury[key]?.score || 0 });
  test('furniture HUD: indoor score updates its retained key and never types with Home', () => {
    let inside = true;
    const scene = { save: { starterShopId: 'home', houseLuxury: { home: { score: 9 } } }, homeInside: () => inside };
    assert.eq(label(scene), '9'); const old = scene._homeLuxuryLabel;
    assert.eq(label(scene), '9'); assert.eq(scene._homeLuxuryLabel, old, 'stable score reuses label');
    scene.save.houseLuxury.home.score = 16;
    assert.eq(label(scene), '16'); assert.truthy(scene._homeLuxuryLabel.key !== old.key, 'luxury invalidates label');
    assert.eq(scene._homeSignT0, undefined, 'score never starts or reads the Home typing clock');
    inside = false; assert.eq(label(scene), null, 'no score outdoors');
    inside = true; scene.save.houseLuxury.home.score = 0;
    assert.eq(label(scene), '0', 'empty Home still shows its score');
    scene.save.starterShopId = 'new-home'; assert.eq(label(scene), '0');
    assert.truthy(scene._homeLuxuryLabel.key.includes('new-home'), 'Home changes invalidate the label');
  });
  test('furniture HUD: score shares the Home sign anchor, pool and player fade', () => {
    const begin = RENDER_SRC.indexOf('  const luxuryText = Render.homeLuxuryLabel(scene);');
    const end = RENDER_SRC.indexOf("  }, labelFactory('sign'));", begin);
    const body = RENDER_SRC.slice(begin, end);
    assert.truthy(body.includes('scene.shopLabelPool'), 'same retained text pool');
    assert.truthy(body.includes("luxury ? '#ffffff'"), 'white score');
    assert.truthy(body.includes('home && !luxury ? _homeSignTyped(full) : full'), 'instant score, independently typed Home');
    assert.truthy(body.includes('HomeArea.HOUSE.signLiftPx'), 'same Home sign anchor');
    assert.truthy(body.includes('luxury ? tx.height + 4 : 0'), 'score sits above the Home sign');
    assert.truthy(body.includes('fadeLabelOverPlayer(tx, _playerBox)'), 'same overlap fade');
  });
})();
