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

// N plain houses named h0..h(N-1), so houseOrder(hK) === K.
function plainHouses(n) {
  const rh = {};
  for (let i = 0; i < n; i++) rh['h' + i] = 'plain';
  return rh;
}

test('houseOrder / isEarly: 0-based index among restored plain houses', () => {
  // Mixed roles; only 'plain' entries count, in insertion order.
  const save = { restoredHouses: { a: 'plain', shop: 'blacksmith', b: 'plain', c: 'plain', d: 'plain' } };
  assert.eq(Delivery.houseOrder(save, { id: 'a' }), 0);
  assert.eq(Delivery.houseOrder(save, { id: 'b' }), 1, 'blacksmith skipped, not counted');
  assert.eq(Delivery.houseOrder(save, { id: 'd' }), 3);
  assert.eq(Delivery.houseOrder(save, { id: 'shop' }), -1, 'non-plain → -1');
  assert.eq(Delivery.houseOrder(save, { id: 'ghost' }), -1, 'unknown → -1');
  const last = Delivery.EARLY_HOUSES - 1;
  const wide = { restoredHouses: plainHouses(Delivery.EARLY_HOUSES + 1) };
  assert.eq(Delivery.isEarly(wide, { id: 'h0' }), true, 'order 0 is early');
  assert.eq(Delivery.isEarly(wide, { id: 'h' + last }), true, 'the last early order is early');
  assert.eq(Delivery.isEarly(wide, { id: 'h' + Delivery.EARLY_HOUSES }), false,
    'the first order past EARLY_HOUSES is not early');
  assert.eq(Delivery.isEarly(save, { id: 'ghost' }), false, 'not a delivery house → not early');
});

test('isSatisfied: matches today’s day key in save.houseSatisfied', () => {
  const save = { houseSatisfied: { h1: '20260606' } };
  assert.eq(Delivery.isSatisfied(save, { id: 'h1' }, JUNE6), true, 'stamped today → happy');
  assert.eq(Delivery.isSatisfied(save, { id: 'h1' }, new Date('2026-06-07T00:00:00Z')), false, 'stale → asks again');
  assert.eq(Delivery.isSatisfied(save, { id: 'h2' }, JUNE6), false, 'never fed → asks');
});

test('wantedProduce: 2-3 real produce ids, deterministic + cached per day', () => {
  // 'h' lands past the scripted ladder, so it rolls a real bundle.
  const save = { deliveryCount: 50, restoredHouses: { ...plainHouses(Delivery.EARLY_HOUSES), h: 'plain' } };
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

test('SCRIPTED_SINGLES: the ladder opens with a run of FIVE single-item asks', () => {
  const ladder = Delivery.SCRIPTED_WISHLISTS;
  assert.eq(Delivery.SCRIPTED_SINGLES, 5, 'five houses in a row want exactly one item');
  for (let i = 0; i < Delivery.SCRIPTED_SINGLES; i++) {
    assert.eq(ladder[i].length, 1, 'scripted house ' + i + ' asks for a single item');
  }
  assert.truthy(ladder.length > Delivery.SCRIPTED_SINGLES, 'bundles follow the singles');
  assert.truthy(ladder[Delivery.SCRIPTED_SINGLES].length > 1, 'the first non-single is a bundle');
  // Every id in the ladder is real produce. Deliberately NOT a tier assertion:
  // the ladder is hand-picked and overrides the early tier cap — the onion is a
  // T2 whose seed the first market stocks, and the three field flowers are
  // T2/T3 only because they're foraged wild plants (biome_profiles.js spawns
  // them in grassland/forest), not crops the tier cap gates.
  for (const w of ladder) {
    for (const id of w) {
      assert.truthy(ITEM_BY_ID[id] && ITEM_BY_ID[id].kind === 'produce', id + ' is real produce');
    }
  }
  // The bundles are drawn from the SAME produce the singles already asked for —
  // the shifted-later pair/trio, not new demands.
  const singles = new Set(ladder.slice(0, Delivery.SCRIPTED_SINGLES).flat());
  for (const w of ladder.slice(Delivery.SCRIPTED_SINGLES)) {
    for (const id of w) assert.truthy(singles.has(id), id + ' was already asked for as a single');
  }
});

test('wantedProduce: the first five houses each ask for ONE item', () => {
  const save = { deliveryCount: 80, restoredHouses: plainHouses(Delivery.SCRIPTED_SINGLES) };
  const seen = [];
  for (let i = 0; i < Delivery.SCRIPTED_SINGLES; i++) {
    const got = Delivery.wantedProduce(save, { id: 'h' + i }, JUNE6);
    assert.eq(got.length, 1, 'house ' + i + ' wants a single item');
    assert.eq(JSON.stringify(got), JSON.stringify(Delivery.SCRIPTED_WISHLISTS[i]), 'follows the ladder');
    seen.push(got[0]);
  }
  assert.eq(JSON.stringify(seen), JSON.stringify(['potato', 'onion', 'marigold', 'forgetmenot', 'wildrose']),
    'potato, onion, then the three field flowers — one per house');
  assert.eq(new Set(seen).size, seen.length, 'no house repeats another single');
});

test('wantedProduce: the pair + trio are SHIFTED behind the singles', () => {
  const save = { deliveryCount: 80, restoredHouses: plainHouses(Delivery.SCRIPTED_WISHLISTS.length) };
  const pair = Delivery.wantedProduce(save, { id: 'h5' }, JUNE6);
  assert.eq(JSON.stringify(pair), JSON.stringify(['potato', 'onion']), 'starter kitchen-garden pair, 6th');
  const trio = Delivery.wantedProduce(save, { id: 'h6' }, JUNE6);
  assert.eq(JSON.stringify(trio), JSON.stringify(['marigold', 'forgetmenot', 'wildrose']),
    'three field flowers, 7th');
});

test('wantedProduce: the early house past the ladder asks only for TIER-1 produce', () => {
  // The scripted orders are pinned; the next one is the first to hit the early
  // random pool, and it is still capped at tier 1.
  const order = Delivery.SCRIPTED_WISHLISTS.length;
  const save = { deliveryCount: 80, restoredHouses: plainHouses(order + 1) };
  const house = { id: 'h' + order };
  assert.eq(Delivery.isEarly(save, house), true, 'still an early house');
  const got = Delivery.wantedProduce(save, house, JUNE6);
  assert.inRange(got.length, 2, 3, 'back to a 2-3 item bundle');
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
  // Fully unlocked tier cap, and 'e' sits one past the early window, so it
  // should draw from its theme pool rather than the scripted ladder.
  const save = {
    deliveryCount: 500,
    restoredHouses: { ...plainHouses(Delivery.EARLY_HOUSES), e: 'plain', f: 'plain' },
  };
  const house = { id: 'e' };
  assert.eq(Delivery.houseOrder(save, house), Delivery.EARLY_HOUSES, 'house e is the first standing house');
  assert.eq(Delivery.isEarly(save, house), false, 'past the early window');
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
