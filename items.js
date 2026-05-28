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
  // Mushroom uses the Fantasy Mushroom sheet ('mushroom_world' key in
  // assets.js, 3 cols × 9 rows of 32×32 frames). Frame 0 (top-left cell)
  // is fully transparent in the source PNG — picking it gave a blank
  // inventory slot and an invisible wildplant on the map. Frame 2 (top-
  // right) is the big red mushroom cluster that fills the cell, so it
  // reads at icon size and at the wildplant's in-world scale.
  mushroom: { sheet: 'mushroom_world', custom: true, frame: 2 },
  // Shell — 12 variants in shell_sheet (3×4 of 16×16). Each spawned shell
  // sets ._variant from a stable hash of its cell coords so the same cell
  // always renders the same shell, and the beach reads as a varied mix.
  shell: { sheet: 'shell_sheet', custom: true, variants: 12 },
};

// Resolve the same icon source the inventory uses for an item id.
// Returns { sheet, frame } where frame is the 16x16 frame index in the spritesheet,
// or null if the item has no sprite (use emoji fallback).
//   Spring Crops.png: 14 cols x 8 rows. Inventory: col 7 = seed bag, col 8 = produce.
//   Crops.png: 9 cols x 16 rows. Inventory: col 8 row 15 = generic seedbag,
//     col 7 row CROP_ROW[crop] = produce.
// Inventory icons that live OUTSIDE the crops sheet. Each entry points at
// a sheet key (resolved to a real .png path by the SHEETS table in
// app.js' renderItemIcon) plus a frame index. One line per item; the
// renderer handles the rest. Used by trader / shop / inventory modals.
const MINERAL_ICON_SHEET = {
  coal:     { sheet: 'coal_icon', frame: 0 },
  sapphire: { sheet: 'gems',      frame: 4 },   // blue gem
  ruby:     { sheet: 'gems',      frame: 0 },   // red gem
  emerald:  { sheet: 'gems',      frame: 3 },   // green gem
  // Bars from the 16-col Extras 'Bars and ores' sheet. First row is bars
  // in tier order; row 1 holds the matching ores (unused — we drop bars
  // directly, no smelting step).
  copper_bar:   { sheet: 'bars', frame: 0 },
  iron_bar:     { sheet: 'bars', frame: 1 },
  gold_bar:     { sheet: 'bars', frame: 2 },
  platinum_bar: { sheet: 'bars', frame: 3 },
  crimson_bar:  { sheet: 'bars', frame: 4 },
  frost_bar:    { sheet: 'bars', frame: 5 },
  // Animal produce — Chicken Egg.png / Small Cow Milk.png are 32×16 each.
  egg:      { sheet: 'icon_egg',  frame: 0 },
  milk:     { sheet: 'icon_milk', frame: 0 },
  // Orchard fruit — Food Icons/<species>.png, 32×16 each (frame 0 = the
  // whole fruit, frame 1 a slice / cooked variant).
  apple:    { sheet: 'icon_apple',   frame: 0 },
  cherry:   { sheet: 'icon_cherry',  frame: 0 },
  peach:    { sheet: 'icon_peach',   frame: 0 },
  banana:   { sheet: 'icon_banana',  frame: 0 },
  orange:   { sheet: 'icon_orange',  frame: 0 },
  mango:    { sheet: 'icon_mango',   frame: 0 },
  coconut:  { sheet: 'icon_coconut', frame: 0 },
  apricot:  { sheet: 'icon_apricot', frame: 0 },
  // Fish — Icons/Fish/<*>.png, 64×16 (4 frames). frame 0 = right-facing fish.
  // No standalone minnow art; reuse the smallmouth-bass icon for it.
  minnow:     { sheet: 'icon_minnow',     frame: 0 },
  bass:       { sheet: 'icon_bass',       frame: 0 },
  trout:      { sheet: 'icon_trout',      frame: 0 },
  salmon:     { sheet: 'icon_salmon',     frame: 0 },
  goldenfish: { sheet: 'icon_goldenfish', frame: 0 },
  // Consumables — flutes/books are 32×32 / 240×64 multi-frame sheets;
  // frame 0 is the basic variant.
  flute:      { sheet: 'icon_flute',  frame: 0 },
  book:       { sheet: 'icon_book',   frame: 0 },
  // Wilderness drops — meat is beef, rabbit_pelt uses one of the colour
  // variants, crow_feather uses the chicken-feather sheet's first frame.
  meat:         { sheet: 'icon_meat',    frame: 0 },
  rabbit_pelt:  { sheet: 'icon_pelt',    frame: 0 },
  crow_feather: { sheet: 'icon_feather', frame: 0 },
  // Beach pickup — Icons/Fish/Sea/Creatures/Shell.png is a 12-frame variant
  // sheet; frame 0 is the canonical cowrie used for the inventory icon.
  shell:        { sheet: 'shell_sheet', frame: 0 },
};

function inventoryIconSource(itemId) {
  const item = ITEM_BY_ID[itemId];
  if (!item) return null;
  // Minerals + gems use the dedicated sheet table above.
  if (MINERAL_ICON_SHEET[itemId]) return MINERAL_ICON_SHEET[itemId];
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
    // ov.frame is honoured so sheets with multiple cells (e.g. mushroom_world,
    // whose frame 0 is empty) can point at the right cell.
    return { sheet: ov.sheet, frame: ov.frame ?? 0 };
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
// Per-crop produce emoji — used in DOM modals / flash text where Phaser sprites
// aren't easily embedded. The default 🌾 (sheaf-of-rice) looked like wheat for
// every crop. These are picked to roughly match each crop's visual identity.
const PRODUCE_EMOJI = {
  rainberry:  '🫐',  pairy:     '🍐',  gemfruit:  '💎',
  nut:        '🌰',  rockfruit: '🪨',  coffee:    '☕',
  potato:     '🥔',  iceflower: '❄️',  fireflower: '🔥',
  sunflower:  '🌻',  tree:      '🌳',  shrub:     '🌿',
};
// === Per-item rarity tier (1..7) — used by rarity.js' unified picker. ===
// Tier reflects relative rarity / value, not stage / yield. A seed and its
// produce share a tier. Wild fauna and minerals climb with gem ladder. New
// items SHOULD get a baseTier; rarity.js defaults missing entries to 1.
const BASE_TIER = {
  // Crops (same tier for seed & produce; the seed id uses the suffix).
  // Spread across all four chest tiers.
  potato: 1, rockfruit: 1,
  rainberry: 2, pairy: 2, nut: 2, shrub: 2, tree: 2,
  coffee: 3, gemfruit: 3,
  // Magical flowers — each one is the seed pair to its same-named magical
  // gear tier (sunflower → Platinum recipes, fireflower → Crimson,
  // iceflower → Frost). Tier follows gear_tier - 1.
  sunflower: 4, fireflower: 5, iceflower: 6,
  // Smelted metal bars dropped by mineralrocks. Each tier is the recipe
  // ingredient for that tier's tool/weapon/armor at the blacksmith.
  copper_bar: 2, iron_bar: 3, gold_bar: 4,
  platinum_bar: 5, crimson_bar: 6, frost_bar: 7,
  // Wild produce / animal output
  longgrass: 1, flowers: 1, mushroom: 1,
  egg: 1, milk: 2,
  // Fish (rarity ramps fast — goldenfish is the late-game catch)
  minnow: 1, bass: 2, trout: 3, salmon: 4, goldenfish: 6,
  // Orchard fruit (apple/cherry/peach/apricot ~ mid-low; coconut/banana late)
  apple: 2, cherry: 2, peach: 2, apricot: 2,
  orange: 3, mango: 3,
  banana: 4, coconut: 4,
  // Live animals
  chicken: 1, dog: 1, rabbit: 1,
  cat: 2, butterfly: 2,
  crow: 3,
  deer: 4,
  cow: 5,
  // Consumables
  flute: 2, book: 2,
  // Minerals — coal floor, gem ladder mirrors mining rarity
  coal: 1,
  meat: 2, rabbit_pelt: 2,
  crow_feather: 3,
  sapphire: 4, ruby: 5, emerald: 6,
};

const ITEMS = [
  ...Object.keys(CROP_ROW).map(c => ({
    id: `${c}_seed`, name: `${CROP_NAMES[c]} Seed`, kind: 'seed', grows: c, icon: '🌱',
    baseTier: BASE_TIER[c] || 1,
  })),
  ...Object.keys(CROP_ROW).map(c => ({
    id: c, name: CROP_NAMES[c], kind: 'produce', crop: c,
    icon: PRODUCE_EMOJI[c] || '🌾',
    baseTier: BASE_TIER[c] || 1,
  })),
  // Caught creatures stack in the inventory. Catching any wild animal —
  // including wilderness fauna (deer, rabbit, crow, butterfly) — puts the
  // live animal here; processing into meat / pelt / feather is a separate
  // step downstream.
  { id: 'chicken',   name: 'Chicken',   kind: 'animal', icon: '🐔' },
  { id: 'cow',       name: 'Cow',       kind: 'animal', icon: '🐄' },
  { id: 'cat',       name: 'Cat',       kind: 'animal', icon: '🐱' },
  { id: 'dog',       name: 'Dog',       kind: 'animal', icon: '🐶' },
  { id: 'deer',      name: 'Deer',      kind: 'animal', icon: '🦌' },
  { id: 'rabbit',    name: 'Rabbit',    kind: 'animal', icon: '🐇' },
  { id: 'crow',      name: 'Crow',      kind: 'animal', icon: '🦅' },
  { id: 'butterfly', name: 'Butterfly', kind: 'animal', icon: '🦋' },
  // Animal produce — feed longgrass to a wild chicken / cow to swap the
  // longgrass for an egg / milk. Repeatable until either you run out of
  // longgrass or the animal is caught.
  { id: 'egg',  name: 'Egg',  kind: 'produce', icon: '🥚' },
  { id: 'milk', name: 'Milk', kind: 'produce', icon: '🥛' },
  // Wild-only produce — grows in grasslands, picked as debris. Not plantable.
  { id: 'longgrass', name: 'Long Grass', kind: 'produce', crop: 'longgrass', icon: '🌿' },
  // Wild flower pickups (per-polygon color but stacks as a single item).
  { id: 'flowers', name: 'Flowers', kind: 'produce', icon: '🌼' },
  // Consumables — used on yourself (tap your own feet with one selected).
  // Flute: lures wandering chickens + cows within 30m toward you.
  // Book:  reveals a play tip or a directional hint to a nearby chest.
  { id: 'flute', name: 'Flute', kind: 'consumable', icon: '🪈' },
  { id: 'book',  name: 'Book',  kind: 'consumable', icon: '📖' },
  // Wild forest fauna drops — produced when a live caught animal is
  // processed (a future butcher / blacksmith step). Catching itself yields
  // the animal, not these.
  // ('butterfly' lives above as the live-animal entry — there is no
  // separate butterfly product; the insect itself is the drop.)
  // Animal byproducts — kind: 'produce' alongside egg / milk. Sit in the
  // produce pool of the rarity picker, not the mineral pool (which is
  // reserved for coal / gemstones).
  { id: 'meat',         name: 'Meat',         kind: 'produce', icon: '🥩' },
  { id: 'rabbit_pelt',  name: 'Rabbit Pelt',  kind: 'produce', icon: '🐇' },
  { id: 'crow_feather', name: 'Crow Feather', kind: 'produce', icon: '🪶' },
  // Beach pickup — shells spawn as wildplant debris on sand cells
  // (DEBRIS_CROP[2] = 'shell' in worldgen.js). 12 visual variants in
  // shell_sheet, hashed off the spawn cell coord.
  { id: 'shell',        name: 'Shell',        kind: 'produce', crop: 'shell', icon: '🐚' },
  // Scarecrow — placeable on tillable cells. Wild crows and deer steer
  // around it (4-cell aversion radius in wanderCreatures). Stack of N can
  // be deployed across the farm.
  { id: 'scarecrow',    name: 'Scarecrow',    kind: 'consumable', icon: '🪦' },
  // Wild mushroom (forest debris, pickable)
  { id: 'mushroom',     name: 'Mushroom',     kind: 'produce', crop: 'mushroom', icon: '🍄' },
  // Fish (caught by Fishing Rod on water tiles). dropWeight: 0.4 trims their
  // share within the (produce, tier) pool so chest loot reads as mostly crops
  // and fruit, with fish as an occasional aquatic surprise rather than the
  // dominant produce drop at higher tiers.
  { id: 'minnow',     name: 'Minnow',     kind: 'produce', crop: 'minnow',     icon: '🐟', dropWeight: 0.4 },
  { id: 'bass',       name: 'Bass',       kind: 'produce', crop: 'bass',       icon: '🐠', dropWeight: 0.4 },
  { id: 'trout',      name: 'Trout',      kind: 'produce', crop: 'trout',      icon: '🐟', dropWeight: 0.4 },
  { id: 'salmon',     name: 'Salmon',     kind: 'produce', crop: 'salmon',     icon: '🍣', dropWeight: 0.4 },
  { id: 'goldenfish', name: 'Goldenfish', kind: 'produce', crop: 'goldenfish', icon: '✨', dropWeight: 0.4 },
  // Fruit from fruit trees in orchard tiles
  { id: 'apple',   name: 'Apple',   kind: 'produce', crop: 'apple',   icon: '🍎' },
  { id: 'cherry',  name: 'Cherry',  kind: 'produce', crop: 'cherry',  icon: '🍒' },
  { id: 'peach',   name: 'Peach',   kind: 'produce', crop: 'peach',   icon: '🍑' },
  { id: 'banana',  name: 'Banana',  kind: 'produce', crop: 'banana',  icon: '🍌' },
  { id: 'orange',  name: 'Orange',  kind: 'produce', crop: 'orange',  icon: '🍊' },
  { id: 'mango',   name: 'Mango',   kind: 'produce', crop: 'mango',   icon: '🥭' },
  { id: 'coconut', name: 'Coconut', kind: 'produce', crop: 'coconut', icon: '🥥' },
  { id: 'apricot', name: 'Apricot', kind: 'produce', crop: 'apricot', icon: '🍑' },
  // Rock-break loot. Coal is common + low value, gems are rare + high value.
  // (Gem types deliberately distinct so high-tier rocks feel like a real find.)
  { id: 'coal',     name: 'Coal',     kind: 'mineral', icon: '⚫' },
  { id: 'sapphire', name: 'Sapphire', kind: 'mineral', icon: '🔵' },
  { id: 'ruby',     name: 'Ruby',     kind: 'mineral', icon: '🔴' },
  { id: 'emerald',  name: 'Emerald',  kind: 'mineral', icon: '🟢' },
  // Smelted metal bars — primary forge material at blacksmiths. Dropped
  // by mineralrocks (worldgen.js). One ladder per material tier 2..7;
  // tier 1 (wood) gear is starter-shop only and doesn't need a bar.
  { id: 'copper_bar',   name: 'Copper Bar',   kind: 'mineral', icon: '🟫' },
  { id: 'iron_bar',     name: 'Iron Bar',     kind: 'mineral', icon: '⬜' },
  { id: 'gold_bar',     name: 'Gold Bar',     kind: 'mineral', icon: '🟨' },
  { id: 'platinum_bar', name: 'Platinum Bar', kind: 'mineral', icon: '⬛' },
  { id: 'crimson_bar',  name: 'Crimson Bar',  kind: 'mineral', icon: '🟥' },
  { id: 'frost_bar',    name: 'Frost Bar',    kind: 'mineral', icon: '🟦' },
];
// Fill in baseTier for every entry that didn't set one explicitly (cleaner
// than threading the lookup through each literal above). Anything missing
// from BASE_TIER falls back to 1 — that's an authoring oversight worth
// fixing rather than a load-time crash.
for (const it of ITEMS) {
  if (it.baseTier == null) it.baseTier = BASE_TIER[it.id] || 1;
}
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
  cat: 150,        // ~15–30/tile, wants milk
  dog: 150,        // ~15–30/tile, wants eggs
  // ── Wild-only ────────────────────────────────────────────
  longgrass: 1,
  flowers: 2,
  shell: 6,        // beach pickup — small collectible

  // ── Animal produce (longgrass-feeding output) ────────────
  egg:  4,
  milk: 18,
  // ── Consumables ──────────────────────────────────────────
  // Bought from shops occasionally; small sell value if you hoard them.
  flute: 12,
  book:  20,
  // ── Rock-break minerals ──────────────────────────────────
  coal:      3,
  sapphire:  30,
  ruby:      80,
  emerald:  200,
  // ── Metal bars (blacksmith forge ingredients) ───────────
  // Roughly 2.5× ramp per tier, matching MATERIAL_TIERS.costMul.
  copper_bar:    30,
  iron_bar:      80,
  gold_bar:     200,
  platinum_bar: 500,
  crimson_bar: 1200,
  frost_bar:   3000,
  // ── Forest fauna drops ───────────────────────────────────
  meat: 30,
  rabbit_pelt: 15,
  crow_feather: 10,
  butterfly: 5,
  // ── Wild mushroom ────────────────────────────────────────
  mushroom: 8,
  // ── Fish ─────────────────────────────────────────────────
  minnow: 2,    bass: 12,   trout: 40,   salmon: 100, goldenfish: 300,
  // ── Orchard fruit ────────────────────────────────────────
  apple: 8, cherry: 12, peach: 10, banana: 14, orange: 10, mango: 18, coconut: 16, apricot: 10,
};
const BUY_LIST = Object.keys(CROP_ROW).map(c => `${c}_seed`);
const STARTING_MONEY = 25;

// === Energy / food ===
// Player starts at STARTING_ENERGY; armor pieces raise the maximum (see ARMOR_DEFS
// below). Eating food restores energy by FOOD_ENERGY[id]. Actions like rock-break,
// till, and harvest deduct energy via ENERGY_COST and refuse when the current
// pool is too low.
// === Book of Tips ============================================
// Non-obvious play tips revealed when the player uses a Book consumable.
// The Book handler in interact.js mixes ~50% of these with ~50% directional
// chest hints (computed live from the nearest unopened chest).
const PLAY_TIPS = [
  // Shop / trade
  'Select an empty inventory slot, then tap a house to trade or buy.',
  'Houses have different deals — some sell produce, others seeds.',
  'Castles always sell relics (and never run out of stock).',
  'Forts handle up to 5 deals per hour. Houses just 1.',
  'A trader who wants an item you don\'t own marks the deal with an ✗.',
  // Relic effects
  'A Sword raises your sell prices — up to 100% at Frost tier.',
  'Bow or Staff drops the markup traders charge you — best tier wins.',
  'Equip a Pickaxe to break rocks, an Axe to chop trees.',
  'A Ring nudges chest loot up a tier when it triggers.',
  'An Amulet projects a ghost — higher tier means faster scouting + cheaper energy.',
  'Watering Can-watered crops yield bonus seeds. Refill from any water tile.',
  // Progression / gating
  'Harvest a sunflower to unlock Gold relics from chests and shops.',
  'Catch a cow to unlock Platinum.',
  'Harvest a fireflower for Crimson; iceflower for Frost.',
  'Higher-tier chests favour higher-tier relics — bus chests cap at Wood.',
  // Energy / food
  'Rainberry waters every crop within 20m when you eat it.',
  'Pairy points the way to the nearest undiscovered chest for 5 minutes.',
  'Sunflower stew restores +150 energy — the biggest meal in the world.',
  // Farming
  'Crops auto-advance after 60 min if watered, even while you\'re away.',
  'Tilling refuses a cell holding a wildplant, rock, or building.',
  'Tap a tilled empty cell with no seed selected to un-till it.',
  // World / map
  'Treasure X marks favour residential cells. Look there first.',
  'Wild rockfruit grows in residential streets; shrubs in parks and woods.',
  'Long grass only grows on plain grassland — never under trees.',
  // Combat / discovery
  'Hold rockfruit and tap an empty tile to drop a stone fence.',
  'Tap an animal you released to catch it again.',
  // Animal favourite foods — one tip per kind, so a Book read can reveal them.
  'Chickens come running for a juicy rainberry. Hold one to catch one.',
  'Cows can\'t resist a ripe pairy — the only food a cow will pause for.',
  'A saucer of milk tames a wild cat — that\'s the only way to catch one.',
  'Dogs only follow a hunter — hold raw meat to catch one.',
  'Hunting a deer takes a weapon relic — sword, bow or staff. Bare hands won\'t do.',
  'Feed any plant or crop to a chicken or cow and they\'ll trade it for an egg / milk.',
  'Cats and dogs only eat meat — feeding them plants just wastes the food.',
];

const STARTING_ENERGY = 100;
const FOOD_ENERGY = {
  longgrass:  2,
  shrub:      4,
  nut:        8,
  potato:     8,
  rainberry: 12,   // also waters all crops within 20m
  pairy:     12,   // also shows the nearest undiscovered chest for 5 min
  gemfruit:  20,
  rockfruit: 20,
  coffee:    35,
  tree:      35,
  iceflower:  60,
  fireflower: 90,
  sunflower: 150,
  chicken:    30,
  cow:       120,
  cat:        20,
  dog:        20,
  egg:        10,
  milk:       40,
  mushroom:   25,
  apple:      12, cherry: 14, peach: 12, banana: 18, orange: 12, mango: 20, coconut: 18, apricot: 10,
  minnow:      5, bass: 15, trout: 25, salmon: 50, goldenfish: 100,
  meat:       45,   // hunted from deer; dog favourite
};
const ENERGY_COST = {
  till: 2,
  plant: 1,
  harvest: 1,
  rockBreak: 10,         // mitigated by pick relic tier (see effectivePickCost)
  rockPlace: 1,
  catch: 5,
  unTill: 0,
  pickup: 0,             // wildplants / flora — free
};

// Catching an animal requires holding its favourite food in the selected
// inventory slot — one is consumed per catch. Both picks are T1 farm produce
// so the player has to deliberately grow a crop (not just collect debris)
// before they can catch livestock. ITEM_BY_ID lookup so the catch flash can
// show the readable name.
// Per-animal accepted "favourite" food list. First entry is the canonical
// preferred food (used in hint flashes like "needs milk"); any subsequent
// entry also accepts. Code that asks for the singular favourite should
// read ANIMAL_FOOD[kind][0]; code that asks "is this food OK?" should call
// animalLikesFood(kind, id) below.
const ANIMAL_FOOD = {
  chicken: ['rainberry'],  // berries to peck
  cow:     ['pairy'],      // pears to munch
  // Cats love milk AND any kind of fish.
  cat:     ['milk', 'minnow', 'bass', 'trout', 'salmon', 'goldenfish'],
  dog:     ['meat'],       // raw meat — hunt deer with a weapon relic
};
function animalLikesFood(kind, foodId) {
  const list = ANIMAL_FOOD[kind];
  if (!list) return false;
  return list.includes(foodId);
}

// === Relics / armor catalogs ===
// Material tier 1..7 mirrors the Icons/RPG icons folders. Higher tier = stronger
// effect AND higher price. Player can hold one relic per slot, one armor per
// slot. Buying an equal-or-lower-tier item into an occupied slot is refused.
const MATERIAL_TIERS = [
  { tier: 1, folder: '1. Wood',     name: 'Wood',     costMul: 1,   effMul: 1.0 },
  { tier: 2, folder: '2. Cooper',   name: 'Copper',   costMul: 3,   effMul: 1.5 },
  { tier: 3, folder: '3. Iron',     name: 'Iron',     costMul: 8,   effMul: 2.2 },
  { tier: 4, folder: '4. Gold',     name: 'Gold',     costMul: 20,  effMul: 3.0 },
  { tier: 5, folder: '5. Platinum', name: 'Platinum', costMul: 50,  effMul: 4.0 },
  { tier: 6, folder: '6. Crimson',  name: 'Crimson',  costMul: 120, effMul: 5.0 },
  { tier: 7, folder: '7. Frost',    name: 'Frost',    costMul: 280, effMul: 6.0 },
];
const TIER_BY_NUM = Object.fromEntries(MATERIAL_TIERS.map(t => [t.tier, t]));
// Relic SLOT defs. icon=file under Icons/RPG icons/Weapons and Armor/<folder>/.
// effectKey is read by gameplay code (interact.js / loot.js) to apply bonuses.
const RELIC_DEFS = {
  pick:    { slot: 'pick',   name: 'Pickaxe', icon: 'Pickaxe.png', baseCost:  80,
             effectKey: 'rockSpeed',     blurb: 'lets you break rocks' },
  axe:     { slot: 'axe',    name: 'Axe',     icon: 'Axe.png',     baseCost:  80,
             effectKey: 'chopSpeed',     blurb: 'lets you chop trees' },
  ring:    { slot: 'ring',   name: 'Ring',    icon: 'Rings.png',   baseCost:  60,
             effectKey: 'lootTier',      blurb: 'rarer chest loot' },
  amulet:  { slot: 'amulet', name: 'Amulet',  icon: 'Amulet.png',  baseCost:  60,
             effectKey: 'ghostMode',     blurb: 'projects a ghost — faster + cheaper per tier' },
  // Weapons — no combat yet, but they bend shop prices. Sword raises sell
  // values; bow/staff lower buy prices (max(bow,staff) tier wins).
  sword:   { slot: 'sword',  name: 'Sword',   icon: 'Sword.png',   baseCost:  80,
             effectKey: 'sellPrice',     blurb: 'better sell prices' },
  bow:     { slot: 'bow',    name: 'Bow',     icon: 'Bow.png',     baseCost:  60,
             effectKey: 'buyPrice',      blurb: 'better buy prices' },
  staff:   { slot: 'staff',  name: 'Staff',   icon: 'Staff.png',   baseCost:  60,
             effectKey: 'buyPrice',      blurb: 'better buy prices' },
  // Watering can — when equipped, every watering tap on a crop "improves" it.
  // Tier T adds (T) tiers of quality. Tap WATER with the can to refill: the
  // next 50 watering uses get an extra +2 tiers of bonus stacked on top.
  // Boost is consumed at harvest: every quality-tier raises the extra-seed
  // chance by 10% (base 25%) and adds +floor(qual/3) to the produce yield.
  can:     { slot: 'can',    name: 'Watering Can', icon: 'Watering can.png', baseCost: 100,
             effectKey: 'wateringQuality', blurb: 'higher-quality watered crops' },
  // Hoe — reduces the energy cost of tilling. Each tier shaves 1/3 of the cost
  // (floored at 1) AND adds a per-tier chance of spending zero energy at all.
  hoe:     { slot: 'hoe',    name: 'Hoe',     icon: 'Hoe.png',     baseCost:  70,
             effectKey: 'tillSpeed',     blurb: 'cheaper tilling, sometimes free' },
  // Bug Net — single 16×16 icon under Extras (handled by gearAssetPath below).
  bugnet:  { slot: 'bugnet', name: 'Bug Net',     icon: 'Bug net.png',     baseCost: 60,
             effectKey: 'bugCatch',  blurb: 'catch crows + butterflies' },
  // Fishing Rod — standard 32×16 weapon sheet per tier folder.
  rod:     { slot: 'rod',    name: 'Fishing Rod', icon: 'Fishing Rod.png', baseCost: 90,
             effectKey: 'fishing',   blurb: 'catch fish from water' },
  // Bags — raise the per-stack inventory cap. No bag = 9; each tier adds ~34,
  // tier 7 = 249. Icon lives under Extras (single image, tier shown via badge).
  bags:    { slot: 'bags',   name: 'Bag',         icon: 'Bags.png',        baseCost: 70,
             effectKey: 'stackCap',  blurb: 'carry more of each item' },
};

// Per-stack inventory cap as a function of the bag tier (0 = no bag).
// Linear 9 → 249 across tiers 0..7 (matches user spec: start 9, max 249).
const STACK_CAP_BASE = 9;
const STACK_CAP_MAX  = 249;
function stackCapForBags(bagsRelic) {
  const t = bagsRelic?.tier || 0;
  if (t <= 0) return STACK_CAP_BASE;
  if (t >= 7) return STACK_CAP_MAX;
  // 9, 43, 78, 112, 146, 181, 215, 249 across tiers 0..7.
  return Math.round(STACK_CAP_BASE + (STACK_CAP_MAX - STACK_CAP_BASE) * (t / 7));
}
const ARMOR_DEFS = {
  helmet: { slot: 'helmet', name: 'Helmet',     icon: 'Helmet.png',     baseCost: 100, energyPerTier: 10 },
  chest:  { slot: 'chest',  name: 'Chestplate', icon: 'Chestplate.png', baseCost: 250, energyPerTier: 25 },
  legs:   { slot: 'legs',   name: 'Leggings',   icon: 'Leggings.png',   baseCost: 150, energyPerTier: 15 },
  boots:  { slot: 'boots',  name: 'Boots',      icon: 'Boots.png',      baseCost:  80, energyPerTier:  8 },
};
// Helper: relic-or-armor item id (e.g. 'relic_pick_3' for an Iron pickaxe).
function gearId(kind, slot, tier) { return `${kind}_${slot}_${tier}`; }
function parseGearId(id) {
  const m = /^(relic|armor)_(\w+?)_(\d+)$/.exec(id);
  if (!m) return null;
  return { kind: m[1], slot: m[2], tier: +m[3] };
}
function gearDef(kind, slot) {
  return kind === 'relic' ? RELIC_DEFS[slot] : (kind === 'armor' ? ARMOR_DEFS[slot] : null);
}
function gearPrice(kind, slot, tier) {
  const def = gearDef(kind, slot); const t = TIER_BY_NUM[tier];
  if (!def || !t) return 0;
  // Global 4× price reduction — original scaling left wood-tier gear out of
  // reach for early players. Floors at $1.
  return Math.max(1, Math.ceil(def.baseCost * t.costMul / 4));
}
function gearAssetPath(kind, slot, tier) {
  const def = gearDef(kind, slot); const t = TIER_BY_NUM[tier];
  if (!def || !t) return null;
  // Ring + amulet live under Extras (single icon, tier shown as a badge).
  // Everything else (pickaxe, armor pieces) is per-tier under Weapons and Armor.
  if (kind === 'relic' && (slot === 'ring' || slot === 'amulet' || slot === 'bugnet' || slot === 'bags')) {
    return `Icons/RPG icons/Extras/${def.icon}`;
  }
  return `Icons/RPG icons/Weapons and Armor/${t.folder}/${def.icon}`;
}
function gearName(kind, slot, tier) {
  const def = gearDef(kind, slot); const t = TIER_BY_NUM[tier];
  if (!def || !t) return slot;
  return `${t.name} ${def.name}`;
}
function maxEnergyFromArmor(armor) {
  let m = STARTING_ENERGY;
  if (!armor) return m;
  for (const [slot, eq] of Object.entries(armor)) {
    if (!eq) continue;
    const def = ARMOR_DEFS[slot]; const t = TIER_BY_NUM[eq.tier];
    if (def && t) m += def.energyPerTier * eq.tier;
  }
  return m;
}
// Pick relic: per-tier 15% reduction in cost/time, floor at 2.
function effectivePickCost(relics) {
  const eq = relics?.pick;
  if (!eq) return ENERGY_COST.rockBreak;
  return Math.max(2, Math.round(ENERGY_COST.rockBreak - eq.tier * 1.2));
}
// Hoe relic: each tier (1-7) gives a 12% chance of FREE tilling AND shaves
// floor(tier/3) energy off the base 2-cost (floored at 1). Tier 7 ≈ 84% free
// + 1 energy when not free (avg ~0.16 per till). `rng` is injected so tests
// can hold the roll fixed.
function effectiveTillCost(relics, rng) {
  const eq = relics?.hoe;
  const base = ENERGY_COST.till;
  if (!eq) return base;
  const random = rng || Math.random;
  if (random() < eq.tier * 0.12) return 0;
  return Math.max(1, base - Math.floor(eq.tier / 3));
}
// Tool work-wheel duration. Bare hands take 10s; a wood tool of the right
// kind (slot='pick' / 'axe') brings it to 3s, and each tier shaves another
// 750ms (floored at 500ms). Iron pick (tier 3) clears rockfruit in 1.5s;
// frost axe in 0.5s. pickDurationMs is kept as a back-compat alias.
function toolDurationMs(relics, slot) {
  const eq = relics?.[slot];
  if (!eq) return 10000;
  return Math.max(500, 3000 - (eq.tier - 1) * 750);
}
function pickDurationMs(relics) { return toolDurationMs(relics, 'pick'); }
// Ring relic: +5% per tier to upgrade loot tier (1→2 or 2→3) on chests.
function ringTierBoost(relics) {
  return relics?.ring ? 0.05 * relics.ring.tier : 0;
}
// Amulet relic: +10% per tier chance to double the chest quantity.
// Amulet relic: powers ghost mode. The slot's only job is to unlock the
// pad and to scale how aggressive the projection can be — speed climbs to
// 3× of the baseline at frost tier; per-cell energy cost falls to 15%.
//   ghostSpeedMul   tier 1 → 8× walk, tier 7 → 24× walk (linear).
//   ghostEnergyCost tier 1 → 1.0 / cell, tier 7 → 0.15 / cell (linear).
// Both return 0 when no amulet is equipped — callers treat that as "ghost
// mode unavailable".
function ghostSpeedMul(relics) {
  const t = relics?.amulet?.tier || 0;
  if (!t) return 0;
  return 8 * (1 + (t - 1) / 3);
}
function ghostEnergyCost(relics) {
  const t = relics?.amulet?.tier || 0;
  if (!t) return 0;
  return 1 - (t - 1) * (0.85 / 6);
}
// Sword relic: scales sell price from 0.5 × base (no sword) to 1.0 × base at
// tier 7 (frost sword sells at par with the listed PRICES[]). Note that
// callers floor at $1 with Math.max(1, ceil(...)), so low-value items like
// $1 longgrass show no sword benefit — the multiplier kicks in noticeably
// above ~$4 produce.
function sellMultiplier(relics) {
  const t = relics?.sword?.tier || 0;
  return 0.5 + (t / 7) * 0.5;
}
// Bow / Staff relics: shrink the random buy-cash markup. Without either, the
// trader still wants 1.2..3.0× base. At tier 7 the markup collapses to 1.0×
// (the player buys at par). Take the BEST tier of bow vs staff.
function buyMarkupRange(relics) {
  const t = Math.max(relics?.bow?.tier || 0, relics?.staff?.tier || 0);
  const f = 1 - t / 7;   // 1 → 0 as tier rises
  return { lo: 1 + 0.2 * f, hi: 1 + 2.0 * f };
}

// === Per-crop loot tier config (used by chests + treasure marks) ===
// T1 common (10 seeds/chest default yield), T2 uncommon (5), T3 rare (2).
// Sourced from BASE_TIER so rarity stays single-source. The legacy callers
// (loot.js pickLoot, REG tests) keep working unchanged.
const SEED_TIER = Object.fromEntries(
  Object.keys(CROP_ROW).map(c => [`${c}_seed`, BASE_TIER[c] || 1])
);
// Flowers — used by the 'flora' chest category to restrict its T3 picks.
const FLOWER_SEEDS = new Set(['iceflower_seed', 'fireflower_seed', 'sunflower_seed']);
