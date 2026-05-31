// Sandbox mode — a synthetic test world that replaces the player's start tile
// with a hand-laid TOWN + COUNTRYSIDE map. Loaded by appending `?sandbox=true`
// to the URL.
//
// Why this exists:
//   Every interactable in the game is gated by either the underlying terrain
//   type (tilling needs soil, rocks break to rockfruit, debris spawns per
//   polygon) or by a sparse worldgen roll (chests, trees, towers, special
//   shops). Reproducing all of them by walking the real map takes minutes. The
//   sandbox compresses every biome + every native interactable + every fauna
//   into one walkable area a tester can sweep in seconds.
//
// Design (the 2026-05 rewrite):
//   The old sandbox was a 5×5 grid of FLAT colour swatches — one solid biome
//   per plot. But worldgen never produces a pure "residential square"; a real
//   residential polygon is a SCENE: a road threads through it, houses (shop
//   type set by address digit) line the road, mineral rocks sit at the curb. So this version is built from SCENES — small realistic
//   composites — arranged in horizontal BANDS, separated by named connective
//   ROADS. The roads are not filler: they're how the road / road_lg / road_md
//   biomes (and their street-letter overlays) get covered.
//
//   Layout (north → south):
//     Band 1  COUNTRYSIDE     FOREST · ORCHARD · ROCK
//        ── Oak Road (road) ──
//     Band 2  WATER & PASTURE BARNYARD · PADDOCK · BEACH(sand+water+pier+well) · MARSH
//        ── Main Street (road_lg) ──
//     Band 3  CENTRE          PLAYER PLAZA · FARMLAND
//        ── Mill Lane (road_md) ──
//     Band 4  TOWN            RESIDENTIAL STREET · CIVIC BLOCK · SMALL HOUSE
//        ── Garden Row (road) ──
//     Band 5  RECREATION      PARK+PLAYGROUND+PITCH · CASTLE+FORT
//
//   Every terrain code 0..23, every interactable object kind + sub-variant,
//   and every fauna kind (incl. slime, wild net-gated butterfly, fishing, and
//   released/tame pets) has a home. See docs/SANDBOX.md for the coverage matrix.
//
// How it works:
//   1. detect() reads location.search for `sandbox=true`.
//   2. install(scene) pre-populates WorldGen.tileCache with a ready synthetic
//      tile entry for the player's start-tile coord. WorldGen.loadTile is a
//      `if (tileCache.has(key)) return tileCache.get(key)` short-circuit, so
//      the network fetch is bypassed entirely. Surrounding tiles get filled
//      with plain grass so edges read clean instead of black.
//   3. The scene map is laid out at the tile's CENTRE so the player (who starts
//      somewhere inside the start tile) is close to it; we also explicitly
//      reposition playerM to the PLAYER PLAZA scene.
//
// Dependencies (globals):
//   WorldGen — Z, tileCache, cellsPerEdgeForLat, tileEdgeMeters, makeRng
//   ITEMS / RELIC_DEFS / ARMOR_DEFS / maxEnergyFromArmor — for the test kit
//
// Exports as a global:
//   Sandbox.detect()       → bool
//   Sandbox.install(scene) → void

(function (global) {
  const GUTTER = 1;   // grass cells left between scenes within a band

  // ─────────────────────────────────────────────────────────────────────────
  // SCENE DEFINITIONS
  //
  // Each scene declares its size (w×h in cells), a base terrain `fill`, an
  // optional `paint(p)` for composite terrain (roads, water, pads…), and a
  // `populate(s)` that drops static objects / wildplants / creatures via the
  // pusher helpers. Runtime-state interactables (planted crops, placed rocks,
  // released pets, scarecrows) are seeded separately in seedSandboxState()
  // because they live in save.* arrays, not the tile entry.
  //
  // Coordinates passed to paint()/populate() are SCENE-RELATIVE (dx, dy from
  // the scene's top-left). The layout + install math converts them to absolute
  // tile cells.
  // ─────────────────────────────────────────────────────────────────────────

  // Terrain codes (mirror WorldGen.T / app.js COLORS).
  const T = {
    GRASS: 0, FOREST: 1, SAND: 2, WATER: 3, FARMLAND: 4, RESIDENTIAL: 5,
    PARK: 6, ROAD: 7, PATH: 8, BUILDING: 9, ROCK: 10, BUILDING_MED: 11,
    BUILDING_LARGE: 12, ROAD_LG: 13, ROAD_MD: 14, SCHOOL: 15, COMMERCIAL: 16,
    INDUSTRIAL: 17, PLAYGROUND: 18, PITCH: 19, WETLAND: 20, GOLF: 21,
    ORCHARD: 22, PIER: 23,
  };

  // ── FOREST — every tree variant + species, shrubs, nuts, wild fauna,
  //    a WILD (net-gated) butterfly, and a slime pest. ───────────────────────
  const FOREST = {
    name: 'FOREST', label: 'FOREST', w: 8, h: 7, fill: T.FOREST,
    populate(s) {
      // Maple growth stages 0..4 along the top row (render reads `variant`).
      for (let v = 0; v < 5; v++) s.tree(v, v, 0);
      // The three non-maple species (own full canopy sheets, frame 3).
      s.tree(2, 0, 2, 'pine');
      s.tree(2, 3, 2, 'birch');
      s.tree(2, 6, 2, 'mahogany');
      s.wildplant('shrub', 0, 4); s.wildplant('shrub', 7, 4);
      s.wildplant('nut', 2, 5);   s.wildplant('nut', 5, 5);
      // Wilderness fauna — deer drops meat (weapon-gated), rabbit drops pelt.
      s.creature('deer', 3, 3, 1);
      s.creature('rabbit', 1, 6, 1); s.creature('rabbit', 6, 6, 2);
      // WILD butterfly — exercises the bug-net gate (bare hands fail). The
      // released/tame butterfly lives in PADDOCK; this is the catchable one.
      s.creature('butterfly', 7, 1, 1);
      // Slime pest — drifts at the player and drains energy when close.
      s.creature('slime', 5, 2, 1);
    },
  };

  // ── ORCHARD — one of each of the 8 fruit-tree species + a farm-class chest.
  const ORCHARD = {
    name: 'ORCHARD', label: 'ORCHARD', w: 7, h: 7, fill: T.ORCHARD,
    populate(s) {
      s.fruitTree('apple', 0, 0);   s.fruitTree('orange', 3, 0);  s.fruitTree('cherry', 6, 0);
      s.fruitTree('mango', 0, 3);   s.fruitTree('coconut', 6, 3);
      s.fruitTree('peach', 0, 6);   s.fruitTree('apricot', 3, 6); s.fruitTree('banana', 6, 6);
      s.chest('park', 'Sandbox Orchard', 3, 3);   // square3 pad
    },
  };

  // ── ROCK — a mineral-rock sample at EVERY pickaxe tier T1..T7, plus plain
  //    rock in the gaps so bare-rock taps still work. (Gear is granted at T3,
  //    so T4..T7 stay "pick too weak → rejected" — the gating ladder end-to-end.)
  const ROCK = {
    name: 'ROCK', label: 'ROCK · ORE DEPOSITS', w: 7, h: 7, fill: T.ROCK,
    populate(s) {
      // ORE deposits at every pickaxe tier T1..T7 (gem-on-pebble, colour by
      // tier). Packed into a readable grid so the field clearly reads as a
      // quarry full of deposits rather than a few specks in the corners.
      s.mineralRock(1, 1, 1); s.mineralRock(2, 3, 1); s.mineralRock(3, 5, 1);
      s.mineralRock(4, 1, 3); s.mineralRock(5, 5, 3);
      s.mineralRock(6, 1, 5); s.mineralRock(7, 5, 5);
      // Plain CAVE rocks (the 4 vanilla variants) interleaved — break with any
      // pick, drop rockfruit + a lucky bar. Distinct sprite from the ore rocks.
      s.caveRock(0, 3, 3); s.caveRock(1, 3, 5); s.caveRock(2, 2, 2); s.caveRock(3, 4, 4);
    },
  };

  // ── BARNYARD — domestic herd, flowers, longgrass, wood ground-stacks, a
  //    slime. seedSandboxState() rings the perimeter with placed rockfruit
  //    rocks (a pen) and wanderCreatures() skips placedRockSet cells, so the
  //    herd stays inside. The player isn't blocked by the rocks, so they can
  //    step in to milk / catch / pet — and pickaxing a rock opens a gate.
  const BARNYARD = {
    name: 'BARNYARD', label: 'BARNYARD', w: 7, h: 7, fill: T.GRASS,
    populate(s) {
      s.creature('chicken', 2, 2, 1); s.creature('chicken', 4, 2, 2);
      s.creature('cow', 3, 3, 1);
      s.creature('cat', 2, 4, 1); s.creature('dog', 4, 4, 2);
      s.wildplant('longgrass', 3, 0); s.wildplant('longgrass', 3, 6);
      s.wood(0, 3, 2); s.wood(6, 3, 3);
      s.creature('slime', 0, 6, 1);
    },
  };

  // ── PADDOCK — a "petting paddock" of RELEASED (tame) pets, one of each
  //    tameable kind, seeded in seedSandboxState(). Lets a tester verify the
  //    purr/cluck pet path, cat-follow timer, and +50% double-produce boost
  //    without first taming anything. The pets are runtime state (save.released).
  const PADDOCK = {
    name: 'PADDOCK', label: 'PETTING PADDOCK', w: 5, h: 7, fill: T.GRASS,
    populate(s) {},
  };

  // ── BEACH — SAND + WATER + a plank PIER you stride out on + a WELL on the
  //    dry shore. Covers four terrains (2/3/23 + the well object) and FISHING:
  //    stand on the pier, tap a water cell to cast. Shells are common debris.
  const BEACH = {
    name: 'BEACH', label: 'BEACH · PIER · WELL', w: 11, h: 8, fill: T.SAND,
    paint(p) {
      p.rect(4, 0, 7, 8, T.WATER);          // open water on the right
      for (let dx = 3; dx <= 8; dx++) p.cell(dx, 4, T.PIER);   // plank jetty
    },
    populate(s) {
      s.wildplant('shell', 0, 0); s.wildplant('shell', 1, 2);
      s.wildplant('shell', 2, 6); s.wildplant('shell', 0, 7); s.wildplant('shell', 2, 5);
      s.creature('cat', 1, 1, 1);           // a cat sunning on the sand
      s.well(3, 6);                          // fountain on dry land
    },
  };

  // ── MARSH — WETLAND (top) + GOLF (bottom), both grassland-family.
  //    Longgrass only on the golf half (wetland doesn't grow it).
  const MARSH = {
    name: 'MARSH', label: 'WETLAND · GOLF', w: 6, h: 7, fill: T.WETLAND,
    paint(p) { p.rect(0, 4, 6, 3, T.GOLF); },
    populate(s) {
      s.wildplant('longgrass', 2, 4); s.wildplant('longgrass', 4, 5);
    },
  };

  // ── PLAYER PLAZA — spawn point. Crafting SHRINE, a WELL (can refill), a
  //    starter chest, and a tame chicken to catch. Coin drops, the in-reach
  //    treasure-X, and a placed rockfruit rock are seeded in seedSandboxState().
  const PLAZA = {
    name: 'PLAZA', label: 'PLAYER SPAWN', w: 9, h: 8, fill: T.GRASS,
    populate(s) {
      s.shrine(4, 1);
      s.well(1, 1);
      s.chest('shop', 'Sandbox Start Chest', 7, 6);   // line3h pad
      s.creature('chicken', 7, 3, 1);
      // Coin-burst POIs — tapping spills a burst of collectible coins (daily-
      // gated). Render as the procedural 'potofgold' art (render.js _isCoinBurst).
      s.chest('atm', 'Sandbox ATM', 6, 1);
      s.chest('bicycle_parking', 'Sandbox Bike Parking', 8, 2);
    },
  };

  // ── FARMLAND — the farming loop. Herd at the corners + a farm chest. The
  //    tilled rows, crops at every growth stage, and a scarecrow are seeded
  //    in seedSandboxState() (they're save.* runtime state).
  const FARMLAND = {
    name: 'FARMLAND', label: 'FARMLAND', w: 10, h: 8, fill: T.FARMLAND,
    populate(s) {
      s.creature('chicken', 0, 0, 1); s.creature('chicken', 9, 0, 2);
      s.creature('cow', 0, 7, 1);     s.creature('cow', 9, 7, 2);
      s.chest('farm', 'Sandbox Farm', 5, 4);   // square3 pad, +1 bonus yield
    },
  };

  // ── RESIDENTIAL STREET — the headline scene. A ROAD runs across the middle
  //    (with street-letter overlays); a house of EACH shop type lines it:
  //    blacksmith (addr 9), market (6), trader (8), plain/delivery (3). Yards
  //    carry mushroom decals + pickable mushrooms; a mineral rock sits at the
  //    curb (worldgen drops residential rocks only ≤1 cell from a road); cats
  //    & dogs roam (their primary biome). Houses are marked restored in seed.
  const RESIDENTIAL = {
    name: 'RESIDENTIAL', label: 'RESIDENTIAL ST', w: 13, h: 8, fill: T.RESIDENTIAL,
    paint(p) {
      p.rect(0, 3, 13, 2, T.ROAD);            // 2-cell street, rows dy3..4
      const nm = 'MAPLE ST';
      for (let dx = 0; dx < 13; dx++) {
        const ch = nm.charAt(dx % (nm.length + 3));
        if (ch && ch !== ' ' && dx % (nm.length + 3) < nm.length) p.roadLetter(dx, 3, ch);
      }
      // Building footprints under each house — real houses sit on BUILDING
      // terrain, which renders the extruded foundation block. Kept to the
      // house's own row (the yard in front stays walkable so the 6m house
      // tap-target stays reachable from the street side).
      for (const [hx, hy] of [[1, 0], [7, 0], [1, 7], [7, 7]]) {
        p.cell(hx, hy, T.BUILDING); p.cell(hx + 1, hy, T.BUILDING);
      }
    },
    populate(s) {
      s.house(1, 0, 9);   // blacksmith — top-left
      s.house(7, 0, 6);   // market     — top
      s.house(1, 7, 8);   // trader     — bottom-left
      s.house(7, 7, 3);   // plain/delivery (produce plaque) — bottom
      s.wildplant('mushroom', 3, 6); s.wildplant('mushroom', 10, 6);
      s.mineralRock(1, 5, 2);                                         // curbside rock
      s.creature('cat', 4, 1, 1); s.creature('dog', 9, 6, 1); s.creature('cat', 11, 2, 2);
    },
  };

  // ── CIVIC BLOCK — SCHOOL, COMMERCIAL, INDUSTRIAL terrains, each with a chest
  //    whose pad shape differs (school→triangle, shop→line3h, hospital→cross),
  //    linked by a named PATH (covers terrain 8 + the path-stone claim loop).
  //    Industrial mineral rocks for good measure.
  const CIVIC = {
    name: 'CIVIC', label: 'CIVIC BLOCK', w: 12, h: 8, fill: T.GRASS,
    paint(p) {
      p.rect(0, 0, 4, 3, T.SCHOOL);
      p.rect(5, 0, 4, 3, T.COMMERCIAL);
      p.rect(9, 0, 3, 8, T.INDUSTRIAL);
      for (let dx = 0; dx < 12; dx++) { p.cell(dx, 5, T.PATH); p.pathName(dx, 5, 'Garden Path'); }
    },
    populate(s) {
      s.chest('school', 'Sandbox School', 1, 1);       // triangle pad
      s.chest('shop', 'Sandbox Commerce', 6, 1);       // line3h pad
      s.chest('hospital', 'Sandbox Hospital', 10, 1);  // cross pad
      s.mineralRock(2, 10, 6); s.mineralRock(3, 11, 7);
    },
  };

  // ── SMALL HOUSE — a BUILDING-terrain (code 9) cluster. The terrain IS the
  //    interactable; we drop a bus-stop chest at the edge so the NO-PAD chest
  //    render path (bare wooden box) gets a sample, reachable from the gutter.
  const SMALLHOUSE = {
    name: 'SMALLHOUSE', label: 'SMALL HOUSE', w: 5, h: 8, fill: T.BUILDING,
    populate(s) {
      // The building ART comes from house OBJECTS, not the terrain (code 9
      // alone is just cobble). Scatter a small cluster of tier-9 houses with
      // plain addresses — auto-restored in seedSandboxState so they render as
      // houses, not pre-restoration wrecks. The bus chest stays at the west
      // edge, reachable from the gutter, for the no-pad chest render path.
      s.house(1, 1, 5); s.house(3, 2, 7); s.house(1, 5, 4); s.house(3, 6, 5);
      s.chest('bus', 'Sandbox Bus Stop', 0, 4);
    },
  };

  // ── RECREATION — PARK + PLAYGROUND + PITCH. Park chest (square3), playground
  //    chest (line3v), pitch chest (square2). Shrubs, longgrass, a cat & dog,
  //    a CROW pest (scarecrow seeded nearby), and a second wild butterfly.
  const RECREATION = {
    name: 'RECREATION', label: 'PARK · PLAYGROUND · PITCH', w: 15, h: 8, fill: T.PARK,
    paint(p) {
      p.rect(9, 0, 3, 8, T.PLAYGROUND);
      p.rect(12, 0, 3, 8, T.PITCH);
    },
    populate(s) {
      s.wildplant('shrub', 0, 0); s.wildplant('shrub', 8, 0);
      s.wildplant('longgrass', 0, 4);
      s.creature('cat', 1, 7, 1); s.creature('dog', 8, 7, 2);
      s.creature('crow', 4, 0, 1);            // pest; scarecrow seeded at (4,1)
      s.creature('butterfly', 7, 2, 2);       // second wild butterfly
      s.chest('park', 'Sandbox Park', 4, 4);
      s.chest('playground', 'Sandbox Playground', 10, 4);
      s.chest('pitch', 'Sandbox Pitch', 13, 4);
    },
  };

  // ── CASTLE + FORT — BUILDING_LARGE (castle, with towers = relic shop) and
  //    BUILDING_MED (fort, with a cache chest).
  const CASTLE = {
    name: 'CASTLE', label: 'CASTLE · FORT', w: 10, h: 8, fill: T.GRASS,
    paint(p) {
      p.rect(0, 0, 5, 8, T.BUILDING_LARGE);
      p.rect(6, 0, 4, 8, T.BUILDING_MED);
    },
    populate(s) {
      // Towers ARE the castle-shop interactable (unlimited relic stock + reroll).
      s.tower(2, 0); s.tower(0, 3); s.tower(4, 3); s.tower(2, 7);
      // Fort BUILDING (tier 11) — renders the fort sprite AND is the fort shop
      // (up to 5 deals/hour). Placed at the fort's bottom edge so it's reachable
      // from the grass below the scene (the rest of the fort blocks the player).
      s.house(7, 7, 0, 11);
    },
  };

  // Bands top→south. `roadAfter` draws a full-width connective road BELOW the
  // band (covering the road / road_lg / road_md terrains + their letters).
  const BANDS = [
    { roadAfter: { type: T.ROAD,    name: 'Oak Road',    thick: 1 }, scenes: [FOREST, ORCHARD, ROCK] },
    { roadAfter: { type: T.ROAD_LG, name: 'Main Street', thick: 2 }, scenes: [BARNYARD, PADDOCK, BEACH, MARSH] },
    { roadAfter: { type: T.ROAD_MD, name: 'Mill Lane',   thick: 1 }, scenes: [PLAZA, FARMLAND] },
    { roadAfter: { type: T.ROAD,    name: 'Garden Row',  thick: 1 }, scenes: [RESIDENTIAL, CIVIC, SMALLHOUSE] },
    { roadAfter: null, scenes: [RECREATION, CASTLE] },
  ];

  // Resolve each scene's grid-local origin (lx, ly) and the road rows. Sizes
  // are static, so this runs once at module load. install() then centres the
  // whole bounding box in the start tile.
  function buildLayout() {
    const scenes = [];
    const roads = [];
    let y = 0, width = 0;
    for (const band of BANDS) {
      let x = 0;
      const h = Math.max(...band.scenes.map((s) => s.h));
      for (const s of band.scenes) {
        s.lx = x; s.ly = y;
        scenes.push(s);
        x += s.w + GUTTER;
      }
      width = Math.max(width, x - GUTTER);
      y += h;
      if (band.roadAfter) {
        roads.push({ ...band.roadAfter, y });
        y += band.roadAfter.thick;
      }
    }
    return { scenes, roads, width, height: y };
  }
  const LAYOUT = buildLayout();
  const sceneByName = (n) => LAYOUT.scenes.find((s) => s.name === n);

  // ─────────────────────────────────────────────────────────────────────────
  // Detection
  // ─────────────────────────────────────────────────────────────────────────
  // Accept any "truthy-ish" value so people can type `?sandbox=1`, `?sandbox`,
  // `?sandbox=yes`, etc. Only `false` / `0` / `no` / empty-after-equals disable.
  function detect() {
    try {
      const sp = new URLSearchParams(location.search);
      if (!sp.has('sandbox')) return false;
      const v = (sp.get('sandbox') || '').toLowerCase();
      return v !== 'false' && v !== '0' && v !== 'no';
    } catch (_) { return false; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tile entry construction
  // ─────────────────────────────────────────────────────────────────────────
  // Pre-install a "ready" synthetic tile entry into WorldGen.tileCache so
  // WorldGen.loadTile() short-circuits on the cache lookup. The entry mirrors
  // the shape rasterizeTile() returns, plus a creatures[] array (normally
  // added by app.js spawnInTile — we set it here so spawnInTile is skipped).
  function makeTileEntry({ tx, ty, cellsPerEdge, tileEdgeM, cellM, populate }) {
    const grid = new Uint8Array(cellsPerEdge * cellsPerEdge);   // default 0 = grass
    const objects = [];
    const wildplants = [];
    const creatures = [];
    const roadLetters = {};
    const pathNames = {};

    // Helper: cell index → world metres at cell centre.
    const wmAt = (ix, iy) => ({
      x: tx * tileEdgeM + (ix + 0.5) * cellM,
      y: ty * tileEdgeM + (iy + 0.5) * cellM,
    });

    populate({ grid, objects, wildplants, creatures, roadLetters, pathNames,
               cellsPerEdge, wmAt, tx, ty });

    return {
      status: 'ready',
      grid,
      objects,
      wildplants,
      creatures,
      parkingTreasures: [],
      roadLetters,
      pathNames,
      treasure: null,
      tileEdgeM,
      cellsPerEdge,
      fromCache: true,
      // loadTile awaits entry.promise when status === 'loading'; ours is
      // ready so it's never awaited, but harmless to satisfy the shape.
      promise: Promise.resolve(null),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scene painting + population
  // ─────────────────────────────────────────────────────────────────────────

  // Build the set of pusher helpers for one scene. All take SCENE-RELATIVE
  // (dx, dy) and translate to absolute cells / world coords.
  function makeScenePush(ix0, iy0, tag, baseId, arrays, wmAt) {
    const { objects, wildplants, creatures } = arrays;
    const at = (dx, dy) => wmAt(ix0 + dx, iy0 + dy);
    return {
      at,
      creature(kind, dx, dy, n) {
        const { x, y } = at(dx, dy);
        creatures.push({ x, y, kind, id: `${baseId}_${tag}_${kind}_${n}` });
      },
      wildplant(crop, dx, dy) {
        const { x, y } = at(dx, dy);
        wildplants.push({ x, y, crop, _ix: ix0 + dx, _iy: iy0 + dy,
          id: `${baseId}_wp_${tag}_${crop}_${dx}_${dy}` });
      },
      tree(variant, dx, dy, species) {
        const { x, y } = at(dx, dy);
        const o = { kind: 'tree', x, y, variant,
          id: `${baseId}_tree_${tag}_${species || variant}_${dx}_${dy}` };
        if (species) o.species = species;   // non-maple species use own sheet
        objects.push(o);
      },
      fruitTree(species, dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push({ kind: 'fruittree', x, y, species,
          id: `${baseId}_ft_${tag}_${species}_${dx}_${dy}` });
      },
      chest(poiClass, name, dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push({ kind: 'chest', x, y, poiClass, name,
          id: `${baseId}_chest_${tag}_${dx}_${dy}` });
      },
      house(dx, dy, address = 0, tier = 9) {
        const { x, y } = at(dx, dy);
        objects.push({ kind: 'house', x, y, tier, address,
          id: `${baseId}_house_${tag}_${dx}_${dy}` });
      },
      wood(dx, dy, qty = 2) {
        const { x, y } = at(dx, dy);
        objects.push({ kind: 'groundstack', itemId: 'wood', qty, x, y,
          id: `${baseId}_wood_${tag}_${dx}_${dy}` });
      },
      tower(dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push({ kind: 'tower', x, y, id: `${baseId}_tower_${tag}_${dx}_${dy}` });
      },
      well(dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push({ kind: 'well', x, y, id: `${baseId}_well_${tag}_${dx}_${dy}` });
      },
      shrine(dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push({ kind: 'shrine', x, y, id: `${baseId}_shrine_${tag}_${dx}_${dy}` });
      },
      mineralRock(requiredTier, dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push({ kind: 'mineralrock', x, y, requiredTier,
          id: `${baseId}_mr_${tag}_t${requiredTier}_${dx}_${dy}` });
      },
      // Plain CAVE rock (caveVariant 0..3) — any pick breaks it, drops
      // rockfruit + a tier-scaled lucky bar. Renders the vanilla rock sprite,
      // visually distinct from the gem-on-pebble ore rocks.
      caveRock(variant, dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push({ kind: 'mineralrock', x, y, requiredTier: 1, caveVariant: variant,
          id: `${baseId}_cr_${tag}_${variant}_${dx}_${dy}` });
      },
    };
  }

  // Lay every scene + connective road into the centre tile's grid, and push
  // every scene's static interactables. Called once per sandbox install (via
  // makeTileEntry's populate hook for the centre tile only).
  function populateSandbox(originIX, originIY, c) {
    const { grid, objects, wildplants, creatures, roadLetters, pathNames,
            cellsPerEdge, wmAt, tx, ty } = c;
    const baseId = `sb_${tx}_${ty}`;

    for (const s of LAYOUT.scenes) {
      const ix0 = originIX + s.lx, iy0 = originIY + s.ly;
      const setCell = (dx, dy, terrain) => {
        const ix = ix0 + dx, iy = iy0 + dy;
        if (ix < 0 || iy < 0 || ix >= cellsPerEdge || iy >= cellsPerEdge) return;
        grid[iy * cellsPerEdge + ix] = terrain;
      };
      const rect = (dx, dy, w, h, terrain) => {
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) setCell(dx + xx, dy + yy, terrain);
      };
      // 1. base terrain fill
      rect(0, 0, s.w, s.h, s.fill);
      // 2. composite terrain overrides (roads / water / pads / paths)
      if (s.paint) {
        s.paint({
          cell: setCell,
          rect,
          roadLetter: (dx, dy, ch) => { roadLetters[`${ix0 + dx}_${iy0 + dy}`] = { char: ch, angle: 0 }; },
          pathName: (dx, dy, name) => { pathNames[`${ix0 + dx}_${iy0 + dy}`] = name; },
        });
      }
      // 3. static interactables
      s.populate(makeScenePush(ix0, iy0, s.name, baseId, { objects, wildplants, creatures }, wmAt));
    }

    // Connective roads span the full layout width below their band.
    for (const r of LAYOUT.roads) {
      const letters = r.name.toUpperCase();
      const period = letters.length + 4;   // blank gap between name repeats
      for (let t = 0; t < r.thick; t++) {
        const iy = originIY + r.y + t;
        if (iy < 0 || iy >= cellsPerEdge) continue;
        for (let dx = 0; dx < LAYOUT.width; dx++) {
          const ix = originIX + dx;
          if (ix < 0 || ix >= cellsPerEdge) continue;
          grid[iy * cellsPerEdge + ix] = r.type;
          if (t === 0) {
            const m = dx % period;
            const ch = m < letters.length ? letters.charAt(m) : ' ';
            if (ch !== ' ') roadLetters[`${ix}_${iy}`] = { char: ch, angle: 0 };
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Install
  // ─────────────────────────────────────────────────────────────────────────
  function install(scene) {
    // Flag the scene so other systems (GPS, etc.) know to behave differently.
    scene._sandboxMode = true;
    // If a previous session had already started watching GPS, kill the watch so
    // an incoming fix doesn't race the teleport at the bottom of this function.
    if (scene.gpsWatchId != null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(scene.gpsWatchId); } catch (_) {}
      scene.gpsWatchId = null;
    }
    scene.gpsAvailable = false;
    const cellsPerEdge = scene.cellsPerTile;
    const tileEdgeM = scene.tileEdgeM;
    const cellM = scene.cellM;
    // Centre the whole scene map in the start tile so the player's start
    // (somewhere inside the tile) is close to it. We reposition to PLAZA below.
    const gridOriginIX = Math.floor((cellsPerEdge - LAYOUT.width) / 2);
    const gridOriginIY = Math.floor((cellsPerEdge - LAYOUT.height) / 2);

    const startCell = scene.playerToWorldCell();
    const centreTX = startCell.tx;
    const centreTY = startCell.ty;

    // Build the centre tile (the sandbox) and 8 grass-only neighbours so the
    // viewport edge doesn't show "loading…" tiles.
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const tx = centreTX + dtx, ty = centreTY + dty;
        const key = `${WorldGen.Z}/${tx}/${ty}`;
        if (WorldGen.tileCache.has(key)) continue;
        const isCentre = (dtx === 0 && dty === 0);
        const entry = makeTileEntry({
          tx, ty, cellsPerEdge, tileEdgeM, cellM,
          populate: isCentre
            ? populateSandbox.bind(null, gridOriginIX, gridOriginIY)
            : () => { /* grass everywhere, no items */ },
        });
        WorldGen.tileCache.set(key, entry);
      }
    }

    // Teleport the player to the PLAYER PLAZA scene's centre.
    const plaza = sceneByName('PLAZA');
    const playerCellIX = gridOriginIX + plaza.lx + Math.floor(plaza.w / 2);
    const playerCellIY = gridOriginIY + plaza.ly + Math.floor(plaza.h / 2);
    const targetWorldX = centreTX * tileEdgeM + (playerCellIX + 0.5) * cellM;
    const targetWorldY = centreTY * tileEdgeM + (playerCellIY + 0.5) * cellM;
    scene.playerM.x = targetWorldX - scene.startWorldM.x;
    scene.playerM.y = targetWorldY - scene.startWorldM.y;
    // Cancel any GPS-ease that might overwrite our teleport.
    scene._ease = null;
    // Pretend a GPS fix arrived so the UI doesn't sit in "no GPS" mode.
    scene.gpsM = { x: scene.playerM.x, y: scene.playerM.y };
    // Plant a treasure X one cell north of spawn (within REACH_TREASURE_M) so
    // the tester can verify treasure-tap loot without hunting for one.
    const centreEntry = WorldGen.tileCache.get(`${WorldGen.Z}/${centreTX}/${centreTY}`);
    if (centreEntry && !centreEntry.treasure) {
      centreEntry.treasure = {
        id: `sandbox_treasure_${centreTX}_${centreTY}`,
        x: targetWorldX,
        y: targetWorldY - cellM,
      };
    }

    installSceneLabels(scene, gridOriginIX, gridOriginIY, centreTX, centreTY,
                       tileEdgeM, cellM);

    // Stock the inventory with a representative test set — ~5 of every
    // sellable / consumable / placeable item — so every icon / sell / eat /
    // place flow is exercisable without first collecting samples. Clobbered on
    // every load for a predictable baseline.
    stockSandboxInventory(scene);

    // Grant a full mid-tier (T3) gear kit so every relic/armor-gated action is
    // reachable while still leaving the pickaxe BELOW the T4..T7 rocks (so the
    // "pick too weak → rejected" branch stays demonstrable). Clobbered too.
    grantSandboxGear(scene);

    // Seed runtime state that lives outside the tile entry — planted crops,
    // placed rocks, released pets, scarecrows, coin drops, extra treasures.
    seedSandboxState(scene, gridOriginIX, gridOriginIY, centreTX, centreTY,
                     cellsPerEdge, tileEdgeM, cellM);
  }

  // Equip one of every relic + armor piece at T3 (see note above). Armor raises
  // max energy, so re-derive it and top the bar up.
  function grantSandboxGear(scene) {
    if (typeof RELIC_DEFS === 'undefined' || typeof ARMOR_DEFS === 'undefined') return;
    const TIER = 3;
    const relics = {};
    for (const slot of Object.keys(RELIC_DEFS)) relics[slot] = { tier: TIER };
    scene.save.relics = relics;
    const armor = {};
    for (const slot of Object.keys(ARMOR_DEFS)) armor[slot] = { tier: TIER };
    scene.save.armor = armor;
    if (typeof maxEnergyFromArmor === 'function') {
      scene.save.maxEnergy = maxEnergyFromArmor(armor);
    }
    scene.save.energy = scene.save.maxEnergy || scene.save.energy;
    if (typeof scene.updateHUD === 'function') scene.updateHUD();
    if (typeof scene.persistSave === 'function') scene.persistSave();
  }

  // Drop runtime-state interactables into the scenes. All live in save.* arrays
  // / scene-side Sets, so we mutate the scene directly. Clobber-and-rebuild for
  // a predictable baseline across reloads.
  function seedSandboxState(scene, originIX, originIY, centreTX, centreTY,
                            cellsPerEdge, tileEdgeM, cellM) {
    const save = scene.save;
    save.planted = [];
    save.placedRocks = [];
    save.scarecrows = [];
    save.tilled = [];
    save.released = [];
    scene.tilledSet = new Set();
    scene.placedRockSet = new Set();
    save.restoredHouses = save.restoredHouses || {};
    const centreEntry = WorldGen.tileCache.get(`${WorldGen.Z}/${centreTX}/${centreTY}`);

    // Helpers ────────────────────────────────────────────────────────────────
    // Absolute cell of (dx, dy) inside a named scene.
    const sceneCell = (name, dx, dy) => {
      const s = sceneByName(name);
      return { cellIX: originIX + s.lx + dx, cellIY: originIY + s.ly + dy };
    };
    const cellCenter = (cellIX, cellIY) => ({
      x: centreTX * tileEdgeM + (cellIX + 0.5) * cellM,
      y: centreTY * tileEdgeM + (cellIY + 0.5) * cellM,
    });

    // ── Restore every house in the sandbox tile. Tier-9 houses render as a
    //    generic "wreck" until restored — so without this, the blacksmith /
    //    market / trader sprites + signs + the plain-house produce plaque would
    //    never appear. Mark them all restored on load.
    for (const o of (centreEntry?.objects || [])) {
      if (o.kind === 'house' && o.id) save.restoredHouses[o.id] = true;
    }

    // ── FARMLAND: a row of crops at every growth stage 0..4. The cell must be
    //    tilled first; the renderer reads each entry's `stage` directly so we
    //    don't have to wait for real game time.
    const CROPS_AT_STAGE = ['rainberry', 'pairy', 'nut', 'potato', 'rockfruit'];
    for (let stage = 0; stage < 5; stage++) {
      const { cellIX, cellIY } = sceneCell('FARMLAND', 2 + stage, 2);
      const key = `${cellIX}_${cellIY}`;
      scene.tilledSet.add(key); save.tilled.push(key);
      const { x, y } = cellCenter(cellIX, cellIY);
      save.planted.push({ x, y, crop: CROPS_AT_STAGE[stage], stage, watered_t: 0 });
    }
    // Mature crop pre-watered → harvesting it exercises the double-produce path.
    const mature = save.planted[save.planted.length - 1];
    if (mature) mature.canBoost = 2;
    // Scarecrow on the farm — renders a sprite + a 4-cell crow/deer aversion ring.
    {
      const { cellIX, cellIY } = sceneCell('FARMLAND', 4, 4);
      save.scarecrows.push(cellCenter(cellIX, cellIY));
    }

    // ── BARNYARD: a full perimeter ring of placed rockfruit-rocks pens the
    //    herd (wanderCreatures skips placedRockSet cells). Pickaxing a rock
    //    opens a gate + drops a rockfruit, so the ring doubles as rockfruit-
    //    rock coverage.
    {
      const s = sceneByName('BARNYARD');
      const ring = (dx, dy) => {
        const { cellIX, cellIY } = sceneCell('BARNYARD', dx, dy);
        const key = `${cellIX}_${cellIY}`;
        if (!scene.placedRockSet.has(key)) { scene.placedRockSet.add(key); save.placedRocks.push(key); }
      };
      for (let d = 0; d < s.w; d++) { ring(d, 0); ring(d, s.h - 1); }
      for (let d = 0; d < s.h; d++) { ring(0, d); ring(s.w - 1, d); }
    }
    // A lone placed rockfruit-rock in the PLAZA for the pickaxe-on-placed cycle.
    {
      const { cellIX, cellIY } = sceneCell('PLAZA', 2, 6);
      const key = `${cellIX}_${cellIY}`;
      if (!scene.placedRockSet.has(key)) { scene.placedRockSet.add(key); save.placedRocks.push(key); }
    }

    // ── PADDOCK: one RELEASED (tame) pet of each tameable kind. Tame animals
    //    (id starts 'released_') trigger the pet path on tap; cats follow for
    //    5 min; produce-givers double-yield. They live in save.released.
    const PADDOCK_PETS = ['cat', 'dog', 'cow', 'chicken', 'butterfly'];
    PADDOCK_PETS.forEach((kind, i) => {
      const dx = 1 + (i % 3), dy = 1 + Math.floor(i / 3) * 3;
      const { cellIX, cellIY } = sceneCell('PADDOCK', dx, dy);
      const { x, y } = cellCenter(cellIX, cellIY);
      save.released.push({ x, y, kind, id: `released_${kind}_sandbox_${i}`,
        tx: centreTX, ty: centreTY });
    });

    // ── RECREATION (park): a scarecrow beside the crow so its aversion ring is
    //    visible against a real pest.
    {
      const { cellIX, cellIY } = sceneCell('RECREATION', 4, 1);
      save.scarecrows.push(cellCenter(cellIX, cellIY));
    }

    // ── PLAYER PLAZA: a little coin-drop burst (the coindrop tap path). In the
    //    real game these expire after 60s; here we omit expiresAt so they
    //    persist across reloads. They live in entry.coinDrops, not objects[].
    if (centreEntry) {
      centreEntry.coinDrops = [];
      const coin = (dx, dy) => {
        const { cellIX, cellIY } = sceneCell('PLAZA', dx, dy);
        const { x, y } = cellCenter(cellIX, cellIY);
        centreEntry.coinDrops.push({ kind: 'coindrop', x, y, id: `sandbox_coin_${cellIX}_${cellIY}` });
      };
      coin(4, 3); coin(3, 2); coin(5, 2);
    }

    // ── An extra treasure-X on the SW neighbour tile, at the seam with the
    //    centre tile (each tile entry holds only ONE `treasure` slot, and the
    //    in-reach one north of spawn already used the centre tile's slot).
    const swKey = `${WorldGen.Z}/${centreTX - 1}/${centreTY + 1}`;
    const swEntry = WorldGen.tileCache.get(swKey);
    if (swEntry && !swEntry.treasure) {
      const cellIX = cellsPerEdge - 2, cellIY = 1;
      swEntry.treasure = {
        id: `sandbox_treasure_sw_${centreTX - 1}_${centreTY + 1}`,
        x: (centreTX - 1) * tileEdgeM + (cellIX + 0.5) * cellM,
        y: (centreTY + 1) * tileEdgeM + (cellIY + 0.5) * cellM,
      };
    }

    if (typeof scene.persistSave === 'function') scene.persistSave();
  }

  function stockSandboxInventory(scene) {
    if (typeof ITEMS === 'undefined') return;
    const COUNT = 5;
    const inv = [];
    // Most-tested kinds first (seeds → produce → animals → minerals → consumables).
    const ORDER = ['seed', 'produce', 'animal', 'mineral', 'consumable'];
    const byKind = {};
    for (const it of ITEMS) {
      if (!it || !it.id || !it.kind) continue;
      (byKind[it.kind] = byKind[it.kind] || []).push(it.id);
    }
    for (const kind of ORDER) {
      for (const id of (byKind[kind] || [])) inv.push({ id, count: COUNT });
    }
    for (const kind of Object.keys(byKind)) {
      if (ORDER.includes(kind)) continue;
      for (const id of byKind[kind]) inv.push({ id, count: COUNT });
    }
    scene.save.inv = inv;
    scene.save.selSlot = 0;
    if (typeof scene.buildInventoryDOM === 'function') scene.buildInventoryDOM();
    if (typeof scene.persistSave === 'function') scene.persistSave();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scene name labels (debug orientation captions)
  // ─────────────────────────────────────────────────────────────────────────
  // A thin white-on-black caption at each scene's centre. Helps a tester orient
  // (terrain colours are subtle and the layout is non-obvious from inside the
  // game). Anchored as Phaser text on its own depth above cell paint.
  function installSceneLabels(scene, originIX, originIY, tx, ty, tileEdgeM, cellM) {
    if (!scene._sandboxLabels) {
      scene._sandboxLabels = scene.add.container(0, 0).setDepth(50);
    }
    scene._sandboxLabels.removeAll(true);
    scene._sandboxLabelData = [];
    for (const s of LAYOUT.scenes) {
      const cellIX = originIX + s.lx + Math.floor(s.w / 2);
      const cellIY = originIY + s.ly + Math.floor(s.h / 2);
      const wx = tx * tileEdgeM + (cellIX + 0.5) * cellM;
      const wy = ty * tileEdgeM + (cellIY + 0.5) * cellM;
      const t = scene.add.text(0, 0, s.label, {
        font: 'bold 8px ui-monospace, monospace',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.6)',
        padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 0).setVisible(false);
      scene._sandboxLabels.add(t);
      scene._sandboxLabelData.push({ wx, wy, t });
    }
    // Re-position labels from their world coord every frame so they follow the
    // camera. wanderCreatures runs each scene tick and we own the reference, so
    // wrap it (a direct scene.update patch doesn't intercept Phaser's binding).
    if (!scene._sandboxLabelTickInstalled) {
      scene._sandboxLabelTickInstalled = true;
      const reposition = () => {
        const data = scene._sandboxLabelData;
        if (!data) return;
        const pWX = scene.startWorldM.x + scene.playerM.x;
        const pWY = scene.startWorldM.y + scene.playerM.y;
        const halfM = (VIEW_CELLS / 2 + 1) * scene.cellM;
        for (const d of data) {
          const dx = d.wx - pWX, dy = d.wy - pWY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) { d.t.setVisible(false); continue; }
          const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
          const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
          d.t.setVisible(true).setPosition(Math.round(sx), Math.round(sy));
        }
      };
      const origWander = scene.wanderCreatures.bind(scene);
      scene.wanderCreatures = function () {
        const r = origWander();
        try { reposition(); } catch (_) { /* never throw in update */ }
        return r;
      };
    }
  }

  global.Sandbox = { detect, install };
})(window);
