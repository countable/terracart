// Chest / treasure / wild-debris loot logic + POI category mapping + the
// rustic name transform. Extracted from app.js so the loot tables live next
// to one another and away from rendering / scene code.
//
// Depends on:
//   items.js (SEED_TIER — tierInfo's fallback for raw seed ids). The 'flora'
//   category below is just a POI-category label (florist/garden/garden_centre)
//   consumed by rarity.js's classBias weighting — magical flower seeds are
//   gated by BASE_TIER in items.js, not a dedicated flower-id set here.
//
// Exports as globals:
//   RUSTIC_WORDS, POI_CLASS_FALLBACK, rusticifyName
//   POI_CATEGORY
//   PAD_CATEGORIES, padShapeKeyForPoi
//   CHEST_TIER_BY_CATEGORY, CHEST_TIER_COLOR, chestTier
//   STAND_ITEM_FRAME, STAND_KEYWORD_ITEM, STAND_GENERIC_ITEM, STAND_CLASS_ITEM,
//   standWordItem, standNameItem, produceStandFor
//   WILD_TREASURE
//
// Loot pickers (pickTreasure, pickLoot, pickChestRelic / rollGearUpgrade),
// chestRelicAllowedTiers, AND the old per-category loot tables (CATEGORY_LOOT /
// DEFAULT_LOOT / getLootConfig / TIER_YIELD) have been migrated to / superseded
// by rarity.js's pickReward + classBias engine.

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
// === POI pad mapping ===
// Every POI that gets a pad gets the SAME pad: a single rounded slab sitting in
// the one cell directly under the chest (see PAD_SHAPES.round1 in textures.js).
// The shape no longer conveys POI type — it's just a clean base under the chest.
// Lowtier POIs (bus stops, intersections, fuel, etc.) still skip the pad and
// render a bare chest, as do any classes outside the pad-bearing categories.
const PAD_CATEGORIES = new Set([
  'food', 'commerce', 'civic', 'health', 'park', 'flora', 'farm',
]);
function padShapeKeyForPoi(poiClass) {
  if (!poiClass) return null;
  return PAD_CATEGORIES.has(POI_CATEGORY[poiClass]) ? 'round1' : null;
}

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

// === Themed produce / food stands ==========================================
// A subset of RETAIL POIs (food / commerce / flora) render as a little market
// stall instead of a chest, and sell ONE produce/food item themed off the
// POI's name (or, failing that, its class). The mapping is deterministic — NOT
// random — keyed off ~100 common shop-name words, so a "Pizzeria" always sells
// the same thing and every fish stall looks the same. produceStandFor() returns
// { item, frame } (frame = the market_stand awning-colour for the item family)
// or null. Used by render.js (sprite) and interact.js (loot).
//
// item → awning frame in the market_stand spritesheet (the product "family").
const STAND_ITEM_FRAME = {
  // fruit (orange, 0)
  apple: 0, cherry: 0, peach: 0, banana: 0, orange: 0, coconut: 0, apricot: 0, mango: 0, berry: 0,
  // veg / grocer (green, 1)
  potato: 1, onion: 1, cress: 1, nut: 1, mushroom: 1,
  // meat (red, 2)
  meat: 2,
  // fish (teal, 3)
  salmon: 3, bass: 3, trout: 3, minnow: 3, goldenfish: 3,
  // coffee / bakery (brown, 4)
  coffee: 4,
  // dairy / egg (pale yellow, 5)
  milk: 5, egg: 5,
  // flowers / garden (pink, 6)
  flowers: 6,
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
//   2. a GENERIC venue word anywhere in the name     — "Corner Market"    → potato
//   3. the POI's class                               — an unnamed cafe    → coffee
// Specific beats generic wherever each sits in the name, because the product
// word is the one that describes the goods; between two words of the same
// strength the leftmost wins (shop names lead with what they are).
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
  peach: 'peach', peaches: 'peach', cherry: 'cherry', cherries: 'cherry',
  banana: 'banana', bananas: 'banana', mango: 'mango', tropical: 'mango',
  coconut: 'coconut', apricot: 'apricot', berry: 'berry', berries: 'berry',
  smoothie: 'berry', jam: 'berry', acai: 'berry', preserves: 'berry',
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
  mushroom: 'mushroom', mushrooms: 'mushroom', fungi: 'mushroom',
  nut: 'nut', nuts: 'nut', almond: 'nut', peanut: 'nut', cashew: 'nut',
  pizza: 'mushroom', pizzeria: 'mushroom', italian: 'mushroom', pasta: 'mushroom',
  trattoria: 'mushroom', ramen: 'mushroom', noodle: 'mushroom', noodles: 'mushroom',
  pho: 'mushroom', udon: 'mushroom',
  // meat
  steak: 'meat', steaks: 'meat', ribeye: 'meat', grill: 'meat', grille: 'meat',
  bbq: 'meat', barbecue: 'meat', smokehouse: 'meat', butcher: 'meat', butchers: 'meat',
  meat: 'meat', meats: 'meat', burger: 'meat', burgers: 'meat', kebab: 'meat',
  deli: 'meat', sausage: 'meat', chop: 'meat', chophouse: 'meat', jerky: 'meat',
  bacon: 'meat', ham: 'meat', rotisserie: 'meat', wings: 'meat', chicken: 'meat',
  steakhouse: 'meat', grillhouse: 'meat', meatery: 'meat',
  taco: 'meat', tacos: 'meat', taqueria: 'meat', burrito: 'meat', gyro: 'meat',
  shawarma: 'meat', schnitzel: 'meat', charcuterie: 'meat',
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
  bakery: 'coffee', baker: 'coffee', bread: 'coffee', patisserie: 'coffee',
  pastry: 'coffee', cake: 'coffee', bun: 'coffee', donut: 'coffee',
  doughnut: 'coffee', croissant: 'coffee', boulangerie: 'coffee', creperie: 'coffee',
  bagel: 'coffee', muffin: 'coffee', scone: 'coffee', crumb: 'coffee',
  // A BREWERY is beer, not a coffee brew — an exact key so it never stems
  // down to `brew` and pours the player a cup of coffee.
  brewery: 'potato', brewhouse: 'potato', brewing: 'potato', ale: 'potato',
  alehouse: 'potato', lager: 'potato', beer: 'potato', pint: 'potato',
  // dairy / egg
  dairy: 'milk', milk: 'milk', creamery: 'milk', cheese: 'milk',
  cheesemonger: 'milk', yogurt: 'milk', gelato: 'milk', gelateria: 'milk',
  icecream: 'milk', cream: 'milk', scoop: 'milk', sundae: 'milk',
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
// a retail category — anything else is a guess that can never fire (there is no
// `greengrocer` class in the tiles; that word lives in the name table instead).
const STAND_CLASS_ITEM = {
  butcher: 'meat', bakery: 'coffee', grocery: 'potato',
  supermarket: 'potato', convenience: 'potato', florist: 'flowers',
  garden_centre: 'flowers', garden: 'flowers', ice_cream: 'milk',
  cafe: 'coffee', fast_food: 'meat', alcohol_shop: 'potato', beer: 'potato',
};
const STAND_RETAIL_CATS = new Set(['food', 'commerce', 'flora']);

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

// The item a whole POI name implies: the leftmost SPECIFIC word if the name has
// one, else the leftmost generic word, else null.
function standNameItem(name) {
  let generic = null;
  for (const tok of String(name || '').toLowerCase().split(/[^a-z]+/)) {
    const hit = standWordItem(tok);
    if (!hit) continue;
    if (hit.specific) return hit.item;      // a product word ends the search
    if (!generic) generic = hit.item;       // remember the first venue word
  }
  return generic;
}

function produceStandFor(o) {
  if (!o || o.kind !== 'chest') return null;
  if (o._standCache !== undefined) return o._standCache;   // computed once per object
  let res = null;
  if (STAND_RETAIL_CATS.has(POI_CATEGORY[o.poiClass])) {
    // The shop's own branding wins; fall back to the class word.
    const item = standNameItem(o.name) || STAND_CLASS_ITEM[o.poiClass] || null;
    if (item && STAND_ITEM_FRAME[item] !== undefined &&
        (typeof ITEM_BY_ID === 'undefined' || ITEM_BY_ID[item])) {
      res = { item, frame: STAND_ITEM_FRAME[item] };
    }
  }
  o._standCache = res;
  return res;
}


// Wild debris on the map (no tilling needed). Tap within 4m + 18m of player to pick up.
// Spawning is per-polygon in worldgen at a stable 5-30% density (see DEBRIS_CROP/spawnDebris).
// Surprise treasure: when picking a wild ${key}, ${chance} chance to also get a ${bonus}.
const WILD_TREASURE = {
  rockfruit: { chance: 0.1, bonus: 'gemfruit' },
};
