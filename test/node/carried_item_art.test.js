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
    assert.eq(inventoryIconSource(item.id).frame, furnitureFrame(item.id));
    assert.eq(PRICES[item.id], Math.round(TIER_VALUE[item.baseTier] * 1.5));
    assert.truthy(ITEM_EFFECTS[item.id]);
    assert.eq(metadata.luxury, null, 'default future luxury uses tier squared');
  }
  assert.eq(ITEM_BY_ID.washtub.name, 'Washing Tub');
  assert.eq(ITEM_BY_ID.washtub.baseTier, 1);
  assert.eq(furnitureSpec('washtub').ability, 'wash');
  for (const [id, name, tier] of [
    ['lamp_floor', 'Floor Lamp', 3],
    ['clock_grandfather', 'Grandfather Clock', 3],
    ['candelabra_floor', 'Floor Candelabra', 1],
    ['statue_pedestal', 'Pedestal Owl', 2],
  ]) {
    assert.eq(ITEM_BY_ID[id].name, name);
    assert.eq(ITEM_BY_ID[id].baseTier, tier);
  }
  for (const id of ['lantern_brass', 'candlestick_brass', 'clock_mantel', 'statue_owl']) {
    assert.falsy(ITEM_BY_ID[id], id + ': retired tabletop art is absent');
    assert.falsy(furnitureSpec(id));
    assert.falsy(PRICES[id]);
    assert.falsy(ITEM_EFFECTS[id]);
  }
  assert.truthy(furnitureSpec('lamp_floor').light);
  assert.truthy(furnitureSpec('candelabra_floor').light);
  assert.eq(furnitureSpec('wood'), null);
  assert.eq(furnitureSpec({ kind: 'furniture', itemId: 'workbench', id: 'placed_1' }), furnitureSpec('workbench'));
});

test('furniture art: a tier frame override agrees across world and inventory surfaces', () => {
  const metadata = furnitureSpec('bed_quilted');
  const originalTierFrames = metadata.tierSheetFrame;
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
    metadata.tierSheetFrame = originalTierFrames;
  }
});


test('furniture art: approved atlas tiers map to complete world and inventory frames', () => {
  const rows = {
    bed_quilted: 0, washtub: 1, table_oak: 2, dresser_oak: 3,
    bookshelf_frontier: 4, mirror_brass: 5, planter_clay: 6,
    planter_copper: 6, rug_burgundy: 7, lamp_floor: 8,
    clock_grandfather: 9, statue_pedestal: 10, globe_brass: 11,
    telescope_brass: 12,
  };
  const world = pngDims('assets/Objects/Furniture/furniture-32.png');
  const icons = pngDims('assets/Objects/Furniture/furniture-icons-16.png');
  const worldColumns = world.w / 32, iconColumns = icons.w / 16;
  assert.eq(worldColumns, iconColumns, 'world and inventory use matching frame order');
  assert.eq(world.h / 64, icons.h / 16, 'world and inventory contain the same rows');
  const scene = { textures: { exists: () => true }, save: {} };
  Render.objectAppearance(scene, new Map());
  for (const [id, row] of Object.entries(rows)) {
    const metadata = furnitureSpec(id);
    for (let tier = 1; tier <= 7; tier++) {
      const frame = metadata.tierSheetFrame[tier];
      assert.eq(frame, 16 + row * 7 + tier - 1, `${id} T${tier}: approved atlas cell`);
      assert.lt(frame, iconColumns * icons.h / 16, `${id} T${tier}: icon exists`);
      const bounds = SpriteLayout.ART_BOUNDS[`furniture:${frame}`];
      assert.truthy(bounds, `${id} T${tier}: world seating bounds exist`);
      assert.eq(bounds.fw, 32);
      assert.eq(bounds.fh, 64);
      const tall = id === 'bed_quilted' || id === 'bookshelf_frontier';
      assert.gte(bounds.minY, id === 'lamp_floor' ? 0 : tall ? 21 : 32, `${id} T${tier}: art fits its native height`);
      if (tall) assert.lt(bounds.minY, 32, `${id} T${tier}: tall art retains its height`);
      assert.gt(bounds.maxX, bounds.minX, `${id} T${tier}: non-empty width`);
      assert.gt(bounds.maxY, bounds.minY, `${id} T${tier}: non-empty height`);
      assert.lte(bounds.maxX, 32);
      assert.lte(bounds.maxY, 64);
    }
    const selected = 16 + row * 7 + ITEM_BY_ID[id].baseTier - 1;
    assert.eq(furnitureFrame(id), selected, `${id}: catalog tier selects approved art`);
    assert.eq(inventoryIconSource(id).frame, selected, `${id}: inventory matches world`);
    assert.eq(Render.resolveObjectAppearance(scene, { kind: 'furniture', itemId: id }).frameVal,
      selected, `${id}: placed furniture matches inventory`);
  }
  for (const id of ['workbench', 'candelabra_floor']) {
    assert.eq(furnitureSpec(id).tierSheetFrame, null, `${id}: original art retained`);
    assert.eq(furnitureFrame(id), furnitureSpec(id).frame);
  }
});
