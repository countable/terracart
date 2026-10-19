// Evaluate the shipped DOM sheet table, including computed shared atlas metadata.
// This catches fallback-to-crops errors rather than merely checking the selection map.
function selectedIconSheetsForTest() {
  const table = SCENE_SRC.match(/const ICON_SHEETS = (\{[\s\S]*?\n\});/);
  assert.truthy(table, 'the DOM icon table exists');
  return new Function('SelectedItemArt', 'SelectedWorldAtlas', 'return (' + table[1] + ');')(SelectedItemArt, SelectedWorldAtlas);
}

test('selected item art: every chosen icon resolves to a registered, correctly sized native sheet', () => {
  const sheets = selectedIconSheetsForTest();
  for (const [id, expected] of Object.entries(SelectedItemArt.icons)) {
    assert.truthy(ITEM_BY_ID[id], `${id} is a real item`);
    const source = inventoryIconSource(id);
    assert.eq(source.sheet, expected.sheet, `${id}: shared resolver uses selected sheet`);
    assert.eq(source.frame, expected.frame, `${id}: shared resolver uses selected frame`);
    const sheet = sheets[source.sheet];
    assert.truthy(sheet, `${id}: no silent fallback to crops`);
    const dims = pngDims(sheet.url);
    assert.truthy(dims, `${id}: local sheet exists`);
    assert.eq(sheet.srcW, dims.w, `${id}: declared width matches PNG`);
    assert.eq(sheet.srcH, dims.h, `${id}: declared height matches PNG`);
    assert.eq(dims.w / sheet.cols, 16, `${id}: native 16px frame`);
    assert.truthy(Number.isInteger(source.frame) && source.frame >= 0 &&
      source.frame < sheet.cols * dims.h / 16, `${id}: frame inside sheet`);
  }
});

test('selected item art: both approved flask choices survive packing and defaults are stable', () => {
  for (const [id, ids] of Object.entries({
    explosive_flask: ['ALT-0758', 'ALT-0276'],
    poison_flask: ['ALT-0609', 'ALT-0284'],
  })) {
    const choices = SelectedItemArt.alternatives[id];
    assert.eq(choices.map(c => c.alternativeId).join(','), ids.join(','));
    assert.eq(inventoryIconSource(id).frame, choices[0].frame, `${id}: first choice is default`);
    assert.falsy(choices[0].frame === choices[1].frame, `${id}: both crops remain available`);
  }
  assert.eq(inventoryIconSource('resurrection_potion').frame,
    inventoryIconSource('taming_potion').frame, 'same approved ALT-0603 occupies one frame');
});
