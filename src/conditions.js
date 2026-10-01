// Conditions count foreground gameplay time, never wall-clock/offline time.
(function (root) {
  'use strict';
  // THE ONE TABLE OF STATUS EFFECTS. Each row is the player's own condition
  // (apply / tick below, off the save) AND, for a row a foe can carry, the
  // foe's (combat.js ignite / burnTick read `burning` live), so the two can
  // never burn at different rates. The row also owns how it LOOKS — `tint`
  // multiplies the afflicted body (app.js player tint, render.js creature
  // tint; a burn flickers, a poison holds), `label` / `ink` / `bg` are the
  // HUD chip under the energy bar (app.js _syncConditionHUD) — one row for
  // mechanics, copy and colour. A new status is a row here, never a timer of
  // its own.
  //   poison  — a purple slime's bite: 1 energy every 2 s for a minute; only
  //             an Antidote (useAntidote) draws it out.
  //   burning — fire on the body (owner, Oct 2026): a lit Torch's melee blow
  //             (foes), a campfire stood in or lava, foe and player alike —
  //             1 a second for 5 s, then it goes out ON ITS OWN. No cure
  //             needed, none sold; a fresh contact restarts the 5 s.
  const DEFINITIONS = Object.freeze({
    poison: Object.freeze({ durationMs: 60000, intervalMs: 2000, energyLoss: 1,
      label: 'Poison', tint: 0x9fdc8c, flicker: false, ink: '#d9b1ff', bg: '#22132ee8' }),
    burning: Object.freeze({ durationMs: 5000, intervalMs: 1000, energyLoss: 1,
      label: 'Burning', tint: 0xff8c42, flicker: true, ink: '#ffb36b', bg: '#2e1a0ee8' }),
  });
  function normalize(save) {
    const old = save.conditions || {};
    save.conditions = {};
    for (const [id, def] of Object.entries(DEFINITIONS)) {
      const state = old[id];
      if (!state || !Number.isFinite(state.remainingMs) || state.remainingMs <= 0) continue;
      save.conditions[id] = {
        remainingMs: Math.min(def.durationMs, state.remainingMs),
        nextTickMs: Number.isFinite(state.nextTickMs)
          ? Math.max(0, Math.min(def.intervalMs, state.nextTickMs)) : def.intervalMs,
      };
    }
    return save.conditions;
  }
  function active(save, id) { return (save.conditions?.[id]?.remainingMs || 0) > 0; }
  // Does the row's tint show at this instant? A `flicker` row alternates
  // every FLICKER_MS (a burn licks); a steady row always shows. One clock for
  // the player's body and every burning foe, so they flicker in step.
  const FLICKER_MS = 120;
  function conditionTintOn(id, now) {
    const def = DEFINITIONS[id];
    if (!def) return false;
    return !def.flicker || Math.floor(now / FLICKER_MS) % 2 === 0;
  }
  function apply(save, id) {
    const def = DEFINITIONS[id];
    if (!def) return false;
    // A Toad Idol's boon (src/shrines.js 'antidote'): poison cannot take hold.
    if (id === 'poison' && root.Shrines && root.Shrines.leverActive(save, 'antidote')) return false;
    const fresh = !active(save, id);
    save.conditions ||= {};
    if (fresh) save.conditions[id] = { remainingMs: def.durationMs, nextTickMs: def.intervalMs };
    else save.conditions[id].remainingMs = def.durationMs;
    return fresh;
  }
  function cure(save, id) {
    if (!active(save, id)) return false;
    delete save.conditions[id];
    return true;
  }
  function tick(save, elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return { ticks: 0, lost: 0, expired: false };
    const before = save.energy ?? 0;
    let ticks = 0;
    let expired = false;
    for (const [id, def] of Object.entries(DEFINITIONS)) {
      if (!active(save, id)) continue;
      const state = save.conditions[id];
      const elapsed = Math.min(elapsedMs, state.remainingMs);
      state.remainingMs -= elapsed;
      state.nextTickMs -= elapsed;
      while (state.nextTickMs <= 0) {
        Energy.set(save, (save.energy ?? 0) - def.energyLoss);
        state.nextTickMs += def.intervalMs;
        ticks++;
      }
      if (state.remainingMs <= 0) {
        delete save.conditions[id];
        expired = true;
      }
    }
    return { ticks, lost: before - (save.energy ?? 0), expired };
  }
  // Item effects return a refusal without mutating inventory or the food gate.
  function useAntidote(save) { return cure(save, 'poison'); }
  function useElixir(save) {
    const max = Energy.maxEnergy(save);
    if (!(save.energy > 0) || save.energy >= max) return false;
    Energy.set(save, max, max);
    return true;
  }
  root.Conditions = { DEFINITIONS, FLICKER_MS, conditionTintOn, normalize, active, apply, cure, tick, useAntidote, useElixir };
})(typeof globalThis !== 'undefined' ? globalThis : this);
