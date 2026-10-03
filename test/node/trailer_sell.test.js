// What the TRAILER pays for a haul.
//
// Home is the ONLY place the player can cash out (shopInteract routes selling
// to the starter trailer and nowhere else), so the trailer payout IS the sell
// economy. It is the sell rate (sellMultiplier, items.js — ONE flat number
// since Oct 2026; the Sword relic used to scale it, which made a weapon a
// haggling tool) less a flat 25% haircut, TRAILER_SELL_MUL.
//
// Two things these pin that a re-tune could quietly break:
//   • the haircut is applied ONCE, in one place — trailerSellPrice — and the
//     shipping call site in app.js goes through it, so the price the modal
//     quotes can't drift from the cash addMoney pays;
//   • lowering the payout must not open an arbitrage against the roadside
//     stands, whose floor prices off sellMultiplier (see shops_math.js). A
//     smaller payout can only widen that margin, never narrow it — pinned
//     exhaustively below so a later change in either direction is caught.

(function () {

test('trailer sell: the sell rate is one flat number — no relic moves it', () => {
  assert.eq(SELL_MUL, 0.7, 'the highest flat rate that leaves the stands their whole 25% discount');
  assert.eq(sellMultiplier(), SELL_MUL);
  assert.eq(sellMultiplier.length, 0, 'it reads nothing — not the relics, not the save');
  assert.truthy(/sword:\s*\{[^}]*effectKey: 'melee'/.test(ITEMS_JS_SRC), 'the sword is a weapon (effectKey melee), not a haggling tool');
  assert.falsy(/effectKey: 'sellPrice'/.test(ITEMS_JS_SRC), 'no relic carries a sell-price effect');
  assert.falsy(/sword/i.test(SCENE_SRC.slice(SCENE_SRC.indexOf('presentHomeSell(sx, sy) {'), SCENE_SRC.indexOf('presentHomeSell(sx, sy) {') + 4000)
    .replace(/\/\/[^\n]*/g, '')), 'the home sale reads no sword');
});

test('trailer sell: a flat 25% off the sell rate', () => {
  assert.eq(TRAILER_SELL_MUL, 0.75, 'the haircut is 25%');
  assert.lte(Math.abs(trailerSellMultiplier() - SELL_MUL * 0.75), 1e-9, 'pays three quarters of the sell rate');
});

test('trailer sell: prices are whole dollars, floored at $1', () => {
  for (const base of [1, 2, 3, 5, 7, 40, 999]) {
    const p = trailerSellPrice(base);
    assert.gte(p, 1, `$${base} pays at least $1`);
    assert.eq(p, Math.round(p), 'whole dollars');
    assert.lte(p, Math.max(1, base), 'never pays more than the listed value');
  }
  assert.eq(trailerSellPrice(undefined), 1, 'an unpriced item still pays the $1 floor');
});

test('trailer sell: within rounding of three quarters of the sell rate, for every real price', () => {
  const bases = Object.values(PRICES).filter((v) => Number.isFinite(v) && v > 0);
  assert.gt(bases.length, 50, 'PRICES really loaded (guard against a vacuous pass)');
  for (const base of bases) {
    const now = trailerSellPrice(base);
    assert.lte(now, Math.max(1, Math.ceil(base * sellMultiplier())), `base $${base} never pays more than the unhaircut rate`);
    assert.lte(Math.abs(now - base * sellMultiplier() * 0.75), 1, `base $${base} lands within rounding of three quarters`);
  }
});

test('trailer sell: NO ARBITRAGE — buy at a stand, cash out at home, never profit', () => {
  // The stand floor prices off sellMultiplier, not off the trailer payout, so
  // the haircut can only widen this margin. Swept over every real price,
  // because rounding is where a one-dollar leak would hide.
  const bases = Object.values(PRICES).filter((v) => Number.isFinite(v) && v > 0);
  const leaks = [];
  for (const base of bases) {
    const pay  = ShopsMath.standPrice({ relics: {} }, base);
    const back = trailerSellPrice(base);
    if (back > pay) leaks.push(`base $${base}: pay $${pay}, home pays $${back}`);
  }
  assert.eq(leaks.length, 0, 'stand→home must never pay out: ' + leaks.slice(0, 5).join('; '));
});

// app.js can't load headlessly, so the shipping call site is pinned as source
// text (SCENE_SRC, lifted by run.js) — the same trick feet_anchor.test.js uses.
test('trailer sell: the home sale in app.js goes through trailerSellPrice', () => {
  const app = SCENE_SRC;
  assert.truthy(/trailerSellPrice\(PRICES\[sel\.id\] \?\? 1\)/.test(app),
    'the home sell modal prices via trailerSellPrice, with nothing of the player\'s passed in');
  assert.falsy(/const sellMul = \(typeof sellMultiplier === 'function'\) \? sellMultiplier\(this\.save\.relics\)/.test(app),
    'the old un-haircut sellMultiplier price is gone from app.js');
});

})();
