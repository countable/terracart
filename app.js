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
};
// Tillable = soil-ish ground. Water, roads (any tier), paths, and any building tier are not.
const NON_TILLABLE = new Set([3, 7, 8, 9, 11, 12, 13, 14]);
function isTillable(type) { return !NON_TILLABLE.has(type); }

// Terrain classes that get no sprite from TileMap — we overlay a procedural
// biome-suited texture so they don't read as flat color slabs. (Road is excluded
// since cobblestones already break up its surface.) Keys: 'biome${type}_${v}'.
const BIOME_TEX = {
  0:  { variants: 2, draw: drawGrassTex },        // grass: tufts
  1:  { variants: 2, draw: drawForestTex },       // forest: dense leaf litter
  2:  { variants: 2, draw: drawSandTex },         // sand: fine grain
  3:  { variants: 2, draw: drawWaterTex },        // water: ripples
  4:  { variants: 1, draw: drawFarmlandTex },     // farmland: tidy furrows
  5:  { variants: 1, draw: drawResidentialTex },  // residential: concrete
  6:  { variants: 2, draw: drawParkTex },         // park: grass + flowers
  8:  { variants: 2, draw: drawPathTex },         // path: pebble grain (sparse cobble sprite layered on top)
  9:  { variants: 1, draw: drawBuildingTex },     // building: cobbles
  10: { variants: 2, draw: drawRockTex },         // rock: cracks
};

// Tilled soil is per-cell state (not a terrain class). Painted as a yellow-brown
// base color with a procedural furrow texture, replacing the previous SAND sprite.
const TILLED_COLOR = 0xc7973f;        // warm yellow-brown
const TILLED_VARIANTS = 2;

// Tiny deterministic RNG factory so each texture variant looks stable across reloads.
function seededRand(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function drawGrassTex(ctx, size, rng) {
  // Short blade strokes — mix of darker and lighter green on transparent.
  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = 1;
  for (let i = 0; i < 28; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const len = 1 + Math.floor(rng() * 2);
    ctx.fillStyle = rng() < 0.55
      ? 'rgba(20,55,20,0.30)'
      : 'rgba(180,230,140,0.22)';
    ctx.fillRect(x, y, 1, len);
  }
}

function drawForestTex(ctx, size, rng) {
  // Dense leaf-litter clumps — small dark blobs + a few bright leaf specks.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 14; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 1.5 + rng() * 1.5;
    ctx.fillStyle = 'rgba(0,30,0,0.35)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = 'rgba(160,210,130,0.25)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
}

function drawSandTex(ctx, size, rng) {
  // Very fine grain — many low-alpha dots, mostly warm.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 36; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.6
      ? 'rgba(120,90,40,0.18)'
      : 'rgba(255,240,200,0.18)';
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawFarmlandTex(ctx, size, rng) {
  // Tidy parallel furrow rows — horizontal alternating shade bands.
  ctx.clearRect(0, 0, size, size);
  const rowH = 4;
  for (let y = 0; y < size; y += rowH) {
    ctx.fillStyle = 'rgba(60,35,10,0.22)';
    ctx.fillRect(0, y, size, 1);
    ctx.fillStyle = 'rgba(255,230,180,0.10)';
    ctx.fillRect(0, y + 1, size, 1);
  }
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
}

function drawParkTex(ctx, size, rng) {
  // Park = grass + occasional tiny flower.
  drawGrassTex(ctx, size, rng);
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const colors = ['rgba(255,180,200,0.7)', 'rgba(255,240,120,0.7)', 'rgba(220,180,255,0.7)'];
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawTilledTex(ctx, size, rng) {
  // Yellow-brown ploughed soil — clear horizontal furrows + grain.
  ctx.clearRect(0, 0, size, size);
  const rowH = 5;
  for (let y = 1; y < size; y += rowH) {
    // furrow shadow
    ctx.fillStyle = 'rgba(70,40,10,0.45)';
    ctx.fillRect(0, y, size, 1);
    // furrow highlight just below
    ctx.fillStyle = 'rgba(255,225,160,0.20)';
    ctx.fillRect(0, y + 1, size, 1);
  }
  // clods of soil
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.5
      ? 'rgba(70,45,15,0.35)'
      : 'rgba(255,220,150,0.22)';
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawWaterTex(ctx, size, rng) {
  // Faint horizontal ripple highlights on transparent bg.
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const baseY = (r + 0.5) * (size / rows) + (rng() - 0.5) * 2;
    const amp = 0.8 + rng() * 0.6;
    const phase = rng() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x <= size; x++) {
      const y = baseY + Math.sin((x / size) * Math.PI * 2 + phase) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // a few darker dots for depth
  ctx.fillStyle = 'rgba(0,0,40,0.18)';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
}

function drawResidentialTex(ctx, size, rng) {
  // Concrete — subtle, infrequent aggregate flecks on transparent bg.
  ctx.clearRect(0, 0, size, size);
  // Sparse fine grain across the whole cell.
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    ctx.fillStyle = rng() < 0.5
      ? 'rgba(0,0,0,0.18)'
      : 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, 1, 1);
  }
  // A couple of tiny embedded stones (2px chips).
  for (let i = 0; i < 3; i++) {
    const x = 2 + Math.floor(rng() * (size - 4));
    const y = 2 + Math.floor(rng() * (size - 4));
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawPathTex(ctx, size, rng) {
  // Scattered pebbles — small darker and lighter dots.
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const dark = rng() < 0.6;
    ctx.fillStyle = dark ? 'rgba(40,25,10,0.4)' : 'rgba(255,240,210,0.25)';
    const w = rng() < 0.3 ? 2 : 1;
    ctx.fillRect(x, y, w, w);
  }
}

function drawBuildingTex(ctx, size, rng) {
  // Small rounded cobbles packed across the cell.
  ctx.clearRect(0, 0, size, size);
  // Rough staggered grid of cobble centers with jitter so they read as packed stones.
  const step = 6;
  for (let row = 0; row * step < size + step; row++) {
    const offset = (row % 2) * (step / 2);
    for (let col = 0; col * step < size + step; col++) {
      const cx = col * step + offset + (rng() - 0.5) * 1.5;
      const cy = row * step + step / 2 + (rng() - 0.5) * 1.5;
      const r = 2 + rng() * 0.6;
      // dark outline
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      // light highlight on upper-left
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(cx - 0.6, cy - 0.6, r - 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawRockTex(ctx, size, rng) {
  // A few jagged dark cracks plus a couple highlights.
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  const cracks = 2 + Math.floor(rng() * 2);
  for (let c = 0; c < cracks; c++) {
    let x = rng() * size;
    let y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < segs; i++) {
      x += (rng() - 0.5) * (size / 2);
      y += (rng() - 0.5) * (size / 2);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 2, 1);
  }
}

function makeBiomeTextures(scene, size) {
  for (const [type, spec] of Object.entries(BIOME_TEX)) {
    for (let v = 0; v < spec.variants; v++) {
      const key = `biome${type}_${v}`;
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.createCanvas(key, size, size);
      const ctx = tex.getContext();
      spec.draw(ctx, size, seededRand((Number(type) + 1) * 1000 + v + 1));
      tex.refresh();
    }
  }
  for (let v = 0; v < TILLED_VARIANTS; v++) {
    const key = `tilled_${v}`;
    if (scene.textures.exists(key)) continue;
    const tex = scene.textures.createCanvas(key, size, size);
    drawTilledTex(tex.getContext(), size, seededRand(7919 + v));
    tex.refresh();
  }
}

// Chests pick a tier (weighted), then a random seed within that tier. Yield depends on tier.
const CHEST_ICON = '📦';
const SEED_TIER = {
  rainberry_seed: 1, pairy_seed: 1, nut_seed: 1, turnip_seed: 1, shrub_seed: 1,
  gemfruit_seed: 2, rockfruit_seed: 2, coffee_seed: 2, tree_seed: 2,
  iceflower_seed: 3, fireflower_seed: 3, sunflower_seed: 3,
};
const TIER_YIELD = { 1: 10, 2: 5, 3: 2 };
// POI class → category, drives chest loot type (produce vs seed) and tier weights.
const POI_CATEGORY = {
  // food: drops PRODUCE (harvested crops) instead of seeds
  restaurant: 'food', cafe: 'food', fast_food: 'food', grocery: 'food',
  butcher: 'food', ice_cream: 'food', bakery: 'food',
  // commerce: common-weighted seed drops
  alcohol_shop: 'commerce', beer: 'commerce', shop: 'commerce',
  // civic/educational: rare-weighted seed drops
  school: 'civic', college: 'civic', library: 'civic',
  town_hall: 'civic', place_of_worship: 'civic',
  attraction: 'civic', museum: 'civic',
  // healthcare: mid-weighted seed drops
  pharmacy: 'health', hospital: 'health', dentist: 'health',
  // parks: T2-leaning seed drops
  park: 'park', garden: 'park', playground: 'park', pitch: 'park',
};
const CATEGORY_LOOT = {
  food:     { drops: 'produce', weights: [[1, 0.60], [2, 0.30], [3, 0.10]] },
  commerce: { drops: 'seed',    weights: [[1, 0.70], [2, 0.25], [3, 0.05]] },
  civic:    { drops: 'seed',    weights: [[1, 0.30], [2, 0.40], [3, 0.30]] },
  health:   { drops: 'seed',    weights: [[1, 0.50], [2, 0.30], [3, 0.20]] },
  park:     { drops: 'seed',    weights: [[1, 0.40], [2, 0.40], [3, 0.20]] },
};
const DEFAULT_LOOT = { drops: 'seed', weights: [[1, 0.60], [2, 0.30], [3, 0.10]] };

function pickLoot(rng, poiClass) {
  const cat = POI_CATEGORY[poiClass];
  const cfg = (cat && CATEGORY_LOOT[cat]) || DEFAULT_LOOT;
  const r = (rng ?? Math.random)();
  let tier = 1, acc = 0;
  for (const [t, w] of cfg.weights) { acc += w; if (r <= acc) { tier = t; break; } }
  const seedsInTier = Object.keys(SEED_TIER).filter(s => SEED_TIER[s] === tier);
  const seedId = seedsInTier[Math.floor((rng ?? Math.random)() * seedsInTier.length)];
  const id = cfg.drops === 'produce' ? seedId.replace(/_seed$/, '') : seedId;
  return { id, n: TIER_YIELD[tier] };
}

// Wild plants grow in specific biomes (no tilling needed). Terrain class → spawn config.
//   0=grass, 1=forest, 2=sand, 6=park, 10=rock
const WILD_BIOME = {
  1:  { crop: 'shrub',      min: 3, max: 6 },  // forest — common
  6:  { crop: 'turnip',     min: 4, max: 8 },  // park   — common
  0:  { crop: 'sunflower',  min: 0, max: 2 },  // grass  — rare
  2:  { crop: 'fireflower', min: 0, max: 2 },  // sand   — rare
  10: { crop: 'iceflower',  min: 0, max: 2 },  // rock   — rare
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
  turnip: 6, iceflower: 7, fireflower: 8, sunflower: 9, tree: 10, shrub: 11,
};
const MAX_GROWTH_STAGE = 4; // cols 0..4 inclusive: 5 stages, 4 waterings to mature
const PRODUCE_COL = 7;
const SEEDBOX_COL = 8;
const CROPS_SHEET_COLS = 9; // Crops.png is 9 cols wide

// Build ITEMS from CROP_ROW so seed/produce stay in sync with the crop list.
const CROP_NAMES = {
  rainberry: 'Rainberry', pairy: 'Pairy', gemfruit: 'Gemfruit', nut: 'Nut',
  rockfruit: 'Rockfruit', coffee: 'Coffee', turnip: 'Turnip', iceflower: 'Iceflower',
  fireflower: 'Fireflower', sunflower: 'Sunflower', tree: 'Tree', shrub: 'Shrub',
};
const ITEMS = [
  ...Object.keys(CROP_ROW).map(c => ({
    id: `${c}_seed`, name: `${CROP_NAMES[c]} Seed`, kind: 'seed', grows: c, icon: '🌱',
  })),
  ...Object.keys(CROP_ROW).map(c => ({
    id: c, name: CROP_NAMES[c], kind: 'produce', crop: c, icon: '🌾',
  })),
];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
// Chests drop only seeds.
const LOOTABLE_IDS = ITEMS.filter(i => i.kind === 'seed').map(i => i.id);
// Shop: tap a house with a selected item to sell it, or with an empty selection
// to buy the next seed in BUY_LIST.
const PRICES = {};
for (const c of Object.keys(CROP_ROW)) {
  PRICES[`${c}_seed`] = 5;
  PRICES[c] = 12;
}
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
    });
    this.load.spritesheet('cobble',  'Objects/Road copiar.png',      { frameWidth: 16, frameHeight: 16 });
    if (window.TileMap) {
      this.load.spritesheet(TileMap.KEY, TileMap.PATH, { frameWidth: TileMap.FRAME_W, frameHeight: TileMap.FRAME_H });
    }
  }

  create() {
    this.save = Object.assign(
      {
        caught: [], planted: [], opened: [], tilled: [], picked: [],
        money: STARTING_MONEY, buyIndex: 0,
        // inv is array of {id, count} — seeds-only per spec; planting decrements count.
        inv: [
          { id: 'rainberry_seed', count: 10 },
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
    this.startWorldM = {
      x: this.originPx.x * this.mPerPx,
      y: this.originPx.y * this.mPerPx,
    };

    this.playerM = { x: 0, y: 0 };
    this.facing = { x: 0, y: 1 }; // unit-ish vector; updated by movement
    this._ease = null;            // {fromX, fromY, toX, toY, t0, dur} for GPS easing
    this.gpsM = null;
    this.gpsLocked = false;
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

    // Layers
    this.cellGfx = this.add.graphics();
    this.noiseContainer = this.add.container(0, 0);
    this.terrainContainer = this.add.container(0, 0);
    this.cobbleContainer = this.add.container(0, 0);
    this.plantedContainer = this.add.container(0, 0);
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

    this.objectPool = [];
    this.plantedPool = [];
    this.creaturePool = [];

    // Viewport mask clips everything inside the 11x11 area.
    const maskG = this.make.graphics({ x: 0, y: 0, add: false });
    maskG.fillStyle(0xffffff);
    maskG.fillRect(this.viewLeft, this.viewTop, this.viewSize, this.viewSize);
    const mask = maskG.createGeometryMask();
    this.cellGfx.setMask(mask);
    this.noiseContainer.setMask(mask);
    this.terrainContainer.setMask(mask);
    this.cobbleContainer.setMask(mask);
    this.plantedContainer.setMask(mask);
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
    this.player = this.add.sprite(this.viewCenterX, this.viewCenterY, 'idle', 0)
      .setScale(1.5)
      .play('idle-anim')
      .setMask(mask)
      .setInteractive({ useHandCursor: true });
    this.player.on('pointerdown', (pointer, lx, ly, event) => {
      event.stopPropagation();
      this.toggleGpsLock();
    });
    // Facing direction indicator: small dot offset from the player in the
    // direction of last movement (WASD or GPS easing). Sits above the player.
    this.facingGfx = this.add.graphics().setDepth(11).setMask(mask);

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

    // GPS watch (best-effort)
    this.startGps();
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
          if (!this.gpsLocked) {
            // Ease toward the new GPS fix instead of snapping; also update facing.
            this._ease = {
              fromX: this.playerM.x, fromY: this.playerM.y,
              toX: this.gpsM.x, toY: this.gpsM.y,
              t0: performance.now(), dur: 300,
            };
            if (prev) {
              const ddx = this.gpsM.x - prev.x, ddy = this.gpsM.y - prev.y;
              if (ddx || ddy) this.facing = { x: ddx, y: ddy };
            }
          }
        },
        err => { console.warn('GPS error', err.message); this.gpsAvailable = false; },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    } catch { this.gpsAvailable = false; }
  }
  toggleGpsLock() {
    this.gpsLocked = !this.gpsLocked;
    if (!this.gpsLocked && this.gpsM) {
      this._ease = {
        fromX: this.playerM.x, fromY: this.playerM.y,
        toX: this.gpsM.x, toY: this.gpsM.y,
        t0: performance.now(), dur: 300,
      };
    }
    this.player.setTint(this.gpsLocked ? 0xffe080 : 0xffffff);
    this.flash(this.gpsLocked ? 'GPS locked' : 'GPS unlocked', this.viewCenterX, this.viewCenterY - 30);
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
    const chickenN = 4 + Math.floor(rng() * 6);
    for (let i = 0; i < chickenN; i++) tryPlace('chicken', new Set([0, 4, 6]), i, 'chicken');
    const cowN = Math.floor(rng() * 3);   // 0..2 cows, only in farmland
    for (let i = 0; i < cowN; i++) tryPlace('cow', new Set([4]), i, 'cow');
    entry.creatures = creatures;

    // Wild plants — biome-specific, seeded per tile. Skip ones already picked.
    const wildplants = [];
    const picked = new Set(this.save.picked || []);
    const placeWild = (crop, classOK, idx) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const cx = Math.floor(rng() * N);
        const cy = Math.floor(rng() * N);
        if (entry.grid[cy * N + cx] !== classOK) continue;
        const wmx = tx * this.tileEdgeM + (cx + 0.5) * this.cellM;
        const wmy = ty * this.tileEdgeM + (cy + 0.5) * this.cellM;
        const id = `wild_${crop}_${tx}_${ty}_${idx}`;
        if (picked.has(id)) return;
        wildplants.push({ x: wmx, y: wmy, crop, id });
        return;
      }
    };
    for (const cls of Object.keys(WILD_BIOME)) {
      const { crop, min, max } = WILD_BIOME[cls];
      const n = min + Math.floor(rng() * (max - min + 1));
      for (let i = 0; i < n; i++) placeWild(crop, Number(cls), i);
    }
    entry.wildplants = wildplants;
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
    // Arrow keys: 10x speed for fast debug travel.
    let speedMul = 1;
    if (k.LEFT.isDown)  { vx -= 1; speedMul = 10; }
    if (k.RIGHT.isDown) { vx += 1; speedMul = 10; }
    if (k.UP.isDown)    { vy -= 1; speedMul = 10; }
    if (k.DOWN.isDown)  { vy += 1; speedMul = 10; }
    const moving = vx || vy;
    if (moving && (this.gpsLocked || !this.gpsM)) {
      const n = Math.hypot(vx, vy);
      this.playerM.x += (vx / n) * WALK_M_S * speedMul * dt;
      this.playerM.y += (vy / n) * WALK_M_S * speedMul * dt;
      this.facing = { x: vx, y: vy };
      if (this.player.anims.currentAnim?.key !== 'walk-anim') this.player.play('walk-anim');
      if (vx < 0) this.player.setFlipX(true);
      else if (vx > 0) this.player.setFlipX(false);
    } else if (this._ease && !this.gpsLocked) {
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

    // Facing-direction indicator: small white dot offset from the player.
    this.facingGfx.clear();
    const fmag = Math.hypot(this.facing.x, this.facing.y);
    if (fmag > 0.001) {
      const fx = this.facing.x / fmag, fy = this.facing.y / fmag;
      const cx = this.viewCenterX + fx * 16;
      const cy = this.viewCenterY - 2 + fy * 16;
      this.facingGfx.fillStyle(0x000000, 0.5);
      this.facingGfx.fillCircle(cx, cy, 3);
      this.facingGfx.fillStyle(0xffffff, 0.95);
      this.facingGfx.fillCircle(cx, cy, 2);
    }

    if (!this._lastCheckM ||
        Math.hypot(this.playerM.x - this._lastCheckM.x, this.playerM.y - this._lastCheckM.y) > 20) {
      this._lastCheckM = { ...this.playerM };
      this.ensureTilesAround().catch(() => {});
    }

    // Walking auto-progression: when the player enters a new cell, run state transitions.
    const { cellIX, cellIY } = this.playerAbsCell();
    const cellKey = `${cellIX}_${cellIY}`;
    if (cellKey !== this._lastPlayerCellKey) {
      this._lastPlayerCellKey = cellKey;
      this.onPlayerEnterCell(cellIX, cellIY);
    }

    this.drawCells();
    this.drawObjects();
    this.updateHUD();
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
        const type = T(col, row);
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
        const isTilled = this.tilledSet && this.tilledSet.has(tilledKey);
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
        s.setFrame(opened ? 1 : 0);
        s.setOrigin(0.5, 0.9).setScale(2).setPosition(Math.round(sx), Math.round(sy));
        s.setAlpha(opened ? 0.55 : 1);
      }
    });

    this.renderPool(this.plantedPool, this.plantedContainer, plantedList, (s, item) => {
      const { p, dx, dy } = item;
      const sx = this.viewCenterX + (dx / this.cellM) * CELL_PX;
      const sy = this.viewCenterY + (dy / this.cellM) * CELL_PX;
      const stage = Math.min(MAX_GROWTH_STAGE, p.stage ?? 0);
      const row = CROP_ROW[p.crop] ?? 1;
      // In-world growth uses cols 0..5 of the crop's row.
      const frame = row * CROPS_SHEET_COLS + stage;
      if (s.texture.key !== 'crops') s.setTexture('crops');
      s.setFrame(frame);
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
      } else {
        if (s.texture.key !== 'chicken') { s.setTexture('chicken'); s.play('chicken-idle'); }
        s.setOrigin(0.5, 0.9).setScale(1).setPosition(Math.round(sx), Math.round(sy));
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
    const pWorldY = this.startWorldM.y + this.playerM.y;

    // 1) Catch a creature within 4m
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.creatures) continue;
      for (const c of entry.creatures) {
        if (this.save.caught.includes(c.id)) continue;
        if (Math.hypot(c.x - wm.x, c.y - wm.y) < 4) {
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
        if (Math.hypot(wp.x - wm.x, wp.y - wm.y) < 4) {
          if (Math.hypot(wp.x - pWorldX, wp.y - pWorldY) > 18) { this.flash('too far', sx, sy); return; }
          this.save.picked = [...pickedSet, wp.id];
          this.addToInv(wp.crop, 1); // produce
          let bonus = '';
          if (Math.random() < 0.25) { this.addToInv(`${wp.crop}_seed`, 1); bonus = ' +seed'; }
          persistSave(this.save);
          this.flash(`picked ${wp.crop}${bonus}`, sx, sy);
          return;
        }
      }
    }
    // 1b) World objects: chest open, tree chop, house flavor
    for (const entry of WorldGen.tileCache.values()) {
      if (!entry.objects) continue;
      for (const o of entry.objects) {
        const r = o.kind === 'house' ? 6 : 3.5;
        if (Math.hypot(o.x - wm.x, o.y - wm.y) >= r) continue;
        if (Math.hypot(o.x - pWorldX, o.y - pWorldY) > 18) {
          this.flash('too far', sx, sy); return;
        }
        if (o.kind === 'chest') {
          if (this.save.opened.includes(o.id)) { this.flash('already looted', sx, sy); return; }
          const loot = pickLoot(undefined, o.poiClass);
          this.addToInv(loot.id, loot.n);
          this.save.opened.push(o.id);
          persistSave(this.save);
          const lootIcon = ITEM_BY_ID[loot.id]?.icon || '?';
          const label = o.name ? `${CHEST_ICON} → ${lootIcon}×${loot.n}  ${o.name}` : `${CHEST_ICON} → ${lootIcon}×${loot.n}`;
          this.flash(label, sx, sy);
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
    // 2) Plant a seed (only manual farming action — till/water/harvest are automated by walking).
    const sel = this.save.inv[this.save.selSlot];
    const item = sel ? ITEM_BY_ID[sel.id] : null;
    if (Math.hypot(wm.x - pWorldX, wm.y - pWorldY) > 15) { this.flash('too far', sx, sy); return; }
    const cell = this.cellAt(wm.x, wm.y);
    if (!isTillable(cell.type)) {
      const flavor = cell.type === 3 ? 'water'
                   : (cell.type === 9 || cell.type === 11 || cell.type === 12) ? 'building'
                   : '·';
      this.flash(flavor, sx, sy);
      return;
    }
    if (!item || item.kind !== 'seed') {
      this.flash('select a seed', sx, sy);
      return;
    }
    const { cellIX, cellIY } = this.worldMetersToAbsCell(wm.x, wm.y);
    const { x: cwmx, y: cwmy } = this.absCellCenterMeters(cellIX, cellIY);
    const cellKey = `${cellIX}_${cellIY}`;
    if (!this.tilledSet.has(cellKey)) {
      this.flash('walk over to till first', sx, sy);
      return;
    }
    if (this.save.planted.some(p => Math.abs(p.x - cwmx) < 0.1 && Math.abs(p.y - cwmy) < 0.1)) {
      this.flash('already planted', sx, sy);
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
  }
  cellAt(wmx, wmy) {
    const wx = this.originPx.x + (wmx - this.startWorldM.x) / this.mPerPx;
    const wy = this.originPx.y + (wmy - this.startWorldM.y) / this.mPerPx;
    const tx = Math.floor(wx / 256), ty = Math.floor(wy / 256);
    const ix = Math.floor((wx - tx * 256) / (256 / this.cellsPerTile));
    const iy = Math.floor((wy - ty * 256) / (256 / this.cellsPerTile));
    const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
    return { tx, ty, ix, iy, type: entry && entry.grid ? entry.grid[iy * this.cellsPerTile + ix] : 0 };
  }
  catchCreature(c, sx, sy) {
    this.save.caught.push(c.id);
    persistSave(this.save);
    this.flash(`caught ${c.kind}!`, sx, sy);
  }

  onPlayerEnterCell(cellIX, cellIY) {
    // Identify the cell center in world meters (using the tile-pixel cell basis).
    const { x: cwmx, y: cwmy } = this.absCellCenterMeters(cellIX, cellIY);
    const cellKey = `${cellIX}_${cellIY}`;
    const cell = this.cellAt(cwmx, cwmy);

    // 1) Auto-harvest first (so we don't water a ready crop pointlessly).
    // NOTE: don't gate on isTillable() here — a planted crop must always be harvestable / waterable,
    // even if the cell now classifies as non-tillable (e.g. a building tier introduced after planting).
    const plantedIdx = this.save.planted.findIndex(p =>
      Math.abs(p.x - cwmx) < 0.1 && Math.abs(p.y - cwmy) < 0.1);
    if (plantedIdx >= 0) {
      const p = this.save.planted[plantedIdx];
      const stageHoldMs = 60 * 60 * 1000; // 1h between watering and stage advance
      const sinceWater = p.watered_t ? Date.now() - p.watered_t : Infinity;

      // 1a) If watered and 1h has elapsed, advance one stage and become dry again.
      if (p.watered_t && sinceWater >= stageHoldMs && (p.stage ?? 0) < MAX_GROWTH_STAGE) {
        p.stage = (p.stage ?? 0) + 1;
        p.watered_t = 0;
        persistSave(this.save);
      }

      // 1b) Mature → harvest. Produce always; bonus seed sometimes.
      if ((p.stage ?? 0) >= MAX_GROWTH_STAGE) {
        this.save.planted.splice(plantedIdx, 1);
        this.tilledSet.delete(cellKey);
        this.save.tilled = [...this.tilledSet];
        const yieldN = 1 + Math.floor(Math.random() * 3);
        this.addToInv(p.crop, yieldN); // produce
        if (Math.random() < 0.25) this.addToInv(`${p.crop}_seed`, 1); // bonus seed
        persistSave(this.save);
        this.flash(`harvested ${p.crop}×${yieldN}`, this.viewCenterX, this.viewCenterY - 20);
        return;
      }

      // 1c) Dry → water it (visual darken; stage advances after 1h on a later visit).
      if (!p.watered_t) {
        p.watered_t = Date.now();
        persistSave(this.save);
        this.flash('💧 watered', this.viewCenterX, this.viewCenterY - 20);
        return;
      }
      return;
    }

    // 3) Auto-till empty tillable ground (silent — no flash to avoid spam)
    if (!isTillable(cell.type)) return;
    if (!this.tilledSet.has(cellKey)) {
      this.tilledSet.add(cellKey);
      this.save.tilled = [...this.tilledSet];
      persistSave(this.save);
    }
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

  updateHUD() {
    const pc = this.playerToWorldCell();
    const lat = START_LAT + (-this.playerM.y) / 111320;
    const lon = START_LON + this.playerM.x / (111320 * Math.cos(START_LAT * Math.PI / 180));
    const loaded = [...WorldGen.tileCache.values()].filter(t => t.status === 'ready').length;
    const gps = this.gpsAvailable ? (this.gpsLocked ? 'LOCKED' : (this.gpsM ? 'live' : 'waiting')) : 'wasd';
    this.hud.textContent =
      `${lat.toFixed(5)}, ${lon.toFixed(5)}   gps:${gps}\n` +
      `tile ${pc.tx}/${pc.ty}   tiles:${loaded}   caught:${this.save.caught.length}   plots:${this.save.planted.length}`;
    if (this.moneyEl) this.moneyEl.textContent = `$${this.save.money ?? 0}`;
  }

  shopInteract(sx, sy) {
    const sel = this.save.inv[this.save.selSlot];
    if (sel && sel.id) {
      // SELL one of the selected stack.
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
    // BUY — empty slot: get next seed from the rotation.
    const id = BUY_LIST[(this.save.buyIndex ?? 0) % BUY_LIST.length];
    const price = PRICES[id] ?? 0;
    if ((this.save.money ?? 0) < price) {
      this.flash(`need $${price}`, sx, sy);
      return;
    }
    this.save.money -= price;
    this.save.buyIndex = (this.save.buyIndex ?? 0) + 1;
    this.addToInv(id, 1);
    const item = ITEM_BY_ID[id];
    this.flash(`bought ${item?.icon || ''} -$${price}`, sx, sy);
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
      // Inventory icon: seeds use col 8, produce uses col 7, both at the crop's row in Crops.png.
      const cropKey = item && (item.grows || item.crop);
      const cropRow = cropKey != null ? CROP_ROW[cropKey] : null;
      if (item && cropRow != null && (item.kind === 'seed' || item.kind === 'produce')) {
        const col = item.kind === 'seed' ? SEEDBOX_COL : PRODUCE_COL;
        // Source 144x256; display 16x16 cells at 32x32 → 2x scale → bg-size 288x512.
        const icon = document.createElement('span');
        icon.style.cssText =
          "width:32px;height:32px;display:inline-block;" +
          "background-image:url('Objects/Crops.png');" +
          "background-size:288px 512px;" +
          `background-position:-${col * 32}px -${cropRow * 32}px;` +
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
