// The approved roster supplies every enemy surface with the same art source.
test('enemy art: all roster rows resolve complete sheets and variant geometry', () => {
  const assets = new Function('window', 'EnemyRoster', 'SpriteLayout', ASSETS_SRC + '\nreturn ASSETS;')({}, EnemyRoster, SpriteLayout);
  for (const row of EnemyRoster.ROWS) {
    const a = SpriteLayout.creatureArt(row.id);
    assert.truthy(a, row.id + ' has art');
    assert.truthy(assets[a.sheet], row.id + ' sheet is loaded');
    if (a.sheet !== row.id) assert.falsy(assets[row.id], row.id + ' reuses the base texture without another preload');
    assert.eq(assets[a.sheet].path, row.art.path, row.id + ' matches catalogue art');
    assert.eq(a.fw, row.art.frameWidth);
    assert.eq(a.fh, row.art.frameHeight);
    assert.truthy(SpriteLayout.creatureWanders(row.id), row.id + ' has behaviour');
    if (row.variantOf) {
      assert.eq(SpriteLayout.baseKind(row.id), row.variantOf);
      const factor = row.variantType === 'Mini' ? 0.65 : row.variantType === 'Giant' ? 1.6 : 1;
      assert.eq(a.scale, SpriteLayout.creatureArt(row.variantOf).scale * factor);
    }
  }
});

test('enemy art: luminance palettes preserve black and alpha, with distinct bright cyan bats', () => {
  const window = {};
  new Function('window', 'EnemyRoster', 'SpriteLayout', ASSETS_SRC)(window, EnemyRoster, SpriteLayout);
  const input = [0, 0, 0, 255, 80, 20, 30, 128, 255, 255, 255, 255];
  window.recolorEnemyPixels(input, EnemyRoster.get('vampire_bat').palette);
  assert.eq(input.slice(0, 4).join(), '0,0,0,255');
  assert.eq(input[7], 128, 'alpha preserved');
  assert.gt(input[5], input[4] * 2, 'cyan green dominates red');
  assert.gt(input[6], input[4] * 2, 'cyan blue dominates red');
  assert.eq(input.slice(8).join(), '236,255,255,255');
  for (const id of ['copper_plant', 'vampire_bat', 'lich']) {
    assert.eq(SpriteLayout.creatureArt(id).sheet, id, id + ' uses its generated palette texture');
    assert.truthy(window.ASSETS[id].onLoad, id + ' palette is generated at load');
  }
});

test('enemy art: dungeon ghost instance size carries through crown and tap geometry', () => {
  const scale = SpriteLayout.creatureInstScale({ kind: 'ghost', _artScale: 1.5 });
  assert.eq(scale, 1.5);
  assert.lt(SpriteLayout.creatureHealthBarTop('ghost', scale), SpriteLayout.creatureHealthBarTop('ghost'), 'bar rises with crown');
  assert.lt(SpriteLayout.creatureTapSpanPx('ghost', scale).top, SpriteLayout.creatureTapSpanPx('ghost').top, 'tap reaches larger crown');
  assert.lt(SpriteLayout.creatureWheelDy('ghost', scale), SpriteLayout.creatureWheelDy('ghost'), 'wheel rises with crown');
});
