// Crops core — pure crop growth / watering / pest rules extracted from app.js
// so the timing math is testable headlessly (no scene, no DOM).
//
// Growth, countdowns and item descriptions share stageHoldMs(crop).
//
// The scene keeps thin wrappers (app.js advanceGrowth / waterCropsWithin /
// raiderEatsCrop) that own the side effects: persistSave and reading the player's
// world position.
//
// Crop model: save.planted is a list of { x, y, crop, stage, watered_t }.
//   stage 0..MAX_GROWTH_STAGE (mature); each stage needs one watering then a
//   crop-specific hold before it advances.
//
// Depends on the global MAX_GROWTH_STAGE (items.js) and PlacedFloor
// (placed_floor.js, for legacy surface depth and cave crops).

(function (root) {
  'use strict';

  // A crop's stage lasts 2 × tier³ minutes (owner's call, Sep 2026), off its
  // BASE_TIER (items.js — the one tier the loot and prices read), rounded to a
  // number a player can hold in their head (roundHoldMin): tier 1 2m, 2 15m,
  // 3 55m, 4 2h, 5 4h, 6 7h. The magical flowers ride the same curve at their
  // own tiers (sunflower 4, fireflower 5, iceflower 6).
  const HOLD_MIN_PER_TIER_CUBED = 2;
  function roundHoldMin(m) {
    if (m < 10) return Math.max(1, Math.round(m));
    if (m < 60) return Math.round(m / 5) * 5;
    return Math.round(m / 60) * 60;
  }
  function cropTier(crop) {
    const t = (typeof BASE_TIER !== 'undefined' && BASE_TIER[crop]) || 1;
    return Math.max(1, t);
  }
  function tierHoldMs(tier) {
    return roundHoldMin(HOLD_MIN_PER_TIER_CUBED * tier ** 3) * 60 * 1000;
  }
  function stageHoldMs(crop) { return tierHoldMs(cropTier(crop)); }
  // A tier-1 crop's stage — the first crop a player grows (the starter seeds).
  const STAGE_HOLD_MS = tierHoldMs(1);
  // The flat 15-minute stage every crop had before per-crop holds. Only the
  // one-time save migration below still reads it.
  const LEGACY_STAGE_HOLD_MS = 15 * 60 * 1000;
  // THE CAN SHORTENS THE STAGE IT STARTS (owner's call, Sep 2026): a watering
  // stamps the plant's hold for the stage it begins (`p.hold_ms`), cut by the
  // can's tier — CAN_HOLD_CUT off at Frost (three quarters), a straight line down from bare
  // hands' full hold. A plant watered before this carried no stamp and reads
  // its crop's own hold (plantHoldMs).
  const CAN_HOLD_CUT = 0.75;   // a Frost can's stage is a quarter of bare hands'
  function canHoldMul(relics) {
    const t = relics && relics.can && relics.can.tier ? relics.can.tier : 0;
    return 1 - CAN_HOLD_CUT * Math.max(0, Math.min(1, t / CAN_TOP_TIER));
  }
  function plantHoldMs(p) {
    return p && p.hold_ms > 0 ? p.hold_ms : stageHoldMs(p && p.crop);
  }

  // Called once by save migration. Old watered crops keep the fraction of
  // their 15-minute stage already earned; a completed stage pays out first.
  function migrateStageTimers(save, now = Date.now()) {
    let changed = false;
    for (const p of save.planted || []) {
      if (!p.watered_t || isMature(p)) continue;
      const elapsed = Math.max(0, now - p.watered_t);
      if (elapsed >= LEGACY_STAGE_HOLD_MS) {
        p.stage = (p.stage ?? 0) + 1;
        p.watered_t = 0;
        changed = true;
      } else if (stageHoldMs(p.crop) !== LEGACY_STAGE_HOLD_MS) {
        p.watered_t = now - elapsed / LEGACY_STAGE_HOLD_MS * stageHoldMs(p.crop);
        changed = true;
      }
    }
    return changed;
  }

  // The one crop no raider touches: a potato grows underground, and the deer
  // (the crop raider — scene_creatures.js wanderCreatures `raidsCrops`) never
  // notices it. It was the crow's rule until Sep 2026, when crop-raiding moved
  // to the deer; the safe crop stayed the same.
  const RAIDER_IGNORED_CROPS = new Set(['potato']);

  // The save owns the flat crop list; this derived index is deliberately kept
  // outside it so persistence never serializes buckets. Crops do not move in
  // place: growth and watering only change fields on the same live objects.
  const SPATIAL_BUCKET_M = 20;
  const spatialIndexes = new WeakMap();
  function invalidateSpatialIndex(save) { spatialIndexes.delete(save); }

  // Visit crops in the closed metre box, at one depth, in save.planted order.
  // The order matters when two crops share a depth/screen position: the sprite
  // pass used to receive them in their saved order. Return work counts for the
  // frame profiler; a rebuild costs one visit to every saved crop once.
  function forEachInBox(save, depth, x0, y0, x1, y1, visit) {
    const planted = save?.planted || [];
    if (!planted.length) return { candidates: 0, rebuiltEntries: 0 };
    let idx = spatialIndexes.get(save);
    let rebuiltEntries = 0;
    if (!idx || idx.array !== planted || idx.length !== planted.length) {
      const buckets = new Map();
      for (let i = 0; i < planted.length; i++) {
        const p = planted[i];
        const level = PlacedFloor.placedDepth(p);
        const key = level + ':' + Math.floor(p.x / SPATIAL_BUCKET_M) + ',' + Math.floor(p.y / SPATIAL_BUCKET_M);
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, bucket = []);
        bucket.push(i);
      }
      idx = { array: planted, length: planted.length, buckets };
      spatialIndexes.set(save, idx);
      rebuiltEntries = planted.length;
    }
    const level = depth ?? 0;
    const bx0 = Math.floor(x0 / SPATIAL_BUCKET_M), bx1 = Math.floor(x1 / SPATIAL_BUCKET_M);
    const by0 = Math.floor(y0 / SPATIAL_BUCKET_M), by1 = Math.floor(y1 / SPATIAL_BUCKET_M);
    const nearby = [];
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const bucket = idx.buckets.get(level + ':' + bx + ',' + by);
        if (bucket) for (const i of bucket) nearby.push(i);
      }
    }
    nearby.sort((a, b) => a - b);
    for (const i of nearby) {
      const p = planted[i];
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) visit(p);
    }
    return { candidates: nearby.length, rebuiltEntries };
  }

  // Fruit and timber saplings share one growth window (PLANTED_TREE_GROW_MS,
  // one day) so their copy and art cannot drift when tree growth changes.
  const FRUIT_STAGE_MS = PLANTED_TREE_GROW_MS / 4;
  const FRUIT_RESPAWN_MS = 24 * 60 * 60 * 1000;

  // Shared by tree art and harvesting. Wild trees start mature; planted trees
  // take four stages (a quarter of the window each), then each pick starts a
  // fresh fruit respawn timer.
  function fruitTreeState(tree, pickedAt, now = Date.now()) {
    const elapsed = now - (tree.planted_t || 0);
    const stage = tree.planted
      ? Math.max(0, Math.min(4, Math.floor(elapsed / FRUIT_STAGE_MS))) : 4;
    const mature = stage === 4;
    const remainingMs = !mature ? 4 * FRUIT_STAGE_MS - elapsed
      : pickedAt ? Math.max(0, FRUIT_RESPAWN_MS - (now - pickedAt)) : 0;
    return { stage, mature, ready: mature && remainingMs === 0, remainingMs };
  }

  function maxStage() {
    return (typeof MAX_GROWTH_STAGE !== 'undefined') ? MAX_GROWTH_STAGE : 4;
  }

  // Fully grown? (at or past the final stage)
  function isMature(p) {
    return (p?.stage ?? 0) >= maxStage();
  }

  // Will a raider notice / walk at / eat this crop? (potatoes are immune)
  function raiderEats(p) {
    return !RAIDER_IGNORED_CROPS.has(p?.crop);
  }

  // Advance every watered crop whose crop-specific hold has elapsed by ONE
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
      if (now - p.watered_t < plantHoldMs(p)) continue;
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
  // stage waits stand between a seed and a harvest, and no relic
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
    p.hold_ms = Math.round(stageHoldMs(p.crop) * canHoldMul(relics));
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

  // Growth Powder: spring every unripe crop within `radius` metres of (pwx,
  // pwy) ONE stage ahead, on the spot and with no watering involved. A held
  // watering is left in place (the can's jump above doesn't spend one either,
  // and neither does this) — except on a plant that just ripened, which can
  // no longer spend it. Returns how many plants moved.
  //
  // Pass an array as `movedPlants` to be told WHICH ones moved, exactly as
  // waterWithin reports its jumps: the scene bursts a 'sprout' on each, the
  // same cue a plant gets for reaching a stage by its growth timer or by the
  // can's jump. Until Sep 2026 this was the one of the three that could not
  // report, so the one moment a whole PLOT springs forward was also the only
  // one with no leaves over it.
  function advanceWithin(save, pwx, pwy, radius, movedPlants = null) {
    const r2 = radius * radius;
    let n = 0;
    for (const p of save.planted || []) {
      if ((p.stage ?? 0) >= maxStage()) continue;
      const dx = p.x - pwx, dy = p.y - pwy;
      if (dx * dx + dy * dy > r2) continue;
      p.stage = (p.stage ?? 0) + 1;
      if ((p.stage ?? 0) >= maxStage()) p.watered_t = 0;
      n++;
      if (movedPlants) movedPlants.push(p);
    }
    return n;
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

  root.Crops = { FRUIT_STAGE_MS, FRUIT_RESPAWN_MS, fruitTreeState, STAGE_HOLD_MS, LEGACY_STAGE_HOLD_MS, HOLD_MIN_PER_TIER_CUBED, roundHoldMin, tierHoldMs, stageHoldMs, cropTier, CAN_HOLD_CUT, canHoldMul, plantHoldMs, migrateStageTimers, CAN_TOP_TIER, maxStage, isMature, raiderEats,
                 advanceGrowth, waterWithin, waterOne, waterJumpChance, advanceWithin,
                 bedQuality, setBedQuality, clearBedQuality, takeBedQuality,
                 forEachInBox, invalidateSpatialIndex };
})(typeof globalThis !== 'undefined' ? globalThis : this);
