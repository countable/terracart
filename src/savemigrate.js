// Save migration core — the one-time save-shape migrations extracted from
// MapScene.create() so they're testable headlessly (no scene, no DOM).
//
// migrate(save) mutates `save` in place: backfills slots/defaults added since a
// save was created, re-derives maxEnergy from armor, applies the history-size
// cap, and runs the surviving data migrations (flute→honey rename, cobble
// stones→street metres).
//
// WHAT IS NOT HERE ANY MORE, AND THE RULE THAT DECIDES IT. A migration exists
// to carry a save across a shape change, and it has to be retired eventually or
// this file grows without bound — every one of them runs on every boot of every
// save forever. The problem was that nothing could say WHEN: there was no
// version on the record, `SAVE_VERSION_KEY` lives in the localStorage key and
// was never bumped, and `stampStartedAt` deliberately stamps a played legacy
// save `0`, so it cannot date one either. "Nothing writes this shape any more"
// was provable; "no live save still holds it" was not.
//
// `save.schema` (SAVE_SCHEMA below) is that missing criterion. It is stamped on
// every save that passes through here, so a shape retired later can be judged
// on the number rather than on a guess. The pre-schema migrations were retired
// against an explicit decision that saves old enough to still need them are
// FORFEIT (Sep 2026): inv string→object, the `stash` fold, the `discovery`
// counter→badge stack, venison→meat, golden→shiny (both the item ids and the
// released-animal flag), the shopDeals/shopOffers and tributedCastles deletes,
// and the free-wooden-tool strip. A save carrying one of those shapes now
// loads with that field inert rather than converted.
//
// The Sep 2026 pair below is deliberately KEPT: those shapes are days old, not
// years, so they belong to live players rather than to forfeit saves.
//
// Returns `needsPersist`: true iff a REAL data migration changed something and
// the save should be re-written now. Idempotent defaults (slot backfills, the
// maxEnergy re-derive, the history cap) deliberately do NOT force a persist —
// they ride along on the next save event, exactly as the original create() did.
// The scene keeps the offline-rest restoration + runtime field init around the
// call; only the pure save-shape work moves here.
//
// Depends on globals: maxEnergyFromArmor + STARTING_ENERGY (items.js). ShopsMath
// (shops_math.js) is used too, for the shop-state GC below, but that module
// loads AFTER this one in index.html — the call is runtime-guarded so a
// headless load of just this file (no ShopsMath) still works.

(function (root) {
  'use strict';

  // The save-shape generation. Bump this when a migration is ADDED, so the one
  // after it can tell which saves have already been through it — that is the
  // whole point of the field, and the thing this file spent its life without.
  const SAVE_SCHEMA = 1;

  function migrate(save) {
    let needsPersist = false;

    // --- Slot / default backfills (idempotent; don't force a persist) --------
    // Stats / equipment: add energy + relic/armor slots to older saves. The
    // slot list is RELIC_DEFS (items.js, loaded before this file) so a new
    // relic slot is backfilled the moment it is declared; the literal is only
    // for a headless load of this file on its own.
    const relicSlots = (typeof RELIC_DEFS !== 'undefined') ? Object.keys(RELIC_DEFS)
      : ['pick', 'axe', 'ring', 'amulet', 'sword', 'bow', 'staff', 'can', 'hoe', 'bugnet', 'rod', 'bags'];
    save.relics = save.relics || {};
    for (const slot of relicSlots) {
      if (save.relics[slot] === undefined) save.relics[slot] = null;
    }
    // Only one weapon fights at a time (combat.js); older saves predate the
    // choice and had all owned weapons fighting at once. Default to sword —
    // it's the one that used to auto-engage regardless of what else was
    // carried, so a veteran's combat behaviour doesn't change on this alone —
    // falling back to bow, then staff, for a save that never had a sword.
    if (save.activeWeapon === undefined) {
      save.activeWeapon = save.relics.sword ? 'sword'
        : save.relics.bow ? 'bow'
        : save.relics.staff ? 'staff'
        : null;
    }
    // Two-bar inventory: older saves predate the type-tab selector. Default the
    // active tab to Seeds and clear any gear selection.
    // Game mode (difficulty.js). A save that predates the field was played
    // with the tutorial, so it is EASY; a fresh save is left unset so the
    // how-to card can ask — Difficulty.of reads unset as easy meanwhile.
    if (save.mode === undefined && hasPlayed(save)) save.mode = 'easy';
    if (save.invCat === undefined) save.invCat = 'seed';
    if (save.selGear === undefined) save.selGear = null;
    if (save.reachUpgrades === undefined) save.reachUpgrades = 0;
    // The wizard's quantity ladder (Full Measure). Before Sep 2026 the bonus
    // it grants was the amulet's, so an old save starts this ladder at 0 —
    // the amulet keeps its stick walking and loses only the loot bonus.
    if (save.qtyUpgrades === undefined) save.qtyUpgrades = 0;
    if (save.deliveryCount === undefined) save.deliveryCount = 0;
    if (save.houseSatisfied === undefined) save.houseSatisfied = {};
    // Per-house pinned wishlist (delivery.js wantedProduce). An older save has
    // none; each house pins itself the first time its sign is read.
    if (save.houseWishlists === undefined) save.houseWishlists = {};
    if (save.discovered === undefined) save.discovered = {};
    // Self-heal: pre-fix, id-less trees pushed `undefined` into save.chopped,
    // and a choppedSet.has(undefined) match wiped whole groves. Strip falsy ids.
    if (Array.isArray(save.chopped)) {
      const cleaned = save.chopped.filter((id) => !!id);
      if (cleaned.length !== save.chopped.length) save.chopped = cleaned;
    }
    // Per-shop bucket state; offerSalt is a once-per-save random so identical
    // worlds differ across players. (This replaced shopDeals/shopOffers, whose
    // deletes retired with the rest of the pre-schema migrations.)
    if (!save.shopState) {
      save.shopState = {};
      save.offerSalt = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
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
    // Restored-houses / forts default to empty objects.
    if (!save.restoredHouses || typeof save.restoredHouses !== 'object') save.restoredHouses = {};
    if (!save.unlockedForts || typeof save.unlockedForts !== 'object') save.unlockedForts = {};
    if (!save.openedCastles || typeof save.openedCastles !== 'object') save.openedCastles = {};
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

    // --- Data migrations (these DO force a persist) --------------------------
    // COBBLE TRAILS → STREET RESTORATION. Two old shapes go, one new one
    // arrives. The save now reads:
    //   save.trail        = { metres: <banked toward the current goal>, prizes: n,
    //                         greeted: <shown the first-repair dialog> }
    //   save.streets      = { "<z/tx/ty>": { "<lineKey>": [s0,s1, s0,s1, …] } }
    //   save.streetsEpoch = n
    // — the restored stretches of each street as flat pairs of arclength in
    // METRES along one line of one OSM way (src/streets.js owns the shape and
    // is the ONLY thing that should read it).
    //
    // The ladder counted lit PEBBLES — one sprite per 20 m of way, the
    // spacing the renderer thinned them to — and is measured in metres now
    // (src/trail.js), so a veteran's banked count is multiplied by the
    // spacing it was earned at. That is the same walk they actually made, and
    // the same rungs: ten stones and 200 m are one number stated two ways, so
    // prizes and progress both carry across untouched.
    //
    // save.pathStones — WHICH pebble cells were lit — does not map onto the
    // new shape at all, so it is dropped rather than guessed at. A restored
    // stretch is float arclength along a line; a set of cell keys cannot say
    // which metres of which way they came from (a cell knows nothing about
    // the way that crossed it, and the grid under-reports a road band by a
    // cell either side anyway — the road rule in CLAUDE.md). The streets are
    // simply there to restore again; what the ladder already PAID is kept,
    // which is the part that cost the player something.
    const OLD_STONE_M = 20;
    if (save.trail && save.trail.stones !== undefined) {
      const stones = Number.isFinite(save.trail.stones) ? Math.max(0, save.trail.stones) : 0;
      const had = Number.isFinite(save.trail.metres) ? save.trail.metres : 0;
      save.trail.metres = had + stones * OLD_STONE_M;
      delete save.trail.stones;
      needsPersist = true;
    }
    if (save.pathStones !== undefined) {
      delete save.pathStones;
      needsPersist = true;
    }
    if (!save.trail || typeof save.trail !== 'object') save.trail = { metres: 0, prizes: 0 };
    if (!Number.isFinite(save.trail.metres)) save.trail.metres = 0;
    if (!Number.isFinite(save.trail.prizes)) save.trail.prizes = 0;
    // save.trail.greeted — has this player been shown the one-time "you start
    // repairing roads" dialog (app.js TRAIL_INTRO_TITLE). A save that has
    // ALREADY walked the ladder is marked greeted rather than being introduced
    // to a loop it is halfway up; only a save with nothing banked is new.
    if (save.trail.greeted === undefined) {
      save.trail.greeted = (save.trail.metres > 0 || save.trail.prizes > 0);
      needsPersist = true;
    }
    if (!save.streets || typeof save.streets !== 'object') save.streets = {};
    // Rename: flute → honey. The lure consumable was renamed (Sep 2026) because
    // a flute that vanishes after one tune read wrong; a jar of honey the
    // animals eat does not. Same lure, same price.
    //
    // The rebuild is guarded on actually FINDING a flute, which the venison
    // fold that used to sit here was not — and since save.selSlot is a
    // positional index into save.inv, that unguarded rebuild silently moved
    // the player's selection on every boot of every save carrying meat. A
    // migration that rewrites the bag must not run when it has nothing to do.
    if (Array.isArray(save.inv) && save.inv.some((s) => s && s.id === 'flute')) {
      const byId = new Map();
      const out = [];
      for (const s of save.inv) {
        if (!s) continue;
        const id = s.id === 'flute' ? 'honey' : s.id;
        if (id !== s.id) needsPersist = true;
        const prev = byId.get(id);
        if (prev) { prev.count = (prev.count ?? 0) + (s.count ?? 0); }
        else { const ns = { ...s, id }; byId.set(id, ns); out.push(ns); }
      }
      save.inv = out;
    }
    // Stamp the save-shape generation (see SAVE_SCHEMA). A save that reaches
    // here has been through every migration this build carries, so the next
    // retirement can read the number instead of guessing at the shape.
    if (save.schema !== SAVE_SCHEMA) {
      save.schema = SAVE_SCHEMA;
      needsPersist = true;
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

  root.SaveMigrate = { migrate, hasPlayed };
})(typeof globalThis !== 'undefined' ? globalThis : this);
