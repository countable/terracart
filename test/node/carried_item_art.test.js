// Every new carried treasure must resolve the same real art in inventory,
// shops and DOM pickup toasts, and remain reachable through ordinary loot.
test('carried treasures: catalog icons point at their shipped single-frame art', () => {
  for (const id of ['field_scope', 'orb', 'goblet', 'lucky_key', 'wood_shield', 'metal_shield', 'gold_shield']) {
    const item = ITEM_BY_ID[id];
    assert.truthy(item, `${id}: catalog entry`);
    assert.truthy(PRICES[id] > 0, `${id}: has a price`);
    assert.falsy(item.caveOnly, `${id}: enters ordinary loot pools`);
    const src = inventoryIconSource(id);
    assert.eq(src.frame, 0, `${id}: single icon frame`);
    const row = SCENE_SRC.match(new RegExp(`\\n  ${src.sheet}:\\s*\\{ url: '([^']+)',\\s*cols: (\\d+),\\s*srcW: (\\d+),\\s*srcH: (\\d+) \\}`));
    assert.truthy(row, `${id}: matching DOM icon sheet`);
    const dims = pngDims(row[1]);
    assert.truthy(dims, `${id}: PNG shipped`);
    assert.eq(dims.w, 16, `${id}: frame width`);
    assert.eq(dims.h, 16, `${id}: frame height`);
    assert.eq(Number(row[2]), 1, `${id}: one column`);
    assert.eq(Number(row[3]), dims.w, `${id}: declared width`);
    assert.eq(Number(row[4]), dims.h, `${id}: declared height`);
  }
});
