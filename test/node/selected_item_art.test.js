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

test('dialog item art: large icons use detailed frames and preserve variant identity', () => {
  const start = SCENE_SRC.indexOf('\n  renderItemIcon('), end = SCENE_SRC.indexOf('\n  }\n', start);
  const art = { cell: 96, columns: 8, size: 768, entries: {} };
  const ids = ['plain', 'badged', 'shiny', 'variant', 'filtered'];
  for (const id of ids) art.entries[id] = { sheet: 'dialog-test.png', frame: 10 };
  const items = Object.fromEntries([...ids, 'missing', 'badge'].map(id => [id, { id }]));
  items.shiny.shiny = true;
  items.variant.base = 'plain';
  const sources = id => ({ sheet: 'small', frame: 0, ...(id === 'filtered' ? { filter: 'sepia(1)' } : {}) });
  const bakes = { ITEM_DATA_URLS: { plain: 'baked-plain', badged: 'baked-badge' } };
  const render = new Function('document', 'window', 'ITEM_BY_ID', 'inventoryIconSource', 'iconBadgeItem',
    'DialogItemArt', 'ICON_SHEETS', 'IconNet', 'domIconSheet',
    'return ({' + SCENE_SRC.slice(start, end + 4) + '}).renderItemIcon;')(
    { createElement: () => ({ style: {}, dataset: {} }) }, bakes, items, sources,
    id => id === 'badged' ? 'badge' : null, art,
    { small: { url: 'small.png', cols: 1, srcW: 16, srcH: 16 } },
    { ready: () => false }, (url, width, height) => ({ url, width, height, x: 0, y: 0 }));
  const scene = { renderItemIcon: render };
  const draw = (...args) => render.call(scene, ...args);
  assert.truthy(draw('plain', 47).includes('baked-plain'), 'small icons preserve their bake');
  for (const size of [48, 96]) {
    const html = draw('plain', size);
    assert.truthy(html.includes('dialog-test.png'), 'large icons use detailed art before old bakes');
    assert.truthy(html.includes(`background-size:${8 * size}px ${8 * size}px`));
    assert.truthy(html.includes(`background-position:-${2 * size}px -${size}px`));
    assert.truthy(html.includes('icon-loading'), 'cold sheet keeps its loading footprint');
    const el = draw('plain', size, 'block');
    assert.eq(el.dataset.iconsrc, 'dialog-test.png');
    assert.truthy(el.style.cssText.includes('dialog-test.png'));
  }
  for (const id of ['badged', 'shiny', 'variant', 'filtered']) {
    assert.truthy(draw(id, 96).includes('dialog-test.png'), `${id}: use detailed variant art`);
  }
  assert.falsy(draw('missing', 96).includes('dialog-test.png'), 'unknown detail retains fallback');
  assert.truthy(draw('badged', 96).includes('position:absolute'), 'badge is preserved on large icon');
  assert.truthy(draw('badged', 96, 'block').innerHTML.includes('small.png'), 'DOM badge keeps its source');
  assert.truthy(draw('shiny', 96).includes('saturate(3.2)'), 'shiny variant keeps gold tint');
  assert.truthy(draw('filtered', 96).includes('filter:sepia(1)'), 'fallback retains palette treatment');
});
