// Unified rarity / loot picker. One function — pickReward(contextKey, save, rng)
// — drives every chest, treasure mark, shop offer, and (eventually) trader
// wishlist.
//
// Loaded as a global script — depends on items.js (ITEMS, ITEM_BY_ID,
// BASE_TIER, RELIC_DEFS, gearPrice, PRICES), chest_themes.js and
// loot_contexts.js (LOOT_CONTEXTS, the per-context rows) being loaded first.
//
// Exports as globals:
//   RARITY_TUNING            — knob constants (boost/jackpot/budget)
//   LOOT_CONTEXTS            — re-exported from loot_contexts.js (the per-context rows)
//   ITEMS_BY_CLASS_TIER      — { class → { tier → [id, …] } }
//   pickReward(key, save, rng)        → { kind:'item'|'relic'|'armor'|'gold', … }
//                                        (chest contexts roll relic OR armor via rollGearUpgrade)
//   reconcileRelicOffer(rolled, save, rng) → walk-up ladder for dupes
//                                             (relic by default; pass rolled.kind
//                                             'armor' for an armor slot)

(function (global) {
  // ────────────────────────────────────────────────────────────────
  // Tunable constants; the balancing dashboard lives off these.
  // ────────────────────────────────────────────────────────────────
  const RARITY_TUNING = {
    luckPerUpgrade:      0.01,   // Seven Keen Eye rungs reach +0.07
    // Jackpot fires with entryP, then chains via continueP. Each boost step
    // picks tier-up vs budget-up 50/50 (same split as the boost chain). Every
    // jackpot — even a +1 — triggers the fanfare popup.
    //   P(any jackpot)   = entryP            ~16% — fanfare rate
    //   P(2-step chain)  = entryP × cont     ~4%
    //   P(3-step chain)  = entryP × cont²    ~1%
    //   P(4-step chain)  = entryP × cont³    ~0.25%
    jackpotEntryP:       0.16,
    jackpotContinueP:    0.25,
    chainBudgetP:           0.33,   // per chain step, P(budget-up) vs (1-chainBudgetP) tier-up. At T2 chest (1 step): 67% T2 / 33% T1+budget. At T3 chest (2 steps): 45% T3 / 44% T2 / 11% T1.
    // P(extra budget-bracket bump) at the TOP of the wizard's budget ladder.
    budgetBoostMaxP:         0.35,
    budgetUpgradeLevels:       3,
    // Budget model: each budget BUMP (from the chain, the wizard's ladder or a
    // jackpot) banks one bracket, and a bracket only raises the roll's budget
    // (ChestThemes.budget). The stack is that budget over the item's price
    // (ChestThemes.quantity, capped per item); coins are the budget itself.
    // Chest tier 1..7 modifiers (1..5 on the surface; 6..7 only underground,
    // loot.js chestTierMaxFor). Applied on top of the biome's classBias to
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
      // boost steps, each tier-up if below chainCap, else budget-up. That puts
      // every chest at its own tier 100% of the time (before jackpot), so
      // T2 chests don't leak T1 items like coal × 1. Jackpot is the only
      // path above the chest tier (~8% tier-side, ~8% budget-side per pull).
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
    walkUpStepP:         0.5,    // walk-up ladder: P(climb vs cash-out)
  };

  // The per-context rows (loot_contexts.js). Read their fields, never their keys.
  const LOOT_CONTEXTS = global.LOOT_CONTEXTS;

  // ────────────────────────────────────────────────────────────────
  // Build ITEMS_BY_CLASS_TIER once: kind → tier → [ids].
  // Skips relics (they live in RELIC_DEFS and span every tier 1..7 per slot)
  // and items missing a numeric baseTier.
  // Skips `shiny: true` variants: a wild-catch-only bonus with its own value
  // balancing (items.js awardShinyBonus); a chest handing one out would bypass
  // the odds and value multiplier that assume it's rare.
  // ────────────────────────────────────────────────────────────────
  // ITEMS / RELIC_DEFS are top-level `const`s in items.js: on the global
  // lexical scope but NOT on `window`, so reach them by bare name, guarded.
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
      // A BABY PET (items.js BABY_KINDS) comes from a nest bush or an egg, never a chest.
      if (it.baby) continue;
      // CAVE-ONLY finds (items.js `caveOnly` — the Magic Trap) are reachable
      // only through CAVE_SUPPLY_SKEW's favourite set (below), never this pool.
      if (it.caveOnly) continue;
      // Made at a campfire, never found (items.js CAMPFIRE_MAKES).
      if (it.cooked) continue;
      // A ladder's own prize (items.js `progressionOnly` — the Serpent Idol).
      if (it.progressionOnly) continue;
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
  // CASH. What a purse at tier T is worth is what an ITEM of that tier is worth,
  // so a coin option and a loot option on the same roll are the same prize
  // stated two ways (see CASH_TIER_VALUE).
  const CASH_JITTER = 0.3;             // ±30% on the purse, so it isn't a fixed figure
  // Cash is the tier's budget: a coins roll pays what the item lane would
  // have spent (one table owns both lanes: items.js TIER_VALUE).
  const CASH_TIER_VALUE = (typeof TIER_VALUE !== 'undefined' && TIER_VALUE) || [0, 6, 24, 75, 210, 480, 1080, 2400];
  function cashValue(tier, bracket, rng) {
    const jitter = 1 + (rng() * 2 - 1) * CASH_JITTER;
    // No pull cap: the budget owns the amount, and the top tiers'
    // budgets (T6 $1080, T7 $2400) are the dungeon payouts.
    return Math.max(1, Math.round(ChestThemes.budget(tier, bracket) * jitter));
  }

  // Material bundles share the same budget-to-price conversion as other loot.
  const BUNDLE_IDS = ['wood', 'rubble'];

  // Neither synthetic class has a row in ITEMS_BY_CLASS_TIER, so give them
  // their own ceilings. A purse can be worth any tier; a bundle is always T1,
  // so every chain step falls through to a budget bracket (the pile grows).
  CLASS_MAX_TIER.cash = 7;
  CLASS_MAX_TIER.bundle = 1;
  CLASS_MAX_TIER.boots = 7;
  CLASS_MAX_TIER.gear = 7;
  CLASS_MAX_TIER.consumable = Math.max(CLASS_MAX_TIER.magic || 1, CLASS_MAX_TIER.supply || 1);
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
  // save.qtyUpgrades is the persisted legacy key; its levels buy budget boosts.
  // The wizard's BUDGET ladder: P(one extra budget-bracket bump on a roll).
  // Linear over its rungs onto budgetBoostMaxP: the top rung is the Full Measure ceiling.
  function budgetBoostChance(save) {
    const levels = RARITY_TUNING.budgetUpgradeLevels || 1;
    const lv = Math.max(0, Math.min(levels, Math.floor(save?.qtyUpgrades || 0)));
    return (lv / levels) * RARITY_TUNING.budgetBoostMaxP;
  }

  // Pick a (single) id from a class at the rolled tier, sliding DOWN to the
  // nearest filled tier if empty (e.g. seeds at T5; a fallback for jackpots).
  function pickItemInClass(cls, tier, rng) {
    if (cls === 'relic') return null;            // handled by reconcileRelicOffer
    if (cls === 'consumable') {
      const items = _ITEMS.filter(i => ['magic', 'supply'].includes(i.kind) && !i.caveOnly && !i.uniqueJewelry && !i.cooked && !i.shiny && !i.progressionOnly && i.baseTier <= tier);
      if (!items.length) return null;
      const top = Math.max(...items.map(i => i.baseTier));
      return weightedPickBy(dropEligible(items.filter(i => i.baseTier === top)), i => i.dropWeight || 1, rng).id;
    }
    const byTier = ITEMS_BY_CLASS_TIER[cls];
    if (!byTier) return null;
    let pool = (byTier[tier] || []).filter(id => !_ITEM_BY_ID[id]?.uniqueJewelry);
    for (let t = tier - 1; t >= 1 && (!pool || !pool.length); t--) pool = (byTier[t] || []).filter(id => !_ITEM_BY_ID[id]?.uniqueJewelry);
    if (!pool || !pool.length) return null;
    // Weighted by item.dropWeight (default 1), so items can be rarer than tier
    // peers without re-tiering. A dropWeight of 0 (syrup: the hive's prize,
    // never a roll) leaves the pool while any peer remains, so the pool's
    // total stays positive.
    return weightedPickBy(dropEligible(pool), (id) => {
      const w = _ITEM_BY_ID[id]?.dropWeight;
      return (typeof w === 'number' && w > 0) ? w : 1;
    }, rng);
  }
  // Members whose dropWeight is not 0 — or everyone, when that would empty
  // the pool. Takes ids or item rows.
  function dropEligible(pool) {
    const row = (m) => (typeof m === 'string' ? _ITEM_BY_ID[m] : m);
    const kept = pool.filter(m => row(m)?.dropWeight !== 0);
    return kept.length ? kept : pool;
  }

  // ────────────────────────────────────────────────────────────────
  // Walk-up ladder for gear the player already owns. At each rung above the
  // owned tier, coin flip between cashing out at half the gearPrice or
  // climbing one rung; stops at the first cash-out, and reaching the cap
  // returns the gear itself. The {jackpot} flag is propagated unchanged.
  // `rolled.kind` selects relic (default) vs armor (save.armor), with the SAME
  // treatment (fixedChestReward routes fixed armor payloads here too, so a
  // starter chest can't downgrade equipped armor).
  // ────────────────────────────────────────────────────────────────
  // `cap` (default T7) is the highest tier this offer may climb to — the road
  // prize's boots are held to one tier per 10 km (Trail.bootsTierCap).
  function reconcileRelicOffer(rolled, save, rng, cap = 7) {
    const kind = rolled.kind || 'relic';
    const slot = rolled.slot;
    const tiers = (kind === 'relic' && _RELIC_DEFS[slot]?.tiers) || GEAR_ROLL_TIERS;
    const allowed = tiers.filter(t => t <= cap);
    cap = allowed[allowed.length - 1];
    let t = allowed.filter(t => t <= rolled.tier).pop() || allowed[0];
    const ownedTable = kind === 'armor' ? save?.armor : save?.relics;
    const owned = ownedTable?.[slot]?.tier ?? 0;
    if (t > owned) return { kind, slot, tier: t, jackpot: rolled.jackpot || 0 };
    t = owned;
    const priceFor = (tier) => (typeof _gearPrice === 'function')
      ? _gearPrice(kind, slot, tier) : 0;
    // Slot already at the cap: cash out consolation gold, not a useless duplicate.
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
      t = allowed.find(tier => tier > t);
    }
    return { kind, slot, tier: cap, jackpot: rolled.jackpot || 0 };
  }

  // ────────────────────────────────────────────────────────────────
  // CAVE SUPPLIES. A shallow buried X underground (T1/T2) leans toward
  // what a player down there runs out of: coin, light, a way back up and a
  // potion. This overlay reaches a row marked `caveSkew` (treasure:default,
  // the buried X). Themed chests return
  // through pickChestReward before lootContext and own their cave mix in
  // ChestThemes.weights.
  //   classAdd  - adds weights to the X mark's classBias before the pick.
  //   favourite - chooses a weighted supply set when that class comes up.
  // Caller passes opts.depth (the cave level; 0/absent = surface).
  const CAVE_SUPPLY_MAX_TIER = 2;
  const CAVE_SUPPLY_SKEW = {
    classAdd:  { cash: 0.25, consumable: 0.25 },
    favourite: { p: 0.85, ids: {
      torch: 1, rope: 1,
      healing_potion: 0.25, shielding_potion: 0.25, reach_potion: 0.25, speed_potion: 0.25,
      // The Magic Trap (items.js `caveOnly`): the one door into it besides a
      // slain trapper. Half a share: glad to find, not a staple.
      magic_trap: 0.5,
    } },
  };
  // A cave skew reaches only a row that asks for it (`caveSkew`) rolled
  // underground. app.js digTreasureOpts passes its depth and tier; themed
  // chests use ChestThemes.
  function caveSkewable(contextKey) {
    return !!LOOT_CONTEXTS[contextKey]?.caveSkew;
  }
  function caveSupplyApplies(contextKey, opts) {
    return caveSkewable(contextKey) && (opts?.depth || 0) > 0
      && ((opts?.tier) || 2) <= CAVE_SUPPLY_MAX_TIER;
  }
  // THE DEEP HOARD — the same overlay for a cave chest ABOVE the supply tiers
  // (T3+): potions, powders, scrolls and gems. Consumables and minerals are
  // added to the row's classes, and the favourite set is drawn `p` of the time,
  // TIER-CAPPED (`tierCapped`: members at or under the rolled tier), so a gem
  // arrives only where its tier does — a sapphire from T4, a diamond at T7.
  const CAVE_DEEP_SKEW = {
    classAdd:  { consumable: 0.25, ores: 0.25 },
    favourite: { p: 0.75, tierCapped: true, ids: {
      healing_potion: 1, shielding_potion: 1, reach_potion: 1, speed_potion: 1, flight_potion: 1,
      revival_potion: 1, blight_potion: 1, raven_scroll: 1, bones_scroll: 1, wraith_scroll: 1, thunder_scroll: 1, resurrection_potion: 1,
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
    // Chest-picked rows merge in the per-tier modifier (default T2); other
    // rows ignore opts.tier. Biome × tier stay two independent axes.
    let ctx = baseCtx;
    if (baseCtx.picker === 'chest') {
      const t = (opts && opts.tier) || 2;
      const mod = (RARITY_TUNING.chestTierMod && RARITY_TUNING.chestTierMod[t])
        || RARITY_TUNING.chestTierMod?.[2] || {};
      ctx = { ...baseCtx, ...mod };
    }
    const caveSkew = caveSupplyApplies(contextKey, opts) ? CAVE_SUPPLY_SKEW
      : caveDeepApplies(contextKey, opts) ? CAVE_DEEP_SKEW : null;
    if (caveSkew) {
      const classBias = { ...ctx.classBias };
      // Buried cave X marks keep a union pool of supply + magic: a loot group, never an inventory kind.
      classBias.consumable = (classBias.consumable || 0) + (classBias.supply || 0);
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
      // An unavailable distance-gated class gives its share to magic instead
      // of increasing the other equipment class's chance. Only transfer into
      // this card's classes, so cash and supply cards retain their own pools.
      for (const [from, to] of Object.entries(opts.classFallbacks || {})) {
        if (!opts.classes.includes(from) && opts.classes.includes(to)) {
          classBias[to] = (classBias[to] || 0) + (ctx.classBias[from] || 0);
        }
      }
      ctx = { ...ctx, classBias };
    }

    return ctx;
  }

  function rollRewardQuality(ctx, cls, save, rng, opts) {
    // 2) Boost chain. Start T1 / bracket 0; each step bumps tier or budget bracket.
    // Relics always tier-up (quantity is meaningless for them).
    const isRelic = cls === 'relic';
    const finalCap = isRelic
      ? Math.min(ctx.relicCap ?? 7, 7)
      : Math.min(ctx.maxTier ?? 7, (cls === 'chestQuality' ? 7 : CLASS_MAX_TIER[cls] || 1),
          (opts && opts.classMaxTier && opts.classMaxTier[cls]) || 7);
    const chainCap = isRelic
      ? Math.min(ctx.relicChainMax ?? finalCap, finalCap)
      : Math.min(ctx.chainMax ?? finalCap, finalCap);
    // Deterministic chain: the context declares how many boost steps fire
    // (chainSteps); each is 33% budget-up (bracket++) or 67% tier-up if below
    // chainCap (else budget-up). It never 'misses', so the chest's tier is
    // reached reliably while still providing variance. A bracket only raises
    // the roll's budget (ChestThemes.budget), so it has no cap of its own.
    let tier = 1, bracket = 0;
    // Steps that could not apply (a roll bonus with no tier headroom, or a
    // bracket on gear, which has no stack) pay small consolation coins.
    let wastedQtyBumps = 0;
    const chainSteps = ctx.chainSteps ?? 0;
    const luck = upgradeLuck(save);
    const budgetP = Math.max(0, Math.min(0.95, (RARITY_TUNING.chainBudgetP ?? 0.33) - luck));
    for (let i = 0; i < chainSteps; i++) {
      const goBudget = rng() < budgetP;
      if (!goBudget && tier < chainCap) tier += 1;
      else bracket += 1;
    }
    // ROLL BONUS — extra steps the caller paid for (opts.rollBonus; the
    // cobble-trail prize spends Trail.PRIZE_ROLL_BONUS on it, one more for
    // every prize already won). These buy TIER AND NOTHING ELSE.
    // A bonus step is not an ordinary chain step: with no tier headroom it
    // pays consolation coins rather than padding the stack, so a longer walk
    // buys a BETTER find, not a bigger pile of the same one.
    //
    // The context's maxTier / chainMax still bound the result, so a bonus can
    // lift a roll toward its ceiling but never above it. It does not touch a
    // chest gear roll — those use rollGearUpgrade on the chest tier alone.
    const bonusSteps = Math.max(0, Math.floor((opts && opts.rollBonus) || 0));
    for (let i = 0; i < bonusSteps; i++) {
      if (tier < chainCap) tier += 1;
      else wastedQtyBumps += 1;        // no headroom left — pay it out in coins
    }
    // The wizard's budget upgrade: one extra bracket roll (not a post-multiply, which would double unbounded).
    if (!isRelic && rng() < budgetBoostChance(save)) bracket += 1;

    // 3) Jackpot. Geometric chain rooted at jackpotEntryP × jackpotContinueP;
    // each step picks tier-up vs budget-up 50/50; a budget-up only raises the
    // budget. Fanfare fires on any non-zero jackpot.
    let jackpotSteps = 0;
    if (rng() < RARITY_TUNING.jackpotEntryP) {
      jackpotSteps = 1;
      while (rng() < RARITY_TUNING.jackpotContinueP && jackpotSteps < 7) jackpotSteps++;
    }
    for (let i = 0; i < jackpotSteps; i++) {
      // Relics have no qty: force tier-up. Otherwise 50/50.
      const goTier = isRelic || rng() < 0.5;
      if (goTier && tier < finalCap) tier++;
      else if (!goTier) bracket++;
      // (A goTier step that hits finalCap pays no coins: the cap is a chest feature.)
    }
    const jackpotApplied = jackpotSteps;

    return { tier, bracket, finalCap, jackpotApplied, wastedQtyBumps };
  }

  function pickChestReward(theme, save, rng, opts = {}) {
    // A fresh reward stream consumes one ambient seed, never a world-generation stream.
    rng = rng || makeRng32(Math.floor(Math.random() * 0x100000000));
    theme = ChestThemes.normalize(theme);
    const chestTier = Math.max(1, Math.min(typeof chestTierMaxFor === 'function' ? chestTierMaxFor(opts.depth) : 5, opts.tier || 2));
    const ctx = RARITY_TUNING.chestTierMod[chestTier];
    const quality = rollRewardQuality(ctx, 'chestQuality', save, rng, opts);
    quality.tier = Math.max(quality.tier, ChestThemes.qualityFloor(chestTier));
    return resolveChestReward(theme, quality, save, rng, { ...opts, tier: chestTier });
  }

  // Also used by the balance tool to isolate a rolled quality from the displayed chest tier.
  function resolveChestReward(theme, quality, save, rng, opts = {}) {
    const reward = resolveChestRewardRaw(theme, quality, save, rng, opts);
    return reward ? { ...reward, category: rewardCategory(reward) } : null;
  }
  function resolveChestRewardRaw(theme, quality, save, rng, opts = {}) {
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
    // T2 supplies can introduce an alternate weapon, never replacing an owned one or exceeding T1.
    const supply = ChestThemes.groups[resolved.group];
    const starterSlots = chestTier === 2 ? (supply.starterWeapons || [])
      .filter(slot => _RELIC_DEFS[slot] && !(save?.relics?.[slot]?.tier > 0)) : [];
    if (starterSlots.length && rng() < supply.starterWeaponChance) {
      return { kind: 'relic', slot: _pickFromArray(starterSlots, rng), tier: 1, ...meta };
    }
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
      return { kind: 'gold', amount: cashValue(tier, bracket, rng), cls: 'cash', tier, ...meta };
    }
    const id = ChestThemes.pickItem(resolved, tier, rng, selectionOpts);
    return { kind: 'item', id, qty: ChestThemes.quantity(id, tier, bracket, chestTier),
      tier: _ITEM_BY_ID[id].kind === 'unique_relic' ? _ITEM_BY_ID[id].baseTier : tier,
      cls: _ITEM_BY_ID[id].kind, ...meta };
  }

  // Resolve one authored signature for gameplay and the monster review page.
  // Duplicate equipment pays its own value, never the value of better owned gear.
  function eliteSignatureReward(kind, signatureIndex, save) {
    const drop = Combat.monster(kind)?.eliteDrops?.[signatureIndex];
    if (!drop) return null;
    const target = Combat.eliteDropTier(kind);
    const meta = { signatureIndex, jackpot: 0, consolation: 0 };
    if (drop.kind === 'item') {
      const item = _ITEM_BY_ID[drop.id];
      const unique = item.kind === 'unique_relic';
      const reward = { kind: 'item', id: drop.id,
        qty: unique ? 1 : ChestThemes.quantity(drop.id, target) + (drop.qtyBonus || 0),
        tier: item.baseTier, cls: item.kind, ...meta };
      return unique ? Rewards.reconcileUnique(save, reward) : reward;
    }
    const tiers = (drop.kind === 'relic' && _RELIC_DEFS[drop.slot]?.tiers) || GEAR_ROLL_TIERS;
    const tier = tiers.filter(t => t <= target).pop() || tiers[0];
    const owned = (drop.kind === 'armor' ? save?.armor : save?.relics)?.[drop.slot]?.tier || 0;
    if (owned >= tier) {
      return { kind: 'gold', slot: drop.slot, gearKind: drop.kind, tier,
        amount: Math.max(1, Math.floor(_gearPrice(drop.kind, drop.slot, tier) / 2)), ...meta };
    }
    return { ...drop, tier, ...meta };
  }

  function pickEliteReward(save, rng, opts) {
    const guaranteed = Combat.ELITE_RANKS[opts?.eliteRank]?.dropIndex;
    if (guaranteed != null) return eliteSignatureReward(opts?.monsterKind || 'cave_slime', guaranteed, save);
    const roll = rng();
    let threshold = 0;
    const index = Combat.ELITE_DROP_CHANCES.findIndex(p => (threshold += p) > roll);
    return eliteSignatureReward(opts?.monsterKind || 'cave_slime', index < 0 ? 2 : index, save);
  }

  function pickReward(contextKey, save, rng, opts) {
    const reward = pickRewardRaw(contextKey, save, rng, opts);
    return reward ? { ...reward, category: rewardCategory(reward) } : null;
  }
  function pickRewardRaw(contextKey, save, rng, opts) {
    const row = LOOT_CONTEXTS[contextKey];
    if (row?.picker === 'chest') return pickChestReward(row.theme, save, rng, opts);
    rng = rng || Math.random;
    if (row?.picker === 'elite') return pickEliteReward(save, rng, opts);
    const ctx = lootContext(contextKey, opts);
    if (!ctx) return null;
    if (ctx.picker === 'elite') return pickEliteReward(save, rng, opts);

    // 1) Pick class. relicCap 0 scrubs the relic weight (a shop never offers a relic).
    const bias = { ...ctx.classBias };
    if ((ctx.relicCap ?? 7) <= 0) delete bias.relic;
    const cls = weightedPick(bias, rng);
    if (!cls) return null;

    const quality = rollRewardQuality(ctx, cls, save, rng, opts);
    const { tier, bracket, finalCap, jackpotApplied } = quality;
    let wastedQtyBumps = quality.wastedQtyBumps;

    // Consolation gold for wasted qty bumps: $5 × wastedBumps × tier, capped per pull at $100.
    const consolationFor = (rewardTier) => {
      if (wastedQtyBumps <= 0) return 0;
      const per = 5 * Math.max(1, rewardTier || 1);
      return Math.min(wastedQtyBumps * per, 100);
    };

    // A piece of gear, reconciled against what is worn (reconcileRelicOffer:
    // never a downgrade), with its consolation — the tail every gear class
    // (relic, gear, boots) shares. Every chain budget-step on a gear class was
    // "wasted" (gear has no qty axis), so the brackets roll into consolation
    // beside the qty-cap waste — except for shops, which never pay
    // consolation (the player is buying).
    const gearOut = (rolled, rewardTier, cap) => {
      if (!ctx.singleItem) wastedQtyBumps += bracket;
      const out = reconcileRelicOffer({ ...rolled, jackpot: jackpotApplied }, save, rng, cap);
      if (out) out.consolation = ctx.singleItem ? 0 : consolationFor(rewardTier);
      return out;
    };

    // 4) Resolve to a concrete item / relic / gold.
    if (cls === 'relic') {
      const slots = Object.keys(_RELIC_DEFS);
      if (!slots.length) return null;
      const slot = pickFromArray(slots, rng);
      // Relics deduct one tier off whatever the chain rolled — a T2 chest
      // that produced tier=2 still offers a T1 (wood) relic. Floor at 1 and
      // re-clamp against relicCap.
      const relicTier = Math.max(1, Math.min(finalCap, tier - 1));
      return gearOut({ slot, tier: relicTier }, relicTier);
    }
    // GEAR — one even draw over every tool / weapon slot, armour slot and
    // unique relic not carried at or under the rolled tier (Gear.uniqueRelics).
    // Keeps the rolled tier (no relic deduction) and the usual duplicate handling.
    if (cls === 'gear') {
      const uniques = Gear.uniqueRelics().filter(it => it.baseTier <= tier && !carriesItem(save, it.id));
      const pool = [
        ...Object.keys(_RELIC_DEFS).map(slot => ({ kind: 'relic', slot })),
        ...Object.keys(_ARMOR_DEFS).map(slot => ({ kind: 'armor', slot })),
        ...uniques.map(it => ({ kind: 'item', id: it.id })),
      ];
      const pick = pickFromArray(pool, rng);
      if (pick.kind === 'item') {
        if (!ctx.singleItem) wastedQtyBumps += bracket;
        const uTier = _ITEM_BY_ID[pick.id].baseTier;
        return { kind: 'item', id: pick.id, qty: 1, tier: uTier, cls: 'unique_relic',
                 jackpot: jackpotApplied, consolation: consolationFor(uTier) };
      }
      return gearOut({ kind: pick.kind, slot: pick.slot, tier }, tier, finalCap);
    }
    // BOOTS — the road's equipment option, with the same duplicate/upgrade
    // handling as other gear so a reward never replaces better owned boots.
    if (cls === 'boots') return gearOut({ kind: 'armor', slot: 'boots', tier }, tier, finalCap);
    // CASH — coins, worth what an item of the rolled tier is worth
    // (CASH_TIER_VALUE) and fattened by the same budget brackets a stack
    // would have been, so the qty axis is not dead weight on a money roll.
    // NO `slot`: that is what tells every payer apart from a gear cash-out
    // (interact.js grantTreasureRoll, interactables.js) — money is money.
    // It pays no separate consolation; coins beside coins is one number said
    // twice.
    if (cls === 'cash') {
      const amount = cashValue(tier, ctx.singleItem ? 0 : bracket, rng) * (ctx.cashMul ?? 1);
      return { kind: 'gold', amount: Math.max(1, Math.round(amount)), tier, cls: 'cash',
               jackpot: jackpotApplied, consolation: 0 };
    }
    // BUNDLE — wood or stone; tier never climbs (CLASS_MAX_TIER.bundle), so every bracket is size.
    if (cls === 'bundle') {
      const bid = pickFromArray(BUNDLE_IDS, rng);
      const bqty = ctx.singleItem ? 1 : ChestThemes.quantity(bid, tier, bracket);
      return { kind: 'item', id: bid, qty: bqty, cls: 'bundle',
               tier: _ITEM_BY_ID[bid]?.baseTier ?? 1,
               jackpot: jackpotApplied, consolation: 0 };
    }
    // FAVOURITE - a non-chest context may pin one item id, or a weighted set,
    // inside its own class (the road prize and grove shrine; themed chests
    // resolve through ChestThemes first). Separate from dropWeight, which
    // affects every context. The pin ignores tier unless tierCapped says
    // otherwise, and only members of the rolled class count.
    const fav = ctx.favourite;
    let favId = null;
    if (fav) {
      const cand = fav.ids
        ? Object.entries(fav.ids).filter(([k]) => (_ITEM_BY_ID[k]?.kind === cls || (cls === 'consumable' && ['magic', 'supply'].includes(_ITEM_BY_ID[k]?.kind)))
            && (!(fav.tierCapped || cls === 'magic') || (_ITEM_BY_ID[k]?.baseTier ?? 1) <= tier))
        : (_ITEM_BY_ID[fav.id]?.kind === cls ? [[fav.id, 1]] : []);
      if (cand.length && rng() < (fav.p ?? 0)) {
        favId = cand.length === 1 ? cand[0][0] : weightedPick(Object.fromEntries(cand), rng);
      }
    }
    const id = favId || pickItemInClass(cls, tier, rng) || (cls === 'magic' ? 'torch' : null);
    if (!id) return null;
    // Quantity is the roll's budget over the item's price, the same stack a
    // chest pays (ChestThemes.quantity: budget share, per-item cap; leftover
    // budget pays no coins).
    const itemTier = _ITEM_BY_ID[id]?.baseTier ?? tier;
    let qty;
    if (ctx.singleItem) {
      // Shops sell one item at a time, EXCEPT seed packs (5 for T1-T3, 1 for T4
      // Frost flowers). Rolled bumps are discarded, with no consolation.
      qty = cls === 'seed' && itemTier < 4 ? 5 : 1;
    } else {
      qty = ChestThemes.quantity(id, tier, bracket);
    }
    return { kind: 'item', id, qty, tier, cls: _ITEM_BY_ID[id].kind, jackpot: jackpotApplied,
             consolation: ctx.singleItem ? 0 : consolationFor(itemTier) };
  }

  // Every gear tier a roll may land on. The real ceiling is the per-source loot
  // rule (`maxTier` / `relicCap`, plus the `preferred` clamp in rollGearUpgrade
  // below), so a low-tier chest still can't cough up a Frost relic.
  const GEAR_ROLL_TIERS = [1, 2, 3, 4, 5, 6, 7];

  // Dedicated relic/armor jackpot picker — used by fishing (2% cast jackpot)
  // and by the chest relic path in pickReward. Guarantees a gear result (relic
  // or armor upgrade, or consolation gold). `chestT` 1-5 drives the
  // preferred/ceiling tier.
  function rollGearUpgrade(rng, currentRelics, chestT = 2, currentArmor = null, allowedSlots = null, luck = 0, minTier = 1, maxTier = 7) {
    const random = rng || Math.random;
    if (!Object.keys(_RELIC_DEFS).length) return null;
    // DIRECT MAP: a chest's rolled tier IS its preferred gear tier. The caller
    // hands the ROLLED quality tier, so a jackpot over a surface chest is the
    // one way T6/T7 gear appears above ground; deep chests make it common.
    // preferred is clamped to 1..7, so the capped pool is never empty.
    const preferred = Math.min(maxTier, Math.max(1, chestT));
    const capped = GEAR_ROLL_TIERS.filter(t => t >= Math.min(preferred, minTier) && t <= preferred);
    const weighted = capped.map(t => ({ t, w: 1 / (1 + Math.abs(t - preferred)) }));
    let pickedTier = weightedPickBy(weighted, (w) => w.w, random).t;
    // Fortune reaches this lane too, without raising the source's tier ceiling.
    if (luck > 0 && random() < luck) pickedTier = Math.min(preferred, pickedTier + 1);
    const relicSlots = Object.keys(_RELIC_DEFS);
    const armorSlots = Object.keys(_ARMOR_DEFS);
    const slotPool = allowedSlots || [
      ...relicSlots.map(s => ({ kind: 'relic', slot: s })),
      ...armorSlots.map(s => ({ kind: 'armor', slot: s })),
    ];
    const sp = _pickFromArray(slotPool, random);
    const slotTiers = sp.kind === 'relic' && _RELIC_DEFS[sp.slot]?.tiers;
    if (slotTiers) {
      const eligible = slotTiers.filter(t => t >= Math.min(preferred, minTier) && t <= preferred);
      const available = eligible.length ? eligible : slotTiers.filter(t => t <= preferred);
      pickedTier = available.filter(t => t <= pickedTier).pop() || available[0];
    }
    const cur = sp.kind === 'relic'
      ? (currentRelics?.[sp.slot]?.tier ?? 0)
      : (currentArmor?.[sp.slot]?.tier ?? 0);
    if (pickedTier > cur) return { kind: sp.kind, slot: sp.slot, tier: pickedTier };
    const price = _gearPrice ? _gearPrice(sp.kind, sp.slot, pickedTier) : 0;
    return { kind: 'gold', amount: Math.max(1, Math.floor(price / 2)), slot: sp.slot, gearKind: sp.kind, tier: pickedTier };
  }

  global.RARITY_TUNING          = RARITY_TUNING;
  // The synthetic classes' tables, for the balancing dashboard (neither is in ITEMS_BY_CLASS_TIER).
  global.CASH_TIER_VALUE        = CASH_TIER_VALUE;
  global.BUNDLE_IDS             = BUNDLE_IDS;
  global.LOOT_CONTEXTS          = LOOT_CONTEXTS;
  global.lootContext            = lootContext;
  global.CAVE_SUPPLY_SKEW       = CAVE_SUPPLY_SKEW;
  global.CAVE_DEEP_SKEW         = CAVE_DEEP_SKEW;
  global.ITEMS_BY_CLASS_TIER    = ITEMS_BY_CLASS_TIER;
  global.pickReward             = pickReward;
  global.eliteSignatureReward   = eliteSignatureReward;
  global.pickChestReward        = pickChestReward;
  global.resolveChestReward     = resolveChestReward;
  global.rollRewardQuality     = rollRewardQuality;
  global.reconcileRelicOffer    = reconcileRelicOffer;
  global.rollGearUpgrade        = rollGearUpgrade;
  // The luck ladders, so the wizard's rungs and tests read the SAME numbers.
  global.upgradeLuck            = upgradeLuck;
  global.budgetBoostChance                = budgetBoostChance;
})(window);
