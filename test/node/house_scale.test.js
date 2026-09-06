// Headless tests for the ONE building roof-scale rule (BUILDING_ART /
// houseArtScale in src/util.js): every building draws at its own OSM footprint,
// clamped to a range its role is allowed, and the range is in DRAWN CELLS.
//
// Two bugs this pins, both from the years when it was two rules in scale:
//
//   1. A fort's art was capped at its baseline, so every BUILDING_MED drew the
//      same ~2.3-cell roof whether its footprint was 19 m or 141 m across.
//      enforceBuildingDistribution promotes a tile's largest polygons into that
//      tier behind the single castle, so the big ones are common — and they
//      rendered as a field of bare tan brick with a toy building in the middle.
//
//   2. A SCALE is not a size: it means one width on the 72px house frame and
//      another on the 80px wreck or the 214px fort. The residential roles were
//      documented as sharing one baseline "so they look like neighbours from
//      one village" and drew anywhere from 1.35 to 2.02 cells wide, and a wreck
//      SHRANK by 10% when the player repaired it into a house. The table is in
//      cells now, so a role names a size and every frame reaches it.

// Game constants the renderer passes in (app.js CELL_PX, worldgen CELL_M) and
// the real frame widths render.js reads off the loaded textures.
const CELL_M = 7, CELL_PX = 32;
const FORT_W = 214;          // assets/Objects/Houses/fort.png is 214×154
// Every residential frame in the game, so "one village, one size" is checked
// against the actual art rather than asserted about one of them.
const HOUSE_FRAMES = {
  'plain house': 72,   // the 'house' tileset's 'front' sub-frame
  blacksmith:    72,
  trader:        76,
  wreck:         80,
  'wizard tower': 80,  // wizard.png sliced 80×104, frame 3
  market:       106,
  trailer:      108,
};
// The SHIPPING table (util.js), not copies of it — a test carrying its own
// numbers would keep passing while render.js drew something else.
const HOUSE = BUILDING_ART.house, FORT = BUILDING_ART.fort;
const fortScale  = (area) => houseArtScale(area, FORT_W, true, CELL_M, CELL_PX);
const houseScale = (area, w = 72) => houseArtScale(area, w, false, CELL_M, CELL_PX);
// Drawn width of the art, in cells — what the player actually sees.
const cellsWide = (scale, w) => (w * scale) / CELL_PX;
const houseCells = (area, w = 72) => cellsWide(houseScale(area, w), w);
const fortCells  = (area) => cellsWide(fortScale(area), FORT_W);
const nearCells = (a, b, m) => assert.inRange(a, b - 0.005, b + 0.005, m);

// ── One village, one size ───────────────────────────────────────────────────

test('building scale: every residential frame draws the same width', () => {
  // THE POINT OF THE CELLS TABLE. Under the old shared 0.6 SCALE these came out
  // at 1.35, 1.35, 1.43, 1.50, 1.50, 1.99 and 2.02 cells — the village was
  // sized by whatever width each artist had picked for their PNG.
  for (const [name, w] of Object.entries(HOUSE_FRAMES)) {
    nearCells(houseCells(5000, w), HOUSE.def, `${name} (${w}px frame) at its default`);
    nearCells(houseCells(10, w), HOUSE.min, `${name} (${w}px frame) at the floor`);
  }
});

test('building scale: repairing a wreck does not resize the building', () => {
  // The wreck frame is 80px and the house it restores into is 72px. On a shared
  // scale that made the restored house 10% NARROWER than the ruin — the reward
  // for repairing it was watching it shrink.
  for (const area of [undefined, 10, 78, 5000]) {
    nearCells(houseCells(area, 80), houseCells(area, 72),
      `wreck and restored house match at area=${area}`);
  }
});

// ── The range: no area, floor, cap ──────────────────────────────────────────

test('building scale: no area (trailer / sandbox house) draws the default', () => {
  nearCells(fortCells(undefined), FORT.def, 'fort, undefined area');
  nearCells(fortCells(0), FORT.def, 'fort, zero area');
  nearCells(houseCells(undefined), HOUSE.def, 'house, undefined area');
});

test('building scale: an unmeasurable frame is finite and matches its baseline', () => {
  // render.js hides a sprite whose texture is missing before the scale can
  // matter, so the only requirements are that it is a number and that it agrees
  // with buildingBaseScale — the shadow pass divides one by the other.
  for (const isFort of [false, true]) {
    const s = houseArtScale(500, 0, isFort, CELL_M, CELL_PX);
    assert.truthy(Number.isFinite(s) && s > 0, `finite scale (fort=${isFort})`);
    assert.eq(s, buildingBaseScale(0, isFort, CELL_PX), `shadow ratio is 1 (fort=${isFort})`);
  }
});

test('building scale: ordinary houses only ever shrink', () => {
  // A house sprite is one dwelling: a big footprint must not grow it.
  nearCells(houseCells(5000), HOUSE.def, 'large footprint holds the default');
  assert.eq(houseScale(5000), houseScale(50000), 'and every larger one draws the same');
  assert.lt(houseCells(20), HOUSE.def, 'a small footprint shrinks');
});

test('building scale: a house roof never shrinks below the floor', () => {
  // However tiny the polygon, the roof holds — a sub-cell roof read as yard
  // clutter rather than as a dwelling.
  nearCells(houseCells(10), HOUSE.min, 'tiny footprint holds the floor');
  assert.eq(houseScale(10), houseScale(20), 'below the floor every area draws the same roof');
});

test('building scale: houses still scale between the floor and the default', () => {
  // ~78 m² sits between the floor (~70 m²) and the default (~89 m²): it must
  // still shrink-to-fit rather than snap to either bound.
  const mid = houseCells(78);
  assert.gt(mid, HOUSE.min, 'above the floor');
  assert.lt(mid, HOUSE.def, 'below the default');
});

test('building scale: a fort grows with its footprint', () => {
  // 350 m² is buildingTier's BUILDING_MED floor — ~2.7 cells across, already
  // wider than the default roof, so even the smallest fort grows a little.
  assert.gt(fortCells(350), FORT.def, 'smallest fort clears its default');
  // Monotonic: a bigger block never draws a smaller building. 500 and 800 stay
  // below the area where the fit reaches the cap — past that every area draws
  // the same capped roof, so monotonicity needs the uncapped range.
  assert.gt(fortScale(500), fortScale(350), '500 > 350');
  assert.gt(fortScale(800), fortScale(500), '800 > 500');
});

test('building scale: a fort is capped at its max', () => {
  // Without the cap a 20000 m² polygon would draw a 20-cell roof — wider than
  // the 11-cell viewport. The cap is deliberately well under half the viewport:
  // a ~7-cell cap read as screen-filling rather than as a landmark you could
  // see around, and the ~4.3-cell cap that followed still read ~25% too big.
  nearCells(fortCells(20000), FORT.max, 'capped');
  assert.eq(fortScale(20000), fortScale(200000), 'cap holds for any size above it');
  assert.inRange(FORT.max, 3.2, 3.7, 'the cap is ~3.5 cells / 24 m');
});

test('building scale: a fort roof never exceeds its own footprint', () => {
  // fitMul keeps a brick margin inside the polygon; exact fill read ~25% big.
  for (const area of [350, 800, 1500, 5000, 20000]) {
    assert.lt(fortCells(area), Math.sqrt(area) / CELL_M + 0.01,
      `fort ${area} m² fits its footprint`);
  }
});

test('building scale: the fort cull pad covers the widest roof it can draw', () => {
  // render.js pads the house viewport cull by HOUSE_PAD_M = 2.2 cells so a
  // building whose centroid has left the view still draws the half of its roof
  // that hasn't. That pad must cover half the widest art the cap allows —
  // raise HOUSE_PAD_M with BUILDING_ART.fort.max if this ever trips.
  const HOUSE_PAD_CELLS = 2.2;
  assert.lt(FORT.max / 2, HOUSE_PAD_CELLS, 'half the capped roof fits the cull pad');
});

// ── The shape of the table itself ───────────────────────────────────────────

test('building scale: every role names a coherent range', () => {
  for (const [role, a] of Object.entries(BUILDING_ART)) {
    assert.lte(a.min, a.def, `${role}: default is not below the floor`);
    assert.lte(a.def, a.max, `${role}: default is not above the cap`);
    assert.truthy(a.fitMul > 0 && a.fitMul <= 1, `${role}: fitMul fills at most its footprint`);
  }
});

test('building scale: a fort outdraws a house at every footprint they share', () => {
  // Stated in cells this is just min-vs-min: under the old scale table it took
  // a frame-width argument to see it, which is exactly how the village ended up
  // sized by its PNGs.
  assert.gt(FORT.min, HOUSE.max, 'the smallest fort beats the biggest house');
  for (const area of [350, 1000, 5000]) {
    assert.gt(fortCells(area), houseCells(area), `fort > house at ${area} m²`);
  }
});

// ── Tree size is DISCRETE ───────────────────────────────────────────────────
// Not really a building rule, but the same discipline and the same file: a
// sprite's size comes from a table, not from a continuous measurement that
// nothing downstream can act on. treeBaseScale used to scale by crown_m/5 when
// a tree had no discrete `size`; every detected tree has one (the detector
// buckets that same crown_m before writing the geojson), so it never fired —
// and its 0.8 floor was nearly twice the 0.42 bush multiplier, so a tree that
// DID reach it would have drawn bush-sized art at small-tree size and could
// never have classed as a bush at all.

test('tree scale: a crown diameter no longer sets a sprite size', () => {
  // Same species, same (absent) size class, wildly different crowns → one size.
  const flat = treeSizeClass({ species: 'pine' });
  for (const crown_m of [0.5, 2, 5, 12, 40]) {
    assert.eq(treeSizeClass({ species: 'pine', crown_m }), flat,
      `crown_m ${crown_m} does not move the class`);
  }
});

test('tree scale: a size class always wins, and there are exactly four', () => {
  const classes = ['bush', 'small', 'medium', 'large'].map(
    (size) => treeSizeClass({ species: 'pine', size, crown_m: 999 }));
  assert.eq(classes.join(','), 'bush,small,medium,full', 'the four tiers, crown ignored');
  assert.eq(new Set(classes).size, 4, 'and they are distinct');
});

test('tree scale: a size-less tree classes mid-ladder, never bush or full', () => {
  // An OSM street tree has no crown to measure. It must not land on a tier that
  // demands a rare axe, and it must not be a bush (bushes are a detected class
  // with their own art).
  for (const species of ['pine', 'maple', 'birch', undefined]) {
    const cls = treeSizeClass({ species, variant: 3 });
    assert.truthy(cls === 'medium' || cls === 'small', `${species} → ${cls}`);
  }
});
