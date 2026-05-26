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
    tierVsQtySplit:      0.5,    // during boost chain, P(go tier) vs P(go qty)
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
      // T1 chests never offer relics — they're the floor-tier 'small treats'
      // chest. Relics start showing up at T2 (wood-only). boostP=0 means
      // the chain never runs at T1 — the only path to T2 or a bigger qty
      // stack is the jackpot, which fires at jackpotEntryP × 50% per axis
      // (≈8% T2 upgrade, ≈8% qty boost).
      1: { boostP: 0,    chainMax: 1, maxTier: 4, relicCap: 0 },
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

    // 3) Jackpot. Geometric chain rooted at jackpotEntryP × jackpotContinueP.
    // Each step independently picks tier-up vs qty-up 50/50 (same split as
    // the boost chain). Fanfare fires on any non-zero jackpot — every boost
    // is celebratory.
    let jackpotSteps = 0;
    if (rng() < RARITY_TUNING.jackpotEntryP) {
      jackpotSteps = 1;
      while (rng() < RARITY_TUNING.jackpotContinueP && jackpotSteps < 7) jackpotSteps++;
    }
    const tierBefore = tier;
    for (let i = 0; i < jackpotSteps; i++) {
      // For relics, qty is meaningless — force tier-up. Otherwise 50/50.
      const goTier = isRelic || rng() < 0.5;
      if (goTier && tier < finalCap) tier++;
      else if (!goTier && bracket < 3) bracket++;
      // (Both axes at cap → the boost just sparkles for free; rare.)
    }
    const jackpotApplied = jackpotSteps;
    void tierBefore;   // retained for potential debugging; reading it is free.

    // 4) Resolve to a concrete item / relic / gold.
    if (cls === 'relic') {
      const slots = Object.keys(_RELIC_DEFS);
      if (!slots.length) return null;
      const slot = slots[Math.floor(rng() * slots.length)];
      return reconcileRelicOffer({ slot, tier, jackpot: jackpotApplied }, save, rng);
    }
    const id = pickItemInClass(cls, tier, rng);
    if (!id) return null;
    // Quantity from chain+jackpot qty BUMPS. Each bump adds 1..N to the
    // stack where N is tierQtyPerBump[itemTier]. A T1 seed bump adds 1..5,
    // a T4 seed bump adds exactly 1 — high-tier items refuse to pack.
    // Single-stack classes (animal, consumable, relic) ignore bumps.
    const itemTier = _ITEM_BY_ID[id]?.baseTier ?? tier;
    let qty = 1;
    if (!(RARITY_TUNING.singleStackClasses || []).includes(cls)) {
      const perBump = (RARITY_TUNING.tierQtyPerBump || [])[Math.min(itemTier, 7)] || 1;
      for (let i = 0; i < bracket; i++) qty += 1 + Math.floor(rng() * perBump);
    }
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
