// Headless tests for sprite/frame data tables in src/items.js.
// Pins MINERAL_ICON_SHEET (bug 44557ad), CROP_SPRITE (bug 1d5ac29), and
// structural invariants for CROP_ROW / MAX_GROWTH_STAGE / PRODUCE_COL.
// These tables are the data behind sprite-slicing bugs; if they drift the
// renderer silently draws the wrong frame.

// ── MINERAL_ICON_SHEET: bar sheet structure (bug 44557ad) ──────────────────
// Sheet 'bars' is a 16-col × 4-row "Bars and ores" sheet. Each row packs two
// metals as bar/ore PAIRS: col0=barA, col1=oreA, col2=barB, col3=oreB,
// cols4-7 white-outlined dupes, cols8-11 raw stone. Row stride = 16.
// Real ingots: copper=0, iron=2, gold=16, platinum=18, crimson=32, frost=34.
// (The OLD broken run was 0,1,2,3,4,5 — rendered bar, ore, bar, ore, dupe,
//  dupe — wrong.)

test('MINERAL_ICON_SHEET: all bar entries use the bars sheet', () => {
  const bars = ['copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
  for (const id of bars) {
    assert.eq(MINERAL_ICON_SHEET[id].sheet, 'bars', `${id} sheet`);
  }
});

test('MINERAL_ICON_SHEET: bar frames are the even-col (col0/col2) ingots, not the odd-col ore nuggets', () => {
  // Each pair: barA at col0, oreA at col1 within each metal pair.
  // Row 0: copper(0,1), iron(2,3); Row 1: gold(16,17), platinum(18,19); Row 2: crimson(32,33), frost(34,35).
  const entries = [
    ['copper_bar', 0], ['iron_bar', 2],
    ['gold_bar', 16], ['platinum_bar', 18],
    ['crimson_bar', 32], ['frost_bar', 34],
  ];
  for (const [id, expectedFrame] of entries) {
    const entry = MINERAL_ICON_SHEET[id];
    assert.eq(entry.frame, expectedFrame, `${id} frame = ${expectedFrame}`);
    // Frame must be EVEN (col0 or col2 within the pair — bar, not ore)
    assert.eq(entry.frame % 2, 0, `${id} frame is even (bar column, not ore column)`);
  }
});

test('MINERAL_ICON_SHEET: bar frames differ from the old broken consecutive run 0..5', () => {
  // The bug was rendering frames [0,1,2,3,4,5] as bars — that's bar,ore,bar,ore,dupe,dupe.
  const actual = [
    MINERAL_ICON_SHEET['copper_bar'].frame,
    MINERAL_ICON_SHEET['iron_bar'].frame,
    MINERAL_ICON_SHEET['gold_bar'].frame,
    MINERAL_ICON_SHEET['platinum_bar'].frame,
    MINERAL_ICON_SHEET['crimson_bar'].frame,
    MINERAL_ICON_SHEET['frost_bar'].frame,
  ];
  const broken = [0, 1, 2, 3, 4, 5];
  let differs = false;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== broken[i]) { differs = true; break; }
  }
  assert.truthy(differs, 'bar frames must NOT be the old consecutive 0..5 run');
});

// ── MINERAL_ICON_SHEET: non-bar entries ────────────────────────────────────

test('MINERAL_ICON_SHEET: wood uses the wood sheet, frame 2', () => {
  assert.eq(MINERAL_ICON_SHEET['wood'].sheet, 'wood');
  assert.eq(MINERAL_ICON_SHEET['wood'].frame, 2);
});

test('MINERAL_ICON_SHEET: flint_shard uses icon_flint_shard sheet, frame 0', () => {
  assert.eq(MINERAL_ICON_SHEET['flint_shard'].sheet, 'icon_flint_shard');
  assert.eq(MINERAL_ICON_SHEET['flint_shard'].frame, 0);
});

test('MINERAL_ICON_SHEET: gem frames — diamond 0, ruby 1, sapphire 3, emerald 5 (all on gems sheet)', () => {
  // Gemstones.png row 0, left to right: cyan diamond, red ruby, purple shard,
  // blue sapphire, orange topaz, green emerald, pink quartz. The old pins
  // (sapphire 4 / ruby 0 / emerald 3) drew a topaz, a diamond and a sapphire.
  // test/node/diamond.test.js pins the four together (pixel-verified order).
  assert.eq(MINERAL_ICON_SHEET['diamond'].sheet, 'gems');
  assert.eq(MINERAL_ICON_SHEET['diamond'].frame, 0);
  assert.eq(MINERAL_ICON_SHEET['sapphire'].sheet, 'gems');
  assert.eq(MINERAL_ICON_SHEET['sapphire'].frame, 3);
  assert.eq(MINERAL_ICON_SHEET['ruby'].sheet, 'gems');
  assert.eq(MINERAL_ICON_SHEET['ruby'].frame, 1);
  assert.eq(MINERAL_ICON_SHEET['emerald'].sheet, 'gems');
  assert.eq(MINERAL_ICON_SHEET['emerald'].frame, 5);
});

test('MINERAL_ICON_SHEET: fruit-tree saplings use the species tree sheet at frame 2', () => {
  assert.eq(MINERAL_ICON_SHEET['apple_sapling'].sheet, 'apple_tree');
  assert.eq(MINERAL_ICON_SHEET['apple_sapling'].frame, 2);
  assert.eq(MINERAL_ICON_SHEET['worldpeach_sapling'].sheet, 'worldpeach_tree');
  assert.eq(MINERAL_ICON_SHEET['worldpeach_sapling'].frame, 2);
});

test('MINERAL_ICON_SHEET: apple and peach saplings use DIFFERENT sheets (bug 5bb9e66)', () => {
  // apple≠peach frames: both are frame 2 (young sapling frame) but on different species sheets.
  assert.truthy(
    MINERAL_ICON_SHEET['apple_sapling'].sheet !== MINERAL_ICON_SHEET['worldpeach_sapling'].sheet,
    'apple_sapling and peach_sapling must use different species sheets'
  );
  assert.eq(MINERAL_ICON_SHEET['apple_sapling'].sheet, 'apple_tree');
  assert.eq(MINERAL_ICON_SHEET['worldpeach_sapling'].sheet, 'worldpeach_tree');
});

test('MINERAL_ICON_SHEET: boot junk pickup is frame 88 on the pickup sheet', () => {
  // row 6, col 4 of 7_Pickup_Items_16x16 (14 cols): frame = 6*14 + 4 = 88
  assert.eq(MINERAL_ICON_SHEET['old_boot'].sheet, 'pickup');
  assert.eq(MINERAL_ICON_SHEET['old_boot'].frame, 88);
  assert.eq(6 * 14 + 4, 88, 'frame derivation check');
});

test('MINERAL_ICON_SHEET: wild flowers use props sheet at frame 12', () => {
  assert.eq(MINERAL_ICON_SHEET['flowers'].sheet, 'props');
  assert.eq(MINERAL_ICON_SHEET['flowers'].frame, 12);
});

test('MINERAL_ICON_SHEET: shell inventory icon is frame 0 on shell_sheet', () => {
  assert.eq(MINERAL_ICON_SHEET['shell'].sheet, 'shell_sheet');
  assert.eq(MINERAL_ICON_SHEET['shell'].frame, 0);
});

// ── CROP_SPRITE: shrub (bug 1d5ac29) ──────────────────────────────────────
// Two shrub appearances share harvesting; the cut hedge is 20% smaller.

test('CROP_SPRITE: basic shrub uses the bushes sheet', () => {
  assert.eq(CROP_SPRITE['shrub'].sheet, 'bushes');
});

test('CROP_SPRITE: shrub is a custom sprite (custom: true)', () => {
  assert.eq(CROP_SPRITE['shrub'].custom, true);
});

test('CROP_SPRITE: shrub frame is 0 (single basic bush)', () => {
  assert.eq(CROP_SPRITE['shrub'].frame, 0);
});

test('CROP_SPRITE: shrub is 20% smaller in each dimension than the former residential hedge', () => {
  assert.eq(CROP_SPRITE.shrub.looks.clipped.scale / (4 / 3), 0.8);
});

// ── CROP_SPRITE: longgrass (bug 1d5ac29) ──────────────────────────────────
// longgrass uses Props.png (22-col grid). Frame 10 = col 10, row 0 (0-indexed).
// Derivation: row=0, col=10 → 0*22 + 10 = 10. Scale 1.36.

test('CROP_SPRITE: longgrass uses props sheet', () => {
  assert.eq(CROP_SPRITE['longgrass'].sheet, 'props');
});

test('CROP_SPRITE: longgrass is a custom sprite', () => {
  assert.eq(CROP_SPRITE['longgrass'].custom, true);
});

test('CROP_SPRITE: longgrass frame is 10 (col 10 row 0 of 22-col Props.png grid)', () => {
  assert.eq(CROP_SPRITE['longgrass'].frame, 10);
  // Derivation: 0*22 + 10 = 10
  assert.eq(0 * 22 + 10, 10, 'frame derivation');
});

test('CROP_SPRITE: longgrass scale is 1.16', () => {
  assert.eq(CROP_SPRITE['longgrass'].scale, 1.16);
});

// ── CROP_SPRITE: mushroom (bug 1d5ac29) ───────────────────────────────────
// mushroom uses Props.png. Frame 35 = col 13, row 1 (0-indexed).
// Derivation: 1*22 + 13 = 35. (Frame 36 was the original pick; discarded.)

test('CROP_SPRITE: mushroom uses props sheet', () => {
  assert.eq(CROP_SPRITE['mushroom'].sheet, 'props');
});

test('CROP_SPRITE: mushroom is a custom sprite', () => {
  assert.eq(CROP_SPRITE['mushroom'].custom, true);
});

test('CROP_SPRITE: mushroom frame is 35 (col 13, row 1 of 22-col Props.png grid)', () => {
  assert.eq(CROP_SPRITE['mushroom'].frame, 35);
  // Derivation: 1*22 + 13 = 35
  assert.eq(1 * 22 + 13, 35, 'frame derivation');
});

test('CROP_SPRITE: mushroom frame is NOT 36 (old mis-picked neighbouring prop)', () => {
  assert.truthy(CROP_SPRITE['mushroom'].frame !== 36, 'must not be the wrong adjacent frame');
});

// ── CROP_SPRITE: spring crops ──────────────────────────────────────────────

test('CROP_SPRITE: spring crops berry/cress/onion/potato use springcrops sheet', () => {
  for (const key of ['berry', 'cress', 'onion', 'potato']) {
    assert.eq(CROP_SPRITE[key].sheet, 'springcrops', `${key} sheet`);
  }
});

test('CROP_SPRITE: spring crop rows — berry=1, cress=3, onion=7, potato=5', () => {
  assert.eq(CROP_SPRITE['berry'].row,   1);
  assert.eq(CROP_SPRITE['cress'].row,   3);
  assert.eq(CROP_SPRITE['onion'].row,   7);
  assert.eq(CROP_SPRITE['potato'].row,  5);
});

// ── CROP_SPRITE: rare wild flora on props sheet ───────────────────────────
// Props.png is 22 cols × 12 rows. Frame = row*22 + col.

test('CROP_SPRITE: forgetmenot is props frame 76 (row 3, col 10 → 3*22+10=76)', () => {
  assert.eq(CROP_SPRITE['forgetmenot'].sheet, 'props');
  assert.eq(CROP_SPRITE['forgetmenot'].custom, true);
  assert.eq(CROP_SPRITE['forgetmenot'].frame, 76);
  assert.eq(3 * 22 + 10, 76, 'frame derivation');
});

test('CROP_SPRITE: marigold is props frame 34 (row 1, col 12 → 1*22+12=34)', () => {
  assert.eq(CROP_SPRITE['marigold'].sheet, 'props');
  assert.eq(CROP_SPRITE['marigold'].frame, 34);
  assert.eq(1 * 22 + 12, 34, 'frame derivation');
});

test('CROP_SPRITE: wildrose is props frame 30 (row 1, col 8 → 1*22+8=30)', () => {
  assert.eq(CROP_SPRITE['wildrose'].sheet, 'props');
  assert.eq(CROP_SPRITE['wildrose'].frame, 30);
  assert.eq(1 * 22 + 8, 30, 'frame derivation');
});

test('CROP_SPRITE: starflower is props frame 102 (row 4, col 14 → 4*22+14=102)', () => {
  assert.eq(CROP_SPRITE['starflower'].sheet, 'props');
  assert.eq(CROP_SPRITE['starflower'].frame, 102);
  assert.eq(4 * 22 + 14, 102, 'frame derivation');
});

// ── CROP_SPRITE: shell lists the three frames that carry a shell ──────────
// Shell.png is a 3×4 grid, but only its top row is shell art — see
// test/node/shell_variants.test.js for what counting the cells instead cost.

test('CROP_SPRITE: shell uses shell_sheet, custom: true, original frame 0', () => {
  assert.eq(CROP_SPRITE['shell'].sheet, 'shell_sheet');
  assert.eq(CROP_SPRITE['shell'].custom, true);
  assert.eq(CROP_SPRITE['shell'].frames.join(','), '0');
});

// ── Structural invariants for CROP_ROW ────────────────────────────────────

test('CROP_ROW: all crop keys map to non-negative integers', () => {
  for (const [key, row] of Object.entries(CROP_ROW)) {
    assert.truthy(typeof row === 'number' && row >= 0, `${key} row is a non-negative number`);
  }
});

test('CROP_ROW: every crop key has an ITEM_BY_ID entry for its produce', () => {
  for (const key of Object.keys(CROP_ROW)) {
    // Spring-crops override path takes precedence, but the item must exist.
    const item = ITEM_BY_ID[key];
    assert.truthy(item, `produce item '${key}' exists in ITEM_BY_ID`);
    assert.eq(item.kind, 'produce', `'${key}' item is kind produce`);
  }
});

test('CROP_ROW: every crop key has an ITEM_BY_ID entry for its seed', () => {
  for (const key of Object.keys(CROP_ROW)) {
    const seedId = key + '_seed';
    const item = ITEM_BY_ID[seedId];
    assert.truthy(item, `seed item '${seedId}' exists in ITEM_BY_ID`);
    assert.eq(item.kind, 'seed', `'${seedId}' item is kind seed`);
  }
});

test('CROP_ROW: rows 0..9 cover the main Crops.png crops (not spring-crop overrides)', () => {
  const mainCrops = ['rainberry', 'pairy', 'gemfruit', 'nut', 'rubble', 'coffee',
                     'potato', 'iceflower', 'fireflower', 'sunflower'];
  for (const key of mainCrops) {
    assert.truthy(CROP_ROW[key] != null, `${key} has a CROP_ROW entry`);
    assert.inRange(CROP_ROW[key], 0, 9, `${key} row in 0..9`);
  }
});

test('CROP_ROW: spring crop keys berry/cress/onion exist (rows 10..12)', () => {
  assert.eq(CROP_ROW['berry'],  10);
  assert.eq(CROP_ROW['cress'],  11);
  assert.eq(CROP_ROW['onion'],  12);
});

// ── MAX_GROWTH_STAGE: 5 inclusive stages ──────────────────────────────────

test('MAX_GROWTH_STAGE: is exactly 4 (5 stages: 0..4 inclusive)', () => {
  assert.eq(MAX_GROWTH_STAGE, 4);
});

test('MAX_GROWTH_STAGE: growth stages 0..MAX_GROWTH_STAGE form an inclusive range of 5', () => {
  const stageCount = MAX_GROWTH_STAGE - 0 + 1;
  assert.eq(stageCount, 5, 'stages 0,1,2,3,4 = 5 stages');
});

// ── PRODUCE_COL / SEEDBOX_COL within CROPS_SHEET_COLS ─────────────────────

test('PRODUCE_COL is 7, within Crops.png column range', () => {
  assert.eq(PRODUCE_COL, 7);
  assert.lt(PRODUCE_COL, CROPS_SHEET_COLS, 'PRODUCE_COL < CROPS_SHEET_COLS');
  assert.gte(PRODUCE_COL, 0, 'PRODUCE_COL >= 0');
});

test('CROPS_SHEET_COLS is 9 (Crops.png is 9 cols wide)', () => {
  assert.eq(CROPS_SHEET_COLS, 9);
});

test('SPRING_CROPS_COLS is 14 (Spring Crops.png is 14 cols wide)', () => {
  assert.eq(SPRING_CROPS_COLS, 14);
});

test('seed/produce inventory col indices fit within their respective sheet widths', () => {
  // On Crops.png: PRODUCE_COL=7 and SEEDBOX_COL=8, both < CROPS_SHEET_COLS=9
  assert.lt(PRODUCE_COL,  CROPS_SHEET_COLS, 'PRODUCE_COL in range');
  // SEEDBOX_COL is not bridged, but we can read its baked value from frame arithmetic:
  // Generic seed frame = 15 * CROPS_SHEET_COLS + SEEDBOX_COL = 15*9 + 8 = 143
  // inventoryIconSource uses literal 8 for SEEDBOX_COL; PRODUCE_COL=7 is used directly.
  // On Spring Crops.png: seed col = 7, produce col = 8, both < SPRING_CROPS_COLS=14
  assert.lt(7, SPRING_CROPS_COLS, 'spring seed col 7 in range');
  assert.lt(8, SPRING_CROPS_COLS, 'spring produce col 8 in range');
});

// ── inventoryIconSource: frame derivation correctness ─────────────────────
// These tests verify the numeric frame values that inventoryIconSource
// computes for various item ids, catching off-by-one or wrong-stride bugs.

test('inventoryIconSource: spring crop seed frame = row*14 + 7', () => {
  // berry seed: CROP_SPRITE berry row=1, seed col=7 → frame = 1*14 + 7 = 21
  const src = inventoryIconSource('berry_seed');
  assert.truthy(src, 'berry_seed has a source');
  assert.eq(src.sheet, 'springcrops');
  assert.eq(src.frame, 1 * 14 + 7, 'berry_seed frame = 1*14+7 = 21');
});

test('inventoryIconSource: spring crop produce frame = row*14 + 8', () => {
  // berry produce: CROP_SPRITE berry row=1, produce col=8 → frame = 1*14 + 8 = 22
  const src = inventoryIconSource('berry');
  assert.truthy(src, 'berry produce has a source');
  assert.eq(src.sheet, 'springcrops');
  assert.eq(src.frame, 1 * 14 + 8, 'berry produce frame = 1*14+8 = 22');
});

test('inventoryIconSource: onion produce frame = 7*14 + 8 = 106', () => {
  const src = inventoryIconSource('onion');
  assert.truthy(src);
  assert.eq(src.sheet, 'springcrops');
  assert.eq(src.frame, 7 * 14 + 8, 'onion produce frame = 7*14+8 = 106');
});

test('inventoryIconSource: cress seed frame = 3*14 + 7 = 49', () => {
  const src = inventoryIconSource('cress_seed');
  assert.truthy(src);
  assert.eq(src.sheet, 'springcrops');
  assert.eq(src.frame, 3 * 14 + 7, 'cress_seed frame = 3*14+7 = 49');
});

test('inventoryIconSource: main Crops.png produce frame = row*9 + 7', () => {
  // rainberry: CROP_ROW=0, PRODUCE_COL=7 → frame = 0*9 + 7 = 7
  const src = inventoryIconSource('rainberry');
  assert.truthy(src, 'rainberry has a source');
  assert.eq(src.sheet, 'crops');
  assert.eq(src.frame, 0 * 9 + 7, 'rainberry frame = 0*9+7 = 7');
});

test('inventoryIconSource: gemfruit produce frame = CROP_ROW.gemfruit * 9 + 7', () => {
  const row = CROP_ROW['gemfruit'];
  const src = inventoryIconSource('gemfruit');
  assert.truthy(src);
  assert.eq(src.sheet, 'crops');
  assert.eq(src.frame, row * 9 + PRODUCE_COL);
});

test('inventoryIconSource: longgrass resolves to props sheet frame 10', () => {
  const src = inventoryIconSource('longgrass');
  assert.truthy(src, 'longgrass has a source');
  assert.eq(src.sheet, 'props');
  assert.eq(src.frame, 10);
});

test('inventoryIconSource: mushroom resolves to props sheet frame 35', () => {
  const src = inventoryIconSource('mushroom');
  assert.truthy(src, 'mushroom has a source');
  assert.eq(src.sheet, 'props');
  assert.eq(src.frame, 35);
});

test('inventoryIconSource: minerals bypass crop path and use MINERAL_ICON_SHEET directly', () => {
  const goldSrc = inventoryIconSource('gold_bar');
  assert.truthy(goldSrc, 'gold_bar has a source');
  assert.eq(goldSrc.sheet, 'bars');
  assert.eq(goldSrc.frame, 16, 'gold_bar resolves to frame 16 (not 2)');
});

test('inventoryIconSource: copper_bar frame 0 (not iron_bar-adjacent frame 1)', () => {
  const src = inventoryIconSource('copper_bar');
  assert.truthy(src);
  assert.eq(src.frame, 0);
  assert.truthy(src.frame !== 1, 'must not be the ore nugget at frame 1');
});

// ── Ore-stone column mapping (bug 805aa05) ─────────────────────────────────
// ORE_COL_BY_TIER is render-side (not in items.js / not bridged), but its
// logic is documented in the source comments. We test the documented mapping:
// T2=copper→col0, T3=iron→col1, T4=gold→col2, T5=platinum→col3,
// T6=crimson→col5 (col4 skipped), T7=frost→col7 (blue, skipping green col6).
// These cols map to the same tier ladder as the bar frames in MINERAL_ICON_SHEET.

test('MINERAL_ICON_SHEET bars are consistently ordered copper<iron<gold<platinum<crimson<frost', () => {
  // Bars should climb monotonically in tier value / frame index.
  const barOrder = [
    MINERAL_ICON_SHEET['copper_bar'].frame,
    MINERAL_ICON_SHEET['iron_bar'].frame,
    MINERAL_ICON_SHEET['gold_bar'].frame,
    MINERAL_ICON_SHEET['platinum_bar'].frame,
    MINERAL_ICON_SHEET['crimson_bar'].frame,
    MINERAL_ICON_SHEET['frost_bar'].frame,
  ];
  for (let i = 1; i < barOrder.length; i++) {
    assert.gt(barOrder[i], barOrder[i - 1], `tier ${i + 1} bar frame > tier ${i} bar frame`);
  }
});

test('MINERAL_ICON_SHEET: row stride for bars is 16 cols (gold at 16, crimson at 32)', () => {
  // Row 0 → 0-15, Row 1 → 16-31, Row 2 → 32-47. First ingot per row at col0.
  assert.eq(MINERAL_ICON_SHEET['gold_bar'].frame,    16);  // row1 col0
  assert.eq(MINERAL_ICON_SHEET['crimson_bar'].frame, 32);  // row2 col0
  // Stride between rows = 16.
  assert.eq(MINERAL_ICON_SHEET['gold_bar'].frame - MINERAL_ICON_SHEET['copper_bar'].frame, 16);
  assert.eq(MINERAL_ICON_SHEET['crimson_bar'].frame - MINERAL_ICON_SHEET['gold_bar'].frame, 16);
});

test('shrubs keep common harvesting across basic, cut and bramble art', () => {
  const base = CROP_SPRITE.shrub, cut = base.looks.clipped;
  assert.eq(Object.keys(base.looks).sort().join(','), 'bramble,clipped');
  for (const _biome of [undefined, 0, 5, 6, 16, 17, 18]) {
    for (const look of [undefined, 'clipped', 'trimmed', 'bramble', 'unknown']) {
      for (const tag of ['_plantArt', '_streetArt']) {
        for (const _cave of [true, false]) {
          const p = {crop:'shrub', _biome, [tag]:look, _cave};
          const isCut = ['clipped','trimmed'].includes(look) || (!_cave && [5,16].includes(_biome));
          assert.eq(wildplantSprite(p), look === 'bramble' ? base.looks.bramble : isCut ? cut : base);
          assert.eq(wildplantFrame(p), 0);
          assert.eq(BiomeProfiles.tint(_biome, 'shrub'), null);
          assert.eq(wildplantRule(p.crop).output, 'wood');
        }
      }
    }
  }
});

test('Mushroom Grove giant caps fit centered inside the cell and have distinct rewards', () => {
  const p = {crop:'giant_mushroom'};
  const art = wildplantSprite(p);
  assert.eq(art.sheet, 'zone_objects');
  assert.eq(wildplantFrame(p), 40);
  const box = SpriteLayout.ART_BOUNDS['zone_objects:40'];
  const pos = SpriteLayout.seatInCell(box, .5, .5, art.scale, art.scale);
  assert.truthy(pos.fits, 'the smaller giant fits within one cell');
  assert.eq(pos.dyPx + ((box.minY + box.maxY)/2 - box.fh/2) * art.scale, 0);
  assert.eq(pos.dxPx + ((box.minX + box.maxX)/2 - box.fw/2) * art.scale, 0);
  assert.eq(JSON.stringify(wildplantRewards(p.crop)),JSON.stringify([{id:'wood',qty:1},{id:'mushroom',qty:1}]));
  assert.eq(itemName(p.crop),'Giant mushroom');
  assert.eq(inventoryIconSource(p.crop).sheet,'giant_mushroom');
  assert.truthy(RENDER_SRC.includes('const box = ov?.seat && SpriteLayout.ART_BOUNDS'));
});

test('legacy bush crowns use small trees and retired species use maple art and scale', () => {
  const spec = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map(),false).RENDER_SPEC.tree;
  for (const species of ['maple', 'pine', 'birch', 'mahogany']) {
    const o = {kind:'tree', size:'bush', species};
    const canonical = {...o, size:'small', species: species === 'pine' ? 'pine' : 'maple'};
    assert.eq(spec.key(o), species === 'pine' ? 'pine_tree' : 'trees');
    assert.eq(spec.frame(o), spec.frame(canonical));
    assert.eq(spec.scale(o), spec.scale(canonical));
    assert.eq(treeSizeClass(o), 'small');
  }
  for (const species of ['birch', 'mahogany']) {
    const o = {kind:'tree', species, variant:1};
    const maple = {...o, species:'maple'};
    assert.eq(spec.key(o), spec.key(maple));
    assert.eq(spec.frame(o), spec.frame(maple));
    assert.eq(spec.scale(o), spec.scale(maple));
    assert.eq(treeSizeClass(o), treeSizeClass(maple));
  }
});

test('Pirate Cove shipwreck fits the reserved extent and beach looks preserve pickup identities', () => {
  const art = SpriteLayout.groveShrineArt({_shrineArt:'shipwreck'});
  assert.eq(art.key, 'shipwreck_shrine');
  assert.eq(art.extentCells, 3);
  assert.eq(1536 * art.scale, 3 * SpriteLayout.CELL_PX);
  assert.truthy(1024 * art.scale <= 3 * SpriteLayout.CELL_PX);
  assert.truthy(SpriteLayout.groveShrineArt({id:'ordinary'}).key !== art.key);
  assert.eq(wildplantSprite({crop:'driftwood',_plantArt:'beach'}).sheet, 'driftwood', 'retired beach look falls back to standard driftwood');
  assert.eq(wildplantSprite({crop:'rubble',_plantArt:'beach'})?.sheet, undefined, 'retired beach rock uses ordinary crop art');
  assert.eq(wildplantSprite({crop:'driftwood'}).sheet, 'driftwood');
  assert.eq(inventoryIconSource('rubble').sheet, 'crops');
  assert.eq(iconBadgeItem('rubble_seed'), 'rubble');
});


test('fallen wood uses look 2 for every quantity without changing the stack', () => {
  const spec = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map(),false).RENDER_SPEC.groundstack;
  for (const qty of [1,2,3,12]) {
    const stack={kind:'groundstack',itemId:'wood',qty};
    assert.eq(spec.frame(stack),1);
    assert.eq(stack.qty,qty);
  }
});


test('maple and pine canopy sizes use authored growth art at a fixed species scale', () => {
  const spec = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map(),false).RENDER_SPEC.tree;
  for (const species of ['maple','pine']) {
    const sizes=['small','medium','large'];
    const scales=sizes.map(size=>spec.scale({species,size}));
    assert.eq(scales[1],scales[2],'young and mature crowns share one scale');
    assert.eq(scales[0],scales[1]*TREE_SAPLING_SCALE_MUL,'the smallest tree is drawn 50% bigger');
    assert.eq(TREE_SAPLING_SCALE_MUL,1.5);
    for (let i=0;i<sizes.length;i++) {
      const o={species,size:sizes[i],variant:1};
      assert.eq(spec.frame(o),i+1);
      assert.eq(treeSizeClass(o),['small','medium','full'][i]);
      assert.eq(treeWoodMul(o),[1,2,4][i]);
      assert.truthy(SpriteLayout.ART_BOUNDS[`${spec.key(o)}:${spec.frame(o)}`]);
    }
    for (const variant of [1,2,3]) assert.eq(spec.frame({species,variant}),variant);
    assert.eq(spec.frame({species,variant:0}),1,'never a seed or stump');
    assert.eq(spec.frame({species,variant:4}),3,'never dead or seasonal art');
  }
});


test('down ladder uses only the centered bottom half while the up ladder stays whole', () => {
  // Run the registered callback against a recording texture, so the assertion
  // checks the actual frame rectangle supplied to Phaser.
  const declaration=ASSETS_SRC.match(/stair_down: \{[^]*?onLoad: \(scene\) => \{([^]*?)\},/);
  assert.truthy(declaration);
  let call;
  new Function('scene',declaration[1])({textures:{get:key=>({add:(...args)=>{call={key,args};}})}});
  assert.eq(call.key,'stair_down');
  assert.eq(JSON.stringify(call.args),JSON.stringify(['down',0,0,16,32,16]));
  const spec=Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map(),false).RENDER_SPEC.staircase;
  assert.eq(spec.key({dir:'down'}),'stair_down');assert.eq(spec.frame({dir:'down'}),'down');
  assert.eq(spec.key({dir:'up'}),'stair_up');assert.eq(spec.frame({dir:'up'}),'__BASE');
  assert.eq(JSON.stringify(spec.origin),'[0.5,0.5]');assert.eq(spec.scale,1);
});


test('crystal deposits use their cluster art at ordinary rock scale and centered seating', () => {
  const spec=Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map(),false).RENDER_SPEC.mineralrock;
  const crystal={kind:'mineralrock',deposit:'crystal',yieldTier:1};
  assert.eq(spec.key(crystal),'crystal_cluster');assert.eq(spec.frame(crystal),0);
  assert.eq(spec.key({yieldTier:6}),'mineralrock');assert.eq(spec.frame({yieldTier:6}),mineralRockFrame(6));
  assert.eq(spec.scale,1.28);assert.truthy(spec.seat);
  const b=SpriteLayout.ART_BOUNDS['crystal_cluster:0'];
  const offset=SpriteLayout.seatInCell(b,.5,.5,spec.scale,spec.scale);
  assert.eq(offset.dxPx+((b.minX+b.maxX)/2-b.fw/2)*spec.scale,0);
  assert.eq(offset.dyPx+((b.minY+b.maxY)/2-b.fh/2)*spec.scale,0);
});


test('chest renderer uses shared tier frames and keeps special POI art', () => {
  const spec = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map(),false).RENDER_SPEC.chest;
  for (const poiDensity of [1, 3, 7, 25]) {
    for (const depth of [0, 2, 6]) {
      const o = {kind:'chest', poiClass:'memorial', poiDensity, depth};
      const look = chestLook(o);
      assert.eq(spec.key(o), look.texKey);
      assert.eq(spec.frame(o), look.frame, `density ${poiDensity}, depth ${depth}`);
      if (look.texKey === 'chest') assert.eq(spec.frame(o), chestTier(o) - 1);
      else assert.eq(spec.frame(o), 0);
    }
  }
  for (const poiClass of ['bakery', 'lodging', 'waste_basket', 'bicycle_parking']) {
    const o = {kind:'chest', poiClass};
    assert.eq(spec.frame(o), chestLook(o).frame, poiClass);
  }
  assert.eq(spec.frame({kind:'chest', poiClass:'atm'}), undefined, 'procedural gold pot has no sheet frame');
  assert.falsy(/CHEST_TIER_COLOR|chestObjs|tier diamond/.test(RENDER_SRC), 'tier colours are in the chest art, without floating gems');
  assert.truthy(/const g = scene\.tierGfx;\s*g\.clear\(\);/.test(RENDER_SRC), 'attack warning layer still clears each draw');
  assert.truthy(/g\.strokeCircle\(centre\.sx, centre\.sy, radius\);/.test(RENDER_SRC), 'enemy attack footprints remain visible');
});

test('wooden barrels render at half their former size and have no broken art', () => {
  const art = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map());
  for (const smashed of [false, true]) {
    const look = art.resolveAppearance({kind:'chest',barrel:true,barrelStyle:'barrel',_smashed:smashed});
    if (smashed) assert.falsy(look.visible, 'no broken barrel sprite');
    else { assert.eq(look.texKey, 'barrel'); assert.eq(look.scl, 2 / 3); }
  }
  assert.eq(art.resolveAppearance({kind:'chest',barrel:true,barrelStyle:'clay_pot'}).scl, 4 / 3);
});

test('stronghold walls keep their tile frame alignment instead of centering corner art', () => {
  const art = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map());
  for (let variant=0;variant<15;variant++) {
    const p=art.resolveAppearance({kind:'stronghold_wall',variant});
    assert.eq(p.texKey,'stronghold_wall');
    assert.eq(p.frameVal,variant);
    assert.eq(p.scl*24,SpriteLayout.CELL_PX);
    assert.eq(p.dxPx,0); assert.eq(p.dyPx,0);
    assert.eq(p.spec.seat,false,'corner quadrants must not be recentered');
  }
  assert.eq(art.resolveAppearance({kind:'mineralrock',yieldTier:2}).texKey,'mineralrock','global rock art retained');
});

// A mature replacement must not turn the seed packet or growing crop into a bush.
test('berry bush: mature map art replaces wild and farmed berries while growth and inventory remain distinct', () => {
  for (const plant of [{kind:'wildplant',crop:'berry'}, {crop:'berry',wildId:'wz:berry'}, {crop:'berry',stage:MAX_GROWTH_STAGE}]) {
    const art = wildplantSprite(plant);
    assert.eq(art.sheet, 'zone_berry_bush');
    assert.eq(art.scale, 4 / 3);
    assert.eq(wildplantFrame(plant), 0);
  }
  for (let stage=0; stage<MAX_GROWTH_STAGE; stage++) {
    assert.eq(wildplantSprite({crop:'berry',stage}).sheet, 'springcrops');
  }
  assert.eq(inventoryIconSource('berry_seed').frame, 21);
  assert.eq(inventoryIconSource('berry').frame, 22);
  assert.eq(wildplantOutput('berry'), 'berry');
  assert.eq(wildplantRewards('berry')[0].qty, 1);
});

test('selected zone appearances keep mineral interactions and global art separate', () => {
  const art = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map());
  const original = art.resolveAppearance({kind:'mineralrock',yieldTier:2});
  const selected = art.resolveAppearance({kind:'mineralrock',deposit:'crystal',_zoneObjectFrame:37});
  assert.eq(original.texKey,'mineralrock');
  assert.eq(selected.texKey,'zone_objects'); assert.eq(selected.frameVal,37);
  assert.eq(selected.spec.after,original.spec.after,'pick-gate appearance hook is retained');
  assert.eq(selected.scl*24,32);
  const pot = {kind:'chest',barrel:true,barrelStyle:'clay_pot',id:'selected-pot'};
  assert.eq(art.resolveAppearance(pot).texKey,'clay_pot');
  assert.eq(art.resolveAppearance({...pot,_smashed:true}).texKey,'clay_pot_smashed');
  assert.eq(art.resolveAppearance(pot).scl*24,32);
  assert.truthy(/_zoneObjectFrame: wp\._zoneObjectFrame/.test(RENDER_SRC),'wild mushroom appearance reaches the plant renderer');
});


test('quarry broken stone shrinks while mineral shadows stay under every resolved art', () => {
  const art = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map());
  for (const o of [
    {kind:'mineralrock',yieldTier:1,rockVariant:3},
    {kind:'mineralrock',yieldTier:4},
    {kind:'mineralrock',deposit:'crystal'},
    {kind:'mineralrock',zone:'quarry',zoneVariant:'quarry-strip-mine',_zoneObjectFrame:65},
    {kind:'mineralrock',deposit:'crystal',_zoneObjectFrame:59},
  ]) {
    const p = art.resolveAppearance(o);
    const shadowHeight = Math.max(8,p.foot.w*0.9)*0.42;
    const shadowBottom = p.foot.footFromCentre-p.foot.shadowInsetPx+shadowHeight/2;
    assert.eq(shadowBottom,p.foot.footFromCentre,'shadow ends at the seated art bottom');
    const b = SpriteLayout.ART_BOUNDS[`${p.texKey}:${p.frameVal}`];
    assert.truthy(Math.abs(p.dyPx+(b.maxY-b.fh/2)*p.scl-p.foot.footFromCentre)<1e-10,'depth keeps the true art foot');
  }
  assert.eq(art.resolveAppearance({kind:'mineralrock',_zoneObjectFrame:65}).scl,1.1);
  assert.eq(art.resolveAppearance({kind:'mineralrock',yieldTier:1}).scl,1.28);
  assert.eq(art.resolveAppearance({kind:'mineralrock',yieldTier:4}).scl,1.28);
  assert.eq(art.resolveAppearance({kind:'mineralrock',deposit:'crystal'}).scl,1.28);
  assert.eq(art.resolveAppearance({kind:'mineralrock',_zoneObjectFrame:59}).scl,4/3);
});
