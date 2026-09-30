// A delivery house is never "busy".
//
// Plain houses (no shop role) take ONE delivery ever (Delivery.isSatisfied),
// and render.js draws their wishlist in place of the open/busy plaque. The
// hourly deal cap (ShopsMath.dealCap = 1 for a tier-9 house) is a SHOP's
// ration, so the tap must not apply it to a host: the house past the starter
// smithy sells its one scarecrow (recordDeal banks a deal), reverts to a
// delivery host asking for potatoes, and used to answer the potato tap with
// "house busy — try again in 47m" under a live wishlist.
// app.js can't load headlessly, so shopInteract is lifted out of SCENE_SRC
// and run on a stub scene with the hourly bucket already spent.

(function () {

const lift = (sig) => {
  const start = SCENE_SRC.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : SCENE_SRC.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${sig} in app.js`);
  return SCENE_SRC.slice(start + 1, end + 4);
};
const SHOP = (0, eval)('({\n' + lift('shopInteract(sx, sy, house) {') + '\n})');

function scene({ role = null, scarecrowShop = false, scarecrowUsed = true } = {}) {
  const calls = { flashes: [], delivery: 0, scarecrow: 0, themed: 0 };
  const s = Object.assign(Object.create(SHOP), {
    save: { inv: [], selSlot: -1, scarecrowShopUsed: scarecrowUsed },
    calls,
    isStarterShop: () => false,
    isStarterBlacksmith: () => false,
    isScarecrowShop: () => scarecrowShop,
    houseShopRole: () => role,
    // The bucket is spent: one deal already banked this hour.
    shopReadiness: () => ({ dealCap: 1, ready: false, waitMs: 47 * 60 * 1000 }),
    shopCharmMul: () => 1,
    flash(t) { calls.flashes.push(t); },
    presentDeliveryOffer() { calls.delivery++; },
    presentScarecrowOffer() { calls.scarecrow++; },
    presentThemedShop() { calls.themed++; },
  });
  return s;
}
const HOUSE = { id: 'house_1_2_3_4', kind: 'house', tier: 9 };

test('delivery busy: a spent hour does not shut a delivery host', () => {
  const g = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const s = scene();
    s.shopInteract(0, 0, HOUSE);
    assert.eq(s.calls.delivery, 1, 'the potato ask opens');
    assert.eq(s.calls.flashes.length, 0, 'no busy flash');
  } finally { globalThis.document = g; }
});

test('delivery busy: a real storefront still rations its deals', () => {
  const g = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const shop = scene({ role: 'market' });
    shop.shopInteract(0, 0, HOUSE);
    assert.eq(shop.calls.themed, 0, 'the market stays shut');
    assert.truthy(/house busy/.test(shop.calls.flashes[0] || ''), 'and says so');
    const crow = scene({ scarecrowShop: true, scarecrowUsed: false });
    crow.shopInteract(0, 0, HOUSE);
    assert.eq(crow.calls.scarecrow, 0, 'the one-off scarecrow shop is still a shop');
    assert.truthy(/house busy/.test(crow.calls.flashes[0] || ''), 'and says so');
  } finally { globalThis.document = g; }
});

})();
