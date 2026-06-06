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
