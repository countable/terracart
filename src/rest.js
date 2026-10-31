// A NIGHT'S REST — the one routine behind every bed: the Quilted Cot at Home
// and the Inn's paid bed (Macros.innRest). Both do exactly this, and only
// this (owner, Oct 2026: "the bed is the inn routine"):
//   · all missing energy comes back at once (Energy.set, the one writer);
//   · PASS_MS of the world's clocks pass — a watered crop is that much nearer
//     its next stage (and advances if its hold has run, one stage, as the
//     15-minute tick would — Crops.advanceGrowth), a planted tree and a
//     picked fruit tree are that much further grown back, cleared grass that
//     much nearer regrowth, and the player's own action gates (the bite, the
//     tome) that much nearer ready;
//   · and then NO BED — not this one, not an inn — until COOLDOWN_MS has
//     run (save.restedAt). The gate is the player's, not the bed's: an inn
//     after the cot refuses just as the cot after an inn does.
// Energy sleeps nothing else: buffs, conditions and the service ledgers keep
// their own clocks (a potion drunk before bed is not drunk away by it).
(function (root) {
  'use strict';

  const HOURS = 4;
  const PASS_MS = HOURS * 60 * 60 * 1000;
  const COOLDOWN_MS = PASS_MS;

  // Save fields holding ONE absolute epoch-ms deadline that the night brings
  // closer. Add a gate here, never a subtraction of its own beside it.
  const DEADLINES = ['eatReadyAt', 'tomeReadyAt'];
  // Save maps of `<id> → epoch ms` (save.js Ledger stamps, save_state
  // regrowth deadlines) whose every entry the night ages by the same amount.
  const LEDGERS = ['fruitPicked', 'grassRegrowth'];

  // Ms until a bed will take the player again, 0 when one will now. Clamped
  // to the cooldown so a wound-back clock reads as one wait, not days.
  function waitMs(save, now = Date.now()) {
    const at = save && save.restedAt;
    if (typeof at !== 'number' || !Number.isFinite(at)) return 0;
    return Math.max(0, Math.min(COOLDOWN_MS, at + COOLDOWN_MS - now));
  }

  function _age(map, ms) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    for (const k of Object.keys(map)) {
      if (typeof map[k] === 'number' && Number.isFinite(map[k])) map[k] -= ms;
    }
  }

  // Move every clock `ms` on. `moved` (optional array) is told which crops
  // advanced a stage and which planted trees aged, so the scene can burst a
  // 'sprout' on each and re-seat a live tree's planted_t (the live object
  // carries its own copy — scene_consumables completeStagesWithin does the
  // same after the Growth Powder). Returns how many moved.
  function passTime(save, ms = PASS_MS, now = Date.now(), moved = null) {
    if (!save || !(ms > 0)) return 0;
    let n = 0;
    for (const p of save.planted || []) {
      // watered_t 0 means "not watered": an aged stamp must stay truthy.
      if (p.watered_t) p.watered_t = Math.max(1, p.watered_t - ms);
    }
    const advanced = [];
    Crops.advanceGrowth(save, now, advanced);
    n += advanced.length;
    if (moved) moved.push(...advanced);
    for (const t of save.fruittrees || []) {
      if (!(t.planted_t > 0)) continue;
      t.planted_t -= ms;
      n++;
      if (moved) moved.push(t);
    }
    for (const field of LEDGERS) _age(save[field], ms);
    for (const field of DEADLINES) {
      if (typeof save[field] === 'number' && save[field] > now) save[field] = Math.max(now, save[field] - ms);
    }
    return n;
  }

  // The night: full energy, PASS_MS of clocks, and the shared gate armed.
  // Returns the energy gained. Callers refuse on waitMs, the zero-energy
  // lockout and a full tank BEFORE calling (and again at black — the sleep
  // fade is shared, scene_furniture _presentSleep); this does not re-check.
  function sleep(save, maxE, now = Date.now(), moved = null) {
    const before = save.energy ?? 0;
    Energy.set(save, maxE, maxE);
    passTime(save, PASS_MS, now, moved);
    save.restedAt = now;
    return (save.energy ?? 0) - before;
  }

  root.Rest = { HOURS, PASS_MS, COOLDOWN_MS, DEADLINES, LEDGERS, waitMs, passTime, sleep };
})(typeof globalThis !== 'undefined' ? globalThis : this);
