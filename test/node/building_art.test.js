// Dialogs and sprite fallbacks retain the original role artwork.
(function () {
test('building art: original textures in procedural and legacy modes', () => {
  const previous = Render.buildingArtStyle;
  const house = { kind: 'house', id: 'h' }, scene = { isClaimedKey: () => true };
  try {
    for (const style of ['procedural', 'legacy']) {
      Render.buildingArtStyle = style;
      assert.eq(Render.houseTextureKey('plain', house, scene), 'house');
      assert.eq(Render.houseTextureFrame('plain', house, scene), 'front');
      for (const role of ['wreck', 'blacksmith', 'trader', 'shop', 'fort'])
        assert.eq(Render.houseTextureKey(role, house, scene), `house_${role}`);
      // Home has no sprite: the overlay draws the player's house from its footprint.
      assert.eq(Render.houseTextureKey('trailer', house, scene), null);
      assert.eq(Render.houseTextureKey('wizard', house, scene), 'shrine');
      assert.eq(Render.houseTextureKey('turret', house, scene), 'tower');
    }
  } finally { Render.buildingArtStyle = previous; }
});
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
