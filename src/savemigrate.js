// Save migration core — the one-time save-shape migrations extracted from
// MapScene.create() so they're testable headlessly (no scene, no DOM).
//
// migrate(save) mutates `save` in place: backfills slots/defaults added since a
// save was created, re-derives maxEnergy from armor, applies the history-size
// cap, and runs the data migrations (inv string→object, stash fold, discovery
// counter→badge stack, venison→meat, golden→shiny rename, released golden
// flag, the sapling review seed).
//
// Returns `needsPersist`: true iff a REAL data migration changed something and
// the save should be re-written now. Idempotent defaults (slot backfills, the
// maxEnergy re-derive, the history cap, the starter-tool strip) deliberately do
// NOT force a persist — they ride along on the next save event, exactly as the
// original create() did. The scene keeps the offline-rest restoration + runtime
// field init around the call; only the pure save-shape work moves here.
//
// Depends on globals: maxEnergyFromArmor + STARTING_ENERGY (items.js), and
// Inventory.add (inventory.js) for the stash / sapling grants. ShopsMath
// (shops_math.js) is used too, for the shop-state GC below, but that module
// loads AFTER this one in index.html — the call is runtime-guarded so a
// headless load of just this file (no ShopsMath) still works.

(function (root) {
  'use strict';

  function migrate(save) {
    let needsPersist = false;

    // --- Slot / default backfills (idempotent; don't force a persist) --------
    // Stats / equipment: add energy + relic/armor slots to older saves.
    save.relics = save.relics || {
      pick: null, axe: null, ring: null, amulet: null, sword: null, bow: null, staff: null,
    };
    for (const slot of ['axe', 'sword', 'bow', 'staff', 'can', 'hoe', 'bugnet', 'rod', 'bags']) {
      if (save.relics[slot] === undefined) save.relics[slot] = null;
    }
    // Two-bar inventory: older saves predate the type-tab selector. Default the
    // active tab to Seeds and clear any gear selection.
    if (save.invCat === undefined) save.invCat = 'seed';
    if (save.selGear === undefined) save.selGear = null;
    if (save.reachUpgrades === undefined) save.reachUpgrades = 0;
    if (save.deliveryCount === undefined) save.deliveryCount = 0;
    if (save.houseSatisfied === undefined) save.houseSatisfied = {};
    if (save.discovered === undefined) save.discovered = {};
    // Self-heal: pre-fix, id-less trees pushed `undefined` into save.chopped,
    // and a choppedSet.has(undefined) match wiped whole groves. Strip falsy ids.
    if (Array.isArray(save.chopped)) {
      const cleaned = save.chopped.filter((id) => !!id);
      if (cleaned.length !== save.chopped.length) save.chopped = cleaned;
    }
    // Per-shop bucket state replaces the old shopDeals/shopOffers; offerSalt is a
    // once-per-save random so identical worlds differ across players.
    if (!save.shopState) {
      save.shopState = {};
      save.offerSalt = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
      delete save.shopDeals;
      delete save.shopOffers;
    }
    if (save.offerSalt == null) {
      save.offerSalt = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
    }
    // GC stale per-house shop-state entries once per boot. render.js polls
    // shop readiness for every house it draws (not just ones ever shopped at),
    // and nothing else ever deletes an entry, so save.shopState otherwise grows
    // by one record per house EVER SEEN and never shrinks. shops_math.js loads
    // AFTER this file in index.html, so the call is runtime-guarded; node tests
    // that load savemigrate.js on its own (without shops_math.js) still pass.
    if (typeof ShopsMath !== 'undefined') {
      ShopsMath.pruneShopState(save, Date.now());
    }
    // Backfill armor slots (spread, not ||, so a save missing one slot key still
    // gets defaults rather than carrying gaps that crash maxEnergyFromArmor).
    save.armor = { helmet: null, chest: null, legs: null, boots: null, ...(save.armor || {}) };
    // Always re-derive maxEnergy from equipped armor — never trust a stale value.
    const _fallbackMaxE = (typeof STARTING_ENERGY !== 'undefined' ? STARTING_ENERGY : 100);
    let maxE = (typeof maxEnergyFromArmor === 'function')
      ? maxEnergyFromArmor(save.armor)
      : _fallbackMaxE;
    // Guard against a non-finite armor lookup (NaN/undefined would otherwise
    // poison save.energy via the Math.min below and disable energy entirely).
    if (!Number.isFinite(maxE)) maxE = _fallbackMaxE;
    save.maxEnergy = maxE;
    if (!Number.isFinite(save.energy)) save.energy = maxE;
    save.energy = Math.min(maxE, Math.max(0, save.energy));
    // Restored-houses / forts default to empty objects; a stale tributedCastles
    // map (the gate is now read off deliveryCount) is dead weight — drop it.
    if (!save.restoredHouses || typeof save.restoredHouses !== 'object') save.restoredHouses = {};
    if (save.tributedCastles) delete save.tributedCastles;
    if (!save.unlockedForts || typeof save.unlockedForts !== 'object') save.unlockedForts = {};
    if (!save.openedCastles || typeof save.openedCastles !== 'object') save.openedCastles = {};
    // One-time: strip the old free WOODEN (tier-1) pick/axe so existing players
    // also start the forge loop. Upgraded tools were earned — left alone. Gated
    // so a re-forged wooden tool isn't re-wiped on the next reload.
    if (!save.starterToolsStripped) {
      if (save.relics?.pick?.tier === 1) save.relics.pick = null;
      if (save.relics?.axe?.tier === 1) save.relics.axe = null;
      save.starterToolsStripped = true;
    }
    // Soft cap on unbounded history fields so a heavy player can't balloon the
    // save past the localStorage quota and silently break writes. `placedRocks`
    // is deliberately EXEMPT: unlike the others (which just re-arm a respawn —
    // an old broken rock or opened chest reappearing is accepted behaviour),
    // a placed rockfruit stone is live rendered map content. Trimming it would
    // silently delete a player-placed rock out of the world, not just forget
    // its history. It stays unbounded, bounded instead by the gameplay cost of
    // placing one.
    const HISTORY_CAP = 5000;
    for (const k of ['opened', 'picked', 'foundTreasures', 'caught', 'brokenRocks', 'chopped']) {
      const arr = save[k];
      if (Array.isArray(arr) && arr.length > HISTORY_CAP) {
        save[k] = arr.slice(arr.length - HISTORY_CAP);
      }
    }

    // --- Data migrations (these DO force a persist) --------------------------
    // Older save: inv as a string array → {id,count} objects (else sel.count -= 1
    // yields NaN and stacks become uncountable).
    if (save.inv && typeof save.inv[0] === 'string') {
      save.inv = save.inv.filter(Boolean).map((id) => ({ id, count: 1 }));
      needsPersist = true;
    }
    // Older save: a `stash` object → fold into inv stacks.
    if (save.stash) {
      for (const [id, n] of Object.entries(save.stash)) {
        if (n > 0 && typeof Inventory !== 'undefined') Inventory.add(save, id, n);
      }
      delete save.stash;
      needsPersist = true;
    }
    // Older save: the `discovery` counter → a 'discovery' inventory stack.
    // The badge item is capExempt (inventory.js) so every banked point fits
    // regardless of bag tier. Runs after the inv string→object migration so
    // Inventory.add always sees object stacks.
    if (save.discovery !== undefined) {
      const n = save.discovery;
      if (typeof n === 'number' && n > 0 && typeof Inventory !== 'undefined') {
        Inventory.add(save, 'discovery', n);
      }
      delete save.discovery;
      needsPersist = true;
    }
    // Rename: venison → meat (fold counts) so hunting loot survives the rework.
    if (Array.isArray(save.inv)) {
      const merged = [];
      let meatCount = 0;
      for (const s of save.inv) {
        if (!s) continue;
        if (s.id === 'venison') { meatCount += (s.count ?? 0); needsPersist = true; }
        else if (s.id === 'meat') { meatCount += (s.count ?? 0); }
        else merged.push(s);
      }
      if (meatCount > 0) merged.push({ id: 'meat', count: meatCount });
      save.inv = merged;
    }
    // Rename: golden_<kind> → shiny_<kind> (fold counts). 'goldenfish' has no
    // underscore so it's never matched.
    if (Array.isArray(save.inv)) {
      const byId = new Map();
      const out = [];
      for (const s of save.inv) {
        if (!s) continue;
        const id = (s.id && s.id.startsWith('golden_')) ? 'shiny_' + s.id.slice(7) : s.id;
        if (id !== s.id) needsPersist = true;
        const prev = byId.get(id);
        if (prev) { prev.count = (prev.count ?? 0) + (s.count ?? 0); }
        else { const ns = { ...s, id }; byId.set(id, ns); out.push(ns); }
      }
      save.inv = out;
    }
    // Migrate the stored `golden` flag on released animals to `shiny`.
    if (Array.isArray(save.released)) {
      for (const r of save.released) {
        if (r && r.golden !== undefined) { r.shiny = r.golden; delete r.golden; needsPersist = true; }
      }
    }
    // Date the save (see stampStartedAt) and settle whether it has ever
    // brought in a crop (stampHarvested) — the pest amnesty reads the latter.
    if (stampStartedAt(save)) needsPersist = true;
    if (stampHarvested(save)) needsPersist = true;
    return needsPersist;
  }

  // Has this save been PLAYED, or is it a fresh start?
  //
  // The tell is any mark the player could only have left themselves: broken
  // ground, a planted crop, an opened chest, a restored neighbour, or a purse
  // that has moved off the starting figure. Used by things that all have to
  // treat a veteran's save as what it is rather than as a new game: retiring
  // the starter ladder on a save that predates it (app.js), dating a save that
  // predates `startedAt` (below), and deciding whether a save that predates
  // `hasHarvested` gets the pest amnesty (stampHarvested).
  function hasPlayed(save) {
    if (!save) return false;
    return (save.tilled?.length ?? 0) > 0
        || (save.planted?.length ?? 0) > 0
        || (save.opened?.length ?? 0) > 0
        || Object.keys(save.restoredHouses || {}).length > 0
        || (typeof STARTING_MONEY === 'number'
            && (save.money ?? STARTING_MONEY) !== STARTING_MONEY);
  }

  // When this save started, in epoch ms. Nothing gameplay-side reads it today
  // (the pest amnesty that used to has moved to `hasHarvested`, below), but a
  // date can only be stamped honestly ONCE — drop the stamping and every save
  // created in the gap is dated "now" whenever a reader appears — so it stays,
  // and stays honest about age: a save that predates the field and has been
  // PLAYED is dated to the epoch (long past), and only one that has never been
  // touched is dated to now.
  //
  // Kept out of migrate()'s backfill block on purpose: this is real data, not a
  // default, so it forces a persist — the date has to be the same on the next
  // load or "day one" would follow the player around.
  function stampStartedAt(save, nowMs) {
    if (!save || Number.isFinite(save.startedAt)) return false;
    save.startedAt = hasPlayed(save) ? 0 : (nowMs ?? Date.now());
    return true;
  }

  // Has this save ever brought in a crop? Stamped true at the harvest site
  // (interact.js); read by the pest amnesty (app.js _pestFreeZone + the crow
  // pump — no slime or crow near home until the first harvest). A save that
  // predates the flag can't be asked directly, so it gets the same honesty
  // rule as the dating above: one that has been PLAYED is assumed past its
  // first harvest — a veteran must never wake up to a pest-free home — and
  // only a save that has never been touched still has the grace ahead of it.
  // (The one save this misjudges — played a little, never harvested, at the
  // moment the flag ships — loses the amnesty a step early, once, which is
  // the safe side of the trade.)
  function stampHarvested(save) {
    if (!save || save.hasHarvested !== undefined) return false;
    save.hasHarvested = hasPlayed(save);
    return true;
  }

  root.SaveMigrate = { migrate, hasPlayed, stampStartedAt, stampHarvested };
})(typeof globalThis !== 'undefined' ? globalThis : this);
