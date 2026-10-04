(function () {
const lift = sig => {
  const a = SCENE_SRC.indexOf('\n  ' + sig);
  return SCENE_SRC.slice(a + 1, SCENE_SRC.indexOf('\n  }\n', a) + 4);
};
const methods = (0, eval)('({' + [
  'presentHomeSell(sx, sy, targetId = null) {', '_firstSaleStory() {',
  '_storySplashOnce(key, { art, title, body, okLabel, onDismiss } = {}) {',
  '_enqueueCeremony(kind, open, { key, hold, defer = false } = {}) {', '_drainCeremonies() {', '_dialogOpen() {',
].map(lift).join(',') + '})');
function saleTest(fn) {
  const old = document.body;
  let busy = false;
  document.body = { classList: { contains: () => busy } };
  const s = makeScene({ ...methods, save: { inv: [{ id: 'rubble', count: 3 }], selSlot: 0, money: 0, relics: {} },
    modals: [], _homeTabs: () => [], _homeKindIcon: () => undefined,
    moneyHTML: String, _clampSelSlot() {}, _finishInventoryChange() {},
    questEvent() {}, showOfferModal(o) { this.offer = o; }, showMessageModal(o) { this.modals.push(o); },
  });
  try { fn(s, v => { busy = v; }); } finally { document.body = old; }
}
test('first sale: only a completed sale opens its exact story, once per save', () => saleTest(s => {
  s.presentHomeSell(0, 0);
  assert.eq(s.modals.length, 0, 'opening or dismissing the offer is not a sale');
  s.offer.onAccept(1);
  assert.eq(Inventory.count(s.save, 'rubble'), 2);
  assert.gt(s.save.money, 0);
  assert.eq(s.modals[0].art, 'first_sale');
  assert.eq(s.modals[0].body, "The neighbours offer to buy your fine wares for some 'green'.");
  assert.truthy(s.save.storySeen['sale:first']);
  s.presentHomeSell(0, 0); s.offer.onAccept(1);
  assert.eq(s.modals.length, 1);
}));
test('first sale: empty bag or vanished stock cannot consume the story', () => saleTest(s => {
  s.presentHomeSell(0, 0);
  Inventory.remove(s.save, 'rubble', 3);
  s.offer.onAccept(1);
  assert.falsy(s.save.firstSalePending);
  assert.eq(s.modals.length, 0);
  s.save.inv = []; s.presentHomeSell(0, 0); s.offer.onAccept();
  assert.eq(s.modals.length, 0);
  assert.falsy(s.save.storySeen);
}));
test('first sale: a busy quest dialog defers the earned story and survives reload', () => saleTest((s, busy) => {
  s.questEvent = () => busy(true);
  s.presentHomeSell(0, 0); s.offer.onAccept(1);
  assert.eq(s.modals.length, 0);
  assert.truthy(s.save.firstSalePending);
  assert.falsy(s.save.storySeen?.['sale:first']);
  s.save = JSON.parse(JSON.stringify(s.save));
  busy(false); s._firstSaleStory();   // the modal pass: queued once, opened when the screen clears
  assert.eq(s.modals.length, 1);
  assert.falsy(s.save.firstSalePending);
  assert.truthy(/this\._lowHealthStory\(\);\s*this\._firstSaleStory\(\)/.test(SCENE_SRC), 'the modal pass retries it');
}));
test('home sell: each tap sells one and the empty page never switches to another stack', () => saleTest(s => {
  s.save.inv = [{ id: 'rubble', count: 2 }, { id: 'wood', count: 4 }];
  s.presentHomeSell(0, 0);
  assert.eq(s.offer.quantity, undefined, 'no quantity counter');
  assert.eq(s.offer.cancelLabel, 'Leave');
  s.offer.onAccept();
  assert.eq(Inventory.count(s.save, 'rubble'), 1, 'one item per tap');
  s.offer.repeat();
  assert.truthy(s.offer.canAfford, 'the next sale stays available');
  s.offer.onAccept();
  s.offer.repeat();
  assert.falsy(s.offer.canAfford, 'the depleted stack disables Sell');
  assert.eq(s.offer.cancelLabel, 'Leave', 'the player chooses when to exit');
  s.offer.onAccept();
  assert.eq(Inventory.count(s.save, 'wood'), 4, 'the neighboring stack stays untouched');
}));
})();
