// Shop scheduling + pricing core — the per-house hour-bucket math, deal-rate
// ladder, seeded per-bucket RNG, and buy-price markup, extracted from app.js so
// they're testable headlessly (no scene, no DOM).
//
// A shop's offers are derived from a deterministic RNG keyed by (house.id,
// hour-bucket, rerolls, offerSalt, lane) so the same shop in the same hour shows
// the same offer without persisting the offer object; a per-house sub-hour
// offset staggers rotations. Deal counts + rerolls live in save.shopState,
// self-GC'd as buckets roll over.
//
// The scene keeps thin wrappers (app.js _shopBucket* / shopDealCap /
// shopReadiness / shopBucketState / shopRng / buildShopOffer). dealCap takes the
// scene-derived isStarterBlacksmith flag rather than reaching for a predicate.
//
// Depends on the global buyMarkupRange (items.js) for the Bow-discounted markup.
// Distinct from shops.js (Shops.shopType, the OSM-address → role lookup).

(function (root) {
  'use strict';

  const HOUR = 60 * 60 * 1000;

  // Per-shop sub-hour offset (FNV-1a on the id, mod 1h) so two shops don't
  // rotate at the same wall-clock minute.
  function bucketOffset(houseId) {
    let h = 2166136261 >>> 0;
    const s = String(houseId);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % HOUR;
  }

  // The integer hour-bucket index this house is in right now.
  function bucket(houseId, now = Date.now()) {
    return Math.floor((now + bucketOffset(houseId)) / HOUR);
  }

  // Per-house deal-rate ladder. castle/tower & the starter blacksmith never gate
  // (Infinity); forts (tier 11) allow 5/hour; small houses 1/hour.
  function dealCap(house, isStarterBlacksmith = false) {
    if (!house) return Infinity;
    if (house.kind === 'tower' || house.tier === 12) return Infinity;
    if (isStarterBlacksmith) return Infinity;
    if (house.tier === 11) return 5;
    return 1;
  }

  // Live { bucket, deals, rerolls } for a house, creating it and GC-ing any
  // stale-bucket predecessor on the way (self-cleaning — no separate sweep).
  function bucketState(save, house, now = Date.now()) {
    save.shopState = save.shopState || {};
    const id = house.id;
    const b = bucket(id, now);
    let cur = save.shopState[id];
    if (cur && cur.bucket !== b) cur = null;
    if (!cur) {
      cur = { bucket: b, deals: 0, rerolls: 0 };
      save.shopState[id] = cur;
    }
    return cur;
  }

  // Snapshot readiness: ready when a new deal would be accepted now; else
  // waitMin = wall-clock minutes until the next bucket. `cap` is supplied by the
  // caller (dealCap with the scene's isStarterBlacksmith flag).
  function readiness(save, house, cap, now = Date.now()) {
    if (cap === Infinity || !house || !house.id) {
      return { dealCap: cap, ready: true, waitMin: 0 };
    }
    const cur = bucketState(save, house, now);
    if (cur.deals < cap) return { dealCap: cap, ready: true, waitMin: 0 };
    const offset = bucketOffset(house.id);
    const nextBucketStart = (cur.bucket + 1) * HOUR - offset;
    const waitMin = Math.max(1, Math.ceil((nextBucketStart - now) / 60000));
    return { dealCap: cap, ready: false, waitMin };
  }

  // Deterministic 0..1 RNG keyed by (house.id offset, bucket, rerolls, offerSalt,
  // lane). `lane` namespaces independent rolls within a bucket so e.g. the price
  // roll can't consume the pool-pick roll.
  function rng(save, house, lane = '', now = Date.now()) {
    const cur = bucketState(save, house, now);
    let h = ((bucketOffset(house.id) >>> 0)
           ^ (cur.bucket >>> 0)
           ^ ((save.offerSalt || 0) >>> 0)
           ^ Math.imul(cur.rerolls + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < lane.length; i++) {
      h ^= lane.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    let s = h;
    return () => {
      s = (Math.imul(s, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
      t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Cash price to BUY an item worth baseValue. The Bow relic shrinks the markup:
  // no bow → 1.2..3.0× base; Bow T7 → a flat 1.0× (par). `r` defaults to
  // Math.random — pass a seeded one for a stable per-bucket price.
  function buyPrice(save, baseValue, r = Math.random) {
    const { lo, hi } = (typeof buyMarkupRange === 'function')
      ? buyMarkupRange(save.relics) : { lo: 1.2, hi: 3.0 };
    return Math.max(1, Math.ceil(baseValue * (lo + r() * (hi - lo))));
  }

  root.ShopsMath = { HOUR, bucketOffset, bucket, dealCap, bucketState, readiness, rng, buyPrice };
})(typeof globalThis !== 'undefined' ? globalThis : this);
