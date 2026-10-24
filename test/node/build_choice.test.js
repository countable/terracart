// What a wreck is restored AS is the player's pick (houses.js BUILD_OPTIONS,
// app.js presentWreckRestoreModal). The ladder and the ledger writer are
// pinned in houses.test.js; this file pins the scene and the turret lanes.

(function () {
test('build choice: the restore modal offers the table and freezes the pick, never the address', () => {
  const start = SCENE_SRC.indexOf('  presentWreckRestoreModal(sx, sy, house) {');
  assert.truthy(start > 0, 'the modal exists');
  const src = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(/const types = Houses\.buildTypes\(this\.save, house\);/.test(src), 'the type cards are the catalogue grouped by type');
  assert.truthy(/choices: /.test(src) && /onAccept: \(key\) =>/.test(src), 'the pick rides the offer modal\'s choice row');
  assert.truthy(/const row = Houses\.restoreAs\(this\.save, house, key, \{ hammer \}\);/.test(src), 'the ledger is written by restoreAs');
  assert.truthy(src.indexOf('Houses.restoreAs(') < src.indexOf('Inventory.remove('), 'a refused pick is never charged');
  assert.falsy(/shopType|preseed|PRESEED/.test(src), 'no address digit, no fixed run');
  assert.falsy(/preseedRestoreRole|PRESEED_RESTORE_ROLES/.test(SCENE_SRC), 'the fixed run is gone from the scene');
  assert.eq(Houses.PRESEED_RESTORE_ROLES, undefined);
  assert.truthy(/row\.role === 'shop' \? \(row\.theme \|\| theme\) : null/.test(src), 'a Shop card is named for its own line');
  assert.truthy(/art: row\.art/.test(src), 'the Restored! card opens on the row\'s painting');
  // A REGULAR dialog on the Build painting, each card with its picture and
  // its own price (Houses.buildCost), charged for the card picked (Oct 2026).
  assert.falsy(/fullscreen: true/.test(src), 'no longer fullscreen');
  assert.truthy(/const costFor = \(row\) => Houses\.buildCost\(this\.save, house, row, order\);/.test(src), 'each card is priced by Houses.buildCost');
  assert.truthy(/cost: costLine\(c\),\n\s+canAfford: affords\(c\),/.test(src), 'a card carries its own cost line');
  assert.truthy(/iconHTML: iconFor\(row\),/.test(src) && /this\.worldIconHTML\(texKey, 30, frame\)/.test(src), 'a card shows the building it raises');
  assert.truthy(/const picked = options\.find\(\(r\) => r\.key === key\);\n\s+const cost = picked \? costFor\(picked\) : null;/.test(src), 'the charge is the picked card\'s');
  // The picture is baked from the texture's own frame on demand.
  assert.truthy(/_worldIconUrl\(texKey, frame = 0\) \{[\s\S]{0,900}?drawImage\(src, fr\.cutX, fr\.cutY, fr\.width, fr\.height/.test(SCENE_SRC), 'a world icon is cut from the frame\'s rect');
});

test('build choice: the type first, then the rank where more than one is open, each card with its own price', () => {
  const start = SCENE_SRC.indexOf('  presentWreckRestoreModal(sx, sy, house) {');
  const body = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start) + 4).trim();
  assert.truthy(/title: 'Building type'/.test(body) && /title: 'Rank'/.test(body), 'a type screen, then a rank screen');
  const stock = { rubble: 100, wood: 100, magic_hammer: 1 };
  const inventory = {
    count: (save, id) => stock[id] || 0,
    remove: (save, id, qty) => { stock[id] -= qty; },
  };
  const present = new Function('Houses', 'Shops', 'Inventory', 'ITEM_BY_ID', 'Render',
    'CastleStyles', 'tierBadgeHTML', 'persistSave', 'newBadgeHTML', 'UI_GREEN',
    `return ({${body}}).presentWreckRestoreModal;`)(Houses, Shops, inventory, ITEM_BY_ID,
      { houseTextureKey: () => 'house', houseTextureFrame: () => 'front' }, { get: () => ({ towerFrame: 0 }) },
      (tier) => `quality-${tier}`, () => {}, () => 'NEW', '#7c9');
  let modal;
  const scene = {
    save: { restoredHouses: { first: 'plain' } },
    showOfferModal: (offer) => { modal = offer; },
    iconSpanHTML: () => '', worldIconHTML: () => '', flash() {},
    _clampSelSlot() {}, _houseBlastGeometry: () => ({ x: 0, y: 0 }),
    _blastAt() {}, buildInventoryDOM() {}, questEvent() {}, _afterWreckGather(fn) { fn(); }, flashLoot() {},
  };
  const house = { kind: 'house', tier: 9, id: 'new' };
  present.call(scene, 0, 0, house);
  assert.eq(modal.title, 'Building type');
  assert.eq(modal.acceptLabel, 'Restore');
  assert.eq(modal.cancelLabel, 'Later');
  // STEP ONE lists TYPES, one card each, in table order: the House, then the smithy.
  assert.eq(modal.choices.map(c => c.key).join(), 'plain,blacksmith', 'one card per type');
  const smithCard = modal.choices.find(c => c.key === 'blacksmith');
  const smith = Houses.buildOptions(scene.save, house).find(r => r.key === 'blacksmith:1');
  const cost = Houses.buildCost(scene.save, house, smith);
  assert.truthy(smithCard.label.includes(`${cost.qty}\u00d7`), 'its sole rank\'s price rides the card');
  assert.falsy(smithCard.label.includes('from '), 'a sole rank is a plain price, not "from"');
  assert.eq(smithCard.onSelect, undefined, 'a sole rank keeps the select-and-restore flow');
  assert.eq(smithCard.acceptLabel, 'Restore', 'a sole open rank restores straight off the type screen');
  assert.falsy(smithCard.label.includes('quality-'), 'no rank badge on a type card');
  assert.eq(smithCard.info, undefined, 'no blurb on the card: the cards and the Restore row fit without a scroll');
  assert.truthy(smithCard.suggested, 'the smithy card is suggested while the lane has none');
  assert.truthy(modal.secondary.takes('blacksmith'), 'a smithy card takes the hammer');
  assert.falsy(modal.secondary.takes('plain'), 'the House card refuses it');
  stock.rubble = 0; stock[cost.id] = 0;
  present.call(scene, 0, 0, house);
  assert.truthy(modal.choices.every(c => c.canAfford === false), 'empty inventory disaffords every card');
  stock.rubble = 100; stock[cost.id] = 100;
  const typeModal = modal;
  let completeWork;
  scene._afterWreckGather = fn => { completeWork = fn; };
  modal.onAccept('blacksmith');
  assert.eq(scene.save.restoredHouses.new, undefined, 'wreck stays intact during work');
  assert.eq(stock.wood, 100, 'materials are not charged during work');
  completeWork();
  scene._afterWreckGather = fn => fn();
  assert.eq(modal, typeModal, 'a sole rank: no rank screen, no confirmation screen');
  assert.eq(scene.save.restoredHouses.new, 'blacksmith');
  assert.eq(cost.id, 'wood', 'a T1 smithy is paid in the T1 ore (barForTier)');
  assert.eq(stock.wood, 100 - cost.qty, 'the picked rank is the one charged');
  assert.eq(stock.magic_hammer, 1, 'plain Restore keeps the hammer');
  scene.save = { restoredHouses: { first: 'plain' } };
  modal.secondary.onClick('blacksmith');
  assert.eq(scene.save.restoredHouses.new, 'blacksmith');
  assert.truthy(Houses.isShinyHouse(scene.save, house), 'hammer restore stamps shine');
  assert.eq(stock.magic_hammer, 0, 'hammer restore spends one hammer');
  // A second T1 smithy is just another pick: the type stays listed, now without NEW.
  scene.save = { restoredHouses: { first: 'plain', s: 'blacksmith' }, shopTiers: { s: 1 } };
  present.call(scene, 0, 0, house);
  const again = modal.choices.find(c => c.key === 'blacksmith');
  assert.truthy(again, 'the smithy type is still on the screen');
  assert.falsy(again.label.includes('NEW'), 'as a duplicate, without the pill');
  assert.falsy(again.suggested, 'and no longer suggested');
  modal.onAccept('blacksmith');
  assert.eq(scene.save.restoredHouses.new, 'blacksmith', 'a second wooden smithy stands');
  // STEP TWO — several ranks open: the type card says "Choose rank" and
  // omits the price; tapping opens the rank screen, a card per rank.
  scene.save = {
    restoredHouses: { s1: 'blacksmith', s2: 'blacksmith', s3: 'blacksmith',
      a: 'plain', b: 'plain', c: 'plain', d: 'plain', e: 'plain', f: 'plain', g: 'plain' },
    shopTiers: { s1: 1, s2: 2, s3: 3 },
    discovered: Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['m' + i, true])),
  };
  const smithRanks = Houses.buildOptions(scene.save, house).filter(r => r.role === 'blacksmith');
  assert.gt(smithRanks.length, 1, 'fixture opens multiple smith ranks');
  const smithCosts = smithRanks.map(r => Houses.buildCost(scene.save, house, r));
  const prices = smithCosts.map(c => c.qty);
  for (const c of smithCosts) stock[c.id] = Math.min(...prices);
  stock.magic_hammer = 1;
  present.call(scene, 0, 0, house);
  assert.eq(modal.choices.filter(c => c.key.startsWith('blacksmith')).length, 1, 'still ONE smithy card on the type screen');
  const typeCard = modal.choices.find(c => c.key === 'blacksmith');
  assert.eq(typeCard.acceptLabel, 'Choose rank');
  assert.falsy(typeCard.label.includes('×'), 'multi-rank types omit the price');
  assert.eq(typeCard.cost, '', 'the type has no price until a rank is chosen');
  assert.truthy(typeCard.canAfford, 'browsing ranks does not require materials');
  typeCard.onSelect();
  assert.eq(modal.title, 'Rank');
  assert.eq(modal.cancelLabel, 'Back');
  assert.eq(modal.choices.map(c => c.key).join(), smithRanks.map(r => r.key).join(), 'one card per open rank');
  assert.truthy(modal.choices.some(c => c.canAfford === false), 'a pricier rank is visibly unaffordable');
  for (const row of smithRanks) {
    const choice = modal.choices.find(c => c.key === row.key);
    assert.truthy(choice.label.includes('quality-' + row.tier), 'each rank wears its own badge');
    assert.truthy(choice.cost.startsWith(Houses.buildCost(scene.save, house, row).qty + '\u00d7'), 'each rank quotes its own price');
    assert.truthy(modal.secondary.takes(row.key), 'a rank card takes the hammer');
  }
  // Back returns to the type screen with the type still selected.
  modal.onCancel();
  assert.eq(modal.title, 'Building type');
  assert.eq(modal.choice, 'blacksmith', 'the smithy stays selected');
  // The Hammer on a multi-rank type carries on to the rank screen too.
  modal.secondary.onClick('blacksmith');
  assert.eq(modal.title, 'Rank', 'the hammer picks a rank first');
  assert.eq(scene.save.restoredHouses.new, undefined, 'nothing restored yet');
  const selected = smithRanks[smithRanks.length - 1];
  const selectedCost = Houses.buildCost(scene.save, house, selected);
  stock[selectedCost.id] = 100;
  present.call(scene, 0, 0, house);
  modal.onAccept('blacksmith');
  modal.onAccept(selected.key);
  assert.eq(scene.save.restoredHouses.new, 'blacksmith');
  assert.eq(scene.save.shopTiers.new, selected.tier);
  assert.eq(stock[selectedCost.id], 100 - selectedCost.qty, 'the picked rank is the one charged');
  assert.eq(stock.magic_hammer, 1, 'the hammer was not spent on the way through');
  // THE GUIDANCE OUTLINE FOLLOWS THE PICK ONTO THE RANK SCREEN: five memories
  // open two smith ranks for a lane with no smithy, and only the T1 card is
  // suggested there — the type card merely summed its ranks.
  scene.save = {
    restoredHouses: { first: 'plain' },
    discovered: Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['m' + i, true])),
  };
  present.call(scene, 0, 0, house);
  const guided = modal.choices.find(c => c.key === 'blacksmith');
  assert.eq(guided.acceptLabel, 'Choose rank', 'two ranks open at five memories');
  assert.truthy(guided.suggested, 'the type card is outlined');
  modal.onAccept('blacksmith');
  assert.eq(modal.title, 'Rank');
  assert.eq(modal.choices.filter(c => c.suggested).map(c => c.key).join(), 'blacksmith:1', 'only the T1 rank card is outlined');
  assert.falsy(modal.choices.find(c => c.key === 'blacksmith:2').suggested, 'the T2 card is not');
  // Once a smithy stands, no rank card is outlined.
  scene.save.restoredHouses.s = 'blacksmith'; scene.save.shopTiers = { s: 1 };
  present.call(scene, 0, 0, house);
  modal.onAccept('blacksmith');
  assert.eq(modal.title, 'Rank');
  assert.falsy(modal.choices.some(c => c.suggested), 'no outline once a smithy stands');
});

test('build choice: the offer modal has a choice row that pays only the selected card', () => {
  const sig = /showOfferModal\(\{[^)]*choices, choice = null, pickHint = 'Tap one to see what it does' \}\)/;
  assert.truthy(sig.test(MODAL_SHELL_SRC), 'choices / choice / pickHint are parameters');
  assert.truthy(/onAccept\(hasChoices \? selected\.key : undefined\);/.test(MODAL_SHELL_SRC), 'accept hands over the key');
  assert.truthy(/if \(hasChoices && !selected\) return;/.test(MODAL_SHELL_SRC), 'nothing is paid before a pick');
  assert.truthy(/selected = choices\.length === 1 \? choices\[0\]/.test(MODAL_SHELL_SRC), 'a single card is selected on its own');
  // A card's own price lands on the cost line when it is selected, and arms accept.
  assert.truthy(/const applyChoiceCost = \(\) => \{\n\s+if \(!selected \|\| selected\.cost == null\) return;\n\s+liveCanAfford = selected\.canAfford !== false;/.test(MODAL_SHELL_SRC), 'the selected card\'s cost and affordability');
  assert.truthy(/applyChoiceCost\(\);\n\s+syncAccept\(\);/.test(MODAL_SHELL_SRC), 'applied on every pick, before accept is armed');
  assert.truthy(/\(hasChoices && choices\.some\(\(c\) => c\.cost != null\)\)/.test(MODAL_SHELL_SRC), 'a cost line exists when any card prices itself');
});

test('build choice: tapping a navigation card closes the old modal without cancelling', () => {
  const oldCreate = document.createElement;
  let removed = 0, cancelled = 0, navigated = 0, accepted = 0;
  const el = () => ({ style: {}, children: [], events: {},
    appendChild(child) { this.children.push(child); },
    addEventListener(name, fn) { this.events[name] = fn; },
    remove() { removed++; },
    click() { this.events.click({ stopPropagation() {} }); },
  });
  document.createElement = el;
  try {
    const scene = new SceneModals(), buttons = [];
    scene.makeModalShell = () => ({ wrap: el(), box: el(), mount() {},
      mkBtn(label) {
        const b = Object.assign(el(), { innerHTML: label, _setEnabled(on) { this.disabled = !on; } });
        buttons.push(b); return b;
      },
    });
    scene.showOfferModal({ choices: [{ key: 'smith', label: 'Smithy', onSelect(key) {
      assert.eq(key, 'smith');
      assert.eq(removed, 1, 'previous modal removed before opening ranks');
      navigated++;
    } }], canAfford: false, onCancel() { cancelled++; }, onAccept() { accepted++; } });
    assert.eq(navigated, 0, 'automatic selection never advances the screen');
    buttons[0].click();
    assert.eq(navigated, 1, 'tap opens ranks even without materials');
    assert.eq(cancelled, 0, 'navigation retains pending restoration');
    assert.eq(accepted, 0, 'navigation does not restore anything');
    buttons[0].click();
    assert.eq(navigated, 1, 'a closed card cannot navigate twice');
  } finally { document.createElement = oldCreate; }
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
  assert.eq(Render.houseTextureFrame('turret', { id: 'ruin' }, {}),
    CastleStyles.get('bastion').towerFrame, 'even a ruin identity uses the intact tower');
  assert.truthy(/origin: \[0\.5, 1\.0\],\s*dxPx: \(o\) => _houseFootPx\(o\)\.x,/.test(RENDER_SRC), 'foot-seated on its footprint like every building');
  const shadow = Render.buildingShadow({visible:true,texKey:'tower',frameVal:0,scl:1,scaleYMul:1,
    dxPx:0,dyPx:0,origin:[0.5,1],spec:{groundAtOrigin:true}},
    {getFrame:()=>({width:32,height:32})}, {x:0,y:0});
  assert.inRange(shadow.width, 32, 40, 'tower-sized art gets a matching contact shadow');
  const fire = SCENE_SRC.slice(SCENE_SRC.indexOf('  _turretFire(now, px, py, halfSpanM, enemies, pc) {'));
  const body = fire.slice(0, fire.indexOf('\n  }\n'));
  assert.truthy(/this\._forEachHouseNear\(pc, \(o\) => \{\s*if \(Houses\.displayRole\(this\.save, o\) !== 'turret'\) return;/.test(body), 'turret houses join the scan');
  assert.truthy(/list\.push\(\{ id: o\.id, x: o\.x, y: o\.y, castle: o\.id, shiny: Houses\.isShinyHouse\(this\.save, o\) \}\);/.test(body), 'with their own id as the style key the arrow reads, and the hammer\'s shine');
  assert.truthy(/if \(shopType === 'turret'\) \{/.test(SCENE_SRC), 'a tap trades nothing');
  assert.eq(Houses.displayRole({ restoredHouses: { h: 'turret' } }, { kind: 'house', tier: 9, id: 'h' }), 'turret');
});
})();
