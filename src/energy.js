// Energy core — pure energy math extracted from app.js so the cap / spend /
// offline-rest / tired-threshold rules are testable headlessly (no scene, no DOM).
//
// The scene keeps thin wrappers (app.js getMaxEnergy / spendEnergy /
// applyOfflineRest / _warnIfTiring) that own the side effects a core must not:
// updateEnergyDOM, the 'too tired' / 'getting tired…' flashes, and the
// energy-gain splash.
//
// Depends on globals from items.js: maxEnergyFromArmor, STARTING_ENERGY.

(function (root) {
  'use strict';

  // Wall-time gap that fully refills energy while away (1 hour). Lived in app.js
  // as a top-level const; only applyOfflineRest reads it, so it moves here with
  // the formula it belongs to.
  const OFFLINE_FULL_REST_MS = 60 * 60 * 1000;

  // Always derive the cap from currently-equipped armor (rather than a stale
  // save.maxEnergy that may pre-date the latest armor change), writing it back
  // so the UI and writers agree. Falls back to save.maxEnergy / STARTING_ENERGY.
  //
  // On top of the armor cap rides the FIRST-TASTE bonus: +1 max energy for
  // every distinct edible the player has ever eaten (save.eaten, appended by
  // app.js eatSelected). Folded in here — the one place the cap is derived —
  // so every reader and writer sees the same number.
  function maxEnergy(save) {
    const fromArmor = (typeof maxEnergyFromArmor === 'function')
      ? maxEnergyFromArmor(save.armor) : null;
    const tasted = Array.isArray(save.eaten) ? save.eaten.length : 0;
    if (fromArmor != null) { save.maxEnergy = fromArmor + tasted; return save.maxEnergy; }
    return save.maxEnergy ?? (typeof STARTING_ENERGY !== 'undefined' ? STARTING_ENERGY : 100);
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
    // Refresh save.maxEnergy from equipped armor first so the tired line is
    // computed against the current cap, not a value left stale by an armor
    // change since the last maxEnergy() call.
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

  // Convert an offline/background gap (ms) into restored energy. Mutates
  // save.energy, returns the amount gained (0 if none) so the wrapper can decide
  // whether to redraw / splash.
  //
  // Hard mode caps how FULL a night away can leave you (Difficulty
  // .offlineRestCapFrac, 0.5): the rest still refills at the same rate, it
  // just stops at half the bar. It never takes energy — a player who saved
  // above the cap wakes with what they had.
  function applyOfflineRest(save, gapMs) {
    if (!(gapMs > 0)) return 0;
    const maxE = maxEnergy(save);
    const restored = Math.floor(maxE * (gapMs / OFFLINE_FULL_REST_MS));
    if (restored <= 0) return 0;
    const before = save.energy ?? 0;
    const capFrac = (typeof Difficulty !== 'undefined') ? Difficulty.get().offlineRestCapFrac : 1;
    const cap = Math.max(before, Math.floor(maxE * capFrac));
    save.energy = Math.min(cap, before + restored);
    return save.energy - before;
  }

  root.Energy = { OFFLINE_FULL_REST_MS, maxEnergy, tiredThreshold, crossedTired, spend, applyOfflineRest };
})(typeof globalThis !== 'undefined' ? globalThis : this);
