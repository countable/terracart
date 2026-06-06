// Delivery core — the seeded daily produce-demand logic extracted from app.js
// so it's testable headlessly (no scene, no DOM).
//
// Plain (residential) houses each ask for a 2-3 item produce "wishlist" that is
// re-rolled once per UTC day, drawn from every produce up to a tier cap that
// rises one step every 20 lifetime deliveries. The roll is deterministic in
// (house.id, day) so the render-loop sign and the interact handler agree
// without re-rolling, and it's cached on the house object per day.
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

  // Wishlists ask for produce up to a tier cap that climbs one step every
  // TIER_UNLOCK_EVERY deliveries: tier 1 to start, +1 per 20 deliveries, maxing
  // at tier 7 (~120 lifetime deliveries). Easy to remember: "every 20
  // deliveries, houses start wanting the next tier of crop."
  const PRODUCE_TIER_MIN = 1;
  const PRODUCE_TIER_MAX = 7;
  const TIER_UNLOCK_EVERY = 20;

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

  // Highest produce tier a wishlist will ask for, given the lifetime delivery
  // tally: tier 1, then +1 every TIER_UNLOCK_EVERY deliveries, capped at MAX.
  function tierCap(save) {
    const dc = save.deliveryCount ?? 0;
    return Math.min(PRODUCE_TIER_MAX, PRODUCE_TIER_MIN + Math.floor(dc / TIER_UNLOCK_EVERY));
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

  // 2-3 produce ids this plain house wants today, drawn from produce up to the
  // current tierCap and cached on the house per day. Special cases: the 4th
  // delivery house wants the foraged-flower trio; the first 3 are pinned to
  // TIER-1 produce.
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

    // Only ask for produce the player can plausibly grow yet: everything up to
    // the unlocked tier cap (falling back to the full set if nothing qualifies).
    const cap = tierCap(save);
    let pool = universe.filter((id) => produceTier(id) <= cap);
    if (!pool.length) pool = universe.slice();

    const rng = wantedRng(house, dk);
    const count = 2 + Math.floor(rng() * 2);   // 2 or 3
    // Uniform draw without replacement from the unlocked pool.
    const picks = [];
    while (picks.length < count && pool.length) {
      const idx = Math.floor(rng() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }
    house._wantedProduce = picks;
    house._wantedProduceDay = dk;
    return picks;
  }

  root.Delivery = {
    PRODUCE_TIER_MIN, PRODUCE_TIER_MAX, TIER_UNLOCK_EVERY,
    dayKey, wantedRng, produceTier, tierCap, houseOrder, isEarly, isSatisfied, wantedProduce,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
