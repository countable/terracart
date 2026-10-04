// Chest / treasure / wild-debris loot logic + POI category mapping + the
// rustic name transform. Extracted from app.js so the loot tables live next
// to one another and away from rendering / scene code.
//
// Depends on:
//   items.js (itemTierOf — lootFlashColor's tier for any item id). The 'flora'
//   category below is just a POI-category label (florist/garden/garden_centre)
//   that picks the chest's theme (chest_themes.js) — magical flower seeds are
//   gated by BASE_TIER in items.js, not a dedicated flower-id set here.
//
// Exports as globals:
//   RUSTIC_WORDS, POI_CLASS_FALLBACK, rusticifyName
//   POI_CATEGORY, CHEST_THEME_BY_POI, chestThemeForPoi, chestThemeFor
//   PAD_CATEGORIES, padShapeKeyForPoi
//   CHEST_DENSITY_T1_AT, CHEST_TIER_UNSTAMPED,
//   CHEST_TIER_COLOR,
//   CHEST_TIER_MAX, chestTierMaxFor, CHEST_TIER_DEPTH_STEP, CHEST_CAVE_SKIP_CATEGORIES,
//   chestBaseTier, chestTierDepthBonus, chestTier,
//   chestMirrorsUnderground, CRATE_RESTORE_PER, CRATE_RESTORE_MAX_DAYS,
//   crateRestoreDays, BARREL_CLASSES, BARREL_LOOT, CLAY_POT_LOOT,
//   barrelProfile, barrelLootPool, rollBarrel, isBarrel,
//   POT_COINS_BY_DENSITY, potCoinsFor, isPotOfGold, isBikeRack, barrelFlash,
//   bikeRackFlash
//   STAND_ITEM_FRAME, STAND_KEYWORD_ITEM, STAND_GENERIC_ITEM, STAND_CLASS_ITEM,
//   STAND_NEVER_CLASSES,
//   standWordItem, standNameItems, subclassProductFor, produceStandFor
//   MACRO_KIND_BY_CLASS, MACRO_KINDS, macroFor
//   chestLook, chestOpeningArt
//
// Loot pickers (pickTreasure, pickLoot, pickChestRelic / rollGearUpgrade)
// live in rarity.js's pickReward + classBias engine.

// === Rustic name transform ===
// Maps modern words → medieval/farm equivalents. Whole-word, case-insensitive.
// Empty string = strip the word.
const RUSTIC_WORDS = {
  // Healthcare
  hospital: 'Apothecary', pharmacy: 'Apothecary', pharmasave: 'Apothecary',
  clinic: 'Healer Hut', medical: 'Healer', dental: 'Tooth-Drawer',
  dentist: 'Tooth-Drawer', doctor: 'Healer', optical: 'Spectacles',
  optician: 'Spectacle-Maker', vision: 'Spectacles',
  // Education / civic
  school: 'Hedge School', elementary: '', secondary: 'Apprentice',
  college: 'Loremaster', university: 'Loremaster',
  library: 'Scriptorium', museum: 'Curiosity',
  // Food & drink
  bakery: 'Bakehouse', butcher: 'Butchery', butchers: 'Butchery',
  market: 'Market', supermarket: 'Marketplace',
  grocer: 'Grocer', grocery: 'Grocer', cafe: 'Tea House',
  coffee: 'Roastery', starbucks: 'Black Bean',
  restaurant: 'Tavern', diner: 'Tavern', pizza: 'Hearth',
  burger: 'Mutton', burgers: 'Mutton', noodle: 'Stew Pot',
  noodles: 'Stew Pot', bistro: 'Tavern', bar: 'Alehouse',
  pub: 'Alehouse', wine: 'Vintner', liquor: 'Spirits',
  brewery: 'Brewhouse', bbq: 'Spit-Roast', steakhouse: 'Spit-Roast',
  seafood: 'Fishmonger', fish: 'Fishmonger', meats: 'Butchery',
  produce: 'Grocer', organic: 'Wholesome', natural: 'Wild',
  // Shops
  store: 'Shoppe', shop: 'Shoppe', mart: 'Stall',
  centre: 'Hall', center: 'Hall', plaza: 'Square', mall: 'Bazaar',
  florist: 'Flowerstall', flowers: 'Blossoms', flower: 'Blossom',
  books: 'Tomes', bookstore: 'Scrivener',
  pet: 'Beast', pets: 'Beast',
  cleaners: 'Laundress', cleaning: 'Laundress', laundry: 'Laundress',
  salon: 'Barber', hair: 'Barber', spa: 'Bathhouse',
  exchange: 'Crossroads', access: '',
  recreation: 'Greens', enterprise: 'Guildhouse',
  // Other
  petro: 'Forge', foods: 'Provisions', food: 'Provisions',
  scene: 'Sights', service: 'Servants', station: 'Outpost',
  fast: 'Swift', express: 'Swift',
};
// Fallback labels for POIs missing a `name` tag in OSM. Shown so unnamed
// POIs read as a generic descriptor rather than a blank.
const POI_CLASS_FALLBACK = {
  pitch:            'Tourney Grounds',
  playground:       'Children\'s Yard',
  gate:             'Gate',
  place_of_worship: 'Chapel',
  garden:           'Garden',
  park:             'Meadow',
  attraction:       'Curiosity',
  museum:           'Curio Hall',
  school:           'Hedge School',
  lodging:          'Inn',
  bus:              'Stagecoach Stop',
  beer:             'Alehouse',
  grocery:          'Grocer',
  restaurant:       'Tavern',
  // satextract OSM street furniture (sidecar-only POIs) — fallback descriptors
  // so the unnamed box chests read as a place rather than a blank label.
  swimming_pool:    'Bathing Pool',
  // The rack is a COURIER'S POST in the fiction (Sep 2026): the old "bike
  // rack" read as riding a bicycle while playing. Ids / texture keys keep
  // `bicycle_parking` / `bike_rack`.
  bicycle_parking:  'Courier\'s Post',
  traffic_signals:  'Signal Post',
  stop:             'Stop Post',
  crossing:         'Crossing',
  picnic_table:     'Picnic Table',
  carport:          'Cart Shed',
  fence:            'Fence Post',
  powerline:        'Power Line',
  tower:            'Watch Tower',
};

const RUSTIC_CACHE = new Map();
function rusticifyName(name) {
  if (!name) return name;
  const cached = RUSTIC_CACHE.get(name);
  if (cached !== undefined) return cached;
  let out = name
    // Strip business suffixes.
    .replace(/[ ,]+(Inc\.?|Ltd\.?|LLC|Corp\.?|Co\.?)\b/gi, '')
    // "X at Y" intersections → "X & Y"
    .replace(/\s+at\s+/gi, ' & ');
  out = out.replace(/\b([A-Za-z']+)\b/g, (m) => {
    const lower = m.toLowerCase();
    if (lower in RUSTIC_WORDS) {
      const repl = RUSTIC_WORDS[lower];
      if (repl === '') return '';
      // Preserve case of original first letter.
      return m[0] === m[0].toUpperCase() ? repl : repl.toLowerCase();
    }
    return m;
  });
  out = out.replace(/\s{2,}/g, ' ').trim();
  RUSTIC_CACHE.set(name, out);
  return out;
}

// The colour a loot toast or card wears for item `id`: the rarity badge's
// own (items.js tierBadgeColor — the seven-rung ladder the badge beside it
// reads, so a toast and its badge can never disagree), as a CSS colour. An
// unranked id reads as T1 (itemTierOf's fallback — seeds carry their crop's
// tier as items, so SEED_TIER needs no second look).
// (Until Oct 2026 a separate three-rung scale clamped everything over T3 to
// pink and called T1 "common" where the badge says "basic".)
function lootFlashColor(id) {
  const tier = itemTierOf(id, 1);
  const c = tierBadgeColor(tier);
  return c == null ? UI_TREASURE : '#' + c.toString(16).padStart(6, '0');
}

// POI class → category, drives chest loot type (produce vs seed) and tier weights.
const POI_CATEGORY = {
  // food: drops PRODUCE (harvested crops) instead of seeds
  restaurant: 'food', cafe: 'food', fast_food: 'food', grocery: 'food',
  butcher: 'food', ice_cream: 'food', bakery: 'food',
  supermarket: 'food', convenience: 'food',
  // commerce: common-weighted seed drops
  alcohol_shop: 'commerce', beer: 'commerce', shop: 'commerce',
  // florist / garden_centre / garden: rare-weighted FLOWER seeds ('flora'
  // category). A garden POI is literally a flora source, so it drops a random
  // flower seed (ice/fire/sunflower) and gets the worldgen flower-burst
  // decoration. (garden was 'park' — promoted so it hands out flower seeds.)
  florist: 'flora', garden_centre: 'flora', garden: 'flora',
  // farm: rare-weighted seed drops, any tier
  farm: 'farm',
  // ── Places of LEARNING — the book category. The same pad as civic, but
  // its own loot row: a hedge school, a loremaster's
  // college, a scriptorium and a scrivener's shop are where the written word
  // lives, so their chests hand out BOOKS by the shelf-load (rarity.js
  // 'chest:school' pins the consumable roll to one). The Book is the game's
  // documentation - see PLAY_TIPS in play_tips.js - so it needs a place on the
  // map a player can walk to and reliably come back with one.
  school: 'school', college: 'school', library: 'school', books: 'school',
  // civic/educational: rare-weighted seed drops
  town_hall: 'civic', place_of_worship: 'civic',
  attraction: 'civic', museum: 'civic',
  // ('pet' died Oct 2026 with the pets chest theme: OSM pet stores arrive as
  // shop/pet, a commerce chest - nothing mints the bare class.)
  // healthcare: mid-weighted seed drops
  pharmacy: 'health', hospital: 'health', dentist: 'health',
  // parks: T2-leaning seed drops (garden moved to 'flora' above)
  park: 'park', playground: 'park', pitch: 'park',
  // A scenic stretch's vista chest (src/scenic.js, poiClass VISTA_POI_CLASS):
  // a park chest — seeds and a walker's finds — at its stretch's tier.
  vista: 'park',
  // fountain: special — drops nothing useful; treat as common-seed for now
  fountain: 'park',
  // low-tier: bus stops & similar street-furniture POIs
  bus: 'lowtier', fuel: 'lowtier', lodging: 'lowtier',
  // ── satextract OSM point features → low-tier street furniture. These reach
  // the game only via the Overpass sidecar (data/satextract_osm.geojson), not
  // the MVT poi layer, so they're wired here as plain lowtier chests.
  // ('tower' is the chest poiClass for man_made=tower — distinct from the
  // castle 'tower' OBJECT kind.) Road furniture that is no PLACE at all —
  // traffic signals, crossings, stop signs, fences, power lines, carports —
  // is not a chest (worldgen.js SX_CHEST_POI no longer mints them, and
  // injectTileBin drops them from a bin cached before), and a GATE is an
  // enemy spawn point with two posts (worldgen.js gatePostsAt), not a chest.
  picnic_table: 'lowtier', tower: 'lowtier',
  // ── Civic services. The bins are BARRELS (BARREL_CLASSES below): smashed
  // for a coin or an apple, never a tier roll.
  waste_basket: 'lowtier', post: 'lowtier', recycling: 'lowtier',
  drinking_water: 'lowtier', toilets: 'lowtier',
  // ── Restful shelters — small reward, frequent
  shelter: 'lowtier', picnic_site: 'lowtier',
  // ── ATM → the pot of gold (a daily coin burst, app.js) and bicycle
  // parking → the bike rack (a daily stick-walk speed boost) — neither is
  // looted (isPotOfGold / isBikeRack below). motorcycle_parking is diverted
  // to a treasure X in worldgen (no chest), so it needs no category here.
  bicycle_parking: 'lowtier', atm: 'lowtier',
  // ── Athletic facilities — park-class chests, fits the "leisure" feel
  sports_centre: 'park', yoga: 'park', swimming: 'park',
  swimming_pool: 'park', bowls: 'park', running: 'park',
  ice_rink: 'park', stadium: 'park', dog_park: 'park',
  // ── Culture — civic chests. PUBLIC ART (art_gallery) is an ordinary
  // quota-seeded chest like every class (worldgen.js seedChestTiers); an
  // INFORMATION board is no chest at
  // all — it reads one Book page (worldgen.js infoboard, the waystone's lane
  // in interactables.js). Memorials, monuments and cemeteries have NO row:
  // they are sensitive places that mint nothing (WorldGen.isSensitivePoi).
  art_gallery: 'civic', cinema: 'civic', theatre: 'civic',
  // ── Authority buildings — civic chests
  police: 'civic', fire_station: 'civic', harbor: 'civic',
};
// Loot identity is separate from world category: no map IDs, tiers or pads change.
const CHEST_THEME_BY_POI = {
  museum: 'culture', art_gallery: 'culture', cinema: 'culture', theatre: 'culture',
  // (A place of worship reaching a chest at all is a CHRISTIAN one — every
  // other faith's mints nothing, WorldGen.isSensitivePoi — and a surface one
  // stands as the chapel; this row is its cave mirror's loot.)
  place_of_worship: 'worship',
  police: 'authority', fire_station: 'authority',
};
function chestThemeForPoi(poiClass) {
  return CHEST_THEME_BY_POI[poiClass] || ChestThemes.normalize(POI_CATEGORY[poiClass]);
}
// The VIEWPOINT GRAIL (o.vista === 'grail') uses the vista equipment, unique
// relic and magic pool. A scenic STRETCH chest (o.vista is the kind —
// 'shore'/'greenway'/'park', poiClass VISTA_POI_CLASS) keeps reading its
// poiClass's ordinary theme ('park', src/loot.js POI_CATEGORY.vista) — only
// the grail gets its own row. Interactables reads this, never
// chestThemeForPoi(o.poiClass) directly, for any chest.
function chestThemeFor(o) {
  return (o && o.vista === 'grail') ? 'vista' : chestThemeForPoi(o && o.poiClass);
}

// === POI pad mapping ===
// Every POI that gets a pad gets the SAME pad: a single rounded slab sitting in
// the one cell directly under the chest (see PAD_SHAPES.round1 in textures.js).
// The shape no longer conveys POI type — it's just a clean base under the chest.
// Lowtier POIs (bus stops, intersections, fuel, etc.) still skip the pad and
// render a bare chest, as do any classes outside the pad-bearing categories.
const PAD_CATEGORIES = new Set([
  'food', 'commerce', 'civic', 'school', 'health', 'park', 'flora', 'farm',
]);
function padShapeKeyForPoi(poiClass) {
  if (!poiClass) return null;
  return PAD_CATEGORIES.has(POI_CATEGORY[poiClass]) ? 'round1' : null;
}

// A generated POI chest receives a deterministic quota seed from
// worldgen.js seedChestTiers. The per-tile pyramid ranks POIs by MVT rank and
// id, then spreads its T5-T2 seats across categories; every unseated chest is
// T1. Nothing about the player enters the seed, so every player sees the same
// chest colour and receives a roll from that displayed tier.
//
// Density no longer sets a chest tier. CHEST_DENSITY_T1_AT survives as the
// restock unit: it controls how long recurring crates stay bare.
const CHEST_DENSITY_T1_AT = 25;
// A chest with no stamp — a hand-placed or scripted one (the sandbox, a test
// fixture), or an object read before its tile finished building — rolls at
// the old unlisted-class tier. A generated surface or cave POI chest is
// always stamped.
const CHEST_TIER_UNSTAMPED = 2;
// Chest sprite recolors: T1 crates keep their wood; T2–T5 use distinct hues.
const CHEST_TIER_MAX = 5;
// THE CAP CLIMBS UNDERGROUND (Oct 2026): T6 chests exist from cave level 3,
// T7 from level 6 - the dungeon-only tiers. A chest's own tier never demotes;
// the cap only stops the bonuses (so an L7 T4 stays T4, capped by its own
// rung, while a high seed plus the depth bonus reaches 6/7 down there).
// Surface and the first two levels hold the ordinary 5.
function chestTierMaxFor(depth) {
  return Math.min(7, CHEST_TIER_MAX + Math.floor(Math.max(0, depth || 0) / 3));
}
const CHEST_TIER_COLOR = Object.fromEntries(
  Array.from({ length: chestTierMaxFor(9) }, (_, i) => [i + 1, tierBadgeColor(i + 1)])
);
// Chests UNDERGROUND are promoted. Each cave level seeds its own pyramid,
// and each CHEST_TIER_DEPTH_STEP levels adds one tier. chestTierMaxFor sets
// the depth cap: T6 begins at level 3 and T7 at level 6.
const CHEST_TIER_DEPTH_STEP = 2;
// Which POI chests go underground at all. Street furniture — the lowtier
// boxes (bus stops, bins, shelters…) — stays on the surface: a cave under
// town is meant to hold the town's PRIZES, not a T1 box every few cells that
// the depth bonus would then inflate into a real chest. So a cave level
// carries only the park / civic / health / farm / flora / food / commerce
// chests overhead. worldgen.js caveChestsFrom asks this per chest; it is the
// one place the exclusion lives.
const CHEST_CAVE_SKIP_CATEGORIES = new Set(['lowtier']);
function chestMirrorsUnderground(poiClass) {
  return !CHEST_CAVE_SKIP_CATEGORIES.has(POI_CATEGORY[poiClass]);
}
function chestTierDepthBonus(depth) {
  return Math.floor(Math.max(0, depth || 0) / CHEST_TIER_DEPTH_STEP);
}
// `nexus` is the chest's zone stamp (o.zoneNexus — src/zones.js): the chest
// at the heart of a grove, churchyard or tar yard is a zone's NEXUS and
// wears ZONE_NEXUS_TIER_BONUS more, to measure up to the fanfare around it —
// a second reason on the same ladder as the depth bonus, capped by
// chestTierMaxFor. It is the world's (the zone is generated), so it shows in
// the chest color and pays in the roll alike.
const ZONE_NEXUS_TIER_BONUS = 1;
function chestTierZoneBonus(nexus) { return nexus ? ZONE_NEXUS_TIER_BONUS : 0; }
// The chest's base tier before depth and nexus: a scenic override, its quota
// seed, or CHEST_TIER_UNSTAMPED for a hand-built object.
// A SCENIC chest (src/scenic.js — o.vista: a viewpoint's grail, or the one
// chest of a scenic stretch) takes its tier from Scenic.VISTA_CHEST_TIER and
// stands outside the tile's quota budget. Generated (the stamp is the
// world's), so the color and the roll agree for every player.
function chestVistaTier(o) {
  return (o && o.vista && typeof Scenic !== 'undefined' && Scenic.VISTA_CHEST_TIER[o.vista]) || 0;
}
// Authored street caches use the cave reward mix without pretending to be underground.
function chestLootDepth(o) { return o?._street === 'snare' && !o.chestTopUp ? 1 : (o?.depth || 0); }
function chestBaseTier(o) {
  if (!o) return CHEST_TIER_UNSTAMPED;
  if (o.chestTopUp) return o.tierSeed;
  if (o._street === 'snare') return StreetVariants.SNARE_CHEST_TIER;
  const vista = chestVistaTier(o);
  if (vista) return vista;
  // The per-tile quota seed (worldgen.js seedChestTiers): the pyramid pick.
  // A chest that never went through a seeding pass - hand-placed, sandbox,
  // test-built - is the unstamped T2; there is no older tier to fall back to
  // (the count ladder retired with the pyramid).
  if (o && o.tierSeed) return o.tierSeed;
  return CHEST_TIER_UNSTAMPED;
}
// THE chest tier (T1-T5 on the surface, through T7 underground) - the one
// every player sees and the one its loot rolls
// at: the sprite color in render.js, the look (chestLook), the roll in
// interactables.js and the chapel's blessing (Macros.chapelRollTier) all read
// this. Takes the object (tierSeed, depth, zoneNexus, and scenic stamps).
function chestTier(o) {
  const d = o ? o.depth : 0;
  const nexus = o ? o.zoneNexus : null;
  return Math.min(chestTierMaxFor(d), chestBaseTier(o) + chestTierDepthBonus(d) + chestTierZoneBonus(nexus));
}

// ── Restocking: how long a taken CRATE stays bare ──────────────
// A crate refills (interactables.js restocks) — but a type the tile is FULL
// of must not be a fountain. It stands bare for crateRestoreDays UTC days
// after it is taken: floor(count / CRATE_RESTORE_PER), at least one day and
// at most CRATE_RESTORE_MAX_DAYS (a week — also how long the day ledger keeps
// a take, macros.js). Which chest IS a crate is the tier's business (a T1
// chest — one the quota pyramid did not seat); how long it stays bare is the
// class COUNT's (o.poiDensity, worldgen.js stampPoiDensity): a class with
// fewer than 2 × CRATE_RESTORE_PER on the tile restocks daily, and every
// further CRATE_RESTORE_PER of its kind adds a day: 50-74 every 2 days, …
// 175+ once a week. So a class hands back at most ~2 × CRATE_RESTORE_PER of
// its crates a day per tile however many the tile holds.
const CRATE_RESTORE_PER = CHEST_DENSITY_T1_AT;
const CRATE_RESTORE_MAX_DAYS = 7;
function crateRestoreDays(o) {
  const n = Math.max(1, Math.floor(Number(o && o.poiDensity) || 1));
  return Math.max(1, Math.min(CRATE_RESTORE_MAX_DAYS, Math.floor(n / CRATE_RESTORE_PER)));
}

// ── BREAKABLE CONTAINERS ────────────────────────────────────────────────
// Appearance and loot share a stable identity. Both are smashed permanently;
// density never changes these drop chances.
// Generated containers (barrel: true) use the same profiles as bin POIs.
const BARREL_LOOT = [
  { kind: 'empty', w: 0.7 },
  { kind: 'supply', w: 0.1 },
  { kind: 'mineral', w: 0.1, minTier: 1, maxTier: 2 },
  { kind: 'produce', w: 0.1, minTier: 1, maxTier: 1 },
];
const CLAY_POT_LOOT = [
  { kind: 'empty', w: 0.7 },
  { kind: 'magic', w: 0.05, minTier: 1, maxTier: 2 },
  { kind: 'produce', w: 0.05, minTier: 2, maxTier: 2 },
  { kind: 'coin', w: 0.1, amount: 1 },
  { kind: 'seed', w: 0.1, minTier: 1, maxTier: 1 },
];
const BARREL_ART = [
  { texKey: 'barrel', smashedKey: 'barrel_smashed', name: 'barrel', loot: BARREL_LOOT },
  { texKey: 'clay_pot', smashedKey: 'clay_pot_smashed', name: 'clay pot', loot: CLAY_POT_LOOT },
];
const BARREL_CLASSES = new Set(['waste_basket', 'recycling']);
function barrelProfile(o) {
  const authored = BARREL_ART.find(row => row.texKey === o?.barrelStyle);
  if (authored) return authored;
  return BARREL_ART[o?.id == null ? 0 : fnv1a(String(o.id) + '#barrel-art') % BARREL_ART.length];
}
// Reuse the ordinary loot registry so crafted and exclusive finds stay excluded.
function barrelLootPool(row) {
  const ids = row.ids || Object.entries(ITEMS_BY_CLASS_TIER[row.kind] || {})
    .filter(([tier]) => Number(tier) >= (row.minTier ?? 1) && Number(tier) <= (row.maxTier ?? Infinity))
    .flatMap(([, ids]) => ids);
  return ids.map(id => ITEM_BY_ID[id]).filter(item => item && !item.uniqueJewelry);
}
// One smash: empty, one coin, or one item within the profile's tier bounds.
function rollBarrel(o, rng) {
  const r = typeof rng === 'function' ? rng : Math.random;
  const row = weightedPickBy(barrelProfile(o).loot, row => row.w, r);
  if (row.kind === 'empty') return { kind: 'empty' };
  if (row.kind === 'coin') return { kind: 'gold', amount: row.amount };
  const item = weightedPickBy(barrelLootPool(row), item => item.dropWeight ?? 1, r);
  return item ? { kind: 'item', id: item.id, qty: 1 } : { kind: 'empty' };
}
// The one map line a smash prints (≤ MAP_MSG_MAX): what came out, or that
// nothing did — the real quantity, never a guess.
function barrelFlash(got) {
  if (!got || got.kind === 'empty') return 'Empty.';
  if (got.kind === 'gold') return got.amount === 1 ? '+1 coin' : `+${got.amount} coins`;
  const name = (typeof ITEM_BY_ID !== 'undefined' && ITEM_BY_ID[got.id] && ITEM_BY_ID[got.id].name) || got.id;
  return `+${got.qty || 1} ${name}`;
}
function isBarrel(o) {
  if (!o || o.kind !== 'chest' || o.crate || o.fixedLoot) return false;
  if (o.barrel === true) return true;   // a generated barrel, any depth
  return BARREL_CLASSES.has(o.poiClass) && !(o.depth > 0);   // a bin POI; its cave mirror is a plain chest
}

// ── POTS OF GOLD (ATMs) and BIKE RACKS ────────────────────────────────────
// An ATM is a pot of gold: a coin burst once a UTC day (app.js
// _coinBurstInteract). How many coins it spills is its DENSITY on its tile,
// the poiDensity count restock days also read: POT_COINS_BY_DENSITY's anchors,
// interpolated linearly in log(count) between them, rounded, never below 1 —
// a lone ATM spills 30, one of 50 on the tile 3, one of 150+ a single coin.
// A cave-level mirror is never a pot (lowtier chests don't mirror anyway).
const POT_COINS_BY_DENSITY = [
  { count: 1, coins: 30 },
  { count: 50, coins: 3 },
  { count: 150, coins: 1 },
];
function potCoinsFor(count) {
  const n = Math.max(1, Number(count) || 1);
  const A = POT_COINS_BY_DENSITY;
  if (n <= A[0].count) return A[0].coins;
  for (let i = 1; i < A.length; i++) {
    if (n <= A[i].count) {
      const f = Math.log(n / A[i - 1].count) / Math.log(A[i].count / A[i - 1].count);
      return Math.max(1, Math.round(A[i - 1].coins + (A[i].coins - A[i - 1].coins) * f));
    }
  }
  return Math.max(1, A[A.length - 1].coins);
}
function isPotOfGold(o) {
  return !!o && o.kind === 'chest' && o.poiClass === 'atm' && !(o.depth > 0) && !o.crate && !o.fixedLoot;
}
// A BIKE RACK (bicycle_parking) is not a chest at all: a tap lends the stick
// walk BIKE_RACK_SPEED_MUL for BIKE_RACK_MS (items.js — the stick-walk speed
// lane, app.js _walkRelics / steerSpeedMul), once a UTC day per rack (the day
// ledger). It stays a `chest` OBJECT only so its id, its cell and the POI
// light ride the same rails as the pot it used to be.
// What a courier's post (the bike rack's name in the world) says when it
// lends its pace (≤ MAP_MSG_MAX), off the boost's own multiplier and length.
// Never a bicycle: the player walks — the boost is the STICK's.
function bikeRackFlash() {
  return `Swift step! Stick ×${BIKE_RACK_SPEED_MUL} for ${shortDuration(BIKE_RACK_MS)}`;
}
function isBikeRack(o) {
  return !!o && o.kind === 'chest' && o.poiClass === 'bicycle_parking' && !(o.depth > 0) && !o.crate && !o.fixedLoot;
}

// === Themed produce / food stands ==========================================
// A subset of RETAIL POIs (food / commerce / flora) render as a little market
// stall instead of a chest, and sell ONE produce/food item themed off the
// POI's name (or, failing that, its class). The mapping is deterministic — NOT
// random — keyed off ~100 common shop-name words, so a "Pizzeria" always sells
// the same thing and every fish stall looks the same. Prepared-food counters
// sell the existing cooked twin when one exists; the awning keeps its family.
// produceStandFor() returns
// { item, frame } (frame = the market_stand awning-colour for the item family)
// or null. Used by render.js (sprite) and interact.js (loot).
//
// item → awning frame in the market_stand spritesheet (the product "family").
const STAND_ITEM_FRAME = {
  // fruit (orange, 0)
  apple: 0, cherry: 0, worldpeach: 0, banana: 0, orange: 0, coconut: 0, apricot: 0, mango: 0, berry: 0,
  // veg / grocer (green, 1)
  potato: 1, onion: 1, cress: 1, nut: 1, mushroom: 1,
  // meat (red, 2)
  meat: 2,
  // fish (teal, 3)
  salmon: 3, bass: 3, trout: 3, minnow: 3,
  // coffee / bakery (brown, 4)
  coffee: 4,
  // dairy / egg (pale yellow, 5)
  milk: 5, egg: 5,
  // flowers / garden (pink, 6)
  flowers: 6, marigold: 6, wildrose: 6,
};
// ── What a stall's SIGN says it sells, and what it actually sells ─────────
// These have to agree. A stall's name is painted over it (render.js draws the
// rusticified POI name), so the item behind the counter is a promise the sign
// already made: a juice bar in a mall food court sold STEAK, because the name
// scan found nothing it knew and fell through to the class guess for
// fast_food. Two things went wrong there and both are fixed below — the scan
// only matched whole words EXACTLY ("freshly" is not "fresh", "juices" is not
// "juice"), and the first token to match won even when it was a word that says
// nothing about the goods ("Fresh Fish Market" sold potatoes off "fresh").
//
// So the resolution is, in order:
//   1. a SPECIFIC product word anywhere in the name  — "Freshly Squeezed" → orange
//   2. the POI's class                               — an unnamed cafe    → coffee
//   3. a GENERIC venue word anywhere in the name     — "Corner Market"    → potato
// A product word beats everything, wherever it sits in the name, because it is
// the one thing that describes the goods; between two product words the
// leftmost wins (shop names lead with what they are). The CLASS outranks a
// venue word because it is the more specific of the two — "Whole Foods Market"
// is a supermarket that happens to have "market" in its name, and reading the
// word instead of the class collapsed every such shop onto the same produce
// stall. A venue word only speaks for a class that has nothing to say: the
// generic `shop`, which is OSM's catch-all for retail it can't identify.
//
// Tokens are matched exactly first, then through a small suffix ladder
// (standStem) so a plural or an -ery/-ly/-ed form of a word already in the
// table resolves to it instead of falling through to the class guess. Only a
// stem that lands ON a table key counts — nothing is invented.

// Shop-name word → the item that stall sells, when the word names the GOODS.
// Lowercase, matched as whole tokens of the POI name (split on non-letters).
const STAND_KEYWORD_ITEM = {
  // fruit
  fruit: 'apple', fruits: 'apple', orchard: 'apple', apple: 'apple', apples: 'apple',
  cider: 'apple', orange: 'orange', oranges: 'orange', citrus: 'orange',
  // Peaches are rare finds, not an unlimited market named after the fruit.
  cherry: 'cherry', cherries: 'cherry',
  banana: 'banana', bananas: 'banana', mango: 'mango', tropical: 'mango',
  coconut: 'coconut', apricot: 'apricot', berry: 'berry', berries: 'berry',
  smoothie: 'berry', jam: 'berry', acai: 'berry', preserves: 'berry',
  wein: 'berry',   // German wine — the same fruit-wine read as alcohol_shop
  // juice — the whole idiom, not just the noun. A juice bar is named for the
  // squeezing as often as for the fruit ("Freshly Squeezed", "The Juicery"),
  // and every one of those was falling through to the class guess.
  juice: 'orange', juicery: 'orange', juicer: 'orange', squeeze: 'orange',
  squeezed: 'orange', pressed: 'orange', lemonade: 'orange', limeade: 'orange',
  // veg / grocer / pub-grub
  veg: 'potato', vegetable: 'potato', vegetables: 'potato', veggie: 'potato',
  potato: 'potato', potatoes: 'potato', spud: 'potato',
  chips: 'potato', fries: 'potato', chipper: 'potato',
  onion: 'onion', onions: 'onion', salad: 'cress', greens: 'cress',
  diner: 'potato',
  // German pub-grub / snack words (matched post-fold, see foldDiacritics).
  imbiss: 'potato', kneipe: 'potato', brauhaus: 'potato', bier: 'potato',
  mushroom: 'mushroom', mushrooms: 'mushroom', fungi: 'mushroom',
  nut: 'nut', nuts: 'nut', almond: 'nut', peanut: 'nut', cashew: 'nut',
  pizza: 'mushroom', pizzeria: 'mushroom', italian: 'mushroom', pasta: 'mushroom',
  trattoria: 'mushroom', ramen: 'mushroom', noodle: 'mushroom', noodles: 'mushroom',
  pho: 'mushroom', udon: 'mushroom',
  // Cuisine words a name can carry without naming a dish ("Thai Kitchen",
  // "Falafel King"). The Vietnamese read rides with ramen and pho: noodle
  // soup is the mushroom family in this table.
  thai: 'meat', curry: 'meat', wok: 'meat', teriyaki: 'meat', indian: 'meat',
  donair: 'meat',
  falafel: 'mushroom', viet: 'mushroom', vietnamese: 'mushroom',
  bistro: 'mushroom', eatery: 'mushroom', kitchen: 'mushroom',
  kantine: 'mushroom', gasthaus: 'mushroom', gasthof: 'mushroom',
  // meat
  steak: 'meat', steaks: 'meat', ribeye: 'meat', grill: 'meat', grille: 'meat',
  bbq: 'meat', barbecue: 'meat', smokehouse: 'meat', butcher: 'meat', butchers: 'meat',
  meat: 'meat', meats: 'meat', burger: 'meat', burgers: 'meat', kebab: 'meat',
  deli: 'meat', sausage: 'meat', chop: 'meat', chophouse: 'meat', jerky: 'meat',
  bacon: 'meat', ham: 'meat', rotisserie: 'meat', wings: 'meat', chicken: 'meat',
  steakhouse: 'meat', grillhouse: 'meat', meatery: 'meat',
  taco: 'meat', tacos: 'meat', taqueria: 'meat', burrito: 'meat', gyro: 'meat',
  shawarma: 'meat', schnitzel: 'meat', charcuterie: 'meat',
  // German meat words: Döner folds to `doner`, so both spellings read.
  wurst: 'meat', metzgerei: 'meat', fleischerei: 'meat',
  kebap: 'meat', doner: 'meat',
  // fish
  fish: 'salmon', fishery: 'salmon', seafood: 'salmon', sushi: 'salmon',
  sashimi: 'salmon', fishmonger: 'salmon', oyster: 'bass', chippy: 'bass',
  catch: 'bass', salmon: 'salmon', trout: 'trout', bass: 'bass', cod: 'bass',
  tuna: 'salmon', poke: 'salmon', lobster: 'bass', crab: 'bass', shrimp: 'bass',
  prawn: 'bass', clam: 'bass', mussel: 'bass', wharf: 'bass', tackle: 'minnow',
  // coffee / bakery
  cafe: 'coffee', coffee: 'coffee', espresso: 'coffee', latte: 'coffee',
  mocha: 'coffee', cappuccino: 'coffee', roast: 'coffee', bean: 'coffee',
  beans: 'coffee', brew: 'coffee', tea: 'coffee', teahouse: 'coffee',
  caffe: 'coffee',   // the Italian spelling (Caffè) folds to exactly this
  bakery: 'coffee', baker: 'coffee', bread: 'coffee', patisserie: 'coffee',
  pastry: 'coffee', cake: 'coffee', bun: 'coffee', donut: 'coffee',
  doughnut: 'coffee', croissant: 'coffee', boulangerie: 'coffee', creperie: 'coffee',
  bagel: 'coffee', muffin: 'coffee', scone: 'coffee', crumb: 'coffee',
  backerei: 'coffee', konditorei: 'coffee', kuchen: 'coffee', torte: 'coffee',
  kaffee: 'coffee',
  // A BREWERY is beer, not a coffee brew — an exact key so it never stems
  // down to `brew` and pours the player a cup of coffee.
  brewery: 'potato', brewhouse: 'potato', brewing: 'potato', ale: 'potato',
  alehouse: 'potato', lager: 'potato', beer: 'potato', pint: 'potato',
  // dairy / egg
  dairy: 'milk', milk: 'milk', creamery: 'milk', cheese: 'milk',
  cheesemonger: 'milk', yogurt: 'milk', gelato: 'milk', gelateria: 'milk',
  icecream: 'milk', cream: 'milk', scoop: 'milk', sundae: 'milk',
  eis: 'milk',   // German ice cream — short, but a whole token only
  sorbet: 'milk', custard: 'milk', chocolate: 'milk', creamy: 'milk',
  chocolatier: 'milk', chocolaterie: 'milk', confectionery: 'milk',
  candy: 'milk', sweets: 'milk', fudge: 'milk',
  egg: 'egg', eggs: 'egg', poultry: 'egg', henhouse: 'egg',
  // flowers / garden
  florist: 'flowers', flower: 'flowers', flowers: 'flowers', bloom: 'flowers',
  blossom: 'flowers', petal: 'flowers', nursery: 'flowers', garden: 'flowers',
  botanic: 'flowers', bouquet: 'flowers', posy: 'flowers', floral: 'flowers',
  greenhouse: 'flowers', orchid: 'flowers', rose: 'flowers', tulip: 'flowers',
  plant: 'flowers', plants: 'flowers',
  marigold: 'marigold', marigolds: 'marigold', wildrose: 'wildrose',
};
// Words that say a place SELLS FOOD without saying what — a venue, an
// adjective, a trade. They still theme a stall (a market with no product word
// is a produce stall), but any product word in the same name outranks them,
// which is what "Fresh Fish Market" needs to sell fish rather than potatoes.
const STAND_GENERIC_ITEM = {
  grocer: 'potato', grocery: 'potato', greengrocer: 'potato', market: 'potato',
  marketplace: 'potato', produce: 'potato', organic: 'potato', harvest: 'potato',
  fresh: 'potato', farmstand: 'potato', farmers: 'potato', natural: 'potato',
  pub: 'potato', tavern: 'potato', bar: 'potato', inn: 'potato', saloon: 'potato',
};
// Fallback when the NAME has no product word but the POI's CLASS implies one.
// Keys are POI CLASSES, so every one has to be a class POI_CATEGORY files under
// a retail category and not on the never-a-shop list below — anything else is a
// guess that can never fire (there is no `greengrocer` class in the tiles; that
// word lives in the name table instead).
//
// EVERY CLASS SELLS SOMETHING DIFFERENT: the fallback is what most stalls
// resolve by, so duplicates would make a street of identical stalls. One item
// each, picked for what that kind of shop would put on the counter:
//
//   butcher       meat      the only butchery there is
//   fast_food     potato    chips, the fast-food staple
//   restaurant    mushroom  a cooked dish rather than a raw ingredient
//   cafe          coffee    canonical
//   bakery        egg       the baker's staple (there is no bread item)
//   ice_cream     milk      the dairy it's churned from
//   grocery       onion     the greengrocer's basket
//   supermarket   apple     the produce aisle
//   convenience   nut       the snack by the till
//   alcohol_shop  berry     fruit wine — the closest the game grows to a still
//   beer          cherry    a kriek; the game grows no grain to brew from
//   florist       flowers   cut stems
//   garden_centre marigold  a potted bloom, not a bouquet
//
// A name still outranks all of this (see standNameItem) — the class only
// speaks for a shop whose sign says nothing about its goods.
const STAND_CLASS_ITEM = {
  butcher: 'meat', fast_food: 'potato', restaurant: 'mushroom',
  cafe: 'coffee', bakery: 'egg', ice_cream: 'milk',
  grocery: 'onion', supermarket: 'apple', convenience: 'nut',
  alcohol_shop: 'berry', beer: 'cherry',
  florist: 'flowers', garden_centre: 'marigold',
};
const STAND_RETAIL_CATS = new Set(['food', 'commerce', 'flora']);
// Prepared-food counters use the campfire's existing cooked twin when there
// is one. Ingredient shops keep the raw stock selected by their name/class.
const STAND_COOKED_CLASSES = new Set(['restaurant', 'fast_food', 'cafe', 'bakery']);
// A stall is a SHOP. These classes land in a retail category for their LOOT
// (a garden is a flora source, so it hands out flower seeds) but nobody is
// behind a counter there — they stay crates. Checked before the name, because
// the name is exactly what would fool it: a garden POI is called "…Garden"
// almost by definition, and every flower word in it points at a stall.
const STAND_NEVER_CLASSES = new Set(['garden']);

// Suffix ladder: an ordered list of [suffix, replacement] tried against a token
// that didn't match a table key outright. Longest/most specific first, so
// "smoothies" reaches `smoothie` by dropping the 's' before "ies"→"y" can turn
// it into a word nothing knows. A stem is only ever ACCEPTED if it lands on a
// real key (see standWordItem), so an unlucky trim can't invent a product.
const STAND_STEM_RULES = [
  ['s', ''], ['es', ''], ['ies', 'y'], ['ly', ''], ['ry', ''], ['ery', ''],
  ['ed', ''], ['d', ''], ['ing', ''], ['y', ''],
];
// The item a single name word implies, as { item, specific } or null.
// Exact match first (both tables), then the same lookup over each stem.
function standWordItem(tok) {
  if (!tok) return null;
  const look = (w) => {
    if (STAND_KEYWORD_ITEM[w]) return { item: STAND_KEYWORD_ITEM[w], specific: true };
    if (STAND_GENERIC_ITEM[w]) return { item: STAND_GENERIC_ITEM[w], specific: false };
    return null;
  };
  const exact = look(tok);
  if (exact) return exact;
  for (const [suf, rep] of STAND_STEM_RULES) {
    if (tok.length > suf.length + 2 && tok.endsWith(suf)) {
      const hit = look(tok.slice(0, tok.length - suf.length) + rep);
      if (hit) return hit;
    }
  }
  return null;
}

// What a whole POI name implies, as { specific, generic } — the leftmost
// product word and the leftmost venue word, either of which may be null. They
// come back separately because they sit on OPPOSITE sides of the class guess in
// the ladder above, so the caller has to be able to tell them apart.
// FOLD DIACRITICS before tokenizing: the tokenizer splits on non-a-z, so
// an accent destroys the token it sits in — "Café" reached the ladder as
// `caf` and "Bäckerei" as `ckerei`, and the existing `cafe` key could never
// fire. NFD + strip combining marks handles é/ü/å alike; ß doubles to ss so
// German compounds keep their length. Applied to the NAME only — subclasses
// arrive from the tiles as plain ASCII.
function foldDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
}
function standNameItems(name) {
  let specific = null, generic = null;
  for (const tok of foldDiacritics(name).toLowerCase().split(/[^a-z]+/)) {
    const hit = standWordItem(tok);
    if (!hit) continue;
    if (hit.specific) { specific = hit.item; break; }   // a product word ends the search
    if (!generic) generic = hit.item;                   // remember the first venue word
  }
  return { specific, generic };
}

// Raw venue product shared by surface stalls and themed underground mirrors.
// The MVT `subclass` (worldgen.js carries it onto the chest) speaks for the
// generic `shop` class, which names no goods of its own: a shop/convenience,
// shop/florist, shop/confectionery or shop/coffee is the stall its subclass
// says, BEFORE the Sundries counter (MACRO_KIND_BY_CLASS) takes the rest of
// `shop`. It is read as a class first (STAND_CLASS_ITEM — convenience,
// florist, bakery, butcher…) and then as a product word (confectionery,
// coffee, cheese…), specific words only — a venue word is the name's job.
// It sits AFTER a product word in the name (the sign's promise still wins)
// and BEFORE a venue word, like the class it stands in for.
function subclassProductFor(o) {
  const sub = String((o && o.subclass) || '').toLowerCase();
  if (!sub || !o || o.poiClass !== 'shop') return null;
  if (STAND_CLASS_ITEM[sub]) return STAND_CLASS_ITEM[sub];
  const hit = standWordItem(sub);
  return hit && hit.specific ? hit.item : null;
}
function venueProductFor(o) {
  const named = standNameItems(o?.name);
  return named.specific || STAND_CLASS_ITEM[o?.poiClass] || subclassProductFor(o) || named.generic || null;
}

function produceStandFor(o) {
  if (!o || o.kind !== 'chest') return null;
  // A POI's cave-level mirror (worldgen.js caveChestsFrom) is a plain chest:
  // a fish stall three floors under the street is not a market.
  if (o.depth > 0) return null;
  if (o._standCache !== undefined) return o._standCache;   // computed once per object
  let res = null;
  if (STAND_RETAIL_CATS.has(POI_CATEGORY[o.poiClass]) && !STAND_NEVER_CLASSES.has(o.poiClass)) {
    // A product word in the shop's own branding wins; then what kind of shop it
    // is; then, for a class that names no goods, a venue word from the name.
    const item = venueProductFor(o);
    if (item && STAND_ITEM_FRAME[item] !== undefined &&
        (typeof ITEM_BY_ID === 'undefined' || ITEM_BY_ID[item])) {
      // Sushi, sashimi and poke counters still serve their fish raw. Match
      // whole dish names, not stems that could mistake a business's name.
      const rawFish = STAND_ITEM_FRAME[item] === STAND_ITEM_FRAME.salmon &&
        /\b(sushi|sashimi|poke)\b/i.test(foldDiacritics(o.name));
      const cooked = STAND_COOKED_CLASSES.has(o.poiClass) && !rawFish && CAMPFIRE_MAKES[item];
      res = { item: cooked || item, frame: STAND_ITEM_FRAME[item] };
    }
  }
  o._standCache = res;
  return res;
}

// === Macro stalls — the in-building POIs that are places you come BACK to ===
// A POI that is consistently INSIDE a building (the 36-tile census: lodging
// 97%, place_of_worship 99%, pharmacy 96%, library 97%, …) is not a chest you
// empty once: it stands as a building-front (80×80 art on market_stand's
// frame, drawn like the stall — ~1.35 cells, foot-anchored, rising north over
// its cell) and its tap is a SERVICE that is never consumed. One table, class
// → kind, a pure function of the POI class (the MVT's, so every player sees
// the same place); what the tap DOES lives in src/macros.js (Macros) and
// app.js presentMacro, and only the player's USE reaches the save (the
// coin-burst day ledger, save.donated, save.training*).
//
// It is NOT the market stall (produceStandFor): a stall sells the produce its
// awning shows. The one overlap is the generic `shop`, and the stall wins it
// — a shop whose name, subclass or class names produce is a stall; the rest is
// a Sundries counter. A macro is never a chest either: never in save.opened,
// no gem, no pad, and a cave-level mirror (o.depth > 0, worldgen.js
// caveChestsFrom) stays a plain chest, as it does for the stall.
const MACRO_KIND_BY_CLASS = {
  lodging: 'inn',
  place_of_worship: 'chapel',
  pharmacy: 'apothecary', dentist: 'apothecary', hospital: 'apothecary',
  library: 'scriptorium', college: 'scriptorium',
  // A school is the scholar's book club: Books earn reusable tomes there.
  // The underground mirror remains a chest supplying Books and study magic.
  school: 'scholar',
  town_hall: 'guildhall', police: 'guildhall', fire_station: 'guildhall',
  museum: 'curio', theatre: 'curio', cinema: 'curio',
  shop: 'sundries',
  sports_centre: 'training', yoga: 'training',
};
// Every kind, in a fixed order (the balancing page, the tests).
const MACRO_KINDS = ['inn', 'chapel', 'apothecary', 'scriptorium', 'guildhall', 'curio', 'sundries', 'training', 'scholar'];
// { kind, texKey } for a chest that stands as a macro, else null. Cached on
// the object like produceStandFor's answer (every input is fixed at spawn and
// a rebuilt tile is a NEW object). A scripted chest (a starter crate, the
// spawn relic chest — o.crate / o.fixedLoot) is never one.
function macroFor(o) {
  if (!o || o.kind !== 'chest' || o.depth > 0 || o.crate || o.fixedLoot) return null;
  if (o._macroCache !== undefined) return o._macroCache;
  const kind = MACRO_KIND_BY_CLASS[o.poiClass] || null;
  const res = (kind && !produceStandFor(o)) ? { kind, texKey: 'macro_' + kind } : null;
  o._macroCache = res;
  return res;
}

// Which LOOK this object wears — the ONE resolver, so the sprite the world
// drew and the picture a dialog shows can't drift apart. It lived in
// render.js as a per-frame closure until the treasure ceremony needed the
// same answer for its hero icon (a chest that stands on the map as a crate
// opened under a diamond).
//   macro  → a macro stall (macroFor): an inn, chapel, apothecary, … — a
//            building-front whose tap is a service; texKey `macro_<kind>`
//   stand  → the market stall: a shop, not a chest (produceStandFor)
//   coin   → the pot of gold: an ATM (isPotOfGold). A cave-level mirror of
//            one is a plain chest — the burst is a street thing.
//   bike   → the bike rack (isBikeRack): a stick-walk speed boost a day
//   barrel → a bin or recycling point (isBarrel): smashed permanently. The look carries a stable barrel or clay-pot pair;
//            render.js swaps texKey for smashedKey while it is spent.
//   wagon  → the broken wagon: a bus stop on an OLD TRADE ROAD (a MAJOR way —
//            StreetVariants.markBanditStops stamps `banditStop`). The same
//            chest: id, tier, contents and `opened` are untouched; only the
//            look (and the one goblin lairs.js seats beside it) changes.
//   box    → the small crate sprite: a starter supply crate, or a tier-1
//            chest (chestTier — one the tile's quota pyramid left unseated)
//   —      → the trunk chest
// `texKey` is the texture key the RENDERER draws, so a caller that wants the
// picture (app.js worldIconHTML) asks for it by the same name rather than
// re-deciding which art a look means.
// Resolved ONCE per object and cached on it, the same way produceStandFor
// caches its own answer: every input (poiClass, tierSeed, crate, depth,
// position) is fixed once the tile is built and a rebuilt tile is a NEW
// object, so the memo can't go stale — worldgen.js seedChestTiers (and
// stampPoiDensity) drop it when they restamp. Nothing about the player
// enters it (chestTier is the world's), so every player sees the same look
// on the same chest.
function chestLook(o) {
  if (o._chestLook) return o._chestLook;
  const stand = (typeof produceStandFor === 'function') ? produceStandFor(o) : null;
  const coin = isPotOfGold(o);
  const bike = !coin && isBikeRack(o);
  const barrel = !coin && !bike && isBarrel(o);
  const barrelArt = barrel ? barrelProfile(o) : null;
  const special = coin || bike || barrel;
  // Starter supply crates always use the box sprite; so does a tier-1 chest.
  const box = !!o.quarryCrate || !!o.crate || chestTier(o) === 1;
  const macro = (!special && typeof macroFor === 'function') ? macroFor(o) : null;
  const wagon = !!o.banditStop && !(o.depth > 0) && !stand && !special && !macro;
  const texKey = coin ? 'potofgold' : bike ? 'bike_rack' : barrel ? barrelArt.texKey : (macro ? macro.texKey
    : (stand ? 'market_stand' : (wagon ? 'wagon' : (box ? 'box' : 'chest'))));
  return (o._chestLook = { stand, coin, bike, barrel, macro, smashedKey: barrelArt?.smashedKey, barrelName: barrelArt?.name,
    box: box && !wagon && !macro && !special, wagon, texKey,
    frame: texKey === 'chest' ? chestTier(o) - 1 : (stand ? stand.frame : 0) });
}


// Opening paintings follow the source container, never the rolled item's tier.
// Places and other special looks retain their own ceremony art.
function chestOpeningArt(o) {
  const look = chestLook(o);
  if (look.texKey === 'box') return o.crate ? 'kind_supplies' : 'chest_t1';
  if (look.texKey === 'chest') return 'chest_t' + chestTier(o);
  return null;
}


// Wild debris on the map (no tilling needed). Tap within 4m + 18m of player to pick up.
// Spawning is per-polygon in worldgen at a stable 5-30% density (see DEBRIS_CROP/spawnDebris).
// The surprise treasure a wild plant may hide is a `treasure` field on the
// crop's row in items.js' WILDPLANT_RULES (read through wildplantTreasure).
