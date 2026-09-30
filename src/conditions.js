// Conditions count foreground gameplay time, never wall-clock/offline time.
(function (root) {
  'use strict';
  const DEFINITIONS = Object.freeze({
    poison: Object.freeze({ durationMs: 60000, intervalMs: 2000, energyLoss: 1 }),
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
  root.Conditions = { DEFINITIONS, normalize, active, apply, cure, tick, useAntidote, useElixir };
})(typeof globalThis !== 'undefined' ? globalThis : this);
