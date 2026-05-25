// Spring Crops sprite sheet metadata.
// Sheet: Objects/Spring Crops.png  (224 x 128, 16x16 frames, 14 cols x 8 rows = 112 frames).
//
// Visually-inferred layout (LAYOUT A: columns = crops, rows = stages):
//   row 0 (idx 0..13)  -> seedbox / freshly planted
//   row 1 (idx 14..27) -> growth stage 1 (sprout)
//   row 2 (idx 28..41) -> growth stage 2 (leafy)
//   row 3 (idx 42..55) -> growth stage 3 (mature / harvestable)
//   row 4 (idx 56..69) -> harvested produce icon (inventory)
//   rows 5-7           -> alternate produce / seed bag variants (unused here)
//
// Frame index helper: idx = row * 14 + col.
//
// NOTE: crop names are best-guess for a Spring pack of this dimension.
//       Confidence per crop is annotated below in comments.

(function () {
  const COLS = 14;
  const seedbox = (c) => 0 * COLS + c;          // row 0
  const stage   = (c, s) => (s + 1) * COLS + c;  // rows 1..3
  const produce = (c) => 4 * COLS + c;          // row 4

  const CROP_DEFS = [
    // col, id,          name,        confidence
    [0,  'parsnip',     'Parsnip',     'MED'],
    [1,  'green_bean',  'Green Bean',  'LOW'],
    [2,  'cauliflower', 'Cauliflower', 'LOW'],
    [3,  'potato',      'Potato',      'MED'],
    [4,  'tulip',       'Tulip',       'LOW'],
    [5,  'kale',        'Kale',        'LOW'],
    [6,  'garlic',      'Garlic',      'MED'],
    [7,  'blue_jazz',   'Blue Jazz',   'LOW'],
    [8,  'rhubarb',     'Rhubarb',     'LOW'],
    [9,  'coffee',      'Coffee Bean', 'LOW'],
    [10, 'strawberry',  'Strawberry',  'MED'],
    [11, 'onion',       'Onion',       'MED'],
    [12, 'cabbage',     'Cabbage',     'LOW'],
    [13, 'carrot',      'Carrot',      'MED'],
  ];

  const CROPS = CROP_DEFS.map(([col, id, name, conf]) => ({
    id,
    name,
    col,
    confidence: conf,
    seedbox: seedbox(col),
    stages: [stage(col, 0), stage(col, 1), stage(col, 2)],
    produce: produce(col),
  }));

  window.SpringCrops = {
    SHEET: 'Objects/Spring Crops.png',
    FRAME_W: 16,
    FRAME_H: 16,
    COLS: 14,
    ROWS: 8,
    CROPS,
    // Helper: convert frame index -> {sx, sy} pixel offset on the sheet.
    frameRect(idx) {
      const c = idx % COLS;
      const r = (idx / COLS) | 0;
      return { sx: c * 16, sy: r * 16, sw: 16, sh: 16 };
    },
  };
})();
