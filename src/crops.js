// Crops core — pure crop growth / watering / pest rules extracted from app.js
// so the timing math is testable headlessly (no scene, no DOM).
//
// This is also the single source of truth for STAGE_HOLD_MS, which used to be
// copy-pasted (with a "keep in sync" comment) into app.js, render.js and
// interact.js. Those now reference Crops.STAGE_HOLD_MS.
//
// The scene keeps thin wrappers (app.js advanceGrowth / waterCropsWithin /
// crowEatsCrop) that own the side effects: persistSave and reading the player's
// world position.
//
// Crop model: save.planted is a list of { x, y, crop, stage, watered_t }.
//   stage 0..MAX_GROWTH_STAGE (mature); each stage needs one watering then a
//   STAGE_HOLD_MS hold before it advances.
//
// Depends on the global MAX_GROWTH_STAGE (items.js).

(function (root) {
  'use strict';

  const STAGE_HOLD_MS = 15 * 60 * 1000;          // 15 min per growth stage
  const CROW_IGNORED_CROPS = new Set(['potato']); // crows never notice potatoes

  function maxStage() {
    return (typeof MAX_GROWTH_STAGE !== 'undefined') ? MAX_GROWTH_STAGE : 4;
  }

  // Fully grown? (at or past the final stage)
  function isMature(p) {
    return (p?.stage ?? 0) >= maxStage();
  }

  // Will a crow notice / orbit / land on / eat this crop? (potatoes are immune)
  function crowEats(p) {
    return !CROW_IGNORED_CROPS.has(p?.crop);
  }

  // Advance every watered crop whose STAGE_HOLD_MS hold has elapsed by ONE
  // stage; after advancing it needs re-watering (watered_t reset to 0), so a
  // single call advances each plant by at most one stage and a long-idle plant
  // catches up over subsequent waterings rather than all at once. Mutates
  // save.planted; returns true iff anything changed.
  function advanceGrowth(save, now = Date.now()) {
    let mutated = false;
    for (const p of save.planted || []) {
      if (!p.watered_t) continue;
      if ((p.stage ?? 0) >= maxStage()) continue;
      if (now - p.watered_t < STAGE_HOLD_MS) continue;
      p.stage = (p.stage ?? 0) + 1;
      p.watered_t = 0;
      mutated = true;
    }
    return mutated;
  }

  // Water every planted crop within `radius` metres of world point (pwx, pwy):
  // sets watered_t = now on crops that aren't already watered or mature. Returns
  // the number watered.
  function waterWithin(save, pwx, pwy, radius, now = Date.now()) {
    const r2 = radius * radius;
    let n = 0;
    for (const p of save.planted || []) {
      const dx = p.x - pwx, dy = p.y - pwy;
      if (dx * dx + dy * dy > r2) continue;
      if ((p.stage ?? 0) >= maxStage()) continue;
      if (p.watered_t) continue;
      p.watered_t = now;
      n++;
    }
    return n;
  }

  root.Crops = { STAGE_HOLD_MS, maxStage, isMature, crowEats, advanceGrowth, waterWithin };
})(typeof globalThis !== 'undefined' ? globalThis : this);
