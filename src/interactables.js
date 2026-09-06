// Entity-driven interactable registry.
//
// World objects the player taps (trees, ore rocks, fruit trees, …) used to be
// handled by a long if/else chain on `o.kind` inside interact.js' 'object'
// tap-handler. That chain mixed three orthogonal concerns for every kind:
//   1. GATE   — is this object spent / does the player have the right tool tier?
//   2. TIMER  — how long is the work wheel (driven by the equipped tool tier)?
//   3. PAYOUT — what loot drops when the work completes?
//
// This module pulls those concerns into a declarative table so adding a new
// interactable is a matter of describing it as data, not threading another
// branch through the dispatcher. Each entry declares:
//
//   tool          relic slot that drives the work-wheel duration + speed
//                 (toolDurationMs). null/absent ⇒ not a tool interaction.
//   spent(o,ctx)  optional: object already consumed this session?
//   spentAction   what a spent object does: 'skip' (let the tap fall through to
//                 the next object / handler — used for chopped tree stumps so
//                 they don't block tilling) or 'consume' (default — eat the tap).
//   gate(o,save)  optional: return a flash string to BLOCK + consume the tap
//                 (e.g. "Need a Wood pick…"), or null/undefined to allow.
//   energy(save,o) optional: energy spent up-front; if unaffordable the tap is
//                 consumed without starting work (mirrors spendEnergy guard).
//   complete(ctx,o) loot/side-effects fired when the work wheel finishes.
//   custom(ctx,o) escape hatch for interactables that aren't the tool pipeline
//                 (e.g. fruit harvest: instant, no tool, respawn-timer gated).
//                 Returns the handler result directly (true = consumed).
//
// All gate/energy callbacks are PURE over (object, save), so the driver can
// recompute derived values (tier requirements, isPlain, …) independently in
// `complete` without smuggling state through closures.
//
// Helpers referenced here (treeAxeReqTier, effectiveChopCost, effectivePickCost,
// TIER_BY_NUM, isShiny, SHINY_RATE, randInt, pickFromArray, ITEM_BY_ID,
// persistSave, toolDurationMs) are globals from util.js / items.js / save.js,
// all loaded before this module.

// ---- Gather luck -----------------------------------------------------------
// Chest / treasure loot has always been luck-aware: pickReward() reads the
// ring (ringLuck → rarer pulls) and amulet (amuletBracketChance → bigger
// stacks) straight off `save`. GATHER drops (tree wood, rock ore/gems, fruit)
// historically ignored luck entirely.
//
// Each registry entry now DECLARES which relic slots modify its rolls via a
// `luck` field, and the gather completes consult ctx.luck so the ring/amulet
// improve those yields too. This is gated behind GATHER_LUCK_DEFAULT (OFF):
// when disabled, gatherLuck() returns zeroed multipliers, every luck branch
// short-circuits before its Math.random(), and the RNG stream + outcomes are
// byte-for-byte identical to the pre-luck behaviour. Flip the flag (or set
// window.GATHER_LUCK_ENABLED at runtime, e.g. from tests) to enable it.
const GATHER_LUCK_DEFAULT = false;

// ---- Slow grind ------------------------------------------------------------
// A tool job EXACTLY one tier out of reach (bare hands = tier 0 included) is
// not refused outright: the player can choose to grind it out with what they
// have — a long fixed wheel at a steep flat energy price. See the gate branch
// in runInteractable.
const SLOW_GRIND_MS = 30000;
const SLOW_GRIND_ENERGY = 15;

function gatherLuckEnabled() {
  if (typeof window !== 'undefined' && window.GATHER_LUCK_ENABLED != null) {
    return !!window.GATHER_LUCK_ENABLED;
  }
  return GATHER_LUCK_DEFAULT;
}

// Resolve an entry's declared luck slots into multipliers for its rolls:
//   tierP  — ring contribution; scales a drop's rarity probability (×(1+tierP))
//   bonusP — amulet contribution; chance at one bonus unit of yield
// Returns zeroed multipliers when the flag is off or the entry declares no luck,
// so callers can apply them unconditionally without changing the off-path.
function gatherLuck(save, slots) {
  const out = { tierP: 0, bonusP: 0 };
  if (!gatherLuckEnabled() || !slots) return out;
  if (slots.includes('ring') && typeof ringLuck === 'function') {
    out.tierP = ringLuck(save);
  }
  if (slots.includes('amulet') && typeof amuletBracketChance === 'function') {
    out.bonusP = amuletBracketChance(save);
  }
  return out;
}

// A chest's HARDCODED payload → the reward shape pickReward would have
// returned, so both kinds of chest leave the handler down the same paths.
//
// Two payload shapes exist. `{id, qty}` is a stack of an item (the four spawn
// supply crates). `{kind:'relic'|'armor', slot, tier}` is a piece of gear (the
// spawn relic chest's wooden tool) — and gear cannot simply be handed over the
// way an item can: the player may already be wearing something better in that
// slot by the time they open it, and equipping the fixed payload regardless
// would DOWNGRADE them for opening a chest. reconcileRelicOffer is the rule
// the rest of the game settles that with (walk the slot up from what's owned,
// cash out to gold along the way), so a fixed gear payload goes through it too
// — meaning the payload names the FLOOR of what the chest is worth, not a
// promise that this exact tier is what comes out.
function fixedChestReward(fixedLoot, save) {
  if (!fixedLoot) return null;
  if (fixedLoot.kind === 'relic' || fixedLoot.kind === 'armor') {
    const offer = { kind: fixedLoot.kind, slot: fixedLoot.slot, tier: fixedLoot.tier, jackpot: 0 };
    // reconcileRelicOffer handles both gear kinds (rolled.kind picks the right
    // save table — relics vs armor) — see rarity.js. Route BOTH here, not just
    // relic, so a fixed armor payload can't downgrade equipped armor either.
    if (typeof reconcileRelicOffer === 'function') {
      const out = reconcileRelicOffer(offer, save, Math.random);
      if (out) { out.consolation = 0; return out; }
    }
    return offer;
  }
  return { kind: 'item', id: fixedLoot.id, qty: fixedLoot.qty, consolation: 0 };
}

// Plain-rock base drop: rockfruit + a 20% chance of one coal. Shared by the
// mineralrock 'isPlain' branch below AND the cave-wall dig handler in
// interact.js (loaded after this module, so the runtime reference is safe) —
// both used to hardcode this table separately. Only the BASE table lives
// here: mineralrock layers its own ring/amulet luck + bar-chance loop on top
// afterward, while cave walls take the base table as-is (no luck applied) —
// that split is deliberate, not an oversight, so don't fold the luck back in.
//
// `stones` is HOW MANY STONES THE SPRITE SHOWS (SpriteLayout.plainRockStones —
// 2 for the pair variant, 1 for the singles); the rock pays out that many plus
// a coin-flip bonus, so what you see is what you get. Pass null for a face with
// no rock sprite to promise anything — the cave WALL dig, which keeps the flat
// randInt(1,3) this table had for every rock before Sep 2026.
function plainRockBaseDrop(scene, stones) {
  const qty = (stones == null) ? randInt(1, 3) : stones + randInt(0, 1);
  scene.addToInv('rockfruit', qty);
  if (Math.random() < 0.20) scene.addToInv('coal', 1);
  return qty;
}

const INTERACTABLES = {
  // ---- Tree: chop with an axe for wood -------------------------------------
  // Bigger / harder trees demand a sturdier axe and pay out proportionally more
  // wood (treeWoodMul); softwood fells a tier easier, hardwood a tier harder
  // (treeAxeReqTier). A chopped stump is skipped so its cell stays tillable.
  tree: {
    tool: 'axe',
    luck: ['amulet'],   // amulet → chance at a bonus bundle of wood
    spent: (o, ctx) => o.chopped || (ctx.save.chopped && ctx.save.chopped.includes(o.id)),
    spentAction: 'skip',
    gate: (o, save) => {
      const reqTier = treeAxeReqTier(o);
      const axeTier = save.relics?.axe?.tier || 0;
      if (axeTier < reqTier) {
        const need = TIER_BY_NUM[reqTier]?.name || 'better';
        return `Need a ${need} axe to fell this ${treeSpeciesName(o)} tree.`;
      }
      return null;
    },
    // How many tiers the current axe falls short (0/negative = able). Bare
    // hands are tier 0, so a tier-1 tree bare-handed is exactly 1 short —
    // that's the slow-grind case (see runInteractable).
    tierShort: (o, save) => treeAxeReqTier(o) - (save.relics?.axe?.tier || 0),
    energy: (save, o) => (typeof effectiveChopCost === 'function')
      ? effectiveChopCost(save.relics, o) : 0,
    complete: (ctx, o) => {
      const { scene, save, sx, sy, luck } = ctx;
      const woodMul = treeWoodMul(o);
      let wood = randInt(2, 3) * woodMul;
      // Amulet luck: a chance at one extra bundle of wood. bonusP is 0 when
      // gather-luck is off, so the && short-circuits before Math.random() and
      // the yield is identical to the un-luck path.
      if (luck && luck.bonusP && Math.random() < luck.bonusP) wood += woodMul;
      o.chopped = true;
      save.chopped = save.chopped || [];
      if (!save.chopped.includes(o.id)) save.chopped.push(o.id);
      scene.addToInv('wood', wood);
      persistSave(save);
      // Say what came off the tree, like mining / harvesting / fishing do —
      // felling used to report the species and never mention the wood it just
      // put in the bag. The glyph follows the species: conifers keep 🌲,
      // everything else gets the broadleaf 🌳.
      const conifer = /pine|fir|spruce|cedar/i.test(treeSpeciesName(o) || '');
      scene.flash(o.size === 'bush' ? `🌿 Cleared a bush.`
                : `${conifer ? '🌲' : '🌳'} Felled ${treeSpeciesName(o)} tree.`, sx, sy);
      scene.flashLoot(`+${wood} ${ITEM_BY_ID.wood?.name || 'Wood'}`, undefined, 1, 'wood');
      // Rare shiny tree — 10× wood value in cash + a discovery point.
      if (isShiny(o.id, SHINY_RATE.tree)) scene.awardShinyBonus('wood', sx, sy);
    },
  },

  // ---- Mineral rock: mine with a pick for stone / ore / gems ---------------
  // "Plain rock" (a cave variant or a T1 deposit) is bare-hand-breakable and
  // drops stone + a small chance of a sliver of ore. Ore rock (T2+) is pick-tier
  // gated and drops exactly one namesake bar + coal + tier-rolled gems.
  mineralrock: {
    tool: 'pick',
    luck: ['ring', 'amulet'],   // ring → rarer bars/gems; amulet → bonus stone/coal
    spent: (o, ctx) => ctx.scene.brokenRockSet.has(o.id),
    spentAction: 'consume',
    gate: (o, save) => {
      const isCave = o.caveVariant != null;
      const isPlain = isCave || (o.yieldTier || 1) <= 1;
      if (isPlain) return null;   // plain rock is ungated
      const pickTier = save.relics?.pick?.tier || 0;
      const reqTier = o.requiredTier || Math.max(1, (o.yieldTier || 1) - 1);
      if (pickTier < reqTier) {
        const need = TIER_BY_NUM[reqTier]?.name || 'better';
        return `Need a ${need} pick to mine this ore.`;
      }
      return null;
    },
    // Tier shortfall for the slow-grind offer — same req the gate reads.
    // Plain rock is ungated, so it never reports short.
    tierShort: (o, save) => {
      const isPlain = o.caveVariant != null || (o.yieldTier || 1) <= 1;
      if (isPlain) return 0;
      const reqTier = o.requiredTier || Math.max(1, (o.yieldTier || 1) - 1);
      return reqTier - (save.relics?.pick?.tier || 0);
    },
    // Shared tool-tier baseline (9 bare → 1 Frost via effectivePickCost) OR a
    // +9-per-tier surcharge when the rock out-tiers the pick, whichever is more.
    energy: (save, o) => {
      const pickTier = save.relics?.pick?.tier || 0;
      const rockTier = o.yieldTier || 1;
      return Math.max(effectivePickCost(save.relics), 9 * (rockTier - pickTier));
    },
    complete: (ctx, o) => {
      const { scene, save, luck } = ctx;
      // Ring luck scales a drop's rarity probability; amulet luck grants a
      // chance at one bonus unit. Both default to 0 (flag off), so every roll
      // below threshold + Math.random() call is unchanged from the un-luck path.
      const tierP = (luck && luck.tierP) || 0;
      const bonusP = (luck && luck.bonusP) || 0;
      scene.brokenRockSet.add(o.id);
      save.brokenRocks = [...scene.brokenRockSet];
      // Slot 0/1 unused for the primary drop (ore starts at copper = T2); each
      // tier T2+ yields its OWN namesake bar.
      const BARS = ['', 'copper_bar', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
      const isCave = o.caveVariant != null;
      const isPlain = isCave || (o.yieldTier || 1) <= 1;
      if (isPlain) {
        // Plain rock — stone, coal on ~20% (shared base table, see
        // plainRockBaseDrop), plus a small per-tier chance (1/(2·t²) from
        // copper) of cracking open a bar — ring-luck-scaled, on top of the base.
        // The stone count follows the ART: the pair-of-stones variant drops
        // 2-3, a single stone 1-2. Both numbers come off the one table in
        // sprite_layout.js that render.js picks the frame from, so the rock the
        // player sees and the rocks they get can't disagree.
        const qty = plainRockBaseDrop(scene, SpriteLayout.plainRockStones(o));
        let flashId = 'rockfruit';
        for (let t = 2; t <= 7; t++) {
          // Ring nudges the bar chance up (×(1+tierP)); ×1 when luck is off.
          if (Math.random() < (1 / (2 * t * t)) * (1 + tierP)) {
            const bar = BARS[t];
            if (bar) { scene.addToInv(bar, 1); flashId = bar; }
          }
        }
        // Amulet luck: a chance at a bonus stone. Short-circuits before
        // Math.random() when bonusP is 0, so the off-path RNG stream is intact.
        let stoneQty = qty;
        if (bonusP && Math.random() < bonusP) { scene.addToInv('rockfruit', 1); stoneQty++; }
        persistSave(save);
        const item = ITEM_BY_ID[flashId];
        // Report the REAL count. A bar upstages the stones in the toast and
        // only ever drops one at a time, so it stays "+1"; stones say how many
        // actually went in the bag — this line read "+1 Rock" while handing
        // over three, the one loot path that under-reported itself (the cave
        // wall's own toast in interact.js has always flashed its qty).
        const flashQty = (flashId === 'rockfruit') ? stoneQty : 1;
        scene.flashLoot(`+${flashQty} ${item?.name || flashId}`, '#a7ffb0', 1, flashId);
        return;
      }
      // Ore-bearing rock — exactly ONE bar of the indicated type, plus a coal
      // nugget and a tier-rolled gem on T4+.
      scene.addToInv('coal', randInt(1, 2));
      const t = o.yieldTier || 1;
      const primaryBar = BARS[t] || 'copper_bar';
      scene.addToInv(primaryBar, 1);
      let flashId = primaryBar;
      let gemsFound = 0;
      const GEM_BY_TIER = { 4: ['sapphire'], 5: ['ruby'], 6: ['emerald'], 7: ['emerald', 'ruby'] };
      const GEM_P_BY_TIER = { 4: 0.25, 5: 0.35, 6: 0.40, 7: 0.50 };
      const gems = GEM_BY_TIER[t];
      // Ring nudges the gem chance up (×(1+tierP)); ×1 when luck is off. The
      // Math.random() fires whenever gems exist regardless of the threshold, so
      // the off-path call count is unchanged.
      if (gems && Math.random() < (GEM_P_BY_TIER[t] || 0) * (1 + tierP)) {
        const gemId = pickFromArray(gems);
        scene.addToInv(gemId, 1);
        flashId = gemId;
        gemsFound++;
      }
      // T7 rocks have a bonus 25% chance for a second ruby on top (ring-scaled).
      if (t === 7 && Math.random() < 0.25 * (1 + tierP)) {
        scene.addToInv('ruby', 1);
        flashId = 'ruby';
        gemsFound++;
      }
      // Amulet luck: a chance at a bonus coal nugget (off-path short-circuits).
      if (bonusP && Math.random() < bonusP) scene.addToInv('coal', 1);
      persistSave(save);
      // Finding a gem fires the jackpot fanfare on top of the loot flash.
      if (gemsFound >= 1 && typeof scene.flashJackpot === 'function') {
        scene.flashJackpot(gemsFound);
      }
      const item = ITEM_BY_ID[flashId];
      scene.flashLoot(`+1 ${item?.name || flashId}`, '#a7ffb0', 1, flashId);
    },
  },

  // ---- Fruit tree: instant harvest, respawn-timer gated --------------------
  // Not a tool interaction (no axe/pick, no work wheel, no energy) — handled
  // via `custom`. A planted sapling must mature (~4 days) before its first pick,
  // and each tree fruits once per 24h.
  fruittree: {
    luck: ['amulet'],   // amulet → chance at a bonus fruit
    custom: (ctx, o) => {
      const { scene, save, sx, sy, luck } = ctx;
      const FRUIT_RESPAWN_MS = 24 * 60 * 60 * 1000;   // one harvest per 24h
      // A planted sapling can't be harvested until it has matured (reached its
      // fruiting stage). 4 days sprout→fruit (4 × 1-day stages).
      if (o.planted) {
        const FRUIT_STAGE_MS = 24 * 60 * 60 * 1000;
        const elapsed = Date.now() - (o.planted_t || 0);
        if (elapsed < 4 * FRUIT_STAGE_MS) {
          // Largest-unit notation via the shared shortDuration (util.js) — the
          // hand-rolled d/h ladder that used to live here couldn't say "40m"
          // on the last stretch and read "1h" for anything under one.
          const left = shortDuration(4 * FRUIT_STAGE_MS - elapsed);
          scene.flash(`Still growing — ${left}`, sx, sy);
          return true;
        }
      }
      save.fruitPicked = save.fruitPicked || {};
      const pickedAt = save.fruitPicked[o.id];
      if (pickedAt && Date.now() - pickedAt < FRUIT_RESPAWN_MS) {
        const left = shortDuration(FRUIT_RESPAWN_MS - (Date.now() - pickedAt));
        scene.flash(`Picked — ripe again in ${left}`, sx, sy);
        return true;
      }
      save.fruitPicked[o.id] = Date.now();
      // A fruit tree's species IS the item it hands out, so it must be one.
      // The starter provisioning once tamed the fruit tree nearest spawn into
      // species 'pine' (home.js makeStarterUsable — fixed there), and 'pine'
      // is not an item: the pick flashed "harvested pine" and Inventory.add
      // dropped it on the floor. The source is fixed, but the bin objects a
      // tile is rebuilt from are shared for the session and a stale cached
      // home.js can still stamp them, so the tree repairs itself here: a
      // species that is not a produce item reverts to apple, in place, so the
      // pick, the flash and the shiny bonus all agree on one real fruit.
      if (!ITEM_BY_ID[o.species] || ITEM_BY_ID[o.species].kind !== 'produce') o.species = 'apple';
      let n = randInt(1, 2);
      // Amulet luck: a chance at one bonus fruit (short-circuits before
      // Math.random() when luck is off, keeping the off-path identical).
      if (luck && luck.bonusP && Math.random() < luck.bonusP) n += 1;
      scene.addToInv(o.species, n);
      ctx.dirty = true;
      const item = ITEM_BY_ID[o.species];
      scene.flashLoot(`harvested ${item?.name || o.species}`, '#a7ffb0', 1, o.species);
      // Rare shiny fruit tree — 10× fruit value in cash + a discovery point.
      if (isShiny(o.id, SHINY_RATE.tree)) scene.awardShinyBonus(o.species, sx, sy);
      return true;
    },
  },

  // ---- Ground stack: a loose pile of items, tap to pick up -----------------
  // Already-picked stacks are filtered at render time, but the tap loop walks
  // all objects regardless of save state, so guard again (returns 'skip' so the
  // tap falls through to the next object in case a tap races a re-render).
  groundstack: {
    custom: (ctx, o) => {
      const { scene, save } = ctx;
      if (save.picked && save.picked.includes(o.id)) return 'skip';
      save.picked = [...(save.picked || []), o.id];
      const qty = Math.max(1, o.qty || 1);
      scene.addToInv(o.itemId, qty);
      ctx.dirty = true;
      const item = ITEM_BY_ID[o.itemId];
      scene.flashLoot(`+${qty} ${item?.name || o.itemId}`, undefined, 1, o.itemId);
      return true;
    },
  },

  // ---- Chest: the full open-and-loot ceremony ------------------------------
  // Handles coin-burst POIs (ATM / bicycle parking), left-for-later held loot,
  // fixed starter payloads, produce-stand items, and the rarity-rolled item /
  // relic / armor / gold results, with a bag-full TAKE/LEAVE modal.
  chest: {
    // Declarative only: pickReward() reads the ring + amulet off `save` itself,
    // so chest loot is luck-aware regardless of the GATHER_LUCK flag (which
    // gates the gather drops). The field documents that linkage in one place.
    luck: ['ring', 'amulet'],
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      // Coin-burst POIs (ATM + bicycle parking) hijack the chest tap before the
      // standard open-and-loot path. They never go into save.opened — they're
      // gated by save.coinBurstClaimed[id+YYYYMMDD] so they refresh daily, and
      // produce world-scattered coin pickups instead of inventory loot.
      if (o.poiClass === 'atm' || o.poiClass === 'bicycle_parking') {
        if (typeof scene._coinBurstInteract === 'function') {
          scene._coinBurstInteract(sx, sy, o);
          return true;
        }
        // Fall through to default chest behaviour if the method isn't wired
        // (defensive — keeps these POIs usable if app.js is out of sync).
      }
      // Produce/food stands are MARKETS, not one-shot chests: tapping opens a
      // repeatable buy modal that SELLS the themed produce (loot.js
      // produceStandFor) at par value (PRICES[item], no shop markup). The stall
      // never goes into save.opened — a market doesn't get "picked clean".
      const stand = (typeof produceStandFor === 'function') ? produceStandFor(o) : null;
      if (stand && typeof scene.presentMarketStandOffer === 'function') {
        scene.presentMarketStandOffer(sx, sy, o, stand);
        return true;
      }
      if (save.opened.includes(o.id)) { scene.flash('Picked clean already.', sx, sy); return true; }
      // Every path below that actually spends the chest goes through this, so
      // the starter ladder's "open a crate" step is credited exactly once no
      // matter which branch (item / relic / gold / partial take) claimed it.
      const markOpened = () => {
        save.opened.push(o.id);
        scene.questEvent?.('chest');
        // BUG (Scouting report / QUEST_POIS): Quests.onPoiVisit is the only
        // thing that can credit a 'poi' quest, and its ONLY call site used to
        // be the well interactable below, hardcoded to the literal 'well'.
        // Six of QUEST_POIS's seven targets (fountain/library/museum/park/
        // place_of_worship/playground) never reach a well object — they land
        // on the world as plain kind:'chest' objects carrying that class as
        // o.poiClass (worldgen.js's POI 'USEFUL' set + loot.js POI_CATEGORY /
        // chestTier), so those quest slots sat on the board permanently
        // uncompletable (~1 in 20 generated slots, given the 'poi' template's
        // weight). Crediting from every chest open — not just from well — is
        // the fix: onEvent() only advances a poi-quest slot when its target
        // matches o.poiClass, so this is a no-op on every chest that isn't
        // the one a live quest is scouting for, and it can't double-credit
        // the 'chest' quest above (different `event` string, separate loop).
        // Firing it INSIDE markOpened (not the coin-burst / market-stand
        // shortcuts above, and not the "Picked clean already" / "leave for
        // later" paths that return before this runs) means a chest can only
        // ever award this once — exactly the same guarantee save.opened
        // already gives the 'chest' quest.
        if (typeof Quests !== 'undefined' && o.poiClass) Quests.onPoiVisit(save, o.poiClass);
      };
      // A chest previously left-for-later has its exact loot saved in chestHold;
      // reopening replays that same roll. Fresh opens go through pickReward
      // which handles items AND relics (biome-specific weights).
      const held = save.chestHold && save.chestHold[o.id];
      const chestT = (typeof chestTier === 'function') ? chestTier(o.poiClass) : 2;
      const category = (typeof POI_CATEGORY !== 'undefined' && POI_CATEGORY[o.poiClass]) || 'lowtier';
      const result = held
        ? { kind: 'item', id: held.id, qty: held.n, consolation: 0 }
        // Starter chests carry a fixed payload (9 wood / 9 rockfruit / 9 seeds,
        // or the spawn relic chest's wooden tool) so the first restoration loop
        // is deterministic — skip the rarity picker and synthesize the same
        // shape it returns, then fall through to the normal paths below.
        : (o.fixedLoot
            ? fixedChestReward(o.fixedLoot, save)
            : (stand
                ? { kind: 'item', id: stand.item, qty: 2 + Math.floor(Math.random() * 3), consolation: 0 }
                : ((typeof pickReward === 'function')
                    ? pickReward('chest:' + category, save, undefined, { tier: chestT })
                    : null)));
      if (!result) {
        addMoney(save, 1);
        markOpened();
        ctx.dirty = true;
        scene.flash('Chest had nothing useful.', sx, sy);
        return true;
      }
      if (result.consolation > 0) addMoney(save, result.consolation);
      if (result.kind === 'relic' || result.kind === 'armor') {
        // A chest gear roll can yield a relic OR armor (armor is just another
        // gear slot). equipGearReward handles both — armor also bumps max/cur
        // energy by the delta.
        equipGearReward(result, save, scene);
        markOpened();
        ctx.dirty = true;
        const name = (typeof gearName === 'function')
          ? gearName(result.kind, result.slot, result.tier)
          : `${result.slot} T${result.tier}`;
        const iconHTML = scene.gearIconHTML
          ? scene.gearIconHTML(result.kind, result.slot, result.tier, 64) : '★';
        scene.showChestRewardModal({ iconHTML, name, sub: 'equipped', color: UI_TREASURE });
        if (result.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
          scene.flashJackpot(result.jackpot);
        }
        return true;
      }
      if (result.kind === 'gold') {
        // Non-upgrade relic consolation (reconcileRelicOffer walked up and cashed out).
        markOpened();
        ctx.dirty = true;
        addMoney(save, result.amount || 0);
        const gearKind = result.gearKind || 'relic';
        const name = (typeof gearName === 'function')
          ? gearName(gearKind, result.slot, result.tier)
          : `${result.slot} T${result.tier}`;
        const iconHTML = scene.gearIconHTML
          ? scene.gearIconHTML(gearKind, result.slot, result.tier, 64) : '★';
        scene.showChestRewardModal({ iconHTML, name, sub: 'already own better — discarded', color: '#aaa' });
        if (result.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
          scene.flashJackpot(result.jackpot);
        }
        return true;
      }
      // kind === 'item'
      const lootId  = result.id;
      const lootQty = result.qty;
      const lootName = (ITEM_BY_ID[lootId]?.name || lootId).toString();
      const lootColor = (typeof tierInfo === 'function') ? tierInfo(lootId).color : UI_TREASURE;
      // A starter supply crate is not treasure. `o.crate` is the same test the
      // renderer uses to draw the box sprite instead of the tier-2 trunk, and
      // the same one the label pass uses to keep its name horizontal — so the
      // ceremony now agrees with both. Everything else, the spawn relic chest
      // included, keeps the treasure header.
      const rewardKind = o.crate ? 'supplies' : 'treasure';
      // Chest loot gets the full ceremony modal — quick-feedback flashLoot is
      // reserved for X-marks / harvest / mining (cheap repeating rewards).
      const iconHTML = scene.iconSpanHTML ? scene.iconSpanHTML(lootId, 64) : '';
      const qtyLabel = lootQty > 1 ? `× ${lootQty}` : null;
      // If the loot won't fully fit, don't silently drop the overflow — let the
      // player TAKE what fits (chest emptied, rest lost) or LEAVE it for later
      // (chest kept, its exact contents remembered in save.chestHold). Modal
      // buttons fire after this handler returns, so they persist themselves.
      const room = (typeof scene.invRoomFor === 'function') ? scene.invRoomFor(lootId) : Infinity;
      if (lootQty > room) {
        scene.showChestRewardModal({
          iconHTML, name: lootName, qty: qtyLabel, color: lootColor, kind: rewardKind,
          sub: room > 0
            ? `Bag full — room for only ${room} of ${lootQty}.`
            : 'Your bag is full.',
          actions: [
            { label: 'Leave for later', primary: true, onClick: () => {
              save.chestHold = save.chestHold || {};
              save.chestHold[o.id] = { id: lootId, n: lootQty };
              persistSave(save);
              scene.flash?.('Left it in the chest.', sx, sy);
            } },
            { label: room > 0 ? `Take ${room}` : 'Discard', onClick: () => {
              if (room > 0) scene.addToInv(lootId, lootQty);
              markOpened();
              if (save.chestHold) delete save.chestHold[o.id];
              persistSave(save);
            } },
          ],
        });
        if (result.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
          scene.flashJackpot(result.jackpot);
        }
        return true;
      }
      // Fits fully — take it and empty the chest.
      scene.addToInv(lootId, lootQty);
      markOpened();
      if (save.chestHold) delete save.chestHold[o.id];
      ctx.dirty = true;
      scene.showChestRewardModal({ iconHTML, name: lootName, qty: qtyLabel, color: lootColor,
                                   kind: rewardKind });
      if (result.jackpot >= 1 && typeof scene.flashJackpot === 'function') {
        scene.flashJackpot(result.jackpot);
      }
      return true;
    },
  },

  // ---- Well / fountain: refills the watering can ---------------------------
  // OSM amenity=fountain — a water source on dry land. Tops the can to full,
  // exactly like tapping a WATER tile via the 'can-refill' handler.
  well: {
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      if (typeof Quests !== 'undefined') {
        const done = Quests.onPoiVisit(save, 'well');
        if (done) {
          if (save.relics?.can) { save.canCharges = 50; }
          ctx.dirty = true;
          scene.flash('Quest done! Return to the castle.', scene.viewCenterX, scene.viewCenterY - 60);
          return true;
        }
      }
      if (!save.relics?.can) {
        scene.flash('Cool, clear water. (need a watering can)', sx, sy);
        return true;
      }
      save.canCharges = 50;
      ctx.dirty = true;
      scene.flash('🪣 Watering can full — 50 charges.', sx, sy);
      return true;
    },
  },

  // ---- Buildings: open their UIs ------------------------------------------
  // House / tower (castle turret) route to the shop. Tall sprites — their
  // wider reach is handled by the tap loop before dispatch.
  house: {
    custom: (ctx, o) => { ctx.scene.shopInteract(ctx.sx, ctx.sy, o); return true; },
  },
  tower: {
    custom: (ctx, o) => { ctx.scene.shopInteract(ctx.sx, ctx.sy, o); return true; },
  },
};

// Generic driver for a registered interactable. Returns:
//   'skip'  — caller should `continue` to the next object (spent + spentAction
//             'skip', e.g. a chopped tree stump that shouldn't block the cell)
//   true    — the tap was consumed (gate blocked, work started, or custom done)
//   false   — `o.kind` is not registered (caller falls through to other blocks)
// ── Tool-gate fade ──────────────────────────────────────────────────────────
// A tree or rock the player's current tool can't work is drawn at half alpha,
// so what is reachable NOW reads at a glance instead of by tapping everything
// and reading refusals. "Can't work" is the entry's own tierShort — the same
// number the tap gate refuses on (and offers the slow grind at exactly 1) — so
// the fade and the refusal can never disagree. Kinds without a tool gate
// (fruit trees, chests, plants) are never faded; nor is a bush (axe tier 0) or
// a plain rock (ungated). render.js applies it in the tree / mineralrock
// `after` hooks; it lives here so it reads the shipping gate, not a copy.
const TOOL_GATED_ALPHA = 0.5;
function isToolGated(o, save) {
  const def = INTERACTABLES[o.kind];
  return !!(def && def.tierShort && def.tierShort(o, save || {}) > 0);
}
function toolGatedAlpha(o, save) {
  return isToolGated(o, save) ? TOOL_GATED_ALPHA : 1;
}

function runInteractable(ctx, o) {
  const def = INTERACTABLES[o.kind];
  if (!def) return false;
  const { scene, save, sx, sy } = ctx;

  // Resolve the entry's declared luck slots into roll multipliers for the
  // complete/custom callbacks. Zeroed when gather-luck is off or none declared,
  // so the off-path is unchanged (see gatherLuck).
  ctx.luck = gatherLuck(save, def.luck);

  if (def.spent && def.spent(o, ctx)) {
    return def.spentAction === 'skip' ? 'skip' : true;
  }
  // Non-tool interactables (fruit harvest, …) own their whole flow.
  if (def.custom) return def.custom(ctx, o);

  // Tool pipeline: gate → spend energy → start the tier-driven work wheel.
  const blockMsg = def.gate ? def.gate(o, save) : null;
  if (blockMsg) {
    // EXACTLY one tier short (bare hands = tier 0 included): instead of a
    // flat refusal, offer to grind it out — a long SLOW_GRIND_MS wheel at a
    // steep flat SLOW_GRIND_ENERGY, next to the ~3-9s / few-⚡ cost the right
    // tool would pay. Two or more tiers short stays a hard no.
    const short = def.tierShort ? def.tierShort(o, save) : 0;
    if (short === 1 && typeof scene.showOfferModal === 'function') {
      scene.showOfferModal({
        kind: 'note',
        title: 'This would be very slow to do with your current equipment.',
        get: 'Do it anyway?',
        cost: `${SLOW_GRIND_ENERGY}⚡ · ${Math.round(SLOW_GRIND_MS / 1000)}s of work`,
        canAfford: (save.energy ?? 0) >= SLOW_GRIND_ENERGY,
        acceptLabel: 'Do it',
        cancelLabel: 'Not now',
        onAccept: () => {
          if (!scene.spendEnergy(SLOW_GRIND_ENERGY, sx, sy)) return;
          // Same completion as a proper-tool job; the energy rides along as
          // the refund if the player cancels the wheel mid-grind.
          scene.startWorkProgress(o.x, o.y, () => def.complete(ctx, o),
            SLOW_GRIND_MS, SLOW_GRIND_ENERGY, def.tool);
        },
      });
      return true;
    }
    scene.flash(blockMsg, sx, sy);
    return true;
  }

  const cost = def.energy ? def.energy(save, o) : 0;
  const durMs = (typeof toolDurationMs === 'function')
    ? toolDurationMs(save.relics, def.tool)
    : (save.relics?.[def.tool] ? 4000 : 9000);
  if (cost && !scene.spendEnergy(cost, sx, sy)) return true;   // can't afford — tap consumed
  // cost is passed through as the refund amount if the player cancels mid-work.
  scene.startWorkProgress(o.x, o.y, () => def.complete(ctx, o), durMs, cost || 0, def.tool);
  return true;
}
