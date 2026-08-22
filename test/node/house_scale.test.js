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
  // Monotonic: a bigger block never draws a smaller building. 500 and 800 stay
  // below the ~926 m² area where fit(area) reaches FORT_MAX_SCALE — past that
  // every area draws the same capped roof (see the cap test below), so testing
  // monotonicity needs areas still in the uncapped growth range.
  assert.gt(fortScale(500), fortScale(350), '500 > 350');
  assert.gt(fortScale(800), fortScale(500), '800 > 500');
});

test('houseArtScale: a fort is capped at ~4.3 cells wide', () => {
  // Without the cap a 20000 m² polygon would draw a 20-cell roof — wider than
  // the 11-cell viewport. The cap itself is deliberately well under half the
  // viewport too: an earlier ~7-cell cap (FORT_MAX_SCALE 1.05) still read as
  // screen-filling rather than as a landmark you could see around.
  const huge = fortScale(20000);
  assert.eq(huge, fortScale(200000), 'cap holds for any size above it');
  assert.inRange(cellsWide(huge, FORT_W), 4.0, 4.7, 'capped roof width in cells');
});

test('houseArtScale: a fort roof never exceeds its own footprint', () => {
  for (const area of [350, 800, 1500, 5000, 20000]) {
    const footCells = Math.sqrt(area) / CELL_M;
    assert.lt(cellsWide(fortScale(area), FORT_W), footCells + 0.01, `fort ${area} m² fits its footprint`);
  }
});

test('houseArtScale: the fort cull pad covers the widest roof it can draw', () => {
  // render.js pads the house viewport cull by HOUSE_PAD_M = 2.2 cells so a
  // building whose centroid has left the view still draws the half of its roof
  // that hasn't. That pad must cover half the widest art the cap allows —
  // raise HOUSE_PAD_M with FORT_MAX_SCALE if this ever trips.
  const HOUSE_PAD_CELLS = 2.2;
  assert.lt(cellsWide(fortScale(1e6), FORT_W) / 2, HOUSE_PAD_CELLS, 'half the capped roof fits the cull pad');
});

test('houseArtScale: a house roof never shrinks below the drawn-cells floor', () => {
  // However tiny the polygon, the roof holds at HOUSE_MIN_CELLS (1.2) drawn
  // cells — a sub-cell roof read as yard clutter rather than a dwelling.
  assert.inRange(cellsWide(houseScale(10), 72), 1.19, 1.21, 'tiny footprint holds the floor');
  assert.eq(houseScale(10), houseScale(20), 'below the floor every area draws the same roof');
  // The floor is set in cells, so it lands the same on any frame width — the
  // wreck sprite (80 px) must draw no smaller than the base house (72 px).
  assert.inRange(cellsWide(houseScale(10, 80), 80), 1.19, 1.21, 'floor holds for the wreck frame');
});

test('houseArtScale: houses still scale between the floor and the baseline', () => {
  // ~78 m² sits between the floor (~70 m²) and the baseline (~89 m²): it must
  // still shrink-to-fit rather than snap to either bound.
  const mid = houseScale(78);
  assert.gt(mid, houseScale(20), 'above the floor');
  assert.lt(mid, HOUSE_BASE, 'below the baseline');
});
