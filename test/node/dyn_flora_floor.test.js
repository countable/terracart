// Regression guard: a grassy landuse polygon never rolls ZERO longgrass.
//
// biome_profiles.js' dyn() gives a `dynamic` flora entry (longgrass on every
// grassland-family biome, farmland, wetland, orchard) a per-polygon density
// drawn from that polygon's own hashed seed. Before this fix the roll was
// uniform over [0, dMax] with no floor, so a polygon whose seed happened to
// land near the bottom of that range grew nothing at all — and since the
// seed is derived from the polygon's location, the SAME school/park/pitch
// read barren on every single visit, forever. dyn() now floors the roll at
// DYN_MIN (0.04) so even the unluckiest polygon still grows a light tuft.
//
// This drives the REAL rasterizer over many synthetic school polygons (one
// real school is one polygon, one seed, so a sweep across many stands in for
// "many different real schools") and asserts none of them ever comes up
// empty.
(function () {
const T = WorldGen.T;

const CPE = 32;
const TILE_EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const cellToMvt = (c) => c * CELL_MVT;
const ring = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));

// A school-grounds polygon comfortably inside the tile (26x26 cells), so
// every sample tile has the same shape and only the tile offset — which
// feeds the polygon's hashed seed — varies the roll.
const schoolRing = () => ring([[2, 2], [28, 2], [28, 28], [2, 28]]);

test('a landuse=school polygon never grows zero longgrass, across many locations', () => {
  const N = 400;
  let zeroCount = 0;
  for (let tx = 0; tx < N; tx++) {
    const out = WorldGen.rasterizeTile([
      { name: 'landuse', features: [{ type: 3, tags: { class: 'school' }, geom: [schoolRing()] }] },
    ], CPE, tx, 5, TILE_EDGE_M);
    const longgrass = out.wildplants.filter((wp) => wp.crop === 'longgrass').length;
    if (longgrass === 0) zeroCount++;
  }
  assert.eq(zeroCount, 0, `${zeroCount}/${N} synthetic school tiles grew no longgrass at all`);
});

test('BiomeProfiles.flora floors every dynamic longgrass entry at DYN_MIN (0.04)', () => {
  // Every grassy biome that lists a dynamic longgrass entry — the family
  // default plus every biome with its own BIOME_PROFILES row.
  const biomesWithDynLonggrass = [
    T.GRASS, T.PARK, T.SCHOOL, T.PLAYGROUND, T.PITCH, T.GOLF,
    T.FARMLAND, T.WETLAND, T.ORCHARD,
  ];
  for (const t of biomesWithDynLonggrass) {
    const entry = BiomeProfiles.flora(t).find((fl) => fl.dynamic && fl.crop === 'longgrass');
    assert.truthy(entry, `terrain ${t} has a dynamic longgrass flora entry`);
    assert.eq(entry.dMin, 0.04, `terrain ${t}'s longgrass floor is 4%`);
    assert.lt(entry.dMin, entry.dMax, `terrain ${t}'s floor stays below its own ceiling (${entry.dMax})`);
  }
});
})();
