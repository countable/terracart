// Supplied enemy sheets are 16px cells; rendering, wheels and tap bounds all
// resolve their geometry from the same creature row.
test('enemy art: ghost uses supplied art with spectral effects, without the slime tint', () => {
  const art = SpriteLayout.creatureArt('ghost');
  assert.eq(art.sheet, 'ghost');
  assert.eq(art.fw, 16);
  assert.eq(art.fh, 16);
  assert.eq(SpriteLayout.creatureTint('ghost'), 0xffffff);
  assert.eq(SpriteLayout.creatureAlpha('ghost'), SpriteLayout.GHOST_ALPHA);
  assert.truthy(SpriteLayout.creatureGlow('ghost'));
  assert.truthy(SpriteLayout.creatureAirborne('ghost'));
  for (let frame = 0; frame < 4; frame++) {
    assert.eq(SpriteLayout.creatureCycleFrame({ kind: 'ghost' }, frame * art.frameMs), frame);
  }
});

test('enemy art: rooted plant keeps its ground line and plays a complete bite before idling', () => {
  const art = SpriteLayout.creatureArt('plant');
  assert.eq(art.sheet, 'plant');
  assert.eq(art.float, 0);
  assert.eq(art.foot, 1);
  assert.falsy(SpriteLayout.creatureHop('plant'));
  assert.falsy(SpriteLayout.creatureAirborne('plant'));
  const plant = { kind: 'plant', _attackT0: 1000, _attackUntil: 1600 };
  for (let frame = 0; frame < 4; frame++) {
    assert.eq(SpriteLayout.creatureCycleFrame(plant, 1000 + 150 * frame), 24 + frame);
  }
  assert.eq(SpriteLayout.creatureCycleFrame(plant, 1600), Math.floor(1600 / art.frameMs) % 4);
  assert.eq(SpriteLayout.creatureCycleFrame({ kind: 'plant' }, 0), 0);
});

test('enemy art: timed attacks do not change existing idle cycles without attack artwork', () => {
  const slime = { kind: 'purple_slime', _attackT0: 0, _attackUntil: 10000 };
  const art = SpriteLayout.creatureArt('purple_slime');
  assert.eq(SpriteLayout.creatureCycleFrame(slime, art.frameMs * 3), 3);
  assert.eq(SpriteLayout.creatureCycleFrame({ kind: 'unknown' }, 1000), 0);
});

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
      assert.eq(a.scale, SpriteLayout.creatureArt(row.variantOf).scale * factor * (row.artScale ?? 1));
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

// Hold the approved effective sizes, including variants whose parents shrank.
test('enemy art: size reduction targets 2x foes and the two selected giants only', () => {
  const smaller = ['bat', 'spider', 'zombie', 'plant', 'skeleton', 'vampire_bat',
    'brute', 'poison_spider', 'dryad', 'lich', 'bone_plant', 'fiend', 'succubus',
    'hell_brute', 'ghost', 'pink_ghost', 'giant_cave_slime', 'sand_skeleton',
    'marsh_zombie', 'copper_plant', 'ash_zombie', 'obsidian_brute'];
  const expected = Object.fromEntries(smaller.map(kind => [kind, 1.5]));
  Object.assign(expected, { giant_lich: 2.4, giant_skeleton: 1.68,
    slime: 1.2, metal_slime: 1.25, cave_slime: 1.25, purple_slime: 0.95, goblin: 1.25,
    goblin_archer: 1.25, goblin_trapper: 1.25, mini_slime: 0.78,
    mini_spider: 1.3, giant_slime: 1.536, giant_spider: 3.2,
    moss_slime: 1.2, giant_plant: 3.2,
    // The gull and the raven wear the crow's geometry (CREATURE_ART), unscaled.
    gull: 1.3, raven: 1.3 });
  assert.eq(Object.keys(expected).length, EnemyRoster.ROWS.filter(row => !row.art.directions).length);
  for (const [kind, scale] of Object.entries(expected)) {
    assert.lt(Math.abs(SpriteLayout.creatureScale(kind) - scale), 1e-9, kind);
    assert.lt(Math.abs(SpriteLayout.creatureScale(kind, 1.5) - scale * 1.5), 1e-9,
      kind + ' retains the instance multiplier');
  }
});

// Imported MiniWorld sheets have authored left/right poses and variable column
// counts; they cannot use the older 12-column enemy48 addressing.
test('enemy art: imported directional frames fit their real sheets and retain authored left poses', () => {
  for (const row of EnemyRoster.ROWS.filter(r => r.art.directions)) {
    const { w: width, h: height } = pngDims(row.art.path);
    const count = (width / row.art.frameWidth) * (height / row.art.frameHeight);
    for (const states of Object.values(row.art.directions)) {
      for (const frames of Object.values(states)) for (const frame of frames) {
        assert.inRange(frame, 0, count - 1, row.id);
      }
    }
    const art = SpriteLayout.creatureArt(row.id);
    assert.gt(art.scale, 0, row.id);
    assert.gt(art.maxY, art.minY, row.id);
    for (const facing of ['down', 'up', 'left', 'right']) {
      const c = { kind: row.id, _facing: facing, _moveUntil: 1000 };
      const a = SpriteLayout.creatureAppearance(c, 0);
      const dir = row.art.directions[facing] || row.art.directions.side;
      assert.eq(a.frame, dir.move[0], row.id + facing);
      if (row.art.directions[facing]) assert.falsy(a.flipX, row.id + ' uses authored direction');
    }
  }
});
