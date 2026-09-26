// House/building identity and role core — starter blacksmith, restored-house
// shop roles, wreck restoration, fort unlocking and castle claiming, extracted
// from app.js so they're testable headlessly (no scene, no DOM).
//
// This is NOT the shop pricing/scheduling engine (shops_math.js ShopsMath) nor
// the OSM-address → role lookup (shops.js Shops.shopType) — this module is
// "what IS this building, and has the player made it theirs", the layer those
// two sit on top of. It is also not quest/quest-board logic (quests.js) — a
// castle's seal defers to the quest board (Scene.showQuestBoard) rather than
// deciding anything about quests itself.
//
// Depends on globals from interactables.js (isCastle), shops.js (Shops),
// delivery.js (Delivery.dayKey) and items.js (wreckRestoreQty) — all resolved
// at CALL time, so load order only needs this module after those three (and
// after shops_math.js, which shops.js itself depends on).
//
// FORT_UNLOCK_WOOD / FORT_UNLOCK_WOOD_START / FORT_UNLOCK_WOOD_STEP are kept as
// top-level (lexical, not just Houses.*) consts because the browser test
// harness (test/tests.js) reads them by bare name — see
// test/node/lexical_globals.test.js for why a top-level const can't be reached
// as root.X/window.X instead.

// A fort, by contrast, is unsealed with materials — like restoring a wreck
// house, the player pays a one-time stack of wood to open the quartermaster.
// Recorded per-fort in save.unlockedForts.
//
// The wood price ALSO FOLLOWS A PROGRESSION: the first fort you unseal costs
// FORT_UNLOCK_WOOD_START (6) wood and each later fort steps up by
// FORT_UNLOCK_WOOD_STEP (6) — 6, 12, 18, 24, 30 … — capped at FORT_UNLOCK_WOOD
// (30). The step index is "how many forts already unsealed" (save.unlockedForts).
const FORT_UNLOCK_WOOD = 30;
const FORT_UNLOCK_WOOD_START = 6;
const FORT_UNLOCK_WOOD_STEP = 6;

(function (root) {
  'use strict';

  // Pre-seeded house roles by RESTORE ORDER (0-based). Rather than skinning the
  // two nearest houses as blacksmith/trader up front, a wreck reveals its role
  // from the order the player restores it: the opening stretch is a fixed
  // tutorial run (blacksmith, trader, house, market) and the 15th
  // restore is always a wizard tower. Restores BEYOND these slots fall back to
  // the address-derived Shops.shopType so the wider neighbourhood keeps its
  // organic variety. 'plain' === a plain residential house (no shop). The chosen
  // role is frozen into save.restoredHouses[id] at restore time so it never
  // shifts on later loads.
  const PRESEED_RESTORE_ROLES = {
    0:  'blacksmith',
    1:  'trader',
    2:  'plain',
    3:  'market',
    14: 'wizard',   // the 15th restored wreck is a wizard tower
  };

  // Wooden-tool blacksmith. The house closest to Home (the starter shop)
  // is forced to be a Blacksmith that forges T1 pick / axe / hoe out of
  // a flat 5 wood each (see starterBlacksmithRecipe).
  // Memoized once like starterShopId so reloads + roaming keep the same shop.
  // Falls through to the normal random-relic forge once all three wooden
  // tools have been crafted — the smithy keeps doing useful business.
  function isStarterBlacksmith(save, house) {
    if (!house || !house.id) return false;
    // The starter blacksmith is now whichever wreck is restored FIRST (it gets
    // the 'blacksmith' role + this id stamped at restore time — see
    // presentWreckRestoreModal). No longer force-anchored to the nearest house,
    // so there's no lazy nearest-house resolution here.
    return save.starterBlacksmithId != null
      && save.starterBlacksmithId === house.id;
  }

  // The shop role a (restored) house plays: 'blacksmith' | 'trader' | 'market'
  // | 'wizard', or null for a plain residential house. Single source of truth
  // for both the renderer and the interaction handler. Once a wreck is restored
  // its role is frozen into save.restoredHouses[id] as a role string and read
  // straight back here. Legacy `true` entries (saved before role-freezing) and
  // any house consulted before restore fall back to the address-derived
  // Shops.shopType, plus the first-restored starter blacksmith.
  function houseShopRole(save, house) {
    if (!house || house.kind !== 'house') return null;
    const stored = save.restoredHouses && save.restoredHouses[house.id];
    if (typeof stored === 'string') return stored === 'plain' ? null : stored;
    if (save.starterBlacksmithId && save.starterBlacksmithId === house.id) return 'blacksmith';
    return (typeof Shops !== 'undefined' && Shops.shopType(house)) || null;
  }

  // Does this save have a smithy? The stamped starter smithy, or any restored
  // house frozen as one (a later address-9 house counts too).
  function hasBlacksmith(save) {
    if (save.starterBlacksmithId != null) return true;
    return Object.values(save.restoredHouses || {}).includes('blacksmith');
  }

  // Resolve the role a wreck reveals when restored, given its 0-based restore
  // order. Fixed tutorial slots (PRESEED_RESTORE_ROLES) win; everything else
  // defers to the address-derived shop type so the neighbourhood keeps its
  // variety. Always returns a concrete role string ('plain' for a house).
  function preseedRestoreRole(save, order, house) {
    // A save with NO blacksmith gets one on its next rebuild, whatever slot
    // that is. Slot 0 is the smithy, so a new save never needs this — but a
    // save whose first rebuilds predate the restore-order roles (or any other
    // path that left it without one) would otherwise never meet the forge.
    if (!hasBlacksmith(save)) return 'blacksmith';
    if (Object.prototype.hasOwnProperty.call(PRESEED_RESTORE_ROLES, order)) {
      return PRESEED_RESTORE_ROLES[order];
    }
    return (typeof Shops !== 'undefined' && Shops.shopType(house)) || 'plain';
  }

  // Flower charm: 0.5 while this building holds an unexpired charm (bought
  // with a Flowers gift — see the flower-gift branch in shopInteract), else 1.
  // Every cash price a shop quotes multiplies by this in one of two places:
  // buildShopOffer (seed/produce storefronts) and presentRelicOffer (castle /
  // relic-swap offers).
  function shopCharmMul(save, house, now = Date.now()) {
    const until = house && house.id != null && save.shopCharm
      ? save.shopCharm[house.id] : 0;
    return until && now < until ? 0.5 : 1;
  }

  // by shopInteract to route to the restore modal and by the render layer
  // indirectly via save.restoredHouses (see _houseRole in render.js).
  function isHouseWreck(save, house) {
    if (!house || house.kind !== 'house') return false;
    if (house.tier !== 9) return false;   // forts (11) + castles (12) skip wreck
    if (save.starterShopId && save.starterShopId === house.id) return false;
    return !save.restoredHouses?.[house.id];
  }

  // Restoration cost: stone (rockfruit — wild residential debris, gatherable
  // bare-handed): 1 for the first rebuild, one more per house already
  // restored, capped at 20 (wreckRestoreQty in items.js). A whole price, so
  // the dialog's quote is the accept's charge. Themed shops and plain
  // residential alike rebuild from the same masonry.
  function wreckRestoreCost(save, house) {
    const restored = Object.keys(save?.restoredHouses || {}).length;
    return { id: 'rockfruit', qty: wreckRestoreQty(restored), material: 'stone' };
  }

  // Wood this fort demands to unseal, following the per-fort progression
  // (see FORT_UNLOCK_WOOD_START): START + STEP×(forts already unsealed), capped
  // at FORT_UNLOCK_WOOD. A locked fort isn't yet in save.unlockedForts, so the
  // map's size is the 0-based index of the fort about to be paid for.
  function fortUnlockCost(save) {
    const unlocked = Object.keys(save.unlockedForts || {}).length;
    return Math.min(
      FORT_UNLOCK_WOOD_START + FORT_UNLOCK_WOOD_STEP * unlocked,
      FORT_UNLOCK_WOOD,
    );
  }

  // True iff `house` is a fort the player hasn't unsealed yet. Forts (tier 11)
  // open with a one-time wood payment (FORT_UNLOCK_WOOD), tracked per-fort in
  // save.unlockedForts — the wood analogue of isHouseWreck for tier-9 homes.
  function isFortLocked(save, house) {
    if (!house || house.tier !== 11) return false;
    return !save.unlockedForts?.[house.id];
  }

  // WHICH CASTLE this is. A castle emits no house object of its own — it is a
  // block of tier-12 cells with a scatter of `tower` objects round its rim,
  // one per ~5 perimeter cells, each carrying its own id. So a tower id names
  // A TURRET, not a castle, and anything recorded against one made the same
  // castle read as claimed from one corner and unclaimed from another.
  // worldgen stamps every turret with its footprint's stable key (`castle`);
  // that is the only thing that means "this castle".
  function castleKey(house) {
    return (house && house.castle) || null;
  }

  // True iff `house` is a castle still sealed: a castle opens by solving the
  // job on ITS quest board and nothing else. (Until Sep 2026 a lifetime
  // delivery tally of 2..5 also unsealed it, left behind when the quest board
  // replaced that gate — so five deliveries opened every castle in the world
  // and the board was skipped. Reaching a delivery count is a quest VERB now,
  // quests.js 'deliver', never a gate of its own.)
  function isBuildingSealed(save, house) {
    if (!house || !isCastle(house)) return false;
    // Claimed outright — the player solved a quest at THIS castle, so it is
    // theirs for good and the quest board never comes back here.
    if (isCastleClaimed(save, house)) return false;
    // A save that finished the old global three-quest chain had every castle
    // open; the per-castle seal must not take that back (see the migration in
    // quests.js _qs).
    if (save.castlesLegacyOpen) return false;
    // A castle opened under the retired delivery gate stays open — the same
    // courtesy castlesLegacyOpen pays the old chain. Read-only: nothing
    // writes save.openedCastles any more.
    if (house.id && save.openedCastles?.[house.id]) return false;
    // PER CASTLE, now that the board never runs dry. This was global — finish
    // the three-quest chain and every castle in the world opened at once —
    // which was the only thing it could be while there were exactly three
    // quests. With a generator behind the board there is always a job at every
    // castle, so each one is earned where it stands.
    return true;
  }

  // IS THE BUILDING UNDER THIS CELL THE PLAYER'S? One predicate over every way
  // a building can become yours, keyed by whatever worldgen stamped on the
  // cell (see ownerKeys): a house by its own id, a fort by its own id, a
  // castle by its footprint key. Home counts however it was adopted — a real
  // house or the synthetic trailer.
  //
  // Everything else is somebody else's, and the renderer washes it toward
  // dark green so the map reads at a glance as what you have taken back.
  function isClaimedKey(save, key) {
    if (!key) return false;
    const sv = save;
    if (sv.starterShopId && sv.starterShopId === key) return true;   // Home
    if (sv.restoredHouses && sv.restoredHouses[key]) return true;    // rebuilt wreck
    if (sv.unlockedForts && sv.unlockedForts[key]) return true;      // unsealed fort
    if (sv.claimedCastles && sv.claimedCastles[key] != null) return true;
    return false;
  }

  // Has the player solved a quest AT this castle? Claiming is per castle and
  // permanent: the vault opens, the banner goes up, and the quest board never
  // comes back here — the next job is somewhere else, which is what makes the
  // map worth walking.
  function isCastleClaimed(save, house) {
    const key = castleKey(house);
    // PRESENCE, not truthiness: the value is the last hearth draw and a castle
    // claimed but never drawn from stores 0, which is falsy.
    return !!key && save.claimedCastles?.[key] != null;
  }

  // Record the claim. Stores the last hearth draw (0 = never drawn), so the
  // one map carries both "is it claimed" and "when did it last feed you".
  function claimCastle(save, house) {
    const key = castleKey(house);
    if (!key) return false;
    save.claimedCastles = save.claimedCastles || {};
    if (save.claimedCastles[key] != null) return false;
    save.claimedCastles[key] = 0;
    return true;
  }

  // The castle's daily favour, gated to once per castle per UTC day. Reuses
  // the scene's one day key (Delivery.dayKey) rather than the
  // coin-burst POI's composite-key idiom, since there's only ever one thing to
  // remember per castle: the day its service was last used.
  function castleServiceUsedToday(save, house, now = new Date()) {
    const key = castleKey(house);
    return !!key && save.castleServiceClaimed?.[key] === Delivery.dayKey(now);
  }
  function markCastleServiceUsed(save, house, now = new Date()) {
    const key = castleKey(house);
    if (!key) return;
    const dayKey = Delivery.dayKey(now);
    save.castleServiceClaimed = save.castleServiceClaimed || {};
    // Prune every OTHER castle's stale day stamp while we're here — the map
    // can't grow without bound across weeks of play.
    for (const k of Object.keys(save.castleServiceClaimed)) {
      if (save.castleServiceClaimed[k] !== dayKey) delete save.castleServiceClaimed[k];
    }
    save.castleServiceClaimed[key] = dayKey;
  }

  root.Houses = {
    PRESEED_RESTORE_ROLES,
    isStarterBlacksmith, houseShopRole, hasBlacksmith, preseedRestoreRole,
    shopCharmMul,
    isHouseWreck, wreckRestoreCost,
    fortUnlockCost, isFortLocked,
    castleKey, isBuildingSealed, isClaimedKey, isCastleClaimed, claimCastle,
    castleServiceUsedToday, markCastleServiceUsed,
  };
})(typeof window !== 'undefined' ? window : globalThis);
