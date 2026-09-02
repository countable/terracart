// Regression for "a palisade floor with castle towers on it" — CLAUDE.md's
// castle-tower rule says towers only belong on BUILDING_LARGE, and the grid
// side of that held: worldgen.js's civic-POI dissolve (a school/hospital/etc
// point landing inside an existing building) flood-fills the connected
// footprint straight to T.BUILDING_LARGE in `grid`, which is exactly what the
// later castle-tower scan reads.
//
// But `entry.buildingShapes` — the SOURCE rings building_overlay.js actually
// draws by default (BuildingOverlay.enabled() is on unless flipped off) — is
// pushed during the earlier 'building' layer pass (`order` runs building
// before poi in worldgen.js), at the footprint's ORIGINAL tier. The dissolve
// mutates `grid` but never touched buildingShapes, so a fort/palisade
// building (T.BUILDING_MED) dissolved by a civic POI kept drawing its
// palisade-fenced floor forever while towers — placed from the promoted grid
// — stood on top of it: the floor and the towers disagreed about what the
// building even was.
(function () {

const T = WorldGen.T;

// Same basis as building_overlay.test.js: 64 cells across, 7 m each.
const CPE = 64;
const RTILE_M = CPE * 7;              // 448 m
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;        // 64 MVT units per cell
const mvtOfCell = (c) => c * CELL_MVT;
const bring = (cells) => cells.map(([cx, cy]) => ({ x: mvtOfCell(cx), y: mvtOfCell(cy) }));

test('civic POI dissolve: a fort/palisade building swallowed by a school keeps buildingShapes in sync with the grid', () => {
  // A 5x5-cell building (35m x 35m = 1225 m²) — over the 350 m² MED floor,
  // under the 1500 m² LARGE ceiling, so buildingTier() alone tiers it MED
  // (the fort/palisade tier) with no render_height given. Only this one
  // building on the tile (n < 3), so enforceBuildingDistribution's per-tile
  // floors don't touch its tier either.
  const buildingRing = bring([[10, 10], [15, 10], [15, 15], [10, 15]]);
  // A 'school' POI point landing inside that footprint — one of USEFUL's
  // civic classes, and the dissolve branch (worldgen.js's onBuilding) is not
  // gated on which USEFUL class it is.
  const poiPoint = bring([[12, 12]]);

  const out = WorldGen.rasterizeTile([
    { name: 'landuse', features: [{ type: 3, tags: { class: 'residential' },
      geom: [bring([[0, 0], [CPE, 0], [CPE, CPE], [0, CPE]])] }] },
    { name: 'building', features: [{ type: 3, tags: {}, geom: [buildingRing] }] },
    { name: 'poi', features: [{ type: 1, tags: { class: 'school' }, geom: [poiPoint] }] },
  ], CPE, 0, 0, RTILE_M);

  assert.eq(out.buildingShapes.length, 1, 'one building shape exported');
  const shape = out.buildingShapes[0];

  // The grid side of the dissolve: every cell of the footprint promoted to
  // BUILDING_LARGE.
  const mPerCell = RTILE_M / CPE;
  const cellIdx = (cx, cy) => cy * CPE + cx;
  for (let cy = 10; cy < 15; cy++) {
    for (let cx = 10; cx < 15; cx++) {
      assert.eq(out.grid[cellIdx(cx, cy)], T.BUILDING_LARGE,
        `cell ${cx},${cy} promoted to BUILDING_LARGE in the grid`);
    }
  }

  // Castle towers placed on the promoted footprint's perimeter — the same
  // signal the tiled render path already agrees with.
  const towers = out.objects.filter(o => o.kind === 'tower');
  assert.gt(towers.length, 0, 'the promoted footprint grew perimeter towers');

  // The bug: buildingShapes kept the pre-dissolve tier (BUILDING_MED), so the
  // polygon overlay drew a palisade-fenced floor under those towers. Fixed:
  // the overlay's own record of this footprint is promoted right alongside
  // the grid, so it draws the same castle the towers stand on.
  assert.eq(shape.tier, T.BUILDING_LARGE,
    'buildingShapes tier follows the civic dissolve, matching the grid and the towers');
});

})();
