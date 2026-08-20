// Central per-biome "feel" registry — the single source of truth for what each
// terrain/biome looks and plays like beyond its flat colour: its prominent
// wild flora (kinds + densities), its dominant fauna, and the tints applied to
// its primary interactables. Worldgen reads flora() + allows(), the fauna
// spawner reads BIOME_FAUNA, and the renderer reads tint().
//
// WHY a registry: the per-biome content used to be scattered across worldgen
// (DEBRIS_CROP / LONGGRASS_TYPES / MEADOW_FLORA / FOREST_FLORA / inline
// branches), app.js (hardcoded fauna Sets), and textures.js. Several biomes
// (commercial / wetland / farmland) fell through every one of those tables and
// generated NOTHING. Centralising here gives every walkable biome an explicit
// profile AND a base-family FALLBACK, so an unwired or unknown poly type can
// never again be barren.
//
// Load order: BEFORE worldgen.js (worldgen calls flora()/allows() at rasterize
// time). textures.js owns its own BIOME_TEX (texture draws are a render
// concern); this file only references texture variant counts for documentation.
//
// Depends on: nothing. Pure data + small lookups. Exposes globals
//   BiomeProfiles (accessors), BIOME_PROFILES (raw), BIOME_FAUNA, FAUNA_ORDER.

(function (global) {
  // Terrain codes — mirror of worldgen.js' T enum (kept as bare numbers here so
  // this module has no load-order dependency on worldgen).
  const T = {
    GRASS: 0, FOREST: 1, SAND: 2, WATER: 3, FARMLAND: 4, RESIDENTIAL: 5,
    PARK: 6, ROAD: 7, PATH: 8, BUILDING: 9, ROCK: 10, BUILDING_MED: 11,
    BUILDING_LARGE: 12, ROAD_LG: 13, ROAD_MD: 14, SCHOOL: 15, COMMERCIAL: 16,
    INDUSTRIAL: 17, PLAYGROUND: 18, PITCH: 19, WETLAND: 20, GOLF: 21,
    ORCHARD: 22, PIER: 23, CAVE_FLOOR: 24, CAVE_WALL: 25,
  };

  // RNG salts — one independent stream per flora kind per biome so finds scatter
  // rather than co-locate. The first block reuses the exact salts the old
  // scattered worldgen code used (so a biome whose flora list is unchanged
  // reproduces its old placement); the rest are fresh for the newly-wired
  // biomes. Density is seeded from (polyKey ^ salt), so identical salts on the
  // same crop would draw identical patterns within one polygon.
  const S = {
    SHRUB: 0x00000000,        // old DEBRIS_CROP shrub/shell used the bare polyKey
    SHELL: 0x00000000,
    NUT: 0xdeadbeef,
    LONGGRASS: 0x5a17b105,
    MUSH_FOREST: 0x0badf00d,
    MUSH_RESID: 0x5eedcafe,
    FORGETMENOT: 0xf10a0001,
    MARIGOLD: 0xf10a0002,
    WILDROSE: 0xf10a0003,
    STARFLOWER: 0xf10a0004,
    // Newly-wired biomes — fresh salts.
    FARM_LG: 0x5a17b107,
    FARM_MAR: 0xf10a0005,
    SCH_MAR: 0xf10a0006,
    COM_SHRUB: 0xc0ffee01,
    COM_MAR: 0xc0ffee02,
    IND_SHRUB: 0x1d050001,
    WET_LG: 0x5a17b106,
    WET_SHRUB: 0x0badf00e,
    WET_MUSH: 0x5eedcaff,
    WET_FMN: 0xf10a0007,
    ORCH_LG: 0x5a17b108,
    ORCH_MAR: 0xf10a0008,
  };

  // Default debris density window. D_MAX = 0.15 so any single flora type
  // claims at most 15 % of cells; with multiple types stacking via the
  // occupancy filter the combined density stays under ~30 % per zone.
  const D_MIN = 0.05, D_MAX = 0.15;
  // dyn(maxDensity): a per-polygon density in [0, max], the old "longgrass
  // family" behaviour generalised — most polygons grow at least a tuft, big
  // areas cluster, the unlucky few grow nothing.
  const dyn = (crop, max, salt) => ({ crop, dynamic: true, dMax: max, salt });
  const fix = (crop, dMin, dMax, salt) => ({ crop, dMin, dMax, salt });

  // ── Families ──────────────────────────────────────────────────────────────
  // Every biome belongs to a base family. Unknown / unwired types fall back to
  // their family's default profile so they're never barren. Membership also
  // drives allows() (a flower that grows in any grassland biome is tolerated on
  // a grassland cell it spilled onto via polygon overlap).
  const FAMILY_OF = {
    [T.GRASS]: 'grassland', [T.PARK]: 'grassland', [T.SCHOOL]: 'grassland',
    [T.PLAYGROUND]: 'grassland', [T.PITCH]: 'grassland', [T.GOLF]: 'grassland',
    [T.FOREST]: 'forest', [T.WETLAND]: 'forest', [T.ORCHARD]: 'forest',
    [T.SAND]: 'sand',
    [T.ROCK]: 'rocky', [T.COMMERCIAL]: 'rocky', [T.INDUSTRIAL]: 'rocky',
    [T.FARMLAND]: 'farm',
    [T.RESIDENTIAL]: 'urban',
    [T.WATER]: 'water', [T.PIER]: 'water',
    // Hard surfaces + underground rock — never grow flora. These MUST be mapped
    // explicitly: roads/buildings are painted AFTER landuse/landcover, so a
    // polygon spawns debris into a cell that later becomes a road or building
    // footprint. allows() drops that debris only if the cell's family grows
    // nothing — so the missing mappings (which would default to 'grassland')
    // would leave grass/flowers/shrubs rendering on roads and inside buildings.
    [T.ROAD]: 'paved', [T.PATH]: 'paved', [T.BUILDING]: 'paved',
    [T.BUILDING_MED]: 'paved', [T.BUILDING_LARGE]: 'paved',
    [T.ROAD_LG]: 'paved', [T.ROAD_MD]: 'paved',
    [T.CAVE_FLOOR]: 'paved', [T.CAVE_WALL]: 'paved',
  };
  // Unmapped terrain codes fall back to 'grassland' so a genuinely unknown
  // *biome* still grows something (the "unknown poly type" fallback); every
  // known non-growing code above is mapped explicitly so it can't leak flora.
  const familyOf = (type) => FAMILY_OF[type] || 'grassland';

  // Family default profiles — the FALLBACK any unwired biome inherits.
  const FAMILY_PROFILE = {
    grassland: {
      flora: [dyn('longgrass', 0.15, S.LONGGRASS),
              // Forget-me-not halved (was 0.006–0.020): parks/grass often carry
              // two stacked OSM polygons (landcover+landuse / landuse+park),
              // each running its own scatter — observed density ~2x the window.
              fix('forgetmenot', 0.003, 0.010, S.FORGETMENOT),
              // Marigold halved (was 0.008–0.024 effective across stacked polys)
              // and kept below forget-me-not: it's the rarer flower (sell 3 vs 2)
              // but grows in far more biomes, so it read as the most common bloom.
              fix('marigold', 0.002, 0.006, S.MARIGOLD)],
      tint: {},
    },
    forest: {
      flora: [fix('shrub', D_MIN, D_MAX, S.SHRUB),
              fix('mushroom', 0.04, 0.10, S.MUSH_FOREST)],
      tint: {},
    },
    sand:  { flora: [fix('shell', 0.04, 0.07, S.SHELL)], tint: {} },
    rocky: { flora: [], tint: {} },
    farm:  { flora: [dyn('longgrass', 0.10, S.FARM_LG)], tint: {} },
    urban: { flora: [fix('mushroom', 0.008, 0.025, S.MUSH_RESID)], tint: {} },
    water: { flora: [], tint: {} },
    paved: { flora: [], tint: {} },   // roads / buildings / cave — never grow flora
  };

  // ── Per-biome profiles ──────────────────────────────────────────────────────
  // flora: wild-plant kinds spawned on the biome (the "prominent flora + density"
  //        and "medium-frequency drop" axis). canopy/minerals (trees, fruit,
  //        rock clusters) stay in worldgen — they're object spawns with their
  //        own placement maths — but their on/off is still biome-gated there.
  // tint:  crop / object-kind → 0xRRGGBB multiply, applied at render time so the
  //        same shared sprite reads differently per biome (golden field grass,
  //        swampy reeds, rusty industrial rock, …).
  const BIOME_PROFILES = {
    [T.GRASS]: {
      flora: [dyn('longgrass', 0.15, S.LONGGRASS),
              // Halved (see grassland family note) — was 0.006–0.020.
              fix('forgetmenot', 0.003, 0.010, S.FORGETMENOT),
              fix('marigold', 0.002, 0.006, S.MARIGOLD)],
      tint: {},
    },
    [T.FOREST]: {
      flora: [fix('shrub', D_MIN, D_MAX, S.SHRUB),
              fix('nut', 0.005, 0.03, S.NUT),
              fix('mushroom', 0.04, 0.10, S.MUSH_FOREST),
              fix('wildrose', 0.004, 0.012, S.WILDROSE),
              fix('starflower', 0.002, 0.006, S.STARFLOWER)],
      tint: {},
    },
    [T.SAND]: { flora: [fix('shell', 0.04, 0.07, S.SHELL)], tint: {} },
    [T.FARMLAND]: {
      // Muddy pasture — patches of grass + the odd wildflower (green, not the
      // old golden wheat tint, to suit the churned-pasture look).
      flora: [dyn('longgrass', 0.10, S.FARM_LG),
              fix('marigold', 0.003, 0.009, S.FARM_MAR)],
      tint: {},
    },
    [T.RESIDENTIAL]: {
      flora: [fix('mushroom', 0.008, 0.025, S.MUSH_RESID)],
      tint: {},
    },
    [T.PARK]: {
      // Shrub + forget-me-not halved (shrub was D_MIN–D_MAX = 0.05–0.15,
      // forget-me-not 0.006–0.020): parks usually arrive as two stacked OSM
      // polygons (landuse + park layers), each running its own scatter, so
      // observed density landed ~2x the configured window.
      flora: [fix('shrub', 0.025, 0.075, S.SHRUB),
              dyn('longgrass', 0.15, S.LONGGRASS),
              fix('forgetmenot', 0.003, 0.010, S.FORGETMENOT),
              fix('marigold', 0.002, 0.006, S.MARIGOLD)],
      tint: {},
    },
    [T.ROCK]: { flora: [], tint: {} },   // minerals carry rock terrain (worldgen)
    [T.SCHOOL]: {
      // Casual turf — keeps the grassland wildflowers (parity with the old
      // meadow-flora pass that ran on every LONGGRASS_TYPES member).
      flora: [dyn('longgrass', 0.12, S.LONGGRASS),
              fix('forgetmenot', 0.006, 0.020, S.FORGETMENOT),
              fix('marigold', 0.003, 0.008, S.SCH_MAR)],
      tint: {},
    },
    [T.COMMERCIAL]: {
      // Clipped hedge maze across the plaza paving — shrubs laid out in neat
      // rows/walls (~25% fill, see spawnHedgeMaze in worldgen.js) plus a few
      // planter marigolds for colour.
      flora: [{ crop: 'shrub', pattern: 'hedgemaze', salt: S.COM_SHRUB },
              fix('marigold', 0.004, 0.010, S.COM_MAR)],
      tint: { shrub: 0x8fd06f },        // bright manicured green
    },
    [T.INDUSTRIAL]: {
      // Hardy weeds breaking through the concrete; minerals (worldgen) dominate.
      flora: [fix('shrub', 0.02, 0.05, S.IND_SHRUB)],
      tint: { shrub: 0x9aa882, mineralrock: 0xc98a5a },  // grey-green weeds, rusty rock
    },
    [T.PLAYGROUND]: {
      flora: [dyn('longgrass', 0.08, S.LONGGRASS),
              fix('forgetmenot', 0.004, 0.014, S.FORGETMENOT),
              fix('marigold', 0.002, 0.006, S.MARIGOLD)],
      tint: {},
    },
    // PITCH + GOLF are deliberately manicured: long grass only, no wildflowers
    // (this is intentional per-biome differentiation, not the old meadow pass).
    [T.PITCH]: { flora: [dyn('longgrass', 0.06, S.LONGGRASS)], tint: {} },
    [T.WETLAND]: {
      // Lush marsh — dense reedy grass, marsh scrub, damp mushrooms, the odd
      // forget-me-not at the water's edge.
      flora: [dyn('longgrass', 0.10, S.WET_LG),
              fix('shrub', 0.03, 0.08, S.WET_SHRUB),
              fix('mushroom', 0.015, 0.04, S.WET_MUSH),
              fix('forgetmenot', 0.004, 0.010, S.WET_FMN)],
      tint: { longgrass: 0x6f9a66, shrub: 0x5a7a50, mushroom: 0xb3a25c },
    },
    [T.GOLF]: {
      flora: [dyn('longgrass', 0.05, S.LONGGRASS)],
      tint: { longgrass: 0xa5d878 },    // bright fairway green
    },
    [T.ORCHARD]: {
      // Fruit trees (worldgen canopy) + grassy understory with wildflowers.
      flora: [dyn('longgrass', 0.08, S.ORCH_LG),
              fix('marigold', 0.003, 0.008, S.ORCH_MAR)],
      tint: {},
    },
  };

  // ── Accessors ───────────────────────────────────────────────────────────────
  const get = (type) => BIOME_PROFILES[type] || FAMILY_PROFILE[familyOf(type)] || FAMILY_PROFILE.grassland;
  const flora = (type) => get(type).flora || [];
  const tint = (type, kind) => {
    const p = get(type);
    return (p.tint && p.tint[kind]) || null;
  };

  // allows(crop, type): may this crop legally survive on this cell? Used by the
  // worldgen occupancy/biome filter to drop debris that spilled (via polygon
  // overlap) onto a cell whose final terrain doesn't suit it. Derived from the
  // registry: a crop is allowed on any biome whose FAMILY grows it (directly or
  // via the family default), so e.g. a park shrub tolerates an adjacent grass
  // cell. Crops no biome lists (e.g. rockfruit) fall back to "any soft ground".
  const ALLOWED_FAMILIES = {};   // crop -> Set(family)
  const addAllowed = (profile, fam) => {
    for (const fl of (profile.flora || [])) {
      (ALLOWED_FAMILIES[fl.crop] || (ALLOWED_FAMILIES[fl.crop] = new Set())).add(fam);
    }
  };
  for (const [type, profile] of Object.entries(BIOME_PROFILES)) addAllowed(profile, familyOf(Number(type)));
  for (const [fam, profile] of Object.entries(FAMILY_PROFILE)) addAllowed(profile, fam);
  // Soft-ground fallback set for crops no profile lists (rockfruit / generic).
  const GROUND = new Set([T.RESIDENTIAL, T.PARK, T.FOREST, T.GRASS, T.SAND,
    T.FARMLAND, T.ROCK, T.SCHOOL, T.PLAYGROUND, T.PITCH, T.WETLAND, T.GOLF,
    T.ORCHARD, T.COMMERCIAL, T.INDUSTRIAL]);
  const allows = (crop, type) => {
    const fams = ALLOWED_FAMILIES[crop];
    if (fams) return fams.has(familyOf(type));
    return GROUND.has(type);
  };

  // ── Atmosphere ──────────────────────────────────────────────────────────────
  // The post-apocalyptic grade, and the reason twenty biomes read as twenty
  // places in the SAME dead world rather than twenty unrelated moods:
  //
  //     haze(type) = mix(baseColour(type), dust(type), HAZE_K)
  //
  // ONE transform applied to each biome's OWN colour. Hand-picking twenty haze
  // colours would decouple them; deriving them means the whole world's feel is
  // two numbers we can tune globally (DUST + HAZE_K), while each biome keeps
  // its identity because its own base colour is half the mix.
  //
  // Consumed by render.js in three places, which are the three depth planes a
  // top-down grid actually has:
  //   dim   — the per-cell wash over everything OUTSIDE the player's reach.
  //           Darkens (so the eye still lands on what's actionable) but in the
  //           biome's hue instead of neutral black.
  //   haze  — the ground-plane wash under the world sprites, and the rim haze
  //           at the viewport edge (distance reads as air, not as a crop).
  //
  // Nothing outside this file may hardcode an atmosphere colour.
  const DUST = 0x8d8272;    // the world's one dead-dust tone (warm grey ochre)
  const HAZE_K = 0.55;      // how far a biome's colour is pulled toward its dust
  const DIM_K = 0.34;       // how much biome hue survives in the out-of-reach wash

  // Per-biome dust overrides. A biome may sit in a different KIND of dead air —
  // rust over the industrial yards, cold rot over the marsh, bleached grit on
  // the sand — without breaking the shared transform above.
  const DUST_OF = {
    [T.INDUSTRIAL]: 0x9c7a5c,   // rust and oxide
    [T.COMMERCIAL]: 0x968f84,   // concrete dust
    [T.WETLAND]:    0x6f7f6a,   // cold green rot
    [T.FOREST]:     0x7d8570,   // damp leaf-mould air
    [T.ORCHARD]:    0x7d8570,
    [T.SAND]:       0xb0a186,   // bleached grit
    [T.WATER]:      0x74808c,   // flat grey water-light
    [T.PIER]:       0x74808c,
    [T.ROCK]:       0x8e857a,   // stone powder
    [T.CAVE_FLOOR]: 0x2a2622,   // underground: no daylight to haze with
    [T.CAVE_WALL]:  0x2a2622,
  };

  // Fallback base colour for a type app.js has no COLORS entry for. Matches the
  // renderer's own GRASS_FALLBACK so an unmapped type hazes like a green field.
  const BASE_FALLBACK = 0x479757;

  const _chan = (hex, sh) => (hex >> sh) & 0xff;
  const mixHex = (a, b, t) => {
    const r = Math.round(_chan(a, 16) + (_chan(b, 16) - _chan(a, 16)) * t);
    const g = Math.round(_chan(a, 8)  + (_chan(b, 8)  - _chan(a, 8))  * t);
    const bl = Math.round(_chan(a, 0) + (_chan(b, 0)  - _chan(a, 0))  * t);
    return (r << 16) | (g << 8) | bl;
  };

  // Resolved lazily + cached: COLORS lives in app.js, which loads AFTER this
  // module, so the base colours simply aren't readable at load time. The first
  // atmos() call happens on the first rendered frame, long after app.js is in.
  const _atmosCache = new Map();
  const atmos = (type) => {
    let a = _atmosCache.get(type);
    if (a) return a;
    const base = (typeof COLORS !== 'undefined' && COLORS[type] != null)
      ? COLORS[type] : BASE_FALLBACK;
    const dust = DUST_OF[type] != null ? DUST_OF[type] : DUST;
    const haze = mixHex(base, dust, HAZE_K);
    a = { base, dust, haze, dim: mixHex(0x000000, haze, DIM_K) };
    _atmosCache.set(type, a);
    return a;
  };

  // ── Fauna ───────────────────────────────────────────────────────────────────
  // Per-species spawn config consumed by app.js spawnInTile. Each species has a
  // PRIMARY biome set (its dominant home, ~`share` of its count) and a wider
  // FALLBACK set (the rest), so animals read correct (cows in fields, butterflies
  // in parks) while still scattering everywhere. Extending fallback sets to the
  // newly-wired biomes is what finally puts fauna in wetland / commercial /
  // industrial zones. count = base + floor(rng()*range).
  const FAUNA_ORDER = ['chicken', 'cow', 'cat', 'dog', 'deer', 'crow', 'butterfly', 'slime'];
  const ALL_NATURAL = [T.GRASS, T.FOREST, T.SAND, T.FARMLAND, T.RESIDENTIAL,
    T.PARK, T.ROCK, T.SCHOOL, T.COMMERCIAL, T.INDUSTRIAL, T.PLAYGROUND, T.PITCH,
    T.WETLAND, T.GOLF, T.ORCHARD];
  const BIOME_FAUNA = {
    chicken:   { base: 30, range: 15, share: 0.80, primary: [T.FARMLAND, T.GRASS], fallback: [T.GRASS, T.FARMLAND, T.RESIDENTIAL, T.PARK, T.SCHOOL] },
    cow:       { base: 12, range: 12, share: 0.90, primary: [T.GRASS], fallback: [T.GRASS, T.FARMLAND, T.RESIDENTIAL, T.PARK, T.PITCH, T.GOLF] },
    cat:       { base: 6,  range: 8,  share: 0.80, primary: [T.RESIDENTIAL, T.COMMERCIAL], fallback: ALL_NATURAL },
    dog:       { base: 6,  range: 8,  share: 0.80, primary: [T.RESIDENTIAL], fallback: ALL_NATURAL },
    deer:      { base: 8,  range: 6,  share: 1.00, primary: [T.FOREST, T.PARK, T.ORCHARD, T.WETLAND], fallback: [T.FOREST, T.PARK, T.ORCHARD, T.WETLAND, T.GOLF] },
    crow:      { base: 200, range: 0, share: 1.00, primary: ALL_NATURAL, fallback: ALL_NATURAL },
    butterfly: { base: 40, range: 20, share: 1.00, primary: [T.PARK, T.FOREST, T.WETLAND, T.ORCHARD, T.GOLF], fallback: [T.PARK, T.FOREST, T.WETLAND, T.ORCHARD, T.GOLF, T.SCHOOL, T.PLAYGROUND] },
    slime:     { base: 50, range: 0, share: 1.00, primary: ALL_NATURAL, fallback: ALL_NATURAL },
  };

  const api = { T, get, flora, tint, atmos, mixHex, allows, familyOf, BIOME_PROFILES, BIOME_FAUNA, FAUNA_ORDER };
  global.BiomeProfiles = api;
  global.BIOME_PROFILES = BIOME_PROFILES;
  global.BIOME_FAUNA = BIOME_FAUNA;
  global.FAUNA_ORDER = FAUNA_ORDER;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
