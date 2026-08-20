// Tests for WorldGen.enforceBuildingDistribution — the per-tile building tier
// mix (TIER_FLOOR_LARGE / _MED / _SMALL).
//
// The contract:
//   1. at least TIER_FLOOR_SMALL of a tile's buildings are houses (BUILDING),
//      so a loaded tile reads as a neighbourhood, not a row of civic slabs;
//   2. the castle (BUILDING_LARGE) and fort (BUILDING_MED) floors also hold,
//      each rounded UP to at least one, so no tile with buildings lacks either;
//   3. n === 3 is the one documented exception — 1 + 1 + ceil(3 × 0.5) > 3, so
//      the tile comes out one of each and the house floor goes unmet;
//   4. buildings are re-tiered by AREA RANK: the biggest get the biggest tier;
//   5. TIER_FLOOR_LARGE is a CEILING as well as a floor. A castle paints its
//      footprint and draws no sprite, so a surplus castle is an empty block of
//      building floor. Buildings outside the forced bands used to keep their
//      default tier, and buildingTier() calls anything over 1500 m² OR taller
//      than 15 m a castle — so a downtown / apartment-tower / industrial tile
//      came out ~40% empty footprints against a 2% floor.

// Locals are prefixed — every *.test.js shares ONE VM context, so a bare `T`
// collides with another file's.
const TIER_T           = WorldGen.T;
const TIER_FLOOR_SMALL = WorldGen.TIER_FLOOR_SMALL;
const TIER_FLOOR_MED   = WorldGen.TIER_FLOOR_MED;
const TIER_FLOOR_LARGE = WorldGen.TIER_FLOOR_LARGE;

// n buildings, all big enough that buildingTier() calls every one of them a
// castle — the worst case for the house floor, and what a dense downtown tile
// actually looks like before enforcement.
function tierPolys(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const areaM2 = 5000 - i;   // strictly descending, so area rank is index order
    out.push({ areaM2, tier: WorldGen.buildingTier(areaM2, 0) });
  }
  return out;
}
const tierCount = (polys, tier) => polys.filter(p => p.tier === tier).length;

test('worldgen tiers: buildingTier calls a 5000 m² footprint a castle', () => {
  assert.eq(WorldGen.buildingTier(5000, 0), TIER_T.BUILDING_LARGE, 'big area → LARGE');
  assert.eq(WorldGen.buildingTier(500, 0), TIER_T.BUILDING_MED, 'mid area → MED');
  assert.eq(WorldGen.buildingTier(100, 0), TIER_T.BUILDING, 'small area → BUILDING');
});

test('worldgen tiers: at least half of a tile\'s buildings end up houses', () => {
  for (const n of [4, 5, 6, 7, 10, 17, 40, 99, 250]) {
    const polys = tierPolys(n);
    assert.eq(tierCount(polys, TIER_T.BUILDING), 0, `n=${n}: starts with no houses`);
    WorldGen.enforceBuildingDistribution(polys);
    const houses = tierCount(polys, TIER_T.BUILDING);
    assert.truthy(houses >= Math.ceil(n * TIER_FLOOR_SMALL),
      `n=${n}: ${houses} houses >= floor ${Math.ceil(n * TIER_FLOOR_SMALL)}`);
    assert.truthy(houses / n >= 0.5, `n=${n}: ${houses}/${n} is at least half`);
  }
});

test('worldgen tiers: the castle and fort floors hold alongside the house floor', () => {
  for (const n of [4, 5, 10, 40, 99, 250]) {
    const polys = tierPolys(n);
    WorldGen.enforceBuildingDistribution(polys);
    assert.truthy(tierCount(polys, TIER_T.BUILDING_LARGE) >= Math.max(1, Math.ceil(n * TIER_FLOOR_LARGE)),
      `n=${n}: castle floor`);
    assert.truthy(tierCount(polys, TIER_T.BUILDING_MED) >= Math.max(1, Math.ceil(n * TIER_FLOOR_MED)),
      `n=${n}: fort floor`);
  }
});

test('worldgen tiers: n=3 is the documented exception — one of each tier', () => {
  const polys = tierPolys(3);
  WorldGen.enforceBuildingDistribution(polys);
  assert.eq(tierCount(polys, TIER_T.BUILDING_LARGE), 1, 'one castle');
  assert.eq(tierCount(polys, TIER_T.BUILDING_MED), 1, 'one fort');
  assert.eq(tierCount(polys, TIER_T.BUILDING), 1, 'one house');
});

test('worldgen tiers: n<3 is left alone entirely', () => {
  for (const n of [0, 1, 2]) {
    const polys = tierPolys(n);
    WorldGen.enforceBuildingDistribution(polys);
    assert.eq(tierCount(polys, TIER_T.BUILDING_LARGE), n, `n=${n}: every tier untouched`);
  }
});

test('worldgen tiers: re-tiering follows area rank — biggest building is the castle', () => {
  const polys = tierPolys(20);            // areas strictly descending by index
  WorldGen.enforceBuildingDistribution(polys);
  assert.eq(polys[0].tier, TIER_T.BUILDING_LARGE, 'largest area → castle');
  assert.eq(polys[polys.length - 1].tier, TIER_T.BUILDING, 'smallest area → house');
});

test('worldgen tiers: a tile already meeting every floor is left untouched', () => {
  // 10 buildings: 1 castle, 1 fort, 8 houses — all three floors already met.
  const polys = [
    { areaM2: 5000, tier: TIER_T.BUILDING_LARGE },
    { areaM2: 500,  tier: TIER_T.BUILDING_MED },
  ];
  for (let i = 0; i < 8; i++) polys.push({ areaM2: 100 - i, tier: T.BUILDING });
  const before = polys.map(p => p.tier);
  WorldGen.enforceBuildingDistribution(polys);
  assert.eq(polys.map(p => p.tier).join(','), before.join(','), 'no re-tiering');
});


// ── The castle CEILING (surplus castles are empty footprints) ──────────────

// A tile whose buildings are all naturally castle-sized, the way a downtown
// block or a row of apartment towers arrives from OSM.
function tierCeilN(n) { return Math.max(1, Math.ceil(n * TIER_FLOOR_LARGE)); }

test('worldgen tiers: no tile keeps more castles than its ceiling', () => {
  for (const n of [4, 5, 6, 7, 10, 17, 40, 99, 250]) {
    const polys = tierPolys(n);          // every one a castle before enforcement
    WorldGen.enforceBuildingDistribution(polys);
    const castles = tierCount(polys, TIER_T.BUILDING_LARGE);
    assert.eq(castles, tierCeilN(n), `n=${n}: castles capped at the floor count`);
  }
});

test('worldgen tiers: empty footprints stay a rounding error on a real tile', () => {
  // The whole point: a footprint the renderer paints should have something on
  // it. BUILDING and BUILDING_MED both draw a roof; BUILDING_LARGE does not.
  // Only checked from n=20 up — below that the "every tile gets a castle"
  // floor IS the binding constraint (a 4-building tile is 25% castle by
  // design), so the fraction only becomes meaningful on a populated tile.
  for (const n of [20, 40, 99, 250]) {
    const polys = tierPolys(n);
    WorldGen.enforceBuildingDistribution(polys);
    const spriteless = tierCount(polys, TIER_T.BUILDING_LARGE);
    assert.truthy(spriteless / n <= 0.05,
      `n=${n}: ${spriteless}/${n} footprints left empty (was ~40% before the ceiling)`);
  }
});

test('worldgen tiers: a TALL building on a small footprint is not left empty', () => {
  // buildingTier calls anything over 15 m a castle regardless of area, so a
  // street of apartment towers arrived as an all-castle tile — every footprint
  // painted, none built on.
  const polys = [];
  for (let i = 0; i < 30; i++) {
    const areaM2 = 400 - i;                       // small footprints...
    polys.push({ areaM2, tier: WorldGen.buildingTier(areaM2, 20) });  // ...20 m tall
  }
  assert.eq(tierCount(polys, TIER_T.BUILDING_LARGE), 30, 'all castles by height alone');
  WorldGen.enforceBuildingDistribution(polys);
  assert.eq(tierCount(polys, TIER_T.BUILDING_LARGE), tierCeilN(30), 'capped');
});

test('worldgen tiers: the ceiling holds even when every floor is already met', () => {
  // The early-out used to return before any capping, so a tile that satisfied
  // all three floors kept its surplus castles untouched.
  const polys = [];
  for (let i = 0; i < 50; i++) polys.push({ areaM2: 60 - i * 0.1, tier: TIER_T.BUILDING });
  for (let i = 0; i < 8;  i++) polys.push({ areaM2: 500 - i,      tier: TIER_T.BUILDING_MED });
  for (let i = 0; i < 42; i++) polys.push({ areaM2: 9000 - i,     tier: TIER_T.BUILDING_LARGE });
  const n = polys.length;                                  // 100
  assert.truthy(tierCount(polys, TIER_T.BUILDING) >= Math.ceil(n * TIER_FLOOR_SMALL), 'house floor met');
  assert.truthy(tierCount(polys, TIER_T.BUILDING_MED) >= Math.ceil(n * TIER_FLOOR_MED), 'fort floor met');
  assert.truthy(tierCount(polys, TIER_T.BUILDING_LARGE) >= Math.ceil(n * TIER_FLOOR_LARGE), 'castle floor met');
  WorldGen.enforceBuildingDistribution(polys);
  assert.eq(tierCount(polys, TIER_T.BUILDING_LARGE), tierCeilN(n), 'surplus castles still capped');
});

test('worldgen tiers: a demoted castle becomes a fort, not a house', () => {
  // These are the tile's biggest footprints — a small house roof adrift on one
  // reads as wrong as no roof at all, and the fort sprite scales to its block.
  const polys = tierPolys(40);
  WorldGen.enforceBuildingDistribution(polys);
  // Index order is area order (tierPolys is strictly descending), so the
  // entries just past the castle ceiling are the demoted ones.
  for (let i = tierCeilN(40); i < 40 - Math.ceil(40 * TIER_FLOOR_SMALL); i++) {
    assert.eq(polys[i].tier, TIER_T.BUILDING_MED, `rank ${i} demoted to fort`);
  }
});
