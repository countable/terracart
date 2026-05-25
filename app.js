// terracart prototype — gameplay layer on top of MVT-driven world.
// - Mobile-sized Phaser canvas (390x844). 11x11 viewport of 5m cells.
// - Real GPS (Geolocation API) if available + permitted; WASD fallback.
// - Tap player to lock/unlock GPS snap.
// - Random creatures spawn in grass/farmland cells (seeded per tile).
// - Tap creature → catch (added to farm). Tap ground with seed selected → plant.
// - Inventory bottom bar shows starter items; tap to select.

const START_LON = -119.47870;
const START_LAT = 49.85438;
const VIEW_CELLS = 11;
const CELL_PX = 32;
const WALK_M_S = 1.4;
const W = 390, H = 844;

// --- Debug ---
// Arrow keys move the player at DEBUG_SPEED_MUL × walk speed when DEBUG is true.
const DEBUG = true;
const DEBUG_SPEED_MUL = 10;

// --- Tap reach radii (metres). Used by handleWorldTap distance checks. ---
const REACH_CREATURE_M  = 4;
const REACH_WILDPLANT_M = 4;
const REACH_OBJECT_M    = 3.5; // chest / tree
const REACH_HOUSE_M     = 6;   // house body is larger than 3.5m
const REACH_FAR_M       = 18;  // outer "too far" gate from the player
const REACH_TREASURE_M  = 7.5; // treasure mark

// Compare-only squared distance — avoids sqrt.
function distM2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

const COLORS = {
  0: 0x5fa84a,  // grass
  1: 0x2e6a2e,  // forest
  2: 0xd9c98a,  // sand
  3: 0x3a78c2,  // water
  4: 0xc7a85b,  // farmland
  5: 0x8a8472,  // residential
  6: 0x7fbf63,  // park
  7: 0x444444,  // road
  8: 0x9a7a4a,  // path
  9: 0x8b4d3a,  // building — small house (default brown)
  10: 0x7d736b, // rock
  11: 0x6e5037, // building_med — shop / mid-rise (deeper brown)
  12: 0x5a5d63, // building_large — civic / school / industrial (slate gray)
  13: 0x383838, // road_lg (motorway/trunk/primary) — darkest
  14: 0x3f3f3f, // road_md (secondary/tertiary)
  // --- Subtype splits — each tile fits into one of three base biomes ---
  15: 0x7eb55a, // SCHOOL       (GRASSLAND) — schoolyard green, slightly mown
  16: 0x7a7a82, // COMMERCIAL   (ROCKY)     — cool slate
  17: 0x5a5a5e, // INDUSTRIAL   (ROCKY)     — dark slate
  18: 0xa39065, // PLAYGROUND   (GRASSLAND) — mulchy tan
  19: 0x6fa850, // PITCH        (GRASSLAND) — vivid sports-field green
  20: 0x365a3a, // WETLAND      (FOREST)    — dim swampy green
  21: 0x88c460, // GOLF         (GRASSLAND) — bright emerald
  22: 0x4a7a32, // ORCHARD      (FOREST)    — olive
};
// Tillable = soil-ish ground. Water, roads (any tier), paths, and any building tier are not.
// Rock (10) is non-tillable too — taps break the rock instead (see handleWorldTap).
const NON_TILLABLE = new Set([3, 7, 8, 9, 10, 11, 12, 13, 14]);
function isTillable(type) { return !NON_TILLABLE.has(type); }


// === Crop-affinity plaque (per-crop wooden sign baked once) ===
// Kept in app.js (not textures.js) because it depends on CROP_ROW + PRODUCE_COL.
function makePlaqueTextures(scene) {
  for (const crop of Object.keys(CROP_ROW)) {
    const key = `plaque_${crop}`;
    if (scene.textures.exists(key)) continue;
    const PW = 26, PH = 22;
    const tex = scene.textures.createCanvas(key, PW, PH);
    const ctx = tex.getContext();
    const BW = 22, BH = 12;
    const BX = (PW - BW) / 2, BY = 2;
    const PX = PW / 2 - 1, PY_TOP = BY + BH, PY_H = 5;
    // ground shadow at base of post
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(PX - 3, PY_TOP + PY_H - 1, 8, 2);
    // short post
    ctx.fillStyle = '#3a2410'; ctx.fillRect(PX, PY_TOP, 2, PY_H);
    ctx.fillStyle = '#5a3a1c'; ctx.fillRect(PX, PY_TOP, 1, PY_H);
    // board
    ctx.fillStyle = '#3a2410'; ctx.fillRect(BX, BY, BW, BH);
    ctx.fillStyle = '#a07043'; ctx.fillRect(BX + 1, BY + 1, BW - 2, BH - 2);
    ctx.fillStyle = '#caa170'; ctx.fillRect(BX + 1, BY + 1, BW - 2, 1);
    ctx.fillStyle = '#6b4824'; ctx.fillRect(BX + 1, BY + BH - 2, BW - 2, 1);
    // bake crop icon — small, desaturated, label-style
    const cropsImg = scene.textures.get('crops')?.getSourceImage();
    if (cropsImg) {
      const row = CROP_ROW[crop];
      ctx.save();
      ctx.filter = 'grayscale(70%) brightness(0.95)';
      const ICON = 10;
      const ix = BX + (BW - ICON) / 2;
      const iy = BY + (BH - ICON) / 2;
      ctx.drawImage(cropsImg, PRODUCE_COL * 16, row * 16, 16, 16, ix, iy, ICON, ICON);
      ctx.restore();
    }
    tex.refresh();
  }
}

// Chests pick a tier (weighted), then a random seed within that tier. Yield depends on tier.
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
const SEED_TIER = {
  rainberry_seed: 1, pairy_seed: 1, nut_seed: 1, potato_seed: 1, shrub_seed: 1,
  gemfruit_seed: 2, rockfruit_seed: 2, coffee_seed: 2, tree_seed: 2,
  iceflower_seed: 3, fireflower_seed: 3, sunflower_seed: 3,
};
const TIER_YIELD = { 1: 10, 2: 5, 3: 2 };
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
const CATEGORY_LOOT = {
  food:     { drops: 'produce', weights: [[1, 0.60], [2, 0.30], [3, 0.10]] },
  commerce: { drops: 'seed',    weights: [[1, 0.70], [2, 0.25], [3, 0.05]] },
  civic:    { drops: 'seed',    weights: [[1, 0.30], [2, 0.40], [3, 0.30]] },
  health:   { drops: 'seed',    weights: [[1, 0.50], [2, 0.30], [3, 0.20]] },
  park:     { drops: 'seed',    weights: [[1, 0.40], [2, 0.40], [3, 0.20]] },
  flora:    { drops: 'seed',    weights: [[1, 0.10], [2, 0.30], [3, 0.60]], onlyFlowers: true },
  farm:     { drops: 'seed',    weights: [[1, 0.40], [2, 0.40], [3, 0.20]], bonus: 1 },
  lowtier:  { drops: 'seed',    weights: [[1, 0.90], [2, 0.08], [3, 0.02]], yieldOverride: { 1: 3, 2: 2, 3: 1 } },
};
// Per-category statue decorations placed in the cell IMMEDIATELY RIGHT of the chest
// (origin 0.5, 1 — anchored at the ground). Bigger so they read at a glance.
const STATUE_DX = CELL_PX;  // one cell to the right of chest
// Each POI chest may sit on a 3×3 concrete pad with the category's statue
// embossed at 20% on each cell. lowtier (bus stops, intersections, fuel,
// lodging, gates) — the most common ones — get NO pad, just a bare chest.
const POI_PAD_BY_CATEGORY = {
  food:  'pad_statue_stockpot',
  civic: 'pad_statue_book',
  health:'pad_statue_potion',
  park:  'pad_statue_flower',
  flora: 'pad_statue_bouquet',
  farm:  'pad_statue_wheat',
  commerce: 'pad_statue_signpost',
};
const POI_PAD_BY_CLASS = {
  place_of_worship: 'pad_statue_chapel',
  shop:             'pad_statue_stall',
  supermarket:      'pad_statue_stall',
  convenience:      'pad_statue_stall',
  grocery:          'pad_statue_stall',
};
function padKeyForPoi(poiClass) {
  if (!poiClass) return null;
  if (POI_PAD_BY_CLASS[poiClass]) return POI_PAD_BY_CLASS[poiClass];
  const cat = POI_CATEGORY[poiClass];
  if (cat === 'lowtier') return null;   // bus/sign/intersection/fuel/etc.
  return POI_PAD_BY_CATEGORY[cat] || null;
}

// Flowers are the T3 crops by tier mapping. Used by 'flora' category restriction.
const FLOWER_SEEDS = new Set(['iceflower_seed', 'fireflower_seed', 'sunflower_seed']);
const DEFAULT_LOOT = { drops: 'seed', weights: [[1, 0.60], [2, 0.30], [3, 0.10]] };

// Visual chest tier 1..4 derived from category, controls the colored diamond drawn over the chest.
const CHEST_TIER_BY_CATEGORY = {
  lowtier: 1,
  commerce: 2, park: 2,
  food: 3, health: 3, civic: 3, farm: 3,
  flora: 4,
};
const CHEST_TIER_COLOR = {
  1: 0xb87333, // bronze
  2: 0xc0c0c0, // silver
  3: 0xffd700, // gold
  4: 0xb9f2ff, // diamond (pale cyan)
};
function chestTier(poiClass) {
  const cat = POI_CATEGORY[poiClass];
  return (cat && CHEST_TIER_BY_CATEGORY[cat]) || 2;
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

function pickLoot(rng, poiClass) {
  const cat = POI_CATEGORY[poiClass];
  const cfg = (cat && CATEGORY_LOOT[cat]) || DEFAULT_LOOT;
  const r = (rng ?? Math.random)();
  let tier = 1, acc = 0;
  for (const [t, w] of cfg.weights) { acc += w; if (r <= acc) { tier = t; break; } }
  let pool = Object.keys(SEED_TIER).filter(s => SEED_TIER[s] === tier);
  if (cfg.onlyFlowers) {
    const flowers = pool.filter(s => FLOWER_SEEDS.has(s));
    if (flowers.length) pool = flowers;
  }
  const seedId = pool[Math.floor((rng ?? Math.random)() * pool.length)];
  const id = cfg.drops === 'produce' ? seedId.replace(/_seed$/, '') : seedId;
  const n = (cfg.yieldOverride?.[tier] ?? TIER_YIELD[tier]) + (cfg.bonus || 0);
  return { id, n };
}

// Wild debris on the map (no tilling needed). Tap within 4m + 18m of player to pick up.
// Spawning is per-polygon in worldgen at a stable 5-30% density (see DEBRIS_CROP/spawnDebris).
//   residential → rockfruit (with surprise treasure)
//   park / forest → shrub
// Surprise treasure: when picking a wild ${key}, ${chance} chance to also get a ${bonus}.
const WILD_TREASURE = {
  rockfruit: { chance: 0.1, bonus: 'gemfruit' },
};

const SAVE_KEY = 'terracart.save.v4';
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
  catch { return {}; }
}
function persistSave(s) { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); }

// Crops (Objects/Crops.png, 9 cols x 16 rows of 16x16 cells).
// Each crop = 1 row. In-world growth: col 0 (sprout) → col 4 (harvestable).
// Inventory icons: col 7 = produce, col 8 = seed.
const CROP_ROW = {
  rainberry: 0, pairy: 1, gemfruit: 2, nut: 3, rockfruit: 4, coffee: 5,
  potato: 6, iceflower: 7, fireflower: 8, sunflower: 9, tree: 10, shrub: 11,
};
const MAX_GROWTH_STAGE = 4; // cols 0..4 inclusive: 5 stages, 4 waterings to mature
const PRODUCE_COL = 7;
const SEEDBOX_COL = 8;
const CROPS_SHEET_COLS = 9; // Crops.png is 9 cols wide

// Per-crop sprite override. Crops listed here use Spring Crops.png (14×8 of 16×16,
// 224×128 total) instead of Crops.png. Spring Crops layout on each crop's row:
//   col 0  = seed (also used in-world for stage 0, "just planted")
//   cols 1-4 = growth stages 1..4 (4 = mature, harvestable)
//   col 8  = produce / fruit (inventory icon for harvested item)
// Add more entries as we identify which game crops correspond to Spring Crops rows.
const SPRING_CROPS_COLS = 14;
const CROP_SPRITE = {
  potato: { sheet: 'springcrops', row: 5 },
  // Long grass uses a procedurally generated 16x16 texture (see drawLongGrassTex).
  longgrass: { sheet: 'longgrass', custom: true },
};

// Build ITEMS from CROP_ROW so seed/produce stay in sync with the crop list.
const CROP_NAMES = {
  rainberry: 'Rainberry', pairy: 'Pairy', gemfruit: 'Gemfruit', nut: 'Nut',
  rockfruit: 'Rockfruit', coffee: 'Coffee', potato: 'Potato', iceflower: 'Iceflower',
  fireflower: 'Fireflower', sunflower: 'Sunflower', tree: 'Tree', shrub: 'Shrub',
};
const ITEMS = [
  ...Object.keys(CROP_ROW).map(c => ({
    id: `${c}_seed`, name: `${CROP_NAMES[c]} Seed`, kind: 'seed', grows: c, icon: '🌱',
  })),
  ...Object.keys(CROP_ROW).map(c => ({
    id: c, name: CROP_NAMES[c], kind: 'produce', crop: c, icon: '🌾',
  })),
  // Caught creatures stack in the inventory.
  { id: 'chicken', name: 'Chicken', kind: 'animal', icon: '🐔' },
  { id: 'cow',     name: 'Cow',     kind: 'animal', icon: '🐄' },
  // Wild-only produce — grows in grasslands, picked as debris. Not plantable.
  { id: 'longgrass', name: 'Long Grass', kind: 'produce', crop: 'longgrass', icon: '🌿' },
  // Wild flower pickups (per-polygon color but stacks as a single item).
  { id: 'flowers', name: 'Flowers', kind: 'produce', icon: '🌼' },
];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
// Chests drop only seeds.
const LOOTABLE_IDS = ITEMS.filter(i => i.kind === 'seed').map(i => i.id);
// Shop: tap a house with a selected item to sell it, or with an empty selection
// to buy the next seed in BUY_LIST.
// Prices are tuned to how easy each item is to obtain.
// Produce range: wild-debris commons at $1, rarest T3 flower at $500.
// Seeds: cheap-to-mid by tier (also paid when buying from the shop).
// Animals: chicken very common (high yield), cow rare.
const PRICES = {
  // ── Seeds ────────────────────────────────────────────────
  rainberry_seed: 3, pairy_seed: 3, nut_seed: 3, potato_seed: 3, shrub_seed: 2,
  gemfruit_seed: 10, rockfruit_seed: 8, coffee_seed: 12, tree_seed: 15,
  iceflower_seed: 30, fireflower_seed: 40, sunflower_seed: 50,
  // ── Produce (sell value) ─────────────────────────────────
  rockfruit: 1,    // wild debris in every residential tile — the floor
  shrub: 2,        // wild debris in parks/forests
  nut: 4,
  potato: 5,
  rainberry: 6,
  pairy: 8,
  gemfruit: 25,    // T2 + occasional rockfruit bonus
  coffee: 40,      // T2, no wild source
  tree: 50,        // T2, no wild source, slow grower
  iceflower: 150,  // T3 rare
  fireflower: 300, // T3 rare
  sunflower: 500,  // rarest — ceiling
  // ── Animals ──────────────────────────────────────────────
  chicken: 4,      // 150–250/tile, yields 4 per catch
  cow: 200,        // ~15–30/tile, yields 1 per catch — premium catch, rare drop
  // ── Wild-only ────────────────────────────────────────────
  longgrass: 1,    // ubiquitous in grasslands — floor price
  flowers: 2,      // wild flower pickups — slightly above longgrass
};
const BUY_LIST = Object.keys(CROP_ROW).map(c => `${c}_seed`);
const STARTING_MONEY = 25;

class MapScene extends Phaser.Scene {
  constructor() { super('map'); }

  preload() {
    this.load.spritesheet('idle', 'Character/Idle.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('walk', 'Character/Walk.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('trees','Objects/Maple Tree.png', { frameWidth: 32, frameHeight: 48 });
    this.load.image('house', 'Objects/House.png');
    // House.png is a tileset (two houses + detail bits). Register a single
    // "front" frame for the right-hand cabin so we only render that.
    this.load.once('filecomplete-image-house', () => {
      this.textures.get('house').add('front', 0, 148, 3, 72, 95);
    });
    this.load.spritesheet('chicken', 'Farm Animals/Chicken Red.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('cow',     'Farm Animals/Female Cow Brown.png', { frameWidth: 32, frameHeight: 32 });
    // chest.png is 32x32 with one chest per row (centered horizontally, ~16px wide with 8px padding).
    // Frames: 0 = closed, 1 = open.
    this.load.spritesheet('chest',   'Objects/chest.png',            { frameWidth: 32, frameHeight: 16 });
    // Crops sheet: 9 cols x 16 rows of 16x16 cells. Each crop = one row.
    // In-world growth: col 0 (sprout) → col 4 (harvestable). Inventory: col 7 produce, col 8 seed.
    this.load.spritesheet('crops',   'Objects/Crops.png',            { frameWidth: 16, frameHeight: 16 });
    // Spring Crops sheet (224×128, 14×8 of 16×16 frames). Used by crops whose
    // art lives here (e.g. potato) — see CROP_SPRITE override below.
    this.load.spritesheet('springcrops', 'Objects/Spring Crops.png',  { frameWidth: 16, frameHeight: 16 });
    // Source PNG has a solid white background — alpha-key near-white pixels to transparent.
    this.load.once('filecomplete-spritesheet-crops', () => {
      const tex = this.textures.get('crops');
      const src = tex.getSourceImage();
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i] > 240 && data.data[i+1] > 240 && data.data[i+2] > 240) {
          data.data[i+3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
      this.textures.remove('crops');
      this.textures.addSpriteSheet('crops', c, { frameWidth: 16, frameHeight: 16 });
      // Now that the alpha-keyed 'crops' image is available, bake per-crop plaque textures.
      makePlaqueTextures(this);
    });
    this.load.spritesheet('cobble',  'Objects/Road copiar.png',      { frameWidth: 16, frameHeight: 16 });
    if (window.TileMap) {
      this.load.spritesheet(TileMap.KEY, TileMap.PATH, { frameWidth: TileMap.FRAME_W, frameHeight: TileMap.FRAME_H });
    }
  }

  create() {
    this.save = Object.assign(
      {
        caught: [], planted: [], opened: [], tilled: [], picked: [], foundTreasures: [], brokenRocks: [], placedRocks: [],
        money: STARTING_MONEY, buyIndex: 0,
        // inv is array of {id, count} — seeds-only per spec; planting decrements count.
        inv: [
          { id: 'potato_seed', count: 10 },
        ],
        selSlot: 0,
        invPage: 0,
      },
      loadSave()
    );
    this.save.opened = this.save.opened || [];
    this.save.tilled = this.save.tilled || [];
    if (this.save.money == null) this.save.money = STARTING_MONEY;
    if (this.save.buyIndex == null) this.save.buyIndex = 0;
    this.tilledSet = new Set(this.save.tilled);
    this.save.brokenRocks = this.save.brokenRocks || [];
    this.brokenRockSet = new Set(this.save.brokenRocks);
    this.save.placedRocks = this.save.placedRocks || [];
    this.placedRockSet = new Set(this.save.placedRocks);
    // Migrate older save (inv as string array, or stash object)
    if (this.save.inv && typeof this.save.inv[0] === 'string') {
      this.save.inv = this.save.inv.filter(Boolean).map(id => ({ id }));
    }
    if (this.save.stash) {
      for (const [id, n] of Object.entries(this.save.stash)) if (n > 0) this.addToInv(id, n, true);
      delete this.save.stash;
    }

    this.cameras.main.setBackgroundColor('#222');
    this.viewCenterX = W / 2;
    this.viewCenterY = H / 2 - 40;            // raise to leave room for inventory bar
    this.viewLeft = this.viewCenterX - (VIEW_CELLS / 2) * CELL_PX;
    this.viewTop  = this.viewCenterY - (VIEW_CELLS / 2) * CELL_PX;
    this.viewSize = VIEW_CELLS * CELL_PX;

    const origin = WorldGen.lonLatToWorldPx(START_LON, START_LAT, WorldGen.Z);
    this.originPx = origin;
    this.mPerPx = WorldGen.metersPerPixel(START_LAT, WorldGen.Z);
    this.cellM = WorldGen.CELL_M;
    this.cellsPerTile = WorldGen.cellsPerEdgeForLat(START_LAT);
    this.tileEdgeM = WorldGen.tileEdgeMeters(START_LAT);
    // Player sprite (idle, 32px frame, scale 1.5, origin 0.5/0.5) has its visual
    // feet at viewCenterY + 24 px. Offset reach checks downward by the same so
    // the reachable area is symmetric around the visible character, not the
    // sprite's geometric center. ~3.75m at the default CELL_PX/cellM.
    this.feetOffsetM = (24 / CELL_PX) * this.cellM;
    this.REACH_CELL_M = 15;   // cell taps: till / plant / water / harvest
    this.REACH_OBJECT_M = 18; // object taps: chests, trees, houses, treasure
    this.startWorldM = {
      x: this.originPx.x * this.mPerPx,
      y: this.originPx.y * this.mPerPx,
    };

    this.playerM = { x: 0, y: 0 };
    this.facing = { x: 0, y: 1 }; // unit-ish vector; updated by movement
    this._ease = null;            // {fromX, fromY, toX, toY, t0, dur} for GPS easing
    this.gpsM = null;
    this.gpsAvailable = false;

    // One-time migration: older saves used pWorldX/cellM for cell indices, which
    // drifts vs the rendered (tile-pixel-basis) cells. Remap tilled keys and
    // snap planted positions to the unified basis so they line up visually.
    if (!this.save.coordSchema || this.save.coordSchema < 2) {
      const remapped = new Set();
      for (const key of this.tilledSet) {
        const [ox, oy] = key.split('_').map(Number);
        const cwmx = (ox + 0.5) * this.cellM;
        const cwmy = (oy + 0.5) * this.cellM;
        const { cellIX, cellIY } = this.worldMetersToAbsCell(cwmx, cwmy);
        remapped.add(`${cellIX}_${cellIY}`);
      }
      this.tilledSet = remapped;
      this.save.tilled = [...remapped];
      for (const p of (this.save.planted || [])) {
        const { cellIX, cellIY } = this.worldMetersToAbsCell(p.x, p.y);
        const c = this.absCellCenterMeters(cellIX, cellIY);
        p.x = c.x; p.y = c.y;
      }
      this.save.coordSchema = 2;
      persistSave(this.save);
    }

    // Procedural per-biome textures for flat-color terrain (water ripples, brick, etc.).
    makeBiomeTextures(this, CELL_PX);
    // Per-polygon flora (flowers / pebbles / mushrooms). Plaque textures are
    // baked in the 'crops' post-load handler in preload, since they composite
    // the produce icon onto a wooden sign.
    makeFloraTextures(this);
    // Long-grass wild-debris sprite. 16x16 so it scales the same as crop frames.
    if (!this.textures.exists('longgrass')) {
      const tex = this.textures.createCanvas('longgrass', 16, 16);
      drawLongGrassTex(tex.getContext(), 16, seededRand(31337));
      tex.refresh();
    }
    // POI "statue" decoration textures — greyscale sculptures shown beside chests.
    const STATUE_DRAWERS = {
      statue_signpost: drawSignpostStatue,
      statue_chapel:   drawChapelStatue,
      statue_book:     drawBookStatue,
      statue_stockpot: drawStockpotStatue,
      statue_potion:   drawPotionStatue,
      statue_wheat:    drawWheatSheafStatue,
      statue_bouquet:  drawBouquetStatue,
      statue_stall:    drawMarketStallStatue,
      statue_flower:   drawFlowerTuftStatue,
    };
    for (const [key, fn] of Object.entries(STATUE_DRAWERS)) {
      if (this.textures.exists(key)) continue;
      const tex = this.textures.createCanvas(key, 16, 16);
      fn(tex.getContext(), 16, seededRand(key.length * 911));
      tex.refresh();
    }
    // 96×96 "concrete pad" textures for each statue (and a plain one).
    // Built once at startup — chests look up the pad by their resolved statue key.
    makePadTexture(this, 'pad_plain', null);
    for (const key of Object.keys(STATUE_DRAWERS)) {
      makePadTexture(this, `pad_${key}`, key);
    }

    // Layers
    this.cellGfx = this.add.graphics();
    this.noiseContainer = this.add.container(0, 0);
    this.terrainContainer = this.add.container(0, 0);
    this.cobbleContainer = this.add.container(0, 0);
    this.plantedContainer = this.add.container(0, 0);
    // Pads (3x3 concrete slabs under POI chests) draw under objects.
    this.padContainer = this.add.container(0, 0);
    this.objectsContainer = this.add.container(0, 0);
    this.creaturesContainer = this.add.container(0, 0);

    // Pre-create terrain sprite pool (one per visible cell) to avoid allocation churn.
    this.terrainPool = [];
    if (window.TileMap) {
      for (let i = 0; i < VIEW_CELLS * VIEW_CELLS; i++) {
        const s = this.add.image(0, 0, TileMap.KEY, 0).setOrigin(0, 0)
          .setDisplaySize(CELL_PX, CELL_PX).setVisible(false);
        this.terrainContainer.add(s);
        this.terrainPool.push(s);
      }
    }

    // Noise overlay pool — one image per visible cell, set to a hashed noise frame.
    this.noisePool = [];
    for (let i = 0; i < VIEW_CELLS * VIEW_CELLS; i++) {
      const s = this.add.image(0, 0, 'biome5_0').setOrigin(0, 0)
        .setDisplaySize(CELL_PX, CELL_PX).setVisible(false);
      this.noiseContainer.add(s);
      this.noisePool.push(s);
    }

    // Cobblestone overlay pool for ROAD cells (one decorative stone centered per cell).
    this.cobblePool = [];
    for (let i = 0; i < VIEW_CELLS * VIEW_CELLS; i++) {
      const s = this.add.image(0, 0, 'cobble', 0).setOrigin(0.5, 0.5)
        .setDisplaySize(CELL_PX, CELL_PX).setVisible(false);
      this.cobbleContainer.add(s);
      this.cobblePool.push(s);
    }

    // Road-letter pool: low-alpha embossed letters laid out one-per-cell along named streets.
    this.letterContainer = this.add.container(0, 0);
    this.letterPool = [];
    for (let i = 0; i < VIEW_CELLS * VIEW_CELLS; i++) {
      const t = this.add.text(0, 0, '', {
        font: 'bold 18px serif', color: '#1a1612',
        stroke: '#1a1612', strokeThickness: 1.5,
      }).setOrigin(0.5, 0.5).setAlpha(0.30).setDepth(0).setVisible(false);
      // Soft bright-bottom shadow → "carved into the cobble" effect.
      t.setShadow(1, 1, 'rgba(255,240,210,0.55)', 0, false, true);
      this.letterContainer.add(t);
      this.letterPool.push(t);
    }

    this.objectPool = [];
    this.plantedPool = [];
    this.creaturePool = [];
    this.chestLabelPool = []; // Phaser.Text objects for POI names above chests
    this.decorPool = [];      // sprites for per-POI "statue" decorations beside chests

    // Viewport mask clips everything inside the 11x11 area.
    const maskG = this.make.graphics({ x: 0, y: 0, add: false });
    maskG.fillStyle(0xffffff);
    maskG.fillRect(this.viewLeft, this.viewTop, this.viewSize, this.viewSize);
    const mask = maskG.createGeometryMask();
    this.cellGfx.setMask(mask);
    this.noiseContainer.setMask(mask);
    this.terrainContainer.setMask(mask);
    this.cobbleContainer.setMask(mask);
    this.letterContainer.setMask(mask);
    this.plantedContainer.setMask(mask);
    this.padContainer.setMask(mask);
    this.objectsContainer.setMask(mask);
    this.creaturesContainer.setMask(mask);

    const frame = this.add.graphics();
    frame.lineStyle(2, 0x000000, 0.6)
      .strokeRect(this.viewLeft - 1, this.viewTop - 1, this.viewSize + 2, this.viewSize + 2);

    // Animations
    this.anims.create({ key: 'idle-anim', frames: this.anims.generateFrameNumbers('idle', { start: 0, end: 3 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: 'walk-anim', frames: this.anims.generateFrameNumbers('walk', { start: 0, end: 5 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'chicken-idle', frames: this.anims.generateFrameNumbers('chicken', { start: 0, end: 1 }), frameRate: 3, repeat: -1 });
    this.anims.create({ key: 'cow-idle',     frames: this.anims.generateFrameNumbers('cow',     { start: 0, end: 3 }), frameRate: 4, repeat: -1 });

    // Player sprite
    // Player sprite — not interactive so taps on it fall through to the world
    // handler (which then treats the tap as if it were the cell under the player).
    this.player = this.add.sprite(this.viewCenterX, this.viewCenterY, 'idle', 0)
      .setScale(1.5)
      .play('idle-anim')
      .setMask(mask);
    // Facing direction indicator — arrow rendered via Graphics, pointed in the
    // direction of the device compass (or last movement as a fallback).
    this.facingGfx = this.add.graphics().setDepth(11).setMask(mask);
    this.compassDeg = null; // degrees clockwise from north, or null if no sensor

    // Keyboard
    this.keys = this.input.keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      UP: Phaser.Input.Keyboard.KeyCodes.UP,
      DOWN: Phaser.Input.Keyboard.KeyCodes.DOWN,
      LEFT: Phaser.Input.Keyboard.KeyCodes.LEFT,
      RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    });

    // World tap (player handler runs first and stops propagation)
    this.input.on('pointerdown', (p) => this.handleWorldTap(p.x, p.y));

    // HUD + banner + inventory
    this.hud = document.getElementById('hud');
    this.moneyEl = document.getElementById('money');
    this.banner = document.getElementById('banner');
    this.buildInventoryDOM();

    // Boot tile load
    this.ensureTilesAround().catch(e => console.error(e));

    // Network status
    window.addEventListener('offline', () => this.showBanner(true));
    window.addEventListener('online', () => this.showBanner(false));

    // GPS watch + device compass (best-effort)
    this.startGps();
    this.startCompass();
  }

  // === GPS ===
  startGps() {
    if (!navigator.geolocation) return;
    this.gpsAvailable = true;
    try {
      this.gpsWatchId = navigator.geolocation.watchPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          const dxM = (longitude - START_LON) * 111320 * Math.cos(START_LAT * Math.PI / 180);
          const dyM = -(latitude - START_LAT) * 111320;
          const prev = this.gpsM;
          this.gpsM = { x: dxM, y: dyM };
          // Ease toward the new GPS fix instead of snapping.
          this._ease = {
            fromX: this.playerM.x, fromY: this.playerM.y,
            toX: this.gpsM.x, toY: this.gpsM.y,
            t0: performance.now(), dur: 300,
          };
          if (prev) {
            const ddx = this.gpsM.x - prev.x, ddy = this.gpsM.y - prev.y;
            // Only use movement as facing fallback when there's no compass.
            if ((ddx || ddy) && this.compassDeg == null) this.facing = { x: ddx, y: ddy };
          }
        },
        err => { console.warn('GPS error', err.message); this.gpsAvailable = false; },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    } catch { this.gpsAvailable = false; }
  }
  // Device compass: prefer absolute-orientation events (Android), fall back to
  // webkitCompassHeading (iOS). Stores degrees clockwise from north in this.compassDeg.
  startCompass() {
    const onOrient = (e) => {
      let deg = null;
      if (typeof e.webkitCompassHeading === 'number') {
        deg = e.webkitCompassHeading; // iOS: already CW from north
      } else if (e.absolute && typeof e.alpha === 'number') {
        deg = (360 - e.alpha) % 360;  // alpha is CCW from north; flip
      } else if (typeof e.alpha === 'number' && this.compassDeg == null) {
        deg = (360 - e.alpha) % 360;  // best-effort non-absolute fallback
      }
      if (deg != null && !Number.isNaN(deg)) {
        const rad = deg * Math.PI / 180;
        this.compassDeg = deg;
        this.facing = { x: Math.sin(rad), y: -Math.cos(rad) };
      }
    };
    const attach = () => {
      window.addEventListener('deviceorientationabsolute', onOrient, true);
      window.addEventListener('deviceorientation', onOrient, true);
    };
    // iOS 13+ requires explicit permission. If the API is gated, request it.
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      DOE.requestPermission().then(r => { if (r === 'granted') attach(); }).catch(() => {});
    } else {
      attach();
    }
  }

  // === Tiles ===
  showBanner(on) { this.banner.style.display = on ? 'block' : 'none'; }

  playerToWorldCell() {
    const wx = this.originPx.x + this.playerM.x / this.mPerPx;
    const wy = this.originPx.y + this.playerM.y / this.mPerPx;
    const tilePx = 256;
    const tx = Math.floor(wx / tilePx);
    const ty = Math.floor(wy / tilePx);
    const cellPxSize = tilePx / this.cellsPerTile;
    const cx = (wx - tx * tilePx) / cellPxSize;
    const cy = (wy - ty * tilePx) / cellPxSize;
    return { tx, ty, cx, cy };
  }

  // Convert world-meters to an absolute cell index using the SAME tile-pixel basis
  // as playerToWorldCell / drawCells (avoids the half-cell drift you get from
  // pWorldX/cellM, since cellsPerTile is a rounded integer).
  worldMetersToAbsCell(wmx, wmy) {
    const wx = this.originPx.x + (wmx - this.startWorldM.x) / this.mPerPx;
    const wy = this.originPx.y + (wmy - this.startWorldM.y) / this.mPerPx;
    const cellPxSize = 256 / this.cellsPerTile;
    return {
      cellIX: Math.floor(wx / cellPxSize),
      cellIY: Math.floor(wy / cellPxSize),
    };
  }
  // Inverse: meters of a cell's center for a given absolute cell index.
  absCellCenterMeters(cellIX, cellIY) {
    const cellPxSize = 256 / this.cellsPerTile;
    const wx = (cellIX + 0.5) * cellPxSize;
    const wy = (cellIY + 0.5) * cellPxSize;
    return {
      x: this.startWorldM.x + (wx - this.originPx.x) * this.mPerPx,
      y: this.startWorldM.y + (wy - this.originPx.y) * this.mPerPx,
    };
  }
  playerAbsCell() {
    const pc = this.playerToWorldCell();
    return {
      cellIX: pc.tx * this.cellsPerTile + Math.floor(pc.cx),
      cellIY: pc.ty * this.cellsPerTile + Math.floor(pc.cy),
    };
  }

  async ensureTilesAround() {
    const cell = this.playerToWorldCell();
    const needed = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      needed.add(`${cell.tx + dx}/${cell.ty + dy}`);
    }
    let anyFailed = false;
    for (const k of needed) {
      const [tx, ty] = k.split('/').map(Number);
      try {
        const entry = await WorldGen.loadTile(tx, ty, START_LAT);
        if (entry.status === 'loading') await entry.promise;
        if (!entry.creatures) this.spawnInTile(entry, tx, ty);
      } catch (e) {
        anyFailed = true;
        console.warn('tile fetch failed', k, e.message);
      }
    }
    this.showBanner(anyFailed && !navigator.onLine);
  }

  // === Spawns ===
  spawnInTile(entry, tx, ty) {
    const rng = WorldGen.makeRng(tx * 0x1f1f1f1f ^ ty * 0x12345);
    const creatures = [];
    const N = entry.cellsPerEdge;
    const tryPlace = (kindWant, classesOK, idx, kindStr) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        const t = entry.grid[cy * N + cx];
        if (classesOK.has(t)) {
          const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
          const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
          const id = `${kindStr}_${tx}_${ty}_${idx}`;
          if (this.save.caught.includes(id)) return;
          creatures.push({ x: wmx, y: wmy, kind: kindStr, id });
          return;
        }
      }
    };
    // Spawn chickens on any soft ground (grass / farmland / park / residential lawn).
    // Each MVT tile is ~1.5km across — the 55m viewport is only ~0.1% of a tile —
    // so we need hundreds per tile for any to actually be visible.
    const chickenN = 150 + Math.floor(rng() * 100);   // 150..250 per tile
    for (let i = 0; i < chickenN; i++) tryPlace('chicken', new Set([0, 4, 5, 6]), i, 'chicken');
    // Cows: same soft ground as chickens, but ~10x rarer.
    const cowN = 15 + Math.floor(rng() * 16);   // 15..30 per tile
    for (let i = 0; i < cowN; i++) tryPlace('cow', new Set([0, 4, 5, 6]), i, 'cow');
    // (Starter-cow at spawn removed — cows are valuable enough that none should be gifted.)
    // Merge in any creatures the player has released back into the world for this tile.
    // save.released is a flat array of {x,y,kind,id,tx,ty} — filter by tile + caught state.
    if (this.save.released) {
      for (const r of this.save.released) {
        if (r.tx !== tx || r.ty !== ty) continue;
        if (this.save.caught.includes(r.id)) continue;
        creatures.push({ x: r.x, y: r.y, kind: r.kind, id: r.id });
      }
    }
    entry.creatures = creatures;

    // Wild debris is generated per-polygon in worldgen and lives on entry.wildplants
    // (set by rasterizeTile). Picked-state filtering happens at render/interact time
    // via this.save.picked.
    entry.wildplants = entry.wildplants || [];

    // Treasure mark — 1/200 tiles get a subtle X (deterministic per tile).
    // Stored on entry.treasure = { x, y, id } or null. Found state lives in save.foundTreasures.
    entry.treasure = null;
    // Force a guaranteed X ~10m north of the player's start.
    if (sx >= tx0 && sx < tx0 + this.tileEdgeM && sy >= ty0 && sy < ty0 + this.tileEdgeM) {
      entry.treasure = { x: sx, y: sy - 10, id: `treasure_start_${tx}_${ty}` };
    } else if (rng() < 1 / 200) {
      for (let attempt = 0; attempt < 16; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        const t = entry.grid[cy * N + cx];
        // Place on any walkable ground (skip water + buildings).
        if (t === 3 || t === 9 || t === 11 || t === 12) continue;
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
        entry.treasure = { x: wmx, y: wmy, id: `treasure_${tx}_${ty}` };
        break;
      }
    }
  }

  // === Tick ===
  update(_, dtMs) {
    const dt = dtMs / 1000;
    let vx = 0, vy = 0;
    const k = this.keys;
    if (k.A.isDown) vx -= 1;
    if (k.D.isDown) vx += 1;
    if (k.W.isDown) vy -= 1;
    if (k.S.isDown) vy += 1;
    // Arrow keys: DEBUG_SPEED_MUL × speed for fast debug travel (gated on DEBUG).
    let speedMul = 1;
    if (DEBUG) {
      if (k.LEFT.isDown)  { vx -= 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.RIGHT.isDown) { vx += 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.UP.isDown)    { vy -= 1; speedMul = DEBUG_SPEED_MUL; }
      if (k.DOWN.isDown)  { vy += 1; speedMul = DEBUG_SPEED_MUL; }
    }
    const moving = vx || vy;
    if (moving) {
      const n = Math.hypot(vx, vy);
      this.playerM.x += (vx / n) * WALK_M_S * speedMul * dt;
      this.playerM.y += (vy / n) * WALK_M_S * speedMul * dt;
      // Only let WASD drive facing when there's no compass heading available.
      if (this.compassDeg == null) this.facing = { x: vx, y: vy };
      if (this.player.anims.currentAnim?.key !== 'walk-anim') this.player.play('walk-anim');
      if (vx < 0) this.player.setFlipX(true);
      else if (vx > 0) this.player.setFlipX(false);
    } else if (this._ease) {
      // Ease playerM toward last GPS fix (easeOutCubic, 300ms).
      const u = Math.min(1, (performance.now() - this._ease.t0) / this._ease.dur);
      const e = 1 - Math.pow(1 - u, 3);
      this.playerM.x = this._ease.fromX + (this._ease.toX - this._ease.fromX) * e;
      this.playerM.y = this._ease.fromY + (this._ease.toY - this._ease.fromY) * e;
      const easeDx = this._ease.toX - this._ease.fromX;
      const easeDy = this._ease.toY - this._ease.fromY;
      if (u < 1 && (easeDx || easeDy)) {
        if (easeDx < -0.001) this.player.setFlipX(true);
        else if (easeDx > 0.001) this.player.setFlipX(false);
        if (this.player.anims.currentAnim?.key !== 'walk-anim') this.player.play('walk-anim');
      } else if (u >= 1) {
        this._ease = null;
        if (this.player.anims.currentAnim?.key !== 'idle-anim') this.player.play('idle-anim');
      }
    } else if (this.player.anims.currentAnim?.key !== 'idle-anim') {
      this.player.play('idle-anim');
    }

    // Facing-direction indicator: yellow triangle arrow at the player's head,
    // pointing in the compass heading (or last movement, as fallback).
    this.facingGfx.clear();
    const fmag = Math.hypot(this.facing.x, this.facing.y);
    if (fmag > 0.001) {
      const fx = this.facing.x / fmag, fy = this.facing.y / fmag;
      // perpendicular for the base of the triangle
      const px = -fy, py = fx;
      const tip = 22; // distance from player center to arrow tip
      const base = 14; // distance from player center to arrow base midpoint
      const halfW = 6; // half-width of the base
      const cx = this.viewCenterX, cy = this.viewCenterY - 2;
      const tx = cx + fx * tip, ty = cy + fy * tip;
      const blx = cx + fx * base + px * halfW, bly = cy + fy * base + py * halfW;
      const brx = cx + fx * base - px * halfW, bry = cy + fy * base - py * halfW;
      // dark outline
      this.facingGfx.lineStyle(2, 0x000000, 0.85);
      this.facingGfx.beginPath();
      this.facingGfx.moveTo(tx, ty);
      this.facingGfx.lineTo(blx, bly);
      this.facingGfx.lineTo(brx, bry);
      this.facingGfx.closePath();
      this.facingGfx.strokePath();
      // bright yellow fill
      this.facingGfx.fillStyle(0xffd24a, 1);
      this.facingGfx.fillTriangle(tx, ty, blx, bly, brx, bry);
    }

    if (!this._lastCheckM ||
        Math.hypot(this.playerM.x - this._lastCheckM.x, this.playerM.y - this._lastCheckM.y) > 20) {
      this._lastCheckM = { ...this.playerM };
      this.ensureTilesAround().catch(() => {});
    }

    // All farming actions (till/water/plant/harvest) are tap-driven now — no walk-over auto-actions.

    this.wanderCreatures();
    this.drawCells();
    this.drawObjects();
    this.updateHUD();
  }

  // Chickens and cows wander ~1 cell every 5s in a random direction.
  // Per-creature state lives on the creature object: _startX/Y, _targetX/Y,
  // _stepT0, _nextChooseT, _homeX/Y, _faceFlip.
  wanderCreatures() {
    const now = performance.now();
    const STEP_MS = 5000;
    const STEP_M = this.cellM;   // 1 cell per step
    // Only sim chickens near the player (slightly beyond viewport). Off-screen
    // chickens stay frozen at their last position — cheap and invisible.
    const px = this.startWorldM.x + this.playerM.x;
    const py = this.startWorldM.y + this.playerM.y;
    // Viewport corner is VIEW_CELLS/2 * √2 cells away; add a generous margin so
    // a chicken just entering the viewport is already mid-step.
    const RANGE_M = (VIEW_CELLS + 4) * this.cellM;
    const RANGE_SQ = RANGE_M * RANGE_M;
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.creatures) continue;
      for (const c of entry.creatures) {
        if (c.kind !== 'chicken' && c.kind !== 'cow') continue;
        if (this.save.caught.includes(c.id)) continue;
        const ddx = c.x - px, ddy = c.y - py;
        if (ddx * ddx + ddy * ddy > RANGE_SQ) continue;
        if (c._nextChooseT == null || now >= c._nextChooseT) {
          if (c._homeX == null) { c._homeX = c.x; c._homeY = c.y; }
          // Bias back toward home if we've drifted far so chickens stay near
          // their spawn cluster rather than wandering off forever.
          const dxh = c._homeX - c.x, dyh = c._homeY - c.y;
          const homeBias = Math.hypot(dxh, dyh) > 3 * this.cellM;
          // Try up to 6 angles to find one whose destination isn't a placed
          // rockfruit "fence" — so chickens visibly avoid player-built walls.
          let tx = c.x, ty = c.y, angle = 0;
          for (let attempt = 0; attempt < 6; attempt++) {
            angle = homeBias
              ? Math.atan2(dyh, dxh) + (Math.random() - 0.5) * 0.8
              : Math.random() * Math.PI * 2;
            tx = c.x + Math.cos(angle) * STEP_M;
            ty = c.y + Math.sin(angle) * STEP_M;
            const cellIX = Math.floor(tx / this.cellM);
            const cellIY = Math.floor(ty / this.cellM);
            if (!this.placedRockSet || !this.placedRockSet.has(`${cellIX}_${cellIY}`)) break;
          }
          c._startX = c.x; c._startY = c.y;
          c._targetX = tx; c._targetY = ty;
          c._stepT0 = now;
          c._nextChooseT = now + STEP_MS;
          c._faceFlip = (c._targetX - c._startX) < 0;
        }
        const u = Math.min(1, (now - c._stepT0) / STEP_MS);
        c.x = c._startX + (c._targetX - c._startX) * u;
        c.y = c._startY + (c._targetY - c._startY) * u;
      }
    }
  }

  // Walk outward in a ring (up to 6 cells) from the given world-cell coords and return
  // the COLOR of the first non-road, non-building cell found. Returns null if none found.
  neighborNonRoadColor(wcx, wcy) {
    const offsets = [
      [1,0],[-1,0],[0,1],[0,-1],
      [2,0],[-2,0],[0,2],[0,-2],[1,1],[1,-1],[-1,1],[-1,-1],
      [3,0],[-3,0],[0,3],[0,-3],
    ];
    for (const [dx, dy] of offsets) {
      const ncx = wcx + dx, ncy = wcy + dy;
      const tx = Math.floor(ncx / this.cellsPerTile);
      const ty = Math.floor(ncy / this.cellsPerTile);
      const ix = Math.floor(ncx - tx * this.cellsPerTile);
      const iy = Math.floor(ncy - ty * this.cellsPerTile);
      const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
      if (!entry || !entry.grid) continue;
      const t = entry.grid[iy * this.cellsPerTile + ix] || 0;
      // Skip roads (any tier) and buildings — those are themselves overlays.
      if (t !== 7 && t !== 13 && t !== 14 && t !== 9 && t !== 11 && t !== 12) return COLORS[t] ?? null;
    }
    return null;
  }

  // === Drawing ===
  drawCells() {
    const g = this.cellGfx;
    g.clear();
    const half = (VIEW_CELLS - 1) / 2;
    const pc = this.playerToWorldCell();
    const fracX = pc.cx - Math.floor(pc.cx);
    const fracY = pc.cy - Math.floor(pc.cy);
    // Player's absolute cell index in the unified tile-pixel basis. All per-cell
    // state lookups (tilled, watered) must derive from this same basis or they'll
    // drift relative to the rendered cell positions.
    const baseCellIX = pc.tx * this.cellsPerTile + Math.floor(pc.cx);
    const baseCellIY = pc.ty * this.cellsPerTile + Math.floor(pc.cy);
    let terrainIdx = 0;
    let cobbleIdx = 0;
    let noiseIdx = 0;
    let letterIdx = 0;
    // Road copiar.png is a 5x4 grid of 16×16 frames. Only frames 0-8, 10-11,
    // 15-16 contain art. Each road tier picks ONE frame so the same road class
    // reads visually consistent across cells; different tiers look distinct.
    //   - ROAD_LG (motorway/trunk/primary): frame 0 — biggest, densest cluster
    //   - ROAD_MD (secondary/tertiary):     frame 5 — medium cluster
    //   - ROAD (minor/service/street):      frame 1 — small cluster
    //   - PATH:                             frame 3 — single small pebble
    const ROAD_FRAME = { 7: 1, 13: 0, 14: 5 };
    const PATH_FRAME = 3;
    const ROAD = 7, ROAD_LG = 13, ROAD_MD = 14;
    const PATH = 8;
    const isRoad = (t) => t === ROAD || t === ROAD_LG || t === ROAD_MD;
    // Pre-compute a ring of cell types (VIEW_CELLS+2) so edge cells can read their
    // out-of-viewport neighbors when deciding which corners to round.
    const RING = VIEW_CELLS + 2;
    const types = new Int8Array(RING * RING);
    for (let r = 0; r < RING; r++) {
      for (let c = 0; c < RING; c++) {
        const wcx = pc.cx + (c - 1 - half) + pc.tx * this.cellsPerTile;
        const wcy = pc.cy + (r - 1 - half) + pc.ty * this.cellsPerTile;
        const tx2 = Math.floor(wcx / this.cellsPerTile);
        const ty2 = Math.floor(wcy / this.cellsPerTile);
        const ix2 = Math.floor(wcx - tx2 * this.cellsPerTile);
        const iy2 = Math.floor(wcy - ty2 * this.cellsPerTile);
        const e2 = WorldGen.tileCache.get(`${WorldGen.Z}/${tx2}/${ty2}`);
        types[r * RING + c] = (e2 && e2.grid) ? (e2.grid[iy2 * this.cellsPerTile + ix2] || 0) : 0;
      }
    }
    const T = (c, r) => types[(r + 1) * RING + (c + 1)];   // c,r in 0..VIEW_CELLS-1
    // Flat-only types (no tileset art) get rounded corners at zone boundaries.
    const FLAT_ROUNDABLE = new Set([3, 5, 7, 8, 9, 10, 11, 12, 13, 14]);   // water, residential, all roads, path, all buildings, rock
    const CORNER_R = 6;
    for (let row = 0; row < VIEW_CELLS; row++) {
      for (let col = 0; col < VIEW_CELLS; col++) {
        const ox = col - half;
        const oy = row - half;
        // Per-cell state override: placed rockfruit rocks render as ROCK (10),
        // broken natural rocks revert to GRASS (0). cellKey here matches the
        // tile-pixel basis used for tilled / planted state.
        const _absIX = baseCellIX + ox;
        const _absIY = baseCellIY + oy;
        const _cellKey = `${_absIX}_${_absIY}`;
        let type = T(col, row);
        if (this.placedRockSet && this.placedRockSet.has(_cellKey)) type = 10;
        else if (type === 10 && this.brokenRockSet && this.brokenRockSet.has(_cellKey)) type = 0;
        // For ROAD cells, inherit the color of the nearest non-road neighbor so the cobbles
        // sit on top of the surrounding zone (residential/grass/etc) instead of a hard gray strip.
        let color = COLORS[type] ?? 0x5fa84a;
        if (isRoad(type)) {
          const wcx = pc.cx + ox + pc.tx * this.cellsPerTile;
          const wcy = pc.cy + oy + pc.ty * this.cellsPerTile;
          color = this.neighborNonRoadColor(wcx, wcy) ?? color;
        }
        const sx = Math.round(this.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
        const sy = Math.round(this.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);

        // Per-corner rounding: a corner rounds only when both orthogonal neighbors AND the
        // diagonal are a different type (avoids notches between two already-square zones).
        // Sprite-art zones cover the full 32×32 box, so we skip rounding there entirely.
        let tl = 0, tr = 0, bl = 0, br = 0;
        if (FLAT_ROUNDABLE.has(type)) {
          const tn = T(col, row - 1), ts_ = T(col, row + 1);
          const tw = T(col - 1, row), te = T(col + 1, row);
          const tnw = T(col - 1, row - 1), tne = T(col + 1, row - 1);
          const tsw = T(col - 1, row + 1), tse = T(col + 1, row + 1);
          if (tn !== type && tw !== type && tnw !== type) tl = CORNER_R;
          if (tn !== type && te !== type && tne !== type) tr = CORNER_R;
          if (ts_ !== type && tw !== type && tsw !== type) bl = CORNER_R;
          if (ts_ !== type && te !== type && tse !== type) br = CORNER_R;
          // Paint diagonal-neighbor color in each rounded corner first so the pixels
          // revealed outside the curve are the correct adjacent-zone colour.
          if (tl) { g.fillStyle(COLORS[tnw] ?? 0x5fa84a, 1); g.fillRect(sx, sy, CORNER_R, CORNER_R); }
          if (tr) { g.fillStyle(COLORS[tne] ?? 0x5fa84a, 1); g.fillRect(sx + CELL_PX - CORNER_R, sy, CORNER_R, CORNER_R); }
          if (bl) { g.fillStyle(COLORS[tsw] ?? 0x5fa84a, 1); g.fillRect(sx, sy + CELL_PX - CORNER_R, CORNER_R, CORNER_R); }
          if (br) { g.fillStyle(COLORS[tse] ?? 0x5fa84a, 1); g.fillRect(sx + CELL_PX - CORNER_R, sy + CELL_PX - CORNER_R, CORNER_R, CORNER_R); }
        }
        g.fillStyle(color, 1);
        if (tl || tr || bl || br) {
          g.fillRoundedRect(sx, sy, CELL_PX, CELL_PX, { tl, tr, bl, br });
        } else {
          g.fillRect(sx, sy, CELL_PX, CELL_PX);
        }

        // Tilled check — use the same tile-pixel basis as cell rendering.
        const absCellIX = baseCellIX + ox;
        const absCellIY = baseCellIY + oy;
        const tilledKey = `${absCellIX}_${absCellIY}`;
        let isTilled = this.tilledSet && this.tilledSet.has(tilledKey);
        // Self-heal: if a cell is marked tilled but its actual terrain is non-tillable
        // (e.g. an old save where a GPS jump tilled an unloaded-then-building cell),
        // silently drop it so the house renders correctly again.
        if (isTilled && !isTillable(type)) {
          this.tilledSet.delete(tilledKey);
          this.save.tilled = [...this.tilledSet];
          persistSave(this.save);
          isTilled = false;
        }
        let isWatered = false;
        if (isTilled) {
          const c = this.absCellCenterMeters(absCellIX, absCellIY);
          for (const pp of this.save.planted) {
            if (pp.watered_t && Math.abs(pp.x - c.x) < 0.1 && Math.abs(pp.y - c.y) < 0.1) {
              isWatered = true; break;
            }
          }
        }

        // All ground art is procedural now — keep the legacy tile-sprite pool hidden.
        if (this.terrainPool.length) {
          this.terrainPool[terrainIdx++].setVisible(false);
        }

        // Repaint base color for tilled cells (yellow-brown soil, replaces underlying terrain color).
        if (isTilled) {
          g.fillStyle(TILLED_COLOR, 1);
          if (tl || tr || bl || br) {
            g.fillRoundedRect(sx, sy, CELL_PX, CELL_PX, { tl, tr, bl, br });
          } else {
            g.fillRect(sx, sy, CELL_PX, CELL_PX);
          }
        }

        // Procedural texture overlay for every ground cell.
        {
          const ns = this.noisePool[noiseIdx++];
          const h = (absCellIX * 2246822519) ^ (absCellIY * 3266489917);
          let texKey = null;
          if (isTilled) {
            texKey = `tilled_${Math.abs(h) % TILLED_VARIANTS}`;
          } else {
            const spec = BIOME_TEX[type];
            if (spec) texKey = `biome${type}_${Math.abs(h) % spec.variants}`;
          }
          if (texKey) {
            ns.setTexture(texKey)
              .setPosition(Math.round(sx), Math.round(sy))
              .setVisible(true);
          } else {
            ns.setVisible(false);
          }
        }

        // Embossed road-name letter — one per road/path cell, low-alpha "carved" look.
        {
          const lt = this.letterPool[letterIdx++];
          if (!isTilled && (isRoad(type) || type === 8 /* PATH */)) {
            // Look up letter for this cell from its owning tile.
            const wcxL = pc.cx + ox + pc.tx * this.cellsPerTile;
            const wcyL = pc.cy + oy + pc.ty * this.cellsPerTile;
            const tx2 = Math.floor(wcxL / this.cellsPerTile);
            const ty2 = Math.floor(wcyL / this.cellsPerTile);
            const ix2 = Math.floor(wcxL - tx2 * this.cellsPerTile);
            const iy2 = Math.floor(wcyL - ty2 * this.cellsPerTile);
            const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx2}/${ty2}`);
            const info = entry && entry.roadLetters && entry.roadLetters[`${ix2}_${iy2}`];
            if (info) {
              // Keep letters upright — rotating them per-segment makes them hard to read at small sizes.
              lt.setText(info.char).setPosition(sx + CELL_PX / 2, sy + CELL_PX / 2)
                .setRotation(0).setVisible(true);
            } else {
              lt.setVisible(false);
            }
          } else {
            lt.setVisible(false);
          }
        }

        // Cobblestone overlay — dense cluster for ROAD, sparse single pebble for PATH.
        {
          const cs = this.cobblePool[cobbleIdx++];
          // Single frame per type — no per-cell randomization, so a road of one
          // class reads as one consistent surface across all its cells.
          const frame = isRoad(type) ? ROAD_FRAME[type]
                       : (type === PATH ? PATH_FRAME : null);
          if (frame != null && !isTilled) {
            cs.setFrame(frame)
              .setPosition(Math.round(sx + CELL_PX / 2), Math.round(sy + CELL_PX / 2))
              .setVisible(true);
          } else {
            cs.setVisible(false);
          }
        }

        // Subtle darker tint for watered tilled cells (just enough to read as damp soil).
        if (isWatered) {
          g.fillStyle(0x000000, 0.22);
          g.fillRect(Math.round(sx), Math.round(sy), CELL_PX, CELL_PX);
        }
      }
    }
    // Reach indicator — subtle white outline tracing only the outer edge of the
    // reachable area (cells whose centre is within REACH_CELL_M of the character's
    // visible feet). For each reachable cell, draw only the sides whose neighbour
    // is NOT reachable. Result is the staircase silhouette of the reach region.
    const R2 = this.REACH_CELL_M * this.REACH_CELL_M;
    const isReach = (col, row) => {
      const ox = col - half, oy = row - half;
      const dxM = (ox - fracX + 0.5) * this.cellM;
      const dyM = (oy - fracY + 0.5) * this.cellM - this.feetOffsetM;
      return dxM * dxM + dyM * dyM <= R2;
    };
    // Darken every cell OUTSIDE the reach area so the player's eye lands on
    // what's actionable. Done before the outline so the white border sits on
    // top of the dim band, not under it.
    g.fillStyle(0x000000, 0.22);
    for (let row = 0; row < VIEW_CELLS; row++) {
      for (let col = 0; col < VIEW_CELLS; col++) {
        if (isReach(col, row)) continue;
        const ox = col - half, oy = row - half;
        const sx = Math.round(this.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
        const sy = Math.round(this.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);
        g.fillRect(sx, sy, CELL_PX, CELL_PX);
      }
    }
    g.lineStyle(3, 0xffffff, 0.5);
    for (let row = 0; row < VIEW_CELLS; row++) {
      for (let col = 0; col < VIEW_CELLS; col++) {
        if (!isReach(col, row)) continue;
        const ox = col - half, oy = row - half;
        const sx = Math.round(this.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
        const sy = Math.round(this.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);
        const top = !isReach(col, row - 1);
        const bot = !isReach(col, row + 1);
        const lft = !isReach(col - 1, row);
        const rgt = !isReach(col + 1, row);
        if (top) g.lineBetween(sx, sy, sx + CELL_PX, sy);
        if (bot) g.lineBetween(sx, sy + CELL_PX, sx + CELL_PX, sy + CELL_PX);
        if (lft) g.lineBetween(sx, sy, sx, sy + CELL_PX);
        if (rgt) g.lineBetween(sx + CELL_PX, sy, sx + CELL_PX, sy + CELL_PX);
      }
    }

    // Grid lines align with cell edges. Cells are positioned at
    //   sx = viewCenterX + (ox - fracX) * CELL_PX  (cell center)
    //   left edge = sx - CELL_PX/2 = viewLeft + CELL_PX/2 + (j - fracX) * CELL_PX
    // so grid lines need the same +CELL_PX/2 offset.
    g.lineStyle(1, 0x000000, 0.08);
    const xShift = -fracX * CELL_PX + CELL_PX / 2;
    const yShift = -fracY * CELL_PX + CELL_PX / 2;
    for (let i = -1; i <= VIEW_CELLS + 1; i++) {
      const x = Math.round(this.viewLeft + i * CELL_PX + xShift);
      const y = Math.round(this.viewTop  + i * CELL_PX + yShift);
      g.lineBetween(x, this.viewTop, x, this.viewTop + this.viewSize);
      g.lineBetween(this.viewLeft, y, this.viewLeft + this.viewSize, y);
    }

    // Treasure marks — subtle X on the ground (unfound only).
    const pWorldX = this.startWorldM.x + this.playerM.x;
    const pWorldY = this.startWorldM.y + this.playerM.y;
    const halfM = (VIEW_CELLS / 2 + 1) * this.cellM;
    const found = new Set(this.save.foundTreasures || []);
    g.lineStyle(2, 0x2a1d10, 0.55);
    const drawX = (tr) => {
      if (!tr || found.has(tr.id)) return;
      const dx = tr.x - pWorldX, dy = tr.y - pWorldY;
      if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) return;
      const cx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const cy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      const s = 6;
      g.lineBetween(Math.round(cx - s), Math.round(cy - s), Math.round(cx + s), Math.round(cy + s));
      g.lineBetween(Math.round(cx + s), Math.round(cy - s), Math.round(cx - s), Math.round(cy + s));
    };
    for (const entry of WorldGen.tileCache.values()) {
      drawX(entry.treasure);
      if (entry.parkingTreasures) for (const tr of entry.parkingTreasures) drawX(tr);
    }
  }

  worldMetersToScreen(wmx, wmy) {
    const pWorldX = this.startWorldM.x + this.playerM.x;
    const pWorldY = this.startWorldM.y + this.playerM.y;
    return {
      x: this.viewCenterX + ((wmx - pWorldX) / this.cellM) * CELL_PX,
      y: this.viewCenterY + ((wmy - pWorldY) / this.cellM) * CELL_PX,
    };
  }
  screenToWorldMeters(sx, sy) {
    const dx = (sx - this.viewCenterX) / CELL_PX * this.cellM;
    const dy = (sy - this.viewCenterY) / CELL_PX * this.cellM;
    return {
      x: this.startWorldM.x + this.playerM.x + dx,
      y: this.startWorldM.y + this.playerM.y + dy,
    };
  }

  drawObjects() {
    const halfM = (VIEW_CELLS / 2 + 1) * this.cellM;
    const pWorldX = this.startWorldM.x + this.playerM.x;
    const pWorldY = this.startWorldM.y + this.playerM.y;
    const objList = [], creatureList = [], plantedList = [];
    const pickedSet = new Set(this.save.picked || []);
    for (const entry of WorldGen.tileCache.values()) {
      if (entry.objects) {
        for (const o of entry.objects) {
          const dx = o.x - pWorldX, dy = o.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          // Picked flowers stay gone — skip rendering them.
          if (o.kind === 'flora' && o.id && pickedSet.has(o.id)) continue;
          objList.push({ o, dx, dy });
        }
      }
      if (entry.creatures) {
        for (const c of entry.creatures) {
          if (this.save.caught.includes(c.id)) continue;
          const dx = c.x - pWorldX, dy = c.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          creatureList.push({ c, dx, dy });
        }
      }
      // Wild plants render as planted crops at the mature stage (col 4).
      if (entry.wildplants) {
        for (const wp of entry.wildplants) {
          if (pickedSet.has(wp.id)) continue;
          const dx = wp.x - pWorldX, dy = wp.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          plantedList.push({ p: { x: wp.x, y: wp.y, crop: wp.crop, stage: MAX_GROWTH_STAGE, wildId: wp.id }, dx, dy });
        }
      }
    }
    for (const p of this.save.planted) {
      const dx = p.x - pWorldX, dy = p.y - pWorldY;
      if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
      plantedList.push({ p, dx, dy });
    }

    // Filter out chopped trees and (already-)opened chests handled in inner loop above? Do it here.
    const filteredObj = objList.filter(({ o }) => !o.chopped);
    filteredObj.sort((a, b) => a.dy - b.dy);
    this.renderPool(this.objectPool, this.objectsContainer, filteredObj, (s, item) => {
      const { o, dx, dy } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      if (o.kind === 'house') {
        if (s.texture.key !== 'house') s.setTexture('house', 'front');
        else if (s.frame.name !== 'front') s.setFrame('front');
        s.setOrigin(0.5, 0.9).setScale(0.6).setPosition(Math.round(sx), Math.round(sy));
      } else if (o.kind === 'tree') {
        if (s.texture.key !== 'trees') s.setTexture('trees');
        s.setFrame(Phaser.Math.Clamp(o.variant || 2, 0, 4));
        s.setOrigin(0.5, 0.95).setScale(0.85).setPosition(Math.round(sx), Math.round(sy));
      } else if (o.kind === 'chest') {
        if (s.texture.key !== 'chest') s.setTexture('chest');
        const opened = this.save.opened.includes(o.id);
        // chest.png frames 0/1 are nearly identical, so make 'opened' obvious
        // with a strong dark tint + reduced alpha.
        s.setFrame(opened ? 1 : 0);
        s.setOrigin(0.5, 0.9).setScale(2).setPosition(Math.round(sx), Math.round(sy));
        s.setAlpha(opened ? 0.45 : 1);
        s.setTint(opened ? 0x404040 : 0xffffff);
      } else if (o.kind === 'flora') {
        const key = `flora_${o.deco}_${o.variant ?? 0}`;
        if (this.textures.exists(key)) {
          if (s.texture.key !== key) s.setTexture(key);
          s.setOrigin(0.5, 0.8).setScale(1.8).setPosition(Math.round(sx), Math.round(sy));
          s.setAlpha(1).setTint(0xffffff);
        } else {
          s.setVisible(false);
        }
      }
    });

    // POI concrete pads — a 3×3 (96×96 px) rounded slab centered under each
    // chest with the category's statue embossed on each cell at 20% alpha.
    // lowtier POIs (bus stops, intersections, etc.) skip the pad entirely.
    const padList = [];
    for (const item of filteredObj) {
      const { o, dx, dy } = item;
      if (o.kind !== 'chest') continue;
      const key = padKeyForPoi(o.poiClass);
      if (!key) continue;
      padList.push({ o, dx, dy, key });
    }
    this.renderPool(this.decorPool, this.padContainer, padList, (s, item) => {
      const { o, dx, dy, key } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      if (s.texture.key !== key) s.setTexture(key);
      // Pad anchors at the chest's GROUND point (sx, sy) — chest origin is
      // (0.5, 0.9) so the pad should center on (sx, sy - small offset). Use
      // origin (0.5, 0.5) and offset y up by half-cell so 3×3 wraps the chest.
      s.setOrigin(0.5, 0.5).setScale(1).setPosition(Math.round(sx), Math.round(sy - CELL_PX * 0.5));
      const opened = this.save.opened.includes(o.id);
      s.setAlpha(opened ? 0.55 : 0.92);
      s.setTint(0xffffff);
    });

    // POI name labels above chests (named POIs only). Reuse a parallel text pool.
    const chestLabels = filteredObj.filter(({ o }) => o.kind === 'chest' && o.name);
    let li = 0;
    for (const item of chestLabels) {
      const { o, dx, dy } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      let tx = this.chestLabelPool[li];
      if (!tx) {
        tx = this.add.text(0, 0, '', {
          font: '9px monospace', color: '#fff', backgroundColor: '#000a',
          padding: { x: 2, y: 1 },
        }).setOrigin(0.5, 1).setDepth(50);
        this.objectsContainer.add(tx);
        this.chestLabelPool.push(tx);
      }
      tx.setText(rusticifyName(o.name)).setPosition(Math.round(sx), Math.round(sy - 36)).setVisible(true);
      tx.setAlpha(this.save.opened.includes(o.id) ? 0.45 : 1);
      li++;
    }
    for (; li < this.chestLabelPool.length; li++) this.chestLabelPool[li].setVisible(false);

    // Chest tier indicators: small colored diamond above each visible chest.
    // Drawn via cellGfx (shares the viewport mask so it clips correctly).
    const chestObjs = filteredObj.filter(({ o }) => o.kind === 'chest');
    const g = this.cellGfx;
    for (const item of chestObjs) {
      const { o, dx, dy } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      const tier = chestTier(o.poiClass);
      const color = CHEST_TIER_COLOR[tier] || 0xc0c0c0;
      const opened = this.save.opened.includes(o.id);
      const alpha = opened ? 0.35 : 1;
      // Diamond above the chest (between sprite and label), rotated square ~5px half-extent.
      const cx = Math.round(sx);
      const cy = Math.round(sy - 26);
      const r = 5;
      g.lineStyle(1, 0x000000, alpha * 0.8);
      g.fillStyle(color, alpha);
      g.fillTriangle(cx, cy - r, cx + r, cy, cx, cy + r);
      g.fillTriangle(cx, cy - r, cx - r, cy, cx, cy + r);
      // Outline
      g.beginPath();
      g.moveTo(cx, cy - r); g.lineTo(cx + r, cy);
      g.lineTo(cx, cy + r); g.lineTo(cx - r, cy);
      g.closePath();
      g.strokePath();
    }

    this.renderPool(this.plantedPool, this.plantedContainer, plantedList, (s, item) => {
      const { p, dx, dy } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      const stage = Math.min(MAX_GROWTH_STAGE, p.stage ?? 0);
      const ov = CROP_SPRITE[p.crop];
      if (ov && ov.custom) {
        // Single-frame procedural texture (e.g. longgrass).
        if (s.texture.key !== ov.sheet) s.setTexture(ov.sheet);
      } else if (ov && ov.sheet === 'springcrops') {
        // Spring Crops: col 0 = seed (stage 0), cols 1..4 = growth (4 = mature).
        const frame = ov.row * SPRING_CROPS_COLS + stage;
        if (s.texture.key !== 'springcrops') s.setTexture('springcrops');
        s.setFrame(frame);
      } else {
        const row = CROP_ROW[p.crop] ?? 1;
        // In-world growth uses cols 0..5 of the crop's row.
        const frame = row * CROPS_SHEET_COLS + stage;
        if (s.texture.key !== 'crops') s.setTexture('crops');
        s.setFrame(frame);
      }
      // 16x16 frame, scale 2 = 32x32 display, anchored near the bottom of the cell.
      s.setOrigin(0.5, 0.85).setScale(2).setPosition(Math.round(sx), Math.round(sy));
    });

    this.renderPool(this.creaturePool, this.creaturesContainer, creatureList, (s, item) => {
      const { c, dx, dy } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      if (c.kind === 'cow') {
        if (s.texture.key !== 'cow') { s.setTexture('cow'); s.play('cow-idle'); }
        s.setOrigin(0.5, 0.9).setScale(1.1).setPosition(Math.round(sx), Math.round(sy));
        s.setFlipX(!!c._faceFlip);
      } else {
        if (s.texture.key !== 'chicken') { s.setTexture('chicken'); s.play('chicken-idle'); }
        s.setOrigin(0.5, 0.9).setScale(1).setPosition(Math.round(sx), Math.round(sy));
        s.setFlipX(!!c._faceFlip);
      }
    });
  }

  renderPool(pool, container, list, configure) {
    let i = 0;
    for (const item of list) {
      let s = pool[i];
      if (!s) {
        s = this.add.sprite(0, 0, 'idle', 0);
        container.add(s);
        pool.push(s);
      }
      s.setVisible(true);
      configure(s, item);
      i++;
    }
    for (; i < pool.length; i++) pool[i].setVisible(false);
  }

  // === Interaction ===
  handleWorldTap(sx, sy) {
    if (sx < this.viewLeft || sx > this.viewLeft + this.viewSize ||
        sy < this.viewTop  || sy > this.viewTop  + this.viewSize) return;

    const wm = this.screenToWorldMeters(sx, sy);
    const pWorldX = this.startWorldM.x + this.playerM.x;
    // Reach is measured from the character's visible feet, not the sprite center,
    // so the reachable area is symmetric around what the user perceives as "the player".
    const pWorldY = this.startWorldM.y + this.playerM.y + this.feetOffsetM;

    // 0) Treasure mark — tap within ~1.5 cells of the X opens it. Generous since
    // the X straddles the cell containing the treasure, and an exact tap on a
    // small 12 px sprite is hard on mobile. Player must be within REACH_OBJECT_M.
    {
      const found = new Set(this.save.foundTreasures || []);
      const tryClaim = (tr) => {
        if (!tr || found.has(tr.id)) return false;
        if (distM2(tr.x, tr.y, wm.x, wm.y) >= REACH_TREASURE_M * REACH_TREASURE_M) return false;
        if (distM2(tr.x, tr.y, pWorldX, pWorldY) > REACH_FAR_M * REACH_FAR_M) { this.flash('too far', sx, sy); return 'far'; }
        this.save.foundTreasures = [...found, tr.id];
        const t = pickTreasure();
        if (t.kind === 'money') {
          this.save.money = (this.save.money || 0) + t.amount;
          this.flashLoot(`✕ → $${t.amount}`, '#ffd96b');
          if (this.updateMoneyDOM) this.updateMoneyDOM();
        } else {
          this.addToInv(t.id, t.n);
          const tierLbl = SEED_TIER[t.id] === 3 ? 'RARE!' : SEED_TIER[t.id] === 2 ? 'uncommon' : 'common';
          const tierColor = SEED_TIER[t.id] === 3 ? '#ff8aff' : SEED_TIER[t.id] === 2 ? '#7adcff' : '#ffe066';
          this.flashLoot(`✕ → ${t.id.replace(/_seed$/, '')} 🌱 (${tierLbl})`, tierColor);
        }
        persistSave(this.save);
        return true;
      };
      for (const entry of WorldGen.tileCache.values()) {
        const r1 = tryClaim(entry.treasure);
        if (r1 === true || r1 === 'far') return;
        if (entry.parkingTreasures) for (const tr of entry.parkingTreasures) {
          const r = tryClaim(tr);
          if (r === true || r === 'far') return;
        }
      }
    }

    // 1) Catch a creature within 4m
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.creatures) continue;
      for (const c of entry.creatures) {
        if (this.save.caught.includes(c.id)) continue;
        if (distM2(c.x, c.y, wm.x, wm.y) < REACH_CREATURE_M * REACH_CREATURE_M) {
          this.catchCreature(c, sx, sy);
          return;
        }
      }
    }
    // 1a) Pick a wild plant within 4m → +1 produce, 25% bonus seed.
    const pickedSet = new Set(this.save.picked || []);
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.wildplants) continue;
      for (const wp of entry.wildplants) {
        if (pickedSet.has(wp.id)) continue;
        if (distM2(wp.x, wp.y, wm.x, wm.y) < REACH_WILDPLANT_M * REACH_WILDPLANT_M) {
          if (distM2(wp.x, wp.y, pWorldX, pWorldY) > REACH_FAR_M * REACH_FAR_M) { this.flash('too far', sx, sy); return; }
          this.save.picked = [...pickedSet, wp.id];
          this.addToInv(wp.crop, 1); // produce only — debris is just the item itself, no bonus seed
          let bonus = '';
          // Surprise treasure: e.g. picking a rockfruit sometimes also yields a gemfruit.
          const treasure = WILD_TREASURE[wp.crop];
          if (treasure && Math.random() < treasure.chance) {
            this.addToInv(treasure.bonus, 1);
            bonus = ` ✨${treasure.bonus}`;
          }
          persistSave(this.save);
          // Treasure bonus → use the splashier flash; ordinary pickup uses a small flash.
          const cropIcon = ITEM_BY_ID[wp.crop]?.icon || '';
          if (bonus) this.flashLoot(`${cropIcon} ${wp.crop}${bonus}`, '#ff8aff');
          else this.flashLoot(`+1 ${cropIcon} ${wp.crop}`);
          return;
        }
      }
    }
    // 1a') Pick a polygon flower within 4m → +1 flowers.
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.objects) continue;
      for (const o of entry.objects) {
        if (o.kind !== 'flora' || o.deco !== 'flower') continue;
        if (pickedSet.has(o.id)) continue;
        if (distM2(o.x, o.y, wm.x, wm.y) >= REACH_WILDPLANT_M * REACH_WILDPLANT_M) continue;
        if (distM2(o.x, o.y, pWorldX, pWorldY) > REACH_FAR_M * REACH_FAR_M) {
          this.flash('too far', sx, sy); return;
        }
        this.save.picked = [...pickedSet, o.id];
        this.addToInv('flowers', 1);
        persistSave(this.save);
        this.flashLoot(`+1 🌼 flowers`);
        return;
      }
    }

    // 1b) World objects: chest open, tree chop, house flavor
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.objects) continue;
      for (const o of entry.objects) {
        const r = o.kind === 'house' ? REACH_HOUSE_M : REACH_OBJECT_M;
        if (distM2(o.x, o.y, wm.x, wm.y) >= r * r) continue;
        if (distM2(o.x, o.y, pWorldX, pWorldY) > REACH_FAR_M * REACH_FAR_M) {
          this.flash('too far', sx, sy); return;
        }
        if (o.kind === 'chest') {
          if (this.save.opened.includes(o.id)) { this.flash('already looted', sx, sy); return; }
          const loot = pickLoot(undefined, o.poiClass);
          this.addToInv(loot.id, loot.n);
          this.save.opened.push(o.id);
          persistSave(this.save);
          const lootIcon = ITEM_BY_ID[loot.id]?.icon || '?';
          const niceName = rusticifyName(o.name);
          // Tier-coloured loot pop (rare = magenta, uncommon = cyan, common = gold).
          const tier = SEED_TIER[loot.id] || 1;
          const color = tier === 3 ? '#ff8aff' : tier === 2 ? '#7adcff' : '#ffe066';
          const lootLabel = `${CHEST_ICON} → ${lootIcon} ×${loot.n}`;
          this.flashLoot(niceName ? `${lootLabel}\n${niceName}` : lootLabel, color, 1.25);
          return;
        }
        if (o.kind === 'tree') {
          // Spec: tap to interact. Trees are decorative for now — flavor only.
          this.flash('a sturdy maple', sx, sy);
          return;
        }
        if (o.kind === 'house') {
          this.shopInteract(sx, sy);
          return;
        }
      }
    }
    // 2) Cell interactions — tap drives till / plant / water / harvest.
    // Reach is tested against the affected CELL'S CENTER (not the raw tap
    // point) so the outline drawn in drawCells matches exactly: any cell whose
    // centre is within REACH_CELL_M of the feet is actionable, full stop.
    const cell = this.cellAt(wm.x, wm.y);
    if (!cell.loaded) { this.flash('loading…', sx, sy); return; }
    const { cellIX, cellIY } = this.worldMetersToAbsCell(wm.x, wm.y);
    const { x: cwmx, y: cwmy } = this.absCellCenterMeters(cellIX, cellIY);
    if (Math.hypot(cwmx - pWorldX, cwmy - pWorldY) > this.REACH_CELL_M) {
      this.flash('too far', sx, sy); return;
    }
    const cellKey = `${cellIX}_${cellIY}`;

    // 2-pre) If an animal is selected in inventory, releasing it places the creature here.
    // (Works on any cell — animals can walk anywhere, including roads/buildings.)
    {
      const sel = this.save.inv[this.save.selSlot];
      const item = sel ? ITEM_BY_ID[sel.id] : null;
      if (item && item.kind === 'animal' && (sel.count ?? 0) > 0) {
        const id = `released_${item.id}_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
        // Figure out which tile this cell falls in.
        const tx = Math.floor(cwmx / this.tileEdgeM);
        const ty = Math.floor(cwmy / this.tileEdgeM);
        this.save.released = this.save.released || [];
        this.save.released.push({ x: cwmx, y: cwmy, kind: item.id, id, tx, ty });
        // Live-insert into the loaded tile so it shows immediately.
        const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
        if (entry && entry.creatures) entry.creatures.push({ x: cwmx, y: cwmy, kind: item.id, id });
        sel.count -= 1;
        if (sel.count <= 0) {
          this.save.inv.splice(this.save.selSlot, 1);
          if (this.save.selSlot >= this.save.inv.length) {
            this.save.selSlot = Math.max(0, this.save.inv.length - 1);
          }
        }
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flash(`released ${item.icon || ''} ${item.id}`, sx, sy);
        return;
      }
    }

    // 2-placed-rock) Tap a player-placed rockfruit stone → pick it back up
    // (chickens use them as fences; mining them just returns the rockfruit).
    if (this.placedRockSet.has(cellKey)) {
      this.placedRockSet.delete(cellKey);
      this.save.placedRocks = [...this.placedRockSet];
      this.addToInv('rockfruit', 1);
      persistSave(this.save);
      this.flash('⛏ rockfruit', sx, sy);
      return;
    }

    // 2-place-rock) With rockfruit selected, tap an empty tillable cell to drop
    // a stone (blocks chickens, can be mined back later).
    {
      const sel = this.save.inv[this.save.selSlot];
      const selItem = sel ? ITEM_BY_ID[sel.id] : null;
      if (selItem && selItem.id === 'rockfruit' && (sel.count ?? 0) > 0 &&
          isTillable(cell.type) && !this.tilledSet.has(cellKey) &&
          !this.save.planted.some(p => Math.abs(p.x - cwmx) < 0.1 && Math.abs(p.y - cwmy) < 0.1)) {
        this.placedRockSet.add(cellKey);
        this.save.placedRocks = [...this.placedRockSet];
        sel.count -= 1;
        if (sel.count <= 0) {
          this.save.inv.splice(this.save.selSlot, 1);
          if (this.save.selSlot >= this.save.inv.length) {
            this.save.selSlot = Math.max(0, this.save.inv.length - 1);
          }
        }
        persistSave(this.save);
        this.buildInventoryDOM();
        this.flash('🪨 placed', sx, sy);
        return;
      }
    }

    // 2-rock) Tap a natural rock cell → break it (one-shot, persisted). Loot table:
    //   ~45% rockfruit_seed (common, the "floor" reward)
    //     7% $5
    //     2% gemfruit_seed (rare)
    //     1% $25 (rare)
    //   0.5% gemfruit produce (very rare)
    //   ~45% nothing — just rubble
    if (cell.type === 10) {
      if (this.brokenRockSet.has(cellKey)) {
        this.flash('rubble', sx, sy);
        return;
      }
      this.brokenRockSet.add(cellKey);
      this.save.brokenRocks = [...this.brokenRockSet];
      const r = Math.random();
      let msg = '💥 broken';
      if (r < 0.005)        { this.addToInv('gemfruit', 1);        msg = '💥 → ✨ gemfruit'; }
      else if (r < 0.015)   { this.save.money = (this.save.money || 0) + 25; this.updateMoneyDOM?.(); msg = '💥 → $25'; }
      else if (r < 0.035)   { this.addToInv('gemfruit_seed', 1);   msg = '💥 → gemfruit seed'; }
      else if (r < 0.105)   { this.save.money = (this.save.money || 0) + 5;  this.updateMoneyDOM?.(); msg = '💥 → $5'; }
      else if (r < 0.555)   { this.addToInv('rockfruit_seed', 1);  msg = '💥 → rockfruit seed'; }
      // else: nothing
      persistSave(this.save);
      this.flash(msg, sx, sy);
      return;
    }

    // 2a) Tap on a planted crop → harvest if mature, else advance (if 1h elapsed), else water.
    const plantedIdx = this.save.planted.findIndex(p =>
      Math.abs(p.x - cwmx) < 0.1 && Math.abs(p.y - cwmy) < 0.1);
    if (plantedIdx >= 0) {
      const p = this.save.planted[plantedIdx];
      const stageHoldMs = 60 * 60 * 1000; // 1h between watering and stage advance
      const sinceWater = p.watered_t ? Date.now() - p.watered_t : Infinity;
      if (p.watered_t && sinceWater >= stageHoldMs && (p.stage ?? 0) < MAX_GROWTH_STAGE) {
        p.stage = (p.stage ?? 0) + 1;
        p.watered_t = 0;
        persistSave(this.save);
      }
      if ((p.stage ?? 0) >= MAX_GROWTH_STAGE) {
        this.save.planted.splice(plantedIdx, 1);
        this.tilledSet.delete(cellKey);
        this.save.tilled = [...this.tilledSet];
        let yieldN = 1 + Math.floor(Math.random() * 3);
        this.addToInv(p.crop, yieldN);
        const gotSeed = Math.random() < 0.25;
        if (gotSeed) this.addToInv(`${p.crop}_seed`, 1);
        persistSave(this.save);
        const cropIcon = ITEM_BY_ID[p.crop]?.icon || '';
        this.flashLoot(`🌾 ${cropIcon} ${p.crop} ×${yieldN}${gotSeed ? ' +seed' : ''}`, '#a7ffb0');
        return;
      }
      if (!p.watered_t) {
        p.watered_t = Date.now();
        persistSave(this.save);
        this.flash('💧 watered', sx, sy);
        return;
      }
      const minsLeft = Math.max(1, Math.ceil((stageHoldMs - sinceWater) / 60000));
      this.flash(`growing… ${minsLeft}m`, sx, sy);
      return;
    }

    // 2b) Tap non-tillable terrain → flavor.
    if (!isTillable(cell.type)) {
      const t = cell.type;
      const flavor = t === 3  ? 'water'
                   : (t === 9 || t === 11 || t === 12) ? 'building'
                   : t === 13 ? 'highway'
                   : t === 14 ? 'avenue'
                   : t === 7  ? 'road'
                   : t === 8  ? 'path'
                   : '·';
      this.flash(flavor, sx, sy);
      return;
    }

    // 2c) Tap tilled empty cell:
    //   - with a seed selected → plant
    //   - with nothing / non-seed selected → un-till (revert to underlying terrain)
    if (this.tilledSet.has(cellKey)) {
      const sel = this.save.inv[this.save.selSlot];
      const item = sel ? ITEM_BY_ID[sel.id] : null;
      if (!item || item.kind !== 'seed') {
        this.tilledSet.delete(cellKey);
        this.save.tilled = [...this.tilledSet];
        persistSave(this.save);
        this.flash('un-tilled', sx, sy);
        return;
      }
      if ((sel.count ?? 0) <= 0) {
        this.flash('out of seeds', sx, sy);
        return;
      }
      this.save.planted.push({ x: cwmx, y: cwmy, crop: item.grows, stage: 0, watered_t: 0 });
      sel.count -= 1;
      if (sel.count <= 0) {
        this.save.inv.splice(this.save.selSlot, 1);
        if (this.save.selSlot >= this.save.inv.length) {
          this.save.selSlot = Math.max(0, this.save.inv.length - 1);
        }
      }
      persistSave(this.save);
      this.buildInventoryDOM();
      this.flash(`planted ${item.grows}`, sx, sy);
      return;
    }

    // 2d) Tap untilled tillable cell → till it.
    // Refuse to till when the cell is occupied by ANY interactable so we never silently
    // wipe under the player's intent (e.g. they tapped near a debris but just missed pickup).
    const cellHalfM = this.cellM / 2;
    const pickedAll = new Set(this.save.picked || []);
    const occupied =
      this.placedRockSet.has(cellKey) ||
      this.save.planted.some(p => Math.abs(p.x - cwmx) < cellHalfM && Math.abs(p.y - cwmy) < cellHalfM) ||
      [...WorldGen.tileCache.values()].some(e =>
        (e.wildplants || []).some(wp => !pickedAll.has(wp.id) && Math.abs(wp.x - cwmx) < cellHalfM && Math.abs(wp.y - cwmy) < cellHalfM) ||
        // Decorative flora (flowers/pebbles/mushrooms) is non-blocking — flowers
        // get picked into inventory before tilling would even fire.
        (e.objects || []).some(o => o.kind !== 'flora' && Math.abs(o.x - cwmx) < cellHalfM && Math.abs(o.y - cwmy) < cellHalfM)
      );
    if (occupied) { this.flash('occupied', sx, sy); return; }
    this.tilledSet.add(cellKey);
    this.save.tilled = [...this.tilledSet];
    persistSave(this.save);
    this.flash('tilled', sx, sy);
  }
  cellAt(wmx, wmy) {
    const wx = this.originPx.x + (wmx - this.startWorldM.x) / this.mPerPx;
    const wy = this.originPx.y + (wmy - this.startWorldM.y) / this.mPerPx;
    const tx = Math.floor(wx / 256), ty = Math.floor(wy / 256);
    const ix = Math.floor((wx - tx * 256) / (256 / this.cellsPerTile));
    const iy = Math.floor((wy - ty * 256) / (256 / this.cellsPerTile));
    const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
    const loaded = !!(entry && entry.grid);
    return { tx, ty, ix, iy, loaded, type: loaded ? entry.grid[iy * this.cellsPerTile + ix] : 0 };
  }
  catchCreature(c, sx, sy) {
    this.save.caught.push(c.id);   // keep so the creature doesn't respawn
    // Per-creature catch yield. Chickens yield 4 (eggs + bird); cows yield 1.
    const yieldN = c.kind === 'chicken' ? 4 : 1;
    this.addToInv(c.kind, yieldN); // stack into inventory (icon comes from ITEMS)
    persistSave(this.save);
    const item = ITEM_BY_ID[c.kind];
    this.flashLoot(`+${yieldN} ${item?.icon || ''} ${c.kind}`, '#a7ffb0');
  }

  flash(text, x, y) {
    const t = this.add.text(x, y, text, {
      font: '12px monospace', color: '#ffffff', backgroundColor: '#000a',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1).setDepth(100);
    this.tweens.add({
      targets: t, y: y - 30, alpha: 0, duration: 900,
      onComplete: () => t.destroy(),
    });
  }

  // Bigger, longer-dwelling pop for loot pickups (chest opens, treasure X, harvest, debris).
  // Brief scale-up then a slow drift + fade. Always rendered at the player's viewport center
  // so the eye doesn't have to chase it back to where the X used to be.
  // dwellMul scales the hold + fade portion (chest opens use 1.25 for a longer read).
  flashLoot(text, color = '#ffe066', dwellMul = 1) {
    const x = this.viewCenterX, y = this.viewCenterY - 40;
    const t = this.add.text(x, y, text, {
      font: 'bold 22px monospace', color, backgroundColor: '#000c',
      stroke: '#000', strokeThickness: 3,
      padding: { x: 10, y: 5 },
    }).setOrigin(0.5, 1).setDepth(101).setScale(0.6).setAlpha(0);
    // Pop in (140ms), hold (1.44s * dwellMul), drift up + fade (700ms * dwellMul).
    this.tweens.add({ targets: t, scale: 1.0, alpha: 1, duration: 140, ease: 'Back.Out' });
    this.tweens.add({ targets: t, y: y - 50, alpha: 0,
      duration: Math.round(700 * dwellMul), delay: Math.round(1440 * dwellMul),
      ease: 'Sine.In', onComplete: () => t.destroy() });
  }

  updateHUD() {
    const pc = this.playerToWorldCell();
    const lat = START_LAT + (-this.playerM.y) / 111320;
    const lon = START_LON + this.playerM.x / (111320 * Math.cos(START_LAT * Math.PI / 180));
    const loaded = [...WorldGen.tileCache.values()].filter(t => t.status === 'ready').length;
    const gps = this.gpsAvailable ? (this.gpsM ? 'live' : 'waiting') : 'wasd';
    this.hud.textContent =
      `${lat.toFixed(5)}, ${lon.toFixed(5)}   gps:${gps}\n` +
      `tile ${pc.tx}/${pc.ty}   tiles:${loaded}   caught:${this.save.caught.length}   plots:${this.save.planted.length}`;
    if (this.moneyEl) this.moneyEl.textContent = `$${this.save.money ?? 0}`;
  }

  shopInteract(sx, sy) {
    const sel = this.save.inv[this.save.selSlot];
    if (sel && sel.id) {
      // SELL one of the selected stack — unchanged, no confirmation.
      const price = PRICES[sel.id] ?? 1;
      const item = ITEM_BY_ID[sel.id];
      sel.count = (sel.count ?? 1) - 1;
      this.save.money = (this.save.money ?? 0) + price;
      if (sel.count <= 0) {
        this.save.inv.splice(this.save.selSlot, 1);
        if (this.save.selSlot >= this.save.inv.length) {
          this.save.selSlot = Math.max(0, this.save.inv.length - 1);
        }
      }
      persistSave(this.save);
      this.buildInventoryDOM();
      this.flash(`sold ${item?.icon || ''} +$${price}`, sx, sy);
      return;
    }
    // BUY — empty slot: generate an offer and present a confirmation modal.
    // Item on offer = next seed in the rotation. Cost can be money (1/3) or barter (2/3).
    const id = BUY_LIST[(this.save.buyIndex ?? 0) % BUY_LIST.length];
    const baseValue = PRICES[id] ?? 1;
    const item = ITEM_BY_ID[id];
    const offer = this.buildShopOffer(id, baseValue);
    if (!offer) {
      this.flash('no deal', sx, sy);
      return;
    }
    this.showOfferModal({
      title: 'A trader offers:',
      get: `${item?.icon || ''} ${item?.name || id} ×1`,
      cost: offer.label,
      canAfford: offer.canAfford(),
      onAccept: () => {
        if (!offer.canAfford()) { this.flash(offer.shortDenial, sx, sy); return; }
        offer.consume();
        this.addToInv(id, 1);
        this.save.buyIndex = (this.save.buyIndex ?? 0) + 1;
        persistSave(this.save);
        this.buildInventoryDOM();
        if (this.updateMoneyDOM) this.updateMoneyDOM();
        // Use the loud loot pop so a purchase reads as a real gain.
        this.flashLoot(`🪙 ${item?.icon || ''} ${item?.name || id}\n${offer.shortGain}`, '#ffe066');
      },
    });
  }

  // Build a shop offer for buying ${id} (baseValue = PRICES[id]).
  // 1/3 chance: trader wants 2x value in cash. 2/3: barter for an inventory item worth >= 1.5x value.
  // If no qualifying barter exists, falls back to the cash offer.
  buildShopOffer(id, baseValue) {
    const wantMoney = Math.random() < 1/3;
    const cashCost = Math.max(1, Math.ceil(baseValue * 2));
    const cashOffer = {
      kind: 'money',
      label: `$${cashCost}`,
      shortGain: `−$${cashCost}`,
      shortDenial: `need $${cashCost}`,
      canAfford: () => (this.save.money ?? 0) >= cashCost,
      consume: () => { this.save.money = (this.save.money ?? 0) - cashCost; },
    };
    if (wantMoney) return cashOffer;
    // Barter — find a held stack worth ≥ 1.5 × baseValue, pick one at random.
    const need = baseValue * 1.5;
    const candidates = (this.save.inv || []).filter(s => s && s.id && (s.count ?? 0) >= 1 && (PRICES[s.id] ?? 0) >= need);
    if (!candidates.length) return cashOffer;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const pickItem = ITEM_BY_ID[pick.id];
    return {
      kind: 'item',
      label: `1× ${pickItem?.icon || ''} ${pickItem?.name || pick.id}`,
      shortGain: `−1 ${pickItem?.icon || ''}`,
      shortDenial: `no ${pickItem?.name || pick.id}`,
      canAfford: () => {
        const cur = (this.save.inv || []).find(s => s && s.id === pick.id);
        return !!cur && (cur.count ?? 0) >= 1;
      },
      consume: () => {
        const idx = this.save.inv.findIndex(s => s && s.id === pick.id);
        if (idx < 0) return;
        const cur = this.save.inv[idx];
        cur.count -= 1;
        if (cur.count <= 0) {
          this.save.inv.splice(idx, 1);
          if (this.save.selSlot >= this.save.inv.length) {
            this.save.selSlot = Math.max(0, this.save.inv.length - 1);
          }
        }
      },
    };
  }

  // Simple yes/no DOM modal. Dismissible. Renders over #game so it scales with the viewport.
  showOfferModal({ title, get, cost, canAfford, onAccept }) {
    // Remove any existing modal first (only one at a time).
    document.getElementById('offer-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'offer-modal';
    wrap.style.cssText =
      'position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
      'background:#0008;pointer-events:auto;';
    const box = document.createElement('div');
    box.style.cssText =
      'min-width:230px;max-width:320px;background:#1a1612;color:#fff;border:2px solid #c8a64a;' +
      'border-radius:10px;padding:14px 16px;font:13px ui-monospace,monospace;text-align:center;';
    box.innerHTML =
      `<div style="opacity:.75;font-size:11px;margin-bottom:6px">${title}</div>` +
      `<div style="font-size:18px;font-weight:700;margin:4px 0;color:#ffe066">${get}</div>` +
      `<div style="opacity:.85;margin:8px 0 4px">for</div>` +
      `<div style="font-size:16px;font-weight:700;margin:4px 0 12px;color:${canAfford ? '#a7ffb0' : '#ff8a7a'}">${cost}</div>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:4px;';
    const mkBtn = (label, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        `padding:8px 14px;border-radius:6px;font:700 13px ui-monospace,monospace;cursor:pointer;` +
        (primary
          ? 'background:#c8a64a;color:#1a1612;border:0;'
          : 'background:transparent;color:#ddd;border:2px solid #444;');
      if (primary && !canAfford) { b.disabled = true; b.style.opacity = '0.4'; b.style.cursor = 'not-allowed'; }
      return b;
    };
    const yes = mkBtn('Buy', true);
    const no = mkBtn('Cancel', false);
    yes.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); onAccept(); });
    no.addEventListener('click', (e) => { e.stopPropagation(); wrap.remove(); });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    row.appendChild(no); row.appendChild(yes);
    box.appendChild(row);
    wrap.appendChild(box);
    (document.getElementById('game') || document.body).appendChild(wrap);
  }

  addToInv(id, n = 1, silent = false) {
    const item = ITEM_BY_ID[id];
    if (!item) return;
    const existing = this.save.inv.find(s => s && s.id === id);
    if (existing) existing.count = (existing.count || 0) + n;
    else this.save.inv.push({ id, count: n });
    if (!silent) {
      persistSave(this.save);
      this.buildInventoryDOM();
    }
  }
  buildInventoryDOM() {
    const PAGE = 5;
    const game = document.getElementById('game');
    let bar = document.getElementById('inv');
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.id = 'inv';
    bar.style.cssText = 'position:absolute;bottom:48px;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:3px;padding:6px;z-index:6;pointer-events:auto;';
    if (this.save.selSlot == null || this.save.selSlot < 0) this.save.selSlot = 0;
    if (this.save.invPage == null) this.save.invPage = 0;
    const pageCount = Math.max(1, Math.ceil(this.save.inv.length / PAGE));
    if (this.save.invPage >= pageCount) this.save.invPage = pageCount - 1;

    const makeBtn = (txt, onclick, w = 28) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = `width:${w}px;height:42px;background:#222a;border:2px solid #555;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;`;
      b.addEventListener('click', (e) => { e.stopPropagation(); onclick(); });
      return b;
    };
    bar.appendChild(makeBtn('◀', () => {
      this.save.invPage = (this.save.invPage - 1 + pageCount) % pageCount;
      persistSave(this.save); this.buildInventoryDOM();
    }));

    const startIdx = this.save.invPage * PAGE;
    for (let s = 0; s < PAGE; s++) {
      const i = startIdx + s;
      const entry = this.save.inv[i];
      const item = entry ? ITEM_BY_ID[entry.id] : null;
      const slot = document.createElement('button');
      slot.dataset.slot = i;
      slot.style.cssText = 'position:relative;width:42px;height:42px;flex:0 0 42px;background:#222a;border:2px solid #555;border-radius:6px;font-size:22px;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;';
      slot.title = item ? `${item.name}${entry.count != null ? ' ×' + entry.count : ''}` : 'empty';
      // Inventory icon. Crops listed in CROP_SPRITE come from Spring Crops.png
      // (col 0 = seed, col 8 = produce, per-crop row). Everything else falls back
      // to Crops.png: seeds use the generic seedbag (col 8 row 15), produce uses
      // per-crop col 7 row = CROP_ROW[crop].
      const cropKey = item && (item.grows || item.crop);
      const cropRow = cropKey != null ? CROP_ROW[cropKey] : null;
      const ov = cropKey != null ? CROP_SPRITE[cropKey] : null;
      let iconUrl = "Objects/Crops.png", iconBgSize = "288px 512px";
      let iconCol = null, iconRow = null;
      if (item && ov && ov.sheet === 'springcrops') {
        iconUrl = "Objects/Spring Crops.png";
        iconBgSize = "448px 256px";  // 224×128 displayed 2x
        iconRow = ov.row;
        // Inventory seedbag = col 7 (closed brown bag w/ crop label). Col 0 is
        // the tiny in-world seed sprite (used for stage 0 in the world, not in UI).
        if (item.kind === 'seed')         iconCol = 7;
        else if (item.kind === 'produce') iconCol = 8;
      } else if (item && item.kind === 'seed')                            { iconCol = 8; iconRow = 15; }
      else if (item && item.kind === 'produce' && cropRow != null)        { iconCol = PRODUCE_COL; iconRow = cropRow; }
      if (iconCol != null) {
        const icon = document.createElement('span');
        icon.style.cssText =
          "width:32px;height:32px;display:inline-block;" +
          `background-image:url('${iconUrl}');` +
          `background-size:${iconBgSize};` +
          `background-position:-${iconCol * 32}px -${iconRow * 32}px;` +
          "image-rendering:pixelated;";
        slot.appendChild(icon);
      } else {
        slot.textContent = item ? item.icon : '·';
      }
      if (entry && entry.count != null) {
        const badge = document.createElement('span');
        badge.textContent = entry.count;
        badge.style.cssText = 'position:absolute;bottom:1px;right:2px;font-size:10px;background:#000c;padding:0 3px;border-radius:3px;line-height:12px;';
        slot.appendChild(badge);
      }
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.save.selSlot = i;
        persistSave(this.save);
        this.refreshInventoryHighlight();
      });
      bar.appendChild(slot);
    }
    bar.appendChild(makeBtn('▶', () => {
      this.save.invPage = (this.save.invPage + 1) % pageCount;
      persistSave(this.save); this.buildInventoryDOM();
    }));
    const pageLbl = document.createElement('span');
    pageLbl.textContent = `${this.save.invPage + 1}/${pageCount}`;
    pageLbl.style.cssText = 'color:#fff8;font:10px ui-monospace,monospace;margin-left:4px;';
    bar.appendChild(pageLbl);

    game.appendChild(bar);
    this.refreshInventoryHighlight();
  }
  refreshInventoryHighlight() {
    const bar = document.getElementById('inv');
    if (!bar) return;
    const PAGE = 5;
    const startIdx = this.save.invPage * PAGE;
    [...bar.querySelectorAll('button[data-slot]')].forEach(el => {
      const i = +el.dataset.slot;
      const isSel = i === this.save.selSlot;
      el.style.borderColor = isSel ? '#ffd866' : '#555';
      el.style.background  = isSel ? '#553a' : '#222a';
    });
  }
}

const game = window.__game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W, height: H,
  backgroundColor: '#000',
  pixelArt: true,
  scene: [MapScene],
  scale: { mode: Phaser.Scale.NONE },
});
