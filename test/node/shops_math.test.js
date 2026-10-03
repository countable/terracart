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

// NO DEAL CAP (Sep 2026): a shop is never "busy". The old per-hour ration
// (dealCap / readiness) is gone from the module, not set to Infinity — a cap
// that never binds is a cap someone will one day lower again.
test('no deal cap: ShopsMath has no ration and no readiness to ask', () => {
  assert.eq(typeof ShopsMath.dealCap, 'undefined', 'no dealCap');
  assert.eq(typeof ShopsMath.readiness, 'undefined', 'no readiness');
  assert.eq(typeof ShopsMath.msToNextBucket, 'undefined', 'no wait to print');
});

// THE ONE CLOCK ON A DOOR: a short cooldown after a closed deal, for the
// roles with a row in DEAL_COOLDOWN_MS — the trader alone. Short (minutes,
// not the old hourly ration), stamped by recordDeal, read by dealWaitMs.
const TRADER_MS = ShopsMath.DEAL_COOLDOWN_MS.trader;
test('deal cooldown: the table has one row, the trader, and it is short', () => {
  assert.eq(Object.keys(ShopsMath.DEAL_COOLDOWN_MS).join(','), 'trader', 'only the trader waits');
  assert.truthy(TRADER_MS >= 60 * 1000 && TRADER_MS <= 15 * 60 * 1000, `a breather, not a ration: ${TRADER_MS}ms`);
  assert.eq(ShopsMath.MAX_DEAL_COOLDOWN_MS, TRADER_MS, 'the longest row is the record keepers\' horizon');
});

test('deal cooldown: recordDeal banks the deal and stamps the moment', () => {
  const save = {};
  const house = { id: 'tr-1' };
  const cur = ShopsMath.recordDeal(save, house, 1000);
  assert.eq(cur.deals, 1); assert.eq(cur.dealAt, 1000);
  assert.eq(save.shopState['tr-1'], cur, 'on the house\'s own record');
  ShopsMath.recordDeal(save, house, 2000);
  assert.eq(cur.deals, 2, 'each deal counts (the shelf\'s turnover)');
  assert.eq(cur.dealAt, 2000, 'the stamp is the LAST deal');
  assert.eq(ShopsMath.recordDeal(save, { }, 3000), null, 'a house with no id banks nothing');
});

// A closed deal SETTLES the shop (shops_math.js header): the paid re-roll
// rungs and the free skips both go back to zero, so the next re-roll costs
// the base price at once — the smithy's old inline reset, now the one
// recorder's job for every shop.
test('recordDeal: a closed deal settles the re-roll ladder', () => {
  const save = {};
  const house = { id: 'sh-1' };
  const cur = ShopsMath.bucketState(save, house, 1000);
  cur.rerolls = 3; cur.skips = 2;
  ShopsMath.recordDeal(save, house, 1000);
  assert.eq(cur.rerolls, 0, 'the paid rungs are forgiven');
  assert.eq(cur.skips, 0, 'and the free skips with them');
  assert.eq(ShopsMath.themedRerollCost(cur.rerolls), ShopsMath.THEMED_REROLL_START, 'the next re-roll is the base price');
  assert.eq(cur.deals, 1, 'the deal itself still counts');
});

test('deal cooldown: dealWaitMs counts down from the last deal and only for a role with a row', () => {
  const save = {};
  const house = { id: 'tr-2' };
  assert.eq(ShopsMath.dealWaitMs(save, house, 'trader', 5000), 0, 'never dealt with: open');
  assert.falsy(save.shopState && save.shopState['tr-2'], 'and asking created no record');
  ShopsMath.recordDeal(save, house, 10000);
  assert.eq(ShopsMath.dealWaitMs(save, house, 'trader', 10000), TRADER_MS, 'the whole row at the moment of the deal');
  assert.eq(ShopsMath.dealWaitMs(save, house, 'trader', 10000 + TRADER_MS / 2), TRADER_MS / 2, 'half way');
  assert.eq(ShopsMath.dealWaitMs(save, house, 'trader', 10000 + TRADER_MS), 0, 'open again on the dot');
  assert.eq(ShopsMath.dealWaitMs(save, house, 'trader', 10000 + TRADER_MS * 9), 0, 'and stays open');
  for (const role of ['market', 'blacksmith', 'wizard', null, undefined]) {
    assert.eq(ShopsMath.dealWaitMs(save, house, role, 10000), 0, `${role}: no row, no wait`);
  }
  assert.eq(ShopsMath.dealWaitMs(save, { }, 'trader', 10000), 0, 'no id, no wait');
  assert.eq(ShopsMath.dealWaitMs(save, house, 'trader', 10000 - TRADER_MS * 3), TRADER_MS,
    'a clock that ran backwards prints the row\'s length at worst, never a lifetime');
});

test('deal cooldown: the stamp survives the hour bucket while it still cools, and is dropped once spent', () => {
  const save = {};
  const house = { id: 'tr-3' };
  // A deal a minute before the bucket turns: the fresh bucket record must
  // still refuse for the rest of the row.
  const b0 = ShopsMath.bucketState(save, house, 0);
  const turn = (b0.bucket + 1) * HOUR - ShopsMath.bucketOffset(house.id);
  ShopsMath.recordDeal(save, house, turn - 60 * 1000);
  const b1 = ShopsMath.bucketState(save, house, turn + 1000);
  assert.truthy(b1 !== b0 && b1.bucket === b0.bucket + 1, 'a new bucket record');
  assert.eq(b1.deals, 0, 'the deal count starts over with the new offer');
  assert.eq(b1.dealAt, turn - 60 * 1000, 'but the stamp is carried');
  assert.eq(ShopsMath.dealWaitMs(save, house, 'trader', turn + 1000), TRADER_MS - 61 * 1000, 'and still counts down');
  // Hours later the stamp is spent: the carried record sheds it, so it is
  // the exact shape a fresh record would be (pruneShopState's lossless rule).
  const b2 = ShopsMath.bucketState(save, house, turn + HOUR * 3);
  assert.eq(JSON.stringify(b2), JSON.stringify({ bucket: b1.bucket + 3, deals: 0, rerolls: 0 }), 'no stamp once spent');
});

test('deal cooldown: pruneShopState keeps a stale entry whose deal still cools', () => {
  const save = {};
  const cooling = { id: 'tr-cool' }, spent = { id: 'tr-spent' };
  const b0 = ShopsMath.bucketState(save, cooling, 0);
  const turn = (b0.bucket + 1) * HOUR - ShopsMath.bucketOffset(cooling.id);
  ShopsMath.recordDeal(save, cooling, turn - 1000);
  // The other house has its own bucket offset: deal three hours back so its
  // record is a stale bucket at the probe whatever that offset is.
  ShopsMath.recordDeal(save, spent, turn - HOUR * 3);
  const later = turn + HOUR * 2;    // both records are now stale buckets
  assert.eq(ShopsMath.pruneShopState(save, turn + 1000), 1, 'at the turn, only the spent deal goes');
  assert.truthy(save.shopState['tr-cool'], 'the cooling one is kept');
  assert.falsy(save.shopState['tr-spent']);
  assert.eq(ShopsMath.dealWaitMs(save, cooling, 'trader', turn + 1000), TRADER_MS - 2000, 'and still refuses');
  assert.eq(ShopsMath.pruneShopState(save, later), 1, 'hours on, it is spent too');
});

test('bucketState: creates a record; a new hour resets deals and keeps easing re-rolls', () => {
  const save = {};
  const house = { id: 'shopA' };
  const cur = ShopsMath.bucketState(save, house, 0);
  assert.eq(cur.deals, 0);
  assert.eq(cur.rerolls, 0);
  assert.eq(save.shopState.shopA, cur, 'persisted under the id');
  cur.deals = 3;
  cur.rerolls = 4;
  // Same hour → same record (deals + rerolls preserved).
  assert.eq(ShopsMath.bucketState(save, house, HOUR / 4).deals, 3, 'same bucket keeps deals');
  assert.eq(ShopsMath.bucketState(save, house, HOUR / 4).rerolls, 4, 'same bucket keeps rerolls');
  // Two hours on → the deal count starts over with the new offer, but the
  // re-roll ladder only eases: one rung per hour that passed.
  const next = ShopsMath.bucketState(save, house, HOUR * 2);
  assert.eq(next.deals, 0, 'new bucket → deals reset');
  assert.eq(next.rerolls, 2, 'new bucket → two rungs off, not a reset');
  assert.eq(next.bucket, ShopsMath.bucket(house.id, HOUR * 2), 'stamped with the new bucket');
  assert.eq(save.shopState.shopA, next, 'and persisted in place of the old record');
});

// THE ONE THING THE CLOCK DOES TO A SHOP: the paid re-roll level (the rung
// of the cost ladder) comes off one per hour bucket. Never a full reset, never
// below zero, and a clock that ran backwards forgives nothing.
test('easedRerolls: one rung per elapsed hour bucket, floored at zero', () => {
  const at = (rerolls, bucket) => ({ bucket, deals: 0, rerolls });
  assert.eq(ShopsMath.easedRerolls(at(5, 10), 10), 5, 'same bucket: untouched');
  assert.eq(ShopsMath.easedRerolls(at(5, 10), 11), 4, 'an hour later: one off');
  assert.eq(ShopsMath.easedRerolls(at(5, 10), 13), 2, 'three hours: three off');
  assert.eq(ShopsMath.easedRerolls(at(5, 10), 40), 0, 'a day later: floored at zero');
  assert.eq(ShopsMath.easedRerolls(at(0, 10), 11), 0, 'nothing to ease stays nothing');
  assert.eq(ShopsMath.easedRerolls(at(5, 10), 8), 5, 'a clock run backwards eases nothing');
});

test('re-roll cost: eases one rung an hour through bucketState, and the seed follows', () => {
  const save = { offerSalt: 1 };
  const house = { id: 'smithy-ease' };
  const smithy = (now) => ShopsMath.smithyRerollCost(ShopsMath.bucketState(save, house, now).rerolls);
  ShopsMath.bucketState(save, house, 0).rerolls = 3;
  assert.eq(smithy(0), ShopsMath.smithyRerollCost(3), 'three re-rolls deep');
  assert.eq(smithy(HOUR), ShopsMath.smithyRerollCost(2), 'an hour later one rung cheaper');
  assert.eq(smithy(HOUR * 2), ShopsMath.smithyRerollCost(1), 'two hours: another rung');
  assert.eq(smithy(HOUR * 3), ShopsMath.smithyRerollCost(0), 'three hours: back at the base…');
  assert.eq(smithy(HOUR * 9), ShopsMath.smithyRerollCost(0), '…and it stays there');
  // Easing is a state change, so it must pivot the seeded offer like a paid
  // re-roll does — the same lane, drawn at the same moment, differs only by
  // the rung.
  const b0 = ShopsMath.bucket(house.id, 0), b1 = ShopsMath.bucket(house.id, HOUR);
  const eased  = { offerSalt: 1, shopState: { 'smithy-ease': { bucket: b0, deals: 0, rerolls: 3 } } };
  const direct = { offerSalt: 1, shopState: { 'smithy-ease': { bucket: b1, deals: 0, rerolls: 2 } } };
  assert.eq(ShopsMath.rng(eased, house, 'relic', HOUR)(), ShopsMath.rng(direct, house, 'relic', HOUR)(),
    'an eased record draws exactly as a record written at that rung would');
});

test('pruneShopState: deletes spent stale-bucket entries, keeps current-bucket ones', () => {
  const save = { shopState: {} };
  const stale = { id: 'stale-house' };
  const fresh = { id: 'fresh-house' };
  // Seed one record in the CURRENT bucket for each id at t=0…
  ShopsMath.bucketState(save, stale, 0);
  ShopsMath.bucketState(save, fresh, 0);
  assert.truthy(save.shopState['stale-house'], 'stale house has a record before pruning');
  assert.truthy(save.shopState['fresh-house'], 'fresh house has a record before pruning');
  // …then prune as of an hour later: `stale` is now in a different bucket
  // (its bucket() has advanced), `fresh` is re-touched at the same moment so
  // its bucket has ALSO advanced — bucketState below re-derives it fresh.
  const later = ShopsMath.HOUR * 3;
  // Re-derive `fresh`'s record for the later moment so it's genuinely current
  // at prune time (mirrors a shop the player is actively looking at).
  ShopsMath.bucketState(save, fresh, later);
  const removed = ShopsMath.pruneShopState(save, later);
  assert.eq(removed, 1, 'exactly the stale entry was removed');
  assert.falsy(save.shopState['stale-house'], 'stale-bucket entry pruned');
  assert.truthy(save.shopState['fresh-house'], 'current-bucket entry survives');
});

test('pruneShopState: lossless — a pruned entry rerolls to the exact same shape bucketState would have replaced it with', () => {
  const save = { shopState: {} };
  const house = { id: 'h-lossless' };
  ShopsMath.bucketState(save, house, 0).deals = 3;   // simulate a used-up hour
  const later = ShopsMath.HOUR * 5;
  // What bucketState's own stale-replace path would produce, untouched by pruning.
  const saveA = { shopState: { ...save.shopState } };
  const viaReplace = ShopsMath.bucketState(saveA, house, later);
  // What pruning first, then touching, produces.
  ShopsMath.pruneShopState(save, later);
  assert.falsy(save.shopState['h-lossless'], 'pruned before the re-touch');
  const viaPrune = ShopsMath.bucketState(save, house, later);
  assert.eq(JSON.stringify(viaPrune), JSON.stringify(viaReplace),
    'pruning then recreating matches bucketState\'s own stale-replace exactly');
});

test('pruneShopState: a stale entry still carrying re-roll rungs is kept, and eases on touch', () => {
  const save = { shopState: {} };
  const deep = { id: 'h-deep' };
  const shallow = { id: 'h-shallow' };
  ShopsMath.bucketState(save, deep, 0).rerolls = 5;
  ShopsMath.bucketState(save, shallow, 0).rerolls = 2;
  const later = ShopsMath.HOUR * 3;
  assert.eq(ShopsMath.pruneShopState(save, later), 1, 'only the entry whose ladder has eased away goes');
  assert.falsy(save.shopState['h-shallow'], 'two rungs, three hours: spent');
  assert.truthy(save.shopState['h-deep'], 'five rungs, three hours: two still owed');
  assert.eq(ShopsMath.bucketState(save, deep, later).rerolls, 2, 'and the touch eases it, not resets it');
});

test('pruneShopState: no-op on an empty or missing shopState', () => {
  assert.eq(ShopsMath.pruneShopState({}), 0, 'no shopState at all');
  assert.eq(ShopsMath.pruneShopState({ shopState: {} }), 0, 'empty shopState');
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

test('buyPrice: within the markup band, and no relic collapses it', () => {
  const plain = { relics: {} };
  for (let s = 0; s < 50; s++) {
    const p = ShopsMath.buyPrice(plain, 100, () => Math.random());
    assert.inRange(p, Math.ceil(100 * 1.2), Math.ceil(100 * 3.0), 'within 1.2..3.0×');
  }
  // A maxed Bow pays the same band (Oct 2026: the Magic Hammer's building is
  // the one standing discount — houses.js priceMul).
  const bowed = { relics: { bow: { tier: 7 } } };
  assert.eq(ShopsMath.buyPrice(bowed, 100, () => 0), 120, 'the band\'s floor at a low roll');
  assert.eq(ShopsMath.buyPrice(bowed, 100, () => 1), 300, 'its ceiling at a high roll');
});

// ── Stand pricing: cheaper than par, never an arbitrage pump ───────────────
// The whole point of the stand discount is that it has a ceiling it can never
// cross. The stand price is a margin above the sell rate (sellMultiplier —
// one flat number since Oct 2026; it used to climb with the Sword relic, and
// these tests swept every tier), clamped between the best discount and par.
// These tests pin both halves: that a stand really is cheaper, and that
// buying at one and selling it back can never turn a profit — for every item
// in the game.

// What the player actually receives for one unit before the trailer's own
// haircut: base × sellMultiplier, ceil, floored at $1.
const sellGain = (base) => Math.max(1, Math.ceil(base * sellMultiplier()));

test('standPrice: undercuts par, and nothing on the player moves it', () => {
  const save = { relics: {} };
  // Coffee is the motivating case — a $40 cup charged at full list price.
  assert.eq(ShopsMath.standPrice(save, 40), 30, 'coffee: $40 list → $30 at a stand');
  assert.eq(ShopsMath.standBuyMul(), 0.75, '25% off par');
  assert.eq(ShopsMath.standBuyMul.length, 0, 'the multiplier reads no relics');
  for (const t of [0, 4, 7]) {
    assert.eq(ShopsMath.standPrice({ relics: { sword: { tier: t } } }, 40), 30, `a sword (tier ${t}) changes nothing`);
  }
  assert.inRange(ShopsMath.standBuyMul(), 0.75, 1, 'between the floor and par');
});

test('standPrice: the floor tracks the sell rate — raise selling and the stand follows', () => {
  // Pinned on the shape, since the rate is a constant: a sell rate under the
  // floor leaves the full discount; one above it is tracked, a margin up.
  assert.truthy(/return clamp\(sellMul \+ STAND_ARB_MARGIN, STAND_BUY_MUL, 1\);/.test(SHOPS_MATH_SRC), 'margin above the sell rate, clamped');
  assert.lte(SELL_MUL + ShopsMath.STAND_ARB_MARGIN, ShopsMath.STAND_BUY_MUL, 'today the sell rate sits under the floor: the stands keep their whole discount');
});

test('standPrice: NO ARBITRAGE — buy at a stand, sell it back, never profit', () => {
  // Every real item price in the game, not a sample: the rounding is where a
  // one-dollar leak would hide, and cheap items are the risky ones.
  const bases = Object.values(PRICES).filter((v) => Number.isFinite(v) && v > 0);
  assert.gt(bases.length, 50, 'PRICES really loaded (guard against a vacuous pass)');
  const leaks = [];
  const save = { relics: {} };
  for (const base of bases) {
    const pay  = ShopsMath.standPrice(save, base);
    const back = sellGain(base);
    if (back > pay) leaks.push(`base $${base}: pay $${pay}, sells back for $${back}`);
  }
  assert.eq(leaks.length, 0, 'stand→sell must never pay out: ' + leaks.slice(0, 5).join('; '));
});

test('standPrice: no arbitrage at $1–$500 either, including odd values', () => {
  const leaks = [];
  for (let base = 1; base <= 500; base++) {
    const pay  = ShopsMath.standPrice({ relics: {} }, base);
    const back = sellGain(base);
    if (back > pay) leaks.push(`base $${base}: pay $${pay}, back $${back}`);
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
  {
    const save = { relics: {} };
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
  const fort = { id: 'h_4343959_8778563', kind: 'house', tier: 9 };
  const first = openShop(save, fort, 0);
  for (let open = 0; open < 25; open++) {
    const again = openShop(save, fort, 0);
    assert.eq(again.swap, first.swap, `open ${open}: relic-swap coin must not re-roll`);
    assert.eq(again.price, first.price, `open ${open}: price must not re-roll`);
  }
});

test('shop offer: it still holds as the hour advances, and turns over at the bucket', () => {
  const save = { offerSalt: 7, relics: {} };
  const fort = { id: 'fort-A', kind: 'house', tier: 9 };
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

// What was bought LEAVES the shelf (shops_math.js header, owner's call, Oct
// 2026): a closed deal is in every lane's seed, so the next offer — the
// trader's goods and sign, a themed shelf's item, a storefront's price — is a
// fresh draw, and a re-roll still pivots on top of it. (Until Oct 2026 only
// the trader folded its deals in; cash shops kept their shelf.)
test('rng: a closed deal turns the shelf over, in every lane', () => {
  const save = { offerSalt: 5 };
  const house = { id: 'trader-A', kind: 'house', tier: 9 };
  const draw = (lane) => ShopsMath.rng(save, house, lane, 0)();
  ShopsMath.bucketState(save, house, 0).deals = 0;
  const fresh = draw('trader');
  assert.eq(draw('trader'), fresh, 'stable while no deal is made');
  const seen = new Set([fresh]);
  for (let deal = 1; deal <= 4; deal++) {
    ShopsMath.bucketState(save, house, 0).deals = deal;
    const next = draw('trader');
    assert.falsy(seen.has(next), `deal ${deal}: new goods`);
    seen.add(next);
  }
  ShopsMath.bucketState(save, house, 0).rerolls = 1;
  assert.falsy(seen.has(draw('trader')), 'a re-roll still pivots the stream');
  // A cash shop's lanes turn over the same way: the whole offer is fresh.
  const fort = { id: 'fort-B', kind: 'house', tier: 9 };
  const first = openShop(save, fort, 0);
  assert.eq(openShop(save, fort, 0).price, first.price, 'the price holds until a deal');
  ShopsMath.recordDeal(save, fort, 0);
  const after = openShop(save, fort, 0);
  assert.truthy(after.swap !== first.swap || after.price !== first.price, 'after a buy the storefront offers afresh');
});

test('shop offer: two shops in the same hour make their own independent offers', () => {
  // Stability must come from the seed, not from the offer being constant.
  const save = { offerSalt: 11, relics: {} };
  const prices = new Set();
  for (let i = 0; i < 12; i++) {
    prices.add(openShop(save, { id: 'fort-' + i, kind: 'house', tier: 9 }, 0).price);
  }
  assert.gt(prices.size, 1, 'different shops price the same item differently');
});

test('shop offer: a paid re-roll is still the one thing that CAN change it', () => {
  const save = { offerSalt: 5, relics: {} };
  const fort = { id: 'fort-C', kind: 'house', tier: 9 };
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
  assert.eq((call[1].split(',')[2] || '').trim(), 'priceRng', 'buyPrice is passed an explicit rng');
});

test('shop source: no NEW unseeded randomness creeps into the offer path', () => {
  // Forward-looking guard rather than a regression catcher — unlike the two
  // pins above, this one also held before the fix. Exactly one Math.random is
  // expected in this stretch: the documented fallback for a null house on the
  // swap coin. Anything else rolled between picking the item and presenting it
  // would re-roll on reopen, so seed it or update this pin deliberately.
  const stock = SHOP_INTERACT_SRC.slice(SHOP_INTERACT_SRC.indexOf('// SEEDED, not Math.random'));
  const hits = stock.match(/Math\.random\(\)/g) || [];
  assert.eq(hits.length, 1, `unseeded rolls in the offer path: ${hits.length}`);
});

// ─── Trader ask (ShopsMath.traderAsk) ───────────────────────────────────────
// A wooden-backpack player was offered 2 Fireflowers for 54 Potato Seeds — an
// ask the bag could never hold. Most asks must be takeable on the spot, and
// none may exceed the stack cap while a holdable choice exists.
(function () {
  const prices = { potato_seed: 1, carrot: 10, stone: 2, gem: 500 };
  const base = (over) => Object.assign({
    giveId: 'fireflower', target: 54, prices,
    isItem: () => true, capFor: () => 19,
    inv: [{ id: 'potato_seed', count: 15 }, { id: 'carrot', count: 8 }],
  }, over);
  const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };

  test('traderAsk: never asks more than the stack cap can hold', () => {
    for (let i = 0; i < 400; i++) {
      const a = ShopsMath.traderAsk(base({ rng: seeded(i) }));
      assert.truthy(a.askQty <= 19, `ask ${a.askQty}× ${a.askId} fits a 19-stack`);
      assert.truthy(a.askId !== 'potato_seed', '54 potato seeds is never asked of a 19-stack bag');
    }
  });

  test('traderAsk: most asks are affordable from the bag as it stands', () => {
    let ok = 0; const N = 2000;
    for (let i = 0; i < N; i++) {
      const a = ShopsMath.traderAsk(base({ rng: seeded(i * 7919 + 1) }));
      const have = a.askId === 'carrot' ? 8 : a.askId === 'potato_seed' ? 15 : 0;
      if (have >= a.askQty) ok++;
    }
    // The affordable pass alone is TRADER_AFFORDABLE_CHANCE; the fallback's
    // owned pick adds more.
    assert.truthy(ok / N >= ShopsMath.TRADER_AFFORDABLE_CHANCE - 0.03,
      `affordable share ${(ok / N).toFixed(2)} ≥ ${ShopsMath.TRADER_AFFORDABLE_CHANCE}`);
  });

  test('traderAsk: nothing affordable → still asks for something owned, then the wishlist', () => {
    const a = ShopsMath.traderAsk(base({ rng: () => 0, inv: [{ id: 'carrot', count: 1 }] }));
    assert.eq(a.askId, 'carrot', 'an owned, holdable stack beats the wishlist');
    assert.eq(a.askQty, 6, 'ceil(54 / 10)');
    const w = ShopsMath.traderAsk(base({ rng: () => 0, inv: [] }));
    assert.truthy(w && w.askId !== 'fireflower', 'empty bag → a wishlist ask');
  });

  test('traderAsk: the ask stays inside the trader\'s value ratio — no 500-coin gem for a 54 target', () => {
    const inv = [{ id: 'gem', count: 3 }, { id: 'carrot', count: 8 }, { id: 'potato_seed', count: 15 }];
    for (let i = 0; i < 400; i++) {
      const a = ShopsMath.traderAsk(base({ rng: seeded(i), inv }));
      const value = a.askQty * prices[a.askId];
      assert.truthy(value <= ShopsMath.TRADER_MAX_OVERPAY * 54, `${a.askQty}× ${a.askId} = ${value} for a 54 target`);
    }
    // Only a gem in the world → it is still asked, rather than no trade at all.
    const only = ShopsMath.traderAsk(base({ rng: () => 0, inv: [], prices: { gem: 500 } }));
    assert.eq(only.askId, 'gem', 'no fairer item exists, so the dear one is the fallback');
  });

  test('traderAsk: never asks for the item it gives', () => {
    for (let i = 0; i < 200; i++) {
      const a = ShopsMath.traderAsk(base({ rng: seeded(i), giveId: 'carrot' }));
      assert.truthy(a.askId !== 'carrot');
    }
  });
})();

// ─── Fort slot machine ──────────────────────────────────────────────────────
test('slots: the most valuable prize is the jackpot, half as likely a reel', () => {
  const vals = { a: 10, d: 300, e: 20 };
  const m = ShopsMath.slotMachine(Object.keys(vals), (id) => vals[id]);
  const jp = m.prizes.filter((p) => p.jackpot);
  assert.eq(jp.length, 1, 'one jackpot');
  assert.eq(jp[0].id, 'd', 'the dearest prize');
  assert.eq(jp[0].weight * 2, m.prizes.find((p) => p.id === 'a').weight, 'half the weight of the others');
});

test('slots: the stake is the expected win, rounded up to a coin', () => {
  const S = ShopsMath;
  const vals = { a: 10, d: 300, e: 20 };
  const m = S.slotMachine(Object.keys(vals), (id) => vals[id]);
  // weights a2 d1 e2 + star 1 → total 6. Each outcome, priced exactly:
  //   natural triple  p³ · 2 · value     star-completed  3p²s · value
  //   jackpot pair    3q²(1−q−s) · 3     two stars       3s²(1−s) · 2 · cost
  //   three stars     s³ · 100 (a badge valued at the coin it becomes)
  const T = 216;
  // Deluxe: t = 3s²q = 3/216; f is the long-run deluxe share, and every
  // prize (all double here) pays SLOT_DELUXE_MUL over that share.
  const t = 3 / T;
  const L = (Math.pow(1 - t, -S.SLOT_DELUXE_SPINS) - 1) / t;
  const f = L / (1 / t + L);
  assert.truthy(Math.abs(m.deluxeShare - f) < 1e-12, `deluxe share ${m.deluxeShare} = ${f}`);
  const dl = 1 + f * (S.SLOT_DELUXE_MUL - 1);
  const natural = (8 * (10 + 20) + 1 * 300) * S.SLOT_NATURAL_MUL / T * dl;
  const starred = 3 * (4 * (10 + 20) + 1 * 300) / T * dl;
  // Deluxe doubles the coin too, so every coin term carries dl as well.
  const jpPair = 3 * 1 * 4 / T * S.SLOT_JACKPOT_PAIR_COINS * dl;
  const stars = 1 / T * S.SLOT_STAR_JACKPOT_COINS * dl;
  const rest = natural + starred + jpPair + stars;
  // Two stars pay SLOT_STAR_PAIR_MUL stakes, so the price is a fixed point:
  // the least whole c with rest + k·c ≤ c.
  // two stars + a b/e (not the jackpot, not a star): 3 · 1 · 4 / T
  const k = 3 * 1 * 4 / T * S.SLOT_STAR_PAIR_MUL * dl;
  const cost = Math.ceil(rest / (1 - k));
  const ev = rest + k * cost;
  assert.truthy(Math.abs(m.ev - ev) < 1e-9, `ev ${m.ev} = ${ev}`);
  assert.eq(m.cost, cost, 'cost = the least whole coin covering its own ev');
  assert.eq(m.cost, Math.ceil(m.ev), 'which is still the ev, rounded up');
  assert.truthy(m.cost - m.ev < 1, 'the house edge is under one coin');
  // Monte Carlo: the average payout per spin matches the ev, counting three
  // stars at the coin the stake prices them at, and carrying the deluxe count
  // from spin to spin the way the machine does.
  let a = 12345; const rng = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  let paid = 0, left = 0; const N = 600000;
  for (let i = 0; i < N; i++) {
    const r = S.slotSpin(m, rng, left > 0);
    left = S.slotDeluxeNext(left, r);
    if (r.won >= 0) paid += r.qty * m.symbols[r.won].value;
    if (r.starJackpot) paid += S.SLOT_STAR_JACKPOT_COINS * (r.doubled ? S.SLOT_DELUXE_MUL : 1);
    paid += r.coins;
  }
  assert.truthy(Math.abs(paid / N - ev) < 0.05 * ev, `mean payout ${paid / N} ≈ ${ev}`);
});

// ['a','b','c'] at one price: 'a' is the jackpot (the first, on a tie).
// Weights a1 b2 c2 star1 → total 6; u·6 picks: a < 1/6, b < 1/2, c < 5/6, then star.
const SLOT_U = { a: 0.1, b: 0.3, c: 0.7, star: 0.9 };
const slotSeq = (xs) => { let i = 0; return () => SLOT_U[xs[i++]]; };

test('slots: the star is a fourth symbol on the reel, and no prize', () => {
  const m = ShopsMath.slotMachine(['a', 'b', 'c'], () => 10);
  assert.eq(m.symbols.length, 4, 'three prizes and the star');
  const star = m.symbols[3];
  assert.truthy(star.star && star.weight === ShopsMath.SLOT_STAR_WEIGHT, 'the star, at its weight');
  assert.falsy(m.prizes.some((p) => p.star), 'it is not one of the prizes');
  assert.falsy(star.jackpot, 'and never the jackpot');
});

test('slots: a natural three pays double; a star completes a pair for one', () => {
  const m = ShopsMath.slotMachine(['a', 'b', 'c'], () => 10);
  const nat = ShopsMath.slotSpin(m, slotSeq(['b', 'b', 'b']));
  assert.eq(nat.won, 1, 'three b win b');
  assert.truthy(nat.natural, 'a natural triple');
  assert.eq(nat.qty, ShopsMath.SLOT_NATURAL_MUL, 'at double quantity');
  for (const row of [['star', 'c', 'c'], ['c', 'star', 'c'], ['c', 'c', 'star']]) {
    const r = ShopsMath.slotSpin(m, slotSeq(row));
    assert.eq(r.won, 2, `${row.join(',')} wins c`);
    assert.falsy(r.natural, 'not natural');
    assert.eq(r.qty, 1, 'one of it');
  }
  const jp = ShopsMath.slotSpin(m, slotSeq(['a', 'star', 'a']));
  assert.eq(jp.won, 0, 'a star completes a jackpot pair into the jackpot');
  assert.eq(jp.coins, 0, 'with no pair coin on top');
  const mixed = ShopsMath.slotSpin(m, slotSeq(['b', 'star', 'c']));
  assert.eq(mixed.won, -1, 'a star does not join two different prizes');
  assert.eq(mixed.coins, 0, 'and pays nothing');
});

test('slots: a prize the caller says does not double pays one on a natural', () => {
  const m = ShopsMath.slotMachine(['a', 'b', 'c'], () => 10, (id) => id !== 'b');
  const nat = ShopsMath.slotSpin(m, slotSeq(['b', 'b', 'b']));
  assert.eq(nat.won, 1, 'still wins');
  assert.eq(nat.qty, 1, 'but one of it (a relic is one of a kind)');
  assert.eq(ShopsMath.slotSpin(m, slotSeq(['c', 'c', 'c'])).qty, 2, 'the others still double');
});

test('slots: two jackpots and another prize pays the pair coin', () => {
  const m = ShopsMath.slotMachine(['a', 'b', 'c'], (id) => ({ a: 99, b: 5, c: 7 }[id]));
  const pair = ShopsMath.slotSpin(m, slotSeq(['a', 'b', 'a']));
  assert.eq(pair.won, -1, 'no prize');
  assert.eq(pair.coins, ShopsMath.SLOT_JACKPOT_PAIR_COINS, 'the pair coin');
  const three = ShopsMath.slotSpin(m, slotSeq(['a', 'a', 'a']));
  assert.eq(three.won, 0, 'three jackpots win the jackpot');
  assert.eq(three.qty, 2, 'a natural jackpot doubles too');
  assert.eq(three.coins, 0, 'and not the pair coin on top');
});

test('slots: two stars pay double the stake, three stars are the star jackpot', () => {
  const m = ShopsMath.slotMachine(['a', 'b', 'c'], () => 10);
  for (const row of [['star', 'star', 'b'], ['c', 'star', 'star']]) {
    const r = ShopsMath.slotSpin(m, slotSeq(row));
    assert.eq(r.won, -1, `${row.join(',')} wins no prize`);
    assert.eq(r.coins, ShopsMath.SLOT_STAR_PAIR_MUL * m.cost, 'two stars pay double the stake');
    assert.falsy(r.starJackpot, 'not the star jackpot');
  }
  const three = ShopsMath.slotSpin(m, slotSeq(['star', 'star', 'star']));
  assert.truthy(three.starJackpot, 'three stars');
  assert.eq(three.won, -1, 'no prize');
  assert.eq(three.coins, 0, 'the caller pays it (badge or coin)');
});

test('slots: two stars and the jackpot go deluxe — no coin — for SLOT_DELUXE_SPINS', () => {
  const S = ShopsMath;
  const m = S.slotMachine(['a', 'b', 'c'], () => 10);   // 'a' is the jackpot
  for (const row of [['star', 'star', 'a'], ['a', 'star', 'star'], ['star', 'a', 'star']]) {
    const r = S.slotSpin(m, slotSeq(row));
    assert.truthy(r.deluxe, `${row.join(',')} goes deluxe`);
    assert.eq(r.coins, 0, 'and pays no coin');
    assert.eq(r.won, -1, 'nor a prize');
  }
  assert.eq(S.SLOT_DELUXE_SPINS, 10, 'ten spins');
  assert.eq(S.slotDeluxeNext(0, { deluxe: true }), 10, 'a trigger starts the count');
  assert.eq(S.slotDeluxeNext(10, {}), 9, 'a spin uses one');
  assert.eq(S.slotDeluxeNext(1, {}), 0, 'down to none');
  assert.eq(S.slotDeluxeNext(0, {}), 0, 'never below');
  assert.eq(S.slotDeluxeNext(4, { deluxe: true }), 10, 'a hit while deluxe restores the ten — never stacks');
});

test('slots: deluxe doubles the coin payouts too', () => {
  const S = ShopsMath;
  const m = S.slotMachine(['a', 'b', 'c'], () => 10);   // 'a' is the jackpot
  const D = S.SLOT_DELUXE_MUL;
  assert.eq(S.slotSpin(m, slotSeq(['a', 'b', 'a']), true).coins, S.SLOT_JACKPOT_PAIR_COINS * D, 'the jackpot pair');
  assert.eq(S.slotSpin(m, slotSeq(['star', 'star', 'b']), true).coins, S.SLOT_STAR_PAIR_MUL * m.cost * D, 'the star pair');
  const three = S.slotSpin(m, slotSeq(['star', 'star', 'star']), true);
  assert.truthy(three.starJackpot && three.doubled, 'three stars, flagged for the caller to double its coin');
  assert.falsy(S.slotSpin(m, slotSeq(['star', 'star', 'star'])).doubled, 'not doubled outside deluxe');
  assert.eq(S.slotSpin(m, slotSeq(['a', 'b', 'a'])).coins, S.SLOT_JACKPOT_PAIR_COINS, 'plain spins pay plain');
  assert.truthy(/_payStarJackpot\(out\.doubled \? ShopsMath\.SLOT_DELUXE_MUL : 1\)/.test(SCENE_SRC),
    'the machine pays the star jackpot\'s coin doubled');
});

test('slots: deluxe doubles a prize that doubles, and not a relic', () => {
  const S = ShopsMath;
  const m = S.slotMachine(['a', 'b', 'c'], () => 10, (id) => id !== 'c');
  const nat = S.slotSpin(m, slotSeq(['b', 'b', 'b']), true);
  assert.eq(nat.qty, S.SLOT_NATURAL_MUL * S.SLOT_DELUXE_MUL, 'a natural, deluxe: 2 × 2');
  assert.truthy(nat.doubled, 'flagged');
  const starred = S.slotSpin(m, slotSeq(['b', 'star', 'b']), true);
  assert.eq(starred.qty, S.SLOT_DELUXE_MUL, 'a starred pair, deluxe: 2');
  const relic = S.slotSpin(m, slotSeq(['c', 'c', 'c']), true);
  assert.eq(relic.qty, 1, 'a relic never doubles');
  assert.falsy(relic.doubled);
  assert.eq(S.slotSpin(m, slotSeq(['b', 'b', 'b'])).qty, S.SLOT_NATURAL_MUL, 'not deluxe: the natural double only');
});

test('slots: a mixed row with no star loses', () => {
  const m = ShopsMath.slotMachine(['a', 'b', 'c'], () => 10);
  const diff = ShopsMath.slotSpin(m, slotSeq(['a', 'b', 'c']));
  assert.eq(diff.won, -1, 'a mixed row loses');
  assert.eq(diff.coins, 0, 'one jackpot pays nothing');
});

test('slots: app.js pays three stars from the badge ledger, then coin', () => {
  const app = SCENE_SRC;
  const m = app.match(/\n  _payStarJackpot\(mul = 1\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(m, '_payStarJackpot exists');
  assert.truthy(/ShopsMath\.SLOT_STAR_BADGES/.test(m[1]), 'counts up to SLOT_STAR_BADGES');
  assert.truthy(/this\._bankDiscovery\(`slots:stars:\$\{n \+ 1\}`/.test(m[1]), 'one ledger key per badge');
  assert.truthy(/const coins = ShopsMath\.SLOT_STAR_JACKPOT_COINS \* mul;[\s\S]*addMoney\(this\.save, coins\)/.test(m[1]), 'then the coin (times the deluxe mul)');
  assert.truthy(/if \(out\.starJackpot\) \{[\s\S]{0,200}this\._payStarJackpot\(/.test(app), 'the machine calls it on three stars');
  assert.truthy(/const qty = out\.qty \|\| 1;/.test(app), 'a win pays the spin\'s quantity');
});

test('slots: three distinct prizes a day, the same all day, seeded on the fort and the day', () => {
  const cands = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const d1 = ShopsMath.slotPrizes('slots:fort1:20260924', cands);
  assert.eq(d1.length, 3, 'three prizes');
  assert.eq(new Set(d1).size, 3, 'all different');
  assert.eq(d1.join(), ShopsMath.slotPrizes('slots:fort1:20260924', cands).join(), 'stable within the day');
  const others = ['slots:fort1:20260925', 'slots:fort2:20260924'].map((k) => ShopsMath.slotPrizes(k, cands).join());
  assert.truthy(others.some((o) => o !== d1.join()), 'a new day or another fort rolls its own');
});

test('slots: the machine fixes a spin\'s deluxe state when it is paid, and saves the count at once', () => {
  const app = SCENE_SRC;
  const i = app.indexOf('\n  presentFortSlots(sx, sy, house) {');
  const body = app.slice(i, app.indexOf('\n  }\n', i));
  assert.truthy(/const wasDeluxe = deluxeLeft\(\) > 0;\s*\n\s*const out = ShopsMath\.slotSpin\(m, Math\.random, wasDeluxe\);\s*\n\s*this\.save\.slotDeluxe = ShopsMath\.slotDeluxeNext\(deluxeLeft\(\), out\);\s*\n\s*persistSave\(this\.save\);/.test(body),
    'deluxe is read, the spin rolled with it, the count moved on and persisted — all before the reels turn');
  assert.truthy(/if \(out\.deluxe\) \{/.test(body), 'the trigger has its own result branch (no coin)');
  assert.truthy(/this\._bankDiscovery\('slots:deluxe'/.test(body), 'the first deluxe banks a memory, once, under one ledger key');
});

test('slots: a paid spin cannot be closed before its precomputed payout settles', () => {
  const app = SCENE_SRC;
  const i = app.indexOf('\n  presentFortSlots(sx, sy, house) {');
  const body = app.slice(i, app.indexOf('\n  }\n', i));
  assert.truthy(/makeModalShell\('slots-modal',\s*\{ kind: 'slots' \}\)/.test(body),
    'the backdrop has no close handler');
  assert.truthy(/later\._setEnabled\(!spinning\)/.test(body), 'Later is disabled while the reels turn');
  assert.truthy(/later\.addEventListener\('click',[\s\S]*?if \(spinning\) return;[\s\S]*?timers\.forEach\(clearTimeout\)/.test(body),
    'the cancel handler preserves settle timers during a spin');
});

// ── A re-roll always lands on something else (ShopsMath.rerollPeek) ─────────
test('rerollPeek: one rung on the ladder, then FREE re-draws until the offer differs', () => {
  assert.eq(ShopsMath.REROLL_RETRIES, 4, 'a couple of retries at least');
  // A pool of two: the draw alternates same, same, other.
  const cur = { bucket: 1, deals: 0, rerolls: 2 };
  const draws = ['sword', 'sword', 'shield'];
  let i = 0;
  const next = ShopsMath.rerollPeek(cur, () => draws[i++], 'sword');
  assert.eq(next, 'shield', 'lands on the other item');
  assert.eq(cur.rerolls, 3, 'the ladder climbed ONE rung for the paid re-roll');
  assert.eq(cur.skips, 2, 'the two same-again draws went on the seed-only counter');
  // A first draw that already differs costs no skips.
  const cur2 = { bucket: 1, deals: 0, rerolls: 0 };
  assert.eq(ShopsMath.rerollPeek(cur2, () => 'axe', 'sword'), 'axe');
  assert.eq(cur2.rerolls, 1); assert.eq(cur2.skips, undefined, 'untouched: the record keeps its old shape');
  // A pool of one gives up after the retries, same thing in hand.
  const cur3 = { bucket: 1, deals: 0, rerolls: 0 };
  let n = 0;
  assert.eq(ShopsMath.rerollPeek(cur3, () => { n++; return 'bar'; }, 'bar'), 'bar');
  assert.eq(n, 1 + ShopsMath.REROLL_RETRIES, 'the first draw plus every retry');
  assert.eq(cur3.rerolls, 1, 'still one rung');
  // Nothing left (null) returns at once, no retry.
  const cur4 = { bucket: 1, deals: 0, rerolls: 0 };
  n = 0;
  assert.eq(ShopsMath.rerollPeek(cur4, () => { n++; return null; }, 'bar'), null);
  assert.eq(n, 1); assert.eq(cur4.skips, undefined);
  // No record (the unseeded house): the retry loop alone.
  let j = 0;
  assert.eq(ShopsMath.rerollPeek(null, () => ['a', 'b'][j++], 'a'), 'b');
});

test('rerollPeek: offerKey — gear by kind/slot/tier, a barter by give/ask, never by price or qty', () => {
  const k = ShopsMath.offerKey;
  assert.eq(k({ kind: 'relic', slot: 'bow', tier: 3, price: 40 }), k({ kind: 'relic', slot: 'bow', tier: 3, price: 55 }), 'a repriced relic is the same relic');
  assert.truthy(k({ kind: 'relic', slot: 'bow', tier: 3 }) !== k({ kind: 'relic', slot: 'bow', tier: 4 }), 'a tier up is different');
  assert.truthy(k({ kind: 'relic', slot: 'bow', tier: 3 }) !== k({ kind: 'armor', slot: 'bow', tier: 3 }), 'kind counts');
  assert.eq(k({ giveId: 'rockfruit', askId: 'wood', askQty: 3 }), k({ giveId: 'rockfruit', askId: 'wood', askQty: 5 }), 'a barter is its goods, not the count');
  assert.truthy(k({ giveId: 'rockfruit', askId: 'wood' }) !== k({ giveId: 'rockfruit', askId: 'stone' }), 'a different ask is a different deal');
  assert.eq(k('starfruit_seed'), 'starfruit_seed', 'a themed pick is its id');
  assert.eq(k(null), ''); assert.eq(k(undefined), '');
});

test('rerollPeek: skips pivot the seeded stream and the ladder\'s cost ignores them', () => {
  const save = { offerSalt: 7 };
  const house = { id: 'shopR' };
  const b = ShopsMath.bucket('shopR', 0);
  const first = (rec) => { save.shopState = { shopR: { ...rec } }; return ShopsMath.rng(save, house, 'pool', 0)(); };
  const base = first({ bucket: b, deals: 0, rerolls: 1 });
  assert.eq(first({ bucket: b, deals: 0, rerolls: 1, skips: 0 }), base, 'skips 0 is the old seed exactly');
  assert.truthy(first({ bucket: b, deals: 0, rerolls: 1, skips: 1 }) !== base, 'a skip re-draws');
  assert.truthy(first({ bucket: b, deals: 0, rerolls: 1, skips: 2 }) !== first({ bucket: b, deals: 0, rerolls: 1, skips: 1 }), 'and each skip differently');
  // The cost curves read rerolls alone: a re-roll that skipped three times
  // costs the same next time as one that did not.
  assert.eq(ShopsMath.smithyRerollCost(1), ShopsMath.smithyRerollCost(1));
  save.shopState = { shopR: { bucket: b, deals: 0, rerolls: 1, skips: 3 } };
  assert.eq(ShopsMath.bucketState(save, house, 0).rerolls, 1, 'the record reads one rung');
  // A new hour drops the skips with the offer they belonged to.
  const later = ShopsMath.bucketState(save, house, ShopsMath.HOUR * 1);
  assert.eq(later.skips, undefined, 'carried forward without skips');
  assert.eq(later.rerolls, 0, 'and eased as before');
});

test('rerollPeek: every re-roll button draws through it with what is on display', () => {
  const src = SCENE_SRC;
  const shared = src.slice(src.indexOf('  _makeRerollSecondary('), src.indexOf('  presentThemedShop('));
  assert.truthy(/const next = ShopsMath\.rerollPeek\(curState, peek, opts\.current\);/.test(shared), 'the shared button');
  assert.falsy(/curState\.rerolls \+= 1/.test(shared), 'and bumps the ladder nowhere else');
  const trader = src.slice(src.indexOf('  presentTraderOffer('), src.indexOf('  // REST: a flat CASTLE_REST_ENERGY'));
  assert.truthy(/\{ cost: ShopsMath\.traderRerollCost, peek: \(\) => this\.peekOrBuildTraderOffer\(house\), current: offer \}/.test(trader),
    'the trader rides the shared button with its own peek and ladder');
  assert.falsy(/curState\.rerolls \+= 1|ShopsMath\.rerollPeek\(/.test(trader), 'and draws nowhere else');
  // Each caller names its current offer.
  assert.truthy(/peek: \(\) => this\.themedShopPick\(house\), current: id \}/.test(src), 'the themed shelf: the item id');
  assert.truthy(/\{ cost: ShopsMath\.smithyRerollCost, current: offer \}/.test(src), 'the smithy: the forge target');
  assert.truthy(/\{ \.\.\.rerollOpts, current: offer \}/.test(src), 'the relic stall: the piece');
});
