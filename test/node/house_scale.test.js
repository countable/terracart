// Headless tests for houseArtScale (src/util.js) — the rule that sizes a
// building's roof art against the OSM footprint it stands on.
//
// The bug this pins: a fort's art was capped at its 0.35 baseline, so every
// BUILDING_MED drew the same ~2.3-cell roof whether its footprint was 19 m or
// 141 m across. enforceBuildingDistribution promotes a tile's largest polygons
// into that tier behind the single castle, so the big ones are common — and
// they rendered as a field of bare tan brick with a toy building in the middle.

// Game constants the renderer passes in (app.js CELL_PX, worldgen CELL_M) and
// the real fort.png / house frame widths.
const CELL_M = 7, CELL_PX = 32;
const FORT_W = 214;          // assets/Objects/Houses/fort.png is 214×154
const FORT_BASE = 0.35, HOUSE_BASE = 0.6;
const fortScale  = (area) => houseArtScale(area, FORT_W, FORT_BASE, true,  CELL_M, CELL_PX);
const houseScale = (area, w = 72) => houseArtScale(area, w, HOUSE_BASE, false, CELL_M, CELL_PX);
// Drawn width of the art, in cells — what the player actually sees.
const cellsWide = (scale, w) => (w * scale) / CELL_PX;

test('houseArtScale: no area (trailer / sandbox house) keeps the baseline', () => {
  assert.eq(fortScale(undefined), FORT_BASE, 'undefined area');
  assert.eq(fortScale(0), FORT_BASE, 'zero area');
  assert.eq(houseArtScale(500, 0, HOUSE_BASE, false, CELL_M, CELL_PX), HOUSE_BASE, 'unmeasurable frame');
});

test('houseArtScale: ordinary houses only ever shrink', () => {
  // A big footprint must NOT grow a residential roof past its baseline.
  assert.eq(houseScale(5000), HOUSE_BASE, 'large footprint stays at baseline');
  // A tiny polygon shrinks so the roof stops overhanging its own tiles.
  assert.lt(houseScale(20), HOUSE_BASE, 'small footprint shrinks');
});

test('houseArtScale: a fort grows with its footprint', () => {
  // 350 m² is buildingTier's BUILDING_MED floor — ~2.7 cells across, already
  // wider than the baseline roof, so even the smallest fort grows a little.
  assert.gt(fortScale(350), FORT_BASE, 'smallest fort clears the baseline');
  // Monotonic: a bigger block never draws a smaller building.
  assert.gt(fortScale(1500), fortScale(350), '1500 > 350');
  assert.gt(fortScale(5000), fortScale(1500), '5000 > 1500');
});

test('houseArtScale: a fort is capped at ~7 cells wide', () => {
  // Without the cap a 20000 m² polygon would draw a 20-cell roof — wider than
  // the 11-cell viewport.
  const huge = fortScale(20000);
  assert.eq(huge, fortScale(200000), 'cap holds for any size above it');
  assert.inRange(cellsWide(huge, FORT_W), 6.5, 7.5, 'capped roof width in cells');
});

test('houseArtScale: a fort roof never exceeds its own footprint', () => {
  for (const area of [350, 800, 1500, 5000, 20000]) {
    const footCells = Math.sqrt(area) / CELL_M;
    assert.lt(cellsWide(fortScale(area), FORT_W), footCells + 0.01, `fort ${area} m² fits its footprint`);
  }
});

test('houseArtScale: the fort cull pad covers the widest roof it can draw', () => {
  // render.js pads the house viewport cull by HOUSE_PAD_M = 3.6 cells so a
  // building whose centroid has left the view still draws the half of its roof
  // that hasn't. That pad must cover half the widest art the cap allows —
  // raise HOUSE_PAD_M with FORT_MAX_SCALE if this ever trips.
  const HOUSE_PAD_CELLS = 3.6;
  assert.lt(cellsWide(fortScale(1e6), FORT_W) / 2, HOUSE_PAD_CELLS, 'half the capped roof fits the cull pad');
});
