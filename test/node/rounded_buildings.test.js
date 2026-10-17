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
    trailer: 'home_wagon', wreck: 'wreck' })) {
    assert.eq(Render.houseTextureKey(role, house, scene), 'rounded_buildings');
    assert.eq(Render.houseTextureFrame(role, house, scene), frame);
  }
  // The wizard tower and turret keep their original in-game art in every style.
  assert.eq(Render.houseTextureKey('wizard', house, scene), 'shrine');
  assert.eq(Render.houseTextureKey('turret', house, scene), 'tower');
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
  for (const role of ['plain', 'fort', 'trailer']) { // the turret keeps its own tower art
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

(function () {
test('footprint buildings: every house role and shop line has a distinct material profile', () => {
  const o = { kind: 'house', id: 'style-house', tier: 9 };
  const save = { restoredHouses: { [o.id]: 'plain' }, shopLines: {} };
  const scene = { save };
  for (const role of ['plain', 'blacksmith', 'trader', 'wizard', 'turret']) {
    save.restoredHouses[o.id] = role;
    const p = Render.buildingProfileFor(o, scene);
    assert.truthy(BuildingStyles.STYLES[p.style], role);
  }
  save.restoredHouses[o.id] = 'shop';
  for (const theme of ['seed', 'supply', 'potion', 'relic', 'pet', 'book']) {
    save.shopLines[o.id] = theme;
    assert.eq(Render.buildingProfileFor(o, scene), Render.BUILDING_STYLE_SHOPS[theme]);
  }
  delete save.restoredHouses[o.id];
  assert.eq(Render.buildingStyleFor(o, scene), 'ruin');
  assert.eq(Render.buildingStyleFor({ ...o, tier: 11 }, scene), 'multistorey');
});
test('footprint buildings: hide sprite only when retained geometry exists and preserve rollback', () => {
  const prev = Render.buildingArtStyle;
  const o = { kind: 'house', id: 'footprint', area: 100, footDx: 0.5, footDy: -0.25 };
  const scene = { save: {}, cellM: 7, textures: { exists: () => true, get: () => ({ get: () => ({ width: 64, height: 64 }) }) } };
  const appearance = () => Render.objectAppearance(scene, new Map([[o, 'plain']])).resolveAppearance(o);
  try {
    Render.buildingArtStyle = 'procedural';
    assert.truthy(appearance().visible, 'no model keeps sprite fallback');
    scene._proceduralBuildings = new Map([[o.id, { height: 25 }]]);
    assert.eq(appearance().visible, false, 'model replaces sprite');
    const anchor = Render.objectGroundAnchor(appearance(), scene.textures, { x: 100, y: 100 });
    assert.eq(anchor.x, 100 + CELL_PX * 0.5);
    assert.eq(anchor.y, 100 - CELL_PX * 0.25);
    Render.buildingArtStyle = 'legacy';
    assert.truthy(appearance().visible, 'old art remains available');
    Render.buildingArtStyle = 'procedural';
    scene.depth = 1;
    assert.truthy(appearance().visible, 'surface model cannot hide underground art');
  } finally { Render.buildingArtStyle = prev; }
});
})();
