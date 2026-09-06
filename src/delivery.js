// Delivery core — the seeded produce-demand logic extracted from app.js so
// it's testable headlessly (no scene, no DOM).
//
// Plain (residential) houses each ask for a 1-3 item produce "wishlist". A
// house is LOCKED to the first wishlist it ever shows: the roll is pinned in
// save.houseWishlists the first time it is made and read back from there ever
// after, so the ask a player walked away from is the ask that is waiting when
// they come back with the goods — whatever day it is and however far the tier
// cap has climbed since. (Until Sep 2026 the list re-rolled every UTC day, and
// the produce you gathered for a house on Tuesday was the wrong produce on
// Wednesday.) What still resets daily is the DELIVERY: one bundle per house
// per UTC day (isSatisfied), then the same ask again tomorrow.
//
// The first roll draws from every produce up to a tier cap that rises one step
// every 20 lifetime deliveries. The first houses you restore run a SCRIPTED
// opening ladder (see SCRIPTED_WISHLISTS) that starts at one item. The roll is
// deterministic in house.id alone, so even a save that never persisted the pin
// comes back to the same list; it's also cached on the house object.
//
// Everything here is a pure function of (save, house): the house._wantedProduce
// cache and the save.houseWishlists pin it writes are plain data, not scene
// state. The scene calls Delivery directly (dayKey / wanted / isSatisfied /
// isEarly …) from its interact and render paths. The one piece that stays in
// app.js is knownDeliveryHouses — it scans WorldGen.tileCache and uses the
// player's world position.
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

  // ── The scripted opening ladder ────────────────────────────────────────────
  // The first restored delivery houses don't roll — they walk a fixed list, so
  // a new player's first errands are legible and always gatherable. The ladder
  // is ordered by BUNDLE SIZE: the first SCRIPTED_SINGLES houses each want ONE
  // item, and only then do the multi-item bundles (the starter kitchen-garden
  // pair and the colored field-flower trio) appear — the same produce, asked
  // for one at a time first and then as a set. Index = houseOrder.
  //
  // Ids missing from a build are filtered out at roll time; an entry that ends
  // up empty falls through to the tier-1 early pool below, so the ladder can
  // never hand a house an item that doesn't exist.
  const SCRIPTED_WISHLISTS = [
    ['potato'],                                    // 0 — one crop, one delivery
    ['onion'],                                     // 1
    ['marigold'],                                  // 2 — first foraged flower
    ['forgetmenot'],                               // 3
    ['wildrose'],                                  // 4
    ['potato', 'onion'],                           // 5 — the starter kitchen-garden pair
    ['marigold', 'forgetmenot', 'wildrose'],       // 6 — the colored field-flower trio
  ];
  // Length of the leading run of single-item asks — derived from the table, so
  // adding or removing a single can't leave a hand-written count behind.
  const SCRIPTED_SINGLES = (() => {
    let n = 0;
    while (n < SCRIPTED_WISHLISTS.length && SCRIPTED_WISHLISTS[n].length === 1) n++;
    return n;
  })();
  // Houses pinned to TIER-1 produce: every scripted one, plus one more that
  // rolls freely inside tier 1 before standing houses open up to their themes.
  const EARLY_HOUSES = SCRIPTED_WISHLISTS.length + 1;

  // Themed wishlists — instead of a uniform grab-bag, every standing delivery
  // house has a "taste" so the bundle it asks for reads as a coherent set
  // ("the fisherman's cottage wants shells + a coconut", "the smithy row wants
  // coal + copper"). Each theme is an ordered pool of item ids; the roll draws
  // 2-3 from whichever items the tier cap has unlocked at the time. The theme
  // is stable per house (see bundleTheme), and so is the bundle drawn from it
  // once pinned (see wantedProduce).
  //
  // Pools are intentionally generous and span tiers so a theme always has at
  // least a couple of low-tier members for early players. Ids that aren't in a
  // given build are filtered out at roll time, so missing items are harmless.
  const BUNDLE_THEMES = {
    // Beach — sand + shore + shallows: shells, washed-up coconut, the fish ladder.
    beach:   ['shell', 'boot', 'minnow', 'bass', 'trout', 'salmon', 'goldenfish', 'coconut'],
    // Forage — wild-picked debris and prized foraged flora.
    forage:  ['flowers', 'longgrass', 'mushroom', 'berry', 'forgetmenot', 'marigold', 'wildrose', 'starflower'],
    // Mining — rock-break spoils and forge bars, climbing the gem/metal ladder.
    mining:  ['wood', 'coal', 'copper_bar', 'iron_bar', 'sapphire', 'gold_bar', 'ruby', 'platinum_bar', 'emerald', 'crimson_bar', 'frost_bar'],
    // Harvest — farmed crops and orchard fruit, the core farming loop.
    harvest: ['potato', 'rockfruit', 'berry', 'cress', 'onion', 'rainberry', 'pairy', 'nut',
              'apple', 'cherry', 'peach', 'apricot', 'orange', 'coffee', 'gemfruit', 'banana',
              'sunflower', 'fireflower', 'iceflower'],
    // Animal products — barnyard + butcher output: eggs, milk, meat, pelts, feathers.
    animal:  ['egg', 'milk', 'crow_feather', 'rabbit_pelt', 'meat'],
  };
  const BUNDLE_THEME_KEYS = Object.keys(BUNDLE_THEMES);

  // UTC day stamp "YYYYMMDD" — a delivery's "happy" state resets on the day
  // boundary (isSatisfied). The wishlist itself does NOT.
  function dayKey(now = new Date()) {
    return now.toISOString().slice(0, 10).replace(/-/g, '');
  }

  // Per-house RNG: FNV-1a hash of the house id seeds a small PRNG so a house
  // rolls the same wishlist every time it is asked. The day is deliberately
  // NOT in the seed — the pin in save.houseWishlists is the lock, and this
  // makes the roll agree with it even before the pin has been persisted.
  // Differs from the shop RNG (which rotates on the hour bucket).
  function wantedRng(house) {
    const h = fnv1a(String(house?.id || '') + '|wanted');
    return makeRng32(h);
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

  // The standing "taste" of a delivery house — one of BUNDLE_THEME_KEYS,
  // chosen by a stable FNV-1a hash of the house id alone (NOT the day), so a
  // household keeps the same theme every day while the items inside it rotate.
  function bundleTheme(house) {
    if (!house?.id) return BUNDLE_THEME_KEYS[0];
    const h = fnv1a(String(house.id) + '|theme');
    return BUNDLE_THEME_KEYS[h % BUNDLE_THEME_KEYS.length];
  }

  // First EARLY_HOUSES restored delivery houses get pinned to TIER-1 wishlists
  // (the scripted ladder plus the one free tier-1 roll that follows it).
  function isEarly(save, house) {
    const o = houseOrder(save, house);
    return o >= 0 && o < EARLY_HOUSES;
  }

  // Did this house already receive a bundle TODAY? (resets on the UTC boundary)
  function isSatisfied(save, house, now = new Date()) {
    if (!house?.id) return false;
    return (save.houseSatisfied?.[house.id]) === dayKey(now);
  }

  // Every sellable produce id in the build — the general fall-back pool when a
  // theme has too few tier-unlocked members to fill a bundle.
  function produceUniverse() {
    return (typeof ITEMS !== 'undefined')
      ? ITEMS.filter((i) => i.kind === 'produce').map((i) => i.id)
      : [];
  }

  // The pinned wishlist of a house, if it has one: the list it first asked
  // for, kept in save.houseWishlists. Ids the build no longer has are dropped;
  // a pin that ends up empty is treated as absent so the house rolls afresh
  // rather than asking for nothing forever.
  function pinnedProduce(save, house) {
    const pin = save?.houseWishlists?.[house.id];
    if (!Array.isArray(pin)) return null;
    const picks = pin.filter((id) => ITEM_BY_ID[id]);
    return picks.length ? picks : null;
  }

  // 1-3 item ids this plain house wants — the SAME 1-3 for the life of the
  // house. The first call rolls and pins the list in save.houseWishlists;
  // every later call, on any day and at any tier cap, reads the pin back.
  // Each standing house draws a COHERENT bundle from its theme (beach / forage
  // / mining / harvest / animal) limited to what the tier cap has unlocked, so
  // wishlists read as themed sets rather than a random grab-bag. Special cases:
  // the first SCRIPTED_WISHLISTS.length houses walk the scripted ladder (five
  // single-item asks, then the potato+onion pair, then the field-flower trio),
  // and the house after it is pinned to gentle TIER-1 produce before standing
  // houses open up to their full themes.
  function wantedProduce(save, house, now = new Date()) {
    if (!house?.id) return [];
    if (house._wantedProduce) return house._wantedProduce;
    const remember = (picks) => {
      house._wantedProduce = picks;
      return picks;
    };
    const pin = (picks) => {
      // Scripted asks are pinned too: they are fixed by restore order, but the
      // pin is what "this house's ask" MEANS from here on, so every house has
      // one and nothing has to know which kind of house it is reading.
      if (picks.length) {
        save.houseWishlists = save.houseWishlists || {};
        save.houseWishlists[house.id] = picks.slice();
      }
      return remember(picks);
    };

    const pinned = pinnedProduce(save, house);
    if (pinned) return remember(pinned);

    // Scripted opening progression, by restore order — one shared table so the
    // ladder can't drift from the counts documented above (SCRIPTED_WISHLISTS).
    const order = houseOrder(save, house);
    if (order >= 0 && order < SCRIPTED_WISHLISTS.length) {
      const picks = SCRIPTED_WISHLISTS[order].filter((id) => ITEM_BY_ID[id]);
      if (picks.length) return pin(picks);
    }

    const cap = tierCap(save);
    // Pick the pool this house draws from.
    let pool;
    if (isEarly(save, house)) {
      // Early houses only ask for TIER-1 produce (the starter loop never
      // demands a crop the player can't yet grow).
      const universe = produceUniverse();
      pool = universe.filter((id) => produceTier(id) <= 1);
      if (!pool.length) pool = universe.slice();
    } else {
      // Standing houses draw from their theme, limited to tier-unlocked items.
      // .filter returns a fresh array, so it's safe for the draw to splice it
      // without mutating the shared BUNDLE_THEMES pool.
      const theme = bundleTheme(house);
      pool = (BUNDLE_THEMES[theme] || [])
        .filter((id) => ITEM_BY_ID[id] && produceTier(id) <= cap);
      // Too few in-theme items unlocked yet → fall back to the general
      // tier-capped produce pool so the house still has a full set to ask for.
      if (pool.length < 2) {
        const universe = produceUniverse();
        pool = universe.filter((id) => produceTier(id) <= cap);
        if (!pool.length) pool = universe.slice();
      }
    }
    if (!pool.length) return remember([]);

    const rng = wantedRng(house);
    const count = 2 + Math.floor(rng() * 2);   // 2 or 3
    // Uniform draw without replacement from the chosen pool.
    const picks = [];
    while (picks.length < count && pool.length) {
      const idx = Math.floor(rng() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }
    return pin(picks);
  }

  root.Delivery = {
    PRODUCE_TIER_MIN, PRODUCE_TIER_MAX, TIER_UNLOCK_EVERY, BUNDLE_THEMES,
    SCRIPTED_WISHLISTS, SCRIPTED_SINGLES, EARLY_HOUSES,
    dayKey, wantedRng, produceTier, tierCap, houseOrder, isEarly, isSatisfied,
    bundleTheme, pinnedProduce, wantedProduce,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
