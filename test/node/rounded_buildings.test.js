// Map sprites and dialog icons use the same reversible role/frame selection.
(function () {
const assets = new Function('window', 'EnemyRoster', 'SpriteLayout', ASSETS_SRC + '\nreturn ASSETS;')({}, EnemyRoster, SpriteLayout);
const withRounded = fn => {
  const previousAssets = globalThis.ASSETS, previousStyle = Render.buildingArtStyle;
  globalThis.ASSETS = assets; Render.buildingArtStyle = 'rounded';
  try { fn(); } finally {
    Render.buildingArtStyle = previousStyle;
    if (previousAssets === undefined) delete globalThis.ASSETS; else globalThis.ASSETS = previousAssets;
  }
};
test('rounded buildings: sixteen named frames preserve their native size and common ground', () => {
  const asset = assets.rounded_buildings, size = pngDims(asset.path), registered = new Map();
  assert.eq(size.w, 384); assert.eq(size.h, 384);
  asset.onLoad({ textures: { get(key) {
    assert.eq(key, 'rounded_buildings');
    return { add(name, source, x, y, width, height) { registered.set(name, { x, y, width, height }); } };
  } } });
  assert.eq(registered.size, 16);
  for (const [name, rect] of registered) {
    const native = name.startsWith('fort') ? 80 : 64;
    assert.eq(rect.width, native, name); assert.eq(rect.height, native, name);
    assert.eq((rect.y + rect.height) % 96, 88, `${name}: bottom is the authored ground anchor`);
    assert.eq(rect.x % 96 + rect.width / 2, 48, `${name}: centred in its own cell`);
    assert.lte(rect.x + rect.width, size.w); assert.lte(rect.y + rect.height, size.h);
  }
});
test('rounded buildings: roles, shop lines and fort conditions resolve distinct authored frames', () => withRounded(() => {
  const house = { kind: 'house', id: 'h', tier: 9 };
  const scene = { save: {}, isClaimedKey: () => true };
  for (const [role, frame] of Object.entries({ plain: 'house', blacksmith: 'blacksmith', trader: 'trader',
    wizard: 'wizard_tower', turret: 'turret', trailer: 'home_wagon', wreck: 'wreck' })) {
    assert.eq(Render.houseTextureKey(role, house, scene), 'rounded_buildings');
    assert.eq(Render.houseTextureFrame(role, house, scene), frame);
  }
  for (const [theme, frame] of Object.entries({ seed: 'seed_shop', supply: 'supply_shop', potion: 'magic_shop',
    relic: 'relic_shop', pet: 'pet_shop', book: 'book_shop' })) {
    assert.eq(Render.houseTextureFrame('shop', house, { ...scene, shopLine: () => ({ theme }) }), frame);
    assert.eq(Render.houseTextureFrame('shop', house, scene, theme), frame, 'restore choice can preview a future shop line');
  }
  assert.eq(Render.houseTextureFrame('shop', house, scene), 'market');
  assert.eq(Render.houseTextureFrame('fort', house, scene), 'fort');
  const unclaimed = { ...scene, isClaimedKey: () => false };
  assert.eq(Render.houseTextureFrame('fort', house, unclaimed), 'fort_unclaimed');
  assert.eq(Render.spriteTint(house, unclaimed, 'rounded_buildings'), 0xffffff, 'authored wreck palette is not washed twice');
  Render.buildingArtStyle = 'legacy';
  assert.eq(Render.houseTextureKey('plain', house, scene), 'house');
  assert.eq(Render.houseTextureFrame('plain', house, scene), 'front');
  assert.eq(Render.houseTextureKey('fort', house, unclaimed), 'house_fort_unclaimed');
  assert.eq(Render.houseTextureKey('trailer', house, scene), 'house_trailer');
}));
test('rounded buildings: native frames keep existing footprint scales and ground offsets', () => withRounded(() => {
  const rects = assets.rounded_buildings.frameRects;
  const textures = { exists: () => true, get: () => ({ get: name => rects[name] }) };
  const house = { kind: 'house', id: 'h', area: 120, footDx: .3, footDy: -.2 };
  const scene = { textures, save: {}, cellM: 7, isClaimedKey: () => true };
  for (const role of ['plain', 'fort', 'trailer', 'turret']) {
    const { resolveAppearance } = Render.objectAppearance(scene, new Map([[house, role]]));
    const art = resolveAppearance(house), rect = rects[art.frameVal];
    assert.eq(art.texKey, 'rounded_buildings');
    assert.eq(art.origin.join(','), '0.5,1');
    assert.eq(art.dxPx, Math.round(house.footDx * CELL_PX));
    assert.eq(art.dyPx, Math.round(house.footDy * CELL_PX));
    const expected = houseArtScale(house.area, 72, role, scene.cellM, CELL_PX) * 72;
    assert.inRange(art.scl * rect.width, expected - .001, expected + .001, 'the source resolution cannot enlarge the world footprint');
  }
}));
})();
