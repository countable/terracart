// Chest / treasure / wild-debris loot logic + POI category mapping + the
// rustic name transform. Extracted from app.js so the loot tables live next
// to one another and away from rendering / scene code.
//
// Depends on:
//   items.js (SEED_TIER, FLOWER_SEEDS).
//
// Exports as globals:
//   CHEST_ICON, RUSTIC_WORDS, POI_CLASS_FALLBACK, rusticifyName
//   TIER_YIELD, POI_CATEGORY, CATEGORY_LOOT, DEFAULT_LOOT
//   POI_PAD_BY_CLASS, POI_PAD_BY_CATEGORY, padShapeKeyForPoi
//   CHEST_TIER_BY_CATEGORY, CHEST_TIER_COLOR, chestTier
//   WILD_TREASURE
//
// Loot pickers (pickTreasure, pickLoot, pickChestRelic / rollGearUpgrade) and
// chestRelicAllowedTiers have been migrated to rarity.js.

const CHEST_ICON = '📦';

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
  pitch:            'Practice Field',
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
  memorial:         'Memorial',
  swimming_pool:    'Bathing Pool',
  bicycle_parking:  'Bicycle Stand',
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

// === Loot tier yields (used by rarity.js / chest contexts) ===
// Per-tier stack size for chest drops. Trimmed from 10/5/2 — old yields
// flooded the inventory with seeds; with produce mixing (see CATEGORY_LOOT
// below) and smaller stacks, chests feel more varied.
const TIER_YIELD = { 1: 5, 2: 3, 3: 1 };

// SEED_TIER (1=common, 2=uncommon, 3=rare) → label + flash color. Used by every
// loot flash (chest, treasure) so the player gets consistent visual feedback.
const SEED_TIER_INFO = {
  1: { label: 'common',   color: '#ffe066' },
  2: { label: 'uncommon', color: '#7adcff' },
  3: { label: 'RARE!',    color: '#ff8aff' },
};
function tierInfo(id) {
  // Resolve a 1..3 flash tier for ANY loot id — seed OR produce. pickReward
  // returns bare produce ids (e.g. 'gemfruit', 'pairy') which never appear in
  // SEED_TIER (it's keyed by `${crop}_seed` only), so the old
  // `SEED_TIER[id] || 1` collapsed every produce reward to tier-1 "common".
  // ITEM_BY_ID[id].baseTier carries the real rarity for both the seed and its
  // produce (filled for every catalog entry in items.js), so prefer it and
  // fall back to SEED_TIER for raw seed ids / unknowns. SEED_TIER_INFO only
  // defines 1..3, while baseTier climbs to 7 (flowers/bars), so clamp.
  const raw = (typeof ITEM_BY_ID !== 'undefined' && ITEM_BY_ID[id]?.baseTier)
    || SEED_TIER[id] || 1;
  const tier = Math.min(3, Math.max(1, raw));
  return SEED_TIER_INFO[tier];
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
  // civic/educational: rare-weighted seed drops
  school: 'civic', college: 'civic', library: 'civic',
  town_hall: 'civic', place_of_worship: 'civic',
  attraction: 'civic', museum: 'civic', memorial: 'civic',
  books: 'civic', pet: 'civic',
  // healthcare: mid-weighted seed drops
  pharmacy: 'health', hospital: 'health', dentist: 'health',
  // parks: T2-leaning seed drops (garden moved to 'flora' above)
  park: 'park', playground: 'park', pitch: 'park',
  // fountain: special — drops nothing useful; treat as common-seed for now
  fountain: 'park',
  // low-tier: bus stops & similar street-furniture POIs are common, heavy T1 seeds
  bus: 'lowtier', fuel: 'lowtier', lodging: 'lowtier', gate: 'lowtier',
  // ── satextract OSM point features → low-tier street furniture. These reach
  // the game only via the Overpass sidecar (data/satextract_osm.geojson), not
  // the MVT poi layer, so they're wired here as plain lowtier box chests.
  // ('powerline' = OSM power=line way centroid; 'tower' is the chest poiClass
  // for man_made=tower — distinct from the castle 'tower' OBJECT kind.)
  traffic_signals: 'lowtier', stop: 'lowtier', crossing: 'lowtier',
  picnic_table: 'lowtier', carport: 'lowtier', fence: 'lowtier',
  powerline: 'lowtier', tower: 'lowtier',
  // ── Daily-tap civic services — heavy T1
  waste_basket: 'lowtier', post: 'lowtier', recycling: 'lowtier',
  drinking_water: 'lowtier', toilets: 'lowtier',
  // ── Restful shelters — small reward, frequent
  shelter: 'lowtier', picnic_site: 'lowtier',
  // ── Bike / ATM — special coin-burst handlers (see app.js); the chest
  // category is only consulted if the coin burst is on cooldown.
  // motorcycle_parking is diverted to a treasure X in worldgen (no chest), so
  // it needs no loot category here.
  bicycle_parking: 'lowtier', atm: 'lowtier',
  // ── Athletic facilities — park-class T2 chest, fits the "leisure" feel
  sports_centre: 'park', yoga: 'park', swimming: 'park',
  swimming_pool: 'park', bowls: 'park', running: 'park',
  ice_rink: 'park', stadium: 'park', dog_park: 'park',
  // ── Cultural plaques — civic T3 chest, dense lore
  art_gallery: 'civic', information: 'civic', monument: 'civic',
  cemetery: 'civic', cinema: 'civic', theatre: 'civic',
  // ── Authority buildings — civic T3 chests
  police: 'civic', fire_station: 'civic', harbor: 'civic',
};
// `drops`:
//   'seed'    → always a seed (planting material)
//   'produce' → always produce (harvested crop, ready to eat/sell)
//   'mixed'   → coin-flip per drop, with chance = produceP (default 0.5)
// Most categories now mix so chests don't all read as "more seeds".
const CATEGORY_LOOT = {
  food:     { drops: 'produce', weights: [[1, 0.60], [2, 0.30], [3, 0.10]] },
  commerce: { drops: 'mixed', produceP: 0.5, weights: [[1, 0.70], [2, 0.25], [3, 0.05]] },
  civic:    { drops: 'mixed', produceP: 0.3, weights: [[1, 0.30], [2, 0.40], [3, 0.30]] },
  health:   { drops: 'mixed', produceP: 0.5, weights: [[1, 0.50], [2, 0.30], [3, 0.20]] },
  park:     { drops: 'mixed', produceP: 0.4, weights: [[1, 0.40], [2, 0.40], [3, 0.20]] },
  flora:    { drops: 'seed',    weights: [[1, 0.10], [2, 0.30], [3, 0.60]], onlyFlowers: true },
  farm:     { drops: 'mixed', produceP: 0.5, weights: [[1, 0.40], [2, 0.40], [3, 0.20]], bonus: 1 },
  lowtier:  { drops: 'mixed', produceP: 0.7, weights: [[1, 0.90], [2, 0.08], [3, 0.02]], yieldOverride: { 1: 3, 2: 2, 3: 1 } },
};

// === POI pad SHAPE mapping ===
// The pad SHAPE itself conveys POI type. The chest sits
// in the shape's designated cell (defined per shape in PAD_SHAPES, textures.js).
//   square2  → sports pitches  (chest in corner, pad extends right + down)
//   cross    → chapels + medical facilities  (+ shape, chest centered)
//   triangle → schools / colleges  (stepped pyramid, chest middle-row centre)
//   square3  → default for parks / food / farm / commerce / flora
//   null     → lowtier (bus stops, intersections, fuel, etc) — bare chest
const POI_PAD_BY_CLASS = {
  place_of_worship: 'cross',
  pharmacy:         'cross',
  hospital:         'cross',
  dentist:          'cross',
  school:           'triangle',
  college:          'triangle',
  pitch:            'square2',
  playground:       'line3v',   // vertical 1×3 strip
};
const POI_PAD_BY_CATEGORY = {
  food:     'line3h',   // horizontal 1×3 strip (market counter / shop front)
  commerce: 'line3h',
  civic:    'square3',  // school/college overridden above
  health:   'cross',
  park:     'square3',  // pitch + playground overridden above
  flora:    'square3',
  farm:     'square3',
};
function padShapeKeyForPoi(poiClass) {
  if (!poiClass) return null;
  if (POI_PAD_BY_CLASS[poiClass]) return POI_PAD_BY_CLASS[poiClass];
  const cat = POI_CATEGORY[poiClass];
  if (cat === 'lowtier') return null;
  return POI_PAD_BY_CATEGORY[cat] || null;
}

const DEFAULT_LOOT = { drops: 'seed', weights: [[1, 0.60], [2, 0.30], [3, 0.10]] };

// Visual chest tier 1..4 derived from category, controls the colored diamond drawn over the chest.
const CHEST_TIER_BY_CATEGORY = {
  // Commercial businesses (shops, restaurants, bakeries, etc.) sit at the lowest tier —
  // no gem rendered. Civic / healthcare / parks / farms remain mid-high; flora is epic.
  lowtier: 1, commerce: 1, food: 1,
  park: 2,
  health: 3, civic: 3, farm: 3,
  flora: 4,
};
// Tier 1 = no gem (skipped at render). Tiers 2-4 are clearly distinct hues.
const CHEST_TIER_COLOR = {
  1: null,     // common — no gem drawn at all
  2: 0xe6e6e6, // off-white (10% greyer than pure white) — uncommon
  3: 0x5f89ff, // lighter blue (10% lighter than 0x4d7cff) — rare
  4: 0xc77dff, // violet — epic
};
function chestTier(poiClass) {
  return CHEST_TIER_BY_CATEGORY[POI_CATEGORY[poiClass]] || 2;
}
function getLootConfig(poiClass) {
  return CATEGORY_LOOT[POI_CATEGORY[poiClass]] || DEFAULT_LOOT;
}


// Wild debris on the map (no tilling needed). Tap within 4m + 18m of player to pick up.
// Spawning is per-polygon in worldgen at a stable 5-30% density (see DEBRIS_CROP/spawnDebris).
// Surprise treasure: when picking a wild ${key}, ${chance} chance to also get a ${bonus}.
const WILD_TREASURE = {
  rockfruit: { chance: 0.1, bonus: 'gemfruit' },
};
