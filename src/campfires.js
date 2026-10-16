// Placed campfires burn for one real day, including time spent offline.
// Keep the saved row after it burns out: it becomes a smoking, relightable pit.
(function (root) {
  'use strict';
  const LIFETIME_MS = 24 * 60 * 60 * 1000;

  function light(fire, now = Date.now()) {
    fire.litAt = now;
    return fire;
  }

  function active(fire, now = Date.now()) {
    // Untimed legacy rows remain lit until save normalization dates them once.
    return !!fire && (!Number.isFinite(fire.litAt) || now - fire.litAt < LIFETIME_MS);
  }

  function migrate(save, now = Date.now()) {
    let changed = false;
    for (const fire of save.fires || []) {
      if (fire && !Number.isFinite(fire.litAt)) {
        light(fire, now);
        changed = true;
      }
    }
    return changed;
  }

  const api = { LIFETIME_MS, light, active, migrate };
  root.Campfires = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
