// Home bootstraps a workbench; existing crafting transactions now run there.
// Home tabs and station routing remain covered alongside shared recipe mechanics.
// app.js can't load headlessly, so the page methods are lifted out of
// SCENE_SRC and run for real on a stub scene; the routing is pinned as
// source text.

(function () {

const lift = (sig) => {
  const start = SCENE_SRC.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : SCENE_SRC.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${sig} in app.js`);
  return SCENE_SRC.slice(start + 1, end + 4);
};
const HOME = (0, eval)('({\n' + [
  lift('_finishInventoryChange() {'),
  lift('_homeTabs(active, sx, sy) {'),
  lift('_homeKindIcon() {'),
  lift('presentHomeCraft(sx, sy, targetId = null) {'),
  lift('presentWorkbench(o, targetId = null) {'),
  lift('_placedFurniture(o) {'),
  // The ingredient offer is scene_shops.js's one (SCENE_SRC holds the mixin).
  lift('_presentRecipePicker(sx, sy, { recipes, targetId, present, onCraft, empty, validate, ...modal }) {'),
  lift('_presentRecipeOffer(sx, sy, { recipe, produce, refuse, canAfford = true, ...modal }) {'),
].join(',\n') + '\n})');

function scene(inv) {
  const s = Object.assign(Object.create(HOME), {
    save: { inv: inv.map(([id, count]) => ({ id, count })), relics: {}, selSlot: -1 },
    depth: 0, workbench: { id: 'bench', itemId: 'workbench', depth: 0, houseKey: null },
    modals: [], flashes: [], loots: [],
    showOfferModal(o) { this.modals.push(o); },
    flash(t) { this.flashes.push(t); },
    flashAtPlayer(t) { this.flashes.push(t); },
    flashLoot(t) { this.loots.push(t); },
    invRoomFor(id) { return Inventory.roomFor(this.save, id); },
    addToInv(id, n) { Inventory.add(this.save, id, n); },
    iconSpanHTML: () => '', worldIconHTML: () => '',
    buildInventoryDOM() {}, _clampSelSlot() {},
    presentHomeSell() { this.modals.push({ sellPage: true }); },
  });
  s.save.furniture = [s.workbench];
  return s;
}
const last = (s) => s.modals[s.modals.length - 1];
const craft = (s) => { const m = last(s); m.onAccept(); m.repeat(); };

test('craft stations: recipes include the starter Spear and the Sugar Potion from two berries', () => {
  const by = Object.fromEntries(HOME_RECIPES.map(r => [r.id, r.cost]));
  assert.eq(JSON.stringify(by.throwing_spear), JSON.stringify([{ id: 'rubble', qty: 1 }, { id: 'wood', qty: 1 }]), 'throwing_spear');
  assert.falsy(by.torch, 'the torch is bought or found, never crafted (Oct 2026)');
  assert.eq(JSON.stringify(by.scarecrow), JSON.stringify([{ id: 'wood', qty: 3 }]), 'scarecrow');
  assert.eq(JSON.stringify(by.rope), JSON.stringify([{ id: 'longgrass', qty: 5 }]), 'rope from five long grass');
  assert.eq(JSON.stringify(by.trap_disarm_kit), JSON.stringify([{ id: 'rubble', qty: 4 }]), 'a disarm kit from four stones');
  assert.eq(JSON.stringify(by.sugar_potion), JSON.stringify([{ id: 'berry', qty: 2 }]), 'Sugar Potion from two berries');
  assert.falsy(by.taming_potion, 'the T7 Potion of Taming is found, never crafted');
  assert.truthy(/wall/.test(ITEM_EFFECTS.rubble), 'stone hints at rebuilding');
  assert.truthy(/twist/.test(ITEM_EFFECTS.longgrass), 'grass hints at binding');
  for (const r of HOME_RECIPES) {
    assert.truthy(ITEM_BY_ID[r.id], `${r.id} is a real item`);
    for (const c of r.cost) assert.truthy(ITEM_BY_ID[c.id], `${c.id} is a real item`);
  }
});

test('craft stations: discovered Growth Powder consumes nettles and grass once', () => {
  const s = scene([['nettle', 3], ['longgrass', 5]]);
  s.save.foundWild = { growth_powder: 1 };
  s.presentWorkbench(s.workbench, 'growth_powder');
  assert.truthy(last(s).canAfford);
  craft(s);
  assert.eq(Inventory.count(s.save, 'growth_powder'), 1);
  assert.eq(Inventory.count(s.save, 'nettle'), 0);
  assert.eq(Inventory.count(s.save, 'longgrass'), 0);
  assert.falsy(last(s).canAfford);
});

test('craft stations: recipeCap is the fewest times any ingredient covers its share', () => {
  const bag = { wood: 7, flint_shard: 2 };
  const count = (id) => bag[id] || 0;
  assert.eq(recipeCap([{ id: 'wood', qty: 3 }], count), 2, '7 wood makes two 3-wood crafts');
  assert.eq(recipeCap([{ id: 'wood', qty: 1 }, { id: 'flint_shard', qty: 1 }], count), 2, 'the scarcer one decides');
  assert.eq(recipeCap([{ id: 'ruby', qty: 1 }], count), 0, 'none held: none made');
  assert.eq(recipeCap([], count), 0, 'an empty recipe makes nothing, never Infinity');
});

test('craft stations: crafting spends the wood and hands over the item', () => {
  const s = scene([['wood', 5], ['rubble', 2]]);
  s.save.foundWild = { scarecrow: 1 };
  s.presentWorkbench(s.workbench, 'scarecrow');
  const m = last(s);
  assert.eq(m.kind, 'craft', 'the Craft category');
  assert.eq(m.quantity, undefined, 'craft once per tap without a quantity counter');
  assert.eq(m.cancelLabel, 'Leave');
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'wood'), 2, 'three wood spent');
  assert.eq(Inventory.count(s.save, 'scarecrow'), 1, 'one scarecrow made');
  s.presentWorkbench(s.workbench, 'throwing_spear');
  craft(s);
  craft(s);
  assert.eq(Inventory.count(s.save, 'wood'), 0, 'a spear is one wood each');
  assert.eq(Inventory.count(s.save, 'rubble'), 0, 'and one stone each');
  assert.eq(Inventory.count(s.save, 'throwing_spear'), 2, 'two spears');
});

test('craft stations: tier-2 barricades cost exactly three wood after discovery', () => {
  assert.eq(ITEM_BY_ID.barricade.baseTier, 2);
  assert.includes(ITEMS_BY_CLASS_TIER.supply[2], 'barricade');
  assert.falsy(ITEMS_BY_CLASS_TIER.supply[1].includes('barricade'));
  for (const group of ['supplies', 'field']) {
    assert.includes(ChestThemes.resolve(group, 2).ids, 'barricade');
    assert.falsy(ChestThemes.resolve(group, 1).ids.includes('barricade'));
  }
  assert.includes(Shops.themedStock('supply', 2), 'barricade');
  assert.falsy(Shops.themedStock('supply', 1).includes('barricade'));
  assert.truthy(homeRecipeLocked({}, 'barricade'));
  const s = scene([['wood', 5]]);
  s.save.foundWild = { barricade: 1 };
  s.presentWorkbench(s.workbench, 'barricade');
  assert.truthy(last(s).canAfford);
  last(s).onAccept();
  assert.eq(Inventory.count(s.save, 'wood'), 2);
  assert.eq(Inventory.count(s.save, 'barricade'), 1);
  s.presentWorkbench(s.workbench, 'barricade');
  assert.falsy(last(s).canAfford);
  last(s).onAccept();
  assert.eq(Inventory.count(s.save, 'wood'), 2);
  assert.eq(Inventory.count(s.save, 'barricade'), 1);
});

test('craft stations: bag room disables Craft and is rechecked before ingredients are spent', () => {
  const s = scene([['wood', 5], ['rubble', 5], ['throwing_spear', 8]]);
  s.presentWorkbench(s.workbench, 'throwing_spear');
  let m = last(s);
  assert.truthy(m.canAfford, 'one open stack place permits one spear');
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'wood'), 4, 'one wood spent');
  assert.eq(Inventory.count(s.save, 'rubble'), 4, 'one stone spent');
  assert.eq(Inventory.count(s.save, 'throwing_spear'), 9, 'the last place filled');

  s.presentWorkbench(s.workbench, 'throwing_spear');
  m = last(s);
  assert.falsy(m.canAfford, 'a full output stack disables Craft');
  assert.eq(m.disabledReason, bagFullFor('throwing_spear'), 'the disabled button explains the full output stack');
  assert.eq(m.quantity, undefined, 'no quantity stepper when nothing fits');
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'wood'), 4, 'the full-bag recheck preserves ingredients');
  assert.eq(Inventory.count(s.save, 'throwing_spear'), 9, 'the full output stack stays unchanged');
  assert.truthy(/Bag full for\nThrowing Spear/.test(s.flashes.at(-1) || ''), `names the full stack (bagFullFor, two lines): ${s.flashes.at(-1)}`);
});

test('craft stations: short on wood, the page says so and nothing changes hands', () => {
  const s = scene([['wood', 2]]);
  s.save.foundWild = { scarecrow: 1 };
  s.presentWorkbench(s.workbench, 'scarecrow');
  const m = last(s);
  assert.falsy(m.canAfford, 'the Craft button is off');
  assert.eq(m.disabledReason, 'Missing ingredients', 'the refusal is visible without tapping a disabled button');
  assert.eq(m.quantity, undefined, 'no stepper with nothing to make');
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'wood'), 2, 'the wood stays');
  assert.eq(Inventory.count(s.save, 'scarecrow'), 0, 'no scarecrow');
  assert.truthy(/Need 1 more Wood/.test(s.flashes[0] || ''), `names the shortfall: ${s.flashes[0]}`);
});

test('craft stations: opens on something the bag can make, and named options select recipes', () => {
  const s = scene([['wood', 1], ['rubble', 1]]);
  s.save.foundWild = Object.fromEntries(HOME_RECIPES.map(r => [r.id, 1]));
  s.save.usedScrolls = ITEMS.filter(item => item.scroll).map(item => item.id);
  s.presentWorkbench(s.workbench);
  const m = last(s);
  assert.truthy(m.canAfford, 'a wood and a stone: the page opens on the spear it can make');
  assert.eq(m.secondary, undefined, 'recipe selection has its own control');
  assert.eq(m.pager.count, HOME_RECIPES.filter(r => r.station === 'workbench').length, 'one option per workbench recipe');
  m.pager.options.find(o => o.label === itemName('scarecrow')).onSelect();
  assert.falsy(last(s).canAfford, 'and the scarecrow page shows it cannot be made yet');
  last(s).pager.options.find(o => o.label === itemName('throwing_spear')).onSelect();
  assert.truthy(last(s).canAfford, 'selecting Spear returns to its affordable recipe');
});

test('craft stations: recipe picker jumps directly among learned recipes without changing the bag', () => {
  const s = scene([['wood', 6], ['blank_scroll', 2], ['fear_scroll', 1]]);
  s.save.foundWild = { scarecrow: 1, fear_scroll: 1 };
  s.save.usedScrolls = ['fireball_scroll'];
  const before = JSON.stringify(s.save);
  s.presentWorkbench(s.workbench);
  const options = last(s).pager.options;
  assert.eq(options.map(o => o.label).join('|'),
    ['throwing_spear', 'scarecrow', 'fireball_scroll'].map(itemName).join('|'),
    'picker shows known recipes only: possession and a wild scroll find do not teach the scroll');
  options.find(o => o.label === itemName('fireball_scroll')).onSelect();
  assert.includes(last(s).get, itemName('fireball_scroll'), 'a nonadjacent recipe can be selected directly');
  assert.eq(last(s).pager.index, 2, 'the picker follows the selected recipe');
  last(s).pager.options.find(o => o.label === itemName('scarecrow')).onSelect();
  assert.includes(last(s).get, itemName('scarecrow'));
  assert.eq(JSON.stringify(s.save), before, 'browsing never consumes ingredients or teaches recipes');
});

test('craft stations: ingredient and output counts refresh after each craft, including exhaustion', () => {
  const s = scene([['wood', 5], ['scarecrow', 1]]);
  s.save.foundWild = { scarecrow: 1 };
  s.iconSpanHTML = id => `<i data-item="${id}"></i>`;
  const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  s.presentWorkbench(s.workbench, 'scarecrow');
  let m = last(s);
  assert.includes(m.cost, 'recipe-ingredients');
  assert.truthy(/Have\s*\/\s*Need/.test(text(m.cost)), 'counts are labelled so their order is clear');
  assert.truthy(/5\s*\/\s*3/.test(text(m.cost)), 'five held, three required');
  assert.eq(m.pager.caption, 'Makes 1 · In bag: 1');
  assert.includes(m.pager.iconHTML, 'data-item="scarecrow"', 'the selected output has its own icon');
  assert.falsy(m.title, 'the recipe does not repeat the Craft tab heading');
  assert.falsy(m.getLabel, 'the output caption is not duplicated');
  assert.falsy(m.disabledReason);
  craft(s);
  m = last(s);
  assert.includes(m.get, itemName('scarecrow'), 'exhaustion keeps the selected recipe open');
  assert.eq(m.pager.caption, 'Makes 1 · In bag: 2');
  assert.truthy(/2\s*\/\s*3/.test(text(m.cost)), 'the reopened counter reads the updated bag');
  assert.includes(text(m.cost), 'Need 1 more', 'the exact shortage is visible beside its ingredient');
  assert.eq(m.disabledReason, 'Missing ingredients');
  assert.falsy(m.canAfford);
});

test('craft stations: full output stack takes precedence when ingredients are also missing', () => {
  const s = scene([['throwing_spear', 9]]);
  s.presentWorkbench(s.workbench, 'throwing_spear');
  const m = last(s);
  assert.falsy(m.canAfford);
  assert.eq(m.disabledReason, bagFullFor('throwing_spear'), 'the caller\'s bag-room refusal is retained');
  assert.includes(m.cost, 'Need 1 more', 'ingredient shortages remain visible too');
  const before = JSON.stringify(s.save);
  m.onAccept();
  assert.eq(JSON.stringify(s.save), before, 'the stale disabled offer cannot mutate the bag');
});

test('craft stations: the Sell and Craft pages are tabs of one panel', () => {
  const s = scene([]);
  s.presentHomeCraft(0, 0);
  const tabs = last(s).tabs;
  assert.eq(tabs.map(t => t.label).join(','), 'Sell,Craft', 'two pages');
  assert.truthy(tabs[1].active && !tabs[0].active, 'Craft is the active page');
  tabs[0].onSelect();
  assert.truthy(last(s).sellPage, 'the Sell tab opens the Sell page');
});

test('craft stations: Home routes a held stack to Sell and an empty hand to Craft', () => {
  const start = SCENE_SRC.indexOf('\n  shopInteract(sx, sy, house) {');
  const body = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(/if \(isHome\) \{\s*if \(hasSel\) this\.presentHomeSell\(sx, sy\);\s*else this\.presentHomeCraft\(sx, sy\);/.test(body),
    'shopInteract hands Home to its two pages');
});

test('craft stations: every mode starts with only Spear and hides undiscovered recipes from the selector', () => {
  const was = Difficulty.mode();
  try {
    for (const mode of [Difficulty.EASY, Difficulty.HARD]) {
      Difficulty.setMode(mode);
      const s = scene([['rubble', 8], ['wood', 8], ['trap_disarm_kit', 1], ['berry', 8]]);
      s.presentWorkbench(s.workbench, 'trap_disarm_kit');
      let m = last(s);
      assert.includes(m.get, 'Spear', 'a locked target falls back to the known recipe');
      assert.eq(m.pager.count, 1);
      assert.falsy(/Trap Disarm Kit|Find a|locked/i.test(m.get + m.blurb));
      assert.eq(m.pager.options.length, 1);
      m.pager.options[0].onSelect();
      assert.includes(last(s).get, 'Spear');
      s.save.foundWild = { trap_disarm_kit: 1 };
      s.presentWorkbench(s.workbench, 'trap_disarm_kit');
      m = last(s);
      assert.eq(m.pager.count, 2, 'a wild find exposes only its own recipe');
      assert.truthy(m.canAfford);
      craft(s);
      craft(s);
      assert.eq(Inventory.count(s.save, 'trap_disarm_kit'), 3, 'two kits from eight stones');
      assert.eq(Inventory.count(s.save, 'rubble'), 0);
      assert.eq(m.pager.options.length, 2, 'still-locked recipes have no options');
      m.pager.options.find(o => o.label === itemName('throwing_spear')).onSelect();
      assert.includes(last(s).get, 'Spear');
      last(s).pager.options.find(o => o.label === itemName('trap_disarm_kit')).onSelect();
      assert.includes(last(s).get, 'Trap Disarm Kit');
    }
  } finally { Difficulty.setMode(was); }
});

test('craft stations: learned Sugar Potion consumes two berries per jar, rechecks ingredients and persists its unlock', () => {
  const s = scene([['berry', 5]]);
  s.save.foundWild = { sugar_potion: 1 };
  s.presentWorkbench(s.workbench, 'sugar_potion');
  const m = last(s);
  assert.eq(m.quantity, undefined);
  craft(s);
  assert.truthy(last(s).canAfford, 'another jar is available after the first tap');
  craft(s);
  assert.falsy(last(s).canAfford, 'the recipe stays open when ingredients run out');
  assert.includes(last(s).get, itemName('sugar_potion'), 'repeat preserves the current recipe');
  assert.eq(Inventory.count(s.save, 'berry'), 1);
  assert.eq(Inventory.count(s.save, 'sugar_potion'), 2);
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'berry'), 1, 'stale offer cannot spend missing ingredients');
  assert.eq(Inventory.count(s.save, 'sugar_potion'), 2);
  Inventory.remove(s.save, 'sugar_potion', 2);
  s.presentWorkbench(s.workbench, 'sugar_potion');
  assert.includes(last(s).get, itemName('sugar_potion'), 'learned recipe survives spending the item');
  assert.falsy(last(s).canAfford, 'ingredient shortages remain visible once learned');
});

test('craft stations: the wild-finds ledger — every grant counts except bought, bartered, forged or crafted', () => {
  const add = SCENE_SRC.slice(SCENE_SRC.indexOf('\n  addToInv(id, n = 1, silent = false, opts = {}) {'));
  assert.truthy(/if \(!opts\.notWild\) \(this\.save\.foundWild = this\.save\.foundWild \|\| \{\}\)\[id\] = 1;/.test(add.slice(0, 3000)),
    'addToInv records the find');
  const notWild = (SCENE_SRC.match(/\{ notWild: true(?:, deferRefresh: true)?(?:, deferBookRead: (?:!!boothKind|true))? \}/g) || []).length;
  assert.eq(notWild, 12, 'the twelve non-wild grant sites: shared craft/brew, smelt, trader, the trader\'s gear swap, a counter\'s gear, stand, two shop buys, a slot win, a potion transmuted in a campfire, its full-bag refund and furniture pickup');
  assert.truthy(/addToInv\('scarecrow', 1, false, \{ notWild: true \}\)/.test(INTERACT_SRC), 'a reclaimed scarecrow is not a find');
});

test('craft stations: scrolls require prior use in both modes and spend blank scrolls', () => {
  const was = Difficulty.mode();
  try {
    for (const mode of [Difficulty.EASY, Difficulty.HARD]) {
      Difficulty.setMode(mode);
      for (const id of ['fireball_scroll', 'fear_scroll', 'treasure_map']) {
        const s = scene([['blank_scroll', 3], [id, 1]]);
        s.save.foundWild = { [id]: 1 };
        s.presentWorkbench(s.workbench, id);
        const locked = last(s);
        assert.falsy(locked.canAfford, `${id}: possession and a wild find do not teach it`);
        assert.falsy(locked.get.includes(itemName(id)), 'an explicit unknown target is not offered');
        const knownCount = locked.pager.count;
        for (const option of locked.pager.options) {
          assert.falsy(option.label === itemName(id), 'unused scroll has no selector option');
          option.onSelect();
          assert.falsy(last(s).get.includes(itemName(id)), 'unused scroll is absent from every selectable recipe');
        }
        locked.onAccept(1);
        assert.eq(Inventory.count(s.save, 'blank_scroll'), 3, 'locked craft preserves blanks');
        assert.eq(Inventory.count(s.save, id), 1, 'locked craft makes nothing');
        s.save.usedScrolls = [id];
        s.save.foundWild = {};
        s.presentWorkbench(s.workbench, id);
        assert.truthy(last(s).canAfford, 'use alone teaches the recipe, even in hard mode');
        assert.includes(last(s).get, itemName(id), 'learned scroll is offered');
        assert.eq(last(s).pager.count, knownCount + 1, 'using a scroll adds its recipe to the selector');
        assert.eq(last(s).quantity, undefined, 'one blank per tap');
        craft(s);
        craft(s);
        assert.eq(Inventory.count(s.save, 'blank_scroll'), 1, 'two blanks spent');
        assert.eq(Inventory.count(s.save, id), 3, 'two scrolls made');
      }
    }
    assert.falsy(HOME_RECIPES.some(r => r.id === 'blank_scroll'), 'blank scroll is only a material');
  } finally { Difficulty.setMode(was); }
});

test('craft stations: learned scroll recipes survive saving and normalization', () => {
  const slot = createSave('Scroll crafting test');
  try {
    const save = { inv: [{ id: 'fear_scroll', count: 1 }], usedScrolls: ['fireball_scroll'] };
    persistSave(save);
    flushSave();
    const loaded = loadSave();
    SaveState.normalize(loaded);
    assert.falsy(homeRecipeLocked(loaded, 'fireball_scroll', true), 'learned recipe persists');
    assert.truthy(homeRecipeLocked(loaded, 'fear_scroll', false), 'held unused scroll stays locked');
    const old = { inv: [{ id: 'treasure_map', count: 1 }] };
    SaveState.normalize(old);
    assert.eq(old.usedScrolls.length, 0, 'older saves start without inferred scroll uses');
    assert.truthy(homeRecipeLocked(old, 'treasure_map', false), 'normalization cannot teach a held scroll');
  } finally { deleteSave(slot); }
});

})();
