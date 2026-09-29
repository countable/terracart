// Item & crop registry: all per-crop config, item definitions, prices, and
// the inventory-icon resolver. Extracted from app.js so the catalog lives
// in one place and changes to the crop roster don't require editing logic.
//
// Depends on:
//   util.js (fnv1a, for the per-cell sprite-variant hash). Pure data + small
//   lookup helpers otherwise. Must load BEFORE
//   loot.js (tierInfo falls back to SEED_TIER for raw seed ids) and app.js.
//
// Exports as globals:
//   CROP_ROW, MAX_GROWTH_STAGE, PRODUCE_COL, SEEDBOX_COL, CROPS_SHEET_COLS
//   SPRING_CROPS_COLS, CROP_SPRITE, wildplantFrame, inventoryIconSource
//   MINERAL_TIERS, mineralRockFrame, mineralBarId
//   CROP_NAMES, ITEMS, ITEM_BY_ID
//   PRICES, BUY_LIST, STARTING_MONEY
//   NON_TILLABLE, isTillable, isTillableCell   (which ground takes a hoe)
//   INV_CATS, INV_CAT_BY_KEY, invCatForItem    (the inventory's type tabs)
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
  // Shell — the beach pickup, and the one crop whose LOOK varies per cell.
  // Shell.png is 48×64 = 3 cols × 4 rows of 16×16, and only the TOP ROW is
  // shell art: three cowries (pink, gold, blue). Row 1 repeats those three
  // with a white keyline (a highlight state, not a fourth shell), frames 6
  // and 9 are flat one-colour silhouettes (mask rows) and 7, 8, 10 and 11 are
  // blank — the same layout Gemstones.png uses (see MINERAL_ICON_SHEET below).
  // So `frames` LISTS the three frames that carry a shell rather than counting
  // them: a count is a claim about the sheet that the sheet does not make.
  // This said `variants: 12` until Sep 2026 and the renderer drew
  // `hash % 12`, so most shells on a beach picked a blank frame — a pickup
  // you could tap but not see, which is what "no shells on beaches" was.
  // tools/sprite_audit.js decodes the real PNG and fails if a declared frame
  // is transparent (or a flat mask row), so a re-cut sheet can't do it again.
  shell: { sheet: 'shell_sheet', custom: true, frames: [0, 1, 2] },
  // Torch — the consumable lying on a level-1 cave floor (worldgen.js
  // caveFloorTorches), drawn with its own inventory icon; picking it is a
  // Torch. Same 1.36 as the mushroom so a floor pickup reads at one size.
  torch: { sheet: 'icon_torch', custom: true, frame: 0, scale: 1.36 },
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
  // ── Street variants (src/street_variants.js) — both CHOPPED like a shrub
  // (WILDPLANT_RULES below), never scenery. The barricade road's barricade
  // is the generated 16px piece; a hedgerow's hedges are plain shrubs.
  barricade:   { sheet: 'barricade', custom: true, frame: 0, scale: 1.6 },
  // ── Influence zones (src/zones.js) — the tar yard's FLINT: a ground
  // pickup (WILDPLANT_RULES.flint below), the generated 16px nodule. One
  // frame of art, listed.
  flint:       { sheet: 'flint', custom: true, frames: [0], scale: 1.36 },
  // ── The TIDE LINE (src/scenic.js) — what the sea leaves on the waterline
  // each UTC day, beside the shell: a sea-worn DRIFTWOOD branch and, rarely,
  // a MESSAGE BOTTLE. The generated 16px placeholders, one frame of art
  // each, listed.
  driftwood:   { sheet: 'driftwood', custom: true, frames: [0], scale: 1.36 },
  bottle:      { sheet: 'bottle', custom: true, frames: [0], scale: 1.36 },
};

// ── Which frame does THIS wild plant draw? ─────────────────────────────────
// The custom-sheet crops whose look varies per cell — the shell's three
// cowries, the mushroom's two luminous cave caps — resolve their frame HERE,
// so the "which look does this cell get" hash cannot differ between the two
// branches that ask, and so the frame can only ever be one the crop declares.
//
// The key is the wildplant's own ID (`wp_<tx>_<ty>_<ix>_<iy>`, minted per cell
// by the rasterizer), hashed as a STRING, falling back to the tile-local cell
// for the wildplants that carry no id. It has to be stable, because the same
// cell must show the same shell across a reload and a tile rebuild — and it
// has to be the WHOLE id: until Sep 2026 the renderer hashed `id.length`
// (one number for a whole tile, since every id in a tile is nearly the same
// length) XORed with `_ix`/`_iy`, which the rasterizer's occupancy pass
// deletes before the entry is ever drawn. So every shell in a tile drew the
// same frame, picked off its id's LENGTH — usually one of the blank ones.
// Salted so it can't line up with the other id-derived hashes (shinyHash01).
function wildplantVariantHash(p) {
  const id = (p && (p.wildId || p.id));
  const key = id != null ? String(id) : `${(p && p._ix) ?? 0}_${(p && p._iy) ?? 0}`;
  return fnv1a(key + '#variant');
}
function wildplantFrame(p) {
  const ov = CROP_SPRITE[p && p.crop];
  if (!ov || !ov.custom) return 0;
  // Grown underground: the crop's cave look (mushroom's blue caps), off the
  // same hash — same crop, same item, only the art says it grew in the dark.
  const list = (p && p._cave && ov.caveFrames) ? ov.caveFrames : ov.frames;
  if (!list || !list.length) return ov.frame ?? 0;
  if (list.length === 1) return list[0];
  return list[wildplantVariantHash(p) % list.length];
}

// ── What a WILD PLANT DOES ─────────────────────────────────────────────────
// CROP_SPRITE above says what a crop LOOKS like; this says what one is when
// the player taps it. Both are keyed on `crop`, and this is the second half of
// the same table.
//
// Every per-crop wildplant fact used to be a one-row literal at the site that
// asked: `HARVEST_OUTPUT = { shrub: 'wood' }` and `WORK_RELIC = { rockfruit:
// 'pick', shrub: 'axe' }` and a `wp.crop === 'shrub'` work-cost ternary in
// interact.js' tap handler, `WILD_TREASURE` over in loot.js, and a
// `crop === 'mushroom'` test in BOTH lighting.js' sourceKind and render.js'
// light-offer gate. Five lists in four files, so a second glowing plant — or a
// second bush worth chopping — was five edits, four of which nothing would
// have reminded anyone about.
// One table, read through the accessors below: the roadOverlayWidthM
// discipline. A crop with NO row here is the ordinary wild plant, and that is
// the vast majority — it drops itself, is picked instantly for nothing, hides
// no treasure and casts no light.
const WILDPLANT_RULES = {
  // A woody bush. Chopping one yields the WOOD mineral, not a 'shrub' item
  // (tree + shrub have no inventory counterparts), and it is real felling
  // work: the axe relic's ladder times the wheel and `workCharged` puts the
  // shared 9/3/1 tool curve on the bar.
  shrub:     { output: 'wood', workRelic: 'axe', workCharged: true },
  // A barricade road's barricade is the shrub's row — one lane, one more
  // thing standing on it: axe work, wood, `picked`. (A hedgerow's hedges ARE
  // shrubs.)
  barricade: { output: 'wood', workRelic: 'axe', workCharged: true },
  // A tar yard's flint nodule (src/zones.js) is picked instantly for nothing,
  // like a shell, and hands over the Flint item (id 'coal').
  flint:     { output: 'coal' },
  // The TIDE LINE's finds (src/scenic.js tideLive) — picked instantly, like a
  // shell. Driftwood is wood. A MESSAGE BOTTLE is no item: it pays one roll
  // of its context (`roll` — Scenic.BOTTLE_CONTEXT) and reads its note
  // (`note`, Scenic.bottleNote) in a story dialog. What a tide pickup is on a
  // given day is the day's; that it was TAKEN today is the day ledger's
  // (interact.js 'wildplant' — never save.picked).
  driftwood: { output: 'wood' },
  bottle:    { roll: 'treasure:vista', note: true },
  // Stone debris. The pick relic's ladder times the wheel the same way a rock
  // does — but gathering loose rubble off the ground costs no energy, so no
  // `workCharged`. The one wild plant that hides something.
  rockfruit: { workRelic: 'pick', treasure: { chance: 0.1, bonus: 'gemfruit' } },
  // The one wild plant that is a LIGHT: `light` names its Lighting.KINDS row,
  // which is what both the collector's gate (render.js) and the source
  // classifier (Lighting.sourceKind) ask this table for.
  mushroom:  { light: 'mushroom' },
};
function wildplantRule(crop) { return WILDPLANT_RULES[crop] || null; }
// What a pick hands over — the crop itself, unless a row names something else.
function wildplantOutput(crop) { return wildplantRule(crop)?.output || crop; }
// Which relic's tool ladder times the work wheel. null = picked instantly.
function wildplantWorkRelic(crop) { return wildplantRule(crop)?.workRelic || null; }
// What that wheel costs. Charged off the SAME 9/3/1 curve every other gated
// job spends on, read from the crop's own relic — never a second ladder.
// `rng` is injected so a test can pin probEnergy's roll.
function wildplantWorkCost(crop, relics, rng) {
  const r = wildplantRule(crop);
  if (!r || !r.workCharged || !r.workRelic) return 0;
  return probEnergy(toolEnergyExpected(relics?.[r.workRelic]?.tier || 0), rng);
}
// The surprise bonus a pick may also hand over: { chance, bonus } or null.
function wildplantTreasure(crop) { return wildplantRule(crop)?.treasure || null; }
// Which Lighting.KINDS row this plant lights as, null for everything else.
function wildplantLight(crop) { return wildplantRule(crop)?.light || null; }
// The loot context a pick ROLLS instead of handing the crop over (the tide
// line's message bottle), or null.
function wildplantRoll(crop) { return wildplantRule(crop)?.roll || null; }

// CAMPFIRE COOKING — raw food → its cooked twin, in the order the cooked icon
// sheet lays them out (assets/Icons/Food Icons/Cooked.png, frame = index here,
// baked from each raw icon by tools/cook_icons.js — rerun it when a row is
// added). Only foods a fire plainly improves AND whose icon shows the food:
// the tuber, the bulb, the mushroom, the baking apple and the catch. (The
// nut's crop icon is a leafy bush, so a roasted one would read as burnt
// greens — it stays raw until it has nut art.) Grilled meat predates the table
// and keeps its own Beef.png frame; everything here rides the same lane —
// CAMPFIRE_MAKES, GRILL_ENERGY_MUL on energy and price, `cooked` out of loot.
const COOKED_FOODS = {
  potato:     { id: 'baked_potato',      name: 'Baked Potato' },
  onion:      { id: 'roast_onion',       name: 'Roast Onion' },
  mushroom:   { id: 'grilled_mushroom',  name: 'Grilled Mushroom' },
  apple:      { id: 'baked_apple',       name: 'Baked Apple' },
  minnow:     { id: 'grilled_minnow',    name: 'Grilled Minnow' },
  bass:       { id: 'grilled_bass',      name: 'Grilled Bass' },
  trout:      { id: 'grilled_trout',     name: 'Grilled Trout' },
  salmon:     { id: 'grilled_salmon',    name: 'Grilled Salmon' },
  goldenfish: { id: 'grilled_goldenfish', name: 'Grilled Goldenfish' },
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
// Ore-bearing rock identity. One row owns the material shown, paid and
// catalogued because changing any one without the others lies to the player.
// The mineralrock sheet's top row orders copper through platinum at columns
// 0..3, leaves column 4 for unrelated art, then puts crimson/frost at 5/6.
// Yield tier 1 is a plain rock and therefore has no row or namesake bar.
const MINERAL_TIERS = Object.freeze({
  2: Object.freeze({ barId: 'copper_bar',   rockFrame: 0 }),
  3: Object.freeze({ barId: 'iron_bar',     rockFrame: 1 }),
  4: Object.freeze({ barId: 'gold_bar',     rockFrame: 2 }),
  5: Object.freeze({ barId: 'platinum_bar', rockFrame: 3 }),
  6: Object.freeze({ barId: 'crimson_bar',  rockFrame: 5 }),
  7: Object.freeze({ barId: 'frost_bar',    rockFrame: 6 }),
});
function mineralRockFrame(tier) { return MINERAL_TIERS[tier]?.rockFrame ?? 0; }
function mineralBarId(tier) { return MINERAL_TIERS[tier]?.barId || null; }

const MINERAL_ICON_SHEET = {
  // Wood — frame 2 of the 3-variant log sheet (amber bark variant).
  wood:     { sheet: 'wood',      frame: 2 },
  coal:     { sheet: 'coal_icon', frame: 0 },
  // Gems — Gemstones.png row 0 (7 cols of 16×16), left to right: 0 cut cyan
  // diamond, 1 red ruby, 2 purple shard, 3 blue sapphire, 4 orange topaz,
  // 5 green emerald cluster, 6 pink quartz. (Rows 1-3 are outlined / mask
  // duplicates.) Until Sep 2026 these rows read ruby 0 / emerald 3 /
  // sapphire 4 — the cyan diamond, the blue sapphire and the orange topaz —
  // so the "red gem" the tips promised was drawn cyan; the diamond taking
  // frame 0 is what surfaced it. Pinned by test/node/diamond.test.js.
  sapphire: { sheet: 'gems',      frame: 3 },   // blue gem
  ruby:     { sheet: 'gems',      frame: 1 },   // red gem
  emerald:  { sheet: 'gems',      frame: 5 },   // green gem cluster
  diamond:  { sheet: 'gems',      frame: 0 },   // cut cyan-white diamond — the Frost jewel
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
  antidote:     { sheet: 'icon_potions', frame: 26 }, // green conical flask
  elixir:       { sheet: 'icon_potions', frame: 33 }, // large violet flask
  vigor_potion:  { sheet: 'icon_potions', frame: 11 },
  speed_potion:  { sheet: 'icon_potions', frame: 12 },
  shield_potion: { sheet: 'icon_potions', frame: 13 },
  // Potion of the Raven — the blue flask that closes the same row
  // (frame 14): a cold, ghostly blue for a bird that is not quite there.
  raven_potion:  { sheet: 'icon_potions', frame: 14 },
  // Potion of Blight — the red flask of the next row down (row 3, y=48:
  // frame 17), so it doesn't read as the Speed potion's red beside it.
  blight_potion: { sheet: 'icon_potions', frame: 17 },
  // Revival potions — green for life, the small flask of row 3 (frame 16) for
  // the T2 draught and the larger bottle of row 4 (frame 21) for the T5 one,
  // so the pair read as one potion in two strengths.
  revive_potion:       { sheet: 'icon_potions', frame: 16 },
  resurrection_potion: { sheet: 'icon_potions', frame: 21 },
  // Potion of Thunder — the blue jug of row 4 (frame 24): lightning blue.
  thunder_potion:      { sheet: 'icon_potions', frame: 24 },
  // Dragon Powder — the vivid crimson pouch (row 1 col 2 = frame 7). Using it
  // turns you into a red dragon (useDragonPowder in app.js).
  dragon_powder: { sheet: 'icon_potions', frame: 7 },
  // The other three heaps of the same powder row (row 1, y=16: frame 5 is the
  // EMPTY slot, then green / red / purple / blue). Growth is the green heap,
  // Shadow the purple, Frost the blue — each used from the Use button like the
  // dragon's red (useGrowthPowder / useShadowPowder / useFrostPowder in app.js).
  growth_powder: { sheet: 'icon_potions', frame: 6 },
  shadow_powder: { sheet: 'icon_potions', frame: 8 },
  frost_powder:  { sheet: 'icon_potions', frame: 9 },
  // Rope — single 16×16 coiled-rope icon (Icons/Items, hand-drawn like the
  // honey jar). Using it moves the player up or down one cave level in place
  // (useRope in app.js).
  rope:          { sheet: 'icon_rope', frame: 0 },
  // Torch — single 16×16 stick-and-flame icon (Icons/Items). Lighting it
  // widens the player's own light for a few minutes (useTorch in app.js →
  // the `torch` row of Lighting.KINDS).
  torch:         { sheet: 'icon_torch', frame: 0 },
  // Trap Disarm Kit — no dedicated hand-drawn art exists yet, so this reuses
  // frame 0 (the plain brown leather pouch) of the Extras 'Bags' sheet: a
  // small tool kit reads reasonably as a carried pouch, and it isn't the
  // frame the `bags` RELIC (backpack capacity) draws from — that's a
  // separate per-tier gear-icon path (gearAssetPath), not this ICON_SHEETS
  // lookup, so the two uses of the same source PNG never collide on screen.
  trap_kit:      { sheet: 'icon_kit', frame: 0 },
  // Magic Trap — the same Bags sheet as the disarm kit, frame 3: the rose
  // pouch, so the snare you SET and the kit that SHUTS one read as a pair and
  // the pink says magic before the glow on the ground does.
  magic_trap:    { sheet: 'icon_kit', frame: 3 },
  // Wilderness drops — meat is beef, rabbit_pelt uses one of the colour
  // variants, crow_feather uses the chicken-feather sheet's first frame.
  meat:         { sheet: 'icon_meat',    frame: 0 },
  // Beef.png is 2×2: row 0 raw (plain, outlined), row 1 COOKED — frame 2.
  grilled_meat: { sheet: 'icon_meat',    frame: 2 },
  // The rest of the campfire's dishes — one baked sheet, see COOKED_FOODS.
  ...Object.fromEntries(Object.values(COOKED_FOODS).map((c, i) =>
    [c.id, { sheet: 'icon_cooked', frame: i }])),
  rabbit_pelt:  { sheet: 'icon_pelt',    frame: 0 },
  crow_feather: { sheet: 'icon_feather', frame: 0 },
  // Beach pickup — Icons/Fish/Sea/Creatures/Shell.png carries three shells
  // on its top row (see CROP_SPRITE.shell); frame 0 is the pink cowrie, the
  // canonical one used for the inventory icon.
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
  // The acorn plants a plain timber tree, so it shows the same sheet that
  // tree draws from ('trees', the maple/default sheet) at its young frame.
  acorn:         { sheet: 'trees',      frame: 2 },
  // MEMORY — the gold five-point star at row 8 col 4 of 7_Pickup_Items
  // (frame 8 * 14 + 4 = 116). Same sheet as the boot. Not an item: memories
  // are a save counter (save.memories, app.js _bankDiscovery), and this row
  // is only the star the HUD chip draws (renderItemIcon('memory')) —
  // inventoryIconSource answers it with no ITEMS row behind it.
  memory:        { sheet: 'pickup',     frame: 116 },
};

function inventoryIconSource(itemId) {
  // Minerals + gems use the dedicated sheet table above. Read BEFORE the item
  // lookup: the memory star has a row there and no ITEMS entry.
  if (MINERAL_ICON_SHEET[itemId]) return MINERAL_ICON_SHEET[itemId];
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
    // Custom sheets (longgrass→props, mushroom→props, shell→shell_sheet).
    // ov.frame is honoured so sheets whose frame 0 is empty can point at the
    // right cell; a crop that varies per cell in the world (shell) has no
    // single `frame`, so the icon is the FIRST frame it declares — never a
    // bare 0, which on such a sheet may be no art at all.
    return { sheet: ov.sheet, frame: ov.frame ?? (ov.frames && ov.frames[0]) ?? 0 };
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

// ICON BADGES — for the items whose own art can't tell them apart. Crops.png
// has ONE generic seed bag for every crop on it, and the three tree saplings'
// sheets share one young-tree frame, so nine seeds were one picture and the
// apple sapling, peach sapling and acorn another. Each of those gets a badge:
// the icon of what it YIELDS, drawn in its corner (baked in app.js create()
// into ITEM_DATA_URLS, so every DOM surface shows it). Derived from the
// item's own row, never listed: a seed or sapling badges what it `grows`, a
// plain tree (`plants`) badges what the tree is cut for. Null when the art
// already says it — the Spring Crops seeds have seed art of their own.
const PLANTS_YIELD = { tree: 'wood' };
function iconBadgeItem(itemId) {
  const item = ITEM_BY_ID[itemId];
  if (!item) return null;
  if (item.kind === 'seed') return CROP_SPRITE[item.grows] ? null : item.grows;
  if (item.kind === 'sapling') return item.grows || PLANTS_YIELD[item.plants] || null;
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
  // Mineral bars inherit the same tier that chooses their rock art and drop.
  ...Object.fromEntries(Object.entries(MINERAL_TIERS)
    .map(([tier, row]) => [row.barId, Number(tier)])),
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
  apple_sapling: 3, peach_sapling: 5, acorn: 2,
  // Live animals
  chicken: 1, dog: 1, rabbit: 1,
  cat: 2, butterfly: 2,
  crow: 3,
  deer: 4,
  cow: 5,
  // Consumables
  antidote: 1, elixir: 6,
  honey: 2, book: 2, reach_potion: 2, vigor_potion: 2, speed_potion: 2, shield_potion: 2,
  blight_potion: 3,
  // The Spirit Raven: Blight's tier — see its PRICES row for the comparison.
  raven_potion: 3,
  dragon_powder: 3,
  // Revival: getting up where you fell instead of walking Home at a crawl.
  // A tenth of a bar is a T2 emergency; half a bar is a T5 find.
  revive_potion: 2, resurrection_potion: 5,
  // Thunder: a screen-wide strike that also breaks a fight up — T4.
  thunder_potion: 4,
  // Growth Powder is a T2 farm utility beside the potions, and Shadow sits with
  // it: a minute of not being hunted is a way to WALK AWAY from a fight, the
  // same shape as the reach/speed/shield potions it now shares a tier with.
  // Frost is the T3 fight-changer beside the dragon — it is the one that turns
  // a fight you are already in.
  growth_powder: 2, shadow_powder: 2, frost_powder: 3,
  // Rope — a T2 utility like the potions: one climb up or down a level.
  rope: 2,
  // Trap Disarm Kit — a T2 utility beside rope: situational, not a staple.
  trap_kit: 2,
  // Magic Trap — the tier-2 cave supply the goblin trapper also drops.
  magic_trap: 2,
  // Torch — the T1 cave staple: light for the dark, cheap and common.
  torch: 1,
  // Minerals — coal floor, gem ladder mirrors mining rarity
  coal: 1,
  meat: 2, rabbit_pelt: 2,
  // Grilled at a campfire (CAMPFIRE_MAKES) — one step up from the raw cut.
  grilled_meat: 3,
  crow_feather: 3,
  sapphire: 4, ruby: 5, emerald: 6,
  // Diamond tops the gem ladder at the Frost tier — the T7 rock's headline gem.
  diamond: 7,
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
  { id: 'honey', name: 'Honey', kind: 'supply' },
  // dropWeight 3: a Book is THE documentation (see play_tips.js), so it is
  // the one consumable that has to turn up often enough to be read. At an even
  // draw it was one of seven T2 consumables — a sliver of an already-thin
  // consumable share — and a player could finish a session having never met
  // one. Three makes it the plurality of the T2 consumable pool everywhere,
  // and school chests pin it outright on top of that (rarity.js
  // 'chest:school'). This is the one item whose SCARCITY is a documentation
  // bug rather than a balance choice.
  { id: 'book',  name: 'Book',  kind: 'supply', dropWeight: 3 },
  // Potion of Reach: drink it (Use button with it selected) to light up
  // the whole screen — full-range reach for 1 minute, regardless of energy.
  { id: 'antidote', name: 'Antidote', kind: 'magic', potion: true },
  { id: 'elixir', name: 'Elixir', kind: 'magic', potion: true },
  { id: 'reach_potion',  name: 'Potion of Reach',     kind: 'magic', potion: true },
  { id: 'vigor_potion',  name: 'Potion of Vigor',     kind: 'magic', potion: true },
  { id: 'speed_potion',  name: 'Potion of Speed',     kind: 'magic', potion: true },
  { id: 'shield_potion', name: 'Potion of Shielding', kind: 'magic', potion: true },
  { id: 'blight_potion', name: 'Potion of Blight',    kind: 'magic', potion: true },
  // Drunk to summon a spirit raven that hunts foes and pest crows for
  // SPIRIT_RAVEN_MS (app.js drinkRavenPotion; the bird is the creature row
  // SpriteLayout.CREATURE_BEHAVIOUR.spirit_raven).
  { id: 'raven_potion',  name: 'Potion of the Raven', kind: 'magic', potion: true },
  // Drunk while DOWN (zero energy) to get back up on the spot — see
  // REVIVE_POTION_FRAC and drinkRevivePotion in app.js.
  { id: 'revive_potion',       name: 'Potion of Revival',       kind: 'magic', potion: true },
  { id: 'resurrection_potion', name: 'Potion of Resurrection', kind: 'magic', potion: true },
  // Drunk to strike every foe on screen (app.js drinkThunderPotion).
  { id: 'thunder_potion',      name: 'Potion of Thunder',      kind: 'magic', potion: true },
  // Dragon Powder: use it (Use button with it selected) to wear a red dragon
  // for one minute — tier-8 boots and amulet on the movement stick AND 2× attack
  // damage (useDragonPowder in app.js). A stat buff, not a movement mode.
  { id: 'dragon_powder', name: 'Dragon Powder',       kind: 'magic' },
  // Growth Powder: every crop within 20 m springs ahead one stage on the spot,
  // no watering needed (useGrowthPowder). Refused — and kept — when no crop is
  // in range.
  { id: 'growth_powder', name: 'Growth Powder',       kind: 'magic' },
  // Shadow Powder: for one minute monsters lose interest in you — they neither
  // stalk nor drain you (useShadowPowder). You may still hit them.
  { id: 'shadow_powder', name: 'Shadow Powder',       kind: 'magic' },
  // Frost Powder: every enemy within reach is frozen solid for 30 s — no
  // moving, no attacking (useFrostPowder). Refused — and kept — when nothing
  // hostile is in reach.
  { id: 'frost_powder',  name: 'Frost Powder',        kind: 'magic' },
  // Rope: use it (Use button with it selected) and the dialog asks which way —
  // climb UP a level or lower yourself DOWN one — right where you stand, no
  // staircase needed. One rope per climb. Unlike the sapphire portal it goes
  // both ways, so it is also the way out of a dead-end dig (useRope in app.js).
  { id: 'rope',          name: 'Rope',                kind: 'supply' },
  // Torch: light it (Use button with it selected) and for three minutes the
  // player's own light reaches twice as far — the `torch` row of
  // Lighting.KINDS, stamped at the feet on top of the reach ramp. The reach
  // plateau (what you can tap) is untouched; only the dark around it lifts.
  // Lighting another while one burns EXTENDS the time (useTorch in app.js).
  { id: 'torch',         name: 'Torch',               kind: 'supply' },
  // Trap Disarm Kit: hold it and tap a trap (hidden scuff or already-sprung
  // jaw, surface or cave) to remove it for good — see Traps.disarm in
  // src/traps.js and the 'disarm-trap' tap handler in interact.js. A kit
  // usually SURVIVES the job (TRAP_KIT_KEEP_CHANCE); unlike stepping on a
  // trap, disarming never costs energy.
  { id: 'trap_kit',      name: 'Trap Disarm Kit',     kind: 'supply' },
  // Magic Trap: hold it and tap an empty cell in reach to set it (interact.js
  // 'place-magic-trap' → save.magicTraps). The first ENEMY to step on the
  // cell is held and hurt, and the trap is spent (app.js _tickMagicTraps; the
  // numbers are in traps.js's MAGIC TRAP note). `caveOnly`: it is never in
  // the surface class/tier pool — rarity.js reaches it only through the cave
  // supply favourite — and a slain goblin trapper drops one.
  { id: 'magic_trap',    name: 'Magic Trap',          kind: 'supply', caveOnly: true },
  // Wild forest fauna drops — produced when a live caught animal is
  // processed (a future butcher / blacksmith step). Catching itself yields
  // the animal, not these.
  // ('butterfly' lives above as the live-animal entry — there is no
  // separate butterfly product; the insect itself is the drop.)
  // Animal byproducts — kind: 'produce' alongside egg / milk. Sit in the
  // produce pool of the rarity picker, not the mineral pool (which is
  // reserved for coal / gemstones).
  { id: 'meat',         name: 'Meat',         kind: 'produce' },
  // Made, never found: only a campfire turns meat into this (CAMPFIRE_MAKES),
  // so `cooked` keeps it out of the rarity picker's loot pools.
  { id: 'grilled_meat', name: 'Grilled Meat', kind: 'produce', cooked: true },
  ...Object.values(COOKED_FOODS).map(c => ({ id: c.id, name: c.name, kind: 'produce', cooked: true })),
  { id: 'rabbit_pelt',  name: 'Rabbit Pelt',  kind: 'produce' },
  { id: 'crow_feather', name: 'Crow Feather', kind: 'produce' },
  // Beach pickup — shells spawn as wildplant debris on sand cells (the sand
  // family's only flora, src/biome_profiles.js). Three visual variants in
  // shell_sheet, picked per cell by wildplantFrame above.
  { id: 'shell',        name: 'Shell',        kind: 'produce', crop: 'shell' },
  // Fishing junk pull — old leather boot. T1, low sell, no eat. Joke drop
  // from the rod's loot table at small weight; mostly a flavour moment.
  { id: 'boot',         name: 'Old Boot',     kind: 'produce' },
  // Scarecrow — placeable on tillable cells. Wild crows and deer steer
  // around it (4-cell aversion radius in wanderCreatures). Stack of N can
  // be deployed across the farm.
  { id: 'scarecrow',    name: 'Scarecrow',    kind: 'supply' },
  // Wild mushroom (forest debris, pickable)
  { id: 'mushroom',     name: 'Mushroom',     kind: 'produce', crop: 'mushroom' },
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
  // The ACORN is a sapling too, but it plants TIMBER, not fruit: `plants:'tree'`
  // routes it to a growing `tree` object (the thing you chop) instead of a
  // `fruittree` (the thing you pick). It falls out of felling a tree — the
  // better the axe, the likelier (acornDropChance) — so a forest you clear can
  // be a forest you replant. It carries no `grows`: a species-less tree draws
  // off the default growth sheet and takes no hardwood/softwood tier shift.
  { id: 'acorn', name: 'Acorn', kind: 'sapling', plants: 'tree', baseTier: 2 },
  // Rock-break loot. Coal is common + low value, gems are rare + high value.
  // (Gem types deliberately distinct so high-tier rocks feel like a real find.)
  { id: 'coal',     name: 'Flint',    kind: 'mineral' },   // id kept: saves carry 'coal'
  // Sapphire doubles as a one-shot descent charge: tap the Portal button with
  // it selected to spend one gem and sink straight down a level in place.
  // See useSapphirePortal in app.js.
  { id: 'sapphire', name: 'Sapphire', kind: 'mineral' },
  { id: 'ruby',     name: 'Ruby',     kind: 'mineral' },
  { id: 'emerald',  name: 'Emerald',  kind: 'mineral' },
  // Diamond — the Frost-tier (T7) gem, one per rung of the ladder above:
  // sapphire 4 / ruby 5 / emerald 6 / diamond 7. Mined from the T7
  // (frost) mineralrock (interactables.js GEM_BY_TIER) and what every T7
  // piece of jewelry is cut around (gear.js blacksmithRecipe).
  { id: 'diamond',  name: 'Diamond',  kind: 'mineral' },
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
// An item's display name, or its bare id when the catalog has no row for it.
function itemName(id) { return ITEM_BY_ID[id]?.name || id; }

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
// CAMPFIRE WORK — what a lit campfire turns a HELD item into when you tap it
// (interact.js 'fire-held'). One table both sides read: the tap handler and
// the ✦ lines on the inputs. Anything held over a fire that is NOT a key here
// is burned, after a "Burn <name>?" confirm (app.js presentBurnConfirm).
const CAMPFIRE_MAKES = { meat: 'grilled_meat', wood: 'torch',
  ...Object.fromEntries(Object.entries(COOKED_FOODS).map(([raw, c]) => [raw, c.id])) };
// Grilling multiplies the raw cut's energy — and its price, so a grilled
// steak is worth the fire to sell as well as to eat.
const GRILL_ENERGY_MUL = 1.5;
// POTIONS IN THE FIRE (the burn confirm's accept, app.js presentBurnConfirm).
// Two TRANSMUTE into another potion of the SAME tier — never up the ladder, so
// the fire is a curiosity, not a value pump. Every other potion EXPLODES,
// hurting the player by POTION_BLAST_DMG_PER_TIER × its tier, soaked by
// armour like any other blow (Combat.playerDamage).
const POTION_FIRE_TRANSMUTE = { vigor_potion: 'revive_potion', speed_potion: 'reach_potion' };
const POTION_BLAST_DMG_PER_TIER = 3;
function isPotion(id) {
  return ITEM_BY_ID[id]?.potion === true;
}
// What the fire does with one of `id`, burned. One answer both the dialog's
// hint and the accept read: { transmute: id } | { blastDmg: n } | {} (ash).
function fireBurnOutcome(id) {
  if (POTION_FIRE_TRANSMUTE[id]) return { transmute: POTION_FIRE_TRANSMUTE[id] };
  if (isPotion(id)) return { blastDmg: POTION_BLAST_DMG_PER_TIER * (ITEM_BY_ID[id]?.baseTier || 1) };
  return {};
}
// Consumables own their gameplay numbers and button metadata in one table.
// Runtime methods, item copy and the Drink / Use dialog all read these rows,
// so a balance edit cannot leave one surface behind. Function fields receive
// the live scene at click time; items.js loads before those scene dependencies.
const _CONSUMABLE_MINUTE_MS = 60 * 1000;
const CONSUMABLE_SPEC = {
  // Foods with an extra effect use the Eat button, so they own mechanics but
  // no separate action row here.
  rainberry: { radiusM: 20 },
  pairy: { durationMs: 5 * _CONSUMABLE_MINUTE_MS },
  coffee: { durationMs: 3 * _CONSUMABLE_MINUTE_MS, speedTierBoost: 2 },

  egg: {
    verb: 'Hatch', method: 'hatchEgg', title: 'Hatch the egg?',
    get: 'a random pet in your bag, ready to release',
    label: scene => EggHatch.ready(scene.save) ? 'Hatch' : `Hatch · ${EggHatch.remaining(scene.save)} m left`,
    disabled: scene => !EggHatch.ready(scene.save),
    usable: scene => EggHatch.ready(scene.save),
  },
  book: { verb: 'Read', method: 'readBook', title: 'Read the book?', get: '📖 a tip from the elders' },
  honey: {
    radiusM: 30,
    verb: 'Use', method: 'useHoney', title: 'Set out the honey?',
    get: '🍯 lure nearby chickens & cows',
  },
  reach_potion: {
    durationMs: _CONSUMABLE_MINUTE_MS,
    verb: 'Drink', method: 'drinkReachPotion', title: 'Drink the Potion of Reach?',
    get: (_scene, row) => `✨ reach anything in sight for ${shortDuration(row.durationMs)}`,
    channel: true,
  },
  antidote: {
    verb: 'Drink', method: 'drinkAntidote', title: 'Drink the Antidote?',
    get: 'cure poison without restoring energy',
    usable: scene => Conditions.active(scene.save, 'poison'),
  },
  elixir: {
    verb: 'Drink', method: 'drinkElixir', title: 'Drink the Elixir?',
    get: 'restore full energy without curing poison or reviving',
    usable: scene => scene.save.energy > 0 && scene.save.energy < scene.getMaxEnergy(),
  },
  vigor_potion: {
    energy: 40,
    verb: 'Drink', method: 'drinkVigorPotion', title: 'Drink the Potion of Vigor?',
    get: (_scene, row) => `restore ${row.energy} energy`,
  },
  speed_potion: {
    durationMs: _CONSUMABLE_MINUTE_MS, movementTier: 9,
    verb: 'Drink', method: 'drinkSpeedPotion', title: 'Drink the Potion of Speed?',
    get: (_scene, row) => `much faster, cheaper stick walking for ${shortDuration(row.durationMs)}`,
    channel: true,
  },
  shield_potion: {
    durationMs: _CONSUMABLE_MINUTE_MS, damageMul: 0.5,
    verb: 'Drink', method: 'drinkShieldPotion', title: 'Drink the Potion of Shielding?',
    get: (_scene, row) => `${Math.round((1 - row.damageMul) * 100)}% less monster damage for ${shortDuration(row.durationMs)}`,
    channel: true,
  },
  raven_potion: {
    durationMs: _CONSUMABLE_MINUTE_MS,
    verb: 'Drink', method: 'drinkRavenPotion', title: 'Drink the Potion of the Raven?',
    get: (_scene, row) => `🐦 a spirit raven hunts foes & pest crows for ${shortDuration(row.durationMs)}`,
    channel: true,
  },
  thunder_potion: {
    damage: 10,
    verb: 'Drink', method: 'drinkThunderPotion', title: 'Drink the Potion of Thunder?',
    get: (_scene, row) => `⚡ every foe in sight takes ${row.damage} damage, and the rest flee`,
  },
  blight_potion: {
    durationMs: _CONSUMABLE_MINUTE_MS, radiusCells: 1.5, damagePerSecond: 2,
    verb: 'Drink', method: 'drinkBlightPotion', title: 'Drink the Potion of Blight?',
    get: (_scene, row) => `☠ foes within ${row.radiusCells} cells lose ${row.damagePerSecond} HP/s for ${shortDuration(row.durationMs)}`,
    channel: true,
  },
  revive_potion: {
    energyFrac: 0.30,
    verb: 'Drink', method: 'drinkRevivePotion', title: 'Drink the Potion of Revival?',
    get: scene => scene._reviveGetLine('revive_potion'),
    usable: scene => Combat.playerDowned(scene.save.energy),
  },
  resurrection_potion: {
    energyFrac: 0.60,
    verb: 'Drink', method: 'drinkRevivePotion', title: 'Drink the Potion of Resurrection?',
    get: scene => scene._reviveGetLine('resurrection_potion'),
    usable: scene => Combat.playerDowned(scene.save.energy),
  },
  dragon_powder: {
    durationMs: _CONSUMABLE_MINUTE_MS, movementTier: 8, damageMul: 2,
    verb: 'Use', method: 'useDragonPowder', title: 'Use the Dragon Powder?',
    get: (_scene, row) => `🐉 become a dragon for ${shortDuration(row.durationMs)} — faster, cheaper stick walking + ${row.damageMul}× damage`,
  },
  growth_powder: {
    get radiusM() { return CONSUMABLE_SPEC.rainberry.radiusM; },
    verb: 'Use', method: 'useGrowthPowder', title: 'Use the Growth Powder?',
    get: (_scene, row) => `🌱 every crop within ${row.radiusM}m springs ahead a stage`,
  },
  shadow_powder: {
    durationMs: _CONSUMABLE_MINUTE_MS,
    verb: 'Use', method: 'useShadowPowder', title: 'Use the Shadow Powder?',
    get: (_scene, row) => `🌑 monsters ignore you for ${shortDuration(row.durationMs)} — no stalking, no hits`,
  },
  frost_powder: {
    durationMs: 30 * 1000,
    verb: 'Use', method: 'useFrostPowder', title: 'Use the Frost Powder?',
    get: (_scene, row) => `❄ every enemy in reach frozen for ${shortDuration(row.durationMs)}`,
  },
  torch: {
    durationMs: 3 * _CONSUMABLE_MINUTE_MS, radiusMul: 2,
    verb: 'Light', method: 'useTorch', title: 'Light the Torch?',
    get: (scene, row) => scene.isTorchActive()
      ? `🔥 adds ${shortDuration(row.durationMs)} to the ${shortDuration(scene._torchUntil - Date.now())} still burning — your light reaches ${row.radiusMul}× as far`
      : `🔥 your light reaches ${row.radiusMul}× as far for ${shortDuration(row.durationMs)}`,
  },
  sapphire: {
    verb: 'Portal', method: 'useSapphirePortal', title: 'Open a portal down?',
    get: '💎 descend one level',
  },
  rope: {
    verb: 'Climb', method: 'useRopeDown', acceptLabel: 'Down', title: 'Use the rope — which way?',
    get: scene => scene.depth > 0
      ? '🪢 climb up a level, or lower yourself down one'
      : '🪢 lower yourself down a level',
    secondary: { label: 'Up', method: 'useRopeUp', disabled: scene => !(scene.depth > 0) },
  },
};

// Compatibility names keep existing consumers concise while the table remains
// the only numeric owner.
const VIGOR_POTION_ENERGY = CONSUMABLE_SPEC.vigor_potion.energy;
const THUNDER_DMG = CONSUMABLE_SPEC.thunder_potion.damage;
const SPIRIT_RAVEN_MS = CONSUMABLE_SPEC.raven_potion.durationMs;
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
  chicken: 4,      // 150–250/tile
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
  antidote:     12,
  elixir:       360,
  vigor_potion:  35,   // T2 — instant 40-energy restore
  speed_potion:  55,   // T2 — tier-9 boots + amulet stick-walking for 1 min
  shield_potion: 40,   // T2 — half monster damage for 1 min
  blight_potion: 90,   // T3 — 1 min of a 1.5-cell aura at app.js's BLIGHT_DPS
  raven_potion:  90,   // T3 — 1 min of a slime-strength ally (one roster-slime bite
                       //      each second on one foe, below Blight's per-foe rate, but
                       //      it hunts pests and keeps fighting while you move): Blight's tier and price
  revive_potion: 40,   // T2 — get up where you fell with a tenth of the bar
  resurrection_potion: 250,   // T5 — get up where you fell with 60% of the bar
  thunder_potion: 160,   // T4 — THUNDER_DMG to every foe on screen, survivors flee
  dragon_powder: 120,  // T3 — 1 min of dragon: tier-8 boots + amulet walking + 2× damage
  growth_powder: 60,   // T2 — every crop within 20 m springs ahead a stage, unwatered
  shadow_powder: 110,  // T2 — 1 min of monsters ignoring you entirely (priced for the
                       //      effect, not the tier: the T2 butterfly is 100 too)
  frost_powder:  100,  // T3 — every enemy in reach frozen for 30 s
  rope:          15,   // T2 — one climb up or down a level, in place (cheaper than a sapphire's one-way shaft); crafted from 5 long grass, so not a money pump
  trap_kit:      20,   // T2 — permanently removes a trap; situational, not a staple
  magic_trap:    40,   // T2 — one tier-2 shot and a staff beat's hold on one foe; a revive's worth
  torch:          5,   // T1 — 3 min of the player's own light reaching twice as far (useTorch); one wood crafts it, so kept low
  scarecrow: 30,   // crow/deer ward — sold once at the forced scarecrow shop

  // ── Rock-break minerals ──────────────────────────────────
  coal:      3,
  sapphire:  30,
  ruby:      80,
  emerald:  200,
  diamond:  600,   // T7 — above the platinum bar (500), below the crimson (1200)
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
PRICES.grilled_meat = Math.round(PRICES.meat * GRILL_ENERGY_MUL);
for (const [raw, c] of Object.entries(COOKED_FOODS)) {
  PRICES[c.id] = Math.round(PRICES[raw] * GRILL_ENERGY_MUL);
}
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
// the bag, on top of the catch-time money + memory.
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
// Player starts at STARTING_ENERGY; the only thing that ever raises the cap is
// the FIRST-TASTE bonus (each distinct edible ever eaten adds its tier —
// Energy.tasteBonus / maxEnergy).
// Eating food restores energy by FOOD_ENERGY[id]. Actions like rock-break,
// till, and harvest deduct energy via ENERGY_COST and refuse when the current
// pool is too low. ARMOR does not touch the cap: it SOAKS the damage an attack
// takes off the bar (armorReduction below, spent by Combat.mitigate).
// Flower charm — gifting a Flowers stack item to a cash shop (market, fort
// storefront, unclaimed castle) halves its prices at that building for this
// long (the flower-gift branch in app.js shopInteract + shopCharmMul). Lives
// here so the Flowers ✦ line below quotes the live number.
const SHOP_CHARM_MS = 5 * 60 * 1000;
// ITEMS THAT REVIVE: the fraction of the bar each one stands you back up
// with (through Energy.reviveLevel, so it rounds like Home's quarter). The
// Crow Feather is EATEN, and only through the hard-mode lockout (eatSelected);
// the revival potions are DRUNK, only while down (Combat.playerDowned — zero
// energy, either mode), because above zero they would just be Vigor potions.
// One table, read by the eat / drink, the ✦ lines below, the Eat button and
// the Drink dialog.
const REVIVE_ITEM_FRAC = {
  revive_potion: CONSUMABLE_SPEC.revive_potion.energyFrac,
  resurrection_potion: CONSUMABLE_SPEC.resurrection_potion.energyFrac,
};
const revivePct = (id) => Math.round(REVIVE_ITEM_FRAC[id] * 100);
// The Crow Feather stands you up with a flat 1 energy — enough to crawl, not
// to fight: its pocket resurrection only buys the walk home. (It rode the
// table above at 10% until Sep 2026.)
const FEATHER_REVIVE_ENERGY = 1;
// The wild (green) surface slime's leech: energy per bite, one bite a second
// (scene_creatures.js wanderCreatures), before the shield potion, its power,
// the mode and armour. Here so the pest tip quotes the live number. (3 until
// Sep 2026, doubled with the basic goblin's hit.)
const SLIME_LEECH_ENERGY = EnemyRoster.get('slime').dmg;

// ── ITEM GUIDES: the Book pages about a THING ──────────────────────────────
// The one deliberate exception to "what an item does is written on the item,
// not in the Book" (see the Book of Tips header in play_tips.js). For a handful of key
// mechanical items — the Crow Feather, every Home craftable — and two
// behaviours that no single item can explain (flowers as a bargaining tool,
// slimes that can be won over), a page gives the WHY: when to reach for it,
// what it saves you from. It may restate its own item's ✦ line — the test
// (item_descriptions.test.js) exempts a guide against its own key only — but
// it must earn the page with the strategy the ✦ line has no room for.
// Numbers are re-derived from their owners, never retyped. play_tips.js slots
// each guide in where it first becomes actionable.
// The chance a Trap Disarm Kit is KEPT after disarming a trap — one number
// the tap (interact.js 'disarm-trap') rolls and the kit's ✦ line prints.
const TRAP_KIT_KEEP_CHANCE = 0.8;

const ITEM_GUIDE_TIPS = {
  crow_feather: `A Crow Feather is hard mode's pocket resurrection: eaten on an empty bar, it stands you up with ${FEATHER_REVIVE_ENERGY} energy — enough to crawl home, not to fight. Crows drop them. Carry one before any long walk — crawling home is not a strategy, merely a hobby.`,
  scarecrow: 'A scarecrow keeps crows and deer off the crops around it for good, for a little wood at Home. Cheaper than replanting, and it has never once asked for a day off.',
  trap_kit: 'A disarm kit shuts a snare\'s jaw for good: hold it and tap the snare, and most kits live to do it again. Snares favour footpaths, park edges and the stairs underground, so one in the bag costs less than a limp.',
  torch: 'Underground, your light IS your reach, and every level down trims it. A torch doubles it for a while — light one at the top of the stairs, not after you have met the goblin.',
  rope: 'Rope is the exit you carry: up a level, or down one, from wherever you stand. Long grass makes it at Home, so never go deeper than you have rope to climb back.',
  flowers: `A bouquet of wild flowers halves a shop's prices for ${shortDuration(SHOP_CHARM_MS)}. Save it for the relic you have been eyeing, not a packet of seeds — shopkeepers are flattered, not stupid.`,
  slime: 'A slime can be won over as well as beaten, though no net and no food will do it. The very last page knows how. Keep reading — the answer is further in than you would like.',
};

// The ordered Book curriculum lives in play_tips.js because it derives visible
// numbers from Energy, Crops and SpriteLayout after those owners load.

// === Item special effects ====================================
// Short descriptions explain actions, ingredients and ambiguous collectibles. Shown under the inventory bar (the inv-name
// strip) whenever such an item is selected, so a non-obvious power isn't a
// secret the player only learns from a Book. Keyed by item id; absent = no
// special effect (a plain crop / mineral that's just worth money or energy).

const EGG_HATCH_METERS = 500;

const ITEM_EFFECTS = {
  egg: `Walk ${EGG_HATCH_METERS}m with GPS and the game open to hatch one carried egg into a random pet`,
  // Not a secret: the charm is a cash-shop mechanic the player otherwise only
  // meets by accident (tapping a shop with Flowers selected).
  flowers:   `Gift to a shopkeeper: half prices there for ${shortDuration(SHOP_CHARM_MS)}`,
  // Foods with a side-effect when eaten (on top of their energy restore).
  rainberry: `Eat to water every crop within ${CONSUMABLE_SPEC.rainberry.radiusM}m`,
  pairy:     `Eat to reveal the nearest unfound chest for ${shortDuration(CONSUMABLE_SPEC.pairy.durationMs)}; feed to tame a wild cow`,
  coffee:    `Eat to walk faster with the control stick (${shortDuration(CONSUMABLE_SPEC.coffee.durationMs)})`,
  // Universal tame treat — fed to any wild creature. Cave monsters are the
  // one exception, and the line says so: it is the only place that caveat is
  // written now that the Book no longer repeats the mango's effect.
  mango:     'Feed to tame any wild animal — never a cave monster',
  // An ingredient: the Craft page at Home is the only place that says so.
  longgrass: 'Twist 5 into a Rope on Home\'s Craft page',
  // A rock is both: an ingredient (the Craft page's kit) and a placeable
  // (interact.js 'place-rock' — held-and-tapped, so the line has to say so).
  rockfruit: 'Set on a bare tile as a stone; rebuild houses; 4 make a Trap Disarm Kit',
  // Name the portal and forging uses; keep slime taming in the Book's riddle.
  sapphire:  'Open a portal one level down; forge Copper through Crimson amulets at a blacksmith',
  emerald:   'Forge Copper through Crimson staffs at a blacksmith; Frost staffs need Diamonds',
  ruby:      'Sell, barter, or deliver when a house requests it',
  milk:      'Feed to tame a wild cat where it stands',
  boot:      'Old fishing junk to sell, barter, or deliver on request; not wearable',
  shell:     'Beach collectible to sell, barter, or deliver on request',
  rabbit_pelt: 'Hunting trophy to sell, barter, or deliver on request',
  forgetmenot: 'Wild flower to sell, barter, or deliver on request',
  marigold:    'Wild flower to sell, barter, or deliver on request',
  wildrose:    'Wild flower to sell, barter, or deliver on request',
  starflower:  'Wild flower to sell, barter, or deliver on request',
  copper_bar:   'Forge Copper equipment at a blacksmith',
  iron_bar:     'Forge Iron equipment at a blacksmith',
  gold_bar:     'Forge Gold equipment; smelt with Sunflower into Platinum at a blacksmith',
  platinum_bar: 'Forge Platinum equipment; smelt with Fireflower into Crimson at a blacksmith',
  crimson_bar:  'Forge Crimson equipment; smelt with Iceflower into Frost at a blacksmith',
  frost_bar:    'Forge Frost equipment at a blacksmith',
  sunflower:   'Edible; smelt with Gold into Platinum at a blacksmith',
  fireflower:  'Edible; smelt with Platinum into Crimson at a blacksmith',
  iceflower:   'Edible; smelt with Crimson into Frost at a blacksmith',
  // The Frost jewel: where it comes from and what it is for, in one line.
  diamond:   'Mined from Frost ore; Frost jewelry is cut around it',
  // The one FOOD that still works through the hard-mode zero-energy lockout
  // (see PLAY_TIPS; the revival potions are drunk, not eaten) — a tenth of
  // the bar (REVIVE_ITEM_FRAC). Never a normal food: it carries no
  // FOOD_ENERGY entry, so the Eat button only ever offers this while the
  // lockout actually holds.
  crow_feather: `Eat at zero to get up with ${FEATHER_REVIVE_ENERGY} energy (hard mode)`,
  // Consumables used on yourself / the world.
  honey:        `Set out to lure chickens & cows within ${CONSUMABLE_SPEC.honey.radiusM}m`,
  book:         'Read for a play tip or a hint toward a chest',
  reach_potion:  `Drink to reach anything in sight (${shortDuration(CONSUMABLE_SPEC.reach_potion.durationMs)})`,
  antidote:     'Drink to cure poison',
  elixir:       'Drink to fill energy; no cooldown; does not revive or cure poison',
  vigor_potion:  `Drink to restore ${CONSUMABLE_SPEC.vigor_potion.energy} energy`,
  speed_potion:  `Drink for faster control-stick walking at lower energy cost (${shortDuration(CONSUMABLE_SPEC.speed_potion.durationMs)})`,
  shield_potion: `Drink for ${Math.round((1 - CONSUMABLE_SPEC.shield_potion.damageMul) * 100)}% less monster damage (${shortDuration(CONSUMABLE_SPEC.shield_potion.durationMs)})`,
  raven_potion:  `Drink: a spirit raven hunts foes & pests for ${shortDuration(CONSUMABLE_SPEC.raven_potion.durationMs)}`,
  thunder_potion:      `Drink: ${CONSUMABLE_SPEC.thunder_potion.damage} damage to every foe in sight; the rest flee`,
  blight_potion:       `Drink to hurt foes near you ${CONSUMABLE_SPEC.blight_potion.damagePerSecond} HP/s (${shortDuration(CONSUMABLE_SPEC.blight_potion.durationMs)})`,
  revive_potion:       `Drink when down to get up with ${revivePct('revive_potion')}% energy`,
  resurrection_potion: `Drink when down to get up with ${revivePct('resurrection_potion')}% energy`,
  dragon_powder: `Use to become a dragon for ${shortDuration(CONSUMABLE_SPEC.dragon_powder.durationMs)}: faster legs, ${CONSUMABLE_SPEC.dragon_powder.damageMul}× damage`,
  growth_powder: `Use to spring every crop within ${CONSUMABLE_SPEC.growth_powder.radiusM}m ahead a stage`,
  shadow_powder: `Use to make monsters ignore you (${shortDuration(CONSUMABLE_SPEC.shadow_powder.durationMs)})`,
  frost_powder:  `Use to freeze every enemy in reach for ${shortDuration(CONSUMABLE_SPEC.frost_powder.durationMs)}`,
  rope:          'Use to climb up or lower down one level, right here',
  torch:         `Use to make your light reach ${CONSUMABLE_SPEC.torch.radiusMul}× as far (${shortDuration(CONSUMABLE_SPEC.torch.durationMs)})`,
  trap_kit:      `Hold and tap a trap to disarm it (${Math.round(TRAP_KIT_KEEP_CHANCE * 100)}% kept)`,
  magic_trap:    'Hold and tap a cell to set; a foe stepping in is held',
  scarecrow:    'Place on a tilled cell to ward off crows & deer',
  // A sapling's Plant button says it plants something; only this says WHAT.
  // The acorn is the one that puts back timber rather than fruit, which is the
  // whole reason it drops off a fell.
  acorn:        'Plant on bare ground to grow a timber tree',
  // Materials that are also placeables — held-and-tapped, so the line has to
  // say so or nothing does (the rock's line is `rockfruit`, above — its id).
  coal:         'Strike on bare ground to make a campfire',
  // The campfire's recipes (CAMPFIRE_MAKES) — nothing else says a fire cooks.
  meat:         `Hold over a campfire to grill it: ${GRILL_ENERGY_MUL}× energy; feed raw to tame a wild dog`,
  wood:         'Make a torch at a campfire; craft scarecrows at Home; forge wooden equipment at a blacksmith',
};
// Every raw food the fire cooks says so, in the meat's words.
for (const raw of Object.keys(COOKED_FOODS)) {
  ITEM_EFFECTS[raw] = ITEM_EFFECTS[raw] || `Hold over a campfire to cook it: ${GRILL_ENERGY_MUL}× energy`;
}

// Seeds can be offered directly to wild chickens as well as planted.
for (const item of ITEMS.filter(item => item.kind === 'seed')) {
  Object.defineProperty(ITEM_EFFECTS, item.id, {
    enumerable: true,
    get: () => 'Plant in a tilled bed; feed to tame a wild chicken'
      + (typeof Crops !== 'undefined' ? `; watered stage: ${shortDuration(Crops.stageHoldMs(item.grows))}` : ''),
  });
}

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
FOOD_ENERGY.grilled_meat = Math.round(FOOD_ENERGY.meat * GRILL_ENERGY_MUL);
for (const [raw, c] of Object.entries(COOKED_FOODS)) {
  FOOD_ENERGY[c.id] = Math.round(FOOD_ENERGY[raw] * GRILL_ENERGY_MUL);
}
const ENERGY_COST = {
  till: 2,
  plant: 1,
  harvest: 1,
  rockBreak: 9,          // bare-handed; Wood pick → 3, Frost pick → 1 (effectivePickCost).
                         // The in-world rock cost also scales with how far the rock
                         // out-tiers your pick — see the rock-break handler.
  rockPlace: 1,
  catch: 9,              // bare-handed; Wood bug net → 3, Frost → 1 (effectiveCatchCost)
  fish: 9,               // the CURVE's bare-handed rung; a cast pays it × FISH_COST_MULT
                         // (18 bare-handed, 6 with a Wood rod, 2 with a Frost — effectiveFishCost)
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
  dog:     ['meat'],       // raw meat — hunt a deer with the bug net
  // Secret: slimes can be tamed with a sapphire — hinted only in book tips,
  // and true again as of Sep 2026 (ITEM_EFFECTS.sapphire used to spell it out).
  // Not reachable through animalLikesFood in practice: a slime is an enemy, so
  // interact.js takes the sapphire branch and then the combat branch long
  // before the favourite-food path, and no "it wants X" hint ever names this.
  slime:   ['sapphire'],
};
for (const id of ANIMAL_FOOD.cat) {
  if (COOKED_FOODS[id]) ITEM_EFFECTS[id] += '; feed raw to tame a wild cat';
}

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
// `color` is the material's own hue — what a thing MADE of it looks like
// in flight or in the world (the bow's arrows, Combat shots).
const MATERIAL_TIERS = [
  // Wood is 1.5, not 1: at 1 a Wood relic listed at $15-25 and sold for
  // pocket change, so the first tool was an impulse buy rather than a goal.
  // Still under Copper's 3, so the ladder keeps rising.
  { tier: 1, folder: '1. Wood',     name: 'Wood',     costMul: 1.5, effMul: 1.0 , color: 0xb5834f },
  { tier: 2, folder: '2. Cooper',   name: 'Copper',   costMul: 3,   effMul: 1.5 , color: 0xe08a4c },
  { tier: 3, folder: '3. Iron',     name: 'Iron',     costMul: 8,   effMul: 2.2 , color: 0xb9c2cc },
  { tier: 4, folder: '4. Gold',     name: 'Gold',     costMul: 20,  effMul: 3.0 , color: 0xf4cc4a },
  { tier: 5, folder: '5. Platinum', name: 'Platinum', costMul: 50,  effMul: 4.0 , color: 0xe8f1f6 },
  { tier: 6, folder: '6. Crimson',  name: 'Crimson',  costMul: 120, effMul: 5.0 , color: 0xe0384f },
  { tier: 7, folder: '7. Frost',    name: 'Frost',    costMul: 280, effMul: 6.0 , color: 0x8fdcff },
];
const TIER_BY_NUM = Object.fromEntries(MATERIAL_TIERS.map(t => [t.tier, t]));
// Relic SLOT defs. icon=file under Icons/RPG icons/Weapons and Armor/<folder>/.
// effectKey is read by gameplay code (interact.js / loot.js) to apply bonuses.
const RELIC_DEFS = {
  pick:    { slot: 'pick',   name: 'Pickaxe', icon: 'Pickaxe.png', baseCost:  80,
             effectKey: 'rockSpeed',     blurb: 'lets you break rocks' },
  axe:     { slot: 'axe',    name: 'Axe',     icon: 'Axe.png',     baseCost:  80,
             effectKey: 'chopSpeed',     blurb: 'lets you chop trees' },
  // The Ring is TIER luck, and the wizard tower's exclusive gift (his Keen Eye
  // track — src/wizard.js TRACKS). Never sold, never forged.
  ring:    { slot: 'ring',   name: 'Ring',    icon: 'Rings.png',   baseCost:  60,
             effectKey: 'lootTier',      blurb: 'rarer chest loot' },
  // The Amulet is stick walking and nothing else. It also gave QUANTITY luck
  // (a chance at a bigger stack of loot) until Sep 2026, when that became the
  // wizard's Full Measure rung at the same ceiling — see rarity.js qtyLuck.
  amulet:  { slot: 'amulet', name: 'Amulet',  icon: 'Amulet.png',  baseCost:  60,
             effectKey: 'stickWalk',     blurb: 'reduces stick-walking stamina cost' },
  // Weapons (see combat.js). The SWORD is melee — it drains a foe's health on
  // the combat wheel and auto-engages the nearest enemy in reach. BOW and STAFF
  // are ranged — they fire on their own while an enemy is on screen, each on
  // its OWN beat (Combat.fireIntervalMs): the bow along the compass every 2 s,
  // the staff at the nearest foe in range every 5 s (5 damage a bolt at Wood),
  // the next bolt charging by the player's hand in between.
  // These blurbs are the WHOLE disclosure for a weapon — the Book no longer
  // carries a second copy — so the bow's blurb has to say it aims by the
  // compass and the staff's that each bolt costs energy.
  // They fight ENEMIES and nothing else: the crow/deer hunt wheel is the BUG
  // NET's job, not a weapon's. On top of the fighting, the Sword raises sell
  // values and the Bow lowers buy prices; the Staff bends no prices at all.
  sword:   { slot: 'sword',  name: 'Sword',   icon: 'Sword.png',   baseCost:  80,
             effectKey: 'sellPrice',     blurb: 'melee: auto-fights adjacent foes · better sell prices' },
  bow:     { slot: 'bow',    name: 'Bow',     icon: 'Bow.png',     baseCost:  60,
             effectKey: 'buyPrice',      blurb: 'auto-shoots along the compass · 1 wood/20 shots · cheaper buys' },
  staff:   { slot: 'staff',  name: 'Staff',   icon: 'Staff.png',   baseCost:  60,
             effectKey: 'bolt',          blurb: 'ranged: seeks the nearest foe · 1⚡ a bolt' },
  // Watering can — HOW SOON, not what. Every watering has a tier/7 chance
  // (Crops.waterJumpChance) of springing the plant a whole growth stage on the
  // spot: nothing bare-handed, certain at Frost. It used to set produce
  // QUALITY as well, plus 2 more tiers while a refill charge bank held out;
  // quality is the HOE's now (it belongs to the bed, see Crops.bedQuality)
  // and the charge bank retired with it.
  can:     { slot: 'can',    name: 'Watering Can', icon: 'Watering can.png', baseCost: 100,
             effectKey: 'waterJump',     blurb: 'a watering may leap the plant forward a growth stage' },
  // Hoe — the tilling tool, and the one that sets a BED'S QUALITY. Three
  // effects, all per tier: the till wheel shortens on the shared tool ladder;
  // the energy cost drops (floor(tier/3) off the base 2, floored at 1) with a
  // 12%-per-tier chance of costing nothing at all (effectiveTillCost); and the
  // tier is banked on the tilled cell as its produce quality, which the crop
  // planted there carries to harvest (Crops.bedQuality — every quality tier is
  // +10% extra-seed chance and +floor(qual/3) yield). That last one was the
  // watering can's until Sep 2026.
  hoe:     { slot: 'hoe',    name: 'Hoe',     icon: 'Hoe.png',     baseCost:  70,
             effectKey: 'tillQuality',   blurb: 'cheaper tilling, sometimes free · the bed sets crop quality' },
  // Bug Net — THE animal tool. It shortens every wheel that takes a creature:
  // the catch wheel (chicken / cow / cat / dog / rabbit / butterfly) and the
  // crow / deer HUNT wheel, which weapons used to speed. Bare hands work at
  // the tier-0 rung for both, only slowly enough that a quick animal usually
  // slips out of reach first. Single 16×16 icon under Extras (handled by
  // gearAssetPath below).
  bugnet:  { slot: 'bugnet', name: 'Net',         icon: 'Bug net.png',     baseCost: 60,
             effectKey: 'bugCatch',  blurb: 'catch + hunt animals faster' },
  // Fishing Rod — standard 32×16 weapon sheet per tier folder.
  // NOT a gate, the way the net stopped being one: a bare-handed cast works
  // (interact.js 'fishing'), it just runs 9 s instead of 3, costs double and
  // skunks nine casts in ten. What the tier buys is the catch table, the
  // strike rate and the energy per cast, so 'catch fish from water' described
  // a permission the rod does not grant. The blurb names the bare-handed
  // CEILING rather than the ladder (which fish arrives at which tier is the
  // Book's — a ✦ row cannot carry five species), because that ceiling is what
  // tells the player a rod is worth buying at all.
  rod:     { slot: 'rod',    name: 'Fishing Rod', icon: 'Fishing Rod.png', baseCost: 90,
             effectKey: 'fishing',   blurb: 'quicker, cheaper casts — bare hands land only minnows' },
  // Bags — raise the per-stack inventory cap (STACK_CAP_BY_TIER below).
  // Icon lives under Extras (single image, tier shown via badge).
  bags:    { slot: 'bags',   name: 'Bag',         icon: 'Bags.png',        baseCost: 70,
             effectKey: 'stackCap',  blurb: 'carry more of each item' },
};

// Stone a wreck costs to restore, given how many the player has already
// restored: WRECK_RESTORE_BASE_QTY for the first, one more
// (WRECK_RESTORE_PER_HOUSE) for each one behind it, capped at
// WRECK_RESTORE_MAX_QTY — 1, 2, 3 … 20, 20. A whole price, so nothing rolls:
// the dialog's quote is the accept's charge by construction. `key` (the house
// id) is accepted for the callers that pass it and no longer read. Lives with
// the catalog so the Book tip can quote it (books.test re-derives it).
const WRECK_RESTORE_BASE_QTY  = 1;
const WRECK_RESTORE_PER_HOUSE = 1;
const WRECK_RESTORE_MAX_QTY   = 20;
function wreckRestoreExact(restoredCount) {
  return Math.min(WRECK_RESTORE_MAX_QTY,
    WRECK_RESTORE_BASE_QTY + WRECK_RESTORE_PER_HOUSE * (restoredCount || 0));
}
function wreckRestoreQty(restoredCount, key) {   // eslint-disable-line no-unused-vars
  return wreckRestoreExact(restoredCount);
}

// Per-stack inventory cap as a function of the bag tier (0 = no bag).
// Roughly GEOMETRIC, not linear: each tier multiplies the cap by ~1.5-1.7,
// so the first bag is a modest step (9 -> 15) and the big numbers are what
// the top tiers are for. A linear ladder handed a Wood bag 43 of everything,
// nearly a fifth of the ceiling for the cheapest bag in the game.
const STACK_CAP_BY_TIER = [9, 15, 25, 40, 60, 99, 149, 249];
const STACK_CAP_BASE = STACK_CAP_BY_TIER[0];
const STACK_CAP_MAX  = STACK_CAP_BY_TIER[STACK_CAP_BY_TIER.length - 1];
function stackCapForBags(bagsRelic) {
  const t = bagsRelic?.tier || 0;
  if (t <= 0) return STACK_CAP_BASE;
  return STACK_CAP_BY_TIER[Math.min(t, STACK_CAP_BY_TIER.length - 1)];
}
// The four wearable slots. Armor carries NO per-slot effect number: what a
// piece is worth is its TIER, and every slot pays the same for it
// (armorSlotReduction below). Boots also speed up stick walking and soak traps.
// Until Sep 2026 each slot carried its own `energyPerTier` and armour raised
// the max-energy CAP — a bigger bar, which helped exactly as much whether or
// not anything was hitting you. It soaks damage now, so it is worth wearing
// for the reason armour is worth wearing.
// The prices sit CLOSE together (a full set still totals 580 base): the
// pieces are equal protection, so a chestplate at three times the boots read
// as three times the armour.
const ARMOR_DEFS = {
  helmet: { slot: 'helmet', name: 'Helmet',     icon: 'Helmet.png',     baseCost: 135 },
  chest:  { slot: 'chest',  name: 'Chestplate', icon: 'Chestplate.png', baseCost: 165 },
  legs:   { slot: 'legs',   name: 'Leggings',   icon: 'Leggings.png',   baseCost: 150 },
  boots:  { slot: 'boots',  name: 'Boots',      icon: 'Boots.png',      baseCost: 130,
           blurb: 'faster control-stick walking; reduces trap damage' },
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
// ARMOR SOAK — what one worn piece takes off an incoming hit: ITS TIER. A Wood
// helmet is −1, a Frost one is −7, and the four slots sum.
//
// Armour pieces add their tier to the protection pool. Combat.mitigate uses
// that pool to reduce each blow; Hard's receiving-player penalty follows
// mitigation. Enemy armour uses the same engine and declared roster pool.
// Keep this per-piece contribution linear so each equipment tier adds the
// same amount of protection.
//
// This is the ONE place the per-piece number is written. Both sides read it:
// Combat.mitigate spends the pool against a hit, and the Stats panel / shop
// offer print the same figure on the piece itself (app.js) — the
// roadOverlayWidthM discipline, so what the armour SAYS it soaks is what it
// soaks.
function armorSlotReduction(tier) {
  const t = Math.max(0, Math.floor(tier || 0));
  return t;
}

// The whole worn set's pool: the sum of every equipped piece's reduction.
// Unknown slots and empty ones contribute nothing.
function armorReduction(armor) {
  if (!armor) return 0;
  let r = 0;
  for (const [slot, eq] of Object.entries(armor)) {
    if (!eq || !ARMOR_DEFS[slot] || !TIER_BY_NUM[eq.tier]) continue;
    r += armorSlotReduction(eq.tier);
  }
  return r;
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
// AXE → ACORNS. Felling a tree sometimes leaves an acorn behind: a sapling
// that plants a new timber tree (items.js 'acorn', interact.js plant handler),
// so clearing a wood is not a one-way trade. A clean fell recovers more of the
// tree than a hacked one, so the chance climbs with the axe: bare hands (tier
// 0) get the base 10%, a Frost axe a guaranteed 100%, GEOMETRIC between (each
// tier multiplies the previous tier's chance by the same ratio, rather than
// adding a flat step) so the early tiers move the needle less than the late
// ones. Both ends are named so the ratio is one division rather than a magic
// slope.
const ACORN_P_BASE = 0.10;   // bare hands
const ACORN_P_FROST = 1.0;   // tier 7
const ACORN_GEOMETRIC_RATIO = Math.pow(ACORN_P_FROST / ACORN_P_BASE, 1 / 7);
function acornDropChance(relics) {
  const t = Math.max(0, Math.min(7, relics?.axe?.tier || 0));
  return Math.min(ACORN_P_FROST, ACORN_P_BASE * Math.pow(ACORN_GEOMETRIC_RATIO, t));
}
// Bug Net: bare-handed catch expects 9, a Wood net 3, a Frost net 1. The net
// ALSO shortens the catch AND crow/deer hunt wheels (see toolDurationMs).
function effectiveCatchCost(relics, rng) {
  return probEnergy(toolEnergyExpected(relics?.bugnet?.tier || 0), rng);
}
// ── FISHING ────────────────────────────────────────────────────────────────
// Everything a cast rolls, in one place: what it costs, how often it whiffs,
// what junk it pulls and WHICH FISH the rod can land. The handler
// (interact.js 'fishing') spends and flashes; the numbers are here so they can
// be read and tested without a scene.
//
// Sep 2026 — fishing paid too well. A Wood rod landed three species in the
// first minutes at 3⚡ a cast, which made a water tile a better living than
// anything the land offered. Four dials, one direction:
//   • the whiff DOUBLES (FISH_WHIFF_MULT),
//   • the cast COSTS double (FISH_COST_MULT),
//   • the boot DOUBLES (FISH_BOOT_CHANCE, 6% → 12%),
//   • and a species is now GATED on the rod (minTier below) — with bare hands
//     the water holds minnows and nothing else, and each better rod is what
//     puts the next fish in it.
// Cast TIME is untouched and still locked (9s bare / 3s with any rod — see the
// handler): tier buys cheaper, likelier and better catches, never faster ones.

// The whiff ("nothing biting…") ladder. The pre-Sep-2026 curve is kept whole
// and DOUBLED rather than retyped, so what changed stays legible: it fell from
// 55% bare-handed by 5 points a tier to a 20% floor. Doubled, the top of that
// runs past certainty, so FISH_WHIFF_MAX caps it — a cast is never hopeless,
// and the flat stretch it leaves over tiers 0-2 is the point: below an Iron rod
// the water mostly gives you nothing, and what a Wood rod buys is the bass
// (see FISH_SPECIES), not a better strike rate.
const FISH_WHIFF_BASE = 0.55, FISH_WHIFF_PER_TIER = 0.05, FISH_WHIFF_FLOOR = 0.20;
const FISH_WHIFF_MULT = 2;
const FISH_WHIFF_MAX = 0.90;
function fishWhiffChance(tier) {
  const base = Math.max(FISH_WHIFF_FLOOR, FISH_WHIFF_BASE - (tier || 0) * FISH_WHIFF_PER_TIER);
  return Math.min(FISH_WHIFF_MAX, base * FISH_WHIFF_MULT);
}
// What a cast costs, and what it pulls up instead of a fish. The jackpot is
// unchanged — it is the reason to fish at all once the fish stop paying.
const FISH_COST_MULT = 2;
const FISH_JACKPOT_CHANCE = 0.02;   // → a gear roll (rollGearUpgrade)
const FISH_BOOT_CHANCE = 0.12;      // → an Old Boot (was 0.06)
// → a wild SLIME on the line: it lands beside the player and charges (app.js
// fishedSlimeSpawn). Rolled on a strike, after the jackpot and the boot.
const FISH_SLIME_CHANCE = 0.05;
// FOUND TREASURE — a treasure roll at a RANDOM chest tier, turned up by
// chance rather than by a mark: an empty fishing cast (1 in 50) and a hoe's
// furrow (1 in 100). One context and one tier range, shared, and paid with the
// jackpot fanfare + confetti (interact.js grantFoundTreasure).
const FOUND_TREASURE_CONTEXT = 'chest:lowtier';
const FOUND_TREASURE_TIER_MAX = 5;
function rollFoundTreasureTier(rng = Math.random) {
  return 1 + Math.floor(rng() * FOUND_TREASURE_TIER_MAX);
}
// THE EMPTY CAST (Sep 2026, owner's call): a "nothing biting" cast is no
// longer always nothing. Rolled on the whiff only, in this order:
//   • FISH_EMPTY_TREASURE_CHANCE (1 in 50) → found treasure (above),
//   • FISH_SLIME_CHANCE → a slime on the line (the strike's own slime),
//   • FISH_EMPTY_JUNK_CHANCE → junk off the bottom (FISH_EMPTY_JUNK: an Old
//     Boot, a stone, a stick of wood),
//   • else nothing biting, as before.
const FISH_EMPTY_TREASURE_CHANCE = 1 / 50;
const FISH_EMPTY_JUNK_CHANCE = 0.15;
const FISH_EMPTY_JUNK = ['boot', 'rockfruit', 'wood'];
// What an empty cast turns up: { kind: 'treasure', tier } | { kind: 'slime' }
// | { kind: 'junk', id } | null. Pure over `rng`, so tests can drive it.
function rollEmptyCast(rng = Math.random) {
  if (rng() < FISH_EMPTY_TREASURE_CHANCE) return { kind: 'treasure', tier: rollFoundTreasureTier(rng) };
  if (rng() < FISH_SLIME_CHANCE) return { kind: 'slime' };
  if (rng() < FISH_EMPTY_JUNK_CHANCE) {
    return { kind: 'junk', id: FISH_EMPTY_JUNK[Math.floor(rng() * FISH_EMPTY_JUNK.length)] };
  }
  return null;
}
// THE HOE'S FINDS (Sep 2026, owner's call): a finished furrow sometimes
// turns something up, in this order — TILL_TREASURE_CHANCE (1 in 100) found
// treasure, TILL_FLINT_CHANCE (1 in 10) a Flint (item id 'coal'),
// TILL_ROCK_CHANCE (1 in 10) a stone. { kind: 'treasure', tier } |
// { kind: 'item', id } | null.
const TILL_TREASURE_CHANCE = 1 / 100;
const TILL_FLINT_CHANCE = 1 / 10;
const TILL_ROCK_CHANCE = 1 / 10;
function rollTillFind(rng = Math.random) {
  if (rng() < TILL_TREASURE_CHANCE) return { kind: 'treasure', tier: rollFoundTreasureTier(rng) };
  const r = rng();
  if (r < TILL_FLINT_CHANCE) return { kind: 'item', id: 'coal' };
  if (r < TILL_FLINT_CHANCE + TILL_ROCK_CHANCE) return { kind: 'item', id: 'rockfruit' };
  return null;
}
// The catch table. `minTier` is the rod a species needs before it is IN the
// water at all — one species per odd tier, so every rod up the ladder opens
// exactly one new fish and a Frost rod is what the goldenfish is for. `w` is
// the weight once it is available: base + per × tier, so a species also gets
// commoner as the rod improves (and the minnow thins out, floored so it never
// leaves the pool entirely).
const FISH_SPECIES = [
  { id: 'minnow',     minTier: 0, base: 10,   per: -1.0, floor: 0.5 },
  { id: 'bass',       minTier: 1, base: 3,    per: 0.5 },
  { id: 'trout',      minTier: 3, base: 1,    per: 0.5 },
  { id: 'salmon',     minTier: 5, base: 0.3,  per: 0.3 },
  { id: 'goldenfish', minTier: 7, base: 0.05, per: 0.15 },
];
// The weighted pool a rod of this tier is fishing: [{ id, w }], commonest
// first. Never empty — the minnow's minTier is 0, so bare hands still fish.
function fishTable(tier) {
  const t = tier || 0;
  return FISH_SPECIES
    .filter((f) => t >= f.minTier)
    .map((f) => ({ id: f.id, w: Math.max(f.floor ?? 0, f.base + f.per * t) }));
}
// One catch off that pool. `rng` is injected so tests can pin the roll.
function rollFish(tier, rng) {
  const table = fishTable(tier);
  const total = table.reduce((a, b) => a + b.w, 0);
  let r = ((rng || Math.random)()) * total;
  for (const f of table) { r -= f.w; if (r <= 0) return f.id; }
  return table[table.length - 1].id;
}
// Fishing Rod: the shared 9/3/1 tool curve × FISH_COST_MULT, so a bare-handed
// cast expects 18, a Wood rod 6 and a Frost rod 2. The multiplier is fishing's
// own — chop / mine / catch keep the plain ladder.
function effectiveFishCost(relics, rng) {
  return probEnergy(FISH_COST_MULT * toolEnergyExpected(relics?.rod?.tier || 0), rng);
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
// still need it (gated in the catch path).
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
// that's the loudest, because a foe of BASELINE_HP has a kill time in seconds
// that IS the duration here (see combat.js): wood 3s / copper 2.5s / iron 2s
// was a wooden sword killing nearly as fast as an iron one. (The surface slime
// was that reference foe until Sep 2026; it is 10 HP now, so it dies in two
// thirds of a rung — the ladder's SHAPE is what this paragraph is about, and
// that is unchanged.) Wood also moved 3s
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
// Stick walking: boots set speed; the amulet reduces energy per cell.
// GPS walking stays free and uses its own pace. Buffs can lend tiers to both.
// Speed runs from 4.8× walk without boots to 24× at Frost; cost runs from
// 1 pip/cell without an amulet to 0.15 at Frost.
// The floor came down 20% (6 → 4.8, Sep 2026, owner's call): the stick is
// the walk you didn't take, and bare-handed it outpaced the reason to walk.
const STEER_MUL_FLOOR = 4.8;    // bare hands
// 24, up from 15.5. The ladder ran 6x to 15.5x, which sounds wide and does not
// PLAY wide: 1.2 cells a second bare-handed against 3.1 at the top, so tier-8
// boots felt like tier-0 boots with a tailwind and a coffee (+1 tier, ~9% at
// the top end) did nothing you could feel. The whole widening landed in the
// per-tier step; the floor has since moved on its own (above).
const STEER_MUL_FROST = 24;   // tier 7 boots
// THE BIKE RACK (a bicycle_parking POI — loot.js isBikeRack): a tap lends
// the stick walk BIKE_RACK_SPEED_MUL (+100%) for BIKE_RACK_MS, once a UTC day
// per rack. It is one more REASON in this lane, not a speed system of its
// own: app.js _walkRelics reads save.bikeUntil and hands the factor on the
// boots as `boost`, and steerSpeedMul multiplies it in — so it rides every
// path the stick speed rides (the stick, the drift home) and none of the GPS
// walk's, which never reads this function. A multiplier rather than lent
// tiers because the promise is "twice as fast", whatever boots are worn.
const BIKE_RACK_SPEED_MUL = 2;
const BIKE_RACK_MS = 3 * 60 * 1000;
function steerSpeedMul(gear) {
  const t = gear?.boots?.tier || 0;
  const boost = gear?.boots?.boost > 0 ? gear.boots.boost : 1;
  // The Frost end is its own tuned endpoint (STEER_MUL_FROST, above), so the
  // per-tier step absorbs any move of the floor instead of every tier
  // shifting with it.
  return (STEER_MUL_FLOOR + ((STEER_MUL_FROST - STEER_MUL_FLOOR) / 7) * t) * boost;
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
// What Home CRAFTS — the Craft page beside the Sell page at the trailer
// (app.js presentHomeCraft). One row per recipe, in the order the page's
// "Next" button walks them; each craft makes one of `id` from `cost`.
const HOME_RECIPES = [
  { id: 'torch',     cost: [{ id: 'wood', qty: 1 }] },
  { id: 'scarecrow', cost: [{ id: 'wood', qty: 3 }] },
  // Five strands of long grass twist into one rope — the way back up a cave
  // without buying one or finding one in a shallow cave chest.
  { id: 'rope',      cost: [{ id: 'longgrass', qty: 5 }] },
  // Four stones knock a snare's jaw shut for good.
  { id: 'trap_kit',  cost: [{ id: 'rockfruit', qty: 4 }] },
];
// On HARD, Home can only craft what the player has first FOUND out in the
// world — a chest, a pickup, a drop — never bought, bartered, forged or
// crafted. save.foundWild is that ledger (app.js addToInv writes it for every
// grant not flagged `notWild`). Easy crafts everything from the start.
function homeRecipeLocked(save, id, hard) {
  return !!hard && !(save && save.foundWild && save.foundWild[id]);
}
// How many times a recipe can be made from what is held: the fewest times
// any one ingredient covers its share. `count(id)` reads the bag. An empty
// recipe makes nothing — the min over no ingredients would be Infinity.
function recipeCap(cost, count) {
  if (!Array.isArray(cost) || !cost.length) return 0;
  return Math.max(0, cost.reduce((m, r) => Math.min(m, Math.floor(count(r.id) / r.qty)), Infinity));
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

// ── Which GROUND takes a hoe ───────────────────────────────────────────────
// Tillable = soil-ish ground. Concrete pads / cement (commercial/industrial),
// water, all road tiers, paths, every building tier, and rock are NOT tillable.
// Rock (10) is non-tillable — mineral rocks spawn as objects on rock terrain
// instead. 23 = PIER (wooden walkway over water) — walkable but not soil.
//
// A terrain-code table, read by app.js' till handler, interact.js' tap gates
// and render.js' tilled-cell draw. It lived in app.js until Sep 2026, which is
// why the headless suite had to parse the Set out of app.js' source text to
// know which codes interact.js' flavour handler had to cover.
// 31 = TAR_YARD (an influence zone's halo round a fuel station, src/zones.js):
// oily ground that weeps tar — nothing takes root in it.
const NON_TILLABLE = new Set([3, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 23, 24, 25, 31]);
function isTillable(type) { return !NON_TILLABLE.has(type); }
// The full "can this CELL take a hoe / placement / released animal" test:
// soil-ish terrain AND no drawn road band over it. A cell's terrain says
// "grass" for most of the ground a road actually covers (see cellAt's
// underRoad note), so type-only checks let players till the middle of a
// street. Takes a cellAt() result; a stub cell without underRoad (tests)
// behaves exactly like the old type-only check.
function isTillableCell(cell) { return isTillable(cell.type) && !cell.underRoad; }

// ── The inventory's type tabs ──────────────────────────────────────────────
// The two-bar inventory's category row. Order here is the on-screen left→right
// order. Item categories filter save.inv by `kind`; gear categories (relic /
// armor) synthesize their slot list from save.relics / save.armor
// (one-per-slot) instead of save.inv. `sym` is the tab glyph — plain emoji so
// no new pixel art is needed for the chrome.
//
// A table over item KINDS, so it belongs with the catalog that defines them:
// a kind added to ITEMS without a home here falls into Produce, and only this
// file can see both halves of that.
const INV_CATS = [
  { key: 'seed',        label: 'Seeds',       sym: '🌱', kinds: ['seed', 'sapling'] },
  { key: 'produce',     label: 'Produce',     sym: '🍎', kinds: ['produce'] },
  { key: 'animal',      label: 'Animals',     sym: '🐔', kinds: ['animal'] },
  { key: 'relic',       label: 'Relics',      sym: '💍', gear: 'relic' },
  { key: 'armor',       label: 'Armor',       sym: '🛡️', gear: 'armor' },
  { key: 'ores',        label: 'Ores',        sym: '💎', kinds: ['mineral'] },
  { key: 'magic',       label: 'Magic',       sym: '🧪', kinds: ['magic'] },
  { key: 'supplies',    label: 'Supplies',    sym: '🎒', kinds: ['supply'] },
];
const INV_CAT_BY_KEY = Object.fromEntries(INV_CATS.map(c => [c.key, c]));
// Items whose TAB is not their kind's. Rock is the `rockfruit` crop — a
// 'produce' item to the seed/sell/loot machinery, which keys on kind — but the
// player files it with the wood and the ore it is gathered beside, so only its
// tab moves. The kind stays put: re-kinding it would move its price, its loot
// class and its Eat button along with the tab.
const INV_CAT_OVERRIDE = { rockfruit: 'ores' };
// Which type tab an item id belongs to (its override, else its `kind`). Falls
// back to the Produce tab for anything unmapped so a stray item is still
// reachable. The ONE answer: the tab filter (app.js invEntriesForCat) asks it
// too, so the tab a pickup jumps to is the tab the stack is listed in.
function invCatForItem(id) {
  if (INV_CAT_OVERRIDE[id]) return INV_CAT_OVERRIDE[id];
  const kind = ITEM_BY_ID[id]?.kind;
  for (const c of INV_CATS) if (c.kinds && c.kinds.includes(kind)) return c.key;
  return 'produce';
}
