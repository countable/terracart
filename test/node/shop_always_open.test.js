// No shop is rationed by the hour; the trader alone takes a short breather.
//
// The per-hour deal cap (ShopsMath.dealCap = 1 for a tier-9 house, and the
// readiness pip / busy plaque / "house busy — try again in 47m" tap that hung
// off it) was dropped in Sep 2026: a smithy, a trader, a storefront and the
// wizard's tower can all be used continuously. The clock's holds on a shop
// are the re-roll ladder easing a rung an hour, and — restored Oct 2026 —
// a SHORT cooldown after a closed deal for the roles in
// ShopsMath.DEAL_COOLDOWN_MS (the trader: shops_math.test.js). A deal is
// RECORDED against the house (ShopsMath.recordDeal) — the trader's stock
// turns over on it and its cooldown runs from it.
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

function scene({ role = null } = {}) {
  const calls = { flashes: [], delivery: 0, themed: 0, trader: 0, smith: 0, records: [] };
  const save = { inv: [], selSlot: -1, shopState: {} };
  const s = Object.assign(Object.create(SHOP), {
    save,
    calls,
    isStarterShop: () => false,
    isStarterBlacksmith: () => false,
    houseShopRole: () => role,
    shopCharmMul: () => 1,
    // The real ledger, not a stub: this is what recordDeal writes to.
    shopBucketState(h) { return ShopsMath.bucketState(save, h); },
    peekOrBuildRelicOffer: () => ({ kind: 'relic', slot: 'axe', tier: 2, price: 10 }),
    flash(t) { calls.flashes.push(t); },
    presentDeliveryOffer() { calls.delivery++; },
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

test('restored starter smith: keeps its pair and advances to the regular forge', () => withDocument(() => {
  const s = scene({ role: 'blacksmith' });
  const methods = ['starterSmithSlots()', 'starterBlacksmithOffer()', 'starterBlacksmithRecipe(slot)'];
  Object.assign(s, (0, eval)('({\n' + methods.map(sig => lift(sig + ' {')).join(',\n') + '\n})'));
  s.isStarterBlacksmith = h => Houses.isStarterBlacksmith(s.save, h);
  s.houseShopRole = h => Houses.houseShopRole(s.save, h);
  Houses.restoreAs(s.save, { ...HOUSE, id: 'first-home' }, 'plain');
  Houses.restoreAs(s.save, HOUSE, 'blacksmith:1');
  const offers = [];
  s.presentBlacksmithOffer = (sx, sy, offer, record, house, opts) => offers.push({ offer, opts });

  s.shopInteract(0, 0, HOUSE);
  const pair = s.save.starterSmithSlots;
  assert.eq(pair.length, 2);
  assert.eq(new Set(pair).size, 2, 'two distinct tools');
  for (const slot of pair) assert.includes(STARTER_SMITH_SLOTS, slot);
  assert.eq(offers[0].offer.slot, pair[0]);
  assert.eq(offers[0].offer.tier, 1);
  assert.eq(JSON.stringify(offers[0].opts.recipe), JSON.stringify([{ id: 'wood', qty: 5 }]));
  assert.truthy(offers[0].opts.noReroll);

  s.save = JSON.parse(JSON.stringify(s.save));
  s.shopInteract(0, 0, HOUSE);
  assert.eq(offers[1].offer.slot, pair[0], 'reload keeps the first offer');
  assert.eq(JSON.stringify(s.save.starterSmithSlots), JSON.stringify(pair));
  s.save.relics = { [pair[0]]: { tier: 1 } };
  s.shopInteract(0, 0, HOUSE);
  assert.eq(offers[2].offer.slot, pair[1], 'owning the first advances to the second');
  s.save.relics[pair[1]] = { tier: 3 };
  s.shopInteract(0, 0, HOUSE);
  assert.eq(offers[3].offer.tier, 2, 'both owned falls through to the regular forge');
  assert.eq(offers[3].opts, undefined, 'regular forge has no starter override');
}));

test('always open: a heap of deals this hour shuts no door', () => withDocument(() => {
  for (const [opts, key] of [
    [{ role: 'market' }, 'themed'],
    [{ role: 'trader' }, 'trader'],
    [{ role: 'blacksmith' }, 'smith'],
    [{}, 'delivery'],
  ]) {
    const s = scene(opts);
    ShopsMath.bucketState(s.save, HOUSE).deals = 25;
    s.shopInteract(0, 0, HOUSE);
    assert.eq(s.calls[key], 1, `${key}: opens on the 26th visit of the hour`);
    assert.eq(s.calls.flashes.length, 0, `${key}: and says nothing about being busy`);
  }
}));

test('always open: a deal is recorded against the house, and a cash shop reopens on it at once', () => withDocument(() => {
  const s = scene({ role: 'market' });
  s.shopInteract(0, 0, HOUSE);
  const record = s.calls.records[0];
  assert.eq(typeof record, 'function', 'the accept path is handed recordDeal');
  record(); record();
  const cur = ShopsMath.bucketState(s.save, HOUSE);
  assert.eq(cur.deals, 2, 'each accepted deal is banked');
  assert.truthy(cur.dealAt > 0, 'with the moment it closed');
  // No cooldown row for a market: the bank never feeds a refusal.
  s.shopInteract(0, 0, HOUSE);
  assert.eq(s.calls.themed, 2, 'the storefront opens again at once');
  assert.eq(s.calls.flashes.length, 0);
}));

test('trader cooldown: a closed barter shuts the trader briefly, with the wait printed', () => withDocument(() => {
  const s = scene({ role: 'trader' });
  s.shopInteract(0, 0, HOUSE);
  assert.eq(s.calls.trader, 1, 'opens the first time');
  s.calls.records[0]();
  s.shopInteract(0, 0, HOUSE);
  assert.eq(s.calls.trader, 1, 'a tap right after the deal does not reopen');
  assert.eq(s.calls.flashes.length, 1, 'it is refused once, aloud');
  const line = s.calls.flashes[0];
  assert.truthy(/^trader busy — back in \d+[smhd]$/.test(line), `the wait is in the shared notation: "${line}"`);
  assert.truthy([...line].length <= MAP_MSG_MAX, 'and fits a map line');
  // Deals banked earlier than the row never shut the door (the count is not
  // the gate; the stamp is).
  const cur = ShopsMath.bucketState(s.save, HOUSE);
  cur.dealAt = Date.now() - ShopsMath.DEAL_COOLDOWN_MS.trader;
  s.shopInteract(0, 0, HOUSE);
  assert.eq(s.calls.trader, 2, 'open again once the cooldown has run');
  assert.eq(s.calls.flashes.length, 1, 'with nothing more said');
}));

test('trader cooldown: both dispatchers read the one table, and the peddler speaks the same wait', () => {
  // The house tap and the peddler each ask ShopsMath.dealWaitMs with the ROLE
  // — never a literal number, never a ledger of their own — and bank through
  // ShopsMath.recordDeal.
  assert.truthy(/ShopsMath\.dealWaitMs\(this\.save, house, shopType\)/.test(SCENE_SRC), 'shopInteract asks by role');
  assert.truthy(/ShopsMath\.dealWaitMs\(scene\.save, c, c\.role\)/.test(ALL_SRC['npc.js']), 'the peddler asks by role');
  assert.truthy(/ShopsMath\.recordDeal\(this\.save, house\)/.test(SCENE_SRC), 'shopInteract banks through recordDeal');
  assert.truthy(/ShopsMath\.recordDeal\(scene\.save, c\)/.test(ALL_SRC['npc.js']), 'the peddler banks through recordDeal');
  assert.falsy(/\.deals \+= 1/.test(ALL_SRC['npc.js']), 'no private deal ledger in npc.js');
  // The flash formats through shortDuration; the character SAYS it through
  // spokenDuration (CLAUDE.md: a wait a character says uses the spoken ladder).
  assert.truthy(/busy — back in \$\{shortDuration\(dealWait\)\}/.test(SCENE_SRC), 'the tap prints shortDuration');
  assert.truthy(/Come back in \$\{spokenDuration\(dealWait\)\}/.test(ALL_SRC['npc.js']), 'the peddler says spokenDuration');
});

test('always open: nothing in the sources asks whether a shop is ready', () => {
  for (const [name, src] of [['app.js + scene mixins', SCENE_SRC], ['render.js', RENDER_SRC],
                             ['npc.js', ALL_SRC['npc.js']], ['shops_math.js', DURATION_SOURCES['shops_math.js']]]) {
    assert.falsy(/shopReadiness|shopDealCap|dealCap|shopReadyPool|shopWaitLabel|msToNextBucket/.test(src),
      `${name}: no readiness, cap, plaque or hourly wait left`);
  }
  assert.falsy(/finished trading for now/.test(ALL_SRC['npc.js']), 'the peddler never shuts for the hour');
});

})();
