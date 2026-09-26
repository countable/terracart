// Home's Craft page — the trailer panel's second tab beside Sell (app.js
// presentHomeSell / presentHomeCraft, recipes in items.js HOME_RECIPES).
// app.js can't load headlessly, so the page methods are lifted out of
// APP_JS_SRC and run for real on a stub scene; the routing is pinned as
// source text.

(function () {

const lift = (sig) => {
  const start = APP_JS_SRC.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : APP_JS_SRC.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${sig} in app.js`);
  return APP_JS_SRC.slice(start + 1, end + 4);
};
const HOME = (0, eval)('({\n' + [
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
    addToInv(id, n) { Inventory.add(this.save, id, n); },
    iconSpanHTML: () => '', worldIconHTML: () => '',
    buildInventoryDOM() {}, _clampSelSlot() {},
    presentHomeSell() { this.modals.push({ sellPage: true }); },
  });
  return s;
}
const last = (s) => s.modals[s.modals.length - 1];

test('home craft: the recipes are a Torch from 1 wood, a Scarecrow from 3, a Rope from 3 long grass', () => {
  const by = Object.fromEntries(HOME_RECIPES.map(r => [r.id, r.cost]));
  assert.eq(JSON.stringify(by.torch), JSON.stringify([{ id: 'wood', qty: 1 }]), 'torch');
  assert.eq(JSON.stringify(by.scarecrow), JSON.stringify([{ id: 'wood', qty: 3 }]), 'scarecrow');
  assert.eq(JSON.stringify(by.rope), JSON.stringify([{ id: 'longgrass', qty: 3 }]), 'rope from three long grass');
  assert.eq(JSON.stringify(by.trap_kit), JSON.stringify([{ id: 'rockfruit', qty: 4 }]), 'a disarm kit from four stones');
  assert.truthy(/Trap Disarm Kit/.test(ITEM_EFFECTS.rockfruit || ''), 'the stone line names the recipe');
  assert.truthy(/Rope/.test(ITEM_EFFECTS.longgrass || ''), 'the long grass line names the recipe');
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
  const s = scene([['wood', 5]]);
  s.presentHomeCraft(0, 0, 'scarecrow');
  const m = last(s);
  assert.eq(m.kind, 'craft', 'the Craft category');
  assert.eq(m.quantity.max, 1, 'five wood makes one 3-wood scarecrow');
  m.onAccept(1);
  assert.eq(Inventory.count(s.save, 'wood'), 2, 'three wood spent');
  assert.eq(Inventory.count(s.save, 'scarecrow'), 1, 'one scarecrow made');
  s.presentHomeCraft(0, 0, 'torch');
  last(s).onAccept(2);
  assert.eq(Inventory.count(s.save, 'wood'), 0, 'a torch is one wood each');
  assert.eq(Inventory.count(s.save, 'torch'), 2, 'two torches');
});

test('home craft: short on wood, the page says so and nothing changes hands', () => {
  const s = scene([['wood', 2]]);
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
  const s = scene([['wood', 1]]);
  s.presentHomeCraft(0, 0);
  const m = last(s);
  assert.truthy(m.canAfford, 'one wood: the page opens on the torch it can make');
  assert.eq(m.secondary, undefined, 'paging is the pager, not a second action button');
  assert.eq(m.pager.count, HOME_RECIPES.length, 'one page per recipe');
  m.pager.onNext();
  assert.falsy(last(s).canAfford, 'and the scarecrow page shows it cannot be made yet');
  last(s).pager.onPrev();
  assert.truthy(last(s).canAfford, '‹ goes back to the torch');
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
  const start = APP_JS_SRC.indexOf('\n  shopInteract(sx, sy, house) {');
  const body = APP_JS_SRC.slice(start, APP_JS_SRC.indexOf('\n  }\n', start));
  assert.truthy(/if \(isHome\) \{\s*if \(hasSel\) this\.presentHomeSell\(sx, sy\);\s*else this\.presentHomeCraft\(sx, sy\);/.test(body),
    'shopInteract hands Home to its two pages');
});

test('home craft: on hard a recipe stays locked until its item is found in the wild', () => {
  const was = Difficulty.mode();
  try {
    Difficulty.setMode(Difficulty.HARD);
    const s = scene([['rockfruit', 8]]);
    s.presentHomeCraft(0, 0, 'trap_kit');
    let m = last(s);
    assert.falsy(m.canAfford, 'locked: the Craft button is off even with the stones');
    assert.truthy(/Find a Trap Disarm Kit/.test(m.blurb || ''), `the page says how to unlock: ${m.blurb}`);
    m.onAccept(1);
    assert.eq(Inventory.count(s.save, 'trap_kit'), 0, 'nothing crafted');
    s.save.foundWild = { trap_kit: 1 };
    s.presentHomeCraft(0, 0, 'trap_kit');
    m = last(s);
    assert.truthy(m.canAfford, 'found once — now it can be made');
    m.onAccept(2);
    assert.eq(Inventory.count(s.save, 'trap_kit'), 2, 'two kits from eight stones');
    Difficulty.setMode(Difficulty.EASY);
    const e = scene([['rockfruit', 4]]);
    e.presentHomeCraft(0, 0, 'trap_kit');
    assert.truthy(last(e).canAfford, 'easy crafts from the start');
  } finally { Difficulty.setMode(was); }
});

test('home craft: the wild-finds ledger — every grant counts except bought, bartered, forged or crafted', () => {
  const add = APP_JS_SRC.slice(APP_JS_SRC.indexOf('\n  addToInv(id, n = 1, silent = false, opts = {}) {'));
  assert.truthy(/if \(!opts\.notWild\) \(this\.save\.foundWild = this\.save\.foundWild \|\| \{\}\)\[id\] = 1;/.test(add.slice(0, 3000)),
    'addToInv records the find');
  const notWild = (APP_JS_SRC.match(/\{ notWild: true \}/g) || []).length;
  assert.eq(notWild, 10, 'the ten non-wild grants in app.js: craft, smelt, trader, stand, farmhand, two shop buys, a slot win, a potion transmuted in a campfire and its full-bag refund');
  assert.truthy(/addToInv\('scarecrow', 1, false, \{ notWild: true \}\)/.test(INTERACT_SRC), 'a reclaimed scarecrow is not a find');
});

})();
