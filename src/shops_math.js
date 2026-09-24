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
// The scene calls ShopsMath directly from its shop helpers (app.js shopDealCap /
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
    return fnv1a(houseId) % HOUR;
  }

  // The integer hour-bucket index this house is in right now.
  function bucket(houseId, now = Date.now()) {
    return Math.floor((now + bucketOffset(houseId)) / HOUR);
  }

  // Per-house deal-rate ladder. castle/tower & the starter blacksmith never gate
  // (Infinity); forts (tier 11) allow 5/hour; small houses 1/hour.
  function dealCap(house, isStarterBlacksmith = false) {
    if (!house) return Infinity;
    // interactables.js loads after this module, so isCastle is resolved at CALL
    // time — which is the only time dealCap runs.
    if (isCastle(house)) return Infinity;
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

  // Garbage-collect stale-bucket entries out of save.shopState. render.js polls
  // readiness for every house it draws (even a house never once shopped at
  // gets an entry the first time its pip is painted), and nothing ever deleted
  // one, so the map grew by one entry per house EVER SEEN and never shrank.
  // Deleting a stale entry is lossless: it's exactly the predecessor
  // bucketState() already treats as dead and replaces with a fresh
  // { bucket, deals: 0, rerolls: 0 } the next time that house is touched, so
  // pruning it now costs nothing that wasn't already going to be rerolled.
  // Returns the number of entries removed.
  function pruneShopState(save, now = Date.now()) {
    if (!save || !save.shopState) return 0;
    let n = 0;
    for (const id of Object.keys(save.shopState)) {
      const cur = save.shopState[id];
      if (!cur || cur.bucket !== bucket(id, now)) {
        delete save.shopState[id];
        n++;
      }
    }
    return n;
  }

  // Milliseconds until this house's NEXT hourly bucket opens. Every house has
  // its own id-derived offset into the hour, so this is per-house, not "top of
  // the hour". Exposed because two callers besides readiness() need the raw
  // wait to write it in the shared largest-unit notation (util.js
  // shortDuration): the busy plaque over the roof, and the blacksmith whose
  // anvil is "resting" — that one is not rate-limited at all, it simply has no
  // offer this bucket, so its wait is the bucket roll and nothing else.
  function msToNextBucket(house, now = Date.now()) {
    if (!house || !house.id) return 0;
    const offset = bucketOffset(house.id);
    return (bucket(house.id, now) + 1) * HOUR - offset - now;
  }

  // Snapshot readiness: ready when a new deal would be accepted now; else
  // waitMs / waitMin = wall-clock time until the next bucket. `cap` is supplied
  // by the caller (dealCap with the scene's isStarterBlacksmith flag).
  // waitMs is what the labels format (it can say "1h" on a full bucket, where
  // rounded minutes could only ever say "60m"); waitMin is a test seam — no
  // production caller reads it (shops_math.test.js / duration_notation.test.js
  // pin it), it just keeps the rounded-minute figure inspectable.
  function readiness(save, house, cap, now = Date.now()) {
    if (cap === Infinity || !house || !house.id) {
      return { dealCap: cap, ready: true, waitMs: 0, waitMin: 0 };
    }
    const cur = bucketState(save, house, now);
    if (cur.deals < cap) return { dealCap: cap, ready: true, waitMs: 0, waitMin: 0 };
    const waitMs = Math.max(0, msToNextBucket(house, now));
    const waitMin = Math.max(1, Math.ceil(waitMs / 60000));
    return { dealCap: cap, ready: false, waitMs, waitMin };
  }

  // Deterministic 0..1 RNG keyed by (house.id offset, bucket, rerolls, offerSalt,
  // lane). `lane` namespaces independent rolls within a bucket so e.g. the price
  // roll can't consume the pool-pick roll.
  function rng(save, house, lane = '', now = Date.now()) {
    const cur = bucketState(save, house, now);
    const seed = ((bucketOffset(house.id) >>> 0)
                ^ (cur.bucket >>> 0)
                ^ ((save.offerSalt || 0) >>> 0)
                ^ Math.imul(cur.rerolls + 1, 0x9e3779b1)) >>> 0;
    // The lane name is folded onto that seed with util.js' fnv1a loop — the
    // same prime and order fnv1a() itself uses, just started from here rather
    // than from the FNV offset basis (util.js › fnv1aFrom).
    return makeRng32(fnv1aFrom(seed, lane));
  }

  // Cash price to BUY an item worth baseValue. The Bow relic shrinks the markup:
  // no bow → 1.2..3.0× base; Bow T7 → a flat 1.0× (par). `r` defaults to
  // Math.random — pass a seeded one for a stable per-bucket price.
  // `markupScale` shrinks the MARKUP (the part of the multiplier above par),
  // never the list price under it: a scale of 0.5 turns a 3.0× roll into
  // 2.0× and leaves a 1.0× roll at par. A fort's quartermaster charges
  // FORT_MARKUP_SCALE of a market's inflation — see markupFor.
  function buyPrice(save, baseValue, r = Math.random, markupScale = 1) {
    const { lo, hi } = (typeof buyMarkupRange === 'function')
      ? buyMarkupRange(save.relics) : { lo: 1.2, hi: 3.0 };
    const mul = lo + r() * (hi - lo);
    return Math.max(1, Math.ceil(baseValue * (1 + (mul - 1) * markupScale)));
  }

  // A fort sells at HALF the markup a market does — a quartermaster supplying
  // the garrison, not a village shop restocking at a profit. One scale both
  // of its sales read: the cash offer (buyPrice) and the relic swap
  // (Gear.buildRelicOffer's non-castle markup).
  const FORT_MARKUP_SCALE = 0.5;
  function markupFor(house) {
    return (house && house.tier === 11) ? FORT_MARKUP_SCALE : 1;
  }

  // ── Roadside stands ──────────────────────────────────────────────────
  // A stand (the coffee cart, the fruit stall, the fishmonger) is a fresh
  // producer selling its own goods, not a village shop restocking from a
  // wholesaler — so it undercuts the listed price rather than marking it up.
  // It used to charge exactly par, which read as expensive for what is meant
  // to be the cheap, friendly way to get hold of an ingredient.
  //
  // The discount has a hard floor: THE PLAYER MUST NEVER BE ABLE TO BUY FROM A
  // STAND AND SELL AT A PROFIT. That floor is not a constant, because the sell
  // side is not either — the Sword relic scales selling from 0.5× base up to
  // 1.0× at tier 7 (sellMultiplier, items.js). A flat "stands are 25% off"
  // would be free money the moment a player carried a tier-4 sword: buy at
  // 0.75, sell at 0.79, repeat. So the stand price tracks the player's OWN
  // sell price and stays a margin above it, and the discount quietly shrinks
  // as their sword improves:
  //
  //     no sword (sell 0.50)  →  pay 0.75   (25% off par)
  //     sword T4 (sell 0.79)  →  pay 0.84   (16% off par)
  //     sword T7 (sell 1.00)  →  pay 1.00   (par — break-even, as before)
  //
  // Capped at par so a maxed-out player is never charged MORE than the listed
  // price; at that point buying and reselling is exactly break-even, which is
  // what it already was. Every combination is pinned in shops_math.test.js.
  //
  // What actually guarantees the invariant is the TRACKING — pricing off
  // sellMultiplier rather than off a constant. The margin below is headroom on
  // top of that, so a later tweak to either curve doesn't land exactly on the
  // line; setting it to 0 still yields break-even, never profit.
  const STAND_BUY_MUL = 0.75;      // best case: what a stand charges off par
  const STAND_ARB_MARGIN = 0.05;   // headroom above resale, not the guarantee

  // The multiplier a stand applies to an item's listed value, for these relics.
  function standBuyMul(relics) {
    const sellMul = (typeof sellMultiplier === 'function') ? sellMultiplier(relics) : 0.5;
    return clamp(sellMul + STAND_ARB_MARGIN, STAND_BUY_MUL, 1);
  }

  // Cash price to buy ONE unit at a stand. Ceil (not round) so the rounding
  // always favours the stand — rounding down could hand back the very penny of
  // arbitrage the margin exists to prevent on a cheap item.
  // Deliberately NOT scaled by the game mode: a stand is the cheap, friendly
  // way to get an ingredient on hard too (Difficulty.buyMul is the trader's
  // markup, and this is not a markup). The no-profit floor still holds there
  // — hard mode only cuts the sell side.
  function standPrice(save, baseValue) {
    return Math.max(1, Math.ceil(baseValue * standBuyMul(save && save.relics)));
  }

  // ─── Trader ask ──────────────────────────────────────────────────────────
  // What a trader asks in return for its goods: an item id and a count worth
  // `target` (the give side's value × 1..2). The ask used to be ANY priced
  // stack in the bag, whatever it held — so a trader happily asked a wooden-
  // backpack player for 54 Potato Seeds against a stack that can't hold a
  // third of that. A deal the player can never accept is not an offer.
  //
  // So the pick runs in two passes on one rng:
  //   1. On TRADER_AFFORDABLE_CHANCE of rolls, only stacks that ALREADY cover
  //      the count are considered — the trade can be taken on the spot.
  //   2. Otherwise (or when nothing covers it) any owned stack, then the
  //      wishlist of every priced item, as before — the player still learns
  //      what a trader wants and can go and gather it.
  // Every pass drops an ask larger than the stack cap for that id: a count the
  // bag can never hold is refused in both, falling back to the unfiltered list
  // only when the target is so dear nothing cheap enough exists.
  //
  // The chance roll is drawn EVERY time, before any list is read, so what the
  // bag holds changes which list is picked from and never how many numbers the
  // stream spends.
  //
  // And every pass keeps the deal inside the trader's ratio. The count rounds
  // UP, so an item dearer than the target is asked for once whatever it is
  // worth — a target of 54 asked one 500-coin gem, nine times the goods. The
  // affordable pass made that commoner (one of anything is "affordable"), so
  // an ask worth more than TRADER_MAX_OVERPAY × the target is dropped, and
  // only asked when no fairer item exists anywhere.
  const TRADER_AFFORDABLE_CHANCE = 0.5;
  const TRADER_MAX_OVERPAY = 2;

  // opts: { rng, giveId, target, inv, prices, isItem(id), capFor(id) }
  // Returns { askId, askQty } or null when no priced item exists at all.
  function traderAsk(opts) {
    const { rng, giveId, target, inv, prices, isItem, capFor } = opts;
    const priceOf = (id) => Math.max(1, prices[id] ?? 1);
    const qtyFor = (id) => Math.max(1, Math.ceil(target / priceOf(id)));
    const priced = (id) => id && id !== giveId && (prices[id] ?? 0) > 0;
    const holdable = (id) => qtyFor(id) <= capFor(id);
    const fair = (id) => qtyFor(id) * priceOf(id) <= TRADER_MAX_OVERPAY * target;
    const held = new Map();
    for (const s of (inv || [])) {
      if (!s || !priced(s.id) || !((s.count ?? 0) > 0)) continue;
      held.set(s.id, (held.get(s.id) || 0) + s.count);
    }
    const owned = [...held.keys()];
    const wantAffordable = rng() < TRADER_AFFORDABLE_CHANCE;
    const pick = (ids) => ids[Math.floor(rng() * ids.length)];
    const firstNonEmpty = (...lists) => lists.find(l => l.length) || [];
    let ids = [];
    if (wantAffordable) ids = owned.filter(id => fair(id) && held.get(id) >= qtyFor(id));
    if (!ids.length) {
      const wishlist = Object.keys(prices).filter(k => priced(k) && isItem(k));
      const both = (id) => fair(id) && holdable(id);
      ids = firstNonEmpty(
        owned.filter(both), wishlist.filter(both),
        owned.filter(holdable), wishlist.filter(holdable),
        owned, wishlist);
    }
    if (!ids.length) return null;
    const askId = pick(ids);
    return { askId, askQty: qtyFor(askId) };
  }

  // A themed shop's re-roll: $2, then ×1.5 rounded DOWN per re-roll this hour
  // ($2, 3, 4, 6, 9, 13, 19 …). Deliberately cheaper than the smithy's and the
  // trader's 5 × 2^n — a themed shop sells one ordinary item, and looking
  // along its shelf should cost less than asking a smith for another relic.
  const THEMED_REROLL_START = 2;
  const THEMED_REROLL_MUL = 1.5;
  function themedRerollCost(rerolls = 0) {
    let c = THEMED_REROLL_START;
    for (let i = 0; i < (rerolls | 0); i++) c = Math.floor(c * THEMED_REROLL_MUL);
    return c;
  }

  root.ShopsMath = { HOUR, THEMED_REROLL_START, THEMED_REROLL_MUL, themedRerollCost, bucketOffset, bucket, dealCap, bucketState, pruneShopState, readiness, msToNextBucket, rng, buyPrice, FORT_MARKUP_SCALE, markupFor,
                     STAND_BUY_MUL, STAND_ARB_MARGIN, standBuyMul, standPrice,
                     TRADER_AFFORDABLE_CHANCE, TRADER_MAX_OVERPAY, traderAsk };
})(typeof globalThis !== 'undefined' ? globalThis : this);
