// Conditions count foreground gameplay time, never wall-clock/offline time.
(function (root) {
  'use strict';
  // THE ONE TABLE OF STATUS EFFECTS. Each row is the player's own condition
  // (apply / tick below, off the save) AND, for a row a foe can carry, the
  // foe's (combat.js ignite / burnTick read `burning` live), so the two can
  // never burn at different rates. The row also owns how it LOOKS — `tint`
  // multiplies the afflicted body (app.js player tint, render.js creature
  // tint; a burn flickers, a poison holds), `label` / `ink` / `bg` are the
  // HUD chip in the status row under the HUD (app.js _syncStatusRow) — one row for
  // mechanics, copy and colour. A new status is a row here, never a timer of
  // its own.
  // Table order is priority: the first active row tints the body (app.js
  // _updatePlayerAura) and leads the status row.
  //   burning — fire on the body (owner, Oct 2026): a lit Torch's melee blow
  //             (foes), a campfire stood in or lava, foe and player alike —
  //             gains 5 s per second of exposure, up to 60 s; counts down
  //             away from fire. Each second costs floor(remaining seconds / 10)
  //             (burnTickLoss).
  //   poison  — a purple slime or spider's bite: 1 energy every 2 s for a minute; an
  //             Antidote or Elixir draws it out.
  //   pinned  — a sprung trap's jaw (app.js _tickTraps): the body holds still
  //             (_bodyHold) for the row's duration; no drain of its own (the
  //             trap's bleed is the trap's). Antidote / Elixir pry it open.
  const DEFINITIONS = Object.freeze({
    burning: Object.freeze({ durationMs: 5000, maxDurationMs: 60000, exposureRate: 5, intervalMs: 1000, energyLoss: 1,
      label: 'Burning', tint: 0xff8c42, flicker: true, ink: '#ffb36b', bg: '#2e1a0ee8' }),
    poison: Object.freeze({ durationMs: 60000, intervalMs: 2000, energyLoss: 1,
      label: 'Poison', tint: 0x9fdc8c, flicker: false, ink: '#d9b1ff', bg: '#22132ee8' }),
    confused: Object.freeze({ durationMs: 10000,
      label: 'Confused', tint: 0xc68ee8, flicker: false, ink: '#e8c2ff', bg: '#321b40e8' }),
    jellyfish_stun: Object.freeze({ durationMs: 5000, attackSpeedMul: 0.5,
      label: 'Stunned', tint: 0x89d9ff, flicker: false, ink: '#b9eaff', bg: '#102a3ae8' }),
    pinned: Object.freeze({ durationMs: 3000,
      label: 'Pinned', tint: 0xb8bcc8, flicker: false, ink: '#d6dae6', bg: '#1c1f28e8' }),
  });
  const CONTEXT_STATUS = Object.freeze({
    slowed: Object.freeze({ label: 'Slowed', ink: '#d6dae6', bg: '#1c1f28e8' }),
  });
  function normalize(save) {
    save.fireDamageRemainder = fireRemainder(save);
    const old = save.conditions || {};
    save.conditions = {};
    for (const [id, def] of Object.entries(DEFINITIONS)) {
      const state = old[id];
      if (!state || !Number.isFinite(state.remainingMs) || state.remainingMs <= 0) continue;
      save.conditions[id] = { remainingMs: Math.min(def.maxDurationMs || def.durationMs, state.remainingMs) };
      if (def.intervalMs) save.conditions[id].nextTickMs = Number.isFinite(state.nextTickMs)
        ? Math.max(0, Math.min(def.intervalMs, state.nextTickMs)) : def.intervalMs;
    }
    return save.conditions;
  }
  function active(save, id) { return (save?.conditions?.[id]?.remainingMs || 0) > 0; }
  function attackIntervalMul(save) {
    return active(save, 'jellyfish_stun') ? 1 / DEFINITIONS.jellyfish_stun.attackSpeedMul : 1;
  }
  function fireRemainder(save) {
    const value = save.fireDamageRemainder;
    return Number.isFinite(value) && value >= 0 && value < 1 ? value : 0;
  }
  function damageImmune(save, now = Date.now()) {
    return (save.immortalPotionUntil || 0) > now;
  }
  function fireImmune(save, now = Date.now()) {
    return damageImmune(save, now) || (save.fireResistancePotionUntil || 0) > now;
  }
  // Energy is integral. Carry fractional fire loss between hits and saves so
  // resistance still works against small ticks; zero damage never discharges it.
  function fireDamage(save, raw, now = Date.now()) {
    if (fireImmune(save, now)) {
      save.fireDamageRemainder = 0;
      return 0;
    }
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    save.fireDamageRemainder = fireRemainder(save);
    return bankWhole(save, 'fireDamageRemainder', raw * jewelryFireDamageMul(save));
  }
  // Does the row's tint show at this instant? A `flicker` row alternates
  // every FLICKER_MS (a burn licks); a steady row always shows. One clock for
  // the player's body and every burning foe, so they flicker in step.
  const FLICKER_MS = 120;
  function conditionTintOn(id, now) {
    const def = DEFINITIONS[id];
    if (!def) return false;
    return !def.flicker || Math.floor(now / FLICKER_MS) % 2 === 0;
  }
  function apply(save, id, now = Date.now()) {
    const def = DEFINITIONS[id];
    if (!def) return false;
    if (id === 'burning' && fireImmune(save, now)) return false;
    // A Toad Idol's boon (src/shrines.js 'antidote'): poison cannot take hold.
    if (id === 'poison' && root.Shrines && root.Shrines.leverActive(save, 'antidote')) return false;
    const fresh = !active(save, id);
    save.conditions ||= {};
    if (fresh) save.conditions[id] = def.intervalMs
      ? { remainingMs: def.durationMs, nextTickMs: def.intervalMs } : { remainingMs: def.durationMs };
    else if (id !== 'burning') save.conditions[id].remainingMs = def.durationMs;
    return fresh;
  }
  function cure(save, id) {
    if (!active(save, id)) return false;
    delete save.conditions[id];
    return true;
  }
  // Pure clock shared by player and units. Advance to each damage boundary so
  // a delayed frame pays exactly what individual one-second updates would.
  function advanceBurn(state, elapsedMs, exposed = false) {
    const def = DEFINITIONS.burning;
    let remainingMs = Math.max(0, Math.min(def.maxDurationMs, state.remainingMs || 0));
    let nextTickMs = Number.isFinite(state.nextTickMs)
      ? Math.max(0, Math.min(def.intervalMs, state.nextTickMs)) : def.intervalMs;
    let elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    let ticks = 0, damage = 0;
    while (elapsed > 0 && remainingMs > 0) {
      const step = Math.min(elapsed, nextTickMs, exposed ? Infinity : remainingMs);
      remainingMs = exposed ? Math.min(def.maxDurationMs, remainingMs + step * def.exposureRate)
        : Math.max(0, remainingMs - step);
      elapsed -= step;
      nextTickMs -= step;
      if (nextTickMs <= 0) {
        damage += burnTickLoss(remainingMs);
        ticks++;
        nextTickMs = def.intervalMs;
      }
    }
    return { remainingMs, nextTickMs, ticks, damage };
  }
  // What the next burn tick costs with this much time left (per intervalMs):
  // the charge advanceBurn levies, and what the HUD chip prints — one formula.
  function burnTickLoss(remainingMs) {
    return DEFINITIONS.burning.energyLoss * Math.floor(Math.max(0, remainingMs || 0) / 10000);
  }
  function tick(save, elapsedMs, options = {}) {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return { ticks: 0, lost: 0, expired: false };
    const before = save.energy ?? 0;
    let ticks = 0;
    let expired = false;
    const now = options.now ?? Date.now();
    if (fireImmune(save, now)) {
      expired = cure(save, 'burning');
      save.fireDamageRemainder = 0;
    }
    for (const [id, def] of Object.entries(DEFINITIONS)) {
      if (!active(save, id)) continue;
      const state = save.conditions[id];
      if (id === 'burning') {
        const result = advanceBurn(state, elapsedMs, !!options.burningExposure);
        state.remainingMs = result.remainingMs;
        state.nextTickMs = result.nextTickMs;
        Energy.set(save, (save.energy ?? 0) - fireDamage(save, result.damage, now));
        ticks += result.ticks;
        if (state.remainingMs <= 0) {
          delete save.conditions[id];
          expired = true;
        }
        continue;
      }
      const elapsed = Math.min(elapsedMs, state.remainingMs);
      state.remainingMs -= elapsed;
      if (def.intervalMs) state.nextTickMs -= elapsed;
      while (def.intervalMs && state.nextTickMs <= 0) {
        if (!damageImmune(save, now)) Energy.set(save, (save.energy ?? 0) - def.energyLoss);
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
  function hasDebuffs(save) {
    return Object.keys(DEFINITIONS).some(id => active(save, id));
  }
  // Conditions are harmful; positive timed effects live in Buffs and survive.
  // Prying a trap's pin open does not remove the trap or protect against
  // fresh contact with fire or hazardous terrain.
  function clearDebuffs(save) {
    let cleared = false;
    for (const id of Object.keys(DEFINITIONS)) {
      if (cure(save, id)) cleared = true;
    }
    return cleared;
  }
  function useAntidote(save) { return clearDebuffs(save); }
  function useElixir(save) {
    const max = Energy.maxEnergy(save);
    if (!(save.energy > 0) || (save.energy >= max && !hasDebuffs(save))) return false;
    Energy.set(save, max, max);
    clearDebuffs(save);
    return true;
  }
  root.Conditions = { DEFINITIONS, CONTEXT_STATUS, FLICKER_MS, conditionTintOn, normalize, active, attackIntervalMul, apply, cure, advanceBurn, burnTickLoss, damageImmune, fireImmune, fireDamage, tick, hasDebuffs, clearDebuffs, useAntidote, useElixir };
})(typeof globalThis !== 'undefined' ? globalThis : this);
