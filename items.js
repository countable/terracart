// Item & crop registry: all per-crop config, item definitions, prices, and
// the inventory-icon resolver. Extracted from app.js so the catalog lives
// in one place and changes to the crop roster don't require editing logic.
//
// Depends on:
//   nothing external. Pure data + a small lookup helper. Must load BEFORE
//   loot.js (loot weights reference SEED_TIER/FLOWER_SEEDS) and app.js.
//
// Exports as globals:
//   CROP_ROW, MAX_GROWTH_STAGE, PRODUCE_COL, SEEDBOX_COL, CROPS_SHEET_COLS
//   SPRING_CROPS_COLS, CROP_SPRITE, inventoryIconSource
//   CROP_NAMES, ITEMS, ITEM_BY_ID, LOOTABLE_IDS
//   PRICES, BUY_LIST, STARTING_MONEY
//   SEED_TIER, FLOWER_SEEDS  (loot tier config; co-located with the crops they describe)

// Crops sheet (Objects/Crops.png, 9 cols x 16 rows of 16x16 cells).
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
const SPRING_CROPS_COLS = 14;
const CROP_SPRITE = {
  potato: { sheet: 'springcrops', row: 5 },
  // Long grass uses a procedurally generated 16x16 texture (see drawLongGrassTex).
  longgrass: { sheet: 'longgrass', custom: true },
};

// Resolve the same icon source the inventory uses for an item id.
// Returns { sheet, frame } where frame is the 16x16 frame index in the spritesheet,
// or null if the item has no sprite (use emoji fallback).
//   Spring Crops.png: 14 cols x 8 rows. Inventory: col 7 = seed bag, col 8 = produce.
//   Crops.png: 9 cols x 16 rows. Inventory: col 8 row 15 = generic seedbag,
//     col 7 row CROP_ROW[crop] = produce.
function inventoryIconSource(itemId) {
  const item = ITEM_BY_ID[itemId];
  if (!item) return null;
  const cropKey = item.grows || item.crop;
  if (!cropKey) return null;
  const ov = CROP_SPRITE[cropKey];
  if (ov && ov.sheet === 'springcrops') {
    const col = item.kind === 'seed' ? 7 : (item.kind === 'produce' ? 8 : null);
    if (col == null) return null;
    return { sheet: 'springcrops', frame: ov.row * 14 + col };
  }
  if (ov && ov.custom) {
    // longgrass uses the procedural texture; reuse its key directly.
    return { sheet: ov.sheet, frame: 0 };
  }
  if (item.kind === 'seed') return { sheet: 'crops', frame: 15 * 9 + 8 };
  if (item.kind === 'produce') {
    const row = CROP_ROW[cropKey];
    if (row == null) return null;
    return { sheet: 'crops', frame: row * 9 + PRODUCE_COL };
  }
  return null;
}

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
// to buy the next seed in BUY_LIST. Prices are tuned to how easy each item is
// to obtain. Produce range: wild-debris commons at $1, rarest T3 flower at $500.
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
  cow: 200,        // ~15–30/tile, premium catch
  // ── Wild-only ────────────────────────────────────────────
  longgrass: 1,
  flowers: 2,
};
const BUY_LIST = Object.keys(CROP_ROW).map(c => `${c}_seed`);
const STARTING_MONEY = 25;

// === Per-crop loot tier config (used by chests + treasure marks) ===
// T1 common (10 seeds/chest default yield), T2 uncommon (5), T3 rare (2).
const SEED_TIER = {
  rainberry_seed: 1, pairy_seed: 1, nut_seed: 1, potato_seed: 1, shrub_seed: 1,
  gemfruit_seed: 2, rockfruit_seed: 2, coffee_seed: 2, tree_seed: 2,
  iceflower_seed: 3, fireflower_seed: 3, sunflower_seed: 3,
};
// Flowers — used by the 'flora' chest category to restrict its T3 picks.
const FLOWER_SEEDS = new Set(['iceflower_seed', 'fireflower_seed', 'sunflower_seed']);
