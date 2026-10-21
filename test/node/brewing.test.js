// Execute the real Magic Shop brewing flow with inventory and money state.
(function () {
const lift = (sig) => {
  const start = SCENE_SRC.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : SCENE_SRC.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${sig}`);
  return SCENE_SRC.slice(start + 1, end + 4);
};
const BREW = (0, eval)('({\n' + [
  lift('_brewingTabs(active, sx, sy, house, recordDeal) {'),
  lift('presentBrewOffer(sx, sy, house, recordDeal, targetId = null) {'),
  lift('_settleDeal(recordDeal, loot) {'),
  lift('_presentThemedItem(sx, sy, house, recordDeal, id) {'),
  lift('_buildThemedItemOffer(sx, sy, house, recordDeal, id, entry = null) {'),
  lift('_presentRecipePicker(sx, sy, { recipes, targetId, present, onCraft, empty, validate, ...modal }) {'),
  lift('_presentRecipeOffer(sx, sy, { recipe, produce, refuse, canAfford = true, ...modal }) {'),
].join(',\n') + '\n})');
const last = s => s.modals.at(-1);
const count = (s, id) => Inventory.count(s.save, id);
const house = { id: 'brewing-shop', kind: 'shop', theme: 'potion', tier: 5 };
function scene(inv = [], money = 100, found = []) {
  return Object.assign(Object.create(BREW), {
    save: { inv: inv.map(([id, count]) => ({ id, count })), money, relics: {},
      selSlot: -1, foundWild: Object.fromEntries(found.map(id => [id, 1])) },
    modals: [], flashes: [], grants: [], deals: 0, refreshes: 0,
    showOfferModal(o) { this.modals.push(o); },
    flash(t) { this.flashes.push(t); }, flashLoot() {},
    invRoomFor(id) { return Inventory.roomFor(this.save, id); },
    addToInv(id, n, silent, opts = {}) {
      this.grants.push({ id, n, opts });
      const accepted = Inventory.add(this.save, id, n);
      if (!opts.notWild) this.save.foundWild[id] = 1;
      return accepted;
    },
    iconSpanHTML: () => '', worldIconHTML: () => '',
    moneyHTML: n => `${n} coins`,
    _clampSelSlot() {}, _finishInventoryChange() { this.refreshes++; },
    buildInventoryDOM() {}, updateHUD() {},
    presentThemedShop(...args) { this.modals.push({ shopPage: true, args }); },
  });
}
function open(s, id) { s.presentBrewOffer(12, 34, house, () => s.deals++, id); }

test('brewing: the agreed eight recipes include coin fees and exclude revival', () => {
  const expected = {
    antidote: [[['cress', 3]], 2],
    hardworking_potion: [[['potato', 3]], 3],
    grip_potion: [[['shell', 2], ['old_boot', 1]], 3],
    healing_potion: [[['berry', 3], ['onion', 2]], 5],
    stoneskin_potion: [[['nut', 3], ['coconut', 2]], 5],
    blight_potion: [[['marigold', 2], ['meat', 1]], 5],
    shielding_potion: [[['starflower', 2], ['milk', 1]], 20],
    shrinking_potion: [[['mango', 2]], 4],
  };
  assert.eq(BREW_RECIPES.length, Object.keys(expected).length);
  for (const [id, [cost, coins]] of Object.entries(expected)) {
    const recipe = BREW_RECIPES.find(r => r.id === id);
    assert.truthy(recipe, id);
    assert.eq(JSON.stringify(recipe.cost), JSON.stringify(cost.map(([id, qty]) => ({ id, qty }))), id);
    assert.eq(recipe.coins, coins, id);
    assert.truthy(ITEM_BY_ID[id]);
    for (const ingredient of recipe.cost) assert.truthy(ITEM_BY_ID[ingredient.id]);
  }
});

test('brewing: an empty recipe book teaches discovery and keeps the Shop tab usable', () => {
  const s = scene([['mango', 2], ['shrinking_potion', 1]], 100);
  open(s, 'shrinking_potion');
  const m = last(s);
  assert.eq(m.tabs.map(t => t.label).join(','), 'Shop,Brew');
  assert.truthy(m.tabs[1].active);
  assert.falsy(m.tabs[0].active);
  assert.includes(JSON.stringify(m), 'Once you find a potion, you can brew it here.');
  assert.falsy(m.canAfford, 'possession alone cannot unlock brewing');
  const before = JSON.stringify(s.save);
  m.onAccept?.();
  assert.eq(JSON.stringify(s.save), before);
  m.tabs[0].onSelect();
  assert.truthy(last(s).shopPage);
  assert.eq(last(s).args[2], house, 'tab preserves the shop');
});

test('brewing: picker includes only discovered recipes and browsing spends nothing', () => {
  const s = scene([['mango', 4], ['cress', 3]], 20, ['antidote', 'shrinking_potion']);
  open(s, 'shielding_potion');
  const before = JSON.stringify(s.save);
  const options = last(s).pager.options;
  assert.eq(options.map(o => o.label).join('|'), ['antidote', 'shrinking_potion'].map(itemName).join('|'));
  options[1].onSelect();
  assert.includes(last(s).get, itemName('shrinking_potion'));
  assert.eq(JSON.stringify(s.save), before);
});

test('brewing: Magic Shop purchases expose the Brew tab while other shops do not', () => {
  const s = scene();
  Object.assign(s, {
    shopLine: h => ({ theme: h.theme, tier: h.tier }),
    shopRng: () => () => 0.5,
    buildShopOffer: () => ({ label: '5 coins', canAfford: () => true }),
    buildingFlavorTitle: () => '', shopTierBadgeHTML: () => '',
    _shopBagSpaceReason: () => undefined, _themedStockCount: () => 1,
  });
  s._presentThemedItem(12, 34, house, () => s.deals++, 'antidote');
  assert.eq(last(s).tabs.map(t => t.label).join(','), 'Shop,Brew');
  assert.truthy(last(s).tabs[0].active);
  last(s).tabs[1].onSelect();
  assert.truthy(last(s).tabs[1].active);
  s._presentThemedItem(12, 34, { ...house, theme: 'food' }, () => {}, 'potato');
  assert.eq(last(s).tabs, undefined);
});

test('brewing: a brew consumes all ingredients and exact coins, then repeats the selected recipe', () => {
  const s = scene([['mango', 4]], 8, ['shrinking_potion']);
  open(s, 'shrinking_potion');
  for (let i = 1; i <= 2; i++) {
    const m = last(s);
    assert.truthy(m.canAfford);
    assert.eq(m.acceptLabel, 'Brew');
    m.onAccept();
    assert.eq(count(s, 'mango'), 4 - i * 2);
    assert.eq(s.save.money, 8 - i * 4);
    assert.eq(count(s, 'shrinking_potion'), i);
    m.repeat();
    assert.includes(last(s).get, itemName('shrinking_potion'));
  }
  assert.falsy(last(s).canAfford);
  assert.eq(s.refreshes, 2);
  assert.eq(s.deals, 2, 'each successful brew is a shop transaction');
  assert.truthy(s.grants.every(g => g.opts.notWild), 'brewed potions are never wild discoveries');
  const before = JSON.stringify(s.save);
  last(s).onAccept();
  assert.eq(JSON.stringify(s.save), before, 'exhausted offer cannot charge or produce');
});

test('brewing: shielding spends the milk supplement as well as starflowers and coins', () => {
  const s = scene([['starflower', 3], ['milk', 2]], 23, ['shielding_potion']);
  open(s, 'shielding_potion');
  last(s).onAccept();
  assert.eq(count(s, 'starflower'), 1);
  assert.eq(count(s, 'milk'), 1);
  assert.eq(s.save.money, 3);
  assert.eq(count(s, 'shielding_potion'), 1);
});

test('brewing: an unaffordable or full recipe is disabled before accepting', () => {
  for (const s of [
    scene([['mango', 2]], 3, ['shrinking_potion']),
    scene([['mango', 2], ['shrinking_potion', 9]], 4, ['shrinking_potion']),
  ]) {
    open(s, 'shrinking_potion');
    const m = last(s);
    assert.falsy(m.canAfford);
    assert.truthy(m.disabledReason, 'the button explains why brewing is unavailable');
    const before = JSON.stringify(s.save);
    m.onAccept();
    assert.eq(JSON.stringify(s.save), before);
  }
});

test('brewing: stale money, ingredients, room or discovery refuse before any resources are spent', () => {
  const cases = {
    money(s) { s.save.money = 3; },
    ingredients(s) { Inventory.remove(s.save, 'mango', 1); },
    room(s) { Inventory.add(s.save, 'shrinking_potion', 9); },
    discovery(s) { delete s.save.foundWild.shrinking_potion; },
  };
  for (const [reason, mutate] of Object.entries(cases)) {
    const s = scene([['mango', 2]], 4, ['shrinking_potion']);
    open(s, 'shrinking_potion');
    const m = last(s);
    assert.truthy(m.canAfford, reason);
    mutate(s);
    const before = JSON.stringify(s.save);
    m.onAccept();
    assert.eq(JSON.stringify(s.save), before, reason + ' leaves inventory and coins unchanged');
    assert.eq(s.grants.length, 0, reason + ' grants nothing');
    assert.eq(s.deals, 0, reason + ' records no completed transaction');
    assert.gt(s.flashes.length, 0, reason + ' explains refusal');
  }
});
})();
