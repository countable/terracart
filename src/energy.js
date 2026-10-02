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
  function maxEnergy(save, now = Date.now()) {
    const base = (typeof STARTING_ENERGY !== 'undefined') ? STARTING_ENERGY : 100;
    let tasted = 0;
    if (Array.isArray(save.eaten)) for (const id of new Set(save.eaten)) tasted += tasteBonus(id);
    const vigour = Math.max(0, Math.floor(Number(save.vigourUpgrades) || 0));
    // A Stamina hall's levels and drill (Combat.trainingBonus 'energy').
    const trained = (typeof Combat !== 'undefined' && Combat.trainingBonus) ? Combat.trainingBonus(save, 'energy') : 0;
    // Giant and Shrinking: the same capacity rule as any creature (PotionEffects).
    const potions = typeof PotionEffects !== 'undefined';
    const giant = potions ? PotionEffects.maxHpBonus(save, now) : 0;
    const shrinking = potions ? PotionEffects.maxHpMul(save, now) : 1;
    save.maxEnergy = Math.max(1, Math.ceil((base + tasted + vigour * VIGOUR_ENERGY_STEP + trained + giant) * shrinking));
    return save.maxEnergy;
  }

  // Giant's expiry removes temporary headroom, never heals or leaves excess HP.
  function expireGiant(save, now = Date.now()) {
    if (!(save.giantPotionUntil > 0) || save.giantPotionUntil > now) return false;
    delete save.giantPotionUntil;
    set(save, save.energy, maxEnergy(save, now));
    return true;
  }

  // Regaining ordinary size restores capacity, not spent HP.
  function expireShrinking(save, now = Date.now()) {
    if (!(save.shrinkingPotionUntil > 0) || save.shrinkingPotionUntil > now) return false;
    delete save.shrinkingPotionUntil;
    maxEnergy(save, now);
    return true;
  }

  // "Tired" warning threshold (30% of max). Crossing it flashes a heads-up so
  // running down toward 0 energy (where you can't reach at all) isn't a silent
  // surprise. Reads save.maxEnergy; callers that need the live cap should
  // refresh it via maxEnergy(save) first (crossedTired does).
  function tiredThreshold(save) {
    return 0.30 * (save.maxEnergy ?? 100);
  }

  // Did a drain from `before` to the current save.energy cross into "tired"?
  // False while a reach potion or Dawnfruit pins the full view (nothing shrinks).
  function crossedTired(save, before, now = Date.now()) {
    if (fullViewReachActive(save, now)) return false;
    // Refresh save.maxEnergy first so the tired line is computed against the
    // current cap, not a value left stale since the last maxEnergy() call.
    maxEnergy(save);
    const tired = tiredThreshold(save);
    return before >= tired && (save.energy ?? 0) < tired;
  }

  function dawnfruitActive(save, now = Date.now()) {
    return (save?.dawnfruitUntil ?? 0) > now;
  }
  // Reach, lighting and the tired warning agree on a fully lit view.
  function fullViewReachActive(save, now = Date.now()) {
    return (save?.reachPotionUntil ?? 0) > now || dawnfruitActive(save, now);
  }

  // THE ONE WRITER of save.energy. Energy is a WHOLE number: the bar, the
  // pops and every gate read it as one. Blows are not - attacker power scales
  // them first, then Combat.playerDamage applies armour and the recipient's
  // incomingDamageMul, so a raw `save.energy = before - dmg` left saves on
  // 99.948…⚡. Every write goes
  // through here: rounded, floored at 0, and capped at `maxE` when the caller
  // passes one (a gain; a loss needs no cap). A non-finite value keeps the
  // current reading rather than poisoning the save with NaN. Returns the new
  // value. Per-frame fractional drains still bank whole pips in their own
  // accumulators first (the rests, the trap bleed) — rounding them here each
  // frame would erase them. test/node/energy_int.test.js fails on any raw
  // write outside this module.
  function set(save, value, maxE) {
    const cur = Number.isFinite(save.energy) ? save.energy : 0;
    let v = Number.isFinite(value) ? Math.round(value) : Math.round(cur);
    if (Number.isFinite(maxE)) v = Math.min(Math.round(maxE), v);
    save.energy = Math.max(0, v);
    return save.energy;
  }

  // Spend `cost`. Mutates save.energy only on success. Returns:
  //   ok    — false iff the player can't afford it (no mutation)
  //   before— energy reading before the drain (for a tired-threshold check)
  //   spent — energy actually deducted (0 when cost<=0)
  function spend(save, cost) {
    const before = save.energy ?? 0;
    if (cost <= 0) return { ok: true, before, spent: 0 };
    if (before < cost) return { ok: false, before, spent: 0 };
    set(save, before - cost);
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
    set(save, before + restored, maxE);
    return save.energy - before;
  }

  // Frame-time regeneration, with fractional pips kept only in memory. A
  // suspended frame earns at most a quarter second, never offline catch-up.
  // Wall time clips the final frame at the boon deadline.
  function tickShrineRegen(save, state, dt, now = Date.now()) {
    const until = Number(save?.boonUntil?.regen) || 0;
    const elapsed = Math.max(0, Math.min(0.25, Number(dt) || 0));
    const activeSeconds = Math.max(0, Math.min(elapsed, (until - (now - elapsed * 1000)) / 1000));
    const maxE = maxEnergy(save);
    if (!activeSeconds || (save.energy ?? 0) >= maxE) {
      state._shrineRegenAcc = 0;
      return 0;
    }
    const rate = typeof Shrines !== 'undefined' ? Shrines.REGEN_PER_SECOND : 0;
    const accrued = (state._shrineRegenAcc || 0) + activeSeconds * rate;
    const whole = Math.floor(accrued + 1e-9);
    state._shrineRegenAcc = Math.max(0, accrued - whole);
    if (!whole) return 0;
    const before = save.energy ?? 0;
    set(save, before + whole, maxE);
    if (save.energy >= maxE) state._shrineRegenAcc = 0;
    return save.energy - before;
  }

  // A fish's FOOD_ENERGY is its total over three minutes, never an instant
  // restore. Fishing's species table also owns which grilled dishes are fish.
  const FISH_REGEN_MS = 3 * 60 * 1000;
  function fishRegenTotal(id) {
    return FISH_SPECIES.some(f => f.id === id || COOKED_FOODS[f.id]?.id === id)
      ? FOOD_ENERGY[id] : 0;
  }
  function fishRegenWait(save, id, now = Date.now()) {
    const total = fishRegenTotal(id), buff = save?.fishRegen;
    return total && buff?.total > total ? Math.max(0, buff.until - now) : 0;
  }
  function startFishRegen(save, id, now = Date.now()) {
    const total = fishRegenTotal(id);
    if (!total || fishRegenWait(save, id, now)) return false;
    // One dose at a time. Equal/stronger meals replace the remaining dose;
    // weaker meals cannot extend a stronger fish's rate with cheap food.
    save.fishRegen = { total, startedAt: now, until: now + FISH_REGEN_MS, paid: 0 };
    return true;
  }
  function tickFishRegen(save, now = Date.now()) {
    const buff = save?.fishRegen;
    if (!buff) return 0;
    // Cumulative whole pips preserve fractions across reloads and finish the
    // final pip even when a frame crosses expiry. Persist this alongside energy
    // so a resumed session pays only the as-yet-uncredited elapsed portion.
    const elapsed = Math.max(0, Math.min(FISH_REGEN_MS, now - buff.startedAt));
    const due = Math.floor(buff.total * elapsed / FISH_REGEN_MS + 1e-9);
    const whole = Math.max(0, due - buff.paid);
    buff.paid = Math.max(buff.paid, due);
    if (now >= buff.until) delete save.fishRegen;
    if (!whole) return 0;
    const before = save.energy ?? 0;
    set(save, before + whole, maxEnergy(save));
    // Healing that arrives at a full bar is spent, never banked for later.
    return save.energy - before;
  }

  // The floor a revive lifts an empty bar to. REVIVE_FRAC (a quarter) is
  // Home's: arriving there on hard with nothing left. A revival potion
  // (items.js REVIVE_ITEM_FRAC) passes its own `frac`; the Crow Feather is a
  // flat FEATHER_REVIVE_ENERGY and never comes here. ROUNDED either way: energy is a whole number
  // everywhere (spends, rests, blows), and a bare maxE * 0.25 left a player
  // on 22.25⚡ after reviving at 89.
  const REVIVE_FRAC = 0.25;
  function reviveLevel(maxE, frac = REVIVE_FRAC) {
    return Math.max(1, Math.round((maxE || 0) * frac));
  }

  root.Energy = { set, expireGiant, expireShrinking, dawnfruitActive, fullViewReachActive, tickShrineRegen, FISH_REGEN_MS, fishRegenTotal, fishRegenWait, startFishRegen, tickFishRegen, VIGOUR_ENERGY_STEP, REVIVE_FRAC, reviveLevel, OFFLINE_FULL_REST_MS, EAT_COOLDOWN_MS, maxEnergy, tasteBonus, tiredThreshold, crossedTired,
                  spend, applyOfflineRest, eatCooldownLeft, canEat, startEatCooldown };
})(typeof globalThis !== 'undefined' ? globalThis : this);
