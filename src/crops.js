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
  // save.planted; returns true iff anything changed. Pass an array as
  // `advanced` to be told WHICH plants moved — the scene bursts leaf flecks
  // on the ones in view (app.js advanceGrowth → _burstAtWorld 'sprout').
  function advanceGrowth(save, now = Date.now(), advanced = null) {
    let mutated = false;
    for (const p of save.planted || []) {
      if (!p.watered_t) continue;
      if ((p.stage ?? 0) >= maxStage()) continue;
      if (now - p.watered_t < STAGE_HOLD_MS) continue;
      p.stage = (p.stage ?? 0) + 1;
      p.watered_t = 0;
      mutated = true;
      if (advanced) advanced.push(p);
    }
    return mutated;
  }

  // ── The watering can, and what a better one is FOR ────────────────────
  // A can's tier is the CHANCE that a watering also jumps the plant a stage
  // there and then: nothing without a can, certain at Frost, straight-line in
  // between (Wood 1/7, Copper 2/7, … Frost 7/7).
  //
  // It buys TIME, which is the one thing a crop costs. Four waterings and four
  // STAGE_HOLD_MS waits stand between a seed and a harvest, and no relic
  // touched that — a Frost can watered exactly as fast as bare hands and only
  // improved the produce quality it came out with. Now the ladder is worth
  // climbing for the same reason the amulet is: at the top, a crop grows twice
  // as fast, because every watering is worth two.
  //
  // The jump does NOT consume the watering. The plant is watered AND a stage
  // further on, so its normal advance is still coming — that is what makes a
  // Frost can a doubling rather than a shortcut.
  const CAN_TOP_TIER = 7;               // Frost — the top of MATERIAL_TIERS
  function waterJumpChance(relics) {
    const t = relics && relics.can && relics.can.tier ? relics.can.tier : 0;
    return Math.max(0, Math.min(1, t / CAN_TOP_TIER));
  }

  // Apply a watering to ONE plant, including the can's jump roll. Returns
  // 'watered' | 'jumped' | null (null = it wasn't a candidate). Shared by the
  // tap handler and the area water below so the two cannot drift.
  function waterOne(save, p, relics, now = Date.now(), rng = Math.random) {
    if (!p || (p.stage ?? 0) >= maxStage()) return null;
    if (p.watered_t) return null;
    p.watered_t = now;
    if (rng() >= waterJumpChance(relics)) return 'watered';
    p.stage = (p.stage ?? 0) + 1;
    // Jumped all the way to ripe: a mature plant is never watered, so clear the
    // flag rather than leave it holding a watering it can no longer spend.
    if ((p.stage ?? 0) >= maxStage()) p.watered_t = 0;
    return 'jumped';
  }

  // Water every planted crop within `radius` metres of world point (pwx, pwy).
  // Returns { n, jumped } — how many were watered, and how many the can pushed
  // a stage on. Pass an array as `jumpedPlants` to be told which ones jumped
  // (the scene bursts a 'sprout' on each — the same cue the tap gives).
  function waterWithin(save, pwx, pwy, radius, now = Date.now(), relics = null, rng = Math.random, jumpedPlants = null) {
    const r2 = radius * radius;
    let n = 0, jumped = 0;
    for (const p of save.planted || []) {
      const dx = p.x - pwx, dy = p.y - pwy;
      if (dx * dx + dy * dy > r2) continue;
      const r = waterOne(save, p, relics, now, rng);
      if (!r) continue;
      n++;
      if (r === 'jumped') { jumped++; if (jumpedPlants) jumpedPlants.push(p); }
    }
    return { n, jumped };
  }

  // ── Bed quality ──────────────────────────────────────────────────────────
  // PRODUCE QUALITY IS A PROPERTY OF THE BED, AND THE HOE IS WHAT SETS IT.
  // Tilling banks the hoe's tier on the cell (save.tilledQuality, keyed by the
  // same cellKey as save.tilled); planting SPENDS that onto the crop as
  // `qualBoost`, which the harvest reads for its extra-seed chance and yield.
  //
  // Until Sep 2026 this was the WATERING CAN's: the boost was stamped on the
  // plant at its first watering from can.tier, plus 2 more while the can held
  // refill charges. The can keeps the thing it is actually for — the growth
  // JUMP (waterJumpChance above) — and the charge bank retired with the bonus
  // it fed. Quality now answers to the tool that prepares the ground.
  //
  // A bed is a cell, so the entry lives and dies with the cell's tilled
  // marker: written by the till, spent by the plant, dropped wherever the
  // marker is dropped. Everything goes through these three so a bed's quality
  // and its tilled state cannot drift apart. A stale entry would be harmless
  // (only a plant on that exact cell ever reads it, and a re-till overwrites
  // it) but it would sit in the save forever.
  function bedQuality(save, cellKey) {
    if (!save || !save.tilledQuality) return 0;
    return save.tilledQuality[cellKey] || 0;
  }
  function setBedQuality(save, cellKey, tier) {
    if (!save) return 0;
    const t = Math.max(0, Math.floor(Number(tier) || 0));
    if (!t) { clearBedQuality(save, cellKey); return 0; }
    save.tilledQuality = save.tilledQuality || {};
    save.tilledQuality[cellKey] = t;
    return t;
  }
  function clearBedQuality(save, cellKey) {
    if (save && save.tilledQuality) delete save.tilledQuality[cellKey];
  }
  // Spend the bed onto the crop being planted on it: the crop carries the
  // quality from here on, and the cell stops holding it.
  function takeBedQuality(save, cellKey) {
    const q = bedQuality(save, cellKey);
    clearBedQuality(save, cellKey);
    return q;
  }

  root.Crops = { STAGE_HOLD_MS, CAN_TOP_TIER, maxStage, isMature, crowEats,
                 advanceGrowth, waterWithin, waterOne, waterJumpChance,
                 bedQuality, setBedQuality, clearBedQuality, takeBedQuality };
})(typeof globalThis !== 'undefined' ? globalThis : this);
