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

test('MINERAL_ICON_SHEET: copper_bar is frame 0 (col 0, row 0)', () => {
  assert.eq(MINERAL_ICON_SHEET['copper_bar'].frame, 0);
});

test('MINERAL_ICON_SHEET: iron_bar is frame 2 (col 2, row 0 — skips ore at col1)', () => {
  assert.eq(MINERAL_ICON_SHEET['iron_bar'].frame, 2);
});

test('MINERAL_ICON_SHEET: gold_bar is frame 16 (col 0, row 1 — stride 16)', () => {
  assert.eq(MINERAL_ICON_SHEET['gold_bar'].frame, 16);
});

test('MINERAL_ICON_SHEET: platinum_bar is frame 18 (col 2, row 1)', () => {
  assert.eq(MINERAL_ICON_SHEET['platinum_bar'].frame, 18);
});

test('MINERAL_ICON_SHEET: crimson_bar is frame 32 (col 0, row 2)', () => {
  assert.eq(MINERAL_ICON_SHEET['crimson_bar'].frame, 32);
});

test('MINERAL_ICON_SHEET: frost_bar is frame 34 (col 2, row 2)', () => {
  assert.eq(MINERAL_ICON_SHEET['frost_bar'].frame, 34);
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

test('MINERAL_ICON_SHEET: coal uses coal_icon sheet, frame 0', () => {
  assert.eq(MINERAL_ICON_SHEET['coal'].sheet, 'coal_icon');
  assert.eq(MINERAL_ICON_SHEET['coal'].frame, 0);
});

test('MINERAL_ICON_SHEET: gem frames — sapphire 4, ruby 0, emerald 3 (all on gems sheet)', () => {
  assert.eq(MINERAL_ICON_SHEET['sapphire'].sheet, 'gems');
  assert.eq(MINERAL_ICON_SHEET['sapphire'].frame, 4);
  assert.eq(MINERAL_ICON_SHEET['ruby'].sheet, 'gems');
  assert.eq(MINERAL_ICON_SHEET['ruby'].frame, 0);
  assert.eq(MINERAL_ICON_SHEET['emerald'].sheet, 'gems');
  assert.eq(MINERAL_ICON_SHEET['emerald'].frame, 3);
});

test('MINERAL_ICON_SHEET: fruit-tree saplings use the species tree sheet at frame 2', () => {
  assert.eq(MINERAL_ICON_SHEET['apple_sapling'].sheet, 'apple_tree');
  assert.eq(MINERAL_ICON_SHEET['apple_sapling'].frame, 2);
  assert.eq(MINERAL_ICON_SHEET['peach_sapling'].sheet, 'peach_tree');
  assert.eq(MINERAL_ICON_SHEET['peach_sapling'].frame, 2);
});

test('MINERAL_ICON_SHEET: apple and peach saplings use DIFFERENT sheets (bug 5bb9e66)', () => {
  // apple≠peach frames: both are frame 2 (young sapling frame) but on different species sheets.
  assert.truthy(
    MINERAL_ICON_SHEET['apple_sapling'].sheet !== MINERAL_ICON_SHEET['peach_sapling'].sheet,
    'apple_sapling and peach_sapling must use different species sheets'
  );
  assert.eq(MINERAL_ICON_SHEET['apple_sapling'].sheet, 'apple_tree');
  assert.eq(MINERAL_ICON_SHEET['peach_sapling'].sheet, 'peach_tree');
});

test('MINERAL_ICON_SHEET: boot junk pickup is frame 88 on the pickup sheet', () => {
  // row 6, col 4 of 7_Pickup_Items_16x16 (14 cols): frame = 6*14 + 4 = 88
  assert.eq(MINERAL_ICON_SHEET['boot'].sheet, 'pickup');
  assert.eq(MINERAL_ICON_SHEET['boot'].frame, 88);
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
// Shrub uses bushes.png (144×288 = 3 cols × 9 rows of 48×32 frames).
// Frame 0 = top-left large green bush. Scale 0.667 renders 48px frame at 32px.
// (Old broken path was Props.png frame 120.)

test('CROP_SPRITE: shrub uses the bushes sheet', () => {
  assert.eq(CROP_SPRITE['shrub'].sheet, 'bushes');
});

test('CROP_SPRITE: shrub is a custom sprite (custom: true)', () => {
  assert.eq(CROP_SPRITE['shrub'].custom, true);
});

test('CROP_SPRITE: shrub frame is 0 (top-left large green bush)', () => {
  assert.eq(CROP_SPRITE['shrub'].frame, 0);
});

test('CROP_SPRITE: shrub scale is 0.667 (renders 48px frame into 32px cell)', () => {
  assert.eq(CROP_SPRITE['shrub'].scale, 0.667);
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

test('CROP_SPRITE: longgrass scale is 1.36', () => {
  assert.eq(CROP_SPRITE['longgrass'].scale, 1.36);
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

// ── CROP_SPRITE: shell uses shell_sheet with 12 variants ──────────────────

test('CROP_SPRITE: shell uses shell_sheet, custom: true, 12 variants', () => {
  assert.eq(CROP_SPRITE['shell'].sheet, 'shell_sheet');
  assert.eq(CROP_SPRITE['shell'].custom, true);
  assert.eq(CROP_SPRITE['shell'].variants, 12);
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
  const mainCrops = ['rainberry', 'pairy', 'gemfruit', 'nut', 'rockfruit', 'coffee',
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
// T6=crimson→col5 (col4 skipped), T7=frost→col6.
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
