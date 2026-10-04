// THE MAGIC HAMMER (houses.js HAMMER_ID): a T4 magic item spent on a restore —
// the building comes up shiny and sells at HAMMER_PRICE_MUL for good, the one
// standing discount now that no relic bends a price.
(function () {
const h = (id) => ({ kind: 'house', tier: 9, id });

test('magic hammer: a T4 magic item with an icon, a price and a story line', () => {
  const it = ITEM_BY_ID[Houses.HAMMER_ID];
  assert.truthy(it && it.kind === 'magic', 'a magic item');
  assert.eq(it.baseTier, 4);
  assert.truthy(PRICES.magic_hammer > 0);
  assert.truthy(ITEM_EFFECTS.magic_hammer && !/[0-9%]/.test(ITEM_EFFECTS.magic_hammer), 'a hint, no numbers');
  assert.eq(MINERAL_ICON_SHEET.magic_hammer.sheet, 'icon_magic_hammer');
  assert.truthy(/icon_magic_hammer: \{ url: 'assets\/Icons\/Items\/MagicHammer\.png'/.test(SCENE_SRC), 'the sheet is registered');
  assert.truthy(Shops.THEME_POOL.potion().includes('magic_hammer'), 'the Magic Shop line carries it');
  assert.falsy(CONSUMABLE_SPEC.magic_hammer, 'no bag action: it is spent at a wreck');
});

test('magic hammer: restoreAs marks the house shiny and every price reads priceMul', () => {
  const save = SaveState.defaults({ restoredHouses: {} });
  // The first restore can only be the House (STORY_RESTORES), which takes no
  // hammer; the second may be the smithy, and that one shines.
  Houses.restoreAs(save, h('b'), 'plain');
  assert.falsy(Houses.isShinyHouse(save, h('b')));
  assert.eq(Houses.priceMul(save, h('b')), 1);
  assert.eq(Houses.restoreAs(save, h('a'), 'blacksmith:1', { hammer: true }).key, 'blacksmith:1');
  assert.truthy(Houses.isShinyHouse(save, h('a')));
  assert.eq(Houses.priceMul(save, h('a')), Houses.HAMMER_PRICE_MUL);
  assert.eq(Houses.HAMMER_PRICE_MUL, 0.8);
  save.shopCharm = { a: Date.now() + 60000 };
  assert.inRange(Houses.priceMul(save, h('a')), 0.4 - 1e-9, 0.4 + 1e-9, 'the charm stacks for its hour');
  assert.truthy(/Math\.ceil\(offer\.price \* this\.priceMul\(house\)\)/.test(SCENE_SRC), 'relic offers');
  assert.truthy(/ShopsMath\.buyPrice\(this\.save, baseValue, priceRng\) \* this\.priceMul\(opts\.house\)/.test(SCENE_SRC), 'cash buys');
  assert.truthy(/const target = baseValue \* \(1\.0 \+ rng\(\)\) \* this\.priceMul\(house\);/.test(SCENE_SRC), 'the trader\'s ask');
  assert.truthy(/&& this\.shopCharmMul\(house\) === 1\)/.test(SCENE_SRC), 'the flower gift still asks the charm alone');
});

test('magic hammer: a plain House takes no hammer — the predicate, the ledger and the dialog agree', () => {
  assert.falsy(Houses.hammerTakes({ key: 'plain', role: 'plain' }), 'never the plain House');
  assert.falsy(Houses.hammerTakes(null));
  for (const role of ['blacksmith', 'trader', 'market', 'turret', 'wizard']) {
    assert.truthy(Houses.hammerTakes({ key: role, role }), `${role} takes it`);
  }
  const save = { restoredHouses: {} };
  assert.eq(Houses.restoreAs(save, h('p'), 'plain', { hammer: true }).key, 'plain', 'the restore itself goes through');
  assert.falsy(Houses.isShinyHouse(save, h('p')), 'but nothing is stamped');
  assert.eq(Houses.priceMul(save, h('p')), 1);
  const start = SCENE_SRC.indexOf('  presentWreckRestoreModal(sx, sy, house) {');
  const src = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(/takes: \(key\) => Houses\.hammerTakes\(options\.find\(\(r\) => r\.key === key\)\),/.test(src), 'the button greys on a card that refuses it');
  assert.truthy(/if \(hammer && \(Inventory\.count\(this\.save, Houses\.HAMMER_ID\) < 1 \|\| !Houses\.hammerTakes\(picked\)\)\) hammer = false;/.test(src), 'and is never spent on one');
  assert.truthy(/sec\._setEnabled\(armed && !secondary\.disabled && \(!secondary\.takes \|\| !!secondary\.takes\(selected\.key\)\)\);/.test(MODAL_SHELL_SRC), 'the shell asks the card');
});

test('magic hammer: a shiny turret shoots double, in arrows of light', () => {
  const CELL = 5;
  const foe = { id: 'g', kind: 'goblin', x: 0, y: -2 * CELL, hp: 999 };
  const plain = Combat.turretShot(0, 0, [foe], CELL);
  const shiny = Combat.turretShot(0, 0, [foe], CELL, true);
  assert.eq(plain.damage, Combat.turretShotDamage(), 'an ordinary turret: the Wood bow');
  assert.falsy(plain.shiny); assert.eq(plain.color, undefined);
  assert.eq(shiny.damage, Combat.shinyTurretDamage());
  assert.eq(shiny.damage, Combat.turretShotDamage() * Combat.powerMul({ shiny: true }), 'through the shiny powerMul');
  assert.eq(shiny.damage, plain.damage * 2, 'double');
  assert.truthy(shiny.shiny, 'stamped for the draw');
  assert.eq(shiny.color, Combat.SHINY_ARROW_COLOR, 'in the shine\'s gold');
  assert.eq(Combat.SHINY_ARROW_COLOR, Lighting.KINDS.shiny.colour, 'the same gold the shiny row lights with');
  assert.eq(shiny.source, 'turret', 'still the turret\'s, not the player\'s');
  assert.eq(shiny.slot, 'bow'); assert.falsy(shiny.dotPx, 'an arrow, not a bolt');
  // turretTick hands the turret's flag through.
  const clocks = {};
  const t = { id: 't', x: 0, y: 0, castle: 'c', shiny: true };
  const first = Combat.turretTick([t], clocks, 0, [foe], CELL);
  const fired = Combat.turretTick([t], clocks, clocks.t + 1, [foe], CELL);
  assert.eq(first.length + fired.length, 1);
  assert.truthy((first[0] || fired[0]).shiny, 'the scan row\'s shine reaches the arrow');
  assert.truthy(/list\.push\(\{ id: o\.id, x: o\.x, y: o\.y, castle: o\.id, shiny: Houses\.isShinyHouse\(this\.save, o\) \}\);/.test(SCENE_SRC), 'the scan reads the ledger');
  // The arrow is a light on the bolt lane, at the shiny row's reach and peak.
  const sc = { cellM: CELL, _shots: [shiny, plain], _lights: [] };
  assert.eq(Lighting.collectBolts(sc, 0, 0, 100), 1, 'the shiny arrow lights, the plain one does not');
  const L = sc._lights[0];
  assert.eq(L.kind, 'bolt');
  assert.eq(L.r, Lighting.radiusCells('shiny'));
  assert.eq(L.a, Lighting.KINDS.shiny.peak);
  assert.eq(L.colour, Combat.SHINY_ARROW_COLOR);
  assert.truthy(/if \(s\.shiny\) \{\s*const key = this\._boltGlowKey\(s\.color != null \? s\.color : spec\.color\);/.test(SCENE_SRC), 'the draw halos it');
});

test('magic hammer: the restore dialog offers it beside Restore, spends it only on that button, and the house glints', () => {
  const start = SCENE_SRC.indexOf('  presentWreckRestoreModal(sx, sy, house) {');
  const src = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  // In the SAME window (owner, Oct 2026): a "With Hammer" button beside
  // Restore when one is held, armed with the pick like Restore; no second prompt.
  assert.truthy(/const hasHammer = Inventory\.count\(this\.save, Houses\.HAMMER_ID\) > 0;/.test(src), 'offered only when held');
  assert.truthy(/secondary: hasHammer\n\s+\? \{ label: `\$\{this\.iconSpanHTML\(Houses\.HAMMER_ID\)\} With Hammer`, withChoice: true,\n\s+takes: [^\n]*\n\s+onClick: \(key\) => restore\(key, true\) \}/.test(src), 'the hammer is a second accept, with the picked key');
  assert.truthy(/onAccept: \(key\) => restore\(key, false\),/.test(src), 'Restore alone is the plain restore');
  assert.falsy(/Use your \$\{hammer/.test(src) && /Without it/.test(src), 'the second prompt is gone');
  assert.truthy(/if \(sec && secondary\.withChoice\) \{\s*sec\._setEnabled\(armed && !secondary\.disabled/.test(MODAL_SHELL_SRC), 'the shell arms it with accept');
  assert.truthy(/secondary\.onClick\(hasChoices \? selected\.key : undefined\);/.test(MODAL_SHELL_SRC), 'and hands it the selected key');
  assert.truthy(/const row = Houses\.restoreAs\(this\.save, house, key, \{ hammer \}\);/.test(src), 'the shine is stamped with the pick');
  assert.truthy(/if \(hammer\) Inventory\.remove\(this\.save, Houses\.HAMMER_ID, 1\);/.test(src), 'and the hammer is spent after the pick is accepted');
  assert.truthy(src.indexOf('Houses.restoreAs(') < src.indexOf('Inventory.remove(this.save, Houses.HAMMER_ID'), 'never before');
  assert.truthy(/\|\| \(o\.kind === 'house' && Houses\.isShinyHouse\(scene\.save, o\)\), o\.id\);/.test(RENDER_SRC), 'the sprite glints');
  assert.truthy(/\|\| \(it\.o\.kind === 'house' && Houses\.isShinyHouse\(scene\.save, it\.o\)\)\) \{/.test(RENDER_SRC), 'and lights like a shiny tree');
});
})();
