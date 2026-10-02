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
    luckPerUpgrade:      0.01,   // Seven Keen Eye rungs reach +0.07
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
    // P(extra qty-bracket bump) at the TOP of the wizard's quantity ladder.
    // Full Measure owns quantity luck now; jewelry no longer follows metal tiers.
    qtyLuckMaxP:         0.35,
    qtyLuckLevels:       3,
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
    singleStackClasses: ['relic', 'animal', 'magic', 'supply', 'legacyConsumable', 'sapling'],
    // Chest tier 1..5 modifiers. Applied on top of the biome's classBias to
    // produce the effective context. Chest worldgen picks (biome, tier)
    // independently — same biome can appear at different tiers, same tier
    // across different biomes. The tier is the chest's per-tile quota seat
    // (worldgen.js seedChestTiers, read through loot.js chestTier — also the
    // renderer's coloured diamond).
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
      // The underground tiers (loot.js chestTierMaxFor: T6 from cave level
      // 3, T7 from 6) ride T5's chain - the depth bonus already moved the
      // chest; the roll just pays at the tier it lands.
      6: { chainSteps: 4, chainMax: 5, maxTier: 7, relicCap: 7, relicChainMax: 5 },
      7: { chainSteps: 4, chainMax: 5, maxTier: 7, relicCap: 7, relicChainMax: 5 },
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
  //   favourite — { id, p }: one item this context PREFERS inside its own
  //               class. When that class is rolled, `id` wins with probability
  //               `p` instead of an even draw from the class/tier pool. Use it
  //               when a PLACE should be known for a thing (the school's Book);
  //               use items.js `dropWeight` when a thing should simply be
  //               commoner everywhere.
  //
  // TWO SYNTHETIC CLASSES sit in classBias beside the item kinds. Neither is
  // an items.js `kind` — they exist because what makes them a reward is not
  // WHICH item came out of the pool:
  //
  //   cash    — coins. Resolves to { kind:'gold', amount } with NO slot, so it
  //             is plainly money rather than a gear cash-out (the two shapes
  //             are told apart by `slot` everywhere they are paid: see
  //             interact.js grantTreasureRoll and interactables.js). Its worth
  //             is DERIVED, never tuned — see CASH_TIER_VALUE below.
  //   bundle  — a pile of raw material (wood and stone). Its own class rather
  //             than a mineral/produce roll because what makes it a bundle is
  //             the COUNT: a T1 chest rolls no quantity bracket at all
  //             (chainSteps 0), so wood out of the ordinary pool arrives one
  //             stick at a time. See BUNDLE_IDS / BUNDLE_QTY.
  //
  // Class weights inside each row do NOT need to sum to exactly 1.0 — we
  // re-normalise in weightedPick. Easier to author this way.
  // ────────────────────────────────────────────────────────────────
  const LOOT_CONTEXTS = {
    // Chest class odds come from the resolved themed groups, not a second table.
    ...Object.fromEntries(Object.keys(ChestThemes.themes).map(theme =>
      ['chest:' + theme, { theme, classBias: {} }])),
    'chest:lowtier': { theme: 'roadside', classBias: {} },

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
    'shop:plain':       { classBias: { seed:0.40, produce:0.40, mineral:0.10, magic:0.05, supply:0.05 },
                          chainSteps: 1, chainMax: 2, maxTier: 3, relicCap: 0, singleItem: true },
    'shop:market':      { classBias: { produce:0.70, seed:0.20, magic:0.05, supply:0.05 },
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
    'shop:trader':      { classBias: { animal:0.35, mineral:0.15, produce:0.20, seed:0.15, magic:0.05, supply:0.05, relic:0.05, sapling:0.05 },
                          chainSteps: 2, chainMax: 3, maxTier: 4, relicCap: 3, singleItem: true },
    'shop:fort':        { classBias: { seed:0.27, produce:0.27, mineral:0.17, magic:0.085, supply:0.085, relic:0.12, sapling:0.04 },
                          chainSteps: 2, chainMax: 3, maxTier: 4, relicCap: 3, singleItem: true },
    'shop:castle':      { classBias: { relic: 1.00 },
                          chainSteps: 3, chainMax: 4, maxTier: 7, relicCap: 7, singleItem: true },

    // ── Floating treasure mark ──────────────────────────────────
    // Small fixed reward — no chain (always rolls T1) plus jackpot.
    'treasure:default': { classBias: { seed:0.45, produce:0.30, mineral:0.10, supply:0.15 },
                          chainSteps: 0, chainMax: 1, maxTier: 2, relicCap: 0 },
    // ── The ROAD ladder's prize ─────────────────────────────────────────
    // What restoring a street pays (src/trail.js, app.js _fireTrailPrize).
    // The ceremony rolls ONE card per group (Trail.PRIZE_CARDS: cash / seed or
    // supply / boots or magic), each narrowed to its classes, so these weights
    // only split a group between its classes; boots are capped a tier a km
    // (Trail.bootsTierCap). Favourites make the magic card usually a potion.
    // The caller's rollBonus buys tiers up to T4; higher tiers need a jackpot.
    'treasure:road':    { classBias: { seed:0.20, magic:0.225, supply:0.025, boots:0.15, cash:0.15 }, cashMul: 0.5,
                          chainSteps: 1, chainMax: 4, maxTier: 6, relicCap: 0,
                          favourite: { p: 0.85, ids: {
                            reach_potion: 1, vigor_potion: 1,
                            speed_potion: 1, shield_potion: 1, revive_potion: 1,
                          } } },
    // ── A grove shrine's daily gift (src/zones.js, INTERACTABLES.grove_shrine)
    // One roll a day per shrine, worth about a buried X: the X's flat curve
    // (no chain, T1-2, no relics), a gardener's classes — seeds first, then
    // produce, then a magic item — and the growth powder as its FAVOURITE,
    // the way a school is known for its Book: a grove is where things grow.
    // (No sapling share: saplings start at T3, past this curve's ceiling, so
    // a sapling draw would pay nothing.)
    'treasure:shrine':  { classBias: { seed:0.55, produce:0.30, magic:0.15 },
                          chainSteps: 0, chainMax: 1, maxTier: 2, relicCap: 0,
                          favourite: { id: 'growth_powder', p: 0.5 } },
    // ── A viewpoint scope's daily gift (src/scenic.js VISTA_CONTEXT,
    // INTERACTABLES.vista_scope) — and the tide line's message bottle
    // (Scenic.BOTTLE_CONTEXT). A better grove shrine (~15 value, the design's
    // daily re-walk target): one chain step over the shrine's flat curve, a
    // walker's classes — seeds and a magic item, some produce, a supply.
    // Measured ~15 (scratchpad scenic2/ev.js, the balancing sheet's valuation).
    'treasure:vista':   { classBias: { seed:0.45, produce:0.30, magic:0.15, supply:0.10 },
                          chainSteps: 1, chainMax: 2, maxTier: 2, relicCap: 0 },
    // ── Elite monster drop ──────────────────────────────────────
    // What a shiny cave monster pays once its kind's memory is
    // banked (app.js › resolveDefeat). Biased to RELICS — half the class
    // weight, the heaviest relic share of any context — because the foe was
    // twice the fight. "Commensurate tier" is the caller's: one chain step
    // here, and app.js › eliteRollBonus buys tier-only steps off the depth
    // and the kind's own introduction depth (opts.rollBonus), so a goblin
    // archer three levels down rolls higher than a cave slime at the first.
    // A relic sits one tier UNDER the chain (see pickReward's relic branch),
    // so relicCap 6 means a T5 relic at the very top.
    'treasure:elite':   { classBias: { relic:0.50, mineral:0.20, magic:0.15, seed:0.08, produce:0.07 },
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
      if (it.shiny || it.kind === 'unique_relic') continue;
      // A BABY PET (items.js BABY_KINDS) comes from a nest bush or an egg,
      // never a chest — the same shape of exception as a shiny.
      if (it.baby) continue;
      // CAVE-ONLY finds (items.js `caveOnly` — the Magic Trap) are the same
      // shape of exception as a shiny: reachable only through the one lane
      // meant for them (CAVE_SUPPLY_SKEW's favourite set, below), never the
      // class/tier pool every surface chest, X mark and shop draws from.
      if (it.caveOnly) continue;
      // Made at a campfire, never found (items.js CAMPFIRE_MAKES).
      if (it.cooked) continue;
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

  // ────────────────────────────────────────────────────────────────
  // THE TWO SYNTHETIC CLASSES (see the classBias note above).
  // ────────────────────────────────────────────────────────────────
  // CASH. What a purse at tier T is worth is not a number anyone picked: it
  // is what an ITEM of that tier is worth, so a coin option and a loot option
  // on the same roll are the same prize stated two ways and the pick is a
  // preference rather than a trap. That is the median of items.js PRICES over
  // every item of that baseTier — the same table the shops price against, so
  // re-pricing an item moves its tier's purse with it and the two can't drift.
  //
  // Two shapes are corrected on the way out:
  //   • the ladder is made MONOTONE (running max). The raw medians dip at T4
  //     — its pool is six items wide and happens to hold the cheap orchard
  //     fruit — and a T4 purse paying less than a T3 one is a wart the player
  //     would read as a bug.
  //   • it is CAPPED. T7's pool is two items, one of them the $3000 diamond,
  //     and a jackpot that hands over three thousand coins out-earns every
  //     other loop in the game at once.
  const CASH_MAX = 200;
  // …and the whole purse, once the quantity brackets have multiplied it, is
  // capped again at twice that. The multiplier is the item quantity model
  // verbatim, so a fat cash roll tracks a fat item roll by construction — this
  // only stops the top of the ladder, where the median is drawn from a pool
  // two items wide, compounding into a figure no other loop can match.
  const CASH_PULL_MAX = CASH_MAX * 2;
  const CASH_JITTER = 0.3;             // ±30% on the purse, so it isn't a fixed figure
  // Cash is simply the tier's budget (Oct 2026): a coins roll pays what the
  // item lane would have spent. The median-price ladder that used to derive
  // this retired - one table owns both lanes now (items.js TIER_VALUE).
  const CASH_TIER_VALUE = (typeof TIER_VALUE !== 'undefined' && TIER_VALUE) || [0, 6, 24, 75, 210, 480, 1080, 2400];  function cashValue(tier, qty, rng) {
    const base = CASH_TIER_VALUE[Math.max(1, Math.min(7, tier | 0))] || 1;
    const jitter = 1 + (rng() * 2 - 1) * CASH_JITTER;
    // No pull cap (Oct 2026): the budget owns the amount, and the top tiers'
    // budgets (T6 $1080, T7 $2400) are the dungeon payouts.
    return Math.max(1, Math.round(base * Math.max(1, qty) * jitter));
  }

  // BUNDLE. Wood and stone — what every house repair and every wooden recipe
  // eats. Both are T1 items, so the bundle's worth is entirely in its COUNT:
  // BUNDLE_QTY on its own, plus BUNDLE_PER_BUMP for each quantity bracket the
  // roll banked, so a richer chest hands over a bigger pile of the same two
  // humble things.
  const BUNDLE_IDS = ['wood', 'rockfruit'];
  const BUNDLE_QTY_MIN = 3, BUNDLE_QTY_MAX = 8;
  const BUNDLE_PER_BUMP = 2;

  // Neither synthetic class has a row in ITEMS_BY_CLASS_TIER, so give them
  // their own ceilings. A purse can be worth any tier; a bundle is always the
  // two T1 raw materials, which means every chain step it is handed finds no
  // tier headroom and falls through to a quantity bracket — the pile grows
  // instead of the tier, which is exactly what a bundle is.
  CLASS_MAX_TIER.cash = 7;
  CLASS_MAX_TIER.bundle = 1;
  CLASS_MAX_TIER.boots = 7;
  CLASS_MAX_TIER.legacyConsumable = Math.max(CLASS_MAX_TIER.magic || 1, CLASS_MAX_TIER.supply || 1);
  // Relics span every tier 1..7 for every slot — pickItemInClass handles this
  // without needing an entry in ITEMS_BY_CLASS_TIER.

  // ────────────────────────────────────────────────────────────────
  // Helpers.
  // ────────────────────────────────────────────────────────────────
  function weightedPick(weightsObj, rng) {
    const keys = Object.keys(weightsObj);
    return weightedPickBy(keys, (k) => weightsObj[k], rng);
  }
  function upgradeLuck(save, now = Date.now()) {
    const boon = typeof Shrines !== 'undefined' && Shrines.leverActive(save, 'fortune', now)
      ? Shrines.FORTUNE_LUCK_BONUS : 0;
    const keyBonus = carriesItem(save, 'lucky_key') ? CARRIED_ITEM_SPEC.lucky_key.luckBonus : 0;
    const mealBonus = (save?.miracleLettuceUntil || 0) > now ? CONSUMABLE_SPEC.miracle_lettuce.luckBonus : 0;
    return (Math.max(0, Math.min(7, Math.floor(save?.luckUpgrades || 0))) + keyBonus + mealBonus)
      * RARITY_TUNING.luckPerUpgrade + boon;
  }
  // The wizard's QUANTITY ladder: P(one extra qty-bracket bump on a roll).
  // Linear over its rungs onto qtyLuckMaxP, so the top rung is exactly the
  // permanent Full Measure ceiling, so every rung is worth something.
  function qtyLuck(save) {
    const levels = RARITY_TUNING.qtyLuckLevels || 1;
    const lv = Math.max(0, Math.min(levels, Math.floor(save?.qtyUpgrades || 0)));
    return (lv / levels) * RARITY_TUNING.qtyLuckMaxP;
  }

  // Pick a (single) id from a class at the rolled tier. If the tier has no
  // items in this class (e.g. seeds at T5), slide DOWN to the nearest filled
  // tier. The surplus tier is already converted to qty-bracket in the chain
  // so this is just a graceful fallback for jackpots.
  function pickItemInClass(cls, tier, rng) {
    if (cls === 'relic') return null;            // handled by reconcileRelicOffer
    if (cls === 'legacyConsumable') {
      const items = _ITEMS.filter(i => ['magic', 'supply'].includes(i.kind) && !i.caveOnly && !i.uniqueJewelry && !i.cooked && !i.shiny && i.baseTier <= tier);
      if (!items.length) return null;
      const top = Math.max(...items.map(i => i.baseTier));
      return weightedPickBy(items.filter(i => i.baseTier === top), i => i.dropWeight || 1, rng).id;
    }
    const byTier = ITEMS_BY_CLASS_TIER[cls];
    if (!byTier) return null;
    let pool = (byTier[tier] || []).filter(id => !_ITEM_BY_ID[id]?.uniqueJewelry);
    for (let t = tier - 1; t >= 1 && (!pool || !pool.length); t--) pool = (byTier[t] || []).filter(id => !_ITEM_BY_ID[id]?.uniqueJewelry);
    if (!pool || !pool.length) return null;
    // Weighted pick by item.dropWeight (defaults to 1). Lets items like fish
    // declare dropWeight: 0.4 in items.js to show up less often than their
    // peers at the same tier without us re-tiering them. Every weight
    // defaults to (and floors at) 1, so the pool's total is always positive
    // and weightedPickBy's null/empty branches never fire here.
    return weightedPickBy(pool, (id) => {
      const w = _ITEM_BY_ID[id]?.dropWeight;
      return (typeof w === 'number' && w > 0) ? w : 1;
    }, rng);
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
  // `cap` (default T7) is the highest tier this offer may climb to — the road
  // prize's boots are held to one tier per kilometre (Trail.bootsTierCap).
  function reconcileRelicOffer(rolled, save, rng, cap = 7) {
    const kind = rolled.kind || 'relic';
    const slot = rolled.slot;
    let t = Math.min(rolled.tier, cap);
    const ownedTable = kind === 'armor' ? save?.armor : save?.relics;
    const owned = ownedTable?.[slot]?.tier ?? 0;
    if (t > owned) return { kind, slot, tier: t, jackpot: rolled.jackpot || 0 };
    t = owned;
    const priceFor = (tier) => (typeof _gearPrice === 'function')
      ? _gearPrice(kind, slot, tier) : 0;
    // Slot already at the cap (T7 at most): there's nothing to climb to, so
    // cash out consolation gold rather than handing back a useless duplicate.
    if (t >= cap) {
      return {
        kind: 'gold',
        slot, tier: t, gearKind: kind,
        amount: Math.max(1, Math.floor(priceFor(t) / 2)),
        jackpot: rolled.jackpot || 0,
      };
    }
    while (t < cap) {
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
    // Climbed all the way without cashing out — hand over the capped gear.
    return { kind, slot, tier: cap, jackpot: rolled.jackpot || 0 };
  }

  // ────────────────────────────────────────────────────────────────
  // The picker. Returns null when no item matches (caller should fall back).
  //   { kind: 'item',  id, qty, tier, cls, jackpot }
  //   { kind: 'relic', slot, tier, jackpot }
  //   { kind: 'gold',  slot, tier, amount, jackpot }     ← from walk-up
  // ────────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────
  // CAVE SUPPLIES. A shallow buried X underground (T1/T2) leans toward
  // what a player down there runs out of: coin, light, a way back up and a
  // potion. This overlay belongs to treasure:default. Themed chests return
  // through pickChestReward before lootContext and own their cave mix in
  // ChestThemes.weights.
  //   classAdd  - adds weights to the X mark's classBias before the pick.
  //   favourite - chooses a weighted supply set when that class comes up.
  // Caller passes opts.depth (the cave level; 0/absent = surface).
  const CAVE_SUPPLY_MAX_TIER = 2;
  const CAVE_SUPPLY_SKEW = {
    classAdd:  { cash: 0.25, legacyConsumable: 0.25 },
    favourite: { p: 0.85, ids: {
      torch: 1, rope: 1,
      vigor_potion: 0.25, shield_potion: 0.25, reach_potion: 0.25, speed_potion: 0.25,
      // The Magic Trap — the cave's own tier-2 find (items.js `caveOnly`), and
      // the one door into it besides a slain trapper. Half a share: a thing
      // you are glad to find, not a staple like light or rope.
      magic_trap: 0.5,
    } },
  };
  // A cave skew reaches only a buried X dug underground. app.js
  // digTreasureOpts passes its depth and tier; themed chests use ChestThemes.
  function caveSkewable(contextKey) {
    return contextKey === 'treasure:default';
  }
  function caveSupplyApplies(contextKey, opts) {
    return caveSkewable(contextKey) && (opts?.depth || 0) > 0
      && ((opts?.tier) || 2) <= CAVE_SUPPLY_MAX_TIER;
  }
  // THE DEEP HOARD — the same overlay for a cave chest ABOVE the supply tiers
  // (T3+, the ones depth promotes): what a deep chest is known for is the
  // good stuff — potions, powders, scrolls and gems. Consumables and minerals are
  // added to the row's classes, and when one comes up the favourite set is
  // drawn `p` of the time, TIER-CAPPED (`tierCapped`: only members at or
  // under the rolled tier), so a T3 chest leans to potions and powders and a
  // gem arrives only where its tier does — a sapphire from T4, a diamond at T7.
  const CAVE_DEEP_SKEW = {
    classAdd:  { legacyConsumable: 0.25, mineral: 0.25 },
    favourite: { p: 0.75, tierCapped: true, ids: {
      vigor_potion: 1, shield_potion: 1, reach_potion: 1, speed_potion: 1,
      revive_potion: 1, blight_potion: 1, raven_scroll: 1, skeleton_scroll: 1, wraith_scroll: 1, thunder_scroll: 1, resurrection_potion: 1,
      growth_powder: 1, shadow_powder: 1, dragon_powder: 1, frost_powder: 1, sleep_powder: 1,
      fireball_scroll: 1, explosive_flask: 1, fear_scroll: 1, treasure_map: 1,
      sapphire: 1, ruby: 1, emerald: 1, diamond: 1,
    } },
  };
  function caveDeepApplies(contextKey, opts) {
    return caveSkewable(contextKey) && (opts?.depth || 0) > 0
      && ((opts?.tier) || 2) > CAVE_SUPPLY_MAX_TIER;
  }

  function lootContext(contextKey, opts) {
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
    const caveSkew = caveSupplyApplies(contextKey, opts) ? CAVE_SUPPLY_SKEW
      : caveDeepApplies(contextKey, opts) ? CAVE_DEEP_SKEW : null;
    if (caveSkew) {
      const classBias = { ...ctx.classBias };
      // Buried cave X marks retain the old union pool and weights. This is
      // a compatibility loot group, never an inventory kind.
      classBias.legacyConsumable = (classBias.legacyConsumable || 0) + (classBias.supply || 0);
      delete classBias.supply;
      for (const [c, w] of Object.entries(caveSkew.classAdd)) classBias[c] = (classBias[c] || 0) + w;
      ctx = { ...ctx, classBias, favourite: caveSkew.favourite };
    }
    // A caller may narrow the classes to a subset of the context's own
    // (opts.classes — the road prize's one-card-per-group row, Trail.PRIZE_CARDS):
    // the context's weights between those classes stand, the rest drop out.
    if (opts && Array.isArray(opts.classes)) {
      const classBias = {};
      for (const c of opts.classes) if (ctx.classBias[c] > 0) classBias[c] = ctx.classBias[c];
      ctx = { ...ctx, classBias };
    }

    return ctx;
  }

  function rollRewardQuality(ctx, cls, save, rng, opts) {
    // 2) Boost chain. Start T1 / bracket 0; each step coin-flips between
    // bumping tier and bumping qty bracket. Relic class always tier-ups
    // (quantity is meaningless for relics). Chain stops when boost fails
    // OR both tier and bracket sit at their caps.
    const isRelic = cls === 'relic';
    const finalCap = isRelic
      ? Math.min(ctx.relicCap ?? 7, 7)
      : Math.min(ctx.maxTier ?? 7, (cls === 'chestQuality' ? 7 : CLASS_MAX_TIER[cls] || 1),
          (opts && opts.classMaxTier && opts.classMaxTier[cls]) || 7);
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
    const luck = upgradeLuck(save);
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
    // chest gear roll — those use rollGearUpgrade on the chest tier alone.
    const bonusSteps = Math.max(0, Math.floor((opts && opts.rollBonus) || 0));
    for (let i = 0; i < bonusSteps; i++) {
      if (tier < chainCap) tier += 1;
      else wastedQtyBumps += 1;        // no headroom left — pay it out in coins
    }
    // The wizard's quantity upgrade: one extra bracket roll (folded in here
    // rather than a post-multiply, so it stops doubling unbounded).
    if (!isRelic && rng() < qtyLuck(save)) {
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

    return { tier, bracket, finalCap, jackpotApplied, wastedQtyBumps };
  }

  function pickChestReward(theme, save, rng, opts = {}) {
    // A fresh reward stream consumes one ambient seed. Pool changes never
    // consume another world-generation stream or alter generated identities.
    rng = rng || makeRng32(Math.floor(Math.random() * 0x100000000));
    theme = ChestThemes.normalize(theme);
    const chestTier = Math.max(1, Math.min(typeof chestTierMaxFor === 'function' ? chestTierMaxFor(opts.depth) : 5, opts.tier || 2));
    const ctx = RARITY_TUNING.chestTierMod[chestTier];
    const quality = rollRewardQuality(ctx, 'chestQuality', save, rng, opts);
    quality.tier = Math.max(quality.tier, ChestThemes.qualityFloor(chestTier));
    return resolveChestReward(theme, quality, save, rng, { ...opts, tier: chestTier });
  }

  // Also used by the balance tool to isolate a rolled quality from the
  // displayed chest tier, rather than inventing unreachable T6/T7 chests.
  function resolveChestReward(theme, quality, save, rng, opts = {}) {
    theme = ChestThemes.normalize(theme);
    const chestTier = Math.max(1, Math.min(typeof chestTierMaxFor === 'function' ? chestTierMaxFor(opts.depth) : 5, opts.tier || 2));
    const { tier, bracket, jackpotApplied } = quality;
    const selectionOpts = { ...opts, theme, chestTier, save };
    if ((_ITEM_BY_ID[opts.venueProduct]?.baseTier || 1) < ChestThemes.qualityFloor(chestTier))
      selectionOpts.venueProduct = null;
    const group = weightedPick(ChestThemes.weights(theme, tier, opts), rng);
    let resolved;
    try { resolved = ChestThemes.resolve(group, tier, selectionOpts); }
    catch (error) {
      console.error('Invalid chest theme', theme, group, error);
      resolved = ChestThemes.resolve(ChestThemes.themes[theme].t1Fallback, 1, selectionOpts);
      resolved.fallback = true;
    }
    const meta = { theme, group, resolvedGroup: resolved.group, fallback: resolved.fallback,
      rolledTier: tier, jackpot: jackpotApplied, consolation: 0 };
    if (resolved.kind === 'gear') {
      const gear = rollGearUpgrade(rng, save?.relics, tier, save?.armor, ChestThemes.gearSlots(resolved.group),
        typeof Shrines !== 'undefined' && Shrines.leverActive(save, 'fortune') ? Shrines.FORTUNE_LUCK_BONUS : 0,
        chestTier >= 3 ? chestTier - 1 : 1, theme === 'vista' ? tier : 7);
      if (theme !== 'vista' || gear.kind !== 'gold') return { ...gear, ...meta };
      // A grail never turns an owned equipment roll into a coin consolation.
      resolved = ChestThemes.resolve('magic', tier, selectionOpts);
      meta.resolvedGroup = resolved.group;
      meta.fallback = true;
    }
    if (resolved.kind === 'cash') {
      let qty = 1;
      const perBump = RARITY_TUNING.tierQtyPerBump[tier] || 1;
      for (let i = 0; i < bracket; i++) qty += 1 + Math.floor(rng() * perBump);
      return { kind: 'gold', amount: cashValue(tier, qty, rng), cls: 'cash', tier, ...meta };
    }
    const id = ChestThemes.pickItem(resolved, tier, rng, selectionOpts);
    return { kind: 'item', id, qty: ChestThemes.quantity(id, tier, bracket, rng),
      tier: _ITEM_BY_ID[id].kind === 'unique_relic' ? _ITEM_BY_ID[id].baseTier : tier,
      cls: _ITEM_BY_ID[id].kind, ...meta };
  }

  function pickReward(contextKey, save, rng, opts) {
    if (contextKey.startsWith('chest:')) return pickChestReward(contextKey.slice(6), save, rng, opts);
    rng = rng || Math.random;
    const ctx = lootContext(contextKey, opts);
    if (!ctx) return null;

    // 1) Pick class. If the context's relicCap is 0, scrub the relic weight so
    // it can't be chosen at all (a market never offers a relic, no matter how
    // skewed the bias gets).
    const bias = { ...ctx.classBias };
    if ((ctx.relicCap ?? 7) <= 0) delete bias.relic;
    const cls = weightedPick(bias, rng);
    if (!cls) return null;

    const quality = rollRewardQuality(ctx, cls, save, rng, opts);
    const { tier, bracket, finalCap, jackpotApplied } = quality;
    let wastedQtyBumps = quality.wastedQtyBumps;

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
      // qty axis). Roll those into consolation alongside the qty-cap waste —
      // except for shops, which never pay consolation (player is buying).
      if (!ctx.singleItem) wastedQtyBumps += bracket;
      const out = reconcileRelicOffer({ slot, tier: relicTier, jackpot: jackpotApplied }, save, rng);
      if (out) out.consolation = ctx.singleItem ? 0 : consolationFor(relicTier);
      return out;
    }
    // BOOTS — the road's equipment option, with the same duplicate/upgrade
    // handling as other gear so a reward never replaces better owned boots.
    if (cls === 'boots') {
      if (!ctx.singleItem) wastedQtyBumps += bracket;
      const out = reconcileRelicOffer({ kind: 'armor', slot: 'boots', tier,
        jackpot: jackpotApplied }, save, rng, finalCap);
      if (out) out.consolation = ctx.singleItem ? 0 : consolationFor(tier);
      return out;
    }
    // CASH — coins, worth what an item of the rolled tier is worth
    // (CASH_TIER_VALUE) and fattened by the same quantity brackets a stack
    // would have been, so the qty axis is not dead weight on a money roll.
    // NO `slot`: that is what tells every payer apart from a gear cash-out
    // (interact.js grantTreasureRoll, interactables.js) — money is money.
    // It pays no separate consolation; coins beside coins is one number said
    // twice, and a wasted bracket on this class is already rare (cap 3).
    if (cls === 'cash') {
      let qty = 1;
      const perBump = (RARITY_TUNING.tierQtyPerBump || [])[Math.min(tier, 7)] || 1;
      if (!ctx.singleItem) for (let i = 0; i < bracket; i++) qty += 1 + Math.floor(rng() * perBump);
      return { kind: 'gold', amount: Math.max(1, Math.round(cashValue(tier, qty, rng) * (ctx.cashMul ?? 1))), tier, cls: 'cash',
               jackpot: jackpotApplied, consolation: 0 };
    }
    // BUNDLE — a pile of wood or stone. Tier never climbs on this class (see
    // CLASS_MAX_TIER.bundle), so every bracket the roll banked is size.
    if (cls === 'bundle') {
      const bid = BUNDLE_IDS[Math.floor(rng() * BUNDLE_IDS.length)];
      const bqty = BUNDLE_QTY_MIN + Math.floor(rng() * (BUNDLE_QTY_MAX - BUNDLE_QTY_MIN + 1))
                 + (ctx.singleItem ? 0 : bracket * BUNDLE_PER_BUMP);
      return { kind: 'item', id: bid, qty: bqty, cls: 'bundle',
               tier: _ITEM_BY_ID[bid]?.baseTier ?? 1,
               jackpot: jackpotApplied, consolation: 0 };
    }
    // FAVOURITE - a non-chest context may pin one item id, or a weighted set,
    // inside its own class. The road prize and grove shrine use this lane;
    // themed chests resolve through ChestThemes before lootContext runs.
    // This remains separate from dropWeight because dropWeight affects every
    // context, while a favourite identifies what makes one place distinctive.
    // The pin may ignore tier unless tierCapped says otherwise. Only members
    // of the rolled class count, so a set never hands over the wrong kind.
    const fav = ctx.favourite;
    let favId = null;
    if (fav) {
      const cand = fav.ids
        ? Object.entries(fav.ids).filter(([k]) => (_ITEM_BY_ID[k]?.kind === cls || (cls === 'legacyConsumable' && ['magic', 'supply'].includes(_ITEM_BY_ID[k]?.kind)))
            && (!(fav.tierCapped || cls === 'magic') || (_ITEM_BY_ID[k]?.baseTier ?? 1) <= tier))
        : (_ITEM_BY_ID[fav.id]?.kind === cls ? [[fav.id, 1]] : []);
      if (cand.length && rng() < (fav.p ?? 0)) {
        favId = cand.length === 1 ? cand[0][0] : weightedPick(Object.fromEntries(cand), rng);
      }
    }
    const id = favId || pickItemInClass(cls, tier, rng) || (cls === 'magic' ? 'torch' : null);
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
    return { kind: 'item', id, qty, tier, cls: _ITEM_BY_ID[id].kind, jackpot: jackpotApplied,
             consolation: ctx.singleItem ? 0 : consolationFor(itemTier) };
  }

  // Every gear tier a roll may land on. There is no second, progress-based
  // lock: the real ceiling on how high a roll can go is the per-source loot
  // rule (the `maxTier` / `relicCap` in RARITY_TUNING / LOOT_CONTEXTS, plus the
  // chest-tier-derived `preferred` clamp in rollGearUpgrade below), so a
  // low-tier chest still can't cough up a Frost relic. (The old harvest/catch
  // "milestone" unlocks — chestRelicAllowedTiers — duplicated that gating with
  // an invisible lock and had long since returned every tier; removed.)
  const GEAR_ROLL_TIERS = [1, 2, 3, 4, 5, 6, 7];

  // Dedicated relic/armor jackpot picker — used by fishing (2% cast jackpot)
  // and by the chest relic path in pickReward. Guarantees a gear result (relic
  // or armor upgrade, or consolation gold). Moved here from loot.js; replaces
  // the old pickChestRelic. `chestT` 1-5 drives the preferred/ceiling tier.
  function rollGearUpgrade(rng, currentRelics, chestT = 2, currentArmor = null, allowedSlots = null, luck = 0, minTier = 1, maxTier = 7) {
    const random = rng || Math.random;
    if (!Object.keys(_RELIC_DEFS).length) return null;
    // DIRECT MAP (Oct 2026): a chest's rolled tier IS its preferred gear
    // tier - the old doubling (T4 chest → T7 gear) retired. The caller hands
    // the ROLLED quality tier, not the chest's own, so a jackpot over a
    // surface chest is the one way T6/T7 gear appears above ground; the deep
    // chests that dungeons hold make it common down there.
    // preferred is clamped to 1..7 and every tier 1..7 is allowed, so the
    // capped pool is never empty.
    const preferred = Math.min(maxTier, Math.max(1, chestT));
    const capped = GEAR_ROLL_TIERS.filter(t => t >= Math.min(preferred, minTier) && t <= preferred);
    const weighted = capped.map(t => ({ t, w: 1 / (1 + Math.abs(t - preferred)) }));
    let pickedTier = weightedPickBy(weighted, (w) => w.w, random).t;
    // Gear resolves separately from rolled item quality. Fortune reaches this
    // lane too, without raising the source's existing tier ceiling.
    if (luck > 0 && random() < luck) pickedTier = Math.min(preferred, pickedTier + 1);
    const relicSlots = Object.keys(_RELIC_DEFS);
    const armorSlots = Object.keys(_ARMOR_DEFS);
    const slotPool = allowedSlots || [
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
  // The two synthetic classes' own tables, exported so the balancing dashboard
  // can show what a 'cash' or 'bundle' weight actually resolves to instead of
  // leaving both rows blank (neither is in ITEMS_BY_CLASS_TIER).
  global.CASH_TIER_VALUE        = CASH_TIER_VALUE;
  global.BUNDLE_IDS             = BUNDLE_IDS;
  global.LOOT_CONTEXTS          = LOOT_CONTEXTS;
  global.lootContext            = lootContext;
  global.CAVE_SUPPLY_SKEW       = CAVE_SUPPLY_SKEW;
  global.CAVE_DEEP_SKEW         = CAVE_DEEP_SKEW;
  global.ITEMS_BY_CLASS_TIER    = ITEMS_BY_CLASS_TIER;
  global.pickReward             = pickReward;
  global.pickChestReward        = pickChestReward;
  global.resolveChestReward     = resolveChestReward;
  global.rollRewardQuality     = rollRewardQuality;
  global.reconcileRelicOffer    = reconcileRelicOffer;
  global.rollGearUpgrade        = rollGearUpgrade;
  // The two luck ladders, exported so the wizard's rungs and the tests can
  // read the SAME numbers the picker rolls against.
  global.upgradeLuck            = upgradeLuck;
  global.qtyLuck                = qtyLuck;
})(window);
