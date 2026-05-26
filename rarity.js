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
    jackpotP:            0.50,   // P(another +1 tier in jackpot chain). +1 fires ~50%, +2 fanfare ~16% (applied), +3 ~4%, +4 ~1%. Higher raw rates clip down once the chest's tier cap is hit, so 0.5 lands on the 16/4/1 target after caps.
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
    // Chest tier 1..4 modifiers. Applied on top of the biome's classBias to
    // produce the effective context. Chest worldgen picks (biome, tier)
    // independently — same biome can appear at different tiers, same tier
    // across different biomes. See CHEST_TIER_BY_CATEGORY in loot.js for
    // the current biome→tier mapping (still used by the renderer for the
    // coloured diamond).
    //
    // chainMax bounds what the boost chain alone can reach; maxTier bounds
    // the absolute (post-jackpot) tier. Every tier gets a small jackpot
    // window above its chain — so a humble T1 chest can rarely produce a
    // fancier crop, and a T3 chest can occasionally jackpot a T7 fish.
    // Relics follow relicChainMax / relicCap separately; T4 is the only
    // chest where Frost (T7 relic) is reachable, and only via jackpot or
    // the walk-up ladder.
    chestTierMod: {
      // T1 chests never offer relics — they're the floor-tier "small treats"
      // chest. Relics start showing up at T2 (wood-only).
      1: { boostP: 0.30, chainMax: 2, maxTier: 4, relicCap: 0 },
      2: { boostP: 0.55, chainMax: 3, maxTier: 5, relicCap: 2 },
      3: { boostP: 0.70, chainMax: 5, maxTier: 7, relicCap: 4 },
      4: { boostP: 0.85, chainMax: 6, maxTier: 7, relicCap: 7, relicChainMax: 6 },
    },
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
    // ── Chests: BIOME × TIER ─────────────────────────────────────
    // A chest has TWO orthogonal axes:
    //   - biome (POI category): drives the classBias — WHAT it contains
    //   - tier 1..4 (one of the 4 chest spritesheets): drives the curve
    //     — HOW MUCH and HOW RARE the contents are
    // Biome rows declare classBias only; the tier modifier (CHEST_TIER_MOD
    // below) supplies boostP / chainMax / maxTier / relicCap. Call sites:
    //   pickReward('chest:' + biome, save, rng, { tier: chestTier(poiClass) })
    // The picker merges the biome row with the tier mod at pick time.
    // Relic share is roughly half what it used to be — relics were turning
    // up too often across the board. They're still strongly weighted on the
    // civic / flora biomes (museums + florists are the magical-item spots).
    'chest:lowtier':    { classBias: { seed:0.45, produce:0.38, mineral:0.10, consumable:0.07, animal:0.005 } },
    'chest:commerce':   { classBias: { seed:0.35, produce:0.35, mineral:0.10, consumable:0.12, animal:0.01,  relic:0.07 } },
    'chest:food':       { classBias: { produce:0.58, seed:0.22, mineral:0.05, consumable:0.07, animal:0.00,  relic:0.08 } },
    'chest:civic':      { classBias: { seed:0.25, produce:0.12, mineral:0.16, consumable:0.25, animal:0.02,  relic:0.20 } },
    'chest:health':     { classBias: { mineral:0.32, produce:0.22, consumable:0.22, seed:0.12, animal:0.00,  relic:0.12 } },
    'chest:park':       { classBias: { seed:0.36, produce:0.24, animal:0.02, mineral:0.14, consumable:0.14, relic:0.10 } },
    'chest:farm':       { classBias: { seed:0.34, produce:0.34, animal:0.12, mineral:0.08, consumable:0.07, relic:0.05 } },
    'chest:flora':      { classBias: { seed:0.40, produce:0.25, mineral:0.00, consumable:0.15, animal:0.00,  relic:0.20 } },

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
  function pickReward(contextKey, save, rng, opts) {
    rng = rng || Math.random;
    const baseCtx = LOOT_CONTEXTS[contextKey];
    if (!baseCtx) return null;
    // For chest contexts, merge in the per-tier modifier (default T2 if the
    // caller didn't pass one). Non-chest contexts ignore opts.tier. This keeps
    // biome × tier as two independent axes without exploding the table.
    let ctx = baseCtx;
    if (contextKey.startsWith('chest:')) {
      const t = (opts && opts.tier) || 2;
      const mod = (RARITY_TUNING.chestTierMod && RARITY_TUNING.chestTierMod[t])
        || RARITY_TUNING.chestTierMod?.[2] || {};
      ctx = { ...baseCtx, ...mod };
    }

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
    // The chain has its own ceiling (chainMax / relicChainMax) that may be
    // BELOW the absolute final ceiling (maxTier / relicCap). Anything above
    // chainMax is only reachable via the jackpot step (or, for relics, via
    // the walk-up ladder). On chest:t4 this is how 'Frost is jackpot/walkup
    // only' is encoded — chainMax=6, maxTier=7.
    const isRelic = cls === 'relic';
    const finalCap = isRelic
      ? Math.min(ctx.relicCap ?? 7, 7)
      : Math.min(ctx.maxTier ?? 7, CLASS_MAX_TIER[cls] || 1);
    const chainCap = isRelic
      ? Math.min(ctx.relicChainMax ?? finalCap, finalCap)
      : Math.min(ctx.chainMax ?? finalCap, finalCap);
    let tier = 1, bracket = 0;
    let safety = 64;
    while (rng() < boostP && safety-- > 0) {
      const goTier = isRelic || rng() < RARITY_TUNING.tierVsQtySplit;
      if (goTier) {
        tier += 1;
        if (tier > chainCap) { tier = chainCap; bracket += 1; }
      } else {
        bracket += 1;
      }
      if (bracket > 3) bracket = 3;
      if (tier >= chainCap && bracket >= 3) break;
    }
    // Amulet: per-tier extra bracket roll (folded into the chain rather than
    // a post-multiply, so it stops doubling unbounded).
    if (!isRelic && rng() < amuletBracketChance(save)) {
      bracket = Math.min(3, bracket + 1);
    }

    // 3) Jackpot. Independent 1/2^N chance of +N tiers, clamped to the
    // absolute (post-jackpot) cap, NOT chainMax. So Frost is reachable only
    // via this branch on contexts where chainMax < maxTier.
    let jackpot = 0;
    while (rng() < RARITY_TUNING.jackpotP && jackpot < 7) jackpot++;
    const beforeJackpot = tier;
    tier = Math.min(finalCap, tier + jackpot);
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
    // Tier-driven bracket demotion. Higher-tier items always come in smaller
    // stacks than their lower-tier siblings: a chest that "would have given"
    // 10 potato seeds at T1 gives ~3 gemfruit seeds at T2 and 1 iceflower
    // seed at T3. Default demotePerTier=2, clamped at bracket 0.
    const demote = (tier - 1) * (RARITY_TUNING.qtyDemotePerTier ?? 0);
    const effBracket = Math.max(0, bracket - demote);
    const brackets = (RARITY_TUNING.qtyBracketsByClass && RARITY_TUNING.qtyBracketsByClass[cls])
      || RARITY_TUNING.qtyBracketsDefault;
    const [lo, hi] = brackets[Math.min(effBracket, brackets.length - 1)];
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
