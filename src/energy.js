// Energy core — pure energy math extracted from app.js so the cap / spend /
// offline-rest / tired-threshold / bite-cooldown rules are testable headlessly (no
// scene, no DOM).
//
// The scene keeps thin wrappers (app.js getMaxEnergy / spendEnergy /
// applyOfflineRest / _warnIfTiring) that own the side effects a core must not:
// updateEnergyDOM, the 'too tired' / 'getting tired…' flashes, and the
// energy-gain splash.
//
// Depends on globals from items.js: STARTING_ENERGY, ITEM_BY_ID.

(function (root) {
  'use strict';

  // Wall-time gap that fully refills energy while away (1 hour). Lived in app.js
  // as a top-level const; only applyOfflineRest reads it, so it moves here with
  // the formula it belongs to.
  const OFFLINE_FULL_REST_MS = 60 * 60 * 1000;

  // The cap is STARTING_ENERGY plus the FIRST-TASTE bonus: every distinct
  // edible the player has ever eaten (save.eaten, appended by app.js
  // eatSelected) adds its FOOD TIER (tasteBonus — the item's baseTier, the
  // same 1..7 rarity the loot tables roll), so a first potato is +1 and a
  // first iceflower +6, plus the wizard's VIGOUR rungs (below). Derived fresh every call and written back, so a stale
  // save.maxEnergy — one banked when armour still raised the cap, say — can
  // never outlive the rule.
  //
  // ARMOUR IS NOT IN HERE ANY MORE. Until Sep 2026 each worn piece added
  // `energyPerTier × tier` to this number, so a full set was simply a longer
  // bar: it helped identically whether or not anything was hitting you, and a
  // player who never fought got exactly as much out of a Frost chestplate as
  // one who did. Armour now soaks the damage an attack takes off the bar
  // instead (items.js armorReduction, spent by Combat.mitigate). If you are
  // about to fold a gear bonus back into the cap, that is the bug returning.
  //
  // VIGOUR is in here: the wizard tower's cheap track (src/wizard.js,
  // save.vigourUpgrades) buys VIGOUR_ENERGY_STEP more cap a rung. It is a
  // bought, permanent rung of the body, not gear — nothing worn or held
  // changes it. The wizard owns how many rungs there are; this owns what one
  // is worth.
  const VIGOUR_ENERGY_STEP = 10;
  // What a FIRST taste of `id` adds to the cap: its food tier. One number the
  // cap (maxEnergy) and the eat flash (app.js eatSelected) both read.
  function tasteBonus(id) {
    const it = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID[id] : null;
    return Math.max(1, Math.floor(Number(it?.baseTier) || 1));
  }
  function maxEnergy(save) {
    const base = (typeof STARTING_ENERGY !== 'undefined') ? STARTING_ENERGY : 100;
    let tasted = 0;
    if (Array.isArray(save.eaten)) for (const id of new Set(save.eaten)) tasted += tasteBonus(id);
    const vigour = Math.max(0, Math.floor(Number(save.vigourUpgrades) || 0));
    save.maxEnergy = base + tasted + vigour * VIGOUR_ENERGY_STEP;
    return save.maxEnergy;
  }

  // "Tired" warning threshold (30% of max). Crossing it flashes a heads-up so
  // running down toward 0 energy (where you can't reach at all) isn't a silent
  // surprise. Reads save.maxEnergy; callers that need the live cap should
  // refresh it via maxEnergy(save) first (crossedTired does).
  function tiredThreshold(save) {
    return 0.30 * (save.maxEnergy ?? 100);
  }

  // Did a drain from `before` to the current save.energy cross into "tired"?
  // False while a Potion of Reach pins reach to the full view (nothing shrinks).
  function crossedTired(save, before, now = Date.now()) {
    if ((save.reachPotionUntil ?? 0) > now) return false;
    // Refresh save.maxEnergy first so the tired line is computed against the
    // current cap, not a value left stale since the last maxEnergy() call.
    maxEnergy(save);
    const tired = tiredThreshold(save);
    return before >= tired && (save.energy ?? 0) < tired;
  }

  // Spend `cost`. Mutates save.energy only on success. Returns:
  //   ok    — false iff the player can't afford it (no mutation)
  //   before— energy reading before the drain (for a tired-threshold check)
  //   spent — energy actually deducted (0 when cost<=0)
  function spend(save, cost) {
    const before = save.energy ?? 0;
    if (cost <= 0) return { ok: true, before, spent: 0 };
    if (before < cost) return { ok: false, before, spent: 0 };
    save.energy = Math.max(0, before - cost);
    return { ok: true, before, spent: before - save.energy };
  }

  // ── The bite cooldown ────────────────────────────────────────────────────
  // Ten seconds between mouthfuls. Eating was the one energy source with no
  // pacing at all: a stack of thirty potatoes was 240⚡ delivered as fast as a
  // finger could tap the Eat button, so a full bag made every cost in the game
  // — the till, the chop, the fight — a rounding error. The cooldown doesn't
  // change what a food is worth, only how fast a bag of them can be poured in.
  //
  // POTIONS ARE EXEMPT, and they are exempt BY CONSTRUCTION rather than by an
  // id list here: a potion is drunk through its own button (app.js
  // syncConsumableButton → drinkVigorPotion and friends), which never touches
  // this gate. Nothing that goes through eatSelected is exempt — including the
  // hard-mode Crow Feather revive, which is a mouthful like any other.
  //
  // The deadline is stored on the SAVE (save.eatReadyAt), not in memory beside
  // the dragon/torch timers: those are buffs a refresh costs you, and a gate a
  // refresh clears is not a gate.
  const EAT_COOLDOWN_MS = 10 * 1000;

  // Ms left before the next bite, 0 when one is ready. Clamped to the cooldown
  // itself so a save carrying a far-future deadline (a clock the player wound
  // back, a hand-edited save) reads as a ten-second wait rather than locking
  // the button out for hours.
  function eatCooldownLeft(save, now = Date.now()) {
    const left = (save.eatReadyAt ?? 0) - now;
    return left > 0 ? Math.min(left, EAT_COOLDOWN_MS) : 0;
  }

  // The gate itself. One expression, two readers: eatSelected refuses on it and
  // the Eat button greys itself on it, so what the button shows and what the
  // tap does can't drift apart.
  function canEat(save, now = Date.now()) {
    return eatCooldownLeft(save, now) <= 0;
  }

  // Arm the cooldown. Called by eatSelected once a bite has actually landed —
  // never on a refusal, which would let a blocked tap extend its own block.
  function startEatCooldown(save, now = Date.now()) {
    save.eatReadyAt = now + EAT_COOLDOWN_MS;
    return save.eatReadyAt;
  }

  // Convert an offline/background gap (ms) into restored energy. Mutates
  // save.energy, returns the amount gained (0 if none) so the wrapper can decide
  // whether to redraw / splash.
  function applyOfflineRest(save, gapMs) {
    if (!(gapMs > 0)) return 0;
    const maxE = maxEnergy(save);
    const restored = Math.floor(maxE * (gapMs / OFFLINE_FULL_REST_MS));
    if (restored <= 0) return 0;
    const before = save.energy ?? 0;
    save.energy = Math.min(maxE, before + restored);
    return save.energy - before;
  }

  // The floor a revive lifts an empty bar to. REVIVE_FRAC (a quarter) is
  // Home's: arriving there on hard with nothing left. An item that revives
  // (the Crow Feather, the revival potions — items.js REVIVE_ITEM_FRAC)
  // passes its own `frac`. ROUNDED either way: energy is a whole number
  // everywhere (spends, rests, blows), and a bare maxE * 0.25 left a player
  // on 22.25⚡ after reviving at 89.
  const REVIVE_FRAC = 0.25;
  function reviveLevel(maxE, frac = REVIVE_FRAC) {
    return Math.max(1, Math.round((maxE || 0) * frac));
  }

  root.Energy = { VIGOUR_ENERGY_STEP, REVIVE_FRAC, reviveLevel, OFFLINE_FULL_REST_MS, EAT_COOLDOWN_MS, maxEnergy, tasteBonus, tiredThreshold, crossedTired,
                  spend, applyOfflineRest, eatCooldownLeft, canEat, startEatCooldown };
})(typeof globalThis !== 'undefined' ? globalThis : this);
