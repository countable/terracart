// Item & crop registry: all per-crop config, item definitions, prices, and
// the inventory-icon resolver. Extracted from app.js so the catalog lives
// in one place and changes to the crop roster don't require editing logic.
//
// Depends on:
//   nothing external. Pure data + a small lookup helper. Must load BEFORE
//   loot.js (tierInfo falls back to SEED_TIER for raw seed ids) and app.js.
//
// Exports as globals:
//   CROP_ROW, MAX_GROWTH_STAGE, PRODUCE_COL, SEEDBOX_COL, CROPS_SHEET_COLS
//   SPRING_CROPS_COLS, CROP_SPRITE, inventoryIconSource
//   CROP_NAMES, ITEMS, ITEM_BY_ID
//   PRICES, BUY_LIST, STARTING_MONEY
//   SEED_TIER  (loot tier config; co-located with the crops it describes)

// Crops sheet (assets/Objects/Crops.png, 9 cols x 16 rows of 16x16 cells).
// Each crop = 1 row. In-world growth: col 0 (sprout) → col 4 (harvestable).
// Inventory icons: col 7 = produce, col 8 = seed.
const CROP_ROW = {
  rainberry: 0, pairy: 1, gemfruit: 2, nut: 3, rockfruit: 4, coffee: 5,
  potato: 6, iceflower: 7, fireflower: 8, sunflower: 9,
  // Spring Crops residents — their on-sheet row is overridden in CROP_SPRITE
  // below (springcrops row 1/3/7). The CROP_ROW value here is just the
  // unused index in Crops.png that the fallback path would use; never
  // actually reached because CROP_SPRITE intercepts first.
  berry: 10, cress: 11, onion: 12,
  // tree + shrub are no longer crops — chopping a tree / harvesting a
  // shrub now drops the 'wood' mineral item directly. The world-object
  // 'tree' and wildplant 'shrub' kinds in worldgen.js still exist as
  // map features; only the harvested inv id changed.
};
const MAX_GROWTH_STAGE = 4; // cols 0..4 inclusive: 5 stages, 4 waterings to mature
const PRODUCE_COL = 7;
const SEEDBOX_COL = 8;
const CROPS_SHEET_COLS = 9; // Crops.png is 9 cols wide

// Per-crop sprite override. Crops listed here use Spring Crops.png (14×8 of 16×16,
// 224×128 total) instead of Crops.png. Spring Crops layout on each crop's row:
//   col 0  = "just planted" / stage 0 (in-world growth sprite)
//   cols 1-4 = growth stages 1..4 (4 = mature, harvestable)
//   col 7  = seed INVENTORY icon, col 8 = produce INVENTORY icon
// (the seed/produce *inventory* columns are 7/8 — see inventoryIconSource;
// don't confuse col 0's in-world stage-0 sprite with the col-7 seed icon.)
const SPRING_CROPS_COLS = 14;
const CROP_SPRITE = {
  potato: { sheet: 'springcrops', row: 5 },
  berry:  { sheet: 'springcrops', row: 1 },   // strawberry-style red fruit bush
  cress:  { sheet: 'springcrops', row: 3 },   // spoon-leaf watercress
  onion:  { sheet: 'springcrops', row: 7 },   // brown bulb with green tops
  // Long grass — item id 'longgrass', display name 'Long grass'. Props.png
  // is a 22-col grid; frame (col 11, row 1) 1-indexed = col 10 row 0
  // 0-indexed = 0*22 + 10 = 10. Renders as leafy green fronds at the
  // wildplant scale. scale 1.16 (down 15% from 1.36) — the tuft was reading
  // oversized against neighbouring one-cell props.
  longgrass: { sheet: 'props', custom: true, frame: 10, scale: 1.16 },
  // Shrub — round lush bush from bushes.png (144×288 = 3×9 of 48×32 frames).
  // Frame 0 is the top-left large green bush. Scale 0.667 renders the 48px-wide
  // frame at 32px (one cell). Replaces the old bare-twig Props.png frame 120.
  shrub:     { sheet: 'bushes', custom: true, frame: 0, scale: 0.667 },
  // Mushroom uses Props.png (22 cols × 12 rows of 16×16 frames). Frame
  // (col=13, row=1) → index 1*22 + 13 = 35 is the small red-cap toadstool
  // sized to fit a single cell. (The cell one column to its right, frame
  // 36, was the original pick but turned out to be a different prop that
  // looked half-clipped at wildplant scale.) The previous Fantasy Mushroom
  // sheet was 32×32 frames rendered at the wildplant scale of 2 → 64×64
  // display, twice the footprint of every other ground prop, which read
  // as a giant broken-looking mushroom on commercial/industrial plots.
  // scale 1.36 (1.7 — itself down 15% from the wildplant default of 2 — then
  // a further 20% off, Sep 2026 playtest) renders the 16px frame at ~22px —
  // the toadstool reads as a prop tucked in its tile rather than one filling
  // it edge to edge. Origin stays (0.5, 0.5) in the planted pass, so it
  // shrinks about the cell centre and stays centred.
  // `caveFrames`: the look of a mushroom spawned UNDERGROUND (worldgen.js
  // spawnCaveMushrooms stamps `_cave` on the wildplant) — the two blue
  // luminous caps on Props.png row 5, cols 17..18 (5*22+17, 5*22+18), picked
  // per cell off the same stable hash the variant sheets use. Same crop,
  // same Mushroom item when picked; only the art (and its glow, see
  // Lighting.KINDS.mushroom) says it grew in the dark. The inventory icon
  // stays `frame`.
  mushroom: { sheet: 'props', custom: true, frame: 35, scale: 1.36, caveFrames: [127, 128] },
  // Shell — 12 variants in shell_sheet (3×4 of 16×16). Each spawned shell
  // sets ._variant from a stable hash of its cell coords so the same cell
  // always renders the same shell, and the beach reads as a varied mix.
  shell: { sheet: 'shell_sheet', custom: true, variants: 12 },
  // ── Rare wild flora ── prized foraged flowers. Each is a distinct
  // single-cell flower frame off Props.png (22-col grid; frame = row*22 + col).
  // They spawn sparsely on a matching biome (see the per-biome flora in
  // src/biome_profiles.js) and pick like any wildplant. scale 1.13 (down 15%
  // from 1.33) renders the 16px frame at ~18px — blooms read as small foraged
  // flowers tucked in the tile rather than filling it (the default scale 2 /
  // full-cell was 50% too big, and 1.33 was still crowding its neighbours).
  forgetmenot: { sheet: 'props', custom: true, frame: 76,  scale: 1.13 },  // blue forget-me-not cluster (row 3, col 10)
  marigold:    { sheet: 'props', custom: true, frame: 34,  scale: 1.13 },  // golden marigold (row 1, col 12)
  wildrose:    { sheet: 'props', custom: true, frame: 30,  scale: 1.13 },  // red wild rose (row 1, col 8)
  starflower:  { sheet: 'props', custom: true, frame: 102, scale: 1.13 },  // glowing purple star-flower (row 4, col 14)
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
  // Wood — frame 2 of the 3-variant log sheet (amber bark variant).
  wood:     { sheet: 'wood',      frame: 2 },
  coal:     { sheet: 'coal_icon', frame: 0 },
  sapphire: { sheet: 'gems',      frame: 4 },   // blue gem
  ruby:     { sheet: 'gems',      frame: 0 },   // red gem
  emerald:  { sheet: 'gems',      frame: 3 },   // green gem
  // Bars from the 16-col Extras 'Bars and ores' sheet (16px frames, 16
  // cols × 4 rows). The sheet is NOT one bar per frame: each row packs two
  // metals as bar/ore PAIRS — col0 barA, col1 oreA, col2 barB, col3 oreB,
  // cols4-7 white-outlined duplicates, cols8-11 raw stone. So the actual
  // ingots sit at col0/col2 of rows 0-2: copper 0, iron 2, gold 16,
  // platinum 18, crimson 32, frost 34. (The old 0..5 run rendered copper
  // bar, then copper/iron ORE nuggets and outlined dupes.)
  copper_bar:   { sheet: 'bars', frame: 0 },
  iron_bar:     { sheet: 'bars', frame: 2 },
  gold_bar:     { sheet: 'bars', frame: 16 },
  platinum_bar: { sheet: 'bars', frame: 18 },
  crimson_bar:  { sheet: 'bars', frame: 32 },
  frost_bar:    { sheet: 'bars', frame: 34 },
  // Animal produce — Chicken Egg.png / Small Cow Milk.png are 32×16 each.
  egg:      { sheet: 'icon_egg',  frame: 0 },
  milk:     { sheet: 'icon_milk', frame: 0 },
  // Orchard fruit — Food Icons/<species>.png, 32×16 each (frame 0 = the
  // whole fruit, frame 1 a slice / cooked variant).
  apple:    { sheet: 'icon_apple',   frame: 0 },
  cherry:   { sheet: 'icon_cherry',  frame: 0 },
  peach:    { sheet: 'icon_peach',   frame: 0 },
  mango:    { sheet: 'icon_mango',   frame: 0 },
  apricot:  { sheet: 'icon_apricot', frame: 0 },
  banana:   { sheet: 'icon_banana',  frame: 0 },
  orange:   { sheet: 'icon_orange',  frame: 0 },
  coconut:  { sheet: 'icon_coconut', frame: 0 },
  // Fish — Icons/Fish/<*>.png, 64×16 (4 frames). frame 0 = right-facing fish.
  // No standalone minnow art; reuse the smallmouth-bass icon for it.
  minnow:     { sheet: 'icon_minnow',     frame: 0 },
  bass:       { sheet: 'icon_bass',       frame: 0 },
  trout:      { sheet: 'icon_trout',      frame: 0 },
  salmon:     { sheet: 'icon_salmon',     frame: 0 },
  goldenfish: { sheet: 'icon_goldenfish', frame: 0 },
  // Junk pull from fishing — brown leather boot at row 6 col 4 of
  // 7_Pickup_Items_16x16 (renamed Pickup_Items.png in Objects/). Frame =
  // 6 * 14 + 4 = 88.
  boot:       { sheet: 'pickup',         frame: 88 },
  // Consumables — honey is a single 16×16 jar (Icons/Items/Honey.png, an
  // amber fill of the potion pack's empty flask); books are a 240×64
  // multi-frame sheet, frame 0 the basic variant.
  honey:      { sheet: 'icon_honey',  frame: 0 },
  book:       { sheet: 'icon_book',   frame: 0 },
  // Potion of Reach — single-frame 16×16 glowing flask (Icons/Items).
  reach_potion: { sheet: 'icon_potion', frame: 0 },
  // New potions — 16×16 frames from Potions.png (5 cols × 7 rows).
  // Row 2 (y=32): frame 11=green (vigor), 12=red (speed), 13=purple (shield).
  vigor_potion:  { sheet: 'icon_potions', frame: 11 },
  speed_potion:  { sheet: 'icon_potions', frame: 12 },
  shield_potion: { sheet: 'icon_potions', frame: 13 },
  // Dragon Powder — the vivid crimson pouch (row 1 col 2 = frame 7). Using it
  // turns you into a red dragon (useDragonPowder in app.js).
  dragon_powder: { sheet: 'icon_potions', frame: 7 },
  // Rope — single 16×16 coiled-rope icon (Icons/Items, hand-drawn like the
  // honey jar). Using it moves the player up or down one cave level in place
  // (useRope in app.js).
  rope:          { sheet: 'icon_rope', frame: 0 },
  // Wilderness drops — meat is beef, rabbit_pelt uses one of the colour
  // variants, crow_feather uses the chicken-feather sheet's first frame.
  meat:         { sheet: 'icon_meat',    frame: 0 },
  rabbit_pelt:  { sheet: 'icon_pelt',    frame: 0 },
  crow_feather: { sheet: 'icon_feather', frame: 0 },
  // Beach pickup — Icons/Fish/Sea/Creatures/Shell.png is a 12-frame variant
  // sheet; frame 0 is the canonical cowrie used for the inventory icon.
  shell:        { sheet: 'shell_sheet', frame: 0 },
  // Wild flowers ('flowers' produce) — props.png (22 cols × 12 rows of 16×16).
  // Frame 12 (col 12, row 0) is the pink blossom. Like egg/milk it has no
  // crop/grows key, so without this entry inventoryIconSource returned null
  // and the house delivery callout (and inventory) rendered a bare '·'
  // placeholder instead of the flower art.
  flowers:      { sheet: 'props',       frame: 12 },
  // Fruit-tree saplings — the young-tree frame off the species sheet (32px
  // frames; frame 2 = the small young green tree) reads as a sapling.
  apple_sapling: { sheet: 'apple_tree', frame: 2 },
  peach_sapling: { sheet: 'peach_tree', frame: 2 },
  // Discovery badge — the gold five-point star at row 8 col 4 of
  // 7_Pickup_Items (frame 8 * 14 + 4 = 116). Same sheet as the boot.
  discovery:     { sheet: 'pickup',     frame: 116 },
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
    // Custom sheets (longgrass→props, mushroom→mushroom_world, shell→
    // shell_sheet). ov.frame is honoured so sheets with multiple cells
    // (e.g. mushroom_world whose frame 0 is empty) can point at the right
    // cell. Shells use the variants path in the renderer.
    return { sheet: ov.sheet, frame: ov.frame ?? 0 };
  }
  // Generic seed bag = col SEEDBOX_COL, row 15 of crops.png (== 15*9 + 8 = 143).
  if (item.kind === 'seed') return { sheet: 'crops', frame: 15 * CROPS_SHEET_COLS + SEEDBOX_COL };
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
  rockfruit: 'Rock', coffee: 'Coffee', potato: 'Potato', iceflower: 'Iceflower',
  fireflower: 'Fireflower', sunflower: 'Sunflower',
  berry: 'Berry', cress: 'Cress', onion: 'Onion',
};
// === Per-item rarity tier (1..7) — used by rarity.js' unified picker. ===
// Tier reflects relative rarity / value, not stage / yield. A seed and its
// produce share a tier. Wild fauna and minerals climb with gem ladder. New
// items SHOULD get a baseTier; rarity.js defaults missing entries to 1.
const BASE_TIER = {
  // Crops (same tier for seed & produce; the seed id uses the suffix).
  // Spread across all four chest tiers.
  potato: 1, rockfruit: 1,
  // Spring Crops kitchen-garden — berry + cress are T1 starter produce;
  // onion bumped to T2 (per user) since it's a richer flavour and reads
  // as a step-up from the basic greens.
  berry: 1, cress: 1,
  rainberry: 2, pairy: 2, nut: 2, onion: 2,
  // wood: T1 mineral. Dropped by trees + shrubs (no tools needed beyond
  // an axe for shrubs / trees) and sprinkled around the starting area.
  // Used as the smithy ingredient for every T1 wooden tool.
  wood: 1,
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
  longgrass: 1, flowers: 1, mushroom: 1, boot: 1,
  // Rare wild flora — foraged flowers, climbing from meadow-common
  // (forget-me-not) to the glowing starflower (rarest). Tier drives the
  // shiny-find bonus and loot-value scaling.
  forgetmenot: 2, marigold: 3, wildrose: 3, starflower: 5,
  egg: 1, milk: 2,
  // Fish (rarity ramps fast — goldenfish is the late-game catch)
  minnow: 1, bass: 2, trout: 3, salmon: 4, goldenfish: 6,
  // Orchard fruit (apple/cherry/peach/apricot ~ mid-low; coconut/banana late).
  // Mango is no longer an orchard tree — it's a rare universal tame treat
  // (see interact.js) — but still carries a rarity tier for loot/pricing.
  apple: 2, cherry: 2, peach: 2, apricot: 2,
  orange: 3, mango: 3,
  banana: 4, coconut: 4,
  // Plantable fruit-tree saplings — common apple (T3), rare peach (T5).
  apple_sapling: 3, peach_sapling: 5,
  // Live animals
  chicken: 1, dog: 1, rabbit: 1,
  cat: 2, butterfly: 2,
  crow: 3,
  deer: 4,
  cow: 5,
  // Consumables
  honey: 2, book: 2, reach_potion: 2, vigor_potion: 2, speed_potion: 2, shield_potion: 2,
  dragon_powder: 3,
  // Rope — a T2 utility like the potions: one climb up or down a level.
  rope: 2,
  // Minerals — coal floor, gem ladder mirrors mining rarity
  coal: 1,
  meat: 2, rabbit_pelt: 2,
  crow_feather: 3,
  sapphire: 4, ruby: 5, emerald: 6,
};

// NOTE: items carry NO `icon` (emoji) field — items always render as their
// game-art sprite via renderItemIcon on every surface (map / inventory / shop /
// toast / house sign). Emoji is reserved for non-item UI only. See
// docs/QC_RULES.md §1. (Gear in RELIC_DEFS / ARMOR_DEFS keeps an `icon:` field,
// but that's a PNG filename for gearAssetPath — not an emoji.)
const ITEMS = [
  ...Object.keys(CROP_ROW).map(c => ({
    id: `${c}_seed`, name: `${CROP_NAMES[c]} Seed`, kind: 'seed', grows: c,
    baseTier: BASE_TIER[c] || 1,
  })),
  ...Object.keys(CROP_ROW).map(c => ({
    id: c, name: CROP_NAMES[c], kind: 'produce', crop: c,
    baseTier: BASE_TIER[c] || 1,
  })),
  // Caught creatures stack in the inventory. Catching any wild animal —
  // including wilderness fauna (deer, rabbit, crow, butterfly) — puts the
  // live animal here; processing into meat / pelt / feather is a separate
  // step downstream.
  { id: 'chicken',   name: 'Chicken',   kind: 'animal' },
  { id: 'cow',       name: 'Cow',       kind: 'animal' },
  { id: 'cat',       name: 'Cat',       kind: 'animal' },
  { id: 'dog',       name: 'Dog',       kind: 'animal' },
  { id: 'deer',      name: 'Deer',      kind: 'animal' },
  { id: 'rabbit',    name: 'Rabbit',    kind: 'animal' },
  { id: 'crow',      name: 'Crow',      kind: 'animal' },
  { id: 'butterfly', name: 'Butterfly', kind: 'animal' },
  // Shiny (rare, 5%) animal variants — caught from yellow-tinted wild animals.
  // Each shiny kind keeps its OWN inventory stack: a shiny chicken never
  // folds into normal chickens, nor into other shiny animals ("not other
  // shinys"). `base` points at the plain kind so the icon + release path can
  // reuse the normal sprite/behaviour; `shiny` flags the shiny sheen. Only
  // the catch-into-inventory kinds get a shiny item — hunted fauna (deer,
  // crow) drop meat/feather, so there's no live shiny animal to keep.
  ...['chicken', 'cow', 'cat', 'dog', 'rabbit', 'butterfly'].map(k => ({
    id: `shiny_${k}`,
    name: `Shiny ${k.charAt(0).toUpperCase() + k.slice(1)}`,
    kind: 'animal', base: k, shiny: true, baseTier: BASE_TIER[k] || 1,
  })),
  // Animal produce — feed longgrass to a wild chicken / cow to swap the
  // longgrass for an egg / milk. Repeatable until either you run out of
  // longgrass or the animal is caught.
  { id: 'egg',  name: 'Egg',  kind: 'produce' },
  { id: 'milk', name: 'Milk', kind: 'produce' },
  // Wild-only produce — grows in grasslands, picked as debris. Not plantable.
  // Display name 'Long grass'; id stays 'longgrass' for save / loot-table
  // back-compat. The sprite is Props.png's frond frame; in-world + inventory
  // render the baked 'props' frame via ITEM_DATA_URLS.
  { id: 'longgrass', name: 'Long grass', kind: 'produce', crop: 'longgrass' },
  // Wild flower pickups (per-polygon color but stacks as a single item).
  { id: 'flowers', name: 'Flowers', kind: 'produce' },
  // Rare wild flora — prized foraged flowers picked from sparse blooms in
  // grasslands (forget-me-not, marigold) and forests (wild rose, starflower).
  // Wild-only: not plantable, no seed. `crop` points at the CROP_SPRITE frame
  // so inventory / map / shop all draw the same Props.png flower, and the
  // wildplant pick path can roll the shiny-flora sheen on them.
  { id: 'forgetmenot', name: 'Forget-me-not', kind: 'produce', crop: 'forgetmenot' },
  { id: 'marigold',    name: 'Marigold',      kind: 'produce', crop: 'marigold' },
  { id: 'wildrose',    name: 'Wild Rose',     kind: 'produce', crop: 'wildrose' },
  { id: 'starflower',  name: 'Starflower',    kind: 'produce', crop: 'starflower' },
  // Consumables — used on yourself via the Use button that appears below the
  // inventory bar while one is selected (syncConsumableButton in app.js).
  // Honey: set it out to lure wandering chickens + cows within 30m toward
  //        you (eaten, so it's consumed — hence not a flute any more).
  // Book:  reveals a play tip or a directional hint to a nearby chest.
  { id: 'honey', name: 'Honey', kind: 'consumable' },
  // dropWeight 3: a Book is THE documentation (see PLAY_TIPS below), so it is
  // the one consumable that has to turn up often enough to be read. At an even
  // draw it was one of seven T2 consumables — a sliver of an already-thin
  // consumable share — and a player could finish a session having never met
  // one. Three makes it the plurality of the T2 consumable pool everywhere,
  // and school chests pin it outright on top of that (rarity.js
  // 'chest:school'). This is the one item whose SCARCITY is a documentation
  // bug rather than a balance choice.
  { id: 'book',  name: 'Book',  kind: 'consumable', dropWeight: 3 },
  // Potion of Reach: drink it (Use button with it selected) to light up
  // the whole screen — full-range reach for 1 minute, regardless of energy.
  { id: 'reach_potion',  name: 'Potion of Reach',     kind: 'consumable' },
  { id: 'vigor_potion',  name: 'Potion of Vigor',     kind: 'consumable' },
  { id: 'speed_potion',  name: 'Potion of Speed',     kind: 'consumable' },
  { id: 'shield_potion', name: 'Potion of Shielding', kind: 'consumable' },
  // Dragon Powder: use it (Use button with it selected) to wear a red dragon
  // for one minute — a tier-8 amulet's legs on the movement stick AND 2× attack
  // damage (useDragonPowder in app.js). A stat buff, not a movement mode.
  { id: 'dragon_powder', name: 'Dragon Powder',       kind: 'consumable' },
  // Rope: use it (Use button with it selected) and the dialog asks which way —
  // climb UP a level or lower yourself DOWN one — right where you stand, no
  // staircase needed. One rope per climb. Unlike the sapphire portal it goes
  // both ways, so it is also the way out of a dead-end dig (useRope in app.js).
  { id: 'rope',          name: 'Rope',                kind: 'consumable' },
  // Wild forest fauna drops — produced when a live caught animal is
  // processed (a future butcher / blacksmith step). Catching itself yields
  // the animal, not these.
  // ('butterfly' lives above as the live-animal entry — there is no
  // separate butterfly product; the insect itself is the drop.)
  // Animal byproducts — kind: 'produce' alongside egg / milk. Sit in the
  // produce pool of the rarity picker, not the mineral pool (which is
  // reserved for coal / gemstones).
  { id: 'meat',         name: 'Meat',         kind: 'produce' },
  { id: 'rabbit_pelt',  name: 'Rabbit Pelt',  kind: 'produce' },
  { id: 'crow_feather', name: 'Crow Feather', kind: 'produce' },
  // Beach pickup — shells spawn as wildplant debris on sand cells
  // (DEBRIS_CROP[2] = 'shell' in worldgen.js). 12 visual variants in
  // shell_sheet, hashed off the spawn cell coord.
  { id: 'shell',        name: 'Shell',        kind: 'produce', crop: 'shell' },
  // Fishing junk pull — old leather boot. T1, low sell, no eat. Joke drop
  // from the rod's loot table at small weight; mostly a flavour moment.
  { id: 'boot',         name: 'Old Boot',     kind: 'produce' },
  // Scarecrow — placeable on tillable cells. Wild crows and deer steer
  // around it (4-cell aversion radius in wanderCreatures). Stack of N can
  // be deployed across the farm.
  { id: 'scarecrow',    name: 'Scarecrow',    kind: 'consumable' },
  // Wild mushroom (forest debris, pickable)
  { id: 'mushroom',     name: 'Mushroom',     kind: 'produce', crop: 'mushroom' },
  // Discovery badge — earned once per discoverable KEY (app.js _bankDiscovery:
  // a shiny type found, an elite monster kind slain, a household's first
  // delivery), spent at the wizard tower on Inner Lights. Lives as a normal
  // inventory stack so
  // the player can see / count their badges, but it's deliberately walled off
  // from the rest of the economy:
  //   kind 'badge'    → in no rarity.js classBias, so chests / shops / traders /
  //                     deliveries never roll it (the Items tab lists the kind).
  //   capExempt       → inventory.js ignores the bag stack-cap; a badge is
  //                     irreplaceable (one per type, ever), so "bag full" must
  //                     never eat one.
  //   noSell          → the home sell modal refuses it; only the wizard trades
  //                     in Discovery. No PRICES entry keeps it out of barter asks.
  { id: 'discovery',    name: 'Discovery',    kind: 'badge', capExempt: true, noSell: true },
  // Fish (caught by Fishing Rod on water tiles). dropWeight: 0.4 trims their
  // share within the (produce, tier) pool so chest loot reads as mostly crops
  // and fruit, with fish as an occasional aquatic surprise rather than the
  // dominant produce drop at higher tiers.
  { id: 'minnow',     name: 'Minnow',     kind: 'produce', crop: 'minnow',     dropWeight: 0.4 },
  { id: 'bass',       name: 'Bass',       kind: 'produce', crop: 'bass',       dropWeight: 0.4 },
  { id: 'trout',      name: 'Trout',      kind: 'produce', crop: 'trout',      dropWeight: 0.4 },
  { id: 'salmon',     name: 'Salmon',     kind: 'produce', crop: 'salmon',     dropWeight: 0.4 },
  { id: 'goldenfish', name: 'Goldenfish', kind: 'produce', crop: 'goldenfish', dropWeight: 0.4 },
  // Fruit from fruit trees in orchard tiles
  { id: 'apple',   name: 'Apple',   kind: 'produce', crop: 'apple' },
  { id: 'cherry',  name: 'Cherry',  kind: 'produce', crop: 'cherry' },
  { id: 'peach',   name: 'Peach',   kind: 'produce', crop: 'peach' },
  { id: 'banana',  name: 'Banana',  kind: 'produce', crop: 'banana' },
  { id: 'orange',  name: 'Orange',  kind: 'produce', crop: 'orange' },
  // Mango: a rare treat that tames ANY animal (see the creature handler in
  // interact.js). No `crop` ref — it isn't farmed or fed for milk/eggs.
  { id: 'mango',   name: 'Mango',   kind: 'produce' },
  { id: 'coconut', name: 'Coconut', kind: 'produce', crop: 'coconut' },
  { id: 'apricot', name: 'Apricot', kind: 'produce', crop: 'apricot' },
  // Plantable fruit-tree saplings. kind:'sapling' routes the plant action to
  // the fruit-tree growth path (a growing `fruittree` object) rather than the
  // 4-stage crop bed. `grows` is the fruit-tree species. Only two exist: the
  // common apple (T3) and the rare peach (T5).
  { id: 'apple_sapling', name: 'Apple Sapling', kind: 'sapling', grows: 'apple', baseTier: 3 },
  { id: 'peach_sapling', name: 'Peach Sapling', kind: 'sapling', grows: 'peach', baseTier: 5 },
  // Rock-break loot. Coal is common + low value, gems are rare + high value.
  // (Gem types deliberately distinct so high-tier rocks feel like a real find.)
  { id: 'coal',     name: 'Coal',     kind: 'mineral' },
  // Sapphire doubles as a one-shot descent charge: tap the Portal button with
  // it selected to spend one gem and sink straight down a level in place.
  // See useSapphirePortal in app.js.
  { id: 'sapphire', name: 'Sapphire', kind: 'mineral' },
  { id: 'ruby',     name: 'Ruby',     kind: 'mineral' },
  { id: 'emerald',  name: 'Emerald',  kind: 'mineral' },
  // Smelted metal bars — primary forge material at blacksmiths. Dropped
  // by mineralrocks (worldgen.js). One ladder per material tier 2..7;
  // tier 1 (wood) gear is starter-shop only and doesn't need a bar.
  // Display names drop the trailing "Bar" so the inventory + flash text
  // reads as the material itself ("Copper", "Frost") — the bar nature is
  // already conveyed by the sprite. Ids keep the _bar suffix so existing
  // saves + recipe references don't need to migrate.
  // wood is the T1 mineral — chopping a tree or harvesting a shrub drops it,
  // and the starter blacksmith uses it as the sole ingredient for every T1
  // wooden tool. In-world (ground stack + inventory bar) it renders the
  // 'wood' spritesheet via ITEM_DATA_URLS.
  { id: 'wood',         name: 'Wood',     kind: 'mineral' },
  { id: 'copper_bar',   name: 'Copper',   kind: 'mineral' },
  { id: 'iron_bar',     name: 'Iron',     kind: 'mineral' },
  { id: 'gold_bar',     name: 'Gold',     kind: 'mineral' },
  { id: 'platinum_bar', name: 'Platinum', kind: 'mineral' },
  { id: 'crimson_bar',  name: 'Crimson',  kind: 'mineral' },
  { id: 'frost_bar',    name: 'Frost',    kind: 'mineral' },
];
// Fill in baseTier for every entry that didn't set one explicitly (cleaner
// than threading the lookup through each literal above). Anything missing
// from BASE_TIER falls back to 1 — that's an authoring oversight worth
// fixing rather than a load-time crash.
for (const it of ITEMS) {
  if (it.baseTier == null) it.baseTier = BASE_TIER[it.id] || 1;
}
const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));

// Shop: tap a house with a selected item to sell it, or with an empty selection
// to buy the next seed in BUY_LIST. Prices are tuned to how easy each item is
// to obtain. Produce range: wild-debris commons at $1, rarest flower
// (iceflower, T6) at $500. The magical-flower ladder follows BASE_TIER —
// sunflower (T4) cheapest, iceflower (T6) dearest — matching the smelting
// pairing (sunflower→Platinum … iceflower→Frost).
//
// EVERY SEED IS PRICED AT MOST A THIRD OF ITS OWN PRODUCE — growing a crop out
// must pay back at least 3x the seed, or the loop isn't worth the tilling/
// watering/waiting. Coffee and the three magical flowers already cleared that
// bar on their own (their seeds are rare/gated goods, not cheap commons) and
// are left as they were. rockfruit is DELIBERATELY EXEMPT: its produce is the
// $1 price FLOOR (wild debris, free to gather off any rock), so a literal 3x
// would need a $0 seed — the $8 seed price stands on its own terms instead
// (it's sold as a stone/building-material commodity, not grown for profit;
// see the rockfruit note under produce below).
const PRICES = {
  // ── Seeds ────────────────────────────────────────────────
  rainberry_seed: 2, pairy_seed: 2, nut_seed: 1, potato_seed: 1,
  berry_seed: 2, cress_seed: 1, onion_seed: 2,
  gemfruit_seed: 8, rockfruit_seed: 8, coffee_seed: 12,
  sunflower_seed: 30, fireflower_seed: 40, iceflower_seed: 50,
  // ── Produce (sell value) ─────────────────────────────────
  rockfruit: 1,    // wild debris in every residential tile — the floor
  nut: 4,
  potato: 5,
  cress: 5,        // T1 kitchen-garden green
  onion: 6,        // T1 kitchen-garden bulb
  rainberry: 6,
  berry: 7,        // T1 sweet — slightly above rainberry
  pairy: 8,
  gemfruit: 25,    // T2 + occasional rockfruit bonus
  coffee: 40,      // T2, no wild source
  sunflower: 150,  // T4 magical flower — commonest of the trio
  fireflower: 300, // T5 magical flower
  iceflower: 500,  // T6 — rarest flower, gates the Frost bar; price ceiling
  // ── Animals ──────────────────────────────────────────────
  chicken: 4,      // 150–250/tile, yields 4 per catch
  cow: 200,        // ~15–30/tile, premium catch
  cat: 35,         // companion animal (wants milk/fish) — modest sale, never eaten
  dog: 35,         // companion animal (wants meat) — modest sale, never eaten
  // ── Wild-only ────────────────────────────────────────────
  longgrass: 1,
  flowers: 2,
  // Rare wild flora — sell value climbs with rarity; the glowing starflower
  // is a premium forage find (between gemfruit and the magical sunflower).
  forgetmenot: 14,
  marigold:    45,
  wildrose:    35,
  starflower: 130,
  shell: 6,        // beach pickup — small collectible
  boot: 2,         // fishing junk — old boot, the joke is finding it

  // ── Animal produce (longgrass-feeding output) ────────────
  egg:  4,
  milk: 18,
  // ── Consumables ──────────────────────────────────────────
  // Bought from shops occasionally; small sell value if you hoard them.
  honey: 12,
  book:  20,
  reach_potion:  45,   // T2 — full-screen reach for 1 min is a strong utility pop
  vigor_potion:  35,   // T2 — instant 40-energy restore
  speed_potion:  55,   // T2 — tier-9 amulet stick-walking for 1 min
  shield_potion: 40,   // T2 — half monster damage for 1 min
  dragon_powder: 120,  // T3 — 1 min of dragon: tier-8 amulet legs + 2× damage
  rope:          25,   // T2 — one climb up or down a level, in place (cheaper than a sapphire's one-way shaft)
  scarecrow: 30,   // crow/deer ward — sold once at the forced scarecrow shop

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
  butterfly: 100,  // premium catch — Bug Net required, so it's worth a lot
  // ── Wild mushroom ────────────────────────────────────────
  mushroom: 8,
  // ── Fish ─────────────────────────────────────────────────
  minnow: 2,    bass: 12,   trout: 40,   salmon: 100, goldenfish: 300,
  // ── Orchard fruit ────────────────────────────────────────
  apple: 8, cherry: 12, peach: 10, banana: 14, orange: 10, mango: 18, coconut: 16, apricot: 10,
};
// Canonical "sell value" of an item. Used for the shiny-find money bonus
// (10× this) and as a value fall-through. Items with no explicit PRICES entry
// (e.g. live animals) fall back to a tier-scaled ladder so the bonus still
// scales with how prized the thing is rather than flattening to $1.
const TIER_VALUE = [0, 2, 8, 25, 70, 160, 360, 800];
function itemValue(id) {
  if (PRICES[id] != null) return PRICES[id];
  const t = ITEM_BY_ID[id]?.baseTier || 1;
  return TIER_VALUE[t] || TIER_VALUE[TIER_VALUE.length - 1];
}
// Shiny animals sell at 10× their plain counterpart's value — a real prize in
// the bag, on top of the catch-time money + discovery bonus.
for (const k of ['chicken', 'cow', 'cat', 'dog', 'rabbit', 'butterfly']) {
  PRICES[`shiny_${k}`] = itemValue(k) * 10;
}
// Seeds houses/traders rotate through for sale. Magical flower seeds (T4+:
// sunflower / fireflower / iceflower) are deliberately EXCLUDED — they're the
// gateway to the most valuable crops and the T5+ smelting ladder, so they must
// be FOUND (flora chests, rare trader/fort rolls via the rarity picker), not
// bought on tap at any house.
const BUY_LIST = Object.keys(CROP_ROW)
  .filter(c => (BASE_TIER[c] || 1) <= 3)
  .map(c => `${c}_seed`);
const STARTING_MONEY = 50;

// === Energy / food ===
// Player starts at STARTING_ENERGY; armor pieces raise the maximum (see ARMOR_DEFS
// below). Eating food restores energy by FOOD_ENERGY[id]. Actions like rock-break,
// till, and harvest deduct energy via ENERGY_COST and refuse when the current
// pool is too low.
// === Book of Tips ============================================
// Non-obvious play tips revealed when the player uses a Book consumable.
//
// WHAT DOES *NOT* BELONG HERE: what a single item or relic DOES. That is the
// item's own description — ITEM_EFFECTS below (the "✦ …" line under the
// selected stack) for a consumable or material, RELIC_DEFS.blurb (the same
// line for a relic, plus the Stats panel's per-slot row) for a relic, the Eat
// button's "+N⚡" for a food, and the Stats panel's "+N max energy" for armour.
// The player reads those while HOLDING the thing, exactly when the answer is
// wanted; a Book that restates them spends a consumable to tell you something
// the inventory bar was already showing, and the two copies then drift apart.
// Until Sep 2026 a third of this list was that — the Rope tip and
// ITEM_EFFECTS.rope said the same sentence twice, the Hoe tip was its blurb
// verbatim, and one tip explained what a Book does, which you could only read
// by burning a Book. When a tip and a description overlap, the description
// wins and the tip goes.
//
// What a tip IS for: knowledge no single item can carry — where things grow,
// how a shop or a gate behaves, what an animal wants, what a screen readout
// means, and the odd riddle pointing at a secret.
// The Book handler in interact.js mixes ~50% of these with ~50% directional
// chest hints (computed live from the nearest unopened chest).
// Ordered roughly by relevance to a NEW player: the first-hour basics
// (energy, resting, selling, your tools) come first, then the farming loop,
// exploration, the caves, shops and the progression gates, then relic
// effects, consumables, world lore, animals, and finally the rare secret.
// A Book read still picks one at random, but curating the order keeps the
// list readable and front-loads what a beginner most needs.
//
// EVERY tip here is a claim about live behaviour — when a mechanic changes,
// the tip that describes it has to change with it, or the Book starts lying
// to the player. Cross-check against: energy.js (rest + the first-taste cap),
// coords.js (reach), crops.js (growth), combat.js (weapons, HP, the health
// BAR), traps.js (the snares), quests.js (the castle board), delivery.js
// (wishlists), shops_math.js (deal caps + stall prices), rarity.js
// (chest/shop tables), loot.js (chest tiers, the Home demotion), gear.js
// (recipes), interactables.js (the slow grind, mining gates), items.js above
// (foods, relics, animal foods), interact.js (taming / hunting / placeables)
// and worldgen.js (biomes, caves).
//
// THE OTHER HALF OF THE RULE: a mechanic the player cannot discover by
// looking at it — a derived number, a gate, a side-effect, a place that
// behaves differently — and that NO single item's description can carry,
// belongs here. The prune above deleted the tips that were restating an
// item; it must not become a licence to leave the rest undocumented. The Sep
// 2026 audit found the first-taste energy cap, the slow grind, the reach the
// dark takes back, the snares, giants, the coin a kill pays, the chest Home
// rings, the delivery premium, the quest board and the stall discount all
// live in the code and nowhere a player could read them. When you add a
// mechanic of that shape, add its tip.
//
// And a tip nobody draws is a tip nobody has. The Book carries a dropWeight
// (see its catalog entry above) so it is the plurality of the T2 consumable
// pool everywhere, and the places of learning — POI_CATEGORY 'school' in
// loot.js, pinned through rarity.js 'chest:school' — hand one over from about
// a third of their chests. That is what makes this list worth keeping honest.
const PLAY_TIPS = [
  // ── First-hour basics ─────────────────────────────────────
  'Actions cost energy. Eat to refill — or just rest; an hour away from the game hands the whole bar back.',
  'Only your OWN home rests you — a full bar in ninety seconds. A stranger\'s roof is just a roof.',
  'Resting stops while a work wheel turns. A job done on the doorstep still costs what it costs; the sit-down afterwards is what earns it back.',
  'Every new food you taste for the first time raises your maximum energy by one, for good.',
  'Selling is home-only. Carry your haul back to your trailer, select a stack, and tap it to cash out.',
  'Every tool works bare-handed — just slowly. A Wood relic is twice as quick, a Frost one thirty times.',
  'A job one tier past your equipment is not refused outright: you can grind it out for 15⚡ and half a minute. Two tiers short is a flat no.',
  'How far you can touch is your own light: nothing at all on an empty bar, and half a cell less for every level you descend.',
  // ── The farming loop ──────────────────────────────────────
  'A watered crop climbs one stage every 15 minutes, even while you\'re away — then it wants watering again.',
  'A ripe crop pays one to three of itself, and about one pick in four hands a seed back as well.',
  'Tilling refuses a cell holding a wildplant, rock, or building.',
  'Crows raid ripe crops but never touch potatoes.',
  'A wild slime beside you drains 3 energy a second. Kill it, walk away, or stand by a fire — they will not come near one.',
  // ── Exploration / chests ──────────────────────────────────
  'Treasure X marks are buried in car parks — every parking lot hides one.',
  'The gem above a chest is its tier. Gemless chests never hold relics; only the violet and the gold ones reach Frost.',
  'Chests near home are humbler: a tier down within 700m of your trailer, two within 350m. The prizes are a walk away.',
  'Every new kind of thing you discover banks a Discovery badge. Only the wizard values those.',
  'A shiny flower or tree is worth ten times the money, and banks a Discovery badge with it.',
  'One stone in ten gathered off the ground hides a gemfruit.',
  'Snares lie hidden on the verges beside roads, and around the stairs underground. Treading on one bites 10⚡; standing on a sprung one bleeds 2 a second, so step off rather than wait it out.',
  // ── Underground ───────────────────────────────────────────
  'Tap a staircase to go down. Barely a tenth of surface rock bears ore — underground, half of it does.',
  'A cave wall mines out like any rock, bare-handed, and the passage you dig stays open.',
  'Ore wants a pickaxe one tier under what it holds, and every tier it out-tiers yours adds 9⚡ to the swing.',
  'Gems come only out of the deeper stone: sapphire from gold, ruby from platinum, emerald from crimson and frost.',
  'Goblins hold the deep — level 2 and below. By level 3 their archers shoot from three cells off.',
  'Every monster has a giant form: four times the health, met two levels below its ordinary kind.',
  'Some cave clusters are veins: one ore tier concentrated tenfold. Work the whole seam once you strike it.',
  'A chest mirrored underground climbs a tier every two levels down, to a gold gem no surface chest ever wears.',
  // ── Shops / trade ─────────────────────────────────────────
  'A house numbered ending in 9 is a Blacksmith — it forges your gems and bars into relics.',
  'The first wreck you rebuild becomes your own smithy, and it will beat out a wooden pickaxe, axe or hoe for 5 wood apiece.',
  'Addresses ending 2 or 6 are Produce Shops, stocked with crops. Endings 1 and 8 are Traders, who barter only.',
  'Plain houses sell nothing. Each posts a wishlist of produce and pays half again what the same goods would fetch sold loose.',
  'A household never changes its mind about what it wants — but it will take the same bundle again the next day.',
  'Every 20 deliveries behind you, the houses you rebuild from then on start asking for the next tier of crop.',
  'Forts handle up to 5 deals per hour, plain houses just 1. Castles and towers never make you wait.',
  'Castles deal only in relics — and never run out of stock.',
  'A roadside stall undercuts the listed price, and the finer your sword the smaller that discount gets — there is no buying cheap from one and selling on at a profit.',
  // ── Progression gates ─────────────────────────────────────
  'A ruined house can be rebuilt: 5 wood for a plain one, 5 stone for a produce shop, trader or smithy.',
  'Forts are sealed until you pay the quartermaster in wood — 6 for your first, rising by 6 up to 30.',
  'A castle vault stays shut until you have deliveries behind you: 2 for the first castle, rising to 5.',
  'The wizard trades 5 Discovery badges for an Inner Light — another half-cell of reach, out to 5.5.',
  'No shop, smithy or castle vault deals in Rings. The wizard\'s Inner Light is what puts one on your hand.',
  'The castle board always holds three jobs, and each castle offers only one of them: the next castle along has different work.',
  'A castle job grows with the number you have already finished, and so does the purse it pays.',
  'Platinum, Crimson and Frost bars are smelted from a magical flower and the bar below it — or prised out of the rarest deep rock, if your tools are nearly its equal.',
  'No shop stocks sunflower, fireflower or iceflower seeds. The magical flowers have to be found.',
  // ── Reading the screen ────────────────────────────────────
  'The bar over a foe is its health, not a timer — green, then amber, then red.',
  'The ring around a thing you are working on is the wheel, and it is a different readout entirely: it says how far along the job is, never how hurt anything is.',
  // ── Fighting ──────────────────────────────────────────────
  'Only one weapon is ever in play. Tap another in the Relics tab to make it the one that answers a foe.',
  'A loosed arrow stops in the first thing it meets, timber and stone included; a bolt of magic passes through the lot and strikes everything on the line.',
  'Anything hostile you put down pays coins for its trouble — about a coin per 5 hit points, and a little more for every level down.',
  'One cave monster in ten is standing on a buried hoard.',
  'A shiny monster underground is twice the fight and hits twice as hard — and its end always pays past the usual wage.',
  'Castle towers fight on your side: any on screen looses an arrow at the nearest foe, at a fifth of your own rate.',
  // ── World / map ───────────────────────────────────────────
  'A campfire rests you slowly out in the open, and slimes keep their distance.',
  'Wild rock grows in residential streets; shrubs in parks, woods and industrial lots.',
  'Long grass takes to grassland, farmland, parks and orchards — but never deep forest.',
  'Softwood fells a tier easier than most timber and hardwood a tier harder — and everything growing within 100m of where you began is soft pine.',
  // ── Animals ───────────────────────────────────────────────
  'Feeding an animal its favourite tames it where it stands — it stays in the world, it does not go in your bag.',
  'Tap a tame animal to pet it. Pet a cow or chicken and for ten minutes its next yield has a coin-flip chance of doubling.',
  'Pet a tame cat and it trails after you for five minutes.',
  'A tame cat hunts crows; a tame dog goes after deer and slimes.',
  'Chickens peck at any seed — hold one to befriend a wild chicken.',
  'Cows can\'t resist a ripe pairy — the only food a cow will pause for.',
  'Cats take milk, or any fish you land. Nothing else will win one over.',
  'Dogs only follow a hunter — hold raw meat to catch one.',
  'A deer can be hunted bare-handed, but it is a long slog. A sword, bow or staff makes short work of it.',
  'Feed any plant or crop to a chicken or cow for an egg or milk — but only once an hour from each.',
  'Netting an animal is a chase: it bolts while the wheel turns, and if it stays out of your reach for a second it is gone.',
  'A shiny animal pays ten times its plain kind, bolts twice as fast, and takes twice the work to bring down.',
  // ── Secret — slime taming. Rare to pull, but findable. ────
  'The old texts speak of a gem that calms even the most wretched creature. Perhaps a sapphire offered to a slime...',
];

// === Item special effects ====================================
// Short, one-line disclosure for items that DO something beyond their plain
// sell value / energy restore. Shown under the inventory bar (the inv-name
// strip) whenever such an item is selected, so a non-obvious power isn't a
// secret the player only learns from a Book. Keyed by item id; absent = no
// special effect (a plain crop / mineral that's just worth money or energy).
const ITEM_EFFECTS = {
  // Foods with a side-effect when eaten (on top of their energy restore).
  rainberry: 'Eat to water every crop within 20m',
  pairy:     'Eat to reveal the nearest unfound chest for 5 min',
  coffee:    'Eat for +2 amulet tiers of stick-walking speed (3 min)',
  // Universal tame treat — fed to any wild creature. Cave monsters are the
  // one exception, and the line says so: it is the only place that caveat is
  // written now that the Book no longer repeats the mango's effect.
  mango:     'Feed to tame any wild animal — never a cave monster',
  // The sapphire's ADVERTISED use — the one its Portal button opens, and the
  // only one this line may name. Until Sep 2026 it read "Offer to a slime to
  // tame it": the game's one real secret, printed on the inventory bar the
  // instant anyone selected a sapphire, while its actual function went
  // undescribed. The taming is hinted in exactly one place now — the closing
  // riddle in PLAY_TIPS — which is what makes it a secret rather than a label.
  sapphire:  'Use to open a portal one level down',
  // Consumables used on yourself / the world.
  honey:        'Set out to lure chickens & cows within 30m',
  book:         'Read for a play tip or a hint toward a chest',
  reach_potion:  'Drink for full-screen reach (1 min)',
  vigor_potion:  'Drink to restore 40 energy',
  speed_potion:  'Drink for tier-9 amulet walking (1 min)',
  shield_potion: 'Drink for half monster damage (1 min)',
  dragon_powder: 'Use to become a dragon for 1 min: faster legs, 2× damage',
  rope:          'Use to climb up or lower down one level, right here',
  scarecrow:    'Place on a tilled cell to ward off crows & deer',
  // Materials that are also placeables — held-and-tapped, so the line has to
  // say so or nothing does (a rock in the bag looks like pure sell value).
  rock:         'Hold and tap an empty tile to drop a stone fence',
  coal:         'Burn on bare ground to make a campfire',
};

const STARTING_ENERGY = 100;
const FOOD_ENERGY = {
  longgrass:  2,
  nut:        8,
  potato:     8,
  cress:      6,   // leafy green — mild restore
  onion:      8,   // bulb — same as potato
  berry:     10,   // sweet — between potato and rainberry
  rainberry: 12,   // also waters all crops within 20m
  pairy:     12,   // also shows the nearest undiscovered chest for 5 min
  gemfruit:  20,
  coffee:    35,
  sunflower:  60,
  fireflower: 90,
  iceflower: 150,
  chicken:    30,
  cow:       120,
  // cats + dogs are companions, not food — no FOOD_ENERGY entry means the
  // eat button never appears for them and eatSelected() refuses.
  egg:        10,
  milk:       40,
  mushroom:   16,
  apple:      12, cherry: 14, peach: 12, banana: 18, orange: 12, mango: 20, coconut: 18, apricot: 10,
  minnow:      5, bass: 15, trout: 25, salmon: 50, goldenfish: 100,
  meat:       45,   // hunted from deer; dog favourite
};
const ENERGY_COST = {
  till: 2,
  plant: 1,
  harvest: 1,
  rockBreak: 9,          // bare-handed; Wood pick → 3, Frost pick → 1 (effectivePickCost).
                         // The in-world rock cost also scales with how far the rock
                         // out-tiers your pick — see the rock-break handler.
  rockPlace: 1,
  catch: 9,              // bare-handed; Wood bug net → 3, Frost → 1 (effectiveCatchCost)
  fish: 9,               // bare-handed cast; Wood rod → 3, Frost → 1 (effectiveFishCost)
  chop: 9,               // PER tree-size unit, bare-handed; cut down by axe tier
                         // (see effectiveChopCost). small/medium/full = ×1/2/4.
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
  // Chickens — no explicit list. animalLikesFood special-cases any *_seed
  // for them, and the catch-hint flash hardcodes "want seed" for chickens,
  // so the array can stay empty. (Was ['rainberry'] before seeds replaced
  // berries as the canonical feed.)
  chicken: [],
  cow:     ['pairy'],      // pears to munch
  // Cats love milk AND any kind of fish.
  cat:     ['milk', 'minnow', 'bass', 'trout', 'salmon', 'goldenfish'],
  dog:     ['meat'],       // raw meat — hunt deer with a weapon relic
  // Secret: slimes can be tamed with a sapphire — hinted only in book tips,
  // and true again as of Sep 2026 (ITEM_EFFECTS.sapphire used to spell it out).
  // Not reachable through animalLikesFood in practice: a slime is an enemy, so
  // interact.js takes the sapphire branch and then the combat branch long
  // before the favourite-food path, and no "it wants X" hint ever names this.
  slime:   ['sapphire'],
};
function animalLikesFood(kind, foodId) {
  // Chickens peck ANY seed — they're omnivorous and the rainberry-only gate
  // felt arbitrary. Other species keep their explicit list.
  if (kind === 'chicken' && typeof foodId === 'string' && foodId.endsWith('_seed')) {
    return true;
  }
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
             effectKey: 'stickWalk',     blurb: 'walk off the GPS faster + cheaper per tier' },
  // Weapons (see combat.js). The SWORD is melee — it drains a foe's health on
  // the combat wheel and auto-engages the nearest enemy in reach. BOW and STAFF
  // are ranged — they fire on their own, one shot every Combat.FIRE_INTERVAL_MS
  // (two seconds), while an enemy is on screen: the bow along the compass, the
  // staff at the nearest foe in range.
  // These blurbs are the WHOLE disclosure for a weapon — the Book no longer
  // carries a second copy — so the bow's blurb has to say it aims by the
  // compass and the staff's that each bolt costs energy.
  // All three still speed the crow/deer hunt wheel by
  // tier. On top of the fighting, the Sword raises sell values and the Bow
  // lowers buy prices; the Staff bends no prices at all.
  sword:   { slot: 'sword',  name: 'Sword',   icon: 'Sword.png',   baseCost:  80,
             effectKey: 'sellPrice',     blurb: 'melee: auto-fights foes in reach · better sell prices' },
  bow:     { slot: 'bow',    name: 'Bow',     icon: 'Bow.png',     baseCost:  60,
             effectKey: 'buyPrice',      blurb: 'ranged: auto-shoots along the compass · better buy prices' },
  staff:   { slot: 'staff',  name: 'Staff',   icon: 'Staff.png',   baseCost:  60,
             effectKey: 'hunt',          blurb: 'ranged: seeks the nearest foe · 1⚡ a bolt · bigger bolt per tier' },
  // Watering can — when equipped, every watering tap on a crop "improves" it.
  // Tier T adds (T) tiers of quality. Tap WATER with the can to refill: the
  // next 50 watering uses get an extra +2 tiers of bonus stacked on top.
  // Boost is consumed at harvest: every quality-tier raises the extra-seed
  // chance by 10% (base 25%) and adds +floor(qual/3) to the produce yield.
  can:     { slot: 'can',    name: 'Watering Can', icon: 'Watering can.png', baseCost: 100,
             effectKey: 'wateringQuality', blurb: 'refill at water · higher-quality crops · bonus seeds' },
  // Hoe — reduces the energy cost of tilling. Each tier shaves 1/3 of the cost
  // (floored at 1) AND adds a per-tier chance of spending zero energy at all.
  hoe:     { slot: 'hoe',    name: 'Hoe',     icon: 'Hoe.png',     baseCost:  70,
             effectKey: 'tillSpeed',     blurb: 'cheaper tilling, sometimes free' },
  // Bug Net — single 16×16 icon under Extras (handled by gearAssetPath below).
  // It shortens the CATCH wheel (toolDurationMs 'bugnet') for every catchable
  // animal, butterflies included. It is not a gate and it has nothing to do
  // with crows: a crow is HUNTED, on the weapon ladder (interact.js
  // HUNT_KINDS), and no net was ever involved. The blurb said "catch crows +
  // butterflies", which named the one animal it cannot take and implied a
  // gate on the one it can.
  bugnet:  { slot: 'bugnet', name: 'Bug Net',     icon: 'Bug net.png',     baseCost: 60,
             effectKey: 'bugCatch',  blurb: 'net animals quicker — bare hands manage, slowly' },
  // Fishing Rod — standard 32×16 weapon sheet per tier folder. Like the net,
  // NOT a gate: a bare-handed cast works (interact.js 'fishing'), it just runs
  // 9 s instead of 3 and skunks more often. What the tier buys is the catch
  // table and the energy per cast.
  rod:     { slot: 'rod',    name: 'Fishing Rod', icon: 'Fishing Rod.png', baseCost: 90,
             effectKey: 'fishing',   blurb: 'quicker casts, rarer fish — bare hands manage, slowly' },
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
  if (kind === 'relic' && (slot === 'ring' || slot === 'amulet' || slot === 'bags')) {
    return `assets/Icons/RPG icons/Extras/${def.icon}`;
  }
  // bugnet: tier 1 (Wood) has dedicated brown art; other tiers fall back to the
  // generic Extras icon (which reads as metal — fine for iron/gold/frost tiers).
  if (kind === 'relic' && slot === 'bugnet') {
    if (tier === 1) return `assets/Icons/RPG icons/Weapons and Armor/1. Wood/${def.icon}`;
    return `assets/Icons/RPG icons/Extras/${def.icon}`;
  }
  // The watering can only ships Wood-tier art — there is no per-tier file, so
  // higher tiers (iron, gold, …) would 404 and render broken/blank. Pin it to
  // the Wood folder so every tier shows the same (only) watering-can art.
  if (kind === 'relic' && slot === 'can') {
    return `assets/Icons/RPG icons/Weapons and Armor/1. Wood/${def.icon}`;
  }
  return `assets/Icons/RPG icons/Weapons and Armor/${t.folder}/${def.icon}`;
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
// Shared tool-tier energy model for the gated "work" actions (chop / rock-break
// / catch / fish). EXPECTED energy is anchored at 9 bare-handed (tier 0), 3 with
// a Wood tool (tier 1) and 1 with a Frost tool (tier 7), ramping straight from
// 3 → 1 across tiers 1..7 (so t1=3, t4=2, t7=1). The in-between tiers come out
// fractional; callers run the result through probEnergy() to turn that
// expectation into an actual integer spend.
function toolEnergyExpected(tier, bareCost = 9) {
  if (!tier) return bareCost;          // bare hands — caller's ENERGY_COST entry
  return 3 - (tier - 1) / 3;           // tiers 1..7 ramp 3 → 1
}
// Probabilistic rounding: spend floor(cost) most of the time and ceil(cost) the
// rest, so the *expected* spend equals cost (e.g. 2.67 → 3 two-thirds of taps,
// 2 the other third). rng is injected so tests can pin the roll.
function probEnergy(cost, rng) {
  const lo = Math.floor(cost);
  const frac = cost - lo;
  if (frac <= 0) return lo;
  return ((rng || Math.random)() < frac) ? lo + 1 : lo;
}
// Pick relic: bare-handed rock-break expects 9, a Wood pick 3, a Frost pick 1.
// (The in-world handler additionally surcharges rocks that out-tier your pick —
// this is the at-or-above-tier baseline.)
function effectivePickCost(relics, rng) {
  return probEnergy(toolEnergyExpected(relics?.pick?.tier || 0, ENERGY_COST.rockBreak), rng);
}
// Energy to fell a tree: the shared 9/3/1 tool curve × the tree's size
// multiplier (small/medium/full → ×1/2/4). So bare-handed = 9/18/36, a Wood axe
// = 3/6/12, a Frost axe = 1/2/4. `o` is the tree object (drives treeWoodMul).
function effectiveChopCost(relics, o, rng) {
  const sizeMul = (typeof treeWoodMul === 'function') ? treeWoodMul(o) : 1;
  return probEnergy(toolEnergyExpected(relics?.axe?.tier || 0, ENERGY_COST.chop) * sizeMul, rng);
}
// Bug Net: bare-handed catch expects 9, a Wood net 3, a Frost net 1. The net
// ALSO shortens the catch wheel (see toolDurationMs).
function effectiveCatchCost(relics, rng) {
  return probEnergy(toolEnergyExpected(relics?.bugnet?.tier || 0), rng);
}
// Fishing Rod: bare-handed cast expects 9, a Wood rod 3, a Frost rod 1. The rod
// ALSO improves the catch table. Cast TIME is locked (9s bare / 3s any rod —
// see the fishing handler in interact.js), so tier buys cheaper + better
// casts, never faster ones.
function effectiveFishCost(relics, rng) {
  return probEnergy(toolEnergyExpected(relics?.rod?.tier || 0), rng);
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
// Tool work-wheel duration. TIER 0 = BARE HANDS: every tool type works
// bare-handed at 9s — so chop / mine / fish / defeat are always possible, only
// slow. Per-tier times: wood 4s, copper 2.6s, iron 1.69s, gold 1.1s, platinum
// .71s, crimson .46s, frost .3s. The bug net is the lone exception — butterflies
// still need it (gated in the catch path). pickDurationMs is a back-compat alias.
//
// THE RUNGS ARE GEOMETRIC: one tier is ~1.54× faster than the tier below it,
// every step of the way. That is what "about 1.5× per tier" comes out as once
// both ends are pinned — wood 4s to frost 0.3s is 13.33× across six steps, and
// 13.33^(1/6) = 1.54 — so the ratio isn't a target that was dialled in, it's
// the old ladder's own average made uniform. The numbers below are that curve
// rounded to 10 ms; `TIER_STEP` and the ratio test in tables.test.js keep an
// edit from quietly flattening a rung again.
//
// It replaces a hand-picked ladder (3000/2500/2000/1300/800/500/300) whose
// steps wandered between 1.25× and 1.67×, and the flat spot was exactly where
// a new player lives: copper→iron bought 25%, so the first three relics — the
// only ones reachable in the opening hour — felt like the same tool. In combat
// that's the loudest, because a slime is BASELINE_HP and so its kill time in
// seconds IS the duration here (see combat.js): wood 3s / copper 2.5s / iron 2s
// was a wooden sword killing nearly as fast as an iron one. Wood also moved 3s
// → 4s in the same pass, which is what opens the bottom of the curve up.
//
// TIER 0 = BARE HANDS is deliberately NOT on this curve. It stays at 9s, the
// rung every "you can always do it, only slowly" fallback is written against —
// 2.25× wood, not 1.54×. Being toolless is meant to be a state you leave, not
// the ladder's bottom step.
//
// One table serves EVERY tool, so re-shaping it re-shaped the wooden
// axe/pick/hoe/rod alongside the sword. That's the accepted cost of not forking
// a combat-only ladder; if the gathering tools ever need their own curve, give
// combat its own table rather than bending this one back.
const TIER_STEP = Math.pow(4000 / 300, 1 / 6);   // 1.5399… — the shape of the table below, which tables.test.js measures every rung against
const TOOL_DURATION_MS = { 1: 4000, 2: 2600, 3: 1690, 4: 1100, 5: 710, 6: 460, 7: 300 };
function toolDurationMs(relics, slot) {
  const eq = relics?.[slot];
  if (!eq) return 9000;   // tier 0 (bare hands) = 2.25 × wood
  return TOOL_DURATION_MS[eq.tier] ?? 9000;
}
function pickDurationMs(relics) { return toolDurationMs(relics, 'pick'); }
// Amulet relic: powers STICK WALKING — steering yourself somewhere other than
// where the GPS says you are. The stick is always there and always works; the
// amulet is purely an upgrade to it, so both functions answer for a bare hand
// too (no amulet = tier 0 = the baseline, never "unavailable").
//   steerSpeedMul   no amulet → 6× walk, tier 7 → 15.5× (linear between).
//   steerEnergyCost no amulet → 1.0 / cell, tier 1 → 1.0, tier 7 → 0.15 (linear).
// The bare baseline is 6× walk pace deliberately: at WALK_M_S that is a little
// over one 7 m cell per second, about the slowest the stick can move and still
// feel like a control rather than a drag — real walk pace crawls across a view
// that is 11 cells wide. The stamina cost is per CELL, so a faster baseline
// doesn't make travel cheaper, only less tedious.
// Walking with the GPS costs nothing — that's you actually walking. Stick
// walking is the character covering ground you didn't, which is what the
// stamina pays for, and what the amulet makes cheap.
// Ghost-walk (stick) speed endpoints, in multiples of WALK_M_S. Both ends are
// named so the ladder between them is one subtraction rather than a magic
// slope constant.
const STEER_MUL_FLOOR = 6;      // bare hands
// 24, up from 15.5. The ladder ran 6x to 15.5x, which sounds wide and does not
// PLAY wide: 1.2 cells a second bare-handed against 3.1 at the top, so a tier-8
// amulet felt like a tier-0 one with a tailwind and a coffee (+1 tier, ~9% at
// the top end) did nothing you could feel. The floor stays at 6 — it was
// deliberately lifted from 5 because one cell a second read as a drag — so the
// whole widening lands in the per-tier step, which goes 1.36x -> 2.57x.
const STEER_MUL_FROST = 24;   // tier 7 amulet
function steerSpeedMul(relics) {
  const t = relics?.amulet?.tier || 0;
  // The FLOOR was lifted 20% (5 → 6): one cell a second is the speed the
  // player spends the whole opening at, and it sat right on the edge of
  // reading as a drag. The Frost end of the ladder is deliberately unchanged —
  // 15.5× is a tuned endpoint — so the per-tier step absorbs the lift instead
  // of every tier shifting up with it.
  return STEER_MUL_FLOOR + ((STEER_MUL_FROST - STEER_MUL_FLOOR) / 7) * t;
}
function steerEnergyCost(relics) {
  const t = relics?.amulet?.tier || 0;
  if (!t) return 1;
  // Floor keeps the speed potion's synthetic tier 9 (and any future tier past
  // Frost) from running the cost negative, i.e. paying you to walk.
  return Math.max(0.05, 1 - (t - 1) * (0.85 / 6));
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
// The TRAILER (home) is the only place a haul can be cashed out, so what it
// pays IS the sell economy — a haul is worth exactly what home hands over.
// That payout is a 25% haircut off the sword-scaled price: the sword ladder
// above still governs how much better selling gets as the player levels, this
// only sets where the whole ladder sits. It is deliberately a separate number
// from sellMultiplier so the stand's anti-arbitrage floor (shops_math.js
// standBuyMul, which prices off sellMultiplier) is unaffected — a smaller
// trailer payout only widens the margin that keeps buy-low-sell-high shut,
// never narrows it.
// One number, one place: every home sale goes through trailerSellPrice, so the
// price the modal quotes and the cash addMoney pays can't drift apart.
const TRAILER_SELL_MUL = 0.75;
// Hard mode takes a further cut here (Difficulty.sellMul, 0.6): the SAME
// place, so the quote and the payout still can't drift, and the stand floor
// (which prices off sellMultiplier, not this) only widens.
function trailerSellMultiplier(relics) {
  const modeMul = (typeof Difficulty !== 'undefined') ? Difficulty.get().sellMul : 1;
  return sellMultiplier(relics) * TRAILER_SELL_MUL * modeMul;
}
// Cash the trailer pays for ONE unit of an item listed at baseValue. Ceil and
// a $1 floor, same as every other price path — so a $1 item still sells for $1
// and the haircut only bites above the floor.
function trailerSellPrice(baseValue, relics) {
  return Math.max(1, Math.ceil((baseValue ?? 1) * trailerSellMultiplier(relics)));
}
// Buy-discount tier — the BOW alone shrinks buy prices now. The Staff used to
// share this discount, but it's been demoted to a pure combat weapon (it's a
// ranged weapon in combat.js, and still counts toward the crow/deer hunt-speed
// max in interact.js); only the Bow bends shop prices. Shared by buyMarkupRange and castle pricing in app.js.
function bestWeaponTier(relics) {
  return relics?.bow?.tier || 0;
}
// Bow relic: shrinks the random buy-cash markup. Without one, the trader still
// wants 1.2..3.0× base. At tier 7 the markup collapses to 1.0× (the player
// buys at par).
// Hard mode scales the whole range (Difficulty.buyMul, 1.5×): the bow still
// closes the spread the same way, it just closes on 1.5× par instead of par.
// Applied HERE so every reader — the trader's roll, the castle's pricing —
// asks one function and gets the same answer.
function buyMarkupRange(relics) {
  const t = bestWeaponTier(relics);
  const f = 1 - t / 7;   // 1 → 0 as tier rises
  const modeMul = (typeof Difficulty !== 'undefined') ? Difficulty.get().buyMul : 1;
  return { lo: (1 + 0.2 * f) * modeMul, hi: (1 + 2.0 * f) * modeMul };
}

// === Per-crop loot tier config (used by chests + treasure marks) ===
// T1 common (10 seeds/chest default yield), T2 uncommon (5), T3 rare (2).
// Sourced from BASE_TIER so rarity stays single-source. The legacy callers
// (loot.js pickLoot, REG tests) keep working unchanged.
const SEED_TIER = Object.fromEntries(
  Object.keys(CROP_ROW).map(c => [`${c}_seed`, BASE_TIER[c] || 1])
);

// Low-tier seeds (baseTier ≤ 2 — the cheap starter crops) are planted in bulk,
// so the places that hand out seeds — trader barter, treasure X, and cash
// shops — bundle a few extra. `isLowTierSeed` is the single source of truth for
// "should this seed get the bulk bonus"; LOW_TIER_SEED_QTY_BONUS is how many
// extra ship on top of the normal quantity.
const LOW_TIER_SEED_QTY_BONUS = 2;
function isLowTierSeed(id) {
  const it = ITEM_BY_ID[id];
  return !!it && it.kind === 'seed' && (it.baseTier || 1) <= 2;
}
