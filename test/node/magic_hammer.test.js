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
  const save = { restoredHouses: {} };
  assert.eq(Houses.restoreAs(save, h('a'), 'plain', { hammer: true }).key, 'plain');
  assert.truthy(Houses.isShinyHouse(save, h('a')));
  assert.eq(Houses.priceMul(save, h('a')), Houses.HAMMER_PRICE_MUL);
  assert.eq(Houses.HAMMER_PRICE_MUL, 0.8);
  Houses.restoreAs(save, h('b'), 'plain');
  assert.falsy(Houses.isShinyHouse(save, h('b')));
  assert.eq(Houses.priceMul(save, h('b')), 1);
  save.shopCharm = { a: Date.now() + 60000 };
  assert.inRange(Houses.priceMul(save, h('a')), 0.4 - 1e-9, 0.4 + 1e-9, 'the charm stacks for its hour');
  assert.truthy(/Math\.ceil\(offer\.price \* this\.priceMul\(house\)\)/.test(SCENE_SRC), 'relic offers');
  assert.truthy(/ShopsMath\.buyPrice\(this\.save, baseValue, priceRng\) \* this\.priceMul\(opts\.house\)/.test(SCENE_SRC), 'cash buys');
  assert.truthy(/const target = baseValue \* \(1\.0 \+ rng\(\)\) \* this\.priceMul\(house\);/.test(SCENE_SRC), 'the trader\'s ask');
  assert.truthy(/&& this\.shopCharmMul\(house\) === 1\)/.test(SCENE_SRC), 'the flower gift still asks the charm alone');
});

test('magic hammer: the restore modal asks, spends it only on a yes, and the house glints', () => {
  const start = SCENE_SRC.indexOf('  presentWreckRestoreModal(sx, sy, house) {');
  const src = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(/if \(Inventory\.count\(this\.save, Houses\.HAMMER_ID\) > 0\) \{/.test(src), 'asked only when held');
  assert.truthy(/secondary: \{ label: 'Without it', onClick: \(\) => restore\(key, false\) \}/.test(src), 'a plain restore stays one tap away');
  assert.truthy(/onAccept: \(\) => restore\(key, true\)/.test(src));
  assert.truthy(/const row = Houses\.restoreAs\(this\.save, house, key, \{ hammer \}\);/.test(src), 'the shine is stamped with the pick');
  assert.truthy(/if \(hammer\) Inventory\.remove\(this\.save, Houses\.HAMMER_ID, 1\);/.test(src), 'and the hammer is spent after the pick is accepted');
  assert.truthy(src.indexOf('Houses.restoreAs(') < src.indexOf('Inventory.remove(this.save, Houses.HAMMER_ID'), 'never before');
  assert.truthy(/\|\| \(o\.kind === 'house' && Houses\.isShinyHouse\(scene\.save, o\)\), o\.id\);/.test(RENDER_SRC), 'the sprite glints');
  assert.truthy(/\|\| \(it\.o\.kind === 'house' && Houses\.isShinyHouse\(scene\.save, it\.o\)\)\) \{/.test(RENDER_SRC), 'and lights like a shiny tree');
});
})();
