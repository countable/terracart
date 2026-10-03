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
// and items.js (wreckRestoreQty) - all resolved
// at CALL time, so load order only needs this module after those modules (and
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

  // WHAT A WRECK CAN BECOME is the player's pick (Oct 2026, owner's call —
  // until then a fixed opening run and the OSM address digit decided). The
  // cards unlock by how many wrecks already stand, in the order a player can
  // use them: the first rebuild offers only a House, the second adds the
  // Blacksmith, the third a Shop, the fifth a Trader, the eighth a Turret;
  // the Book Shop is on offer from the fifteenth (once), the Wizard Tower from
  // the thirtieth, and his second tower from the fifty-second once the first
  // stands and 21 memories are home (MemoryStory LEAVE_MEMORIES — the first
  // tower is abandoned by then). Nothing is forced: a lane with no smithy has
  // no wooden tools, which is the player's own call (the Blacksmith card is
  // `suggested` until one stands). Numbers are 1-based RESTORE NUMBERS ("the
  // 2nd rebuild may be a Blacksmith"); `earlyMending` and `childHome` are the
  // story's restoration-count gates (memory_story.js).
  const STORY_RESTORES = Object.freeze({
    house: 1, blacksmith: 2, market: 3, trader: 5, turret: 8, bookshop: 15,
    firstTower: 30, secondTower: 52, earlyMending: 2, childHome: 1,
  });
  // Old unstamped saves retain the tower identities their original schedule
  // gave them (wizardTowerIds): restore index 14 was the first tower, 25+ the second.
  const LEGACY_FIRST_TOWER_INDEX = 14, LEGACY_SECOND_TOWER_INDEX = 25;

  // ONE TABLE for every card on the restore modal and for the Restored! card
  // that follows: the role string frozen into save.restoredHouses[id] (the
  // one thing every renderer, shop and story reader consults), the restore
  // number it unlocks at (`from`), the painting and the Restored! card's
  // blurb (the pick card itself shows only the name and rarity badge). The
  // player-facing NAME is Shops.roleLabel (the sign, the card and the offer
  // modal call it the same thing); `name` overrides it where the label is a
  // line, not a building.
  //   bookshop — stored as a 'market' plus save.bookshopId (shops.js lineFor
  //              sells the Book line off that stamp), so old readers of the
  //              role string never meet a new one.
  //   turret   — a single castle tower on a house lot: it draws the castle
  //              tower sheet (render.js houseTextureKey) and its archer
  //              fires through the castle turret lane (app.js _turretFire).
  //   wizard   — Tim's tower; `offered` reads the tower ledger and the
  //              memory ledger, never a count of its own.
  // `tier(save, order)` is the rank the pick would carry (the badge on its
  // card and on the Restored! card): a shop's line tier, the next smithy's
  // tier, a trader's by restore number — all shops.js shopTier's arithmetic.
  // `variants(save, order)` splits a row into several cards (the Shop row,
  // one per line on offer); each variant's fields lie over the row's.
  const BUILD_OPTIONS = Object.freeze([
    { key: 'plain', role: 'plain', from: STORY_RESTORES.house, name: 'House', art: 'restore_house',
      blurb: 'Children choose their beds under the repaired roof. Their parent offers to buy your harvest.' },
    // ONE SMITHY PER TIER (shops.js smithTier): the Nth blacksmith is tier N,
    // and after the first (the ladder's own slot) the next is offered only
    // from restore number N × SMITH_TIER_EVERY — a T2 smith from the tenth.
    { key: 'blacksmith', role: 'blacksmith', from: STORY_RESTORES.blacksmith, art: 'restore_blacksmith',
      blurb: 'A family returns to the forge. They offer to make the tools you need.',
      tier: (save) => Shops.nextSmithTier(save),
      offered: (save, order) => {
        const t = Shops.nextSmithTier(save);
        return t === 1 ? true : Shops.smithCount(save) < Shops.SHOP_TIER_MAX && order + 1 >= Shops.smithUnlockAt(t);
      },
      suggested: (save) => !hasBlacksmith(save) },
    // The Shop row is one card per LINE on offer (shops.js marketOffers: the
    // cycle's next line, then from the ninth rebuild a rotating pair), each a
    // variant with its `theme`; restoreAs stores the pick in save.shopLines.
    { key: 'market', role: 'market', from: STORY_RESTORES.market, art: 'restore_market',
      blurb: 'A family opens the market shutters again. ',
      variants: (save, order) => Shops.marketOffers(save, order).map(({ theme, tier }) =>
        ({ key: 'market:' + theme, theme, tier: () => tier })) },
    // Traders take the tier of the restore number that raises them (shops.js
    // traderTierAt): any number at a tier, a rank higher every five rebuilds.
    { key: 'trader', role: 'trader', from: STORY_RESTORES.trader, art: 'restore_trader',
      blurb: 'The trader and his family unpack beside the hearth. They offer to share their supplies.',
      tier: (save, order) => Shops.traderTierAt(order + 1) },
    { key: 'turret', role: 'turret', from: STORY_RESTORES.turret, art: 'castle_claim',
      blurb: 'Masons raise a single tower on the old footings. An archer climbs to the battlement and strings a bow.' },
    { key: 'bookshop', role: 'market', from: STORY_RESTORES.bookshop, name: 'Book Shop', art: 'restore_market',
      blurb: 'A family opens the market shutters again. Shelves of books line the walls.',
      offered: (save) => save.bookshopId == null },
    { key: 'wizard', role: 'wizard', from: STORY_RESTORES.firstTower, name: 'Wizard Tower', art: 'restore_wizard',
      blurb: 'You step into the tower. An old wizard asks about your memories.',
      offered: (save, order) => {
        const towers = wizardTowerIds(save);
        if (!towers.firstId) return true;
        return !towers.secondId && order >= STORY_RESTORES.secondTower - 1
          && Object.keys(save.discovered || {}).length >= 21;
      } },
  ]);
  const buildOption = (key) => BUILD_OPTIONS.find((row) => row.key === key) || null;
  // How many wrecks already stand: the 0-based restore ORDER of the next one.
  function restoredCount(save) { return Object.keys(save?.restoredHouses || {}).length; }
  // The cards on offer for the next restore. Pure: reads the ledgers, never
  // writes. The first restore offers one card (the House), so the modal
  // reads as the plain price tag it always was.
  function buildOptions(save, house, order = restoredCount(save)) {
    save = save || {};
    const out = [];
    for (const row of BUILD_OPTIONS) {
      if (order < row.from - 1 || (row.offered && !row.offered(save, order, house))) continue;
      if (row.variants) for (const v of row.variants(save, order)) out.push({ ...row, ...v });
      else out.push(row);
    }
    return out;
  }

  // THE MAGIC HAMMER (owner, Oct 2026): a T4 magic item (items.js) spent on a
  // restore. The wreck raised under it is SHINY — it glints and glows like a
  // shiny tree (render.js, Lighting.KINDS.shiny) — and everything its keepers
  // sell is HAMMER_PRICE_MUL of the quoted price, for good (save.shinyHouses,
  // an id set like the rest of the player's marks). It is the one standing
  // discount a BUILDING carries: the relic-tier price bends are gone (items.js
  // buyMarkupRange). The flower charm's hour and a carried guild badge
  // (items.js guildDiscounted) still stack on top.
  // A SHINY TURRET (owner, Oct 2026) fights harder instead: its arrows deal
  // double (Combat.turretShot reads the shine through the same powerMul a
  // shiny creature does) and fly as light (Combat.SHINY_ARROW_COLOR, the
  // bolt lane in lighting.js collectBolts). A plain HOUSE takes no hammer at
  // all (hammerTakes): it sells nothing and shoots nothing, so there would
  // be nothing for the shine to do — the dialog's With Hammer button sits
  // disabled on that card, and restoreAs will not stamp it.
  const HAMMER_ID = 'magic_hammer';
  const HAMMER_PRICE_MUL = 0.8;
  // Can this card be raised under the hammer? Every role that trades or
  // fights; never the plain House.
  function hammerTakes(row) {
    return !!row && row.role != null && row.role !== 'plain';
  }
  function isShinyHouse(save, house) {
    return !!(house && house.id != null && save && save.shinyHouses && save.shinyHouses[house.id]);
  }
  // Every price a building quotes multiplies by this: the hammer's standing
  // cut times the flower charm's hour — buildShopOffer, presentRelicOffer and
  // the trader's asking target all read it.
  function priceMul(save, house, now = Date.now()) {
    return shopCharmMul(save, house, now) * (isShinyHouse(save, house) ? HAMMER_PRICE_MUL : 1);
  }

  // Wooden-tool blacksmith: the FIRST blacksmith the player raises (stamped
  // save.starterBlacksmithId by restoreAs) forges T1 tools out of a flat 5
  // wood each (see starterBlacksmithRecipe), then falls through to the
  // normal relic forge once the bootstrap pair is owned.
  function isStarterBlacksmith(save, house) {
    if (!house || !house.id) return false;
    return save.starterBlacksmithId != null
      && save.starterBlacksmithId === house.id;
  }

  // The role a (restored) house plays: 'blacksmith' | 'trader' | 'market'
  // | 'wizard' | 'turret', or null for a plain residential house. Single
  // source of truth for both the renderer and the interaction handler. Once a
  // wreck is restored its role is frozen into save.restoredHouses[id] as a
  // role string and read straight back here. Legacy `true` entries (saved
  // before role-freezing, and the sandbox's) and any house consulted before
  // restore fall back to the address-derived Shops.shopType, plus the
  // starter blacksmith.
  function houseShopRole(save, house) {
    if (!house || house.kind !== 'house') return null;
    const stored = save.restoredHouses && save.restoredHouses[house.id];
    if (typeof stored === 'string') return stored === 'plain' ? null : stored;
    if (save.starterBlacksmithId && save.starterBlacksmithId === house.id) return 'blacksmith';
    return (typeof Shops !== 'undefined' && Shops.shopType(house)) || null;
  }

  // The guild whose badge discounts deals at `place` (items.js
  // guildDiscounted): a house's role, or a peddling neighbour's — a merchant
  // keeps a themed shop (role key 'market'), a trader barters.
  const NPC_GUILD = { merchant: 'market', trader: 'trader' };
  function guildRole(save, place) {
    if (place?.kind === 'npc') return NPC_GUILD[place.role] || null;
    return houseShopRole(save, place);
  }

  // Does this save have a smithy? The stamped starter smithy, or any restored
  // house frozen as one.
  function hasBlacksmith(save) {
    if (save.starterBlacksmithId != null) return true;
    return Object.values(save.restoredHouses || {}).includes('blacksmith');
  }

  // RESTORE THIS WRECK AS THE PICKED CARD. The one writer of the restoration
  // ledger: freezes the row's role onto the house, then stamps what the pick
  // owns — the first blacksmith (starterBlacksmithId), the Book Shop
  // (bookshopId), a wizard tower (wizardTowers). Refuses (null) a card not on
  // offer, so a stale modal can't raise a tower early. Returns the row.
  // `opts.hammer` marks the house shiny (the caller spends the Magic Hammer).
  function restoreAs(save, house, key, opts = {}) {
    if (!house || house.id == null) return null;
    const row = buildOptions(save, house).find((r) => r.key === key);
    if (!row) return null;
    save.restoredHouses = save.restoredHouses || {};
    if (typeof save.restoredHouses[house.id] === 'string') return null;   // never relabel a restored house
    save.restoredHouses[house.id] = row.role;
    if (row.theme) (save.shopLines = save.shopLines || {})[house.id] = row.theme;
    if (opts.hammer && hammerTakes(row)) (save.shinyHouses = save.shinyHouses || {})[house.id] = 1;
    if (row.role === 'blacksmith' && save.starterBlacksmithId == null) save.starterBlacksmithId = house.id;
    if (row.key === 'bookshop') registerBookshop(save, house);
    if (row.role === 'wizard') registerWizardTower(save, house);
    return row;
  }

  // Identity is separate from shop art: old saves can contain extra randomly
  // assigned wizard buildings, which must not become additional story doors.
  // The ledger's insertion order is the same restore order used by the shop
  // schedule. Queries never mutate a save; restoration freezes the result.
  function wizardTowerIds(save) {
    const stamped = save.wizardTowers || {};
    if (stamped.firstId && Object.prototype.hasOwnProperty.call(stamped, 'secondId')) return { firstId: stamped.firstId, secondId: stamped.secondId };
    const entries = Object.entries(save.restoredHouses || {});
    const firstId = stamped.firstId || (entries[LEGACY_FIRST_TOWER_INDEX]?.[1] === 'wizard'
      ? entries[LEGACY_FIRST_TOWER_INDEX][0] : entries.find(([, role]) => role === 'wizard')?.[0]) || null;
    const secondId = stamped.secondId || (firstId && Object.keys(save.discovered || {}).length >= 21
      ? entries.find(([id, role], order) => order >= LEGACY_SECOND_TOWER_INDEX && role === 'wizard' && id !== firstId)?.[0]
      : null) || null;
    return { firstId, secondId };
  }

  function wizardTowerIdentity(save, house) {
    if (!house || house.id == null) return null;
    const towers = wizardTowerIds(save);
    const id = String(house.id);
    if (id === towers.firstId) return 'first';
    if (id === towers.secondId) return 'second';
    return null;
  }

  // Stamp the Book Shop (save.bookshopId): the market the player picked the
  // Book Shop card for — once per save (the card leaves the offer once it is
  // stamped). A save that restored a market before the card existed is
  // never re-labelled; its next pick is the one.
  function registerBookshop(save, house) {
    if (save.bookshopId != null || house?.id == null) return save.bookshopId ?? null;
    if (save.restoredHouses?.[house.id] !== 'market') return null;
    save.bookshopId = String(house.id);
    return save.bookshopId;
  }
  // Stamp a tower the player just raised: the first if none stands, else the
  // second. Whether a second may be raised at all is the wizard card's
  // `offered` rule (BUILD_OPTIONS), checked by restoreAs before this runs.
  function registerWizardTower(save, house) {
    const towers = wizardTowerIds(save);
    if (house?.id != null && save.restoredHouses?.[house.id] === 'wizard') {
      const id = String(house.id);
      if (!towers.firstId) towers.firstId = id;
      else if (!towers.secondId && id !== towers.firstId) towers.secondId = id;
    }
    save.wizardTowers = towers;
    return towers;
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

  // isHouseWreck routes taps to restoration and is also the display owner's
  // wreck verdict. Keeping both consumers on this predicate prevents a fort or
  // castle-shaped house from wearing wreck art.
  function isHouseWreck(save, house) {
    if (!house || house.kind !== 'house') return false;
    if (house.tier !== 9) return false;   // forts (11) + castles (12) skip wreck
    if (save.starterShopId && save.starterShopId === house.id) return false;
    return !save.restoredHouses?.[house.id];
  }

  // Resolve the one role every visual surface reads. Home wins before tier so
  // a starter building always keeps its trailer identity; isHouseWreck owns
  // whether a tier-9 house still needs restoration; houseShopRole then names
  // the frozen shop behind a restored facade.
  function displayRole(save, house) {
    save = save || {};
    if (!house || house.kind !== 'house') return null;
    if (save.starterShopId && save.starterShopId === house.id) return 'trailer';
    if (house.tier === 11) return 'fort';
    if (isHouseWreck(save, house)) return 'wreck';
    return houseShopRole(save, house) || 'plain';
  }

  // Restoration cost: stone (rockfruit — wild residential debris, gatherable
  // bare-handed): 2 for the first rebuild, one more per three houses already
  // restored, capped at 20 (wreckRestoreQty in items.js). A whole price, so
  // the dialog's quote is the accept's charge. Themed shops and plain
  // residential alike rebuild from the same masonry.
  function wreckRestoreCost(save, house) {
    const restored = Object.keys(save?.restoredHouses || {}).length;
    return { id: 'rockfruit', qty: wreckRestoreQty(restored), material: 'stone' };
  }
  // WHAT EACH CARD COSTS (owner, Oct 2026). A House — and the wizard's tower,
  // a story building — keeps the ladder above. A shop is priced by the rank
  // its card wears (the row's `tier`, the same badge the pick shows): this
  // many stones PER TIER, one row per role; the Book Shop is a market at
  // tier 1. A turret is a flat TURRET_ROCKS. `row` is a buildOptions card.
  const BUILD_ROCKS_PER_TIER = Object.freeze({ trader: 2, market: 3, blacksmith: 4 });
  const TURRET_ROCKS = 5;
  function buildCost(save, house, row, order = restoredCount(save)) {
    if (!row || row.role === 'plain' || row.role === 'wizard') return wreckRestoreCost(save, house);
    if (row.role === 'turret') return { id: 'rockfruit', qty: TURRET_ROCKS, material: 'stone' };
    const per = BUILD_ROCKS_PER_TIER[row.role];
    if (!per) return wreckRestoreCost(save, house);
    const tier = Math.max(1, (typeof row.tier === 'function' ? row.tier(save, order) : 1) | 0);
    return { id: 'rockfruit', qty: per * tier, material: 'stone' };
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

  // The castle's favour, gated to once per castle per CASTLE_SERVICE_MS —
  // twelve hours (Sep 2026, owner's call: it was once per UTC day, and it is
  // the ONE timer left on any building the player trades at; shops never
  // wait — shops_math.js header). save.castleServiceClaimed[key] holds the
  // ms stamp of the last favour; anything else is no stamp (and is pruned).
  const CASTLE_SERVICE_MS = 12 * 60 * 60 * 1000;
  function _stampWaitMs(stamp, now) {
    if (typeof stamp !== 'number') return 0;
    return Math.max(0, stamp + CASTLE_SERVICE_MS - now);
  }
  // Milliseconds until this castle's favour is on offer again (0 = now). The
  // one number its refusal and its blurb print (shortDuration).
  function castleServiceWaitMs(save, house, now = Date.now()) {
    const key = castleKey(house);
    return key ? _stampWaitMs(save.castleServiceClaimed?.[key], now) : 0;
  }
  function castleServiceUsed(save, house, now = Date.now()) {
    return castleServiceWaitMs(save, house, now) > 0;
  }
  function markCastleServiceUsed(save, house, now = Date.now()) {
    const key = castleKey(house);
    if (!key) return;
    save.castleServiceClaimed = save.castleServiceClaimed || {};
    // Prune every OTHER castle's spent stamp while we're here — the map
    // can't grow without bound across weeks of play.
    for (const k of Object.keys(save.castleServiceClaimed)) {
      if (k !== key && !_stampWaitMs(save.castleServiceClaimed[k], now)) delete save.castleServiceClaimed[k];
    }
    save.castleServiceClaimed[key] = now;
  }

  root.Houses = {
    STORY_RESTORES, BUILD_OPTIONS, buildOption, buildOptions, restoredCount, restoreAs,
    BUILD_ROCKS_PER_TIER, TURRET_ROCKS, buildCost,
    HAMMER_ID, HAMMER_PRICE_MUL, hammerTakes, isShinyHouse, priceMul,
    isStarterBlacksmith, houseShopRole, displayRole, hasBlacksmith,
    wizardTowerIds, wizardTowerIdentity, registerWizardTower, registerBookshop,
    shopCharmMul,
    guildRole,
    isHouseWreck, wreckRestoreCost,
    fortUnlockCost, isFortLocked,
    castleKey, isBuildingSealed, isClaimedKey, isCastleClaimed, claimCastle,
    CASTLE_SERVICE_MS, castleServiceWaitMs, castleServiceUsed, markCastleServiceUsed,
  };
})(typeof window !== 'undefined' ? window : globalThis);
