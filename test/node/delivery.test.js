// Headless tests for the delivery core (src/delivery.js) — the seeded daily
// produce-demand logic extracted from app.js.

const JUNE6 = new Date('2026-06-06T12:00:00Z');

test('dayKey: UTC YYYYMMDD, stable within a day, flips on the boundary', () => {
  assert.eq(Delivery.dayKey(JUNE6), '20260606');
  assert.eq(Delivery.dayKey(new Date('2026-06-06T23:59:59Z')), '20260606', 'same day');
  assert.eq(Delivery.dayKey(new Date('2026-06-07T00:00:00Z')), '20260607', 'next day');
});

test('wantedRng: deterministic per (house.id, day), differs across either', () => {
  const seq = (id, dk) => { const r = Delivery.wantedRng({ id }, dk); return [r(), r(), r()]; };
  assert.eq(JSON.stringify(seq('h1', '20260606')), JSON.stringify(seq('h1', '20260606')), 'stable');
  assert.truthy(JSON.stringify(seq('h1', '20260606')) !== JSON.stringify(seq('h2', '20260606')), 'house varies');
  assert.truthy(JSON.stringify(seq('h1', '20260606')) !== JSON.stringify(seq('h1', '20260607')), 'day varies');
  for (const v of seq('h1', '20260606')) assert.inRange(v, 0, 1, 'rng in [0,1)');
});

test('produceTier: reads catalog baseTier, defaults to 1', () => {
  assert.eq(Delivery.produceTier('potato'), 1, 'potato is T1');
  assert.eq(Delivery.produceTier('definitely-not-an-item'), 1, 'unknown defaults to 1');
});

test('tierCap: steps up one tier every TIER_UNLOCK_EVERY deliveries, clamped at MAX', () => {
  const step = Delivery.TIER_UNLOCK_EVERY;
  assert.eq(Delivery.tierCap({ deliveryCount: 0 }), Delivery.PRODUCE_TIER_MIN, 'starts at MIN');
  assert.eq(Delivery.tierCap({ deliveryCount: step - 1 }), Delivery.PRODUCE_TIER_MIN, 'still MIN just before the first step');
  assert.eq(Delivery.tierCap({ deliveryCount: step }), Delivery.PRODUCE_TIER_MIN + 1, '+1 tier at the first step');
  assert.eq(Delivery.tierCap({ deliveryCount: step * 2 }), Delivery.PRODUCE_TIER_MIN + 2, '+2 tiers at the second step');
  const toMax = (Delivery.PRODUCE_TIER_MAX - Delivery.PRODUCE_TIER_MIN) * step;
  assert.eq(Delivery.tierCap({ deliveryCount: toMax }), Delivery.PRODUCE_TIER_MAX, 'reaches MAX');
  assert.eq(Delivery.tierCap({ deliveryCount: toMax * 5 }), Delivery.PRODUCE_TIER_MAX, 'clamped past MAX');
});

test('houseOrder / isEarly: 0-based index among restored plain houses', () => {
  // Mixed roles; only 'plain' entries count, in insertion order.
  const save = { restoredHouses: { a: 'plain', shop: 'blacksmith', b: 'plain', c: 'plain', d: 'plain' } };
  assert.eq(Delivery.houseOrder(save, { id: 'a' }), 0);
  assert.eq(Delivery.houseOrder(save, { id: 'b' }), 1, 'blacksmith skipped, not counted');
  assert.eq(Delivery.houseOrder(save, { id: 'd' }), 3);
  assert.eq(Delivery.houseOrder(save, { id: 'shop' }), -1, 'non-plain → -1');
  assert.eq(Delivery.houseOrder(save, { id: 'ghost' }), -1, 'unknown → -1');
  assert.eq(Delivery.isEarly(save, { id: 'a' }), true, 'order 0 is early');
  assert.eq(Delivery.isEarly(save, { id: 'c' }), true, 'order 2 is early');
  assert.eq(Delivery.isEarly(save, { id: 'd' }), false, 'order 3 is not early');
});

test('isSatisfied: matches today’s day key in save.houseSatisfied', () => {
  const save = { houseSatisfied: { h1: '20260606' } };
  assert.eq(Delivery.isSatisfied(save, { id: 'h1' }, JUNE6), true, 'stamped today → happy');
  assert.eq(Delivery.isSatisfied(save, { id: 'h1' }, new Date('2026-06-07T00:00:00Z')), false, 'stale → asks again');
  assert.eq(Delivery.isSatisfied(save, { id: 'h2' }, JUNE6), false, 'never fed → asks');
});

test('wantedProduce: 2-3 real produce ids, deterministic + cached per day', () => {
  const save = { deliveryCount: 50, restoredHouses: { h: 'plain', x: 'plain', y: 'plain', z: 'plain' } };
  const got = Delivery.wantedProduce(save, { id: 'h' }, JUNE6);
  assert.inRange(got.length, 2, 3, 'asks for 2-3 items');
  for (const id of got) assert.truthy(ITEM_BY_ID[id] && ITEM_BY_ID[id].kind === 'produce', id + ' is real produce');
  // Same id + day on a fresh house object → identical roll.
  const again = Delivery.wantedProduce(save, { id: 'h' }, JUNE6);
  assert.eq(JSON.stringify(again), JSON.stringify(got), 'deterministic for (id, day)');
  // Cache: a repeat call on the SAME object returns the cached array (no re-roll).
  const house = { id: 'h' };
  const first = Delivery.wantedProduce(save, house, JUNE6);
  assert.eq(Delivery.wantedProduce(save, house, JUNE6), first, 'returns the cached reference');
  assert.eq(house._wantedProduceDay, '20260606', 'cache stamped with the day');
});

test('wantedProduce: 1st house is scripted to potato + onion', () => {
  const save = { deliveryCount: 80, restoredHouses: { h: 'plain' } };   // h → order 0
  const got = Delivery.wantedProduce(save, { id: 'h' }, JUNE6);
  assert.eq(JSON.stringify(got), JSON.stringify(['potato', 'onion']), 'starter kitchen-garden pair');
});

test('wantedProduce: 2nd house is scripted to the colored field-flower trio', () => {
  const save = { deliveryCount: 80, restoredHouses: { a: 'plain', h: 'plain' } };   // h → order 1
  const got = Delivery.wantedProduce(save, { id: 'h' }, JUNE6);
  assert.eq(JSON.stringify(got), JSON.stringify(['marigold', 'forgetmenot', 'wildrose']), 'three field flowers');
});

test('wantedProduce: early house (order 2) asks only for TIER-1 produce', () => {
  // Orders 0/1 are scripted; order 2 is the first to hit the early random pool.
  const save = { deliveryCount: 80, restoredHouses: { a: 'plain', b: 'plain', h: 'plain' } };   // h → order 2
  const got = Delivery.wantedProduce(save, { id: 'h' }, JUNE6);
  for (const id of got) assert.eq(Delivery.produceTier(id), 1, id + ' must be T1 for an early house');
});

test('bundleTheme: stable per house id, always a known theme key', () => {
  const keys = Object.keys(Delivery.BUNDLE_THEMES);
  assert.truthy(keys.length >= 2, 'there are multiple themes');
  const t1 = Delivery.bundleTheme({ id: 'house-42' });
  assert.truthy(keys.includes(t1), 'theme is one of the known keys');
  assert.eq(Delivery.bundleTheme({ id: 'house-42' }), t1, 'same id → same theme');
  // Different ids should spread across themes (not all collapse to one).
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(Delivery.bundleTheme({ id: 'h' + i }));
  assert.truthy(seen.size >= 2, 'distinct ids reach more than one theme');
});

test('wantedProduce: a standing house draws a coherent bundle from its theme', () => {
  // 6 plain houses, fully unlocked tier cap → house "e" (order 4) is past the
  // early/4th special cases, so it should draw from its theme pool.
  const save = {
    deliveryCount: 500,
    restoredHouses: { a: 'plain', b: 'plain', c: 'plain', d: 'plain', e: 'plain', f: 'plain' },
  };
  const house = { id: 'e' };
  assert.eq(Delivery.houseOrder(save, house), 4, 'house e is order 4 (not early, not the 4th)');
  const theme = Delivery.bundleTheme(house);
  const pool = Delivery.BUNDLE_THEMES[theme];
  const got = Delivery.wantedProduce(save, house, JUNE6);
  assert.inRange(got.length, 2, 3, 'asks for 2-3 items');
  for (const id of got) {
    assert.truthy(ITEM_BY_ID[id], id + ' is a real item');
    assert.truthy(pool.includes(id), id + ' belongs to the "' + theme + '" theme');
  }
  // Deterministic per (id, day) on a fresh house object.
  const again = Delivery.wantedProduce(save, { id: 'e' }, JUNE6);
  assert.eq(JSON.stringify(again), JSON.stringify(got), 'deterministic for (id, day)');
});

test('wantedProduce: the 4th house (order 3) asks for the foraged-flower trio', () => {
  const trio = ['forgetmenot', 'marigold', 'wildrose'];
  if (!trio.every((id) => ITEM_BY_ID[id])) return;   // skip if the flower items aren't in this build
  const save = { deliveryCount: 10, restoredHouses: { a: 'plain', b: 'plain', c: 'plain', d: 'plain' } };
  const got = Delivery.wantedProduce(save, { id: 'd' }, JUNE6);
  assert.eq(JSON.stringify(got), JSON.stringify(trio), 'order-3 house gets the scripted trio');
});
