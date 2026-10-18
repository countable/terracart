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

test('furniture icons: every roster item uses its world frame on the shared DOM sheet', () => {
  const items = ITEMS.filter(item => item.kind === 'furniture');
  assert.eq(items.length, 16);
  const row = SCENE_SRC.match(/furniture_icons:\s*\{ url: '([^']+)', cols: (\d+), srcW: (\d+), srcH: (\d+) \}/);
  assert.truthy(row, 'registered DOM sheet');
  const dims = pngDims(row[1]);
  assert.eq(dims.w, Number(row[3]));
  assert.eq(dims.h, Number(row[4]));
  assert.eq(Number(row[2]), dims.w / 16);
  for (const [frame, item] of items.entries()) {
    const metadata = furnitureSpec(item.id);
    assert.eq(metadata.frame, frame, item.id + ': roster frame');
    assert.eq(inventoryIconSource(item.id).sheet, 'furniture_icons');
    assert.eq(inventoryIconSource(item.id).frame, frame);
    assert.eq(PRICES[item.id], Math.round(TIER_VALUE[item.baseTier] * 1.5));
    assert.truthy(ITEM_EFFECTS[item.id]);
    assert.eq(metadata.luxury, null, 'default future luxury uses tier squared');
    assert.eq(metadata.tierSheetFrame, null, 'tier art awaits authored frames');
  }
  assert.eq(ITEM_BY_ID.washtub.name, 'Washing Tub');
  assert.eq(ITEM_BY_ID.washtub.baseTier, 1);
  assert.eq(furnitureSpec('washtub').ability, 'wash');
  assert.eq(furnitureSpec('wood'), null);
  assert.eq(furnitureSpec({ kind: 'furniture', itemId: 'workbench', id: 'placed_1' }), furnitureSpec('workbench'));
});

test('furniture art: a tier frame override agrees across world and inventory surfaces', () => {
  const metadata = furnitureSpec('bed_quilted');
  const scene = { textures: { exists: () => true }, save: {} };
  Render.objectAppearance(scene, new Map());
  const placed = { kind: 'furniture', itemId: 'bed_quilted' };
  try {
    metadata.tierSheetFrame = { 1: 4 };
    assert.eq(inventoryIconSource('bed_quilted').frame, 4);
    assert.eq(Render.resolveObjectAppearance(scene, placed).frameVal, 4);
    metadata.tierSheetFrame = { 2: 4 };
    assert.eq(inventoryIconSource('bed_quilted').frame, metadata.frame, 'missing tier falls back');
    assert.eq(Render.resolveObjectAppearance(scene, placed).frameVal, metadata.frame);
  } finally {
    metadata.tierSheetFrame = null;
  }
});
