// Home's Craft page — the trailer panel's second tab beside Sell (app.js
// presentHomeSell / presentHomeCraft, recipes in items.js HOME_RECIPES).
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
].join(',\n') + '\n})');

function scene(inv) {
  const s = Object.assign(Object.create(HOME), {
    save: { inv: inv.map(([id, count]) => ({ id, count })), relics: {}, selSlot: -1 },
    modals: [], flashes: [], loots: [],
    showOfferModal(o) { this.modals.push(o); },
    flash(t) { this.flashes.push(t); },
    flashLoot(t) { this.loots.push(t); },
    invRoomFor(id) { return Inventory.roomFor(this.save, id); },
    addToInv(id, n) { Inventory.add(this.save, id, n); },
    iconSpanHTML: () => '', worldIconHTML: () => '',
    buildInventoryDOM() {}, _clampSelSlot() {},
    presentHomeSell() { this.modals.push({ sellPage: true }); },
  });
  return s;
}
const last = (s) => s.modals[s.modals.length - 1];

test('home craft: recipes include the starter Spear and Syrup from two berries', () => {
  const by = Object.fromEntries(HOME_RECIPES.map(r => [r.id, r.cost]));
  assert.eq(JSON.stringify(by.spear), JSON.stringify([{ id: 'rockfruit', qty: 1 }, { id: 'wood', qty: 1 }]), 'spear');
  assert.falsy(by.torch, 'the torch is bought or found, never crafted (Oct 2026)');
  assert.eq(JSON.stringify(by.scarecrow), JSON.stringify([{ id: 'wood', qty: 3 }]), 'scarecrow');
  assert.eq(JSON.stringify(by.rope), JSON.stringify([{ id: 'longgrass', qty: 5 }]), 'rope from five long grass');
  assert.eq(JSON.stringify(by.trap_kit), JSON.stringify([{ id: 'rockfruit', qty: 4 }]), 'a disarm kit from four stones');
  assert.eq(JSON.stringify(by.honey), JSON.stringify([{ id: 'berry', qty: 2 }]), 'Syrup from two berries');
  assert.truthy(/wall/.test(ITEM_EFFECTS.rockfruit), 'stone hints at rebuilding');
  assert.truthy(/twist/.test(ITEM_EFFECTS.longgrass), 'grass hints at binding');
  for (const r of HOME_RECIPES) {
    assert.truthy(ITEM_BY_ID[r.id], `${r.id} is a real item`);
    for (const c of r.cost) assert.truthy(ITEM_BY_ID[c.id], `${c.id} is a real item`);
  }
});

test('home craft: recipeCap is the fewest times any ingredient covers its share', () => {
  const bag = { wood: 7, coal: 2 };
  const count = (id) => bag[id] || 0;
  assert.eq(recipeCap([{ id: 'wood', qty: 3 }], count), 2, '7 wood makes two 3-wood crafts');
  assert.eq(recipeCap([{ id: 'wood', qty: 1 }, { id: 'coal', qty: 1 }], count), 2, 'the scarcer one decides');
  assert.eq(recipeCap([{ id: 'ruby', qty: 1 }], count), 0, 'none held: none made');
  assert.eq(recipeCap([], count), 0, 'an empty recipe makes nothing, never Infinity');
});

test('home craft: crafting spends the wood and hands over the item', () => {
  const s = scene([['wood', 5], ['rockfruit', 2]]);
  s.save.foundWild = { scarecrow: 1 };
  s.presentHomeCraft(0, 0, 'scarecrow');
  const m = last(s);
  assert.eq(m.kind, 'craft', 'the Craft category');
  assert.eq(m.quantity.max, 1, 'five wood makes one 3-wood scarecrow');
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'wood'), 2, 'three wood spent');
  assert.eq(Inventory.count(s.save, 'scarecrow'), 1, 'one scarecrow made');
  s.presentHomeCraft(0, 0, 'spear');
  last(s).onAccept(2);
  assert.eq(Inventory.count(s.save, 'wood'), 0, 'a spear is one wood each');
  assert.eq(Inventory.count(s.save, 'rockfruit'), 0, 'and one stone each');
  assert.eq(Inventory.count(s.save, 'spear'), 2, 'two spears');
});

test('home craft: bag room caps the stepper and is rechecked before ingredients are spent', () => {
  const s = scene([['wood', 5], ['rockfruit', 5], ['spear', 8]]);
  s.presentHomeCraft(0, 0, 'spear');
  let m = last(s);
  assert.eq(m.quantity.max, 1, 'one open stack place permits one spear');
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'wood'), 4, 'one wood spent');
  assert.eq(Inventory.count(s.save, 'rockfruit'), 4, 'one stone spent');
  assert.eq(Inventory.count(s.save, 'spear'), 9, 'the last place filled');

  s.presentHomeCraft(0, 0, 'spear');
  m = last(s);
  assert.falsy(m.canAfford, 'a full output stack disables Craft');
  assert.eq(m.quantity, undefined, 'no quantity stepper when nothing fits');
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'wood'), 4, 'the full-bag recheck preserves ingredients');
  assert.eq(Inventory.count(s.save, 'spear'), 9, 'the full output stack stays unchanged');
  assert.truthy(/Bag full for Spear/.test(s.flashes.at(-1) || ''), `names the full stack: ${s.flashes.at(-1)}`);
});

test('home craft: short on wood, the page says so and nothing changes hands', () => {
  const s = scene([['wood', 2]]);
  s.save.foundWild = { scarecrow: 1 };
  s.presentHomeCraft(0, 0, 'scarecrow');
  const m = last(s);
  assert.falsy(m.canAfford, 'the Craft button is off');
  assert.eq(m.quantity, undefined, 'no stepper with nothing to make');
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'wood'), 2, 'the wood stays');
  assert.eq(Inventory.count(s.save, 'scarecrow'), 0, 'no scarecrow');
  assert.truthy(/Need 1 more Wood/.test(s.flashes[0] || ''), `names the shortfall: ${s.flashes[0]}`);
});

test('home craft: opens on something the bag can make, and the pager walks the recipes', () => {
  const s = scene([['wood', 1], ['rockfruit', 1]]);
  s.save.foundWild = Object.fromEntries(HOME_RECIPES.map(r => [r.id, 1]));
  s.presentHomeCraft(0, 0);
  const m = last(s);
  assert.truthy(m.canAfford, 'a wood and a stone: the page opens on the spear it can make');
  assert.eq(m.secondary, undefined, 'paging is the pager, not a second action button');
  assert.eq(m.pager.count, HOME_RECIPES.length, 'one page per recipe');
  m.pager.onNext();
  assert.falsy(last(s).canAfford, 'and the scarecrow page shows it cannot be made yet');
  last(s).pager.onPrev();
  assert.truthy(last(s).canAfford, '‹ goes back to the spear');
});

test('home craft: the Sell and Craft pages are tabs of one panel', () => {
  const s = scene([]);
  s.presentHomeCraft(0, 0);
  const tabs = last(s).tabs;
  assert.eq(tabs.map(t => t.label).join(','), 'Sell,Craft', 'two pages');
  assert.truthy(tabs[1].active && !tabs[0].active, 'Craft is the active page');
  tabs[0].onSelect();
  assert.truthy(last(s).sellPage, 'the Sell tab opens the Sell page');
});

test('home craft: Home routes a held stack to Sell and an empty hand to Craft', () => {
  const start = SCENE_SRC.indexOf('\n  shopInteract(sx, sy, house) {');
  const body = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(/if \(isHome\) \{\s*if \(hasSel\) this\.presentHomeSell\(sx, sy\);\s*else this\.presentHomeCraft\(sx, sy\);/.test(body),
    'shopInteract hands Home to its two pages');
});

test('home craft: every mode starts with only Spear and hides undiscovered recipes from both pager directions', () => {
  const was = Difficulty.mode();
  try {
    for (const mode of [Difficulty.EASY, Difficulty.HARD]) {
      Difficulty.setMode(mode);
      const s = scene([['rockfruit', 8], ['wood', 8], ['trap_kit', 1], ['berry', 8]]);
      s.presentHomeCraft(0, 0, 'trap_kit');
      let m = last(s);
      assert.includes(m.get, 'Spear', 'a locked target falls back to the known recipe');
      assert.eq(m.pager.count, 1);
      assert.falsy(/Trap Disarm Kit|Find a|locked/i.test(m.get + m.blurb));
      m.pager.onNext();
      assert.includes(last(s).get, 'Spear');
      last(s).pager.onPrev();
      assert.includes(last(s).get, 'Spear');
      s.save.foundWild = { trap_kit: 1 };
      s.presentHomeCraft(0, 0, 'trap_kit');
      m = last(s);
      assert.eq(m.pager.count, 2, 'a wild find exposes only its own recipe');
      assert.truthy(m.canAfford);
      m.onAccept(2);
      assert.eq(Inventory.count(s.save, 'trap_kit'), 3, 'two kits from eight stones');
      assert.eq(Inventory.count(s.save, 'rockfruit'), 0);
      m.pager.onNext();
      assert.includes(last(s).get, 'Spear', 'next skips still-locked recipes');
      last(s).pager.onPrev();
      assert.includes(last(s).get, 'Trap Disarm Kit');
    }
  } finally { Difficulty.setMode(was); }
});

test('home craft: learned Syrup consumes two berries per jar, rechecks ingredients and persists its unlock', () => {
  const s = scene([['berry', 5]]);
  s.save.foundWild = { honey: 1 };
  s.presentHomeCraft(0, 0, 'honey');
  const m = last(s);
  assert.eq(m.quantity.max, 2);
  m.onAccept(2);
  assert.eq(Inventory.count(s.save, 'berry'), 1);
  assert.eq(Inventory.count(s.save, 'honey'), 2);
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'berry'), 1, 'stale offer cannot spend missing ingredients');
  assert.eq(Inventory.count(s.save, 'honey'), 2);
  Inventory.remove(s.save, 'honey', 2);
  s.presentHomeCraft(0, 0, 'honey');
  assert.includes(last(s).get, itemName('honey'), 'learned recipe survives spending the item');
  assert.falsy(last(s).canAfford, 'ingredient shortages remain visible once learned');
});

test('home craft: the wild-finds ledger — every grant counts except bought, bartered, forged or crafted', () => {
  const add = SCENE_SRC.slice(SCENE_SRC.indexOf('\n  addToInv(id, n = 1, silent = false, opts = {}) {'));
  assert.truthy(/if \(!opts\.notWild\) \(this\.save\.foundWild = this\.save\.foundWild \|\| \{\}\)\[id\] = 1;/.test(add.slice(0, 3000)),
    'addToInv records the find');
  const notWild = (SCENE_SRC.match(/\{ notWild: true(?:, deferRefresh: true)? \}/g) || []).length;
  assert.eq(notWild, 10, 'the ten non-wild grants in app.js: craft, smelt, trader, stand, farmhand, two shop buys, a slot win, a potion transmuted in a campfire and its full-bag refund');
  assert.truthy(/addToInv\('scarecrow', 1, false, \{ notWild: true \}\)/.test(INTERACT_SRC), 'a reclaimed scarecrow is not a find');
});

})();
