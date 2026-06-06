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

const INTERACTABLES = {
  // ---- Tree: chop with an axe for wood -------------------------------------
  // Bigger / harder trees demand a sturdier axe and pay out proportionally more
  // wood (treeWoodMul); softwood fells a tier easier, hardwood a tier harder
  // (treeAxeReqTier). A chopped stump is skipped so its cell stays tillable.
  tree: {
    tool: 'axe',
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
    energy: (save, o) => (typeof effectiveChopCost === 'function')
      ? effectiveChopCost(save.relics, o) : 0,
    complete: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      const woodMul = treeWoodMul(o);
      o.chopped = true;
      save.chopped = save.chopped || [];
      if (!save.chopped.includes(o.id)) save.chopped.push(o.id);
      scene.addToInv('wood', randInt(2, 3) * woodMul);
      persistSave(save);
      scene.flash(`🌲 Felled ${treeSpeciesName(o)} tree.`, sx, sy);
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
    // Shared tool-tier baseline (9 bare → 1 Frost via effectivePickCost) OR a
    // +9-per-tier surcharge when the rock out-tiers the pick, whichever is more.
    energy: (save, o) => {
      const pickTier = save.relics?.pick?.tier || 0;
      const rockTier = o.yieldTier || 1;
      return Math.max(effectivePickCost(save.relics), 9 * (rockTier - pickTier));
    },
    complete: (ctx, o) => {
      const { scene, save } = ctx;
      scene.brokenRockSet.add(o.id);
      save.brokenRocks = [...scene.brokenRockSet];
      // Slot 0/1 unused for the primary drop (ore starts at copper = T2); each
      // tier T2+ yields its OWN namesake bar.
      const BARS = ['', 'copper_bar', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
      const isCave = o.caveVariant != null;
      const isPlain = isCave || (o.yieldTier || 1) <= 1;
      if (isPlain) {
        // Plain rock — stone (1-3 rockfruit), coal on ~20%, plus a small
        // per-tier chance (1/(2·t²) from copper) of cracking open a bar.
        const qty = randInt(1, 3);
        scene.addToInv('rockfruit', qty);
        if (Math.random() < 0.20) scene.addToInv('coal', 1);
        let flashId = 'rockfruit';
        for (let t = 2; t <= 7; t++) {
          if (Math.random() < 1 / (2 * t * t)) {
            const bar = BARS[t];
            if (bar) { scene.addToInv(bar, 1); flashId = bar; }
          }
        }
        persistSave(save);
        const item = ITEM_BY_ID[flashId];
        scene.flashLoot(`+1 ${item?.name || flashId}`, '#a7ffb0', 1, flashId);
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
      if (gems && Math.random() < (GEM_P_BY_TIER[t] || 0)) {
        const gemId = pickFromArray(gems);
        scene.addToInv(gemId, 1);
        flashId = gemId;
        gemsFound++;
      }
      // T7 rocks have a bonus 25% chance for a second ruby on top.
      if (t === 7 && Math.random() < 0.25) {
        scene.addToInv('ruby', 1);
        flashId = 'ruby';
        gemsFound++;
      }
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
  // via `custom`. A planted sapling must mature (~12m) before its first pick,
  // and each tree fruits once per 24h.
  fruittree: {
    custom: (ctx, o) => {
      const { scene, save, sx, sy } = ctx;
      const FRUIT_RESPAWN_MS = 24 * 60 * 60 * 1000;   // one harvest per 24h
      // A planted sapling can't be harvested until it has matured (reached its
      // fruiting stage). ~12 min sprout→fruit (4 × 3-min stages).
      if (o.planted) {
        const FRUIT_STAGE_MS = 3 * 60 * 1000;
        const elapsed = Date.now() - (o.planted_t || 0);
        if (elapsed < 4 * FRUIT_STAGE_MS) {
          const minsLeft = Math.max(1, Math.ceil((4 * FRUIT_STAGE_MS - elapsed) / 60000));
          scene.flash(`Still growing — ${minsLeft}m`, sx, sy);
          return true;
        }
      }
      save.fruitPicked = save.fruitPicked || {};
      const pickedAt = save.fruitPicked[o.id];
      if (pickedAt && Date.now() - pickedAt < FRUIT_RESPAWN_MS) {
        const msLeft = FRUIT_RESPAWN_MS - (Date.now() - pickedAt);
        const hrsLeft = Math.ceil(msLeft / 3600000);
        const left = hrsLeft > 1 ? `${hrsLeft}h` : `${Math.max(1, Math.ceil(msLeft / 60000))}m`;
        scene.flash(`Picked — ripe again in ${left}`, sx, sy);
        return true;
      }
      save.fruitPicked[o.id] = Date.now();
      scene.addToInv(o.species, randInt(1, 2));
      ctx.dirty = true;
      const item = ITEM_BY_ID[o.species];
      scene.flashLoot(`harvested ${item?.name || o.species}`, '#a7ffb0', 1, o.species);
      // Rare shiny fruit tree — 10× fruit value in cash + a discovery point.
      if (isShiny(o.id, SHINY_RATE.tree)) scene.awardShinyBonus(o.species, sx, sy);
      return true;
    },
  },
};

// Generic driver for a registered interactable. Returns:
//   'skip'  — caller should `continue` to the next object (spent + spentAction
//             'skip', e.g. a chopped tree stump that shouldn't block the cell)
//   true    — the tap was consumed (gate blocked, work started, or custom done)
//   false   — `o.kind` is not registered (caller falls through to other blocks)
function runInteractable(ctx, o) {
  const def = INTERACTABLES[o.kind];
  if (!def) return false;
  const { scene, save, sx, sy } = ctx;

  if (def.spent && def.spent(o, ctx)) {
    return def.spentAction === 'skip' ? 'skip' : true;
  }
  // Non-tool interactables (fruit harvest, …) own their whole flow.
  if (def.custom) return def.custom(ctx, o);

  // Tool pipeline: gate → spend energy → start the tier-driven work wheel.
  const blockMsg = def.gate ? def.gate(o, save) : null;
  if (blockMsg) { scene.flash(blockMsg, sx, sy); return true; }

  const cost = def.energy ? def.energy(save, o) : 0;
  const durMs = (typeof toolDurationMs === 'function')
    ? toolDurationMs(save.relics, def.tool)
    : (save.relics?.[def.tool] ? 3000 : 9000);
  if (cost && !scene.spendEnergy(cost, sx, sy)) return true;   // can't afford — tap consumed
  // cost is passed through as the refund amount if the player cancels mid-work.
  scene.startWorkProgress(o.x, o.y, () => def.complete(ctx, o), durMs, cost || 0, def.tool);
  return true;
}
