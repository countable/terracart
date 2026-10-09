test('green dragon: hatchling is peaceful, catchable and uses baby growth', () => {
  const baby = { id: 'hatched_green_dragon', kind: 'green_dragon', raised: true, born: 1000, shiny: false };
  assert.truthy(Pets.catchable(baby));
  assert.falsy(Combat.isEnemy(baby));
  assert.truthy(SpriteLayout.creatureWanders(baby.kind));
  assert.eq(SpriteLayout.creatureInstScale(baby, 1000), SpriteLayout.PET_BABY.scale);
  assert.truthy(favouriteItems(baby.kind).length, 'can eat favourite meals to grow');
  assert.eq(ITEM_BY_ID.baby_green_dragon.base, baby.kind);
});

test('green dragon: authored directions and recoloured map sheet also supply its icon', () => {
  const window = {};
  const assets = new Function('window', 'EnemyRoster', 'SpriteLayout', ASSETS_SRC + '\nreturn ASSETS;')(window, EnemyRoster, SpriteLayout);
  const art = SpriteLayout.creatureArt('green_dragon');
  const asset = assets[art.sheet];
  assert.eq(art.sheet, 'green_dragon');
  assert.eq(asset.frameWidth, art.fw);
  assert.eq(asset.frameHeight, art.fh);
  assert.eq(typeof asset.onLoad, 'function', 'green colour is baked into the texture');
  const { w, h } = pngDims(asset.path);
  for (const facing of ['down', 'up', 'left', 'right']) {
    const pose = SpriteLayout.creatureAppearance({ kind: 'green_dragon', _facing: facing, _moveUntil: 1000 }, 0);
    assert.eq(pose.frame, art.directions[facing].move[0]);
    assert.falsy(pose.flipX);
    for (const frames of Object.values(art.directions[facing])) {
      for (const frame of frames) assert.inRange(frame, 0, w / art.fw * h / art.fh - 1);
    }
  }
  assert.truthy(SCENE_SRC.includes("ITEM_DATA_URLS.green_dragon = bakeSheetFrame('green_dragon', 0, 32, 32)"));
});
