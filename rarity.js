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
    // Jackpot fires with entryP, then chains via continueP. Each boost step
    // picks tier-up vs qty-up 50/50 (same split as the boost chain). Every
    // jackpot — even a +1 — triggers the fanfare popup.
    //   P(any jackpot)   = entryP            ~16% — fanfare rate
    //   P(2-step chain)  = entryP × cont     ~4%
    //   P(3-step chain)  = entryP × cont²    ~1%
    //   P(4-step chain)  = entryP × cont³    ~0.25%
    jackpotEntryP:       0.16,
    jackpotContinueP:    0.25,
    chainQtyP:           0.33,   // per chain step, P(qty-up) vs (1-chainQtyP) tier-up. At T2 chest (1 step): 67% T2 / 33% T1+qty. At T3 chest (2 steps): 45% T3 / 44% T2 / 11% T1.
    amuletBoostBracketP: 0.05,   // per amulet tier, P(extra qty-bracket bump)
    // Quantity model: each qty BUMP (from the chain or jackpot) adds
    // 1..tierQtyPerBump[itemTier] to the stack. A T1 seed with 2 bumps can
    // land at 10 (two random(1..5) rolls + 1 base); a T4 seed with 2 bumps
    // tops out at 3 (two random(1..1) rolls + 1 base). Index by item tier.
    // Index 0 is unused; tiers 1..7.
    tierQtyPerBump: [0, 5, 3, 2, 1, 1, 1, 1],
    // Classes that are inherently single-stack — relic (no qty), animal (one
    // live catch at a time), consumable (tap-to-use). qty always 1 regardless
    // of bumps for these. flora maps to the produce 'flowers' item via picker
    // routing, but we treat it as a small-qty class.
    singleStackClasses: ['relic', 'animal', 'consumable'],
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
      // The chain is deterministic per chest tier: chainSteps unconditional
      // boost steps, each tier-up if below chainCap, else qty-up. That puts
      // every chest at its own tier 100% of the time (before jackpot), so
      // T2 chests don't leak T1 items like coal × 1. Jackpot is the only
      // path above the chest tier (~8% tier-side, ~8% qty-side per pull).
      //
      // T1 chests never offer relics — they're the floor-tier 'small treats'
      // chest. chainSteps=0 means tier stays at T1; only jackpot produces
      // variance.
      1: { chainSteps: 0, chainMax: 1, maxTier: 4, relicCap: 0 },
      2: { chainSteps: 1, chainMax: 2, maxTier: 5, relicCap: 2 },
      3: { chainSteps: 2, chainMax: 3, maxTier: 7, relicCap: 4 },
      4: { chainSteps: 3, chainMax: 4, maxTier: 7, relicCap: 7, relicChainMax: 4 },
    },
    // (classChainBoostMul removed — chain is deterministic and applies the
    // same 33/67 qty-vs-tier split to every class. Mineral no longer gets a
    // special damper; coal only shows up in T1 chests now.)
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
    // lowtier biome carries a small relic share. T1 chests scrub it via
    // relicCap=0; T2+ chests honour it (T2 lowtier chest = ~5% relic).
    'chest:lowtier':    { classBias: { seed:0.45, produce:0.38, mineral:0.10, consumable:0.06, animal:0.005, relic:0.05 } },
    'chest:commerce':   { classBias: { seed:0.35, produce:0.35, mineral:0.10, consumable:0.12, animal:0.01,  relic:0.07 } },
    'chest:food':       { classBias: { produce:0.58, seed:0.22, mineral:0.05, consumable:0.07, animal:0.00,  relic:0.08 } },
    'chest:civic':      { classBias: { seed:0.25, produce:0.12, mineral:0.16, consumable:0.25, animal:0.02,  relic:0.20 } },
    'chest:health':     { classBias: { mineral:0.32, produce:0.22, consumable:0.22, seed:0.12, animal:0.00,  relic:0.12 } },
    'chest:park':       { classBias: { seed:0.36, produce:0.24, animal:0.02, mineral:0.14, consumable:0.14, relic:0.10 } },
    'chest:farm':       { classBias: { seed:0.34, produce:0.34, animal:0.12, mineral:0.08, consumable:0.07, relic:0.05 } },
    'chest:flora':      { classBias: { seed:0.40, produce:0.25, mineral:0.00, consumable:0.15, animal:0.00,  relic:0.20 } },

    // ── Shops, by specialty ─────────────────────────────────────
    // Shops use the same deterministic chain. chainSteps maps to the
    // 'level' of the shop: plain/market/trader = mid (1-2 steps), forts
    // and blacksmiths a bit higher, castle highest (relic-only).
    'shop:plain':       { classBias: { seed:0.35, produce:0.35, animal:0.10, mineral:0.10, consumable:0.10 },
                          chainSteps: 1, chainMax: 2, maxTier: 3, relicCap: 0 },
    'shop:market':      { classBias: { produce:0.65, seed:0.20, animal:0.10, consumable:0.05 },
                          chainSteps: 1, chainMax: 2, maxTier: 3, relicCap: 0 },
    'shop:blacksmith':  { classBias: { mineral:0.40, relic:0.55, consumable:0.05 },
                          chainSteps: 2, chainMax: 3, maxTier: 6, relicCap: 5 },
    'shop:trader':      { classBias: { animal:0.35, mineral:0.15, produce:0.20, seed:0.15, consumable:0.10, relic:0.05 },
                          chainSteps: 2, chainMax: 3, maxTier: 4, relicCap: 3 },
    'shop:fort':        { classBias: { seed:0.25, produce:0.25, mineral:0.15, consumable:0.15, animal:0.10, relic:0.10 },
                          chainSteps: 2, chainMax: 3, maxTier: 4, relicCap: 3 },
    'shop:castle':      { classBias: { relic: 1.00 },
                          chainSteps: 3, chainMax: 4, maxTier: 7, relicCap: 7 },

    // ── Floating treasure mark ──────────────────────────────────
    // Small fixed reward — no chain (always rolls T1) plus jackpot.
    'treasure:default': { classBias: { seed:0.45, produce:0.30, mineral:0.10, consumable:0.15 },
                          chainSteps: 0, chainMax: 1, maxTier: 2, relicCap: 0 },
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
  const _ITEM_BY_ID = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID : {};
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
    const isRelic = cls === 'relic';
    const finalCap = isRelic
      ? Math.min(ctx.relicCap ?? 7, 7)
      : Math.min(ctx.maxTier ?? 7, CLASS_MAX_TIER[cls] || 1);
    const chainCap = isRelic
      ? Math.min(ctx.relicChainMax ?? finalCap, finalCap)
      : Math.min(ctx.chainMax ?? finalCap, finalCap);
    // Deterministic chain. The context declares how many boost steps fire
    // (chainSteps). Each step:
    //   • 33% chance: qty-up (bracket++ if below cap, else nothing).
    //   • 67% chance: tier-up if below chainCap, else qty-up (fallback).
    // The chain never 'misses' — every step does something, which lets the
    // chest's tier be reached reliably while still providing variance.
    let tier = 1, bracket = 0;
    // Track qty bumps that the picker rolled but couldn't apply — bracket
    // already at 3, or the class is single-stack so the bump never converts
    // to actual qty. Each wasted bump pays out small consolation coins.
    let wastedQtyBumps = 0;
    const chainSteps = ctx.chainSteps ?? 0;
    const luck = ringLuck(save);
    const qtyP = Math.max(0, Math.min(0.95, (RARITY_TUNING.chainQtyP ?? 0.33) - luck));
    for (let i = 0; i < chainSteps; i++) {
      const goQty = rng() < qtyP;
      if (!goQty && tier < chainCap) tier += 1;
      else if (bracket < 3) bracket += 1;
      else wastedQtyBumps += 1;        // both axes maxed
    }
    // Amulet: per-tier extra bracket roll (folded in here rather than a
    // post-multiply, so it stops doubling unbounded).
    if (!isRelic && rng() < amuletBracketChance(save)) {
      if (bracket < 3) bracket += 1;
      else wastedQtyBumps += 1;
    }

    // 3) Jackpot. Geometric chain rooted at jackpotEntryP × jackpotContinueP.
    // Each step independently picks tier-up vs qty-up 50/50 (same split as
    // the boost chain). Fanfare fires on any non-zero jackpot — every boost
    // is celebratory.
    let jackpotSteps = 0;
    if (rng() < RARITY_TUNING.jackpotEntryP) {
      jackpotSteps = 1;
      while (rng() < RARITY_TUNING.jackpotContinueP && jackpotSteps < 7) jackpotSteps++;
    }
    for (let i = 0; i < jackpotSteps; i++) {
      // For relics, qty is meaningless — force tier-up. Otherwise 50/50.
      const goTier = isRelic || rng() < 0.5;
      if (goTier && tier < finalCap) tier++;
      else if (!goTier && bracket < 3) bracket++;
      else if (!goTier) wastedQtyBumps += 1;  // wanted qty, bracket capped
      // (a goTier step that hits finalCap is "wasted tier" — no coins for
      // that; tier-up restrictions are a feature of the chest cap, not a
      // qty restriction.)
    }
    const jackpotApplied = jackpotSteps;

    // Consolation gold for wasted qty bumps. Formula: $5 × wastedBumps × tier
    // (so a T1 wasted bump = $5, T4 wasted = $20). Capped against a per-pull
    // ceiling so freak jackpots don't dispense huge amounts of cash.
    const consolationFor = (rewardTier) => {
      if (wastedQtyBumps <= 0) return 0;
      const per = 5 * Math.max(1, rewardTier || 1);
      return Math.min(wastedQtyBumps * per, 100);
    };

    // 4) Resolve to a concrete item / relic / gold.
    if (cls === 'relic') {
      const slots = Object.keys(_RELIC_DEFS);
      if (!slots.length) return null;
      const slot = slots[Math.floor(rng() * slots.length)];
      // Relics deduct one tier off whatever the chain rolled — a T2 chest
      // that produced tier=2 still offers a T1 (wood) relic. Floor at 1 and
      // re-clamp against relicCap.
      const relicTier = Math.max(1, Math.min(finalCap, tier - 1));
      // Every chain qty-step on a relic class was "wasted" (relic has no
      // qty axis). Roll those into consolation alongside the qty-cap waste.
      wastedQtyBumps += bracket;
      const out = reconcileRelicOffer({ slot, tier: relicTier, jackpot: jackpotApplied }, save, rng);
      if (out) out.consolation = consolationFor(relicTier);
      return out;
    }
    const id = pickItemInClass(cls, tier, rng);
    if (!id) return null;
    // Quantity from chain+jackpot qty BUMPS. Each bump adds 1..N to the
    // stack where N is tierQtyPerBump[itemTier]. A T1 seed bump adds 1..5,
    // a T4 seed bump adds exactly 1 — high-tier items refuse to pack.
    // Single-stack classes (animal, consumable, relic) ignore bumps; their
    // accumulated bracket converts to wasted-qty-bumps for consolation gold.
    const itemTier = _ITEM_BY_ID[id]?.baseTier ?? tier;
    let qty = 1;
    if ((RARITY_TUNING.singleStackClasses || []).includes(cls)) {
      wastedQtyBumps += bracket;          // bracket is dead for these classes
    } else {
      const perBump = (RARITY_TUNING.tierQtyPerBump || [])[Math.min(itemTier, 7)] || 1;
      for (let i = 0; i < bracket; i++) qty += 1 + Math.floor(rng() * perBump);
    }
    return { kind: 'item', id, qty, tier, cls, jackpot: jackpotApplied,
             consolation: consolationFor(itemTier) };
  }

  global.RARITY_TUNING       = RARITY_TUNING;
  global.LOOT_CONTEXTS       = LOOT_CONTEXTS;
  global.ITEMS_BY_CLASS_TIER = ITEMS_BY_CLASS_TIER;
  global.CLASS_MAX_TIER      = CLASS_MAX_TIER;
  global.pickReward          = pickReward;
  global.reconcileRelicOffer = reconcileRelicOffer;
  global.weightedPick        = weightedPick;
})(window);
