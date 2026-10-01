// Shop scheduling + pricing core — the per-house hour-bucket math, seeded
// per-bucket RNG, re-roll cost curves and buy-price markup, extracted from
// app.js so they're testable headlessly (no scene, no DOM).
//
// A shop's offers are derived from a deterministic RNG keyed by (house.id,
// hour-bucket, rerolls, offerSalt, lane) so the same shop in the same hour shows
// the same offer without persisting the offer object; a per-house sub-hour
// offset staggers rotations. Deal counts + rerolls live in save.shopState.
//
// NO SHOP RATIONS ITS DEALS (Sep 2026, owner's call): a smithy, trader or
// storefront can be used continuously — there is no "busy" hour, no resting
// anvil, no readiness pip. The ONE thing the clock does to a shop is ease its
// RE-ROLL LEVEL: the paid re-roll count (the cost ladder's rung) drops by one
// per hour bucket that passes, instead of resetting outright (bucketState).
//
// The scene calls ShopsMath directly from its shop helpers (scene_shops.js
// shopBucketState / shopRng / buildShopOffer).
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

  // The re-roll level a stale record is worth NOW: one rung comes off per
  // hour bucket that has passed since it was written (never below zero, and
  // a clock that ran backwards eases nothing). This is the only thing the
  // clock does to a shop — see the header.
  function easedRerolls(cur, b) {
    const elapsed = Math.max(0, b - (cur.bucket | 0));
    return Math.max(0, (cur.rerolls | 0) - elapsed);
  }

  // Live { bucket, deals, rerolls } for a house, creating it on first touch.
  // A record from an earlier bucket is carried forward, not thrown away: its
  // re-roll level eases by one per elapsed hour (easedRerolls) and its deal
  // count — the trader's stock turnover within the hour (rng's perDeal) —
  // starts over with the new offer.
  function bucketState(save, house, now = Date.now()) {
    save.shopState = save.shopState || {};
    const id = house.id;
    const b = bucket(id, now);
    let cur = save.shopState[id];
    if (cur && cur.bucket !== b) {
      cur = { bucket: b, deals: 0, rerolls: easedRerolls(cur, b) };
      save.shopState[id] = cur;
    }
    if (!cur) {
      cur = { bucket: b, deals: 0, rerolls: 0 };
      save.shopState[id] = cur;
    }
    return cur;
  }

  // Garbage-collect spent entries out of save.shopState (savemigrate.js, once
  // per boot) so the map can't grow by one record per shop ever visited. An
  // entry is spent when it is from an earlier bucket AND its re-roll level has
  // eased all the way to zero: that is exactly the record bucketState() would
  // replace with a fresh { bucket, deals: 0, rerolls: 0 } on the next touch,
  // so deleting it now is lossless. A stale entry still carrying re-roll
  // rungs is kept — pruning it would forgive the ladder early.
  // Returns the number of entries removed.
  function pruneShopState(save, now = Date.now()) {
    if (!save || !save.shopState) return 0;
    let n = 0;
    for (const id of Object.keys(save.shopState)) {
      const cur = save.shopState[id];
      const b = bucket(id, now);
      if (!cur || (cur.bucket !== b && easedRerolls(cur, b) === 0)) {
        delete save.shopState[id];
        n++;
      }
    }
    return n;
  }

  // Deterministic 0..1 RNG keyed by (house.id offset, bucket, rerolls, offerSalt,
  // lane). `lane` namespaces independent rolls within a bucket so e.g. the price
  // roll can't consume the pool-pick roll.
  //
  // The bucket's DEAL count stays out of the seed by default: a cash shop's
  // shelf is the same shelf after a purchase (shops_math.test.js "spending
  // deals does not reshuffle the offer"). `opts.perDeal` folds it in, for a
  // shop whose STOCK is what changes hands — the trader barters its goods
  // away, so the moment a deal closes it has something else to offer (and
  // its sign, which reads the same pick, names the new goods). A re-roll
  // still pivots the stream on top of that.
  function rng(save, house, lane = '', now = Date.now(), opts = {}) {
    const cur = bucketState(save, house, now);
    const turnover = opts.perDeal ? (cur.deals | 0) : 0;
    const seed = ((bucketOffset(house.id) >>> 0)
                ^ (cur.bucket >>> 0)
                ^ ((save.offerSalt || 0) >>> 0)
                ^ Math.imul(cur.rerolls + 1, 0x9e3779b1)
                ^ Math.imul(turnover, 0x85ebca6b)
                // The free re-draws a re-roll took to land on something NEW
                // (rerollPeek): seed-only, so the ladder never climbs for
                // them. Zero (or absent, on every record written before
                // Oct 2026) leaves the seed exactly as it was.
                ^ Math.imul(cur.skips | 0, 0x27d4eb2f)) >>> 0;
    // The lane name is folded onto that seed with util.js' fnv1a loop — the
    // same prime and order fnv1a() itself uses, just started from here rather
    // than from the FNV offset basis (util.js › fnv1aFrom).
    return makeRng32(fnv1aFrom(seed, lane));
  }

  // A RE-ROLL ALWAYS LANDS ON SOMETHING ELSE (owner, Oct 2026). The re-roll
  // pivots the seed (cur.rerolls), but a pivot is a fresh draw from the same
  // small pool, and a trader with three goods or a smithy with two forge
  // targets handed the SAME offer back often enough to read as a swindle.
  // So every re-roll button goes through here: bump the ladder once (the
  // one rung the player pays for), draw, and while the draw matches what
  // was on display, bump `skips` — a seed-only counter rng() folds in,
  // which the cost ladder never reads — and draw again, up to REROLL_RETRIES
  // times. The skips stay on the bucket record so the offer the button
  // settled on is the one every later peek (the trader's roof sign, a
  // reopened modal) reads back. A pool of one gives up and returns the same
  // thing (the themed shelf hides its button for that case; a smithy says
  // so); a null draw (nothing left) returns at once. `cur` may be null for
  // the unseeded fallback (a house with no id), where every peek is already
  // a fresh Math.random draw and only the retry loop applies.
  const REROLL_RETRIES = 4;
  // What makes two offers "the same thing": the same id, or the same piece
  // of gear (kind / slot / tier), or the same barter (give for ask). Price
  // and quantity are not an identity — a re-roll that only moved the price
  // is the same item again.
  function offerKey(o) {
    if (o == null) return '';
    if (typeof o !== 'object') return String(o);
    return [o.id, o.kind, o.slot, o.tier, o.giveId, o.askId]
      .map(v => (v == null ? '' : String(v))).join('/');
  }
  function rerollPeek(cur, peek, current, tries = REROLL_RETRIES) {
    if (cur) cur.rerolls = (cur.rerolls | 0) + 1;
    let next = peek();
    const was = offerKey(current);
    for (let i = 0; i < tries && next != null && offerKey(next) === was; i++) {
      if (cur) cur.skips = (cur.skips | 0) + 1;
      next = peek();
    }
    return next;
  }

  // Cash price to BUY an item worth baseValue. The Bow relic shrinks the markup:
  // no bow → 1.2..3.0× base; Bow T7 → a flat 1.0× (par). `r` defaults to
  // Math.random — pass a seeded one for a stable per-bucket price.
  function buyPrice(save, baseValue, r = Math.random) {
    const { lo, hi } = (typeof buyMarkupRange === 'function')
      ? buyMarkupRange(save.relics) : { lo: 1.2, hi: 3.0 };
    return Math.max(1, Math.ceil(baseValue * (lo + r() * (hi - lo))));
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

  // A themed shop's re-roll: $2, then ×1.5 rounded DOWN per re-roll rung
  // ($2, 3, 4, 6, 9, 13, 19 …); a rung comes off per hour (bucketState).
  // Deliberately cheaper than the smithy's $5 start
  // and the trader's 5 × 2^n — a themed shop sells one ordinary item, and looking
  // along its shelf should cost less than asking a smith for another relic.
  const THEMED_REROLL_START = 2;
  const THEMED_REROLL_MUL = 1.5;
  function growRerollCost(start, rerolls) {
    let c = start;
    for (let i = 0; i < (rerolls | 0); i++) c = Math.floor(c * THEMED_REROLL_MUL);
    return c;
  }
  function themedRerollCost(rerolls = 0) { return growRerollCost(THEMED_REROLL_START, rerolls); }
  // The smithy's re-roll: the relic stalls' $5 start, but growing on the
  // same ×1.5 rounded-down curve ($5, 7, 10, 15, 22, 33 …) rather than their
  // doubling — hunting the anvil for the one piece you want stays affordable.
  const SMITHY_REROLL_START = 5;
  function smithyRerollCost(rerolls = 0) { return growRerollCost(SMITHY_REROLL_START, rerolls); }

  // ─── Fort slot machine ───────────────────────────────────────────────────
  // A fort's quartermaster runs a three-reel slot machine instead of a shop.
  // Three prizes a day (the caller picks them, seeded on the fort + the UTC
  // day), kept off the machine's face — the reels are all the player sees.
  // The most valuable is the JACKPOT, half as likely on each reel as any other
  // prize (SLOT_JACKPOT_WEIGHT vs SLOT_WEIGHT). A fourth symbol, the STAR
  // (SLOT_STAR_WEIGHT), is no prize of its own:
  //   • three of a prize, no star (a NATURAL triple) — that prize ×
  //     SLOT_NATURAL_MUL (for a prize the caller says doubles — a relic
  //     would not; today's pool is all stackable finds, so every one does);
  //   • two of a prize and one star — the star completes it: that prize ×1;
  //   • two jackpots and one other prize (not a star, which would complete
  //     them) — SLOT_JACKPOT_PAIR_COINS back;
  //   • two stars and a third reel that is not the jackpot —
  //     SLOT_STAR_PAIR_MUL × the stake (the spin's own cost);
  //   • two stars AND the jackpot — no coin: the machine goes DELUXE for
  //     the next SLOT_DELUXE_SPINS spins (slotDeluxeNext; the count is the
  //     caller's, in the save). While deluxe, every prize that doubles (not
  //     a relic) pays SLOT_DELUXE_MUL times over, on top of a natural's
  //     double, and so does every COIN payout (the jackpot pair, the star
  //     pair, the star jackpot's coin — a memory is one memory either way). Hitting it again while deluxe restarts the count — it never
  //     stacks past SLOT_DELUXE_SPINS;
  //   • three stars — the STAR JACKPOT: a memory (app.js) the first
  //     SLOT_STAR_BADGES times (app.js keeps that count), then
  //     SLOT_STAR_JACKPOT_COINS.
  //
  // The stake is FAIR: exactly the expected payout of one spin, rounded UP to
  // a whole coin. With p = a prize's share of the reel weight, s the star's
  // and q the jackpot's, the outcomes are disjoint and each is priced exactly:
  //   natural triple      p³ · mul · value
  //   star-completed      3p²s · value
  //   jackpot pair        3q²(1 − q − s) · pair coin
  //   two stars           3s²(1 − s − q) · SLOT_STAR_PAIR_MUL · cost
  //   deluxe              every term above × (1 + f · (SLOT_DELUXE_MUL − 1))
  //   three stars         s³ · star jackpot
  // The one ESTIMATE is the star jackpot while it still pays a badge: a
  // memory can't be sold, so it has no coin price. It is
  // valued at SLOT_STAR_JACKPOT_COINS — the coin the same line pays once the
  // badges run out, the one exchange rate the machine itself states — so the
  // stake is the same for every player whatever they have already won. At
  // s³ = 1/216 a spin that difference is a fraction of a coin either way.
  // The memory the FIRST deluxe brings back (app.js, once per save) is not
  // priced at all: a one-off, not a rate, it has no per-spin value.
  // DELUXE IS PRICED AS A LONG-RUN SHARE. The stake is one price whatever
  // state the machine is in, so it covers the average spin: f, the share of
  // spins played deluxe (slotDeluxeShare), from the trigger chance t = 3s²q.
  // A normal stretch lasts 1/t spins (the trigger spin included); a deluxe
  // stretch lasts until SLOT_DELUXE_SPINS spins in a row miss the trigger,
  // L = ((1 − t)^−N − 1) / t; f = L / (1/t + L).
  //
  // The star pair pays in STAKES, so the price appears on both sides: with
  // e the rest of the ev and k = 3s²(1 − s − q) · SLOT_STAR_PAIR_MUL · (the
  // deluxe multiplier's long-run average), the cost is
  // the least whole coin c with e + k·c ≤ c, i.e. c = ⌈e / (1 − k)⌉ — which
  // also keeps c − 1 below e + k·c, so it is still the fair price rounded up.
  // Derived, never tuned: change a weight or a prize and the price follows.
  // The round-up is the house's only edge, and it is under one coin a spin.
  const SLOT_REELS = 3;
  const SLOT_PRIZES = 3;
  const SLOT_WEIGHT = 2;
  const SLOT_JACKPOT_WEIGHT = 1;
  const SLOT_STAR_WEIGHT = 1;
  const SLOT_NATURAL_MUL = 2;
  const SLOT_JACKPOT_PAIR_COINS = 3;
  const SLOT_STAR_PAIR_MUL = 2;
  const SLOT_DELUXE_SPINS = 10;
  const SLOT_DELUXE_MUL = 2;
  const SLOT_STAR_BADGES = 1;   // the machine's other memory is the first deluxe (app.js)
  const SLOT_STAR_JACKPOT_COINS = 100;

  // ids: the day's prize ids; valueOf(id): an item's worth in coin;
  // doubles(id): whether a natural triple of it pays SLOT_NATURAL_MUL (default
  // every prize). Returns { prizes, symbols, cost, ev, winChance, pairChance,
  // pairCoins, starChance, starPairChance }. `symbols` is what the reels
  // carry: the prizes, then the star ({ star: true }); a reel index is an
  // index into it. winChance is every way to win a prize (natural + starred).
  function slotMachine(ids, valueOf, doubles) {
    const prizes = (ids || []).map((id) => ({ id, value: Math.max(0, valueOf(id) || 0) }));
    let jp = -1;
    prizes.forEach((p, i) => { if (jp < 0 || p.value > prizes[jp].value) jp = i; });
    prizes.forEach((p, i) => {
      p.jackpot = i === jp;
      p.weight = p.jackpot ? SLOT_JACKPOT_WEIGHT : SLOT_WEIGHT;
      p.doubles = !doubles || !!doubles(p.id);
      p.naturalQty = p.doubles ? SLOT_NATURAL_MUL : 1;
    });
    const star = { star: true, id: null, value: 0, weight: prizes.length ? SLOT_STAR_WEIGHT : 0 };
    const symbols = prizes.concat([star]);
    const total = symbols.reduce((a, p) => a + p.weight, 0) || 1;
    const s = star.weight / total;
    const q = jp >= 0 ? prizes[jp].weight / total : 0;
    const deluxeChance = SLOT_REELS * s * s * q;
    const deluxeShare = slotDeluxeShare(deluxeChance);
    const dl = 1 + deluxeShare * (SLOT_DELUXE_MUL - 1);   // the average multiplier
    let ev = 0, winChance = 0;
    for (const p of prizes) {
      const w = p.weight / total;
      const natural = Math.pow(w, SLOT_REELS);
      const starred = SLOT_REELS * w * w * s;
      const prizeEv = natural * p.naturalQty * p.value + starred * p.value;
      ev += prizeEv * (p.doubles ? dl : 1);
      winChance += natural + starred;
    }
    // Exactly two jackpots and a third reel that is neither (a star would
    // have completed them): C(3,2) · q² · (1 − q − s).
    const pairChance = SLOT_REELS * q * q * Math.max(0, 1 - q - s);
    const pairCoins = jp >= 0 ? SLOT_JACKPOT_PAIR_COINS : 0;
    ev += pairChance * pairCoins * dl;
    // Two stars and a third reel that is neither a star nor the jackpot.
    const starPairChance = SLOT_REELS * s * s * Math.max(0, 1 - s - q);
    const starChance = Math.pow(s, SLOT_REELS);
    ev += starChance * SLOT_STAR_JACKPOT_COINS * dl;
    const k = starPairChance * SLOT_STAR_PAIR_MUL * dl;
    const cost = Math.max(1, Math.ceil(ev / (1 - k) - 1e-9));
    ev += k * cost;
    return { prizes, symbols, cost, ev, winChance,
             pairChance, pairCoins, starChance, starPairChance, deluxeChance, deluxeShare };
  }

  // The long-run share of spins played deluxe, given the per-spin trigger
  // chance t (see the pricing note above).
  function slotDeluxeShare(t) {
    if (!(t > 0)) return 0;
    const L = (Math.pow(1 - t, -SLOT_DELUXE_SPINS) - 1) / t;
    return L / (1 / t + L);
  }

  // Deluxe spins left after a spin: a trigger (re)starts the count, any other
  // spin uses one up. Never stacks.
  function slotDeluxeNext(left, out) {
    if (out && out.deluxe) return SLOT_DELUXE_SPINS;
    return Math.max(0, (left | 0) - 1);
  }

  // The day's prizes: SLOT_PRIZES distinct ids drawn from `candidates` by a
  // stream seeded on `key` (the fort id + the UTC day, app.js) — the same
  // three all day, new ones tomorrow, and never stored.
  function slotPrizes(key, candidates) {
    const rng = makeRng32(fnv1a(String(key)));
    const pool = (candidates || []).slice();
    const out = [];
    while (out.length < SLOT_PRIZES && pool.length) {
      out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    return out;
  }

  // One spin: a symbol index per reel (into machine.symbols), drawn by
  // weight; `deluxe` multiplies what it pays by SLOT_DELUXE_MUL. Returns
  // { reels, won, qty, natural, coins, starJackpot, deluxe, doubled }: `won`
  // is the prize index won (natural triple or star-completed pair) or -1,
  // `qty` how many of it, `coins` any coin payout (jackpot pair, two stars),
  // `starJackpot` true on three stars — what that pays is the caller's (the
  // memory count lives in the save; `doubled` says its coin is doubled) —
  // and `deluxe` true when this spin (re)starts deluxe.
  function slotSpin(machine, rng = Math.random, deluxe = false) {
    const syms = machine.symbols || machine.prizes;
    const reels = [];
    // Reel symbols always carry a positive weight in practice (slotMachine's
    // prizes are SLOT_WEIGHT/SLOT_JACKPOT_WEIGHT, the star SLOT_STAR_WEIGHT
    // whenever there is at least one prize), so weightedPickBy's null branch
    // (no positive weight at all) is not reachable here; the fallback to the
    // last index preserves the old `pick = syms.length - 1` default.
    const idx = syms.map((_, i) => i);
    for (let r = 0; r < SLOT_REELS; r++) {
      const pick = weightedPickBy(idx, (i) => syms[i].weight, rng);
      reels.push(pick ?? syms.length - 1);
    }
    const out = { reels, won: -1, qty: 0, natural: false, coins: 0, starJackpot: false, deluxe: false, doubled: false };
    const stars = reels.filter((i) => syms[i].star).length;
    if (stars === SLOT_REELS) { out.starJackpot = true; out.doubled = !!deluxe; return out; }
    if (stars === SLOT_REELS - 1) {
      if (reels.some((i) => syms[i].jackpot)) out.deluxe = true;
      else out.coins = SLOT_STAR_PAIR_MUL * (machine.cost || 0) * (deluxe ? SLOT_DELUXE_MUL : 1);
      return out;
    }
    const plain = reels.filter((i) => !syms[i].star);
    if (plain.every((i) => i === plain[0])) {
      out.won = plain[0];
      out.natural = stars === 0;
      out.qty = out.natural ? (syms[out.won].naturalQty || 1) : 1;
      if (deluxe && syms[out.won].doubles !== false) { out.qty *= SLOT_DELUXE_MUL; out.doubled = true; }
      return out;
    }
    const jackpots = reels.filter((i) => syms[i].jackpot).length;
    if (jackpots === SLOT_REELS - 1) out.coins = (machine.pairCoins || 0) * (deluxe ? SLOT_DELUXE_MUL : 1);
    return out;
  }

  root.ShopsMath = { HOUR, THEMED_REROLL_START, THEMED_REROLL_MUL, themedRerollCost, SMITHY_REROLL_START, smithyRerollCost, bucketOffset, bucket, easedRerolls, bucketState, pruneShopState, rng, buyPrice,
                     REROLL_RETRIES, offerKey, rerollPeek,
                     SLOT_REELS, SLOT_PRIZES, SLOT_WEIGHT, SLOT_JACKPOT_WEIGHT, SLOT_JACKPOT_PAIR_COINS,
                     SLOT_STAR_WEIGHT, SLOT_NATURAL_MUL, SLOT_STAR_PAIR_MUL, SLOT_DELUXE_SPINS, SLOT_DELUXE_MUL, slotDeluxeShare, slotDeluxeNext, SLOT_STAR_BADGES, SLOT_STAR_JACKPOT_COINS, slotMachine, slotSpin, slotPrizes,
                     STAND_BUY_MUL, STAND_ARB_MARGIN, standBuyMul, standPrice,
                     TRADER_AFFORDABLE_CHANCE, TRADER_MAX_OVERPAY, traderAsk };
})(typeof globalThis !== 'undefined' ? globalThis : this);
