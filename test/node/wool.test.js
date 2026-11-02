test('wool: sheep output is stackable, sellable and never food or random loot', () => {
  const item = ITEM_BY_ID.wool;
  assert.eq(item.name, 'Wool');
  assert.eq(item.kind, 'supply');
  assert.eq(item.baseTier, 2);
  assert.eq(itemValue('wool'), 18);
  assert.gt(trailerSellPrice(itemValue('wool')), 0);
  assert.falsy(Object.prototype.hasOwnProperty.call(FOOD_ENERGY, 'wool'));
  assert.eq(item.dropWeight, 0, 'excluded from ordinary weighted drops');
  const save = { inv: [], relics: {} };
  assert.eq(Inventory.add(save, 'wool', 2).accepted, 2);
  assert.eq(Inventory.add(save, 'wool', 1).isNewStack, false);
  assert.eq(Inventory.count(save, 'wool'), 3);
});

test('wool: dropped stacks and inventory share the registered atlas icon', () => {
  const icon = inventoryIconSource('wool');
  assert.eq(icon.sheet, 'selected_items');
  assert.eq(icon.frame, SelectedItemArt.icons.wool.frame);
  assert.eq(groundStackArt('wool').sheet, icon.sheet);
  assert.eq(groundStackArt('wool').frame, icon.frame);
  const dims = pngDims(SelectedItemArt.url);
  assert.eq(dims.w, SelectedItemArt.width);
  assert.eq(dims.h, SelectedItemArt.height);
  assert.lt(icon.frame, SelectedItemArt.cols * SelectedItemArt.height / 16);
});
