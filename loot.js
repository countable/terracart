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
//   pickTreasure, pickLoot
//   WILD_TREASURE

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

// === Loot tier yields (consumed by pickLoot) ===
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
  return SEED_TIER_INFO[SEED_TIER[id] || 1];
}

// POI class → category, drives chest loot type (produce vs seed) and tier weights.
const POI_CATEGORY = {
  // food: drops PRODUCE (harvested crops) instead of seeds
  restaurant: 'food', cafe: 'food', fast_food: 'food', grocery: 'food',
  butcher: 'food', ice_cream: 'food', bakery: 'food',
  supermarket: 'food', convenience: 'food',
  // commerce: common-weighted seed drops
  alcohol_shop: 'commerce', beer: 'commerce', shop: 'commerce',
  // florist / garden_centre: rare-weighted FLOWER seeds (uses 'flora' category)
  florist: 'flora', garden_centre: 'flora',
  // farm: rare-weighted seed drops, any tier
  farm: 'farm',
  // civic/educational: rare-weighted seed drops
  school: 'civic', college: 'civic', library: 'civic',
  town_hall: 'civic', place_of_worship: 'civic',
  attraction: 'civic', museum: 'civic', memorial: 'civic',
  books: 'civic', pet: 'civic',
  // healthcare: mid-weighted seed drops
  pharmacy: 'health', hospital: 'health', dentist: 'health',
  // parks: T2-leaning seed drops
  park: 'park', garden: 'park', playground: 'park', pitch: 'park',
  // fountain: special — drops nothing useful; treat as common-seed for now
  fountain: 'park',
  // low-tier: bus stops & similar street-furniture POIs are common, heavy T1 seeds
  bus: 'lowtier', fuel: 'lowtier', lodging: 'lowtier', gate: 'lowtier',
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

// Treasure-mark loot: 85% common-tier (50/50 between 1 common seed or $1),
// 10% one uncommon seed, 5% one rare seed.
function pickTreasure(rng) {
  const r = (rng ?? Math.random)();
  const seedsOfTier = (t) => Object.keys(SEED_TIER).filter(s => SEED_TIER[s] === t);
  const pickFrom = (pool) => pool[Math.floor((rng ?? Math.random)() * pool.length)];
  if (r < 0.05) return { kind: 'seed', id: pickFrom(seedsOfTier(3)), n: 1 };
  if (r < 0.15) return { kind: 'seed', id: pickFrom(seedsOfTier(2)), n: 1 };
  // 85% — coin flip between common seed and $1.
  if ((rng ?? Math.random)() < 0.5) return { kind: 'money', amount: 1 };
  return { kind: 'seed', id: pickFrom(seedsOfTier(1)), n: 1 };
}

// Ring relic: per-tier 5% chance to bump rolled tier up by 1 (cap at 3).
// Amulet relic: per-tier 10% chance to double the quantity. Both apply on top
// of the category's normal weights / yield. relics is save.relics (may be null
// in tests / older saves) — read defensively.
function pickLoot(rng, poiClass, relics) {
  const cfg = getLootConfig(poiClass);
  const r = (rng ?? Math.random)();
  let tier = 1, acc = 0;
  for (const [t, w] of cfg.weights) { acc += w; if (r <= acc) { tier = t; break; } }
  // Ring tier-up roll. Skip for flora (already T3-leaning) and lowtier (its
  // yieldOverride assumes the original tier).
  if (relics && typeof ringTierBoost === 'function' && tier < 3 && !cfg.onlyFlowers && !cfg.yieldOverride) {
    if ((rng ?? Math.random)() < ringTierBoost(relics)) tier += 1;
  }
  let pool = Object.keys(SEED_TIER).filter(s => SEED_TIER[s] === tier);
  if (cfg.onlyFlowers) {
    const flowers = pool.filter(s => FLOWER_SEEDS.has(s));
    if (flowers.length) pool = flowers;
  }
  const seedId = pool[Math.floor((rng ?? Math.random)() * pool.length)];
  // Seed-vs-produce decision: per category mode. 'mixed' flips a coin each roll
  // weighted by cfg.produceP (default 0.5) so the same chest type yields both
  // kinds of drops over time — no more "shop chest = always seeds".
  let asProduce = cfg.drops === 'produce';
  if (cfg.drops === 'mixed') {
    asProduce = (rng ?? Math.random)() < (cfg.produceP ?? 0.5);
  }
  const id = asProduce ? seedId.replace(/_seed$/, '') : seedId;
  let n = (cfg.yieldOverride?.[tier] ?? TIER_YIELD[tier]) + (cfg.bonus || 0);
  // (Amulet no longer doubles chest qty — its job is ghost mode now.)
  return { id, n };
}

// === Chest-relic gating ============================================
// Chests + shops can drop/sell relics, but several material tiers stay locked
// until the player proves they've reached the matching milestone. T1-T3 are
// always available; everything above requires a deliberate action.
//
//   T4 Gold     ← harvest a sunflower
//   T5 Platinum ← catch a cow
//   T6 Crimson  ← harvest a fireflower
//   T7 Frost    ← harvest an iceflower
//
// `progress` is the player's save object. Reads .harvested and .caughtKinds
// off it; missing fields are treated as empty so a fresh save just unlocks
// T1..T3. (Earlier versions accepted a raw harvested map for back-compat;
// that was brittle — any future top-level save field named like a crop
// would silently unlock tiers.)
function chestRelicAllowedTiers(progress) {
  const harvested = progress?.harvested || {};
  const caught = progress?.caughtKinds || {};
  const tiers = [1, 2, 3];                             // always available
  if (caught.cow)            tiers.push(5);            // Platinum — catch a cow
  if (harvested.sunflower)   tiers.push(4);            // Gold
  if (harvested.fireflower)  tiers.push(6);            // Crimson
  if (harvested.iceflower)   tiers.push(7);            // Frost
  return tiers.sort((a, b) => a - b);
}

// Pick a chest reward. Two-step:
//
//   1. Roll a (slot, tier) biased by the CHEST'S tier — high-tier chests
//      (flora, civic, etc.) favour high-tier relics; lowtier chests favour
//      wood / copper. The roll only ever picks from `chestRelicAllowedTiers`
//      (gated by the player's harvest + cow milestones).
//   2. If the rolled tier UPGRADES the player's current relic in that slot,
//      return  { kind: 'relic', slot, tier }  → equip on accept.
//      Otherwise return  { kind: 'gold', amount, slot, tier }  → consolation
//      worth half the relic's listed price (player still gets something, never
//      a "you already have this" dud).
//
// `progress` may be the whole save object or — for back-compat — just the
// harvested map. chestRelicAllowedTiers handles either shape.
// `chestT` (1-4) is the chest's own tier from chestTier(poiClass). Defaults
// to 2 (mid) when the caller doesn't know the chest tier.
function pickChestRelic(rng, progress, currentRelics, chestT = 2, currentArmor = null) {
  const random = rng || Math.random;
  const allowed = chestRelicAllowedTiers(progress);
  if (!allowed.length || typeof RELIC_DEFS === 'undefined') return null;
  // Map chest tier (1..4) to a preferred RELIC tier (1..7) — linear ramp so
  // T1 chests centre on T1 relics, T4 chests centre on T7. Preferred ALSO acts
  // as a HARD CEILING — a T1 chest never drops anything above Wood, a T2 chest
  // tops out at Iron, etc. Without the cap, weighted-by-closeness would let
  // even a bus stop occasionally hand out an Iron pickaxe.
  const preferred = Math.min(7, Math.max(1, Math.round(1 + (chestT - 1) * 2)));
  let weighted;
  if (preferred > Math.max(...allowed)) {
    // The chest "wants" a tier the player hasn't unlocked yet (e.g. flora chest
    // asks for T7 but no iceflower harvested). Fall back to a UNIFORM roll over
    // the basic tiers (Wood / Copper / Iron) instead of biasing high — so the
    // player gets random low-tier gear, not always the highest-allowed.
    const baseTiers = allowed.filter(t => t <= 3);
    const pool = baseTiers.length ? baseTiers : allowed;
    weighted = pool.map(t => ({ t, w: 1 }));
  } else {
    // Cap at preferred so chest tier directly limits relic tier.
    const capped = allowed.filter(t => t <= preferred);
    weighted = capped.map(t => ({ t, w: 1 / (1 + Math.abs(t - preferred)) }));
  }
  const total = weighted.reduce((a, b) => a + b.w, 0);
  let r = random() * total;
  let pickedTier = weighted[0].t;
  for (const w of weighted) { r -= w.w; if (r <= 0) { pickedTier = w.t; break; } }
  // Pick a random slot, uniform across every wearable slot — relic slots
  // (pick / axe / hoe / sword / bow / staff / ring / amulet / can / hoe /
  // bugnet / rod / bags) AND armor slots (helmet / chest / legs / boots).
  // Each slot gets equal odds (the 4 armor slots used to be excluded; chests
  // never dropped armor pieces). Slot tag and current-tier lookup branch on
  // whether the chosen slot belongs to RELIC_DEFS or ARMOR_DEFS.
  const relicSlots = Object.keys(RELIC_DEFS);
  const armorSlots = (typeof ARMOR_DEFS !== 'undefined') ? Object.keys(ARMOR_DEFS) : [];
  const slotPool = [
    ...relicSlots.map(s => ({ kind: 'relic', slot: s })),
    ...armorSlots.map(s => ({ kind: 'armor', slot: s })),
  ];
  const sp = slotPool[Math.floor(random() * slotPool.length)];
  const cur = sp.kind === 'relic'
    ? (currentRelics?.[sp.slot]?.tier ?? 0)
    : (currentArmor?.[sp.slot]?.tier ?? 0);
  if (pickedTier > cur) {
    return { kind: sp.kind, slot: sp.slot, tier: pickedTier };
  }
  // Already own equal-or-better: hand over half the gear's gold value.
  // Floor at $1 so even wood-tier dupes pay out something.
  const price = (typeof gearPrice === 'function') ? gearPrice(sp.kind, sp.slot, pickedTier) : 0;
  const amount = Math.max(1, Math.floor(price / 2));
  return { kind: 'gold', amount, slot: sp.slot, gearKind: sp.kind, tier: pickedTier };
}

// Wild debris on the map (no tilling needed). Tap within 4m + 18m of player to pick up.
// Spawning is per-polygon in worldgen at a stable 5-30% density (see DEBRIS_CROP/spawnDebris).
// Surprise treasure: when picking a wild ${key}, ${chance} chance to also get a ${bonus}.
const WILD_TREASURE = {
  rockfruit: { chance: 0.1, bonus: 'gemfruit' },
};
