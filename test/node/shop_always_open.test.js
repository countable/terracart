// No shop is ever "busy".
//
// The per-hour deal cap (ShopsMath.dealCap = 1 for a tier-9 house, and the
// readiness pip / busy plaque / "house busy — try again in 47m" tap that hung
// off it) was dropped in Sep 2026: a smithy, a trader, a storefront and the
// wizard's tower can all be used continuously. The clock's one remaining hold
// on a shop is the re-roll ladder easing a rung an hour (shops_math.test.js).
// A deal is still RECORDED against the house — the trader's stock turns over
// on it — which is why the ledger, and recordDeal, survive.
// app.js can't load headlessly, so shopInteract is lifted out of SCENE_SRC
// and run on a stub scene whose ledger already holds a heap of deals.

(function () {

const lift = (sig) => {
  const start = SCENE_SRC.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : SCENE_SRC.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${sig} in app.js`);
  return SCENE_SRC.slice(start + 1, end + 4);
};
const SHOP = (0, eval)('({\n' + lift('shopInteract(sx, sy, house) {') + '\n})');

function scene({ role = null, scarecrowShop = false, scarecrowUsed = true } = {}) {
  const calls = { flashes: [], delivery: 0, scarecrow: 0, themed: 0, trader: 0, smith: 0, records: [] };
  const save = { inv: [], selSlot: -1, scarecrowShopUsed: scarecrowUsed, shopState: {} };
  const s = Object.assign(Object.create(SHOP), {
    save,
    calls,
    isStarterShop: () => false,
    isStarterBlacksmith: () => false,
    isScarecrowShop: () => scarecrowShop,
    houseShopRole: () => role,
    shopCharmMul: () => 1,
    // The real ledger, not a stub: this is what recordDeal writes to.
    shopBucketState(h) { return ShopsMath.bucketState(save, h); },
    peekOrBuildRelicOffer: () => ({ kind: 'relic', slot: 'axe', tier: 2, price: 10 }),
    flash(t) { calls.flashes.push(t); },
    presentDeliveryOffer() { calls.delivery++; },
    presentScarecrowOffer(sx, sy, h, record) { calls.scarecrow++; calls.records.push(record); },
    presentThemedShop(sx, sy, h, record) { calls.themed++; calls.records.push(record); },
    presentTraderOffer(sx, sy, h, record) { calls.trader++; calls.records.push(record); },
    presentBlacksmithOffer(sx, sy, offer, record) { calls.smith++; calls.records.push(record); },
  });
  return s;
}
const HOUSE = { id: 'house_1_2_3_4', kind: 'house', tier: 9 };
const withDocument = (fn) => {
  const g = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try { fn(); } finally { globalThis.document = g; }
};

test('always open: a heap of deals this hour shuts no door', () => withDocument(() => {
  for (const [opts, key] of [
    [{ role: 'market' }, 'themed'],
    [{ role: 'trader' }, 'trader'],
    [{ role: 'blacksmith' }, 'smith'],
    [{ scarecrowShop: true, scarecrowUsed: false }, 'scarecrow'],
    [{}, 'delivery'],
  ]) {
    const s = scene(opts);
    ShopsMath.bucketState(s.save, HOUSE).deals = 25;
    s.shopInteract(0, 0, HOUSE);
    assert.eq(s.calls[key], 1, `${key}: opens on the 26th visit of the hour`);
    assert.eq(s.calls.flashes.length, 0, `${key}: and says nothing about being busy`);
  }
}));

test('always open: a deal is still recorded against the house (the trader turns its stock on it)', () => withDocument(() => {
  const s = scene({ role: 'trader' });
  s.shopInteract(0, 0, HOUSE);
  const record = s.calls.records[0];
  assert.eq(typeof record, 'function', 'the accept path is handed recordDeal');
  record(); record();
  assert.eq(ShopsMath.bucketState(s.save, HOUSE).deals, 2, 'each accepted deal is banked');
  // And the bank never feeds a refusal: tap again on top of it.
  s.shopInteract(0, 0, HOUSE);
  assert.eq(s.calls.trader, 2, 'the trader opens again at once');
}));

test('always open: nothing in the sources asks whether a shop is ready', () => {
  for (const [name, src] of [['app.js + scene mixins', SCENE_SRC], ['render.js', RENDER_SRC],
                             ['npc.js', ALL_SRC['npc.js']], ['shops_math.js', DURATION_SOURCES['shops_math.js']]]) {
    assert.falsy(/shopReadiness|shopDealCap|dealCap|shopReadyPool|shopWaitLabel|msToNextBucket/.test(src),
      `${name}: no readiness, cap, plaque or wait left`);
  }
  assert.falsy(/finished trading for now/.test(ALL_SRC['npc.js']), 'the peddler never turns a visitor away');
});

})();
