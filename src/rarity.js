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
//   pickReward(key, save, rng)        → { kind:'item'|'relic'|'armor'|'gold', … }
//                                        (chest contexts roll relic OR armor via rollGearUpgrade)
//   reconcileRelicOffer(rolled, save, rng) → walk-up ladder for dupes
//                                             (relic by default; pass rolled.kind
//                                             'armor' for an armor slot)

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
    // live catch at a time), consumable (tap-to-use), sapling (one fruit tree
    // per find — packs of tree saplings read wrong). qty always 1 regardless
    // of bumps for these. flora maps to the produce 'flowers' item via picker
    // routing, but we treat it as a small-qty class.
    singleStackClasses: ['relic', 'animal', 'consumable', 'sapling'],
    // Chest tier 1..5 modifiers. Applied on top of the biome's classBias to
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
      // T5 is the CAVE tier: a chest two or more levels underground rises past
      // the surface's T4 (loot.js chestTier, CHEST_TIER_DEPTH_STEP). One more
      // deterministic step than T4 and a chain that reaches T5 on its own;
      // the absolute ceilings are already the top of the ladder.
      5: { chainSteps: 4, chainMax: 5, maxTier: 7, relicCap: 7, relicChainMax: 5 },
    },
    // (classChainBoostMul removed — chain is deterministic and applies the
    // same 33/67 qty-vs-tier split to every class. Mineral no longer gets a
    // special damper; coal only shows up in T1 chests now.)
    walkUpStepP:         0.5,    // walk-up ladder: P(climb vs cash-out)
  };

  // ────────────────────────────────────────────────────────────────
  // Per-context picking shape. Each row owns:
  //   classBias — weights for which item-class the reward comes from
  //   chainSteps / chainMax — how many deterministic boost steps fire, and the
  //               tier the chain alone can climb to (see pickReward)
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
    //   - tier 1..5 (T5 only underground, see loot.js chestTier): drives the curve
    //     — HOW MUCH and HOW RARE the contents are
    // Biome rows declare classBias only; the tier modifier (CHEST_TIER_MOD
    // below) supplies chainSteps / chainMax / maxTier / relicCap. Call sites:
    //   pickReward('chest:' + biome, save, rng, { tier: chestTier(poiClass) })
    // The picker merges the biome row with the tier mod at pick time.
    // Relic share is roughly half what it used to be — relics were turning
    // up too often across the board. They're still strongly weighted on the
    // civic / flora biomes (museums + florists are the magical-item spots).
    // lowtier biome carries a small relic share. T1 chests scrub it via
    // relicCap=0; T2+ chests honour it.
    // Relic weights bumped +50% across all chest contexts (per user) — chest
    // relic/armor odds now run ~3.75%-15% by class (weightedPick normalises, so
    // raising only the relic share draws proportionally off the existing mix).
    'chest:lowtier':    { classBias: { seed:0.45, produce:0.38, mineral:0.10, consumable:0.06, animal:0.005, relic:0.0375 } },
    'chest:commerce':   { classBias: { seed:0.35, produce:0.35, mineral:0.10, consumable:0.12, animal:0.01,  relic:0.0525 } },
    'chest:food':       { classBias: { produce:0.58, seed:0.22, mineral:0.05, consumable:0.07, animal:0.00,  relic:0.06   } },
    'chest:civic':      { classBias: { seed:0.25, produce:0.12, mineral:0.16, consumable:0.25, animal:0.02,  relic:0.15   } },
    'chest:health':     { classBias: { mineral:0.32, produce:0.22, consumable:0.22, seed:0.12, animal:0.00,  relic:0.09   } },
    // Fruit-tree saplings are a rare nature-chest find: a small `sapling`
    // share on the park/farm/flora contexts only. They're baseTier 3+, and
    // pickItemInClass only slides DOWN, so they surface from higher-tier
    // chests rather than the T1 lowtier boxes — naturally scarce.
    'chest:park':       { classBias: { seed:0.36, produce:0.24, animal:0.02, mineral:0.14, consumable:0.14, relic:0.075, sapling:0.04 } },
    'chest:farm':       { classBias: { seed:0.34, produce:0.34, animal:0.12, mineral:0.08, consumable:0.07, relic:0.0375, sapling:0.04 } },
    'chest:flora':      { classBias: { seed:0.40, produce:0.25, mineral:0.00, consumable:0.15, animal:0.00,  relic:0.15, sapling:0.05 } },

    // ── Shops, by specialty ─────────────────────────────────────
    // Shops use the same deterministic chain. chainSteps maps to the
    // 'level' of the shop: plain/market/trader = mid (1-2 steps), forts
    // and blacksmiths a bit higher, castle highest (relic-only).
    //
    // NOT reached from the shipped game — house/trader/blacksmith UIs build
    // their own offers (app.js buildShopOffer / buildRelicOffer), so these
    // 'shop:*' rows never get pickReward'd in play. Their consumer is
    // tools/balancing.html, which iterates every LOOT_CONTEXTS key (including
    // these) to simulate "what would this shop give me" for tuning. Kept
    // deliberately — do not flag as dead code.
    //
    // singleItem: true forces qty=1 (except seeds, which ship in packs).
    // Live animals are only sold by traders — buying a live chicken from
    // a corner market doesn't read right; only the wandering merchant
    // (trader) deals in livestock.
    'shop:plain':       { classBias: { seed:0.40, produce:0.40, mineral:0.10, consumable:0.10 },
                          chainSteps: 1, chainMax: 2, maxTier: 3, relicCap: 0, singleItem: true },
    'shop:market':      { classBias: { produce:0.70, seed:0.20, consumable:0.10 },
                          chainSteps: 1, chainMax: 2, maxTier: 3, relicCap: 0, singleItem: true },
    // Blacksmiths exclusively convert gems → relics. classBias is relic-only;
    // the player trades a fixed gem cost and the smith forges one relic tier
    // above what they already hold in that slot. If every slot is maxed,
    // the smith has nothing better to forge → 'still working on it' flash.
    'shop:blacksmith':  { classBias: { relic: 1.00 },
                          chainSteps: 2, chainMax: 3, maxTier: 6, relicCap: 5, singleItem: true },
    // Wandering trader / fort quartermaster also deal the occasional fruit-tree
    // sapling (small share; maxTier 4 keeps it to the apple — peach stays a
    // rare nature-chest find).
    'shop:trader':      { classBias: { animal:0.35, mineral:0.15, produce:0.20, seed:0.15, consumable:0.10, relic:0.05, sapling:0.05 },
                          chainSteps: 2, chainMax: 3, maxTier: 4, relicCap: 3, singleItem: true },
    'shop:fort':        { classBias: { seed:0.27, produce:0.27, mineral:0.17, consumable:0.17, relic:0.12, sapling:0.04 },
                          chainSteps: 2, chainMax: 3, maxTier: 4, relicCap: 3, singleItem: true },
    'shop:castle':      { classBias: { relic: 1.00 },
                          chainSteps: 3, chainMax: 4, maxTier: 7, relicCap: 7, singleItem: true },

    // ── Floating treasure mark ──────────────────────────────────
    // Small fixed reward — no chain (always rolls T1) plus jackpot.
    'treasure:default': { classBias: { seed:0.45, produce:0.30, mineral:0.10, consumable:0.15 },
                          chainSteps: 0, chainMax: 1, maxTier: 2, relicCap: 0 },
    // ── Elite monster drop ──────────────────────────────────────
    // What a shiny cave monster pays once its kind's Discovery badge is
    // banked (app.js › resolveDefeat). Biased to RELICS — half the class
    // weight, the heaviest relic share of any context — because the foe was
    // twice the fight. "Commensurate tier" is the caller's: one chain step
    // here, and app.js › eliteRollBonus buys tier-only steps off the depth
    // and the kind's own introduction depth (opts.rollBonus), so a goblin
    // archer three levels down rolls higher than a cave slime at the first.
    // A relic sits one tier UNDER the chain (see pickReward's relic branch),
    // so relicCap 6 means a T5 relic at the very top.
    'treasure:elite':   { classBias: { relic:0.50, mineral:0.20, consumable:0.15, seed:0.08, produce:0.07 },
                          chainSteps: 1, chainMax: 5, maxTier: 5, relicCap: 6, relicChainMax: 6 },
  };

  // ────────────────────────────────────────────────────────────────
  // Build ITEMS_BY_CLASS_TIER once. Two-level map: kind → tier → [ids].
  // Skips relics (they live in RELIC_DEFS and span every tier 1..7 per slot).
  // Skips items missing a numeric baseTier (defensive — see items.js fill-in).
  // Skips `shiny: true` variants — those are a 5% wild-catch-only bonus with
  // its own 10× value balancing (see items.js awardShinyBonus / catchCreature
  // in app.js). They must never be reachable through the class/tier pool, or
  // any chest with animal weight can hand one out directly, bypassing both
  // the acquisition odds and the value multiplier that assume it's rare.
  // ────────────────────────────────────────────────────────────────
  // ITEMS / RELIC_DEFS are declared with `const` at the top of items.js, so
  // they live on the global lexical scope but NOT on `window`. Reach them
  // through `globalThis` (which exposes the global lexical scope in modern
  // browsers) with a defensive bare-name fallback.
  const _ITEMS      = (typeof ITEMS      !== 'undefined') ? ITEMS      : [];
  const _ITEM_BY_ID = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID : {};
  const _RELIC_DEFS = (typeof RELIC_DEFS !== 'undefined') ? RELIC_DEFS : {};
  const _ARMOR_DEFS = (typeof ARMOR_DEFS !== 'undefined') ? ARMOR_DEFS : {};
  const _gearPrice  = (typeof gearPrice  !== 'undefined') ? gearPrice  : null;
  const _pickFromArray = (typeof pickFromArray !== 'undefined') ? pickFromArray : (arr) => arr[Math.floor(Math.random() * arr.length)];

  function buildClassTierIndex() {
    const out = {};
    for (const it of _ITEMS) {
      if (it.shiny) continue;
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
  // Helpers.
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
      const w = _ITEM_BY_ID[id]?.dropWeight;
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
  // Walk-up ladder for gear the player already owns. Pure upside — at each
  // rung above the owned tier, coin flip between cashing out at half the
  // gearPrice or climbing one rung. Stopping condition is "first cash-out OR
  // reach T7." Reaching T7 always returns the gear itself (no cash-out).
  // The {jackpot} flag is propagated unchanged so the caller can still draw
  // fanfare even when the result is gold.
  // `rolled.kind` selects relic (default) vs armor — armor slots live in
  // save.armor rather than save.relics, and get the SAME walk-up treatment
  // (fixedChestReward routes a fixed armor payload through here too, so a
  // future `kind: 'armor'` starter chest can't downgrade equipped armor).
  // ────────────────────────────────────────────────────────────────
  function reconcileRelicOffer(rolled, save, rng) {
    const kind = rolled.kind || 'relic';
    const slot = rolled.slot;
    let t = rolled.tier;
    const ownedTable = kind === 'armor' ? save?.armor : save?.relics;
    const owned = ownedTable?.[slot]?.tier ?? 0;
    if (t > owned) return { kind, slot, tier: t, jackpot: rolled.jackpot || 0 };
    t = owned;
    const priceFor = (tier) => (typeof _gearPrice === 'function')
      ? _gearPrice(kind, slot, tier) : 0;
    // Slot already maxed at T7: there's nothing to climb to, so cash out
    // consolation gold rather than handing back a useless duplicate relic.
    if (t >= 7) {
      return {
        kind: 'gold',
        slot, tier: 7, gearKind: kind,
        amount: Math.max(1, Math.floor(priceFor(7) / 2)),
        jackpot: rolled.jackpot || 0,
      };
    }
    while (t < 7) {
      if (rng() < RARITY_TUNING.walkUpStepP) {
        return {
          kind: 'gold',
          slot, tier: t, gearKind: kind,
          amount: Math.max(1, Math.floor(priceFor(t) / 2)),
          jackpot: rolled.jackpot || 0,
        };
      }
      t += 1;
    }
    // Climbed all the way without cashing out — hand over the T7 gear.
    return { kind, slot, tier: 7, jackpot: rolled.jackpot || 0 };
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
    // (chainSteps), each one a tier-up or a quantity bracket:
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
    // ROLL BONUS — extra steps the caller paid for (opts.rollBonus; the
    // cobble-trail prize spends Trail.PRIZE_ROLL_BONUS on it, one more for
    // every prize already won). These buy TIER AND NOTHING ELSE.
    //
    // They used to be ordinary chain steps, and a step that can't find tier
    // headroom falls through to a quantity bracket — so the trail prize, which
    // already rolls the T4 curve at its own chainMax, spent its bonus on the
    // stack every time and handed over "× 2" of a T4 item on roughly every
    // other prize. The player reads that as the reward's quantity being fixed
    // at two, which is exactly what it was. A longer walk is supposed to buy a
    // BETTER find, not a bigger pile of the same one: the quantity a prize
    // shows is the context's own standard roll, and a bonus with nowhere left
    // to climb pays consolation coins instead of padding the stack.
    //
    // The context's maxTier / chainMax still bound the result, so a bonus can
    // lift a roll toward its ceiling but never above it. It does not touch a
    // gear roll — those go through rollGearUpgrade on the chest tier alone.
    const bonusSteps = Math.max(0, Math.floor((opts && opts.rollBonus) || 0));
    for (let i = 0; i < bonusSteps; i++) {
      if (tier < chainCap) tier += 1;
      else wastedQtyBumps += 1;        // no headroom left — pay it out in coins
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
      // CHEST opens roll a relic OR ARMOR (armor is just another gear slot),
      // milestone-gated by the player's harvest/catch progress — the same
      // picker fishing uses. rollGearUpgrade returns a {relic|armor} upgrade,
      // or {gold} consolation when the player already owns a finer one. The
      // chest's tier (opts.tier, 1-5) drives the preferred reward tier.
      if (contextKey.startsWith('chest:')) {
        const chestT = (opts && opts.tier) || 2;
        return rollGearUpgrade(rng, save?.relics, chestT, save?.armor);
      }
      const slot = slots[Math.floor(rng() * slots.length)];
      // Relics deduct one tier off whatever the chain rolled — a T2 chest
      // that produced tier=2 still offers a T1 (wood) relic. Floor at 1 and
      // re-clamp against relicCap.
      const relicTier = Math.max(1, Math.min(finalCap, tier - 1));
      // Every chain qty-step on a relic class was "wasted" (relic has no
      // qty axis). Roll those into consolation alongside the qty-cap waste —
      // except for shops, which never pay consolation (player is buying).
      if (!ctx.singleItem) wastedQtyBumps += bracket;
      const out = reconcileRelicOffer({ slot, tier: relicTier, jackpot: jackpotApplied }, save, rng);
      if (out) out.consolation = ctx.singleItem ? 0 : consolationFor(relicTier);
      return out;
    }
    const id = pickItemInClass(cls, tier, rng);
    if (!id) return null;
    // Quantity from chain+jackpot qty BUMPS. Each bump adds 1..N to the
    // stack where N is tierQtyPerBump[itemTier]. A T1 seed bump adds 1..5,
    // a T4 seed bump adds exactly 1 — high-tier items refuse to pack.
    // Single-stack classes (animal, consumable, relic) ignore bumps; their
    // accumulated bracket converts to wasted-qty-bumps for consolation gold.
    // Shops (ctx.singleItem) also force qty=1 — they sell one thing at a
    // time, not bundles. No consolation for shops either; the player is
    // buying, not receiving free loot.
    const itemTier = _ITEM_BY_ID[id]?.baseTier ?? tier;
    let qty = 1;
    if (ctx.singleItem) {
      // Shops sell one item at a time, EXCEPT seeds — players plant in
      // bulk, so seed packs ship in 5 (T1-T3) or 1 (T4 Frost flowers).
      // Any qty bumps the chain rolled are discarded; no consolation
      // since the player is buying, not receiving.
      if (cls === 'seed') qty = itemTier >= 4 ? 1 : 5;
    } else if ((RARITY_TUNING.singleStackClasses || []).includes(cls)) {
      wastedQtyBumps += bracket;          // bracket is dead for these classes
    } else {
      const perBump = (RARITY_TUNING.tierQtyPerBump || [])[Math.min(itemTier, 7)] || 1;
      for (let i = 0; i < bracket; i++) qty += 1 + Math.floor(rng() * perBump);
    }
    return { kind: 'item', id, qty, tier, cls, jackpot: jackpotApplied,
             consolation: ctx.singleItem ? 0 : consolationFor(itemTier) };
  }

  // ────────────────────────────────────────────────────────────────
  // Allowed relic tiers. Every tier 1-7 is permitted here — the real ceiling
  // on how high a roll can go is the per-source loot rule (the `maxTier` /
  // `relicCap` in RARITY_TUNING / LOOT_CONTEXTS, plus the chest-tier-derived
  // `preferred` clamp in rollGearUpgrade below), so a low-tier chest still
  // can't cough up a Frost relic. The old harvest/catch "milestone" unlocks
  // were removed: they duplicated that gating with a second, invisible lock
  // the player couldn't see, so a bus chest was already incapable of dropping
  // Gold regardless. `progress` is kept in the signature for call-site
  // compatibility but is no longer read.
  // ────────────────────────────────────────────────────────────────
  function chestRelicAllowedTiers(progress) {
    return [1, 2, 3, 4, 5, 6, 7];
  }

  // Dedicated relic/armor jackpot picker — used by fishing (2% cast jackpot)
  // and by the chest relic path in pickReward. Guarantees a gear result (relic
  // or armor upgrade, or consolation gold). Moved here from loot.js; replaces
  // the old pickChestRelic. `chestT` 1-5 drives the preferred/ceiling tier.
  function rollGearUpgrade(rng, currentRelics, chestT = 2, currentArmor = null) {
    const random = rng || Math.random;
    const allowed = chestRelicAllowedTiers();
    if (!allowed.length || !Object.keys(_RELIC_DEFS).length) return null;
    // preferred is clamped to 1..7 and every tier 1..7 is allowed, so the
    // capped pool is never empty.
    const preferred = Math.min(7, Math.max(1, Math.round(1 + (chestT - 1) * 2)));
    const capped = allowed.filter(t => t <= preferred);
    const weighted = capped.map(t => ({ t, w: 1 / (1 + Math.abs(t - preferred)) }));
    const total = weighted.reduce((a, b) => a + b.w, 0);
    let r = random() * total;
    let pickedTier = weighted[0].t;
    for (const w of weighted) { r -= w.w; if (r <= 0) { pickedTier = w.t; break; } }
    const relicSlots = Object.keys(_RELIC_DEFS);
    const armorSlots = Object.keys(_ARMOR_DEFS);
    const slotPool = [
      ...relicSlots.map(s => ({ kind: 'relic', slot: s })),
      ...armorSlots.map(s => ({ kind: 'armor', slot: s })),
    ];
    const sp = _pickFromArray(slotPool, random);
    const cur = sp.kind === 'relic'
      ? (currentRelics?.[sp.slot]?.tier ?? 0)
      : (currentArmor?.[sp.slot]?.tier ?? 0);
    if (pickedTier > cur) return { kind: sp.kind, slot: sp.slot, tier: pickedTier };
    const price = _gearPrice ? _gearPrice(sp.kind, sp.slot, pickedTier) : 0;
    return { kind: 'gold', amount: Math.max(1, Math.floor(price / 2)), slot: sp.slot, gearKind: sp.kind, tier: pickedTier };
  }

  global.RARITY_TUNING          = RARITY_TUNING;
  global.LOOT_CONTEXTS          = LOOT_CONTEXTS;
  global.ITEMS_BY_CLASS_TIER    = ITEMS_BY_CLASS_TIER;
  global.pickReward             = pickReward;
  global.reconcileRelicOffer    = reconcileRelicOffer;
  global.chestRelicAllowedTiers = chestRelicAllowedTiers;
  global.rollGearUpgrade        = rollGearUpgrade;
})(window);
