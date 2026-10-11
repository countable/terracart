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

  // A crop's stage lasts 4 × tier³ minutes (owner's call, Oct 2026: double
  // the Sep 2026 2 × tier³), off its BASE_TIER (items.js — the one tier the
  // loot and prices read), rounded to a number a player can hold in their
  // head (roundHoldMin): tier 1 4m, 2 30m, 3 2h, 4 4h, 5 8h, 6 14h, 7 23h. The
  // magical flowers ride the same curve at their own tiers (sunflower 4,
  // fireflower 5, iceflower 6).
  const HOLD_MIN_PER_TIER_CUBED = 4;
  function roundHoldMin(m) {
    if (m < 10) return Math.max(1, Math.round(m));
    if (m < 60) return Math.round(m / 5) * 5;
    return Math.round(m / 60) * 60;
  }
  // A crop's tier is its item's (items.js itemTierOf — BASE_TIER through
  // ITEM_BY_ID), T1 when unranked.
  function cropTier(crop) { return itemTierOf(crop, 1); }
  function tierHoldMs(tier) {
    return roundHoldMin(HOLD_MIN_PER_TIER_CUBED * tier ** 3) * 60 * 1000;
  }
  function stageHoldMs(crop) { return tierHoldMs(cropTier(crop)); }
  // A tier-1 crop's stage — the first crop a player grows (the starter seeds).
  const STAGE_HOLD_MS = tierHoldMs(1);
  // THE CAN SHORTENS THE STAGE IT STARTS (owner's call, Sep 2026): a watering
  // stamps the plant's hold for the stage it begins (`p.hold_ms`), cut by the
  // can's tier — CAN_HOLD_CUT off at Frost (seven eighths — owner's call,
  // Oct 2026, up from three quarters), a straight line down from bare hands'
  // full hold. A plant watered before this carried no stamp and reads its
  // crop's own hold (plantHoldMs).
  const CAN_HOLD_CUT = 0.875;  // a Frost can's stage is an eighth of bare hands'
  function canHoldMul(relics) {
    const t = relics && relics.watering_can && relics.watering_can.tier ? relics.watering_can.tier : 0;
    return 1 - CAN_HOLD_CUT * Math.max(0, Math.min(1, t / CAN_TOP_TIER));
  }
  function plantHoldMs(p) {
    return p && p.hold_ms > 0 ? p.hold_ms : stageHoldMs(p && p.crop);
  }

  // The one crop no raider touches: a potato grows underground, and neither
  // crop raider (SpriteLayout `raidsCrops` — the deer's graze, the crow's
  // landing) notices it.
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

  // Mature magical flowers share the scroll projectile and the ordinary
  // frost status. Wild flowers are already grown; planted ones must ripen.
  const EFFECT_SCAN_MS = 250;
  const EFFECTS = Object.freeze({
    fireflower: Object.freeze({ rangeCells: 4, intervalMs: 3000, projectile: 'fireball_scroll' }),
    iceflower: Object.freeze({ aura: Object.freeze({ texture: 'aura_frost' }) }),
  });
  function effectFor(p) {
    return p && (p.kind === 'wildplant' || p.wildId || isMature(p)) ? EFFECTS[p.crop] || null : null;
  }

  // Each source has a firing clock; no saved crop fields or accumulated volley
  // while away. Ice sources share the recipient's non-refreshing frost timer.
  function tickPlantEffect(p, creatures, save, player, cellM, now, nextFire, blocked) {
    const row = effectFor(p);
    if (!row) return null;
    if (row.aura) {
      Combat.applyFrostAura(p, creatures, cellM, row.aura, now, save, player);
      return null;
    }
    if ((nextFire.get(p) || 0) > now) return null;
    let target = null, nearest = row.rangeCells * cellM;
    for (const c of creatures) {
      if (!Combat.isEnemy(c)) continue;
      const distance = Math.hypot(c.x - p.x, c.y - p.y);
      if (distance > nearest || !Combat.lineOfFire(p.x, p.y, c.x, c.y, blocked, cellM)) continue;
      target = c; nearest = distance;
    }
    if (!target) return null;
    const dir = { x: target.x - p.x, y: target.y - p.y };
    if (!dir.x && !dir.y) dir.x = 1;
    const shot = Combat.spawnFireball(p.x, p.y, dir, cellM, CONSUMABLE_SPEC[row.projectile]);
    shot.rangeM = row.rangeCells * cellM;
    shot.source = 'flower';
    nextFire.set(p, now + row.intervalMs);
    return shot;
  }

  function tickEffects(scene, now = Date.now()) {
    if ((scene._flowerScanAt || 0) > now) return;
    scene._flowerScanAt = now + EFFECT_SCAN_MS;
    const player = playerWorldM(scene), pc = scene.playerToWorldCell();
    const radius = CREATURE_SIM_CELLS * scene.cellM;
    const x0 = player.x - radius, y0 = player.y - radius;
    const x1 = player.x + radius, y1 = player.y + radius;
    const plants = [], creatures = [], caught = setOf(scene.save.caught);
    const spent = spentSets(scene);
    const addPlant = p => {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && effectFor(p) && !isSpent(p, spent)) plants.push(p);
    };
    forEachInBox(scene.save, scene.depth ?? 0, x0, y0, x1, y1, addPlant);
    eachTile3x3(pc.tx, pc.ty, (tx, ty) => {
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      if (!entry) return;
      WorldGen.forEachItemInBox(entry, 'wildplants', x0, y0, x1, y1, addPlant);
      for (const c of entry.creatures || []) {
        if (!caught.has(c.id) && !c._surfaceInactive && c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) creatures.push(c);
      }
    });
    scene._flowerNextFire ||= new WeakMap();
    const frozenBefore = Conditions.active(scene.save, 'frozen');
    for (const p of plants) {
      const shot = tickPlantEffect(p, creatures, scene.save, player, scene.cellM, now,
        scene._flowerNextFire, (x, y) => scene._cellBlocked(x, y));
      if (shot) scene._shots.push(shot);
    }
    if (!frozenBefore && Conditions.active(scene.save, 'frozen')) persistSave(scene.save);
  }

  // Fruit and timber saplings share one growth window (PLANTED_TREE_GROW_MS,
  // one day) so their copy and art cannot drift when tree growth changes.
  const FRUIT_STAGE_MS = PLANTED_TREE_GROW_MS / 4;
  const FRUIT_RESPAWN_MS = 24 * 60 * 60 * 1000;

  // Shared by tree art and harvesting. Wild trees start mature; planted trees
  // take four stages (a quarter of the window each), then each pick starts a
  // fresh fruit respawn timer.
  // The pick: save.fruitPicked[id] = now, a rolling ledger (save.js Ledger)
  // that drops trees whose respawn has run.
  function markFruitPicked(save, id, now = Date.now()) {
    Ledger.stamp(save, 'fruitPicked', id, now, now, FRUIT_RESPAWN_MS);
  }
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
  // between (Wood 1/7, Copper 2/7, … Frost 7/7). It buys TIME, the one thing a
  // crop costs: the top rung makes a crop grow twice as fast, because every
  // watering is worth two.
  //
  // The jump does NOT consume the watering: the plant is watered AND a stage
  // further on, so its normal advance is still coming — a doubling, not a
  // shortcut.
  const CAN_TOP_TIER = 7;               // Frost — the top of MATERIAL_TIERS
  function waterJumpChance(relics) {
    const t = relics && relics.watering_can && relics.watering_can.tier ? relics.watering_can.tier : 0;
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

  // Growth Powder: everything growing within `radius` metres of (pwx, pwy)
  // COMPLETES the stage it is on, at once — every timer it is waiting on ends
  // (owner, Oct 2026: "complete the current stage, end all timers"):
  //   a CROP finishes its stage as advanceGrowth would — watered or not, the
  //     next stage, and it waits for a fresh watering (a held one is spent);
  //   a PLANTED TREE (save.fruittrees: an apple, a peach, an acorn's timber)
  //     reaches its next growth stage — planted_t moves back to that stage's
  //     boundary (FRUIT_STAGE_MS quarters; a timber tree's plantedTreeStage
  //     halves of PLANTED_TREE_GROW_MS);
  //   a PICKED fruit tree's regrowth ends (save.fruitPicked) — the planted
  //     ones here, and any wild ones the caller lists in `pickedIds` (the
  //     scene finds those on the map).
  // Returns how many moved; `moved` (optional array) is told which crops and
  // planted trees did, so the scene can burst a 'sprout' on each and re-seat
  // a live tree's planted_t.
  function completeStageWithin(save, pwx, pwy, radius, moved = null, now = Date.now(), pickedIds = []) {
    const r2 = radius * radius;
    const near = o => (o.x - pwx) ** 2 + (o.y - pwy) ** 2 <= r2;
    let n = 0;
    const hit = o => { n++; if (moved) moved.push(o); };
    for (const p of save.planted || []) {
      if ((p.stage ?? 0) >= maxStage() || !near(p)) continue;
      p.stage = (p.stage ?? 0) + 1;
      p.watered_t = 0;
      hit(p);
    }
    const picked = save.fruitPicked && typeof save.fruitPicked === 'object' ? save.fruitPicked : null;
    const unpick = id => {
      if (!picked || !Ledger.waitMs(picked, id, now, FRUIT_RESPAWN_MS)) return false;
      delete picked[id];
      return true;
    };
    for (const t of save.fruittrees || []) {
      if (!near(t)) continue;
      const age = now - (t.planted_t || 0);
      const next = t.kind === 'tree'
        ? (age < PLANTED_TREE_GROW_MS / 2 ? PLANTED_TREE_GROW_MS / 2 : age < PLANTED_TREE_GROW_MS ? PLANTED_TREE_GROW_MS : null)
        : (age < 4 * FRUIT_STAGE_MS ? (Math.floor(age / FRUIT_STAGE_MS) + 1) * FRUIT_STAGE_MS : null);
      if (next != null) { t.planted_t = now - next; hit(t); }
      else if (t.kind !== 'tree' && unpick(t.id)) hit(t);
    }
    for (const id of pickedIds) if (unpick(id)) n++;
    return n;
  }

  // ── Bed quality ──────────────────────────────────────────────────────────
  // PRODUCE QUALITY IS A PROPERTY OF THE BED, AND THE HOE IS WHAT SETS IT.
  // Tilling banks the hoe's tier on the cell (save.tilledQuality, keyed by the
  // same cellKey as save.tilled); planting SPENDS that onto the crop as
  // `qualBoost`, which the harvest reads for its extra-seed chance and yield.
  //
  // The can keeps the growth JUMP (waterJumpChance above); quality answers to
  // the tool that prepares the ground.
  //
  // A bed is a cell, so the entry lives and dies with the cell's tilled
  // marker: written by the till, spent by the plant, dropped wherever the
  // marker is dropped. Everything goes through these three so the two cannot
  // drift apart (a stale entry would be harmless but sit in the save forever).
  function bedQuality(save, cellKey) {
    if (!save || !save.tilledQuality) return 0;
    return save.tilledQuality[cellKey] || 0;
  }
  function setBedQuality(save, cellKey, tier) {
    if (!save) return 0;
    const t = Math.max(0, Math.floor(Number(tier) || 0));
    if (!t) { clearBedQuality(save, cellKey); return 0; }
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

  root.Crops = { FRUIT_STAGE_MS, FRUIT_RESPAWN_MS, markFruitPicked, fruitTreeState, STAGE_HOLD_MS, HOLD_MIN_PER_TIER_CUBED, roundHoldMin, tierHoldMs, stageHoldMs, cropTier, CAN_HOLD_CUT, canHoldMul, plantHoldMs, CAN_TOP_TIER, maxStage, isMature, raiderEats,
                 advanceGrowth, waterWithin, waterOne, waterJumpChance, completeStageWithin,
                 bedQuality, setBedQuality, clearBedQuality, takeBedQuality,
                 forEachInBox, invalidateSpatialIndex, EFFECTS, EFFECT_SCAN_MS, effectFor, tickPlantEffect, tickEffects };
})(typeof globalThis !== 'undefined' ? globalThis : this);
