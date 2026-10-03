// What a wreck is restored AS is the player's pick (houses.js BUILD_OPTIONS,
// app.js presentWreckRestoreModal). The ladder and the ledger writer are
// pinned in houses.test.js; this file pins the scene and the turret lanes.

(function () {
test('build choice: the restore modal offers the table and freezes the pick, never the address', () => {
  const start = SCENE_SRC.indexOf('  presentWreckRestoreModal(sx, sy, house) {');
  assert.truthy(start > 0, 'the modal exists');
  const src = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(/const options = Houses\.buildOptions\(this\.save, house\);/.test(src), 'the cards are the table');
  assert.truthy(/choices,/.test(src) && /onAccept: \(key\) =>/.test(src), 'the pick rides the offer modal\'s choice row');
  assert.truthy(/const row = Houses\.restoreAs\(this\.save, house, key\);/.test(src), 'the ledger is written by restoreAs');
  assert.truthy(src.indexOf('Houses.restoreAs(') < src.indexOf('Inventory.remove('), 'a refused pick is never charged');
  assert.falsy(/shopType|preseed|PRESEED/.test(src), 'no address digit, no fixed run');
  assert.falsy(/preseedRestoreRole|PRESEED_RESTORE_ROLES/.test(SCENE_SRC), 'the fixed run is gone from the scene');
  assert.eq(Houses.PRESEED_RESTORE_ROLES, undefined);
  assert.truthy(/Shops\.nextLine\(this\.save\)/.test(src), 'the Shop card promises the next line');
  assert.truthy(/art: row\.art/.test(src), 'the Restored! card opens on the row\'s painting');
});

test('build choice: the offer modal has a choice row that pays only the selected card', () => {
  const sig = /showOfferModal\(\{[^)]*choices, choice = null, pickHint = 'Tap one to see what it does' \}\)/;
  assert.truthy(sig.test(MODAL_SHELL_SRC), 'choices / choice / pickHint are parameters');
  assert.truthy(/onAccept\(quantity \? qty : hasChoices \? selected\.key : undefined\);/.test(MODAL_SHELL_SRC), 'accept hands over the key');
  assert.truthy(/if \(hasChoices && !selected\) return;/.test(MODAL_SHELL_SRC), 'nothing is paid before a pick');
  assert.truthy(/selected = choices\.length === 1 \? choices\[0\]/.test(MODAL_SHELL_SRC), 'a single card is selected on its own');
});

test('build choice: the scarecrow shop is gone, and nothing pins a house by position', () => {
  for (const [name, src] of [['app.js', SCENE_SRC], ['render.js', RENDER_SRC]]) {
    assert.falsy(/scarecrowShop|ScarecrowShop/.test(src), `${name}: no forced scarecrow shop`);
  }
  assert.falsy(/findStarterBlacksmithId/.test(SCENE_SRC), 'the smithy is the first one picked, not the nearest house');
  assert.truthy(Shops.THEME_POOL.supply().includes('scarecrow'), 'the Supply Shop still sells one');
  assert.truthy(HOME_RECIPES.some((r) => r.id === 'scarecrow'), 'and Home still crafts one');
});

test('turret: a restored turret wears the castle tower and fires on the castle lane', () => {
  assert.eq(Render.houseTextureKey('turret', { id: 'h' }, {}), 'tower');
  assert.eq(BUILDING_ART.turret.def, 1, 'drawn one cell wide, the castle rim\'s own size');
  assert.truthy(/if \(role === 'turret'\) return CastleStyles\.get\(o\.id\)\.towerFrame;/.test(RENDER_SRC), 'its material family is its own id');
  assert.truthy(/_houseRole\(o\) === 'wizard' \|\| _houseRole\(o\) === 'turret' \? \[0\.5, 1\.0\]/.test(RENDER_SRC), 'foot-seated like the tower row');
  assert.truthy(/if \(o\.kind === 'tower' \|\| role === 'turret'\) \{ w = CELL_PX \* 1\.1; footY = sy \+ 2; \}/.test(RENDER_SRC), 'and shadowed like it');
  const fire = SCENE_SRC.slice(SCENE_SRC.indexOf('  _turretFire(now, px, py, halfSpanM, enemies, pc) {'));
  const body = fire.slice(0, fire.indexOf('\n  }\n'));
  assert.truthy(/this\._forEachHouseNear\(pc, \(o\) => \{\s*if \(Houses\.displayRole\(this\.save, o\) !== 'turret'\) return;/.test(body), 'turret houses join the scan');
  assert.truthy(/list\.push\(\{ id: o\.id, x: o\.x, y: o\.y, castle: o\.id \}\);/.test(body), 'with their own id as the style key the arrow reads');
  assert.truthy(/if \(shopType === 'turret'\) \{/.test(SCENE_SRC), 'a tap trades nothing');
  assert.eq(Houses.displayRole({ restoredHouses: { h: 'turret' } }, { kind: 'house', tier: 9, id: 'h' }), 'turret');
});
})();
