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
  assert.truthy(/const row = Houses\.restoreAs\(this\.save, house, key, \{ hammer \}\);/.test(src), 'the ledger is written by restoreAs');
  assert.truthy(src.indexOf('Houses.restoreAs(') < src.indexOf('Inventory.remove('), 'a refused pick is never charged');
  assert.falsy(/shopType|preseed|PRESEED/.test(src), 'no address digit, no fixed run');
  assert.falsy(/preseedRestoreRole|PRESEED_RESTORE_ROLES/.test(SCENE_SRC), 'the fixed run is gone from the scene');
  assert.eq(Houses.PRESEED_RESTORE_ROLES, undefined);
  assert.truthy(/row\.role === 'market' \? \(row\.theme \|\| theme\) : null/.test(src), 'a Shop card is named for its own line');
  assert.truthy(/art: row\.art/.test(src), 'the Restored! card opens on the row\'s painting');
  // A REGULAR dialog on the Build painting, each card with its picture and
  // its own price (Houses.buildCost), charged for the card picked (Oct 2026).
  assert.falsy(/fullscreen: true/.test(src), 'no longer fullscreen');
  assert.truthy(/const costFor = \(row\) => Houses\.buildCost\(this\.save, house, row, order\);/.test(src), 'each card is priced by Houses.buildCost');
  assert.truthy(/cost: costLine\(c\),\n\s+canAfford: affords\(c\),/.test(src), 'a card carries its own cost line');
  assert.truthy(/iconHTML: iconFor\(row\),/.test(src) && /this\.worldIconHTML\(texKey, 36, frame\)/.test(src), 'a card shows the building it raises');
  assert.truthy(/const picked = options\.find\(\(r\) => r\.key === key\);\n\s+const cost = picked \? costFor\(picked\) : null;/.test(src), 'the charge is the picked card\'s');
  // The picture is baked from the texture's own frame on demand.
  assert.truthy(/_worldIconUrl\(texKey, frame = 0\) \{[\s\S]{0,900}?drawImage\(src, fr\.cutX, fr\.cutY, fr\.width, fr\.height/.test(SCENE_SRC), 'a world icon is cut from the frame\'s rect');
});

test('build choice: type, tier price, back and final payment are separate steps', () => {
  const start = SCENE_SRC.indexOf('  presentWreckRestoreModal(sx, sy, house) {');
  const body = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start) + 4).trim();
  const stock = { rubble: 100, magic_hammer: 1 };
  const inventory = {
    count: (save, id) => stock[id] || 0,
    remove: (save, id, qty) => { stock[id] -= qty; },
  };
  const present = new Function('Houses', 'Shops', 'Inventory', 'ITEM_BY_ID', 'Render',
    'CastleStyles', 'tierBadgeHTML', 'persistSave',
    `return ({${body}}).presentWreckRestoreModal;`)(Houses, Shops, inventory, ITEM_BY_ID,
      { houseTextureKey: () => 'house' }, { get: () => ({ towerFrame: 0 }) },
      (tier) => `quality-${tier}`, () => {});
  let modal;
  const scene = {
    save: { restoredHouses: { first: 'plain' } },
    showOfferModal: (offer) => { modal = offer; },
    iconSpanHTML: () => '', worldIconHTML: () => '', flash() {},
    _clampSelSlot() {}, _houseBlastGeometry: () => ({ x: 0, y: 0 }),
    _blastAt() {}, buildInventoryDOM() {}, questEvent() {}, _afterWreckGather() {},
  };
  const house = { kind: 'house', tier: 9, id: 'new' };
  present.call(scene, 0, 0, house);
  assert.eq(modal.acceptLabel, 'Next');
  assert.truthy(modal.choices.every((c) => c.cost == null && !c.label.includes('quality-')));
  assert.eq(modal.secondary, undefined, 'hammer is only offered at confirmation');
  modal.onAccept('blacksmith');
  assert.eq(scene.save.restoredHouses.new, undefined, 'Next does not restore');
  assert.eq(stock.rubble, 100, 'Next does not charge');
  assert.eq(modal.acceptLabel, 'Restore');
  const smith = Houses.buildOptions(scene.save, house).find((r) => r.key === 'blacksmith');
  const cost = Houses.buildCost(scene.save, house, smith);
  assert.truthy(modal.choices[0].label.includes('quality-1'));
  assert.truthy(modal.choices[0].cost.startsWith(`${cost.qty}×`));
  assert.truthy(modal.secondary.takes('blacksmith'));
  modal.onCancel();
  assert.eq(modal.choice, 'blacksmith', 'Back retains the building pick');
  modal.onAccept('plain');
  assert.falsy(modal.secondary.takes('plain'));
  modal.onCancel();
  stock.rubble = 0;
  modal.onAccept('blacksmith');
  assert.falsy(modal.choices[0].canAfford, 'unaffordable rank still displays its price');
  modal.onAccept('blacksmith');
  assert.eq(scene.save.restoredHouses.new, undefined, 'unaffordable confirmation never restores');
  stock.rubble = 100;
  modal.onCancel();
  modal.onAccept('blacksmith');
  modal.onAccept('blacksmith');
  assert.eq(scene.save.restoredHouses.new, 'blacksmith');
  assert.eq(stock.rubble, 100 - cost.qty, 'only the confirmed price is charged');
  assert.eq(stock.magic_hammer, 1, 'normal Restore keeps the hammer');
});

test('build choice: the offer modal has a choice row that pays only the selected card', () => {
  const sig = /showOfferModal\(\{[^)]*choices, choice = null, pickHint = 'Tap one to see what it does' \}\)/;
  assert.truthy(sig.test(MODAL_SHELL_SRC), 'choices / choice / pickHint are parameters');
  assert.truthy(/onAccept\(quantity \? qty : hasChoices \? selected\.key : undefined\);/.test(MODAL_SHELL_SRC), 'accept hands over the key');
  assert.truthy(/if \(hasChoices && !selected\) return;/.test(MODAL_SHELL_SRC), 'nothing is paid before a pick');
  assert.truthy(/selected = choices\.length === 1 \? choices\[0\]/.test(MODAL_SHELL_SRC), 'a single card is selected on its own');
  // A card's own price lands on the cost line when it is selected, and arms accept.
  assert.truthy(/const applyChoiceCost = \(\) => \{\n\s+if \(!selected \|\| selected\.cost == null\) return;\n\s+liveCanAfford = selected\.canAfford !== false;/.test(MODAL_SHELL_SRC), 'the selected card\'s cost and affordability');
  assert.truthy(/applyChoiceCost\(\);\n\s+syncAccept\(\);/.test(MODAL_SHELL_SRC), 'applied on every pick, before accept is armed');
  assert.truthy(/\(hasChoices && choices\.some\(\(c\) => c\.cost != null\)\)/.test(MODAL_SHELL_SRC), 'a cost line exists when any card prices itself');
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
  assert.truthy(/list\.push\(\{ id: o\.id, x: o\.x, y: o\.y, castle: o\.id, shiny: Houses\.isShinyHouse\(this\.save, o\) \}\);/.test(body), 'with their own id as the style key the arrow reads, and the hammer\'s shine');
  assert.truthy(/if \(shopType === 'turret'\) \{/.test(SCENE_SRC), 'a tap trades nothing');
  assert.eq(Houses.displayRole({ restoredHouses: { h: 'turret' } }, { kind: 'house', tier: 9, id: 'h' }), 'turret');
});
})();
