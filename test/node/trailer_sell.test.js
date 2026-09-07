// What the TRAILER pays for a haul.
//
// Home is the ONLY place the player can cash out (shopInteract routes selling
// to the starter trailer and nowhere else), so the trailer payout IS the sell
// economy. It is the sword-scaled price (sellMultiplier, items.js) less a flat
// 25% haircut — TRAILER_SELL_MUL — and both halves matter: the sword ladder
// still governs how much better selling gets as the player levels, the haircut
// only sets where the whole ladder sits.
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

const swords = [0, 1, 2, 3, 4, 5, 6, 7];

test('trailer sell: a flat 25% off the sword-scaled price', () => {
  assert.eq(TRAILER_SELL_MUL, 0.75, 'the haircut is 25%');
  for (const t of swords) {
    const relics = { sword: { tier: t } };
    assert.lte(Math.abs(trailerSellMultiplier(relics) - sellMultiplier(relics) * 0.75), 1e-9,
      `tier ${t} pays three quarters of the sword-scaled rate`);
  }
  // No sword → 0.5 × 0.75; Frost → 1.0 × 0.75.
  assert.lte(Math.abs(trailerSellMultiplier(null) - 0.375), 1e-9, 'bare-handed pays 0.375× base');
  assert.lte(Math.abs(trailerSellMultiplier({ sword: { tier: 7 } }) - 0.75), 1e-9, 'Frost pays 0.75× base');
});

test('trailer sell: prices are whole dollars, floored at $1', () => {
  for (const t of swords) {
    const relics = { sword: { tier: t } };
    for (const base of [1, 2, 3, 5, 7, 40, 999]) {
      const p = trailerSellPrice(base, relics);
      assert.gte(p, 1, `$${base} at tier ${t} pays at least $1`);
      assert.eq(p, Math.round(p), 'whole dollars');
      assert.lte(p, Math.max(1, base), 'never pays more than the listed value');
    }
  }
  assert.eq(trailerSellPrice(undefined, null), 1, 'an unpriced item still pays the $1 floor');
});

test('trailer sell: exactly 25% below what the old (unhaircut) sale paid', () => {
  // The old price, as app.js computed it before the haircut shipped.
  const oldPrice = (base, relics) => Math.max(1, Math.ceil(base * sellMultiplier(relics)));
  const bases = Object.values(PRICES).filter((v) => Number.isFinite(v) && v > 0);
  assert.gt(bases.length, 50, 'PRICES really loaded (guard against a vacuous pass)');
  for (const t of swords) {
    const relics = { sword: { tier: t } };
    for (const base of bases) {
      const now = trailerSellPrice(base, relics);
      // Ceil + the $1 floor mean the per-item cut is 25% up to rounding, never
      // an increase, and never more than a dollar off the exact three quarters.
      assert.lte(now, oldPrice(base, relics), `base $${base} tier ${t} never pays more than before`);
      assert.lte(Math.abs(now - base * sellMultiplier(relics) * 0.75), 1,
        `base $${base} tier ${t} lands within rounding of three quarters`);
    }
  }
});

test('trailer sell: monotonic in the sword tier (a better sword never pays less)', () => {
  for (const base of [5, 40, 250]) {
    let prev = -Infinity;
    for (const t of swords) {
      const p = trailerSellPrice(base, { sword: { tier: t } });
      assert.gte(p, prev, `$${base}: tier ${t} never pays less than tier ${t - 1}`);
      prev = p;
    }
  }
});

test('trailer sell: NO ARBITRAGE — buy at a stand, cash out at home, never profit', () => {
  // The stand floor prices off sellMultiplier, not off the trailer payout, so
  // the haircut can only widen this margin. Swept over every real price and
  // every sword tier, because rounding is where a one-dollar leak would hide.
  const bases = Object.values(PRICES).filter((v) => Number.isFinite(v) && v > 0);
  const leaks = [];
  for (const t of swords) {
    const relics = { sword: { tier: t } };
    for (const base of bases) {
      const pay  = ShopsMath.standPrice({ relics }, base);
      const back = trailerSellPrice(base, relics);
      if (back > pay) leaks.push(`sword T${t}, base $${base}: pay $${pay}, home pays $${back}`);
    }
  }
  assert.eq(leaks.length, 0, 'stand→home must never pay out: ' + leaks.slice(0, 5).join('; '));
});

// app.js can't load headlessly, so the shipping call site is pinned as source
// text (APP_JS_SRC, lifted by run.js) — the same trick feet_anchor.test.js uses.
test('trailer sell: the home sale in app.js goes through trailerSellPrice', () => {
  const app = APP_JS_SRC;
  assert.truthy(/trailerSellPrice\(PRICES\[sel\.id\] \?\? 1, this\.save\.relics\)/.test(app),
    'the home sell modal prices via trailerSellPrice');
  assert.falsy(/const sellMul = \(typeof sellMultiplier === 'function'\) \? sellMultiplier\(this\.save\.relics\)/.test(app),
    'the old un-haircut sellMultiplier price is gone from app.js');
});

})();
