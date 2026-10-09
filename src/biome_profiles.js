// Central per-biome "feel" registry — the single source of truth for what each
// terrain/biome looks and plays like beyond its flat colour: its prominent
// wild flora (kinds + densities) and its dominant fauna. Worldgen reads
// flora() + allows(); HabitatSpawns owns current creature populations.
//
// WHY a registry: several biomes (commercial / wetland / farmland) used to
// fall through every scattered per-biome table and generate NOTHING. Here every
// walkable biome has an explicit profile AND a base-family FALLBACK, so an
// unwired types retain family defaults; farmland grows only its rim crops.
//
// Load order: BEFORE worldgen.js (worldgen calls flora()/allows() at rasterize
// time). textures.js owns its own BIOME_TEX (texture draws are a render
// concern); this file only references texture variant counts for documentation.
//
// Depends on: nothing. Pure data + small lookups. Exposes globals
//   BiomeProfiles (accessors: T, flora, staticObjects, tint, atmos, mixHex, allows, faunaAllows, yard,
//   yardAllows),
//   BIOME_PROFILES (raw), BIOME_FAUNA, FAUNA_ORDER.

(function (global) {
  // Terrain codes — mirror of worldgen.js' T enum (kept as bare numbers here so
  // this module has no load-order dependency on worldgen).
  const T = {
    GRASS: 0, FOREST: 1, SAND: 2, WATER: 3, FARMLAND: 4, RESIDENTIAL: 5,
    PARK: 6, ROAD: 7, PATH: 8, BUILDING: 9, ROCK: 10, BUILDING_MED: 11,
    BUILDING_LARGE: 12, ROAD_LG: 13, ROAD_MD: 14, SCHOOL: 15, COMMERCIAL: 16,
    INDUSTRIAL: 17, PLAYGROUND: 18, PITCH: 19, WETLAND: 20, GOLF: 21,
    ORCHARD: 22, PIER: 23, CAVE_FLOOR: 24, CAVE_WALL: 25, CAVE_LAVA: 26,
    WASTELAND: 27, GROVE: 28, CHURCHYARD: 29, TAR_YARD: 31,
  };

  // RNG salts — one independent stream per flora kind per biome so finds scatter
  // rather than co-locate. Density is seeded from (polyKey ^ salt), so identical
  // salts on the same crop would draw identical patterns within one polygon.
  // The first block keeps the salts of the old scattered worldgen code so an
  // unchanged flora list reproduces its placement.
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
    YARD_FLORA: 0x7a4d0f10,   // residential yard grass/scrub (see `yard` below)
  };

  // Default debris density window. D_MAX = 0.15 so any single flora type
  // claims at most 15 % of cells; with multiple types stacking via the
  // occupancy filter the combined density stays under ~30 % per zone.
  const D_MIN = 0.05, D_MAX = 0.15;
  // dyn(maxDensity): a per-polygon density in [DYN_MIN, max] — most polygons
  // grow a light tuft, big areas cluster, and DYN_MIN keeps the unluckiest
  // roll from reading as barren (the seed derives from the polygon's own
  // location, so a bare polygon would stay bare on every visit).
  const DYN_MIN = 0.04;
  const dyn = (crop, max, salt) => ({ crop, dynamic: true, dMin: DYN_MIN, dMax: max, salt });

  // FLORA PATCHES — a park grows in CLUMPS, not a blanket (owner, Sep 2026:
  // "areas in the park could be dense but shouldn't pack the entire thing").
  // A profile row's `patch` column scales each debris candidate's density by
  // the plane noise at its GLOBAL point (util.js valueNoise2 — the one helper
  // src/zones.js's ragged edge reads too): `dense` inside a clump — the top
  // `share` of the plane, `cut` being valueNoise2's measured quantile for it
  // (zones.test.js re-measures) — and `sparse` outside, `units` MVT units
  // (~25 m) to a lattice step. The scatter still takes exactly ONE draw per
  // candidate, so no rng stream moves: only which candidates survive.
  // 0.3·2.0 + 0.7·0.15 ≈ 0.7 of a uniform blanket's plants, gathered into
  // clumps with the lawn between nearly bare.
  const FLORA_PATCH = { units: 64, salt: 5.1, share: 0.30, cut: 0.585, dense: 2.0, sparse: 0.15 };
  const fix = (crop, dMin, dMax, salt) => ({ crop, dMin, dMax, salt });
  // Ordinary grass, including ground with no mapped polygon. Each 24-cell
  // region has a sparse background and one dense circular stand. Worldgen
  // seats this once on the final GRASS grid, never once per overlapping polygon.
  const GRASS_FILL = { crop: 'longgrass', pattern: 'grassfill', salt: S.LONGGRASS,
    dMin: 0.09, dMax: 0.36, spacing: 24, radiusMin: 3, radiusMax: 5, dense: 0.90 };

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
    // WASTELAND plays as residential land (worldgen isLotTerrain), so it is
    // the same family: yard rubble, yard flora, the odd mushroom.
    [T.RESIDENTIAL]: 'urban', [T.WASTELAND]: 'urban',
    // The influence-zone halos (src/zones.js): a grove is grassland (its
    // BIOME_PROFILES row is the park's), the churchyard's sward and the tar
    // yard's oily ground are rocky, like the commercial / industrial lots
    // they are painted over.
    [T.GROVE]: 'grassland', [T.CHURCHYARD]: 'rocky', [T.TAR_YARD]: 'rocky',
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
    [T.CAVE_FLOOR]: 'paved', [T.CAVE_WALL]: 'paved', [T.CAVE_LAVA]: 'paved',
  };
  // Unmapped terrain codes fall back to 'grassland' so a genuinely unknown
  // *biome* still grows something (the "unknown poly type" fallback); every
  // known non-growing code above is mapped explicitly so it can't leak flora.
  const familyOf = (type) => FAMILY_OF[type] || 'grassland';

  // Family default profiles — the FALLBACK any unwired biome inherits.
  const FAMILY_PROFILE = {
    grassland: {
      flora: [dyn('longgrass', 0.15, S.LONGGRASS),
              // Ordinary flowers replace the school-only blue blooms. Parks/grass carry
              // two stacked OSM polygons, each running its own scatter (~2x density).
              fix('flowers', 0.003, 0.010, S.FORGETMENOT),
              // Marigold is the rarer flower (sell 3 vs 2) but grows in far more
              // biomes, so it is kept below ordinary flowers.
              fix('marigold', 0.002, 0.006, S.MARIGOLD)],
    },
    forest: {
      flora: [fix('shrub', D_MIN, D_MAX, S.SHRUB),
              fix('mushroom', 0.04, 0.10, S.MUSH_FOREST)],
    },
    // Occasional beach finds; keep the sand and waterline mostly clear.
    sand:  { flora: [fix('shell', 0.022, 0.035, S.SHELL), fix('driftwood', 0.006, 0.006, 0xd71f700d)] },
    rocky: { flora: [] },
    farm:  { flora: [dyn('longgrass', 0.10, S.FARM_LG)] },
    urban: {
      flora: [fix('mushroom', 0.008, 0.025, S.MUSH_RESID)],
      // YARD flora — NOT a debris scatter. Long grass and scrub grown IN AMONG
      // the yard rubble: worldgen scatters these around each fired residential
      // rock-cluster pivot (_spawnYardFloraSteps) from this row's own salted
      // stream, and the post-pass culls them by the ROCK's rule (_mrDrop).
      // Deliberately NOT in `flora` and NOT in allows(): a lawn-wide longgrass
      // scatter spilled from an overlapping grass landcover must still die on a
      // residential cell — only yard-lane plants survive there (yardAllows).
      //   per cluster: min + floor(rng*span) tries within radiusK × the rock
      //   cluster radius, each try picking a crop by `share`. Numbers chosen so
      //   surviving flora lands near the surviving rock count
      //   (residential_flora.test.js measures it), keeping streets from reading
      //   as packed with grass and bushes.
      yard: { min: 4, span: 4, radiusK: 2, salt: S.YARD_FLORA,
              crops: [{ crop: 'longgrass', share: 0.5 }, { crop: 'shrub', share: 0.5 }] },
    },
    water: { flora: [] },
    paved: { flora: [] },   // roads / buildings / cave — never grow flora
  };

  // ── Per-biome profiles ──────────────────────────────────────────────────────
  // flora: wild-plant kinds spawned on the biome (the "prominent flora + density"
  //        and "medium-frequency drop" axis). canopy/minerals (trees, fruit,
  //        rock clusters) stay in worldgen — they're object spawns with their
  //        own placement maths — but their on/off is still biome-gated there.
  // A biome with no row here inherits its family's profile above —
  // SAND uses its family default. Explicit rows override the other families.
  const BIOME_PROFILES = {
    [T.GRASS]: { blockedFlora: ['marigold'], flora: [GRASS_FILL,
      fix('flowers', 0.012, 0.020, S.FORGETMENOT)] },
    [T.FOREST]: { staticObjects: { treeSpacingM: 11.7 },
      flora: [fix('shrub', 0.018, 0.052, S.SHRUB),
              fix('nut', 0.008, 0.033, S.NUT),
              fix('mushroom', 0.055, 0.125, S.MUSH_FOREST),
              fix('wildrose', 0.0015, 0.0045, S.WILDROSE),
              fix('starflower', 0.003, 0.009, S.STARFLOWER)],
    },
    [T.SAND]: { ...FAMILY_PROFILE.sand, staticObjects: { plainRockFrame: 34, plainRockVariant: 3 } },
    // Wild field-edge crops: five equal independent scatters, together about
    // 8% of eligible rim cells. The shared farm-interior gate removes the rest.
    // These are ground wildplants, with static stages, never player dirt beds.
    [T.FARMLAND]: { flora: ['potato', 'cress', 'berry', 'nut', 'onion'].map((crop, i) =>
      ({ ...fix(crop, 0.016, 0.016, S.FARM_LG + i), sourceTerrainOnly: true, stageCount: 5 })) },
    // Mushrooms remain on residential frontage; its yard lane grows shrubs.
    [T.RESIDENTIAL]: { flora: FAMILY_PROFILE.urban.flora, blockedFlora: ['longgrass'],
      yard: { ...FAMILY_PROFILE.urban.yard, min: 1, span: 1,
        crops: [{crop: 'shrub', share: 1}] } },
    [T.WASTELAND]: { staticObjects: { rockFireChance: 0.72, rockPlainKeep: 1, rockOreKeep: 0.75 }, flora: [], blockedFlora: ['mushroom'],
      yard: { ...FAMILY_PROFILE.urban.yard, min: 3, span: 4,
        crops: [{crop: 'longgrass', share: 0.33}, {crop: 'shrub', share: 0.67}] } },
    [T.SCHOOL]: { blockedFlora: ['marigold'],
      flora: [fix('longgrass', 0.015, 0.025, S.LONGGRASS),
              { ...fix('forgetmenot', 0.011, 0.023, S.FORGETMENOT), terrainOnly: true }],
    },
    [T.COMMERCIAL]: { blockedFlora: ['marigold'],
      flora: [{ crop: 'shrub', pattern: 'hedgemaze', salt: S.COM_SHRUB }],
    },
    [T.ROCK]: { staticObjects: { rockPlainKeep: 0.75, rockOreKeep: 1 }, flora: [] },
    [T.INDUSTRIAL]: { staticObjects: { rockPlainKeep: 0.48, rockOreKeep: 0.925, barrelDensity: 0.0135 }, flora: [fix('shrub', 0.009, 0.020, S.IND_SHRUB)] },
    [T.PLAYGROUND]: { blockedFlora: ['marigold'],
      flora: [fix('longgrass', 0.007, 0.013, S.LONGGRASS),
              fix('flowers', 0.007, 0.015, S.FORGETMENOT)],
    },
    [T.PITCH]: { staticObjects: { noRocks: true }, flora: [fix('longgrass', 0.003, 0.007, S.LONGGRASS)] },
    [T.WETLAND]: { staticObjects: { noRocks: true }, blockedFlora: ['flowers', 'forgetmenot', 'marigold', 'wildrose', 'starflower'],
      flora: [fix('longgrass', 0.15, 0.21, S.WET_LG),
              fix('shrub', 0.035, 0.070, S.WET_SHRUB),
              fix('mushroom', 0.055, 0.105, S.WET_MUSH)],
    },
    [T.GOLF]: { flora: [] },
    [T.ORCHARD]: { staticObjects: { fruitTreeSpacingM: 15.2, noRocks: true }, blockedFlora: ['marigold'],
      flora: [fix('longgrass', 0.019, 0.030, S.ORCH_LG)],
    },
  };

  // ── PARK CHARACTERS (owner, Sep 2026) ────────────────────────────────────
  // Every park polygon (T.PARK — landcover grass/park|garden, landuse park /
  // garden / dog_park / cemetery, the park layer) wears ONE character, picked
  // by parkCharacterAt off its GLOBAL anchor point: the named-park POI inside
  // it when there is one (so the park and its grove — src/zones.js — agree),
  // else the polygon's own global centroid (worldgen parkCharacterFor). The
  // SAME flora scatter reads the character's row — one lane, profile
  // variants, never a second scatter. Every row keeps the FLORA_PATCH clumps.
  //   meadow  long grass + wildflowers, a few shrubs
  //   wooded  trees (`trees`: a per-cell chance, worldgen spawnParkTreesSteps)
  //           + shrubs and a few flowers
  //   formal  clipped HEDGE ROWS of shrubs (`hedgeRows`, a lattice on the
  //           global cell grid — neat, no clumps) + marigold beds, sparse
  //   common  open lawn: light long grass, few shrubs
  // Scattered rows retain clumps; their rates are calibrated against occupied
  // eligible cells in tools/preview_basic_coverage.js. Trees, hedges and
  // earlier plants compete for seats, so raw chances are not final coverage.
  // Salts: the PARK row's own streams (so a meadow's long grass is the
  // park's long grass stream) plus fresh ones for what is new.
  const PARK_S = { TREE: 0x7ae5a001 };
  const PARK_CHARACTERS = {
    meadow: {
      share: 0.30, filler: 'longgrass', pad: { shrub: 0.02, longgrass: 0.06 },
      flora: [fix('longgrass', 0.065, 0.115, S.LONGGRASS),
              fix('flowers', 0.025, 0.045, S.FORGETMENOT),
              fix('marigold', 0.004, 0.010, S.MARIGOLD),
              fix('shrub', 0.002, 0.007, S.SHRUB)],
      patch: FLORA_PATCH,
    },
    wooded: {
      share: 0.25, filler: 'shrub', pad: { shrub: 0.07, longgrass: 0.015 },
      trees: { p: 0.060, salt: PARK_S.TREE },
      flora: [fix('shrub', 0.008, 0.017, S.SHRUB),
              fix('flowers', 0.002, 0.004, S.FORGETMENOT)],
      patch: FLORA_PATCH,
    },
    formal: {
      share: 0.15, filler: 'shrub', pad: { shrub: 0.05, longgrass: 0 },
      // Rows every `period` global cells, cut into `seg`-cell runs of which
      // `on` stand (a stable per-run coin) — ~1/6 · 0.45 ≈ 7.5% of the park.
      hedgeRows: { period: 6, seg: 4, on: 0.45, salt: 0xf0a1ed01 },
      flora: [fix('marigold', 0.011, 0.019, S.MARIGOLD)],
      patch: FLORA_PATCH,
    },
    common: {
      share: 0.30, filler: 'longgrass', pad: { shrub: 0.03, longgrass: 0.05 },
      flora: [fix('longgrass', 0.020, 0.038, S.LONGGRASS),
              fix('shrub', 0.003, 0.007, S.SHRUB),
              fix('flowers', 0.003, 0.006, S.FORGETMENOT)],
      patch: FLORA_PATCH,
    },
  };
  const PARK_CHARACTER_IDS = Object.keys(PARK_CHARACTERS);
  for (const id of PARK_CHARACTER_IDS) {
    PARK_CHARACTERS[id].id = id;
    PARK_CHARACTERS[id].blockedFlora = ['mushroom'];
  }
  // A cemetery is a lawn among the graves: always `common`.
  const CEMETERY_CHARACTER = 'common';
  // The character at a GLOBAL MVT point (tile·4096 + local, integers) — a
  // pure hash, the same for every player and every tile that sees the point.
  const SALT_PARK_CHARACTER = 'parkchar|';
  function parkCharacterAt(gx, gy) {
    const u = (fnv1a(`${SALT_PARK_CHARACTER}${Math.round(gx)},${Math.round(gy)}`) >>> 0) / 4294967296;
    let acc = 0;
    for (const id of PARK_CHARACTER_IDS) {
      acc += PARK_CHARACTERS[id].share;
      if (u < acc) return id;
    }
    return PARK_CHARACTER_IDS[PARK_CHARACTER_IDS.length - 1];
  }
  // The park POI a character keys off (the grove anchor — Zones.anchorOf
  // reads this too, so the two can't disagree on what a named park is).
  function isParkPoi(tags) { return !!tags && tags.class === 'park' && tags.subclass === 'park'; }

  // The PARK row with no character (the sandbox, allows()) is the plain lawn.
  BIOME_PROFILES[T.PARK] = PARK_CHARACTERS.common;

  // A GROVE (the influence-zone halo round a park, src/zones.js) plays like
  // the park itself for flora and fauna: the same row, not a copy.
  BIOME_PROFILES[T.GROVE] = BIOME_PROFILES[T.PARK];

  // ── Accessors ───────────────────────────────────────────────────────────────
  // `character` (optional): a PARK_CHARACTERS id — a park / grove cell reads
  // that variant row instead of the plain PARK row. Ignored on other ground.
  const get = (type, character) => {
    if (character && (type === T.PARK || type === T.GROVE) && PARK_CHARACTERS[character]) return PARK_CHARACTERS[character];
    return BIOME_PROFILES[type] || FAMILY_PROFILE[familyOf(type)] || FAMILY_PROFILE.grassland;
  };
  const staticObjects = type => get(type).staticObjects || {};
  const flora = (type, character) => get(type, character).flora || [];
  // The row's FLORA_PATCH (or null), and the density multiplier it gives the
  // candidate at GLOBAL MVT point (gx, gy).
  const patch = (type, character) => get(type, character).patch || null;
  // The whole character row (trees / hedgeRows / pad / filler), or null.
  const parkCharacter = (id) => PARK_CHARACTERS[id] || null;
  const patchMul = (row, gx, gy) =>
    (valueNoise2(gx / row.units, gy / row.units, row.salt) >= row.cut ? row.dense : row.sparse);
  // Compatibility for render/preview callers: biome does not recolour sprites.
  const tint = () => null;

  // allows(crop, type): may this crop legally survive on this cell? Used by the
  // worldgen occupancy/biome filter to drop debris that spilled (via polygon
  // overlap) onto a cell whose final terrain doesn't suit it. Derived from the
  // registry: a crop is allowed on any biome whose FAMILY grows it (directly or
  // via the family default), so e.g. a park shrub tolerates an adjacent grass
  // cell. Crops no biome lists (e.g. rockfruit) fall back to "any soft ground".
  // Explicit habitat exclusivity also rejects polygon-overlap spill onto
  // another final terrain. This filter is for generated flora, not crops.
  const EXCLUSIVE_TYPES = {};
  for (const [type, profile] of Object.entries(BIOME_PROFILES)) {
    for (const fl of profile.flora || []) if (fl.terrainOnly) {
      (EXCLUSIVE_TYPES[fl.crop] || (EXCLUSIVE_TYPES[fl.crop] = new Set())).add(Number(type));
    }
  }
  const ALLOWED_FAMILIES = {};   // crop -> Set(family)
  const addAllowed = (profile, fam) => {
    for (const fl of (profile.flora || [])) {
      (ALLOWED_FAMILIES[fl.crop] || (ALLOWED_FAMILIES[fl.crop] = new Set())).add(fam);
    }
  };
  for (const [type, profile] of Object.entries(BIOME_PROFILES)) addAllowed(profile, familyOf(Number(type)));
  // Every park character's crop grows on PARK / GROVE ground itself (a
  // wooded park's flowers, a formal park's hedge shrubs) — per TERRAIN, not
  // widened to the whole grassland family, so a lawn or a verge spilled onto
  // keeps its old verdict.
  const ALLOWED_TYPES = {};      // crop -> Set(terrain code)
  for (const profile of Object.values(PARK_CHARACTERS)) {
    const crops = (profile.flora || []).map((fl) => fl.crop).concat(profile.hedgeRows ? ['shrub'] : []);
    for (const crop of crops) {
      const set = ALLOWED_TYPES[crop] || (ALLOWED_TYPES[crop] = new Set());
      set.add(T.PARK); set.add(T.GROVE);
    }
  }
  for (const [fam, profile] of Object.entries(FAMILY_PROFILE)) addAllowed(profile, fam);
  // Soft-ground fallback set for crops no profile lists (rockfruit / generic).
  const GROUND = new Set([T.RESIDENTIAL, T.WASTELAND, T.PARK, T.FOREST, T.GRASS, T.SAND,
    T.FARMLAND, T.ROCK, T.SCHOOL, T.PLAYGROUND, T.PITCH, T.WETLAND, T.GOLF,
    T.ORCHARD, T.COMMERCIAL, T.INDUSTRIAL, T.GROVE, T.CHURCHYARD, T.TAR_YARD]);
  const allows = (crop, type) => {
    if (type === T.GOLF || get(type).blockedFlora?.includes(crop)) return false;
    if (type === T.FARMLAND && !flora(type).some(fl => fl.crop === crop)) return false;
    if (EXCLUSIVE_TYPES[crop]) return EXCLUSIVE_TYPES[crop].has(type);
    if (ALLOWED_TYPES[crop] && ALLOWED_TYPES[crop].has(type)) return true;
    const fams = ALLOWED_FAMILIES[crop];
    if (fams) return fams.has(familyOf(type));
    return GROUND.has(type);
  };
  // yard(type): the biome's yard-flora row (see FAMILY_PROFILE.urban.yard), or
  // null. yardAllows(crop, type): may a YARD-LANE plant survive on this cell?
  // Everything allows() tolerates, plus the yard's own crops on a cell whose
  // biome carries that yard row. Only the yard lane asks this; every other
  // wild plant still goes through allows().
  const yard = (type) => get(type).yard || null;
  const yardAllows = (crop, type) => {
    if (get(type).blockedFlora?.includes(crop)) return false;
    if (allows(crop, type)) return true;
    const y = yard(type);
    return !!(y && y.crops.some((c) => c.crop === crop));
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
  // atmos(type) returns { haze, dim } — the two colours render.js consumes,
  // for the depth planes a top-down grid actually has:
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
    [T.WASTELAND]:  0x928a70,   // dry khaki grit off the scrub
    [T.GROVE]:      0x7d8570,   // the forest's damp leaf-mould air
    [T.CHURCHYARD]: 0x7c8878,   // stone powder gone mossy (greener since Sep 2026)
    [T.TAR_YARD]:   0x6a6258,   // oily soot
    [T.CAVE_FLOOR]: 0x2a2622,   // underground: no daylight to haze with
    [T.CAVE_WALL]:  0x2a2622,
    [T.CAVE_LAVA]:  0x2a2622,
  };

  // Fallback base colour for a type app.js has no COLORS entry for. Matches the
  // renderer's own GRASS_FALLBACK so an unmapped type hazes like a green field.
  const BASE_FALLBACK = 0x7b8d4e;

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
    a = { haze, dim: mixHex(0x000000, haze, DIM_K) };
    _atmosCache.set(type, a);
    return a;
  };

  // ── Fauna ───────────────────────────────────────────────────────────────────
  // Species placement limits and historical draw inputs. HabitatSpawns owns
  // current populations; these original counts/primary/fallback lists only
  // replay the prior tile stream for treasure stability and defeat aliases.
  // Preserve this snapshot when tuning the live habitat profiles.
  const FAUNA_ORDER = ['chicken', 'cow', 'cat', 'dog', 'deer', 'crow', 'butterfly', 'slime', 'raven', 'horse'];
  // Lot land (residential + the wasteland that used to be painted as it) —
  // shared by ordinary urban fauna; cats and deer have narrower habitat limits.
  const LOT = [T.RESIDENTIAL, T.WASTELAND];
  // The zone halos (src/zones.js) join every "anywhere natural" list; a GROVE
  // also stands wherever a species lists the park (it plays like one).
  const ALL_NATURAL = [T.GRASS, T.FOREST, T.SAND, T.FARMLAND, ...LOT,
    T.PARK, T.ROCK, T.SCHOOL, T.COMMERCIAL, T.INDUSTRIAL, T.PLAYGROUND, T.PITCH,
    T.WETLAND, T.GOLF, T.ORCHARD, T.GROVE, T.CHURCHYARD, T.TAR_YARD];
  // Fixed historical enemy-ground bag for the compatibility replay. Live
  // roster additions must not reshuffle unrelated treasure draws or aliases.
  const LEGACY_ENEMY_TERRAINS = Object.freeze([T.GRASS, T.FOREST, T.SAND,
    T.FARMLAND, T.RESIDENTIAL, T.ROCK, T.COMMERCIAL, T.INDUSTRIAL, T.WETLAND, T.ORCHARD]);
  const BIOME_FAUNA = {
    chicken:   { base: 30, range: 15, share: 0.80, primary: [T.FARMLAND, T.GRASS], fallback: [T.GRASS, T.FARMLAND, ...LOT, T.PARK, T.GROVE, T.SCHOOL] },
    cow:       { base: 12, range: 12, share: 0.90, primary: [T.GRASS], fallback: [T.GRASS, T.FARMLAND, ...LOT, T.PARK, T.GROVE, T.PITCH, T.GOLF] },
    cat:       { base: 6,  range: 8,  share: 0.80, primary: [T.RESIDENTIAL, T.COMMERCIAL], fallback: ALL_NATURAL.filter(t => t !== T.WASTELAND), excluded: [T.WASTELAND] },
    dog:       { base: 6,  range: 8,  share: 0.80, primary: [...LOT], fallback: ALL_NATURAL },
    deer:      { base: 8,  range: 6,  share: 1.00, primary: [T.FOREST, T.RESIDENTIAL], fallback: [T.FOREST, T.RESIDENTIAL], only: [T.FOREST, T.RESIDENTIAL] },
    crow:      { base: 200, range: 0, share: 1.00, primary: [T.PARK], fallback: [T.PARK], only: [T.PARK, T.GRASS] },
    butterfly: { base: 40, range: 20, share: 1.00, primary: [T.PARK, T.GROVE, T.GRASS, T.WETLAND, T.GOLF], fallback: [T.PARK, T.GROVE, T.GRASS, T.WETLAND, T.GOLF, T.SCHOOL, T.PLAYGROUND], excluded: [T.FOREST, T.ORCHARD] },
    slime:     { base: 50, range: 0, share: 1.00, primary: ALL_NATURAL, fallback: ALL_NATURAL },
    storm_gull: { only: [] }, // Retired guard bird; keep its art/roster available for authored previews.
    // Surface corvid identities are exclusive to their named ground.
    raven:     { base: 6, range: 5, share: 1, primary: [T.RESIDENTIAL], fallback: [T.RESIDENTIAL], only: [T.RESIDENTIAL] },
    // The horse is rare: five a tile on the cow's ground, against the cow's 12–23.
    horse:     { base: 5,  range: 0,  share: 0.90, primary: [T.GRASS, T.FARMLAND], fallback: [T.GRASS, T.FARMLAND, ...LOT, T.PARK, T.GROVE, T.PITCH, T.GOLF] },
  };

  // Generation-only habitat limits also apply to relocation and authored fauna.
  function faunaAllows(kind, type) {
    const row = BIOME_FAUNA[kind] || SHORE_FAUNA[kind];
    return !row || ((!row.only || row.only.includes(type)) && !row.excluded?.includes(type));
  }

  // ── Shore fauna ─────────────────────────────────────────────────────────
  // The WATERFRONT's animals are seated by their OWN rule, not by a row
  // above: BIOME_FAUNA draws candidate cells off the whole tile, and a beach
  // is a thin strip of it (the X marks learned that — scene_creatures.js
  // BEACH_X_PER_CELLS). So a shore species draws its seats from the tile's
  // SHORE cells (src/scenic.js shore sand, entry.scenic.shore — sand within
  // reach of water, whatever a zone repainted it to look like) and, where
  // `pier` says so, its PIER cells, and its COUNT follows the shoreline: one
  // per `perShoreM` metres of waterline (+ pier), capped at `max`. Each
  // species draws on its OWN stream (`salt`), so no other species' seats
  // move, and ids are the seat CELL (WorldGen.cellId). Inland sand (a
  // bunker, a sandpit) holds none. Seated through the spawn gate with the
  // kind's own class (creatureSpawnClass — the gull, a fast flier, is a
  // 'fastEnemy' and keeps off the kerb).
  const SHORE_FAUNA_ORDER = ['crab', 'gull', 'metal_slime', 'sea_turtle'];
  const SHORE_FAUNA = {
    metal_slime: { perShoreM: 300, max: 2, pier: true, salt: 'shorefauna|metal_slime' },
    crab: { perShoreM: 20, max: 24, pier: false, salt: 'shorefauna|crab' },
    gull: { perShoreM: 90, max: 6,  pier: false, only: [T.SAND],  salt: 'shorefauna|gull' },
    // The sea turtle: the rabbit's habits on the sand, fewer than the crabs.
    sea_turtle: { perShoreM: 70, max: 8, pier: false, salt: 'shorefauna|turtle' },
  };

  // The accessors. The raw tables reach app.js as the bare globals below
  // (BIOME_FAUNA / FAUNA_ORDER for the fauna spawner), not through here.
  const api = { T, flora, staticObjects, tint, atmos, mixHex, allows, faunaAllows, yard, yardAllows, patch, patchMul, FLORA_PATCH, GRASS_FILL,
    PARK_CHARACTERS, PARK_CHARACTER_IDS, CEMETERY_CHARACTER, parkCharacterAt, parkCharacter, isParkPoi };
  global.BiomeProfiles = api;
  global.BIOME_PROFILES = BIOME_PROFILES;
  global.BIOME_FAUNA = BIOME_FAUNA;
  global.FAUNA_ORDER = FAUNA_ORDER;
  global.LEGACY_ENEMY_TERRAINS = LEGACY_ENEMY_TERRAINS;
  global.SHORE_FAUNA = SHORE_FAUNA;
  global.SHORE_FAUNA_ORDER = SHORE_FAUNA_ORDER;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
