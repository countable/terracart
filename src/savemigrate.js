// Save migration core — the one-time save-shape migrations extracted from
// MapScene.create() so they're testable headlessly (no scene, no DOM).
//
// migrate(save) mutates `save` in place: backfills slots/defaults added since a
// save was created, re-derives maxEnergy from armor, applies the history-size
// cap, and runs the data migrations (inv string→object, stash fold, venison→
// meat, golden→shiny rename, released golden flag, the sapling review seed).
//
// Returns `needsPersist`: true iff a REAL data migration changed something and
// the save should be re-written now. Idempotent defaults (slot backfills, the
// maxEnergy re-derive, the history cap, the starter-tool strip) deliberately do
// NOT force a persist — they ride along on the next save event, exactly as the
// original create() did. The scene keeps the offline-rest restoration + runtime
// field init around the call; only the pure save-shape work moves here.
//
// Depends on globals: maxEnergyFromArmor + STARTING_ENERGY (items.js), and
// Inventory.add (inventory.js) for the stash / sapling grants.

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
    if (save.shrine === undefined) save.shrine = null;
    if (save.shrineLevel === undefined) save.shrineLevel = 1;
    if (save.reachUpgrades === undefined) save.reachUpgrades = 0;
    if (save.deliveryCount === undefined) save.deliveryCount = 0;
    if (save.houseSatisfied === undefined) save.houseSatisfied = {};
    if (save.discovery === undefined) save.discovery = 0;
    if (save.discovered === undefined) save.discovered = {};
    // Self-heal: pre-fix, id-less trees pushed `undefined` into save.chopped,
    // and a choppedSet.has(undefined) match wiped whole groves. Strip falsy ids.
    if (Array.isArray(save.chopped)) {
      const cleaned = save.chopped.filter((id) => !!id);
      if (cleaned.length !== save.chopped.length) save.chopped = cleaned;
    }
    if (save.shrineReplacedId === undefined) save.shrineReplacedId = null;
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
    // Backfill armor slots (spread, not ||, so a save missing one slot key still
    // gets defaults rather than carrying gaps that crash maxEnergyFromArmor).
    save.armor = { helmet: null, chest: null, legs: null, boots: null, ...(save.armor || {}) };
    // Always re-derive maxEnergy from equipped armor — never trust a stale value.
    const maxE = (typeof maxEnergyFromArmor === 'function')
      ? maxEnergyFromArmor(save.armor)
      : (typeof STARTING_ENERGY !== 'undefined' ? STARTING_ENERGY : 100);
    save.maxEnergy = maxE;
    if (!Number.isFinite(save.energy)) save.energy = maxE;
    save.energy = Math.min(maxE, Math.max(0, save.energy));
    // Restored-houses / forts default to empty objects; a stale tributedCastles
    // map (the gate is now read off deliveryCount) is dead weight — drop it.
    if (!save.restoredHouses || typeof save.restoredHouses !== 'object') save.restoredHouses = {};
    if (save.tributedCastles) delete save.tributedCastles;
    if (!save.unlockedForts || typeof save.unlockedForts !== 'object') save.unlockedForts = {};
    // One-time: strip the old free WOODEN (tier-1) pick/axe so existing players
    // also start the forge loop. Upgraded tools were earned — left alone. Gated
    // so a re-forged wooden tool isn't re-wiped on the next reload.
    if (!save.starterToolsStripped) {
      if (save.relics?.pick?.tier === 1) save.relics.pick = null;
      if (save.relics?.axe?.tier === 1) save.relics.axe = null;
      save.starterToolsStripped = true;
    }
    // Soft cap on unbounded history fields so a heavy player can't balloon the
    // save past the localStorage quota and silently break writes.
    const HISTORY_CAP = 5000;
    for (const k of ['opened', 'picked', 'foundTreasures', 'caught', 'brokenRocks', 'placedRocks', 'chopped']) {
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
    // REVIEW SEED (temporary): grant fruit-tree saplings once. Gated by a flag.
    if (!save._saplingsGranted) {
      if (typeof Inventory !== 'undefined') {
        Inventory.add(save, 'apple_sapling', 3);
        Inventory.add(save, 'peach_sapling', 2);
      }
      save._saplingsGranted = true;
      needsPersist = true;
    }

    return needsPersist;
  }

  root.SaveMigrate = { migrate };
})(typeof globalThis !== 'undefined' ? globalThis : this);
