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
