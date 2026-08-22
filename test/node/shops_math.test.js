// Headless tests for the shop scheduling + pricing core (src/shops_math.js).

const HOUR = ShopsMath.HOUR;

test('bucketOffset: deterministic per id, in [0, 1h)', () => {
  const a = ShopsMath.bucketOffset('house-7');
  assert.eq(a, ShopsMath.bucketOffset('house-7'), 'stable for an id');
  assert.inRange(a, 0, HOUR - 1, 'within the hour');
  assert.truthy(ShopsMath.bucketOffset('house-7') !== ShopsMath.bucketOffset('house-8'), 'differs by id (usually)');
});

test('bucket: advances by one each hour; the offset shifts the boundary', () => {
  const id = 'h';
  const off = ShopsMath.bucketOffset(id);
  const b0 = ShopsMath.bucket(id, 0);
  assert.eq(ShopsMath.bucket(id, HOUR), b0 + 1, 'one hour later → next bucket');
  // Just before this house's bucket boundary vs just after.
  const boundary = HOUR - off;            // (now + off) crosses a multiple of HOUR here
  assert.eq(ShopsMath.bucket(id, boundary - 1), b0);
  assert.eq(ShopsMath.bucket(id, boundary), b0 + 1, 'rotates at the staggered boundary');
});

test('dealCap: castle/tower & starter-blacksmith infinite; fort 5; house 1', () => {
  assert.eq(ShopsMath.dealCap(null), Infinity, 'no house = infinite');
  assert.eq(ShopsMath.dealCap({ kind: 'tower' }), Infinity, 'tower');
  assert.eq(ShopsMath.dealCap({ tier: 12 }), Infinity, 'castle (tier 12)');
  assert.eq(ShopsMath.dealCap({ tier: 9 }, true), Infinity, 'starter blacksmith flag');
  assert.eq(ShopsMath.dealCap({ tier: 11 }), 5, 'fort');
  assert.eq(ShopsMath.dealCap({ tier: 9 }), 1, 'small house');
});

test('bucketState: creates a record and GCs a stale-bucket predecessor', () => {
  const save = {};
  const house = { id: 'shopA' };
  const cur = ShopsMath.bucketState(save, house, 0);
  assert.eq(cur.deals, 0);
  assert.eq(cur.rerolls, 0);
  assert.eq(save.shopState.shopA, cur, 'persisted under the id');
  cur.deals = 3;
  // Same hour → same record (deals preserved).
  assert.eq(ShopsMath.bucketState(save, house, HOUR / 4).deals, 3, 'same bucket keeps deals');
  // Next hour → fresh record (deals reset).
  const next = ShopsMath.bucketState(save, house, HOUR * 2);
  assert.eq(next.deals, 0, 'stale bucket GC’d → deals reset');
});

test('readiness: ready until the cap, then reports a positive waitMin', () => {
  const save = {};
  const fort = { id: 'fortB', tier: 11 };
  const cap = ShopsMath.dealCap(fort);           // 5
  let r = ShopsMath.readiness(save, fort, cap, 0);
  assert.eq(r.ready, true, 'fresh bucket is ready');
  assert.eq(r.waitMin, 0);
  ShopsMath.bucketState(save, fort, 0).deals = cap;   // hit the cap
  r = ShopsMath.readiness(save, fort, cap, 0);
  assert.eq(r.ready, false, 'capped → not ready');
  assert.gt(r.waitMin, 0, 'reports minutes until the next bucket');
  // Infinite-cap shops are always ready.
  assert.eq(ShopsMath.readiness(save, { id: 't', kind: 'tower' }, Infinity, 0).ready, true);
});

test('rng: deterministic per (id, bucket, salt, lane); lane + rerolls vary it', () => {
  const save = { offerSalt: 12345 };
  const house = { id: 'shopC' };
  const seq = (lane, now) => { const f = ShopsMath.rng(save, house, lane, now); return [f(), f(), f()]; };
  // Reset shopState between identical calls so the bucket record matches.
  delete save.shopState;
  const a = seq('price', 0);
  delete save.shopState;
  const b = seq('price', 0);
  assert.eq(JSON.stringify(a), JSON.stringify(b), 'stable for same inputs');
  delete save.shopState;
  const other = seq('pool', 0);
  assert.truthy(JSON.stringify(a) !== JSON.stringify(other), 'lane namespaces the stream');
  for (const v of a) assert.inRange(v, 0, 1, 'rng in [0,1)');
  // A re-roll (bumped rerolls) pivots the stream.
  save.shopState = { shopC: { bucket: ShopsMath.bucket('shopC', 0), deals: 0, rerolls: 1 } };
  const rerolled = ShopsMath.rng(save, house, 'price', 0)();
  assert.truthy(rerolled !== a[0], 're-roll changes the offer');
});

test('buyPrice: within the markup band; a maxed Bow collapses it toward par', () => {
  const plain = { relics: {} };
  for (let s = 0; s < 50; s++) {
    const p = ShopsMath.buyPrice(plain, 100, () => Math.random());
    assert.inRange(p, Math.ceil(100 * 1.2), Math.ceil(100 * 3.0), 'within 1.2..3.0×');
  }
  // Bow T7 → flat 1.0× → price == baseValue regardless of the roll.
  const bowed = { relics: { bow: { tier: 7 } } };
  assert.eq(ShopsMath.buyPrice(bowed, 100, () => 0), 100, 'par at low roll');
  assert.eq(ShopsMath.buyPrice(bowed, 100, () => 0.999), 100, 'par at high roll too');
});

// ── Stand pricing: cheaper than par, never an arbitrage pump ───────────────
// The whole point of the stand discount is that it has a ceiling it can never
// cross. The sell side is player-scaled (the Sword relic takes selling from
// 0.5× base to 1.0× at tier 7), so a FLAT discount would become free money as
// soon as the player's sword outran it. These tests pin both halves: that a
// stand really is cheaper, and that buying at one and selling it back can
// never turn a profit — for every item in the game, at every sword tier.

// What the player actually receives for one unit, exactly as app.js computes
// it in the sell-from-stash flow: base × sellMultiplier, ceil, floored at $1.
const sellGain = (base, relics) =>
  Math.max(1, Math.ceil(base * sellMultiplier(relics)));

const swords = [0, 1, 2, 3, 4, 5, 6, 7];

test('standPrice: undercuts par for a player with no sword', () => {
  const save = { relics: {} };
  // Coffee is the motivating case — a $40 cup charged at full list price.
  assert.eq(ShopsMath.standPrice(save, 40), 30, 'coffee: $40 list → $30 at a stand');
  assert.eq(ShopsMath.standBuyMul({}), 0.75, '25% off par at the sell floor');
});

test('standPrice: the discount shrinks as the sword grows, and stops at par', () => {
  const mul = (t) => ShopsMath.standBuyMul({ sword: { tier: t } });
  assert.eq(mul(0), 0.75, 'no sword → the full discount');
  assert.truthy(mul(4) > mul(0), 'a mid sword narrows the discount');
  assert.truthy(mul(7) >= mul(4), 'and it keeps narrowing');
  assert.eq(mul(7), 1, 'tier 7 → par, never above the listed price');
  for (const t of swords) {
    assert.inRange(mul(t), 0.75, 1, `tier ${t} stays between the floor and par`);
  }
});

test('standPrice: monotonic in the sword tier (no dips a player could exploit)', () => {
  let prev = -Infinity;
  for (const t of swords) {
    const m = ShopsMath.standBuyMul({ sword: { tier: t } });
    assert.gte(m, prev, `tier ${t} never cheaper than tier ${t - 1}`);
    prev = m;
  }
});

test('standPrice: NO ARBITRAGE — buy at a stand, sell it back, never profit', () => {
  // Every real item price in the game, not a sample: the rounding is where a
  // one-dollar leak would hide, and cheap items are the risky ones.
  const bases = Object.values(PRICES).filter((v) => Number.isFinite(v) && v > 0);
  assert.gt(bases.length, 50, 'PRICES really loaded (guard against a vacuous pass)');
  const leaks = [];
  for (const t of swords) {
    const relics = { sword: { tier: t } };
    const save = { relics };
    for (const base of bases) {
      const pay  = ShopsMath.standPrice(save, base);
      const back = sellGain(base, relics);
      if (back > pay) leaks.push(`sword T${t}, base $${base}: pay $${pay}, sells back for $${back}`);
    }
  }
  assert.eq(leaks.length, 0, 'stand→sell must never pay out: ' + leaks.slice(0, 5).join('; '));
});

test('standPrice: no arbitrage at $1–$500 either, including odd values', () => {
  const leaks = [];
  for (const t of swords) {
    const relics = { sword: { tier: t } };
    for (let base = 1; base <= 500; base++) {
      const pay  = ShopsMath.standPrice({ relics }, base);
      const back = sellGain(base, relics);
      if (back > pay) leaks.push(`sword T${t}, base $${base}: pay $${pay}, back $${back}`);
    }
  }
  assert.eq(leaks.length, 0, 'exhaustive sweep found a leak: ' + leaks.slice(0, 5).join('; '));
});

test('standPrice: still cheaper than the village-shop markup it replaces', () => {
  // buyPrice's floor is 1.2× base without a Bow; a stand must beat that or the
  // discount is pointless. Compared at the markup's cheapest possible roll.
  const save = { relics: {} };
  const cheapestShop = ShopsMath.buyPrice(save, 40, () => 0);   // r()=0 → the lo end
  assert.gt(cheapestShop, ShopsMath.standPrice(save, 40), 'a stand beats the best shop roll');
});

test('standPrice: floors at $1 and never returns a fractional price', () => {
  for (const t of swords) {
    const save = { relics: { sword: { tier: t } } };
    for (const base of [1, 2, 3, 7]) {
      const p = ShopsMath.standPrice(save, base);
      assert.gte(p, 1, 'at least $1');
      assert.eq(p, Math.round(p), 'whole dollars');
    }
  }
});

// ── Reopening a shop must not re-roll what it sells ────────────────────────
// The bug: a fort's offer had two unseeded Math.random() calls behind it — the
// 10% "sell a relic instead" coin, and the 1.2×–3.0× cash markup. Both sat in
// the tap handler, so closing and reopening the modal re-rolled them: the
// player could reopen a fort until it offered a relic, then reopen until the
// price came up cheap. Everything else about the offer was already derived
// from the hour bucket, which is what shops_math promises at the top of the
// file — "the same shop in the same hour shows the same offer".
//
// These model an OPEN as "derive the offer from the seeded lanes", the way
// shopInteract now does, and deliberately do NOT reset save.shopState between
// opens — persisting it is exactly what the real flow does.

// One "open" of a cash storefront: the relic-swap coin and the marked-up price.
function openShop(save, house, now) {
  return {
    swap: ShopsMath.rng(save, house, 'relicswap', now)() < 0.10,
    price: ShopsMath.buyPrice(save, 100, ShopsMath.rng(save, house, 'price', now)),
  };
}

test('shop offer: reopening within the hour re-derives the identical offer', () => {
  const save = { offerSalt: 7, relics: {} };
  const fort = { id: 'h_4343959_8778563', kind: 'house', tier: 11 };
  const first = openShop(save, fort, 0);
  for (let open = 0; open < 25; open++) {
    const again = openShop(save, fort, 0);
    assert.eq(again.swap, first.swap, `open ${open}: relic-swap coin must not re-roll`);
    assert.eq(again.price, first.price, `open ${open}: price must not re-roll`);
  }
});

test('shop offer: it still holds as the hour advances, and turns over at the bucket', () => {
  const save = { offerSalt: 7, relics: {} };
  const fort = { id: 'fort-A', kind: 'house', tier: 11 };
  const off = ShopsMath.bucketOffset(fort.id);
  const bucketEnd = HOUR - off;                  // this shop's own rotation moment
  const first = openShop(save, fort, 0);
  // Anywhere inside the bucket, the offer is the same one.
  for (const t of [1, 1000, Math.floor(bucketEnd / 2), bucketEnd - 1]) {
    const mid = openShop(save, fort, t);
    assert.eq(mid.swap, first.swap, `t=${t}: same offer inside the hour`);
    assert.eq(mid.price, first.price, `t=${t}: same price inside the hour`);
  }
  // Over the boundary it is allowed to change — and for this shop it does.
  const next = openShop(save, fort, bucketEnd);
  assert.truthy(next.price !== first.price || next.swap !== first.swap,
    'the offer turns over at the hour boundary');
});

test('shop offer: spending a fort\'s 5 deals does not reshuffle the offer', () => {
  // A fort allows 5 deals an hour. Recording a deal bumps cur.deals, which must
  // not feed the offer seed — otherwise buying once would re-roll the rest.
  const save = { offerSalt: 3, relics: {} };
  const fort = { id: 'fort-B', kind: 'house', tier: 11 };
  const first = openShop(save, fort, 0);
  for (let deal = 1; deal <= ShopsMath.dealCap(fort); deal++) {
    ShopsMath.bucketState(save, fort, 0).deals = deal;
    const after = openShop(save, fort, 0);
    assert.eq(after.swap, first.swap, `after ${deal} deals: swap unchanged`);
    assert.eq(after.price, first.price, `after ${deal} deals: price unchanged`);
  }
});

test('shop offer: two forts in the same hour make their own independent offers', () => {
  // Stability must come from the seed, not from the offer being constant.
  const save = { offerSalt: 11, relics: {} };
  const prices = new Set();
  for (let i = 0; i < 12; i++) {
    prices.add(openShop(save, { id: 'fort-' + i, kind: 'house', tier: 11 }, 0).price);
  }
  assert.gt(prices.size, 1, 'different shops price the same item differently');
});

test('shop offer: a paid re-roll is still the one thing that CAN change it', () => {
  const save = { offerSalt: 5, relics: {} };
  const fort = { id: 'fort-C', kind: 'house', tier: 11 };
  const first = openShop(save, fort, 0);
  ShopsMath.bucketState(save, fort, 0).rerolls += 1;
  const rerolled = openShop(save, fort, 0);
  assert.truthy(rerolled.price !== first.price || rerolled.swap !== first.swap,
    're-roll pivots the seed lane');
});

// ── The call sites, pinned against the real app.js source ─────────────────
// The tests above pin what shops_math PROMISES. They cannot catch the bug that
// actually shipped, which was in the CALLER: shopInteract rolled the relic-swap
// coin and buildShopOffer rolled the markup with bare Math.random, bypassing
// the seeded lanes entirely. run.js lifts both method bodies out of src/app.js
// (app.js needs Phaser, so it can't be loaded here) so these assert on the
// shipping source.

test('shop source: the relic-swap coin is seeded, not Math.random', () => {
  const src = SHOP_INTERACT_SRC;
  // The 10% coin that decides whether a fort sells a relic instead of stock.
  const line = src.split('\n').find(l => l.includes('< 0.10'));
  assert.truthy(line, 'found the relic-swap coin');
  assert.truthy(/shopRng\(/.test(src.slice(0, src.indexOf(line) + line.length)),
    'the swap roll comes off shopRng');
  assert.falsy(/Math\.random\(\)\s*<\s*0\.10/.test(src),
    'a bare Math.random() must not decide what the shop sells');
});

test('shop source: the markup roll is seeded off the shop bucket', () => {
  const src = BUILD_SHOP_OFFER_SRC;
  assert.truthy(/shopRng\(/.test(src), 'buildShopOffer reaches for the seeded rng');
  // buyPrice(save, baseValue, rng) — the third argument is the whole point;
  // without it the call falls back to Math.random and the price re-rolls.
  const call = src.match(/buyPrice\(([^)]*)\)/);
  assert.truthy(call, 'found the buyPrice call');
  assert.eq(call[1].split(',').length, 3, 'buyPrice is passed an explicit rng');
});

test('shop source: no NEW unseeded randomness creeps into the offer path', () => {
  // Forward-looking guard rather than a regression catcher — unlike the two
  // pins above, this one also held before the fix. Exactly one Math.random is
  // expected in this stretch: the documented fallback for a null house on the
  // swap coin. Anything else rolled between picking the item and presenting it
  // would re-roll on reopen, so seed it or update this pin deliberately.
  const stock = SHOP_INTERACT_SRC.slice(SHOP_INTERACT_SRC.indexOf('// Markets skip'));
  const hits = stock.match(/Math\.random\(\)/g) || [];
  assert.eq(hits.length, 1, `unseeded rolls in the offer path: ${hits.length}`);
});
