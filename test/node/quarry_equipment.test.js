// Salvage is a one-time item pickup using chest interaction, with its own art.
test('quarry equipment: one-cell art, no chest gem, and the same hero image', () => {
  const equipment = {kind: 'chest', id: 'salvage', quarryEquipment: true,
    fixedLoot: {kind: 'item', id: 'iron_bar', qty: 1}};
  const look = chestLook(equipment);
  assert.truthy(look.equipment); assert.eq(look.texKey, 'quarry_equipment');
  assert.falsy(restocks(equipment));
  const appearance = Render.objectAppearance({textures:{exists:()=>true},save:{}}, new Map());
  const rendered = appearance.resolveAppearance(equipment);
  assert.eq(rendered.texKey, look.texKey); assert.eq(rendered.scl, .8);
  assert.truthy(rendered.visible); assert.truthy(appearance.RENDER_SPEC.chest.seat(equipment));
  const bounds = SpriteLayout.ART_BOUNDS['quarry_equipment:0'];
  assert.lte((bounds.maxX - bounds.minX) * rendered.scl, SpriteLayout.CELL_PX);
  assert.truthy(Number.isFinite(rendered.dxPx) && Number.isFinite(rendered.dyPx));
  // Exercise the shipping gem-filter predicate with ordinary treasure as a control.
  const filter = RENDER_SRC.match(/const chestObjs = filteredObj\.filter\(([\s\S]*?\})\);/)[1];
  const showGem = new Function('return (' + filter + ');')();
  assert.falsy(showGem({o: equipment}));
  assert.truthy(showGem({o: {kind: 'chest', id: 'ordinary'}}));
  assert.truthy(SCENE_SRC.includes("WORLD_ICON_URLS.quarry_equipment = bakeSheetFrame('quarry_equipment', 0, 32, 16)"),
    'the reward dialog bakes the full image, not a 16px crop or chest fallback');
});
