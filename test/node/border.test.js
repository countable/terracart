// Headless tests for the biome-boundary border rule in src/render.js.
//
// The wavy dark edge between two zones is decided by ONE predicate,
// `edgeNeedsBorder(color, nbrType, nbrColor)`, lifted out of drawCells so it
// can be pinned here. Everything else about the border — the wave table, the
// surf colour on water, which of the four edges get drawn — is pure drawing
// and lives in the browser harness.
//
// The bug these tests exist for: road and path cells are painted the majority
// biome AROUND them (scene.neighborNonRoadColor over a 7×7 window), so a road
// laid along a zone seam changes colour partway down its own run. The old rule
// skipped any edge where both sides were road-like, which erased the border on
// exactly the cells a road covered — so a boundary appeared to lose its
// decoration wherever cobbles sat on it.

// Terrain codes used below (see worldgen.js T): grass 0, residential 5,
// road 7, path 8, house 9, building_med 11, castle 12.
const GRASS_C = 0x479757;   // the colours the renderer actually paints these
const RESID_C = 0xada695;   // zones with, sampled from the running game
const FOREST_C = 0x2f6b3a;

test('border: an edge between two different painted colours gets the border', () => {
  assert.truthy(edgeNeedsBorder(GRASS_C, 0, FOREST_C), 'grass beside forest');
  assert.truthy(edgeNeedsBorder(GRASS_C, 5, RESID_C), 'grass beside residential');
});

test('border: an edge between two cells of one colour gets nothing', () => {
  assert.falsy(edgeNeedsBorder(GRASS_C, 0, GRASS_C), 'grass beside grass');
  assert.falsy(edgeNeedsBorder(RESID_C, 5, RESID_C), 'residential beside residential');
});

test('border: two road cells painted different colours still get the border', () => {
  // THE REGRESSION. Both cells are terrain code 7; the left one inherited the
  // grass it runs through, the right one the residential zone it enters. That
  // is a full-strength colour seam on screen and needs the same decoration any
  // other seam gets.
  assert.truthy(edgeNeedsBorder(GRASS_C, 7, RESID_C), 'road → road across a zone seam');
  assert.truthy(edgeNeedsBorder(RESID_C, 14, GRASS_C), 'and in the other direction / tier');
  assert.truthy(edgeNeedsBorder(GRASS_C, 8, RESID_C), 'a path counts the same as a road');
});

test('border: a road that inherited its neighbour\'s colour stays seamless', () => {
  // The flip side, and the reason the rule is about COLOUR and not type: a
  // road painted the grass it crosses must not be outlined against that grass,
  // or every street in the world would be drawn with a dark kerb.
  assert.falsy(edgeNeedsBorder(GRASS_C, 7, GRASS_C), 'road over grass, beside grass');
  assert.falsy(edgeNeedsBorder(GRASS_C, 0, GRASS_C), 'grass beside that road');
});

test('border: buildings never take part — their own outline draws the seam', () => {
  for (const t of [9, 11, 12])
    assert.falsy(edgeNeedsBorder(GRASS_C, t, RESID_C), 'building type ' + t + ' skipped');
  // …even though the same colours DO earn a border between ground cells.
  assert.truthy(edgeNeedsBorder(GRASS_C, 0, RESID_C), 'control: ground pair still bordered');
});
