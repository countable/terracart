// The loot contexts: one row per reward pool that rarity.js pickReward rolls
// (chest:<theme>, shop:*, treasure:*). Pure data — the picker reads each
// row's fields and never branches on a context's name, so a new pool is a
// new row here.
//
// Loaded as a global script after chest_themes.js (the chest rows are one
// per ChestThemes theme) and before rarity.js, which consumes the table.
//
// Exports as globals:
//   LOOT_CONTEXTS — { contextKey → row }

(function (global) {
  // ────────────────────────────────────────────────────────────────
  // Per-context picking shape. Each row owns:
  //   picker    — 'chest' sends the roll through the themed chest picker
  //               (rarity.js pickChestReward, by `theme`), whose tier curve
  //               is RARITY_TUNING.chestTierMod[opts.tier] rather than the
  //               row's own chain fields. Absent = the class-bias picker below.
  //   caveSkew  — true: a roll underground (opts.depth > 0) overlays the cave
  //               supply / deep-hoard mix (rarity.js CAVE_SUPPLY_SKEW,
  //               CAVE_DEEP_SKEW, chosen by opts.tier).
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
  //   bundle  — wood or rubble selected as a material reward. Its stack uses
  //             the same budget, price and caps as ordinary item rewards.
  //
  // Class weights inside each row do NOT need to sum to exactly 1.0 — we
  // re-normalise in weightedPick. Easier to author this way.
  // ────────────────────────────────────────────────────────────────
  const LOOT_CONTEXTS = {
    // Chest class odds come from the resolved themed groups, not a second table.
    ...Object.fromEntries(Object.keys(ChestThemes.themes).map(theme =>
      ['chest:' + theme, { picker: 'chest', theme, classBias: {} }])),
    'chest:lowtier': { picker: 'chest', theme: 'roadside', classBias: {} },

    // ── Shops, by specialty ─────────────────────────────────────
    // Shops use the same deterministic chain; chainSteps maps to the shop's
    // 'level' (plain/shop/trader mid, forts and blacksmiths higher, castle
    // highest, relic-only).
    //
    // NOT reached from the shipped game: the shop UIs build their own offers
    // (app.js buildShopOffer / buildRelicOffer). The consumer is
    // tools/balancing.html, which iterates every LOOT_CONTEXTS key. Kept
    // deliberately — do not flag as dead code.
    //
    // singleItem: true forces qty=1 (except seeds, which ship in packs).
    // Only the wandering trader deals in livestock.
    'shop:plain':       { classBias: { seed:0.40, produce:0.40, mineral:0.10, magic:0.05, supply:0.05 },
                          chainSteps: 1, chainMax: 2, maxTier: 3, relicCap: 0, singleItem: true },
    'shop:shop':      { classBias: { produce:0.70, seed:0.20, magic:0.05, supply:0.05 },
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
    'shop:trader':      { classBias: { animal:0.35, mineral:0.15, produce:0.20, seed:0.20, magic:0.05, supply:0.05, relic:0.05 },
                          chainSteps: 2, chainMax: 3, maxTier: 4, relicCap: 3, singleItem: true },
    'shop:fort':        { classBias: { seed:0.31, produce:0.27, mineral:0.17, magic:0.085, supply:0.085, relic:0.12 },
                          chainSteps: 2, chainMax: 3, maxTier: 4, relicCap: 3, singleItem: true },
    'shop:castle':      { classBias: { relic: 1.00 },
                          chainSteps: 3, chainMax: 4, maxTier: 7, relicCap: 7, singleItem: true },

    // ── Floating treasure mark ──────────────────────────────────
    // Small fixed reward — no chain (always rolls T1) plus jackpot.
    // `gear` (any equipment: a tool or weapon, armour, a unique relic) is a
    // fifth of the draws above ground: 0.25 of a 1.25 total. A cave X adds its
    // supply skew to the total, so the share is smaller down there.
    'treasure:default': { classBias: { seed:0.45, mineral:0.40, supply:0.15, gear:0.25 }, caveSkew: true,
                          chainSteps: 0, chainMax: 1, maxTier: 2, relicCap: 0 },
    // ── The GREAT X (loot.js GREAT_X — the thick dark-red mark) ─
    // Gold, a tool or weapon, or any equipment: no seeds, no stone. Two chain
    // steps onto a T3 ceiling (a relic sits a tier under, so T2), with the
    // usual jackpot above it up to maxTier.
    'treasure:great':   { classBias: { cash:0.40, relic:0.30, gear:0.30 },
                          chainSteps: 2, chainMax: 3, maxTier: 4, relicCap: 4, relicChainMax: 4 },
    // ── The ROAD ladder's prize ─────────────────────────────────────────
    // What restoring a street pays (src/trail.js, app.js _fireTrailPrize).
    // The ceremony rolls ONE card per group (Trail.PRIZE_CARDS: cash / seed or
    // supply / boots, gear or magic), each narrowed to its classes, so these weights
    // only split a group between its classes; boots and gear are capped one tier per 10 km
    // (Trail.bootsTierCap). Favourites make the magic card usually a
    // traveller's kit: the everyday potions at full weight, utility potions,
    // powders and scrolls at half. The set must stay WIDE at every tier the
    // card lands on (magic favourites are tier-capped, and the first prizes
    // roll T2-T3): five potions left only healing and speed at T2, so one of
    // them sat on nearly every early magic card.
    // The caller's rollBonus buys tiers up to T4; higher tiers need a jackpot.
    'treasure:road':    { classBias: { seed:0.20, magic:0.225, supply:0.025, boots:0.075, gear:0.075, cash:0.15 }, cashMul: 1/6,
                          // No chain step of its own: the walk's ladder (Trail.rollBonusFor) is
                          // the tier, so the first prize is T1 and T4 is common by the tenth.
                          chainSteps: 0, chainMax: 4, maxTier: 6, relicCap: 0,
                          favourite: { p: 0.85, ids: {
                            reach_potion: 1, healing_potion: 1,
                            speed_potion: 1, shielding_potion: 1, revival_potion: 1,
                            antidote: 0.5, protection_potion: 0.5, growth_powder: 0.5, shadow_powder: 0.5,
                            fireball_scroll: 0.5, fear_scroll: 0.5, sleep_powder: 0.5, frost_powder: 0.5,
                            flight_potion: 0.5, fire_resistance_potion: 0.5, treasure_map: 0.5, thunder_scroll: 0.5,
                            // The T1 tonics, so a first prize's magic card (the ladder starts at
                            // T1) is more than an antidote or a growth powder.
                            hardworking_potion: 0.5, grip_potion: 0.5, psychosis_powder: 0.5, wind_scroll: 0.5,
                          } } },
    // ── A grove shrine's daily gift (src/zones.js, INTERACTABLES.grove_shrine)
    // One roll a day per shrine, worth about a buried X: the X's flat curve
    // (no chain, T1-2, no relics), a gardener's classes — seeds first, then
    // produce, then a magic item — and the growth powder as its FAVOURITE,
    // the way a school is known for its Book: a grove is where things grow.
    // Tree seeds use the same seed class and their normal tier eligibility.
    'treasure:temple':  { classBias: { magic: 1 }, chainSteps: 0, chainMax: 2, maxTier: 2, relicCap: 0 },
    'treasure:shrine':  { classBias: { seed:0.55, produce:0.30, magic:0.15 },
                          chainSteps: 0, chainMax: 1, maxTier: 2, relicCap: 0,
                          favourite: { id: 'growth_powder', p: 0.5 } },
    // ── A viewpoint scope's daily gift (src/scenic.js VISTA_CONTEXT,
    // INTERACTABLES.vista_scope). A better grove shrine (~15 value, the design's
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

  global.LOOT_CONTEXTS = LOOT_CONTEXTS;
})(window);
