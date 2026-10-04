// Current-save initialization, validation and bounded runtime cleanup.
// This module does not translate retired save formats or track schema versions.
// normalize returns true only when initializing durable first-session fields.
(function (root) {
  'use strict';
  function normalize(save) {
    let needsPersist = false;
    if (typeof Conditions !== 'undefined') Conditions.normalize(save);
    if (typeof Shrines !== 'undefined') Shrines.normalize(save);
    const relicSlots = (typeof RELIC_DEFS !== 'undefined') ? Object.keys(RELIC_DEFS)
      : ['pickaxe', 'axe', 'sword', 'bow', 'staff', 'watering_can', 'hoe', 'net', 'fishing_rod', 'bag'];
    save.relics = save.relics || {};
    for (const slot of relicSlots) {
      if (save.relics[slot] === undefined) save.relics[slot] = null;
    }
    if (save.activeWeapon === undefined) save.activeWeapon = null;
    if (save.invCat === undefined) save.invCat = 'seed';
    if (save.selGear === undefined) save.selGear = null;
    if (save.reachUpgrades === undefined) save.reachUpgrades = 0;
    // The wizard's permanent luck and quantity ladders.
    if (save.luckUpgrades === undefined) save.luckUpgrades = 0;
    if (save.qtyUpgrades === undefined) save.qtyUpgrades = 0;
    if (save.deliveryCount === undefined) save.deliveryCount = 0;
    // Per-house pinned wishlist (delivery.js wantedProduce). An older save has
    // none; each house pins itself the first time its sign is read.
    if (save.houseWishlists === undefined) save.houseWishlists = {};
    if (save.discovered === undefined) save.discovered = {};
    // Scroll recipes are learned by using one, never by merely owning it.
    if (!Array.isArray(save.usedScrolls)) save.usedScrolls = [];
    if (!save.foundWild) save.foundWild = {};
    // Self-heal: pre-fix, id-less trees pushed `undefined` into save.chopped,
    // and a choppedSet.has(undefined) match wiped whole groves. Strip falsy ids.
    if (Array.isArray(save.chopped)) {
      const cleaned = save.chopped.filter((id) => !!id);
      if (cleaned.length !== save.chopped.length) save.chopped = cleaned;
    }
    // Per-shop state and a once-per-save salt keep offers independent.
    if (!save.shopState) {
      save.shopState = {};
      save.offerSalt = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
    }
    if (save.offerSalt == null) {
      save.offerSalt = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
    }
    // GC spent per-house shop-state entries once per boot (a record is spent
    // once its re-roll level has eased to nothing — ShopsMath.pruneShopState);
    // nothing else ever deletes an entry, so save.shopState otherwise grows
    // by one record per shop EVER VISITED and never shrinks. shops_math.js loads
    // AFTER this file in index.html, so the call is runtime-guarded; node tests
    // that load save_state.js on its own (without shops_math.js) still pass.
    if (typeof ShopsMath !== 'undefined') {
      ShopsMath.pruneShopState(save, Date.now());
    }
    // Backfill armor slots (spread, not ||, so a save missing one slot key still
    // gets defaults rather than carrying gaps that crash armorReduction).
    save.armor = { helmet: null, chestplate: null, leggings: null, boots: null, ...(save.armor || {}) };
    // Derive the energy maximum from current equipment, then clamp the reading.
    const _fallbackMaxE = (typeof STARTING_ENERGY !== 'undefined' ? STARTING_ENERGY : 100);
    let maxE = (typeof Energy !== 'undefined' && typeof Energy.maxEnergy === 'function')
      ? Energy.maxEnergy(save)
      : _fallbackMaxE;
    // Guard against a non-finite lookup (NaN/undefined would otherwise poison
    // save.energy via the Math.min below and disable energy entirely).
    if (!Number.isFinite(maxE)) maxE = _fallbackMaxE;
    save.maxEnergy = maxE;
    if (!Number.isFinite(save.energy)) save.energy = maxE;
    // Whole numbers only — heals a bar a pre-fix revive left at a quarter of
    // an odd max (22.25⚡), see Energy.reviveLevel.
    save.energy = Math.round(Math.min(maxE, Math.max(0, save.energy)));
    // Restored-houses / forts default to empty objects.
    if (!save.restoredHouses || typeof save.restoredHouses !== 'object') save.restoredHouses = {};
    if (!save.unlockedForts || typeof save.unlockedForts !== 'object') save.unlockedForts = {};
    if (!save.temples || typeof save.temples !== 'object' || Array.isArray(save.temples)) save.temples = {};
    // Soft cap on unbounded history fields so a heavy player can't balloon the
    // save past the localStorage quota and silently break writes. `placedRocks`
    // is deliberately EXEMPT: unlike the others (which just re-arm a respawn —
    // an old broken rock or opened chest reappearing is accepted behaviour),
    // a placed rockfruit stone is live rendered map content. Trimming it would
    // silently delete a player-placed rock out of the world, not just forget
    // its history. It stays unbounded, bounded instead by the gameplay cost of
    // placing one.
    const HISTORY_CAP = 5000;
    // `sprungTraps` is capped like the rest: a trap that falls off the end
    // re-hides itself, which is the same accepted behaviour as an old broken
    // rock coming back — the trap is still exactly where it always was (the
    // placement is generated, never stored; see src/traps.js), it just costs
    // its bite once more.
    for (const k of ['opened', 'picked', 'foundTreasures', 'caught', 'brokenRocks', 'chopped',
                     'sprungTraps']) {
      const arr = save[k];
      if (Array.isArray(arr) && arr.length > HISTORY_CAP) {
        save[k] = arr.slice(arr.length - HISTORY_CAP);
      }
    }

    if (!save.trail || typeof save.trail !== 'object') save.trail = {};
    if (!Number.isFinite(save.trail.metres)) save.trail.metres = 0;
    if (!Number.isFinite(save.trail.prizes)) save.trail.prizes = 0;
    if (save.trail.greeted === undefined) save.trail.greeted = false;
    if (!save.streets || typeof save.streets !== 'object') save.streets = {};
    if (!Number.isFinite(save.memories) || save.memories < 0) save.memories = 0;
    save.memories = Math.floor(save.memories);
    if (!Number.isFinite(save.startedAt)) {
      save.startedAt = Date.now();
      needsPersist = true;
    }
    if (save.hasHarvested === undefined) {
      save.hasHarvested = false;
      needsPersist = true;
    }
    return needsPersist;
  }

  // Used by the fresh-game welcome flow, not to infer missing save history.
  function hasPlayed(save) {
    if (!save) return false;
    return (save.tilled?.length ?? 0) > 0
        || (save.planted?.length ?? 0) > 0
        || (save.opened?.length ?? 0) > 0
        || Object.keys(save.restoredHouses || {}).length > 0
        || (typeof STARTING_MONEY === 'number'
            && (save.money ?? STARTING_MONEY) !== STARTING_MONEY);
  }

  root.SaveState = { normalize, hasPlayed };
})(typeof globalThis !== 'undefined' ? globalThis : this);
