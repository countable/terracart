// Unified rarity / loot picker. One function — pickReward(contextKey, save, rng)
// — drives every chest, treasure mark, shop offer, and (eventually) trader
// wishlist. Replaces the parallel logic in loot.js (pickLoot, pickTreasure,
// pickChestRelic) and app.js (buildShopOffer, buildRelicOffer). The legacy
// pickers stay alive until their call sites migrate.
//
// Loaded as a global script — depends on items.js (ITEMS, ITEM_BY_ID,
// BASE_TIER, RELIC_DEFS, gearPrice, PRICES) being loaded first.
//
// Exports as globals:
//   RARITY_TUNING            — knob constants (boost/jackpot/qty)
//   LOOT_CONTEXTS            — per-context (chest:food, shop:trader, …) shape
//   ITEMS_BY_CLASS_TIER      — { class → { tier → [id, …] } }
//   CLASS_MAX_TIER           — { class → highest baseTier present }
//   pickReward(key, save, rng)        → { kind:'item'|'relic'|'gold', … }
//   reconcileRelicOffer(rolled, save, rng) → walk-up ladder for dupes
//   weightedPick(map, rng)            → string key (small helper, reused on balancing page)

(function (global) {
  // ────────────────────────────────────────────────────────────────
  // Tunable constants. One place for the four numbers that shape the
  // entire curve; balancing dashboard lives off these.
  // ────────────────────────────────────────────────────────────────
  const RARITY_TUNING = {
    ringLuckPerTier:     0.01,   // T7 ring → +0.07 to boost probability
    jackpotP:            0.40,   // P(another +1 tier in jackpot chain) — 0.5 made chests too jackpot-y
    tierVsQtySplit:      0.5,    // during boost chain, P(go tier) vs P(go qty)
    amuletBoostBracketP: 0.05,   // per amulet tier, P(extra qty-bracket bump)
    // Per-class quantity brackets. Index 0..3 = brackets returned by the
    // boost chain after the tier-driven demotion (see qtyDemotePerTier
    // below). Falls back to qtyBracketsDefault for any class without an
    // override. Trimmed from earlier values — chests were too generous.
    qtyBracketsByClass: {
      seed:       [[1, 2], [2, 4], [3, 6], [5, 10]],
      produce:    [[1, 1], [1, 3], [2, 4], [3, 6]],
      mineral:    [[1, 1], [1, 2], [1, 2], [2, 3]],
      // Consumables (flute/book) are always single — they're tap-to-use items,
      // not stackable resources.
      consumable: [[1, 1], [1, 1], [1, 1], [1, 1]],
      animal:     [[1, 1], [1, 1], [1, 1], [1, 1]],
      flora:      [[1, 1], [1, 2], [2, 3], [3, 5]],
    },
    qtyBracketsDefault:  [[1, 1], [1, 3], [3, 5], [5, 8]],
    // Tier-driven bracket demotion. Higher-tier items always come in smaller
    // stacks than their lower-tier siblings: a chest that "would have given"
    // 10 potato seeds at T1 gives 5 gemfruit seeds at T2 and just 1 iceflower
    // seed at T3. effectiveBracket = max(0, rolledBracket - (tier-1) * 2).
    qtyDemotePerTier:    2,
    // Per-class boost-rate multiplier. The boost chain rolls each step at
    // (ctx.boostP * mul + ringLuck); a class with mul < 1 climbs less
    // aggressively, so most rolls stay near tier 1. Used to keep coal the
    // overwhelmingly-common mineral drop without removing gems from the pool.
    classChainBoostMul: {
      mineral: 0.45,   // most mineral rolls stay at T1 = coal; gems are rare jackpots
    },
    walkUpStepP:         0.5,    // walk-up ladder: P(climb vs cash-out)
  };

  // ────────────────────────────────────────────────────────────────
  // Per-context picking shape. Each row owns:
  //   classBias — weights for which item-class the reward comes from
  //   boostP    — base probability the boost chain takes another step
  //   maxTier   — hard ceiling on rolled item tier (clamps jackpot)
  //   relicCap  — hard ceiling on relic tier when class === 'relic'
  //               (0 = relics never offered, even if classBias allowed them)
  //
  // Class weights inside each row do NOT need to sum to exactly 1.0 — we
  // re-normalise in weightedPick. Easier to author this way.
  // ────────────────────────────────────────────────────────────────
  const LOOT_CONTEXTS = {
    // ── Chests, by visual tier 1..4 ─────────────────────────────
    // We only ship 4 chest spritesheets (lowtier/uncommon/rare/epic via the
    // coloured diamond), so the context table matches: one row per chest
    // tier instead of one per POI category. loot.js' chestTier(poiClass)
    // maps a POI to its tier (1..4); call sites do
    //   pickReward('chest:t' + chestTier(poiClass), save).
    //
    // Animal class is heavily suppressed in chests — finding a live cow in a
    // bus-stop chest reads as nonsense. Lower tiers also keep maxTier ≤ 2
    // so the T3 flowers and gemstones stay reserved for mid+ chests
    // (≈half the seed roster is unreachable from a T1 chest by design).
    'chest:t1':         { classBias: { seed:0.40, produce:0.38, mineral:0.10, consumable:0.10, animal:0.01,  relic:0.01 },
                          boostP: 0.30, maxTier: 2, relicCap: 1 },
    'chest:t2':         { classBias: { seed:0.30, produce:0.30, mineral:0.12, consumable:0.12, animal:0.02,  relic:0.14 },
                          boostP: 0.55, maxTier: 3, relicCap: 2 },
    'chest:t3':         { classBias: { seed:0.22, produce:0.18, mineral:0.18, consumable:0.15, animal:0.02,  relic:0.25 },
                          boostP: 0.70, maxTier: 5, relicCap: 4 },
    'chest:t4':         { classBias: { seed:0.20, produce:0.15, mineral:0.15, consumable:0.10, animal:0.03,  relic:0.37 },
                          boostP: 0.85, maxTier: 7, relicCap: 7 },

    // ── Shops, by specialty ─────────────────────────────────────
    'shop:plain':       { classBias: { seed:0.35, produce:0.35, animal:0.10, mineral:0.10, consumable:0.10 },
                          boostP: 0.50, maxTier: 3, relicCap: 0 },
    'shop:market':      { classBias: { produce:0.65, seed:0.20, animal:0.10, consumable:0.05 },
                          boostP: 0.55, maxTier: 3, relicCap: 0 },
    'shop:blacksmith':  { classBias: { mineral:0.40, relic:0.55, consumable:0.05 },
                          boostP: 0.65, maxTier: 6, relicCap: 5 },
    'shop:trader':      { classBias: { animal:0.35, mineral:0.15, produce:0.20, seed:0.15, consumable:0.10, relic:0.05 },
                          boostP: 0.60, maxTier: 4, relicCap: 3 },
    'shop:fort':        { classBias: { seed:0.25, produce:0.25, mineral:0.15, consumable:0.15, animal:0.10, relic:0.10 },
                          boostP: 0.65, maxTier: 4, relicCap: 3 },
    'shop:castle':      { classBias: { relic: 1.00 },
                          boostP: 0.70, maxTier: 7, relicCap: 7 },

    // ── Floating treasure mark ──────────────────────────────────
    'treasure:default': { classBias: { seed:0.45, produce:0.30, mineral:0.10, consumable:0.15 },
                          boostP: 0.20, maxTier: 2, relicCap: 0 },
  };

  // ────────────────────────────────────────────────────────────────
  // Build ITEMS_BY_CLASS_TIER once. Two-level map: kind → tier → [ids].
  // Skips relics (they live in RELIC_DEFS and span every tier 1..7 per slot).
  // Skips items missing a numeric baseTier (defensive — see items.js fill-in).
  // ────────────────────────────────────────────────────────────────
  // ITEMS / RELIC_DEFS are declared with `const` at the top of items.js, so
  // they live on the global lexical scope but NOT on `window`. Reach them
  // through `globalThis` (which exposes the global lexical scope in modern
  // browsers) with a defensive bare-name fallback.
  const _ITEMS      = (typeof ITEMS      !== 'undefined') ? ITEMS      : [];
  const _RELIC_DEFS = (typeof RELIC_DEFS !== 'undefined') ? RELIC_DEFS : {};
  const _gearPrice  = (typeof gearPrice  !== 'undefined') ? gearPrice  : null;

  function buildClassTierIndex() {
    const out = {};
    for (const it of _ITEMS) {
      const cls = it.kind;
      const t = it.baseTier;
      if (!cls || typeof t !== 'number') continue;
      (out[cls] = out[cls] || {});
      (out[cls][t] = out[cls][t] || []).push(it.id);
    }
    return out;
  }
  const ITEMS_BY_CLASS_TIER = buildClassTierIndex();
  const CLASS_MAX_TIER = {};
  for (const [cls, byT] of Object.entries(ITEMS_BY_CLASS_TIER)) {
    CLASS_MAX_TIER[cls] = Math.max(...Object.keys(byT).map(Number));
  }
  // Relics span every tier 1..7 for every slot — pickItemInClass handles this
  // without needing an entry in ITEMS_BY_CLASS_TIER.

  // ────────────────────────────────────────────────────────────────
  // Helpers. weightedPick is exported because the balancing dashboard
  // re-uses it for "what would this context give me" simulations.
  // ────────────────────────────────────────────────────────────────
  function weightedPick(weightsObj, rng) {
    const keys = Object.keys(weightsObj);
    if (!keys.length) return null;
    let total = 0;
    for (const k of keys) total += weightsObj[k];
    if (total <= 0) return null;
    let r = rng() * total;
    for (const k of keys) { r -= weightsObj[k]; if (r <= 0) return k; }
    return keys[keys.length - 1];
  }
  function ringLuck(save) {
    return (save?.relics?.ring?.tier || 0) * RARITY_TUNING.ringLuckPerTier;
  }
  function amuletBracketChance(save) {
    return (save?.relics?.amulet?.tier || 0) * RARITY_TUNING.amuletBoostBracketP;
  }

  // Pick a (single) id from a class at the rolled tier. If the tier has no
  // items in this class (e.g. seeds at T5), slide DOWN to the nearest filled
  // tier. The surplus tier is already converted to qty-bracket in the chain
  // so this is just a graceful fallback for jackpots.
  function pickItemInClass(cls, tier, rng) {
    if (cls === 'relic') return null;            // handled by reconcileRelicOffer
    const byTier = ITEMS_BY_CLASS_TIER[cls];
    if (!byTier) return null;
    let pool = byTier[tier];
    for (let t = tier - 1; t >= 1 && (!pool || !pool.length); t--) pool = byTier[t];
    if (!pool || !pool.length) return null;
    // Weighted pick by item.dropWeight (defaults to 1). Lets items like fish
    // declare dropWeight: 0.4 in items.js to show up less often than their
    // peers at the same tier without us re-tiering them.
    let total = 0;
    const weights = pool.map(id => {
      const w = ITEM_BY_ID[id]?.dropWeight;
      const v = (typeof w === 'number' && w > 0) ? w : 1;
      total += v;
      return v;
    });
    if (total <= 0) return pool[Math.floor(rng() * pool.length)];
    let r = rng() * total;
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  // ────────────────────────────────────────────────────────────────
  // Walk-up ladder for relics the player already owns. Pure upside — at each
  // rung above the owned tier, coin flip between cashing out at half the
  // gearPrice or climbing one rung. Stopping condition is "first cash-out OR
  // reach T7." Reaching T7 always returns the relic itself (no cash-out).
  // The {jackpot} flag is propagated unchanged so the caller can still draw
  // fanfare even when the result is gold.
  // ────────────────────────────────────────────────────────────────
  function reconcileRelicOffer(rolled, save, rng) {
    const slot = rolled.slot;
    let t = rolled.tier;
    const owned = save?.relics?.[slot]?.tier ?? 0;
    if (t > owned) return { kind: 'relic', slot, tier: t, jackpot: rolled.jackpot || 0 };
    t = owned;
    const priceFor = (tier) => (typeof _gearPrice === 'function')
      ? _gearPrice('relic', slot, tier) : 0;
    while (t < 7) {
      if (rng() < RARITY_TUNING.walkUpStepP) {
        return {
          kind: 'gold',
          slot, tier: t,
          amount: Math.max(1, Math.floor(priceFor(t) / 2)),
          jackpot: rolled.jackpot || 0,
        };
      }
      t += 1;
    }
    // Climbed all the way without cashing out — hand over the T7 relic.
    return { kind: 'relic', slot, tier: 7, jackpot: rolled.jackpot || 0 };
  }

  // ────────────────────────────────────────────────────────────────
  // The picker. Returns null when no item matches (caller should fall back).
  //   { kind: 'item',  id, qty, tier, cls, jackpot }
  //   { kind: 'relic', slot, tier, jackpot }
  //   { kind: 'gold',  slot, tier, amount, jackpot }     ← from walk-up
  // ────────────────────────────────────────────────────────────────
  function pickReward(contextKey, save, rng) {
    rng = rng || Math.random;
    const ctx = LOOT_CONTEXTS[contextKey];
    if (!ctx) return null;

    // 1) Pick class. If the context's relicCap is 0, scrub the relic weight so
    // it can't be chosen at all (a market never offers a relic, no matter how
    // skewed the bias gets).
    const bias = { ...ctx.classBias };
    if ((ctx.relicCap ?? 7) <= 0) delete bias.relic;
    const cls = weightedPick(bias, rng);
    if (!cls) return null;

    // 2) Boost chain. Start T1 / bracket 0; each step coin-flips between
    // bumping tier and bumping qty bracket. Relic class always tier-ups
    // (quantity is meaningless for relics). Chain stops when boost fails
    // OR both tier and bracket sit at their caps.
    const luck = ringLuck(save);
    const classMul = (RARITY_TUNING.classChainBoostMul && RARITY_TUNING.classChainBoostMul[cls]) ?? 1;
    const boostP = Math.min(0.95, ((ctx.boostP ?? 0.5) * classMul) + luck);
    const tierCap = cls === 'relic'
      ? Math.min(ctx.relicCap ?? 7, 7)
      : Math.min(ctx.maxTier ?? 7, CLASS_MAX_TIER[cls] || 1);
    let tier = 1, bracket = 0;
    let safety = 64;
    while (rng() < boostP && safety-- > 0) {
      const goTier = cls === 'relic' || rng() < RARITY_TUNING.tierVsQtySplit;
      if (goTier) {
        tier += 1;
        if (tier > tierCap) { tier = tierCap; bracket += 1; }
      } else {
        bracket += 1;
      }
      if (bracket > 3) bracket = 3;
      if (tier >= tierCap && bracket >= 3) break;
    }
    // Amulet: per-tier extra bracket roll (folded into the chain rather than
    // a post-multiply, so it stops doubling unbounded).
    if (cls !== 'relic' && rng() < amuletBracketChance(save)) {
      bracket = Math.min(3, bracket + 1);
    }

    // 3) Jackpot. Independent 1/2^N chance of +N tiers, clamped to context cap.
    let jackpot = 0;
    while (rng() < RARITY_TUNING.jackpotP && jackpot < 7) jackpot++;
    const beforeJackpot = tier;
    tier = Math.min(tierCap, tier + jackpot);
    const jackpotApplied = tier - beforeJackpot;

    // 4) Resolve to a concrete item / relic / gold.
    if (cls === 'relic') {
      const slots = Object.keys(_RELIC_DEFS);
      if (!slots.length) return null;
      const slot = slots[Math.floor(rng() * slots.length)];
      return reconcileRelicOffer({ slot, tier, jackpot: jackpotApplied }, save, rng);
    }
    const id = pickItemInClass(cls, tier, rng);
    if (!id) return null;
    const brackets = (RARITY_TUNING.qtyBracketsByClass && RARITY_TUNING.qtyBracketsByClass[cls])
      || RARITY_TUNING.qtyBracketsDefault;
    const [lo, hi] = brackets[bracket];
    const qty = lo + Math.floor(rng() * (hi - lo + 1));
    return { kind: 'item', id, qty, tier, cls, jackpot: jackpotApplied };
  }

  global.RARITY_TUNING       = RARITY_TUNING;
  global.LOOT_CONTEXTS       = LOOT_CONTEXTS;
  global.ITEMS_BY_CLASS_TIER = ITEMS_BY_CLASS_TIER;
  global.CLASS_MAX_TIER      = CLASS_MAX_TIER;
  global.pickReward          = pickReward;
  global.reconcileRelicOffer = reconcileRelicOffer;
  global.weightedPick        = weightedPick;
})(window);
