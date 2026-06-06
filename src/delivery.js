// Delivery core — the seeded daily produce-demand logic extracted from app.js
// so it's testable headlessly (no scene, no DOM).
//
// Plain (residential) houses each ask for a 2-3 item produce "wishlist" that is
// re-rolled once per UTC day and biased toward a tier that ramps with the
// player's lifetime delivery count. The roll is deterministic in (house.id, day)
// so the render-loop sign and the interact handler agree without re-rolling, and
// it's cached on the house object per day.
//
// Everything here is a pure function of (save, house): the house._wantedProduce
// cache it writes is plain data, not scene state. The scene keeps thin wrappers
// (app.js _deliveryDayKey / wantedProduce / isHouseSatisfied / …). The one piece
// that stays in app.js is knownDeliveryHouses — it scans WorldGen.tileCache and
// uses the player's world position.
//
// Depends on globals from items.js: ITEM_BY_ID, ITEMS, BASE_TIER.

(function (root) {
  'use strict';

  // Wishlist tier ramps linearly from MIN (at 0 lifetime deliveries) to MAX (at
  // CAP deliveries and beyond). Moved here from app.js — only targetTier reads them.
  const PRODUCE_TIER_MIN = 1;
  const PRODUCE_TIER_MAX = 7;
  const DELIVERY_TIER_CAP = 100;

  // UTC day stamp "YYYYMMDD" — wishlists reset on the day boundary.
  function dayKey(now = new Date()) {
    return now.toISOString().slice(0, 10).replace(/-/g, '');
  }

  // Per-house, per-day RNG: FNV-1a hash of `id|day` seeds a small PRNG so each
  // house rolls a new-but-stable wishlist each day. Differs from the shop RNG
  // (which rotates on the hour bucket).
  function wantedRng(house, dk) {
    let h = 2166136261 >>> 0;
    const s = String(house?.id || '') + '|' + String(dk || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    let state = h;
    return () => {
      state = (Math.imul(state, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
      t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Rarity tier (1..7) a produce id sits at — baseTier on the ITEM record, else
  // the shared BASE_TIER table, else 1.
  function produceTier(id) {
    return (ITEM_BY_ID[id]?.baseTier)
      ?? ((typeof BASE_TIER !== 'undefined') ? BASE_TIER[id] : undefined)
      ?? 1;
  }

  // The (float) tier the day's wishlists are centred on, ramping with the
  // lifetime delivery tally.
  function targetTier(save) {
    const dc = save.deliveryCount ?? 0;
    const t = Math.min(1, dc / DELIVERY_TIER_CAP);
    return PRODUCE_TIER_MIN + t * (PRODUCE_TIER_MAX - PRODUCE_TIER_MIN);
  }

  // 0-based position of this house among restored 'plain' (delivery) houses in
  // restore order; -1 if it isn't a restored delivery house. restoredHouses keys
  // preserve insertion order.
  function houseOrder(save, house) {
    if (!house?.id) return -1;
    const rh = save.restoredHouses || {};
    if (rh[house.id] !== 'plain') return -1;
    let n = 0;
    for (const id of Object.keys(rh)) {
      if (rh[id] !== 'plain') continue;
      if (id === house.id) return n;
      n++;
    }
    return -1;
  }

  // First 3 restored delivery houses get pinned to TIER-1 wishlists.
  function isEarly(save, house) {
    const o = houseOrder(save, house);
    return o >= 0 && o < 3;
  }

  // Did this house already receive a bundle TODAY? (resets on the UTC boundary)
  function isSatisfied(save, house, now = new Date()) {
    if (!house?.id) return false;
    return (save.houseSatisfied?.[house.id]) === dayKey(now);
  }

  // 2-3 produce ids this plain house wants today, biased toward targetTier and
  // cached on the house per day. Special cases: the 4th delivery house wants the
  // foraged-flower trio; the first 3 are pinned to TIER-1 produce.
  function wantedProduce(save, house, now = new Date()) {
    if (!house?.id) return [];
    const dk = dayKey(now);
    if (house._wantedProduce && house._wantedProduceDay === dk) return house._wantedProduce;

    // 4th delivery house → scripted foraged-flower trio (nudge toward picking).
    if (houseOrder(save, house) === 3) {
      const trio = ['forgetmenot', 'marigold', 'wildrose'].filter((id) => ITEM_BY_ID[id]);
      if (trio.length) {
        house._wantedProduce = trio;
        house._wantedProduceDay = dk;
        return trio;
      }
    }

    let universe = (typeof ITEMS !== 'undefined')
      ? ITEMS.filter((i) => i.kind === 'produce').map((i) => i.id)
      : [];
    if (!universe.length) return [];

    // First 3 houses only ask for TIER-1 produce (the starter loop never demands
    // a crop the player can't yet grow).
    if (isEarly(save, house)) {
      const t1 = universe.filter((id) => produceTier(id) <= 1);
      if (t1.length) universe = t1;
    }

    const rng = wantedRng(house, dk);
    const count = 2 + Math.floor(rng() * 2);   // 2 or 3
    const target = targetTier(save);
    // Weighted draw without replacement: weight falls off with distance from the
    // target tier, so picks cluster around it with the odd neighbour for variety.
    const pool = universe.map((id) => ({ id, w: 1 / (1 + Math.abs(produceTier(id) - target)) }));
    const picks = [];
    while (picks.length < count && pool.length) {
      const total = pool.reduce((a, p) => a + p.w, 0);
      let r = rng() * total;
      let idx = 0;
      while (idx < pool.length - 1 && (r -= pool[idx].w) > 0) idx++;
      picks.push(pool.splice(idx, 1)[0].id);
    }
    house._wantedProduce = picks;
    house._wantedProduceDay = dk;
    return picks;
  }

  root.Delivery = {
    PRODUCE_TIER_MIN, PRODUCE_TIER_MAX, DELIVERY_TIER_CAP,
    dayKey, wantedRng, produceTier, targetTier, houseOrder, isEarly, isSatisfied, wantedProduce,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
