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
// Design:
// Worldgen never produces a pure "residential square"; a real residential
// polygon is a SCENE: a road threads through it, houses (shop type set by
// address digit) line the road, mineral rocks sit at the curb. So the sandbox
// is built from SCENES arranged in horizontal bands, separated by named
// connective roads. Each road also carries decoded vector geometry, so the
// sandbox uses the same overlay, restoration, lamp and street-dressing lanes as
// a map tile.
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
//     Band 6  NEW MECHANICS   STREET VARIANTS · GROVE/OLD STONES/TAR YARD
//
//   Every surface terrain, every rolled street variant and representative
//   interactables, fauna and foes have a home. See docs/process/SANDBOX.md for the
//   coverage matrix and the cave-only exclusions.
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
//   WorldGen — Z, tileCache, tileEdgeMeters, makeRng
//   coords.js — rowCells (each tile's own grid)
//   ITEMS / RELIC_DEFS / ARMOR_DEFS — for the test kit
//   fnv1a (util.js) — shared FNV-1a hash, for the flora-placer's seed
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

  // Terrain codes — the one table worldgen.js owns (loaded before this file),
  // not a hand-kept mirror that could drift from it.
  const T = WorldGen.T;

  // ── FOREST — every tree variant + species, shrubs, nuts, wild fauna,
  //    a WILD (net-gated) butterfly, and a slime pest. ───────────────────────
  const FOREST = {
    name: 'FOREST', label: 'FOREST', w: 8, h: 7, fill: T.FOREST,
    populate(s) {
      // Maple growth stages 0..4 along the top row (render reads `variant`).
      for (let v = 0; v < 5; v++) s.tree(v, v, 0);
      // Pine companions at three growth sizes.
      s.tree(2, 0, 2, 'pine');
      s.tree(1, 3, 2, 'pine');
      s.tree(4, 6, 2, 'pine');
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
      // Boar — charges in a line, rests, hurts only on contact.
      s.creature('boar', 7, 5, 1);
    },
  };

  // ── ORCHARD — the two available fruit-tree species (common apple, rare
  // peach) in a small grid + a farm-class chest.
  const ORCHARD = {
    name: 'ORCHARD', label: 'ORCHARD', w: 7, h: 7, fill: T.ORCHARD,
    populate(s) {
      s.fruitTree('apple', 0, 0);   s.fruitTree('apple', 3, 0);  s.fruitTree('worldpeach', 6, 0);
      s.fruitTree('apple', 0, 3);   s.fruitTree('worldpeach', 6, 3);
      s.fruitTree('apple', 0, 6);   s.fruitTree('apple', 3, 6);  s.fruitTree('worldpeach', 6, 6);
      s.chest('park', 'Sandbox Orchard', 3, 3);   // round pad
    },
  };

  // ── ROCK — one ore rock of EVERY yield tier T1..T7, plus plain rock in the
  //    gaps so bare-rock taps still work. The sandbox pickaxe is granted at
  //    frost (T7), so every deposit is mineable — letting a tester verify each
  //    ore type drops its matching bar and renders its matching ore-stone.
  const ROCK = {
    name: 'ROCK', label: 'ROCK · ORE DEPOSITS', w: 7, h: 7, fill: T.ROCK,
    populate(s) {
      // One deposit per yield tier T1..T7. yieldTier sets the ore-stone colour
      // and the bar it drops: T1 plain rock→rockfruit, T2 copper, T3 iron,
      // T4 gold, T5 platinum, T6 crimson, T7 frost. Packed into a readable grid.
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
  //    without first feeding and catching anything. The pets are runtime state (save.released).
  const PADDOCK = {
    name: 'PADDOCK', label: 'PETTING PADDOCK', w: 5, h: 7, fill: T.GRASS,
    populate(s) {
      s.wildplant('shrub', 0, 5, { _sandboxProbe: 'nest' });
    },
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
      s.creature('giant_crab', 2, 3, 1);     // representative shore enemy
      s.creature('gull', 3, 1, 1);           // scenic-shore scavenger
      s.creature('sea_turtle', 1, 4, 1);         // the rabbit of the beach
      s.object('bottle', 0, 4, { _sandboxProbe: 'shore-bottle' });
      s.well(3, 6);                          // fountain on dry land
    },
  };

  // ── MARSH — WETLAND (top) + GOLF (bottom), both grassland-family.
  //    Longgrass only on the golf half (wetland doesn't grow it).
  const MARSH = {
    name: 'MARSH', label: 'WETLAND · GOLF', w: 8, h: 12, fill: T.WETLAND,
    subLabels: [{ label: 'WETLAND', dx: 4, dy: 3 }, { label: 'GOLF', dx: 4, dy: 9 }],
    paint(p) { p.rect(0, 7, 8, 5, T.GOLF); },   // wetland rows 0-6, golf rows 7-11
    populate(s) {
      // Sample tufts; the real per-biome distribution is added by scatterSandboxFlora.
      s.wildplant('longgrass', 2, 8); s.wildplant('longgrass', 5, 9);   // on golf
    },
  };

  // ── PLAYER PLAZA — spawn point. WIZARD TOWER, a WELL (can refill), a
  //    starter chest, and a tame chicken to catch. Coin drops, the in-reach
  //    treasure-X, and a placed rockfruit rock are seeded in seedSandboxState().
  const PLAZA = {
    name: 'PLAZA', label: 'PLAYER SPAWN', w: 9, h: 8, fill: T.GRASS,
    populate(s) {
      s.wizardHouse(4, 1);
      s.well(1, 1);
      s.startChest('Sandbox Start Chest', 7, 6, { id: 'wood', qty: 5 });   // real starter chest — no pad
      s.creature('chicken', 7, 3, 1);
      // A pot of gold (an ATM) — tapping spills a burst of collectible coins
      // (daily-gated) — and a bike rack, which lends the stick a bike for
      // three minutes (loot.js chestLook: 'potofgold' / 'bike_rack').
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
      s.creature('horse', 4, 7, 1);   // rare mount — catch it, then Ride from the bag
      s.chest('farm', 'Sandbox Farm', 5, 4);   // round pad, +1 bonus yield
    },
  };

  // ── RESIDENTIAL STREET — the headline scene. A ROAD runs across the middle
  //    (with street-name labels); a house of EACH shop type lines it:
  //    blacksmith, market, trader and plain/delivery via explicit cards. Yards
  //    carry mushroom decals + pickable mushrooms; a mineral rock sits at the
  //    curb (worldgen drops residential rocks only ≤1 cell from a road); cats
  //    & dogs roam (their primary biome). Houses are marked restored in seed.
  const RESIDENTIAL = {
    name: 'RESIDENTIAL', label: 'RESIDENTIAL ST', w: 13, h: 8, fill: T.RESIDENTIAL,
    routes: [{ name: 'Maple Street', class: 'street', type: T.ROAD, y: 3, thick: 2,
      x0: 0, x1: 12, variant: null }],
    paint(p) {
      p.rect(0, 3, 13, 2, T.ROAD);            // 2-cell street, rows dy3..4
      // One whole-word label per street half (covers the road-label render path).
      p.roadLabel(3, 3, 'Maple');
      p.roadLabel(10, 3, 'Maple');
      // Building footprints under each house — real houses sit on BUILDING
      // terrain, which renders the extruded foundation block. Kept to the
      // house's own row (the yard in front stays walkable so the 6m house
      // tap-target stays reachable from the street side).
      for (const [hx, hy] of [[1, 0], [7, 0], [1, 7], [7, 7]]) {
        p.rect(hx, hy, 2, 1, T.BUILDING);
      }
      // A vacant lot across the street from the houses — WASTELAND, the
      // unclassified landuse that plays as residential but looks like scrub.
      p.rect(4, 5, 3, 2, T.WASTELAND);
    },
    populate(s) {
      s.house(1, 0, 9, 9, { _sandboxBuild: 'blacksmith:1' });   // blacksmith — top-left
      s.house(7, 0, 6, 9, { _sandboxBuild: 'market:seed:1' });   // market     — top
      s.house(1, 7, 8, 9, { _sandboxBuild: 'trader:1' });   // trader     — bottom-left
      s.house(7, 7, 3);   // plain/delivery (produce plaque) — bottom
      s.wildplant('mushroom', 3, 6); s.wildplant('mushroom', 10, 6);
      s.mineralRock(1, 5, 2);                                         // curbside rock
      s.creature('cat', 4, 1, 1); s.creature('dog', 9, 6, 1); s.creature('cat', 11, 2, 2);
    },
  };

  // ── CIVIC BLOCK — SCHOOL, COMMERCIAL, INDUSTRIAL terrains, each with a chest
  //    (school / shop / hospital — all now share the one rounded pad),
  //    linked by a named PATH (covers terrain 8 + the path-stone claim loop).
  //    Industrial mineral rocks for good measure.
  const CIVIC = {
    name: 'CIVIC', label: 'CIVIC BLOCK', w: 16, h: 12, fill: T.GRASS,
    subLabels: [{ label: 'SCHOOL', dx: 3, dy: 2 }, { label: 'COMMERCIAL', dx: 11, dy: 5 },
                { label: 'INDUSTRIAL', dx: 3, dy: 8 }],
    paint(p) {
      p.rect(0, 0, 7, 5, T.SCHOOL);          // top-left
      p.rect(0, 6, 7, 5, T.INDUSTRIAL);      // bottom-left
      p.rect(8, 0, 8, 11, T.COMMERCIAL);     // right column — big enough to read the hedge maze
      for (let dx = 0; dx < 16; dx++) p.cell(dx, 11, T.PATH);
    },
    populate(s) {
      s.chest('school', 'Sandbox School', 3, 2);       // round pad
      s.chest('shop', 'Sandbox Commerce', 11, 3);      // round pad
      s.chest('hospital', 'Sandbox Hospital', 3, 8);   // round pad
      s.mineralRock(2, 5, 8); s.mineralRock(3, 6, 9);  // industrial ore
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

  // ── RECREATION — PARK + PLAYGROUND + PITCH. Park / playground / pitch chests
  //    all share the one rounded pad. Shrubs, longgrass, a cat & dog,
  //    a CROW pest (scarecrow seeded nearby), and a second wild butterfly.
  const RECREATION = {
    name: 'RECREATION', label: 'PARK · PLAYGROUND · PITCH', w: 24, h: 12, fill: T.PARK,
    routes: [{ name: 'Common Walk', class: 'path', type: T.PATH, y: 9, thick: 1,
      x0: 0, x1: 8, variant: null, scenic: 'park' }],
    subLabels: [{ label: 'PARK', dx: 4, dy: 6 }, { label: 'PLAYGROUND', dx: 12, dy: 6 },
                { label: 'PITCH', dx: 20, dy: 6 }],
    paint(p) {
      p.rect(9, 0, 7, 12, T.PLAYGROUND);   // cols 9-15
      p.rect(16, 0, 8, 12, T.PITCH);       // cols 16-23
      p.rect(0, 9, 9, 1, T.PATH);
      p.roadLabel(4, 9, 'Common Walk');
    },
    populate(s) {
      s.wildplant('shrub', 0, 0); s.wildplant('shrub', 7, 0);
      s.wildplant('longgrass', 0, 4);
      s.creature('cat', 1, 10, 1); s.creature('dog', 6, 10, 2);
      s.creature('crow', 4, 0, 1);            // pest; scarecrow seeded at (4,1)
      s.creature('butterfly', 7, 2, 2);       // second wild butterfly
      s.chest('park', 'Sandbox Park', 4, 4);
      s.creature('plant', 3, 8, 1);
      s.creature('plant', 6, 6, 2);
      s.chest('playground', 'Sandbox Playground', 12, 6);
      s.chest('pitch', 'Sandbox Pitch', 20, 6);
    },
  };

  // ── CASTLE + FORT — BUILDING_LARGE (castle, with towers = relic shop) and
  //    BUILDING_MED (fort, with a cache chest).
  const CASTLE = {
    name: 'CASTLE', label: 'CASTLE · FORT', w: 10, h: 8, fill: T.GRASS,
    subLabels: [{ label: 'CASTLE', dx: 2, dy: 4 }, { label: 'FORT', dx: 7, dy: 4 }],
    paint(p) {
      p.rect(0, 0, 5, 8, T.BUILDING_LARGE);
      p.rect(6, 0, 4, 8, T.BUILDING_MED);
    },
    populate(s) {
      // Towers ARE the castle-shop interactable (unlimited relic stock + reroll).
      s.tower(0, 0); s.tower(4, 0); s.tower(0, 7); s.tower(4, 7);
      // Fort BUILDING (tier 11) — renders the fort sprite AND is the fort shop
      // (up to 5 deals/hour). Placed at the fort's bottom edge so it's reachable
      // from the grass below the scene (the rest of the fort blocks the player).
      s.house(7, 7, 0, 11);
    },
  };

  // The showcase uses one table for terrain paint, vector geometry, variant
  // indexing and labels. This keeps the authored road and the road the live
  // overlay sees identical.
  const SHOWCASE_ROUTES = [
    { name: 'Fern Way', class: 'minor', type: T.ROAD, y: 1, thick: 1, x0: 0, x1: 23, variant: 'overgrown' },
    { name: 'Cherry Lane', class: 'minor', type: T.ROAD, y: 4, thick: 1, x0: 0, x1: 23, variant: 'orchard' },
    { name: 'Abbey Walk', class: 'minor', type: T.ROAD, y: 7, thick: 1, x0: 0, x1: 23, variant: 'pilgrim' },
    { name: 'Coin Row', class: 'minor', type: T.ROAD, y: 10, thick: 1, x0: 0, x1: 23, variant: 'golden' },
    { name: 'Market Close', class: 'minor', type: T.ROAD, y: 13, thick: 1, x0: 0, x1: 23, variant: null },
    { name: 'Thorny Way', class: 'minor', type: T.ROAD, y: 35, thick: 1, x0: 0, x1: 23, variant: 'thorny' },
    { name: 'Iron Lane', class: 'minor', type: T.ROAD, y: 18, thick: 1, x0: 0, x1: 23, variant: 'snare' },
    { name: 'Fort Road', class: 'tertiary', type: T.ROAD_MD, y: 25, thick: 2, x0: 0, x1: 23, variant: 'barricade' },
    { name: 'Old Trade Road', class: 'primary', type: T.ROAD_LG, y: 28, thick: 2, x0: 0, x1: 23, variant: null, bandit: true },
  ];
  const SHOWCASE = {
    name: 'STREETS', label: 'STREET VARIANTS', w: 24, h: 40, fill: T.GRASS,
    routes: SHOWCASE_ROUTES,
    subLabels: SHOWCASE_ROUTES.map((r) => ({
      label: r.variant ? r.variant.toUpperCase() : (r.bandit ? 'OLD TRADE ROAD' : r.name.toUpperCase()),
      dx: 12, dy: r.y,
    })),
    paint(p) {
      for (const r of SHOWCASE_ROUTES) {
        p.rect(r.x0, r.y, r.x1 - r.x0 + 1, r.thick, r.type);
        p.roadLabel(12, r.y, r.name);
      }
    },
    populate(s) {
      // Pick a stable id that passes the wagon-look hash, while keeping the
      // object next to the authored old trade road.
      s.chest('bus', 'Sandbox Wagon Stop', 2, 27, { wagonCandidate: true });
      s.chest('cafe', 'Sandbox Café', 16, 8, { cafeAnchor: true });
    },
  };

  const ZONES = {
    name: 'ZONES', label: 'INFLUENCE ZONES', w: 11, h: 40, fill: T.RESIDENTIAL,
    zoneStrips: [
      { kind: 'grove', variant: 'ancient_grove', y: 0, h: 7, terrain: T.GROVE },
      { kind: 'stones', variant: 'ordered_graves', y: 7, h: 7, terrain: T.CHURCHYARD },
      { kind: 'tar', variant: 'black_ring', y: 14, h: 7, terrain: T.TAR_YARD },
      { kind: 'grove', variant: 'meadow', y: 21, h: 9, terrain: T.GROVE, owned: true },
      { kind: 'quarry', variant: 'quarry-crater', y: 30, h: 10, terrain: T.ROCK, owned: true },
    ],
    subLabels: [
      { label: 'SACRED GROVE', dx: 5, dy: 3 },
      { label: 'OLD STONES', dx: 5, dy: 10 },
      { label: 'TAR YARD', dx: 5, dy: 17 },
      { label: 'MEADOW', dx: 5, dy: 25 },
      { label: 'CRATER', dx: 5, dy: 35 },
    ],
    paint(p) {
      for (const z of this.zoneStrips) p.rect(0, z.y, this.w, z.h, z.terrain);
      p.rect(3, 8, 4, 3, T.BUILDING_LARGE);
    },
    populate(s) {
      s.object('grove_shrine', 5, 3, { name: 'Sandbox Grove Shrine' });
      // The ten shrine kinds (src/shrines.js), down the east edge.
      Shrines.KIND_IDS.forEach((k, i) => s.object('grove_shrine', 10, 2 * i, { shrineKind: k }));
      s.object('infoboard', 1, 9, { name: 'Sandbox History Board' });
      s.house(5, 10, 0, T.BUILDING_LARGE, { _sandboxTemple: true });
      s.creature('copper_plant', 8, 1, 1);
      s.creature('goblin', 1, 5, 1); s.creature('goblin_archer', 9, 5, 1);
      s.creature('zombie', 5, 9, 1); s.creature('skeleton', 2, 12, 1); s.creature('ghost', 8, 12, 1);
      s.creature('fire_slime', 2, 18, 1);
    },
  };

  // Beside the farm: ordinary targets and fuel exercise the shipping combat,
  // potion-recipient and spreading-fire paths without distant world rolls.
  const PRACTICE = {
    name: 'PRACTICE', label: 'SPELLS · POTIONS · FIRE', w: 14, h: 14, fill: T.GRASS,
    // Keep combat clear of the major-road buffers above and below the yard.
    spawn: { dx: 6, dy: 7 },
    ambientFlora: false,
    subLabels: [{ label: 'POTION TARGETS', dx: 3, dy: 4 },
      { label: 'FIRE PRACTICE', dx: 10, dy: 4 }],
    populate(s) {
      s.creature('plant', 2, 6, 1);
      s.creature('plant', 4, 6, 2);
      s.creature('plant', 6, 6, 3);
      s.creature('goblin', 3, 9, 1);
      s.creature('goblin_archer', 6, 9, 1);
      s.creature('chicken', 1, 9, 1);
      // Trees survive as charred trunks; shrubs and tar are consumed.
      s.tree(4, 10, 6);
      s.wildplant('shrub', 11, 6);
      s.object('tar', 12, 6);
      s.wildplant('longgrass', 10, 7);
      s.tree(4, 10, 9);
      s.wildplant('shrub', 11, 9);
      s.object('tar', 12, 9);
    },
  };

  // Standing ranks, untouched wrecks and recent foes remain repeatable on reload.
  const RESTORATION = {
    name: 'RESTORATION', label: 'RESTORATION · ENCOUNTERS', w: 16, h: 40, fill: T.GRASS,
    ambientFlora: false, spawn: { dx: 4, dy: 13 },
    subLabels: [{ label: 'RANKED SHOPS', dx: 7, dy: 3 },
      { label: 'RESTORE A WRECK', dx: 7, dy: 13 }, { label: 'RECENT ENEMIES', dx: 7, dy: 25 }],
    populate(s) {
      const picks = ['blacksmith:1', 'blacksmith:2', 'blacksmith:3', 'trader:2',
        'market:seed:2', 'market:supply:2', 'petshop', 'bookshop', 'turret'];
      picks.forEach((key, i) => s.house(2 + (i % 4) * 3, 2 + Math.floor(i / 4) * 5,
        0, 9, { _sandboxBuild: key }));
      s.house(3, 14, 0, 9, { _sandboxWreck: true });
      s.house(10, 14, 0, 9, { _sandboxWreck: true });
      ['lodging', 'place_of_worship', 'school', 'sports_centre', 'town_hall', 'museum', 'shop', 'library', 'pharmacy']
        .forEach((poiClass, i) => s.chest(poiClass, `Sandbox ${poiClass}`, 15, 2 + i * 4));
      s.chest('bus', 'Sandbox Mimic Chest', 2, 18, { _sandboxProbe: 'mimic' });
      s.chest('bus', 'Sandbox Repeatable Crate', 5, 18, { tierSeed: 1, _sandboxProbe: 'daily-crate' });
      s.chest('bus', 'Sandbox Barrel', 8, 18, { barrel: true });
      s.chest('bus', 'Sandbox Clay Pot', 11, 18, { barrel: true, barrelStyle: 'clay_pot' });
      ['mushroom_monster', 'treant', 'fire_elemental', 'mimic', 'wurm', 'zombie'].forEach((kind, i) =>
        s.creature(kind, 3 + (i % 2) * 8, 22 + Math.floor(i / 2) * 7, 1,
          kind === 'zombie' ? { emergeFromGround: true, _burrowed: true }
            : kind === 'wurm' ? { burrowSeats: [[2, 35], [4, 35], [2, 37], [4, 37]] } : {}));
    },
  };

  const QUARRY = {
    name: 'QUARRY', label: 'QUARRY FINDS · RUINS', w: 16, h: 28, fill: T.ROCK,
    zoneStrips: [
      { kind: 'quarry', variant: 'quarry-strip-mine', y: 0, h: 14, terrain: T.ROCK, owned: true },
      { kind: 'quarry', variant: 'quarry-stronghold', y: 14, h: 14, terrain: T.ROCK, owned: true },
    ],
    subLabels: [{ label: 'STRIP MINE', dx: 8, dy: 7 }, { label: 'RUIN WALLS', dx: 8, dy: 21 }],
    populate(s) {},
  };

  // Bands run north to south. Each connective road owns both its painted
  // cells and its vector/variant row through the same record.
  const BANDS = [
    { roadAfter: { type: T.ROAD, class: 'minor', name: 'Oak Road', thick: 1, variant: 'hedgerow' }, scenes: [FOREST, ORCHARD, ROCK] },
    { roadAfter: { type: T.ROAD_LG, class: 'primary', name: 'Main Street', thick: 2, variant: 'lantern' }, scenes: [BARNYARD, PADDOCK, BEACH, MARSH] },
    { roadAfter: { type: T.ROAD_MD, class: 'tertiary', name: 'Mill Lane', thick: 1, variant: 'burned' }, scenes: [PLAZA, FARMLAND, PRACTICE] },
    { roadAfter: { type: T.ROAD, class: 'minor', name: 'Garden Row', thick: 1, variant: 'toadstool' }, scenes: [RESIDENTIAL, CIVIC, SMALLHOUSE] },
    { roadAfter: null, scenes: [RECREATION, CASTLE] },
    { roadAfter: null, scenes: [SHOWCASE, ZONES, RESTORATION, QUARRY] },
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

  function buildRoutes() {
    const routes = LAYOUT.roads.map((r) => ({ ...r, x0: 0, x1: LAYOUT.width - 1 }));
    for (const s of LAYOUT.scenes) for (const r of (s.routes || [])) {
      routes.push({ ...r, x0: s.lx + r.x0, x1: s.lx + r.x1, y: s.ly + r.y });
    }
    return routes;
  }
  const ROUTES = buildRoutes();

  function resolveDestination(key) {
    const destination = SandboxDestinations.find(key);
    if (destination?.road || destination?.roadName) {
      const route = ROUTES.find(r => destination.road ? r.variant === destination.road : r.name === destination.roadName);
      if (route) return { lx: Math.floor((route.x0 + route.x1) / 2), ly: route.y };
    }
    const scene = sceneByName(destination?.scene || String(key || '').trim().toUpperCase()) || sceneByName('PLAZA');
    const point = destination?.sub ? scene.subLabels?.find(s => s.label === destination.sub) : scene.spawn;
    return { lx: scene.lx + (point?.dx ?? Math.floor(scene.w / 2)),
      ly: scene.ly + (point?.dy ?? Math.floor(scene.h / 2)) };
  }

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
  // added by scene_creatures.js spawnInTile — we set it here so spawnInTile is skipped).
  function makeTileEntry({ tx, ty, cellsPerEdge, tileEdgeM, cellM, populate, finalize }) {
    const grid = new Uint8Array(cellsPerEdge * cellsPerEdge);   // default 0 = grass
    const objects = [];
    const wildplants = [];
    const creatures = [];
    const roadLabels = {};
    const owners = new Uint16Array(cellsPerEdge * cellsPerEdge);
    const ownerKeys = [null];
    const buildingShapes = [];

    // Cell index → world metres at cell centre.
    const wmAt = (ix, iy) => ({
      x: tx * tileEdgeM + (ix + 0.5) * cellM,
      y: ty * tileEdgeM + (iy + 0.5) * cellM,
    });

    const context = { grid, objects, wildplants, creatures, roadLabels, owners, ownerKeys, buildingShapes,
      cellsPerEdge, wmAt, tx, ty, cellM, tileEdgeM };
    populate(context);

    const entry = {
      status: 'ready',
      tx, ty, depth: 0,
      grid,
      objects,
      wildplants,
      creatures,
      owners,
      ownerKeys,
      poiPadCells: new Set(),
      parkingTreasures: [],
      roadLabels,
      pathUnder: {},
      buildingShapes,
      treasure: null,
      extraTreasures: [],
      coinDrops: [],
      traps: [],
      streetLairs: [],
      slowCells: null,
      streetMarks: null,
      layers: [],
      streetIndex: null,
      streetDress: null,
      streetArea: null,
      zone: null,
      zoneDress: null,
      scenic: null,
      scenicDress: null,
      tileEdgeM,
      cellsPerEdge,
      _spawned: true,
      // Mark as already-decorated so warmOverpass's evict-and-rebuild (which
      // refreshes real tiles whose Overpass bin landed late) never evicts a
      // synthetic sandbox tile in favour of real-world geometry.
      hadBin: true,
      // Satisfies the shape; never awaited since status is ready.
      promise: Promise.resolve(null),
    };
    // The live renderer draws source polygons, not building terrain cells.
    // Give authored footprints the same ownership as their house/turrets so
    // floors, walls and objects agree before and after claiming a building.
    for (const shape of buildingShapes) {
      const [x0, y0, x1, , , y1] = shape.ring;
      const inside = (o) => o.x - tx * tileEdgeM >= x0 && o.x - tx * tileEdgeM < x1
        && o.y - ty * tileEdgeM >= y0 && o.y - ty * tileEdgeM < y1;
      const house = objects.find((o) => o.kind === 'house' && o.tier === shape.tier && inside(o));
      if (house) shape.key = house.id;
      const owner = entry.ownerKeys.length || 1;
      entry.ownerKeys[owner] = shape.key;
      for (let iy = Math.round(y0 / cellM); iy < Math.round(y1 / cellM); iy++) {
        for (let ix = Math.round(x0 / cellM); ix < Math.round(x1 / cellM); ix++) {
          entry.owners[iy * cellsPerEdge + ix] = owner;
        }
      }
      let first = true;
      for (const tower of objects.filter((o) => o.kind === 'tower' && inside(o))) {
        tower.castle = shape.key;
        tower.flagPost = first;
        first = false;
      }
    }
    if (finalize) finalize(entry, context);
    entry.baseGrid = entry.grid.slice();
    entry.genObjects = entry.objects.slice();
    return entry;
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
      creature(kind, dx, dy, n, extra = {}) {
        const { x, y } = at(dx, dy);
        const options = { ...extra };
        if (options.burrowSeats) {
          options.burrowCells = options.burrowSeats.map(([bx, by]) => at(bx, by));
          delete options.burrowSeats;
        }
        creatures.push(WorldGen.makeCreature(kind, x, y, `${baseId}_${tag}_${kind}_${n}`, options));
      },
      wildplant(crop, dx, dy, extra = {}) {
        const { x, y } = at(dx, dy);
        const plant = WorldGen.makeWildplant(crop, x, y,
          `${baseId}_wp_${tag}_${crop}_${dx}_${dy}`, { _ix: ix0 + dx, _iy: iy0 + dy, ...extra });
        if (extra._sandboxProbe === 'nest') {
          const id = plant.id;
          for (let n = 0; !isNestBush(crop, plant.id); n++) plant.id = `${id}_nest_${n}`;
        }
        wildplants.push(plant);
      },
      tree(variant, dx, dy, species) {
        const { x, y } = at(dx, dy);
        const o = WorldGen.makeObject('tree', x, y,
          `${baseId}_tree_${tag}_${species || variant}_${dx}_${dy}`, { variant });
        if (species) o.species = species;   // non-maple species use own sheet
        objects.push(o);
      },
      fruitTree(species, dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push(WorldGen.makeObject('fruittree', x, y,
          `${baseId}_ft_${tag}_${species}_${dx}_${dy}`, { species }));
      },
      chest(poiClass, name, dx, dy, extra) {
        const { x, y } = at(dx, dy);
        const chest = WorldGen.makeObject('chest', x, y,
          `${baseId}_chest_${tag}_${dx}_${dy}`, { poiClass, name, ...(extra || {}) });
        if (extra?._sandboxProbe === 'mimic') {
          const id = chest.id;
          for (let n = 0; !chestHidesMimic(chest); n++) chest.id = `${id}_mimic_${n}`;
        }
        objects.push(chest);
      },
      object(kind, dx, dy, extra) {
        const { x, y } = at(dx, dy);
        objects.push(WorldGen.makeObject(kind, x, y,
          `${baseId}_${kind}_${tag}_${dx}_${dy}`, extra || {}));
      },
      // Starter chest — a real kind:'chest' carrying a fixed payload (no
      // poiClass), so it opens through the standard chest path reading
      // o.fixedLoot, exactly like the spawn-trail starter chests in app.js.
      startChest(name, dx, dy, loot) {
        const { x, y } = at(dx, dy);
        objects.push(WorldGen.makeObject('chest', x, y,
          `${baseId}_startchest_${tag}_${dx}_${dy}`, { name, fixedLoot: loot }));
      },
      house(dx, dy, address = 0, tier = 9, extra = {}) {
        const { x, y } = at(dx, dy);
        objects.push(WorldGen.makeObject('house', x, y,
          `${baseId}_house_${tag}_${dx}_${dy}`, { tier, address, ...extra }));
      },
      wood(dx, dy, qty = 2) {
        const { x, y } = at(dx, dy);
        objects.push(WorldGen.makeObject('groundstack', x, y,
          `${baseId}_wood_${tag}_${dx}_${dy}`, { itemId: 'wood', qty }));
      },
      tower(dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push(WorldGen.makeObject('tower', x, y, `${baseId}_tower_${tag}_${dx}_${dy}`,
          { castle: `${baseId}_castle_${tag}`, flagPost: dx === 0 && dy === 0 }));
      },
      well(dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push(WorldGen.makeObject('well', x, y, `${baseId}_well_${tag}_${dx}_${dy}`));
      },
      wizardHouse(dx, dy) {
        const { x, y } = at(dx, dy);
        const id = `${baseId}_wizardhouse_${tag}_${dx}_${dy}`;
        objects.push(WorldGen.makeObject('house', x, y, id,
          { tier: WorldGen.T.BUILDING, address: 0, _wizardRole: true }));
      },
      // Ore rock at a given yield tier. yieldTier drives BOTH the dropped bar
      // and the ore-stone sprite (copper T2 … frost T7; T1 is plain rock that
      // yields a little copper). requiredTier = max(1, yieldTier-1) mirrors
      // worldgen's pick gate, so the gating ladder is exercised end-to-end.
      mineralRock(yieldTier, dx, dy) {
        const { x, y } = at(dx, dy);
        const requiredTier = Math.max(1, yieldTier - 1);
        objects.push(WorldGen.makeObject('mineralrock', x, y,
          `${baseId}_mr_${tag}_t${yieldTier}_${dx}_${dy}`, { yieldTier, requiredTier }));
      },
      // Plain CAVE rock (caveVariant 0..3) — any pick breaks it, drops
      // rockfruit + a tier-scaled lucky bar. Renders the vanilla rock sprite,
      // visually distinct from the gem-on-pebble ore rocks.
      caveRock(variant, dx, dy) {
        const { x, y } = at(dx, dy);
        objects.push(WorldGen.makeObject('mineralrock', x, y,
          `${baseId}_cr_${tag}_${variant}_${dx}_${dy}`, { requiredTier: 1, caveVariant: variant }));
      },
    };
  }

  // Lay every scene + connective road into the centre tile's grid, and push
  // every scene's static interactables. Called once per sandbox install (via
  // makeTileEntry's populate hook for the centre tile only).
  // Run the REAL per-biome flora distribution (BIOME_PROFILES) over every scene
  // so the sandbox shows each biome's actual interactable spread — density,
  // dominant flora, the commercial hedge maze — instead of only the few
  // hand-placed sample sprites. This is what makes "empty" zones like the pitch
  // or golf course actually populate, and lets a tester eyeball the tuning.
  // Mirrors worldgen: one stable density per (scene, crop) then a per-cell roll;
  // hedgemaze uses the same lattice rule. Skips cells already taken by a placed
  // object or sample wildplant, and reads each cell's ACTUAL terrain so painted
  // sub-zones (golf within marsh, the road through residential…) are respected.
  function scatterSandboxFlora(originIX, originIY, c) {
    if (typeof BiomeProfiles === 'undefined' || typeof WorldGen === 'undefined') return;
    const { grid, objects, wildplants, cellsPerEdge, wmAt, tx, ty, cellM, tileEdgeM } = c;
    const occupied = new Set();
    let grassCandidates = null;
    const key = (ix, iy) => `${ix}_${iy}`;
    for (const o of objects) {
      const ix = Math.round((o.x - tx * tileEdgeM) / cellM - 0.5);
      const iy = Math.round((o.y - ty * tileEdgeM) / cellM - 0.5);
      occupied.add(key(ix, iy));
    }
    for (const wp of wildplants) {
      if (wp._ix != null) occupied.add(key(wp._ix, wp._iy));
      else {
        const ix = Math.floor((wp.x - tx * tileEdgeM) / cellM);
        const iy = Math.floor((wp.y - ty * tileEdgeM) / cellM);
        occupied.add(key(ix, iy));
      }
    }
    // Zone and street patterns own their empty cells too, because a deliberate
    // gap must not fill with ordinary biome scatter on the next pass.
    const zoneCoverage = c.zone && (c.zone.coverage || c.zone.idx);
    const streetArea = c.streetArea;
    if (zoneCoverage || streetArea) for (let i = 0; i < cellsPerEdge * cellsPerEdge; i++) {
      if (zoneCoverage?.[i] || streetArea?.[i]) occupied.add(key(i % cellsPerEdge, Math.floor(i / cellsPerEdge)));
    }
    const place = (ix, iy, crop, t, clayPot = false) => {
      const kk = key(ix, iy);
      if (occupied.has(kk)) return false;
      occupied.add(kk);
      const { x, y } = wmAt(ix, iy);
      if (clayPot) objects.push(WorldGen.makeObject('chest', x, y,
        WorldGen.cellId('hmpot', tx, ty, ix, iy), { barrel: true, barrelStyle: 'clay_pot', _biome: t }));
      else wildplants.push(WorldGen.makeWildplant(crop, x, y, `sbflora_${tx}_${ty}_${crop}_${ix}_${iy}`,
        { _biome: t, _ix: ix, _iy: iy }));
      return true;
    };
    for (const s of LAYOUT.scenes) {
      if (s.ambientFlora === false) continue;
      const byT = new Map();
      for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) {
        const ix = originIX + s.lx + dx, iy = originIY + s.ly + dy;
        if (ix < 0 || iy < 0 || ix >= cellsPerEdge || iy >= cellsPerEdge) continue;
        const t = grid[iy * cellsPerEdge + ix];
        let arr = byT.get(t); if (!arr) { arr = []; byT.set(t, arr); }
        arr.push([ix, iy]);
      }
      for (const [t, cells] of byT) {
        for (const fl of BiomeProfiles.flora(t)) {
          const salt = fl.salt >>> 0;
          if (fl.pattern === 'grassfill') {
            if (!grassCandidates) {
              const steps = WorldGen.grassFillSteps(tx, ty, cellsPerEdge);
              let step = steps.next();
              while (!step.done) step = steps.next();
              grassCandidates = step.value;
            }
            for (const [ix, iy] of cells) {
              if (grassCandidates[iy * cellsPerEdge + ix]) place(ix, iy, fl.crop, t);
            }
          } else if (fl.pattern === 'hedgemaze') {
            // WorldGen.hedgeMazeCell owns the lattice; the sandbox passes
            // ABSOLUTE cells like worldgen does, so the commercial maze here
            // matches the real plaza's rule 1:1.
            for (const [ix, iy] of cells) {
              const ax = tx * cellsPerEdge + ix, ay = ty * cellsPerEdge + iy;
              if (WorldGen.hedgeMazeCell(ax, ay, salt))
                place(ix, iy, fl.crop, t, WorldGen.hedgeMazePotCell(ax, ay));
            }
          } else {
            // fnv1a: the shared FNV-1a hash (util.js).
            const rng = WorldGen.makeRng(fnv1a(`${s.name}|${fl.crop}|${salt}`));
            // Bias dynamic densities to the upper half of their range so no test
            // zone comes out empty by an unlucky roll (worldgen uses the full
            // [0, dMax]; here we want every biome's flora visibly represented).
            const density = fl.dynamic ? (0.5 + 0.5 * rng()) * fl.dMax
                                       : (fl.dMin + rng() * (fl.dMax - fl.dMin));
            let placed = 0;
            for (const [ix, iy] of cells) if (rng() < density && place(ix, iy, fl.crop, t)) placed++;
            // Guarantee at least one sample per (zone, crop) so a low-density
            // biome never reads as empty in the test sandbox.
            if (placed === 0) for (const [ix, iy] of cells) if (place(ix, iy, fl.crop, t)) break;
          }
        }
      }
    }
  }

  function populateSandbox(originIX, originIY, c) {
    const { grid, objects, wildplants, creatures, roadLabels,
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
        if (![T.BUILDING, T.BUILDING_MED, T.BUILDING_LARGE].includes(terrain)) return;
        const x0 = Math.max(0, ix0 + dx) * c.cellM, y0 = Math.max(0, iy0 + dy) * c.cellM;
        const x1 = Math.min(cellsPerEdge, ix0 + dx + w) * c.cellM;
        const y1 = Math.min(cellsPerEdge, iy0 + dy + h) * c.cellM;
        if (x1 <= x0 || y1 <= y0) return;
        c.buildingShapes.push({ ring: Float32Array.from([x0, y0, x1, y0, x1, y1, x0, y1]),
          tier: terrain, areaM2: (x1 - x0) * (y1 - y0),
          key: `${baseId}_building_${s.name}_${dx}_${dy}` });
      };
      rect(0, 0, s.w, s.h, s.fill);
      if (s.paint) {
        s.paint({
          cell: setCell,
          rect,
          roadLabel: (dx, dy, text) => { roadLabels[`${ix0 + dx}_${iy0 + dy}`] = { text, angle: 0 }; },
        });
      }
      s.populate(makeScenePush(ix0, iy0, s.name, baseId, { objects, wildplants, creatures }, wmAt));
    }

    // Connective roads span the full layout width below their band.
    for (const r of LAYOUT.roads) {
      const period = 12;   // one whole-word label per ~12 cells, like worldgen
      for (let t = 0; t < r.thick; t++) {
        const iy = originIY + r.y + t;
        if (iy < 0 || iy >= cellsPerEdge) continue;
        for (let dx = 0; dx < LAYOUT.width; dx++) {
          const ix = originIX + dx;
          if (ix < 0 || ix >= cellsPerEdge) continue;
          grid[iy * cellsPerEdge + ix] = r.type;
          if (t === 0 && dx % period === 2) {
            roadLabels[`${ix}_${iy}`] = { text: r.name, angle: 0 };
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Real-map systems on the synthetic tile
  // ─────────────────────────────────────────────────────────────────────────
  const SANDBOX_EXTENT = 4096;
  const driveSteps = (it) => { let r = it.next(); while (!r.done) r = it.next(); return r.value; };

  function itemCell(p, c) {
    const ix = Math.floor((p.x - c.tx * c.tileEdgeM) / c.cellM);
    const iy = Math.floor((p.y - c.ty * c.tileEdgeM) / c.cellM);
    return { ix, iy, i: iy * c.cellsPerEdge + ix };
  }

  function occupiedCells(c) {
    const out = new Set();
    for (const p of [...c.objects, ...c.wildplants]) {
      const at = itemCell(p, c);
      if (at.ix >= 0 && at.iy >= 0 && at.ix < c.cellsPerEdge && at.iy < c.cellsPerEdge) out.add(at.i);
    }
    return out;
  }

  function routeLine(route, originIX, originIY, N) {
    const u = (cell) => Math.round(cell * SANDBOX_EXTENT / N);
    const y = originIY + route.y + (route.thick || 1) / 2;
    return [{ x: u(originIX + route.x0 + 0.5), y: u(y) },
      { x: u(originIX + route.x1 + 0.5), y: u(y) }];
  }

  function buildTransport(originIX, originIY, c) {
    const features = ROUTES.map((route, i) => ({
      id: fnv1a(`sandbox-road|${route.name}|${i}`), type: 2,
      geom: [routeLine(route, originIX, originIY, c.cellsPerEdge)],
      tags: { class: route.class, name: route.name },
    }));
    const names = features.map((f) => ({ id: f.id, type: 2, geom: f.geom,
      tags: { name: f.tags.name } }));
    return { routes: ROUTES, features,
      layers: [
        { name: 'transportation', extent: SANDBOX_EXTENT, features },
        { name: 'transportation_name', extent: SANDBOX_EXTENT, features: names },
        { name: 'poi', extent: SANDBOX_EXTENT, features: [] },
      ] };
  }

  function buildRoadFields(entry, originIX, originIY, c) {
    const N = c.cellsPerEdge;
    const roadBand = new Uint8Array(N * N);
    const roadClass = new Uint8Array(N * N);
    const spawnWhy = new Uint16Array(N * N);
    const quietMask = new Uint8Array(N * N);
    for (let i = 0; i < entry.grid.length; i++) {
      const t = entry.grid[i];
      // roadMask covers the drawn ROAD bands only — footpaths feed pathSpan
      // in the real pipeline, and marking them as road ground would refuse
      // every path-side spawn (traps keep TRAP_ROAD_CLEAR_CELLS off the band).
      if (t === T.ROAD || t === T.ROAD_MD || t === T.ROAD_LG) {
        roadBand[i] = 1;
        spawnWhy[i] |= WorldGen.SPAWN_WHY.ROAD;
      }
    }
    for (const r of ROUTES) {
      if (r.type !== T.ROAD_MD && r.type !== T.ROAD_LG) continue;
      const x0 = originIX + r.x0, x1 = originIX + r.x1;
      const y0 = originIY + r.y, y1 = y0 + r.thick - 1;
      for (let y = Math.max(0, y0 - Math.ceil(WorldGen.MAJOR_BUFFER_CELLS) - 1);
           y <= Math.min(N - 1, y1 + Math.ceil(WorldGen.MAJOR_BUFFER_CELLS) + 1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(N - 1, x1); x++) {
          const i = y * N + x;
          if (y >= y0 && y <= y1) roadClass[i] |= WorldGen.ROAD_CLASS_MAJOR_BAND;
          else if (y === y0 - 1 || y === y1 + 1) roadClass[i] |= WorldGen.ROAD_CLASS_MAJOR_VERGE;
          roadClass[i] |= WorldGen.ROAD_CLASS_MAJOR_BUFFER;
          spawnWhy[i] |= WorldGen.SPAWN_WHY.KERB;
        }
      }
    }
    Object.assign(entry, { roadMask: roadBand, roadClass, spawnWhy, quietMask });
    return { roadMask: roadBand, roadClass, spawnWhy, quiet: quietMask };
  }

  function buildScenic(entry, originIX, originIY, c, transport, spawnOpts) {
    const N = c.cellsPerEdge, lines = new Map();
    for (let fi = 0; fi < transport.routes.length; fi++) {
      const route = transport.routes[fi];
      if (!route.scenic) continue;
      const f = transport.features[fi], line = f.geom[0];
      const length = Math.hypot(line[1].x - line[0].x, line[1].y - line[0].y);
      lines.set(Streets.lineKey(f, 0), [[0, length, route.scenic]]);
    }
    const beach = sceneByName('BEACH');
    const mask = new Uint8Array(N * N), cells = [], waterline = [];
    for (let dy = 0; dy < beach.h; dy++) for (const dx of [2, 3]) {
      if (dy === 4 && dx === 3) continue;
      const ix = originIX + beach.lx + dx, iy = originIY + beach.ly + dy, i = iy * N + ix;
      mask[i] = dx === 3 ? 2 : 1; cells.push(i); if (dx === 3) waterline.push(i);
    }
    const rec = sceneByName('RECREATION'), vistaIX = originIX + rec.lx + 2, vistaIY = originIY + rec.ly + 7;
    const lx = Math.round((vistaIX + 0.5) * SANDBOX_EXTENT / N);
    const ly = Math.round((vistaIY + 0.5) * SANDBOX_EXTENT / N);
    const scenic = { ext: SANDBOX_EXTENT, lines,
      census: { shore: waterline.length * WorldGen.CELL_M, greenway: 0, park: 9 * WorldGen.CELL_M },
      stretches: [], grassSeats: [], shore: { mask, cells, waterline, shoreM: waterline.length * WorldGen.CELL_M },
      vistas: [{ gx: c.tx * SANDBOX_EXTENT + lx, gy: c.ty * SANDBOX_EXTENT + ly,
        lx, ly, owned: true, id: `vista_${c.tx * SANDBOX_EXTENT + lx}_${c.ty * SANDBOX_EXTENT + ly}` }],
    };
    const dressing = Scenic.dress({ scenic, tx: c.tx, ty: c.ty, N, tileEdgeM: c.tileEdgeM,
      grid: entry.grid, chests: entry.objects, spawnOpts });
    entry.scenic = scenic; entry.scenicDress = dressing;
    entry.objects.push(...dressing.objects);
    entry.wildplants.push(...dressing.wildplants);
  }

  function buildZones(entry, originIX, originIY, c, spawnOpts) {
    const N = c.cellsPerEdge, idx = new Uint8Array(N * N), strength = new Uint8Array(N * N);
    const under = new Uint8Array(N * N), anchors = [];
    const upm = N * WorldGen.CELL_M / SANDBOX_EXTENT;
    for (const zoneScene of LAYOUT.scenes.filter(s => s.zoneStrips)) zoneScene.zoneStrips.forEach(z => {
      const ai = anchors.length;
      const ix = originIX + zoneScene.lx + Math.floor(zoneScene.w / 2);
      const iy = originIY + zoneScene.ly + z.y + Math.floor(z.h / 2);
      const lx = Math.round((ix + 0.5) * SANDBOX_EXTENT / N);
      const ly = Math.round((iy + 0.5) * SANDBOX_EXTENT / N);
      anchors.push({ kind: z.kind, variant: z.variant, gx: c.tx * SANDBOX_EXTENT + lx,
        gy: c.ty * SANDBOX_EXTENT + ly, lx, ly, key: `sandbox-zone-${z.variant}`,
        owned: !!z.owned, generated: false, upm, R: Math.max(zoneScene.w, z.h) * WorldGen.CELL_M,
        code: Zones.ZONE_KINDS[z.kind].code, rotation: 0 });
      for (let dy = 0; dy < z.h; dy++) for (let dx = 0; dx < zoneScene.w; dx++) {
        const x = originIX + zoneScene.lx + dx, y = originIY + zoneScene.ly + z.y + dy, i = y * N + x;
        idx[i] = ai + 1; strength[i] = 255; under[i] = z.kind === 'tar' ? T.WASTELAND : T.RESIDENTIAL;
      }
    });
    const field = { anchors, idx, coverage: idx, s: strength, reach: anchors, allAnchors: anchors, under };
    entry.zone = field;
    for (const temple of entry.objects.filter(o => o._sandboxTemple)) {
      const anchor = anchors.find(a => a.kind === 'stones');
      Object.assign(temple, { kind: 'temple', templeKind: anchor.kind,
        templeZone: anchor.key, templeAnchor: { ...anchor }, name: 'Awakened Old Stones Temple' });
      Object.assign(entry.buildingShapes.find(s => s.key === temple.id), {
        kind: 'temple', templeZone: anchor.key, templeKind: anchor.kind });
    }
    const dressing = ZoneDressing.dress({ field, tx: c.tx, ty: c.ty, N, tileEdgeM: c.tileEdgeM,
      grid: entry.grid, chests: entry.objects, spawnOpts });
    entry.zoneDress = dressing;
    entry.extraTreasures.push(...(dressing.treasures || []));
    entry.objects.push(...dressing.objects);
    entry.wildplants.push(...dressing.wildplants);
    entry.traps.push(...(dressing.traps || []));
    entry.streetLairs.push(...(dressing.lairs || []));
    const slow = entry.slowCells || new Map();
    for (const [i, kind] of (dressing.slowCells || [])) slow.set(i, kind);
    entry.slowCells = slow.size ? slow : null;
    for (const guard of (dressing.guards || [])) {
      entry.creatures.push(WorldGen.makeCreature(guard.kind, guard.x, guard.y, guard.id, {
        ...guard, shiny: false, immobile: !guard.burrowCells, lair: guard.burrowCells ? null : (guard.lair || guard.id),
        lairX: guard.homeX ?? guard.x, lairY: guard.homeY ?? guard.y,
        lairR: 0, seatX: guard.x, seatY: guard.y,
      }));
    }
  }

  function buildStreetIndex(entry, originIX, originIY, c, transport) {
    const lines = [];
    for (let fi = 0; fi < transport.routes.length; fi++) {
      const route = transport.routes[fi];
      if (route.type !== T.ROAD && route.type !== T.ROAD_MD && route.type !== T.ROAD_LG) continue;
      const f = transport.features[fi], line = f.geom[0];
      let key = StreetVariants.streetKey(route.name, c.tx, c.ty);
      if (route.bandit) {
        const p = line[Math.floor(line.length / 2)], st = StreetVariants.stretchOf(c.tx * SANDBOX_EXTENT + p.x, c.ty * SANDBOX_EXTENT + p.y);
        let n = 0;
        do { key = `sandbox-old-trade-${n++}`; } while (!StreetVariants.isBanditStretch(key, st.sx, st.sy));
      }
      lines.push({ fi, li: 0, line, tags: f.tags, name: route.name, key,
        variant: route.variant, selectedVariant: route.variant,
        size: (route.type === T.ROAD_MD || route.type === T.ROAD_LG) ? 'major' : 'minor',
        halfW: WorldGen.roadOverlayWidthM(f.tags) / 2,
        lineKey: Streets.lineKey(f, 0), variantRanges: null });
    }
    const cafe = entry.objects.find((o) => o.cafeAnchor), at = cafe && itemCell(cafe, c);
    const hoardPois = at ? [{ x: Math.round((at.ix + 0.5) * SANDBOX_EXTENT / c.cellsPerEdge),
      y: Math.round((at.iy + 0.5) * SANDBOX_EXTENT / c.cellsPerEdge),
      gk: `${c.tx * SANDBOX_EXTENT + at.ix},${c.ty * SANDBOX_EXTENT + at.iy}` }] : [];
    return { extent: SANDBOX_EXTENT, lines, dressingLines: lines, hoardPois };
  }

  function layStreetDressing(entry, c, dressing) {
    entry.streetDress = dressing;
    entry.objects.push(...dressing.objects);
    entry.wildplants.push(...dressing.wildplants);
    entry.extraTreasures.push(...dressing.treasures);
    entry.coinDrops.push(...dressing.coins);
    entry.streetLairs.push(...dressing.lairs);
    // Snare-lane iron teeth: the real spawn pass lays dressing.traps into
    // entry.traps (scene_creatures.js); seat them here too, skipping cells
    // the earlier phases already claimed.
    const taken = occupiedCells(c);
    for (const trap of (dressing.traps || [])) {
      const at = itemCell(trap, c);
      if (!taken.has(at.i)) entry.traps.push(trap);
    }
    const slow = entry.slowCells || new Map();
    for (const [i, kind] of dressing.slowCells) slow.set(i, kind);
    entry.slowCells = slow.size ? slow : null;
    entry.streetMarks = dressing.marks;
  }

  function finalizeSandbox(originIX, originIY, entry, c) {
    const transport = buildTransport(originIX, originIY, c);
    entry.layers = transport.layers;
    entry._sandboxRoutes = ROUTES;
    const spawnOpts = buildRoadFields(entry, originIX, originIY, c);
    spawnOpts.occupied = occupiedCells(c);
    spawnOpts.pois = entry.objects.filter((o) => o.kind === 'chest' || o.kind === 'grove_shrine')
      .map((o) => itemCell(o, c));
    entry._spawnOpts = spawnOpts;

    // Landmarks and zones claim their space before road themes; ordinary flora
    // runs last and respects both full-area reservations.
    buildScenic(entry, originIX, originIY, c, transport, spawnOpts);
    spawnOpts.occupied = occupiedCells(c);
    buildZones(entry, originIX, originIY, c, spawnOpts);
    spawnOpts.occupied = occupiedCells(c);

    const index = buildStreetIndex(entry, originIX, originIY, c, transport);
    entry.streetIndex = index;
    driveSteps(StreetVariants.stampBanditStretchesSteps(index, entry.roadClass, c.cellsPerEdge, c.tx, c.ty));
    const dressing = StreetVariants.dress({ index, tx: c.tx, ty: c.ty, N: c.cellsPerEdge,
      tileEdgeM: c.tileEdgeM, grid: entry.grid, spawnOpts });
    // Zone layouts own their whole footprint, including empty pattern cells.
    // Use worldgen's clearing pass before laying road records, so the sandbox
    // demonstrates the same zone-over-street precedence as a fetched tile.
    driveSteps(WorldGen.clearZoneAmbientSteps({ field: entry.zone, objects: [], wildplants: [],
      occupied: spawnOpts.occupied, streetDress: dressing, scenicDress: null,
      tx: c.tx, ty: c.ty, N: c.cellsPerEdge, tileEdgeM: c.tileEdgeM }));
    layStreetDressing(entry, c, dressing);
    entry.streetArea = StreetVariants.area(index, c.cellsPerEdge);
    // Authored hazards need the same movement index as generated dressing.
    for (const o of entry.objects) if (StreetVariants.SLOW_KINDS.has(o.kind)) {
      const { ix, iy } = itemCell(o, c);
      (entry.slowCells ||= new Map()).set(iy * c.cellsPerEdge + ix, o.kind);
    }

    const wagon = entry.objects.find((o) => o.wagonCandidate);
    if (wagon) {
      const base = wagon.id; let n = 0;
      do { wagon.id = `${base}_${n++}`; } while (!StreetVariants.isWagonStop(wagon.id));
    }
    StreetVariants.markBanditStops(entry.objects, entry.roadClass, c.cellsPerEdge, c.tx, c.ty, c.tileEdgeM);

    spawnOpts.occupied = occupiedCells(c);
    // The shipping density cap (TRAP_GROUND_SHARE_PER_MUL × pool size) governs
    // the count: this much authored ground honestly yields ~1 trap, exactly as
    // a real tile of the same size would. No fallback seat — the coverage test
    // re-runs the placer and pins that it, not a hand row, furnished the traps.
    entry.traps.push(...Traps.spawnSurface(entry.grid, entry.roadClass, c.cellsPerEdge, c.cellsPerEdge,
      c.tx, c.ty, c.tileEdgeM, spawnOpts, 1, entry.zone && entry.zone.under));

    // A lair point is an attractor: the real spawn pass keeps a street lair
    // only where attractor ground lies within LAIR_POINT_SLACK_CELLS of its
    // point (scene_creatures.js). The same filter here means sandbox guards
    // never wake on ground the pipeline would refuse.
    if (entry.streetLairs.length) {
      const lairOpts = WorldGen.spawnOptsOf(entry);
      entry.streetLairs = entry.streetLairs.filter((L) => {
        const ix = Math.floor(L.lx / c.cellM), iy = Math.floor(L.ly / c.cellM);
        return !!WorldGen.relocateToSpawnCell(entry.grid, c.cellsPerEdge, c.cellsPerEdge,
          ix, iy, lairOpts, LAIR_POINT_SLACK_CELLS, 'attractor');
      });
    }

    c.zone = entry.zone; c.streetArea = entry.streetArea;
    scatterSandboxFlora(originIX, originIY, c);
  }

  function buildForTest(options) {
    const opts = options || {}, cellsPerEdge = opts.cellsPerEdge || Math.max(128, LAYOUT.height + 4, LAYOUT.width + 4);
    const tileEdgeM = opts.tileEdgeM || cellsPerEdge * WorldGen.CELL_M;
    const tx = opts.tx || 0, ty = opts.ty || 0, cellM = tileEdgeM / cellsPerEdge;
    const originIX = Math.floor((cellsPerEdge - LAYOUT.width) / 2);
    const originIY = Math.floor((cellsPerEdge - LAYOUT.height) / 2);
    const entry = makeTileEntry({ tx, ty, cellsPerEdge, tileEdgeM, cellM,
      populate: populateSandbox.bind(null, originIX, originIY),
      finalize: finalizeSandbox.bind(null, originIX, originIY) });
    return { entry, originIX, originIY, tx, ty, cellM };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Install
  // ─────────────────────────────────────────────────────────────────────────
  function install(scene) {
    // Flag the scene so other systems (GPS, etc.) know to behave differently.
    scene._sandboxMode = true;
    // Authored buildings use the tile painter; only the castle also carries
    // a source ring for shared floor decoration such as ruined columns.
    if (typeof BuildingOverlay !== 'undefined') BuildingOverlay.setEnabled(scene, false);
    // If a previous session had already started watching GPS, kill the watch so
    // an incoming fix doesn't race the teleport at the bottom of this function.
    if (scene.gpsWatchId != null && typeof Geo !== 'undefined') {
      Geo.unsubscribe(scene.gpsWatchId);
      scene.gpsWatchId = null;
    }
    scene.gpsAvailable = false;
    const tileEdgeM = scene.tileEdgeM;
    const startCell = scene.playerToWorldCell();
    const centreTX = startCell.tx;
    const centreTY = startCell.ty;
    // Every synthetic tile is built on ITS row's grid, exactly as a real one
    // is (coords.js rowCells — a tile's grid is its row's, never the save's
    // cellsPerTile), with that grid's own cell size in frame metres.
    const rowN = (ty) => rowCells(scene, ty);
    const rowM = (ty) => tileEdgeM / rowN(ty);
    const cellsPerEdge = rowN(centreTY);
    const cellM = rowM(centreTY);
    // Centre the whole scene map in the start tile so the player's start
    // (somewhere inside the tile) is close to it. We reposition to PLAZA below.
    const gridOriginIX = Math.floor((cellsPerEdge - LAYOUT.width) / 2);
    const gridOriginIY = Math.floor((cellsPerEdge - LAYOUT.height) / 2);

    // Build the centre tile (the sandbox) and 8 grass-only neighbours so the
    // viewport edge doesn't show "loading…" tiles.
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const tx = centreTX + dtx, ty = centreTY + dty;
        const key = WorldGen.tileKey(tx, ty);
        if (WorldGen.tileCache.has(key)) continue;
        const isCentre = (dtx === 0 && dty === 0);
        const entry = makeTileEntry({
          tx, ty, cellsPerEdge: rowN(ty), tileEdgeM, cellM: rowM(ty),
          populate: isCentre
            ? populateSandbox.bind(null, gridOriginIX, gridOriginIY)
            : () => { /* grass everywhere, no items */ },
          finalize: isCentre ? finalizeSandbox.bind(null, gridOriginIX, gridOriginIY) : null,
        });
        WorldGen.tileCache.set(key, entry);
      }
    }

    // A named scene link makes a focused browser check repeatable.
    const params = new URLSearchParams(location.search);
    const destination = resolveDestination(params.get('sandboxZone') || params.get('sandboxScene'));
    const playerCellIX = gridOriginIX + destination.lx;
    const playerCellIY = gridOriginIY + destination.ly;
    const targetWorldX = centreTX * tileEdgeM + (playerCellIX + 0.5) * cellM;
    const targetWorldY = centreTY * tileEdgeM + (playerCellIY + 0.5) * cellM;
    scene.playerM.x = targetWorldX - scene.startWorldM.x;
    scene.playerM.y = targetWorldY - scene.startWorldM.y;
    // Park the walk target on the teleported body — movement is target-follow
    // now (app.js _followStep), so a stale target would walk us straight back.
    if (scene.syncMoveTarget) scene.syncMoveTarget();
    // Pretend a GPS fix arrived so the UI doesn't sit in "no GPS" mode.
    scene.gpsM = { x: scene.playerM.x, y: scene.playerM.y };
    // Plant a treasure X one cell north of spawn (tap that cell — treasure is
    // cell-bounded like every non-fauna target) so the tester can verify
    // treasure-tap loot without hunting for one.
    const centreEntry = WorldGen.tileCache.get(WorldGen.tileKey(centreTX, centreTY));
    for (const temple of centreEntry?.objects || []) if (temple._sandboxTemple) {
      const record = (scene.save.temples ||= {})[temple.templeZone] ||= {};
      record.active = true;
    }
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
    // reachable. The PICKAXE is bumped to frost (T7) inside grantSandboxGear so
    // every ore deposit in the ROCK band is mineable for verification. Clobbered
    // on every load for a predictable baseline.
    grantSandboxGear(scene);

    // Seed runtime state that lives outside the tile entry — planted crops,
    // placed rocks, released pets, scarecrows, coin drops, extra treasures.
    seedSandboxState(scene, gridOriginIX, gridOriginIY, centreTX, centreTY,
                     cellsPerEdge, tileEdgeM, cellM);
  }

  // Equip one of every relic + armor piece at T3 (see note above), and top the
  // energy bar up so nothing is gated behind a half-empty tank.
  function grantSandboxGear(scene) {
    if (typeof RELIC_DEFS === 'undefined' || typeof ARMOR_DEFS === 'undefined') return;
    const TIER = 3;
    const relics = {};
    for (const slot of Object.keys(RELIC_DEFS)) relics[slot] = { tier: TIER };
    // Frost (T7) pickaxe so every ore tier in the ROCK band can be mined and
    // verified (each ore's bar drop + matching ore-stone sprite).
    relics.pickaxe = { tier: 7 };
    relics.axe = { tier: 7 };
    scene.save.relics = relics;
    const armor = {};
    for (const slot of Object.keys(ARMOR_DEFS)) armor[slot] = { tier: TIER };
    scene.save.armor = armor;
    Energy.set(scene.save, Energy.maxEnergy(scene.save));
    if (typeof scene.updateHUD === 'function') scene.updateHUD();
    if (typeof scene.persistSave === 'function') scene.persistSave();
  }

  function seedCoverageState(save, entry, originIX, originIY, tx, ty, cellM) {
    const plaza = sceneByName('PLAZA');
    const ix = originIX + plaza.lx + 1, iy = originIY + plaza.ly + 6;
    save.fires = [{ x: tx * entry.tileEdgeM + (ix + 0.5) * cellM,
      y: ty * entry.tileEdgeM + (iy + 0.5) * cellM, depth: 0 }];
    save.streets = {};
    save.streetsEpoch = 0;
    const lantern = entry.streetIndex?.lines?.find((r) => r.variant === 'lantern');
    if (lantern) {
      const length = Streets.lineLengthM(lantern.line, entry.tileEdgeM / SANDBOX_EXTENT);
      Streets.restore(save, WorldGen.tileKey(tx, ty), lantern.lineKey, [[0, length / 2]]);
    }
    return { fire: save.fires[0], lantern };
  }

  // Drop runtime-state interactables into the scenes. All live in save.* arrays
  // / scene-side Sets, so we mutate the scene directly. Clobber-and-rebuild for
  // a predictable baseline across reloads.
  function seedHouseState(save, entry) {
    const houses = (entry?.objects || []).filter(o => o.kind === 'house');
    save.restoredHouses ||= {};
    save.memories = Math.max(save.memories || 0, 20);
    save.discovered ||= {};
    for (const item of ITEMS) {
      if (Shops.memoryTotal(save) >= Shops.tierUnlockMemories(4)) break;
      save.discovered[item.id] = true;
    }
    // Remove only authored fixture progress; other visited tiles retain theirs.
    for (const house of houses) {
      for (const ledger of ['restoredHouses', 'shopTiers', 'shopLines', 'shinyHouses']) {
        if (save[ledger]) delete save[ledger][house.id];
      }
      if (save.starterBlacksmithId === house.id) delete save.starterBlacksmithId;
    }
    const ids = new Set(houses.map(h => h.id));
    if (ids.has(save.bookshopId)) delete save.bookshopId;
    if (ids.has(save.petshopId)) delete save.petshopId;
    if (ids.has(save.wizardTowers?.firstId)) delete save.wizardTowers;
    // Prior restorations unlock the current first tower without crowding the map.
    for (let i = 0; Houses.restoredCount(save) < Houses.STORY_RESTORES.firstTower; i++) {
      const id = `sandbox-history-${i}`;
      if (!save.restoredHouses[id]) Houses.restoreAs(save, { kind: 'house', id }, 'plain');
    }
    // Build ordinary houses first to unlock the story's restoration cards.
    for (const house of houses.filter(h => !h._sandboxWreck)) Houses.restoreAs(save, house, 'plain');
    for (const house of houses.filter(h => !h._sandboxWreck)) {
      const pick = house._wizardRole ? 'wizard' : house._sandboxBuild;
      if (!pick || pick === 'plain') continue;
      delete save.restoredHouses[house.id];
      if (!Houses.restoreAs(save, house, pick)) throw new Error(`Sandbox building card unavailable: ${pick}`);
    }
  }

  function seedSandboxState(scene, originIX, originIY, centreTX, centreTY,
                            cellsPerEdge, tileEdgeM, cellM) {
    const save = scene.save;
    save.planted = [];
    scene.placedRockSet.clear();
    save.scarecrows = [];
    scene.tilledSet.clear();
    save.released = [];
    save.wildAnimals = [];
    save.animalFeeds = {};
    save.restoredHouses = save.restoredHouses || {};
    const centreEntry = WorldGen.tileCache.get(WorldGen.tileKey(centreTX, centreTY));

    // Helpers ────────────────────────────────────────────────────────────────
    // Centre-tile LOCAL cell of (dx, dy) inside a named scene.
    const sceneCell = (name, dx, dy) => {
      const s = sceneByName(name);
      return { cellIX: originIX + s.lx + dx, cellIY: originIY + s.ly + dy };
    };
    const cellCenter = (cellIX, cellIY) => ({
      x: centreTX * tileEdgeM + (cellIX + 0.5) * cellM,
      y: centreTY * tileEdgeM + (cellIY + 0.5) * cellM,
    });
    // The save key of a centre-tile cell: its ABSOLUTE cell (coords.js
    // encoding — what the till / rock handlers key by), not the tile-local
    // index sceneCell returns.
    const absKey = (cellIX, cellIY) => {
      const c = tileCellToAbs(scene, centreTX, centreTY, cellIX, cellIY);
      return cellKeyFromAbsCell(c.cellIX, c.cellIY);
    };
    if (centreEntry) seedCoverageState(save, centreEntry, originIX, originIY,
      centreTX, centreTY, cellM);
    seedMechanicsState(scene, centreEntry);

    seedHouseState(save, centreEntry);

    // ── Pin Home to a synthetic trailer away from every test house, BEFORE
    //    app.js's ensureStarterShopId() gets a chance to run. That function
    //    auto-adopts the NEAREST 'house'-kind object to the player's spawn as
    //    Home — normally harmless, since a real wizard tower only exists after
    //    15 house restorations. The sandbox pre-seeds 'wizard' immediately
    //    (loop just above) on a house planted right next to PLAYER SPAWN, so
    //    without this it wins the "nearest house" search: it renders as the
    //    Home trailer instead of the wizard tower, and tapping it opens the
    //    sell modal instead of the tower's offers (docs/process/SANDBOX.md).
    {
      const { cellIX, cellIY } = sceneCell('PLAZA', 0, 3);
      const { x, y } = cellCenter(cellIX, cellIY);
      scene._makeStarterTrailer(x, y);
      scene._starterShopOk = true;
    }

    // ── FARMLAND: a row of crops at every growth stage 0..4. The cell must be
    //    tilled first; the renderer reads each entry's `stage` directly so we
    //    don't have to wait for real game time.
    const CROPS_AT_STAGE = ['rainberry', 'pairy', 'nut', 'potato', 'rubble'];
    for (let stage = 0; stage < 5; stage++) {
      const { cellIX, cellIY } = sceneCell('FARMLAND', 2 + stage, 2);
      const key = absKey(cellIX, cellIY);
      scene.tilledSet.add(key);
      const { x, y } = cellCenter(cellIX, cellIY);
      save.planted.push({ x, y, crop: CROPS_AT_STAGE[stage], stage, watered_t: 0 });
    }
    // Mature crop pre-watered → harvesting it exercises the double-produce path.
    const mature = save.planted[save.planted.length - 1];
    if (mature) mature.qualBoost = 2;
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
        const key = absKey(cellIX, cellIY);
        if (!scene.placedRockSet.has(key)) scene.placedRockSet.add(key);
      };
      for (let d = 0; d < s.w; d++) { ring(d, 0); ring(d, s.h - 1); }
      for (let d = 0; d < s.h; d++) { ring(0, d); ring(s.w - 1, d); }
    }
    // A lone placed rockfruit-rock in the PLAZA for the pickaxe-on-placed cycle.
    {
      const { cellIX, cellIY } = sceneCell('PLAZA', 2, 6);
      const key = absKey(cellIX, cellIY);
      if (!scene.placedRockSet.has(key)) scene.placedRockSet.add(key);
    }

    // ── PADDOCK: one bonded individual per species, plus wild growth samples.
    const PADDOCK_PETS = ['cat', 'dog', 'cow', 'chicken', 'butterfly'];
    PADDOCK_PETS.forEach((kind, i) => {
      const dx = 1 + (i % 3), dy = 1 + Math.floor(i / 3) * 3;
      const { cellIX, cellIY } = sceneCell('PADDOCK', dx, dy);
      const { x, y } = cellCenter(cellIX, cellIY);
      const animal = { x, y, kind, id: `sandbox_${kind}_${i}`, tx: centreTX, ty: centreTY };
      Pets.feedWild(save, animal, kind === 'chicken' ? 'potato_seed' : ANIMAL_FOOD[kind][0]);
      const row = Pets.bond(save, animal, { carried: false });
      Object.assign(row, { stayHome: true, petHomeX: x, petHomeY: y });
    });

    for (const [i, extra] of [{ raised: true, born: Date.now(), favouriteFeeds: 0, shiny: true },
      { shiny: true }].entries()) {
      const { cellIX, cellIY } = sceneCell('PADDOCK', 1 + i * 2, 6);
      (save.wildAnimals ||= []).push({ ...cellCenter(cellIX, cellIY), kind: 'chicken',
        id: `sandbox_chicken_growth_${i}`, tx: centreTX, ty: centreTY, ...extra });
    }

    // ── RECREATION (park): a scarecrow beside the crow so its aversion ring is
    //    visible against a real pest.
    {
      const { cellIX, cellIY } = sceneCell('RECREATION', 4, 1);
      save.scarecrows.push(cellCenter(cellIX, cellIY));
    }

    // ── PLAYER PLAZA: one coin drop per Render.COIN_PILES band (the coindrop
    //    tap path), on the first free plaza cells from the bottom row up —
    //    coins never share a cell with an object. In the real game these
    //    expire after COIN_BURST_LIFE_MS; here we omit expiresAt so they
    //    persist across reloads. They live in entry.coinDrops, not objects[].
    if (centreEntry) {
      centreEntry.coinDrops = (centreEntry.coinDrops || []).filter((c) => c._street === 'golden');
      const plaza = sceneByName('PLAZA');
      const cellOf = (p) => `${Math.floor((p.x - centreTX * tileEdgeM) / cellM)}_${Math.floor((p.y - centreTY * tileEdgeM) / cellM)}`;
      const taken = new Set([...centreEntry.objects, ...centreEntry.wildplants, ...centreEntry.coinDrops,
        ...(save.fires || []), ...(centreEntry.treasure ? [centreEntry.treasure] : [])].map(cellOf));
      const free = [];
      for (let dy = plaza.h - 1; dy >= 0; dy--) {
        for (let dx = 0; dx < plaza.w; dx++) {
          const { cellIX, cellIY } = sceneCell('PLAZA', dx, dy);
          if (dx === Math.floor(plaza.w / 2) && dy === Math.floor(plaza.h / 2)) continue;   // spawn
          if (taken.has(`${cellIX}_${cellIY}`) || scene.placedRockSet.has(absKey(cellIX, cellIY))) continue;
          free.push({ cellIX, cellIY });
        }
      }
      Render.COIN_PILES.forEach((row, i) => {
        const { cellIX, cellIY } = free[i];
        const { x, y } = cellCenter(cellIX, cellIY);
        centreEntry.coinDrops.push({ kind: 'coindrop', x, y, amount: row.min,
          id: `sandbox_coin_${cellIX}_${cellIY}` });
      });
    }

    // ── An extra treasure-X on the SW neighbour tile, at the seam with the
    //    centre tile (each tile entry holds only ONE `treasure` slot, and the
    //    in-reach one north of spawn already used the centre tile's slot).
    const swKey = WorldGen.tileKey(centreTX - 1, centreTY + 1);
    const swEntry = WorldGen.tileCache.get(swKey);
    if (swEntry && !swEntry.treasure) {
      // On the SW tile's own grid (its row's — coords.js rowCellM).
      const swN = swEntry.cellsPerEdge, swM = tileEdgeM / swN;
      const cellIX = swN - 2, cellIY = 1;
      swEntry.treasure = {
        id: `sandbox_treasure_sw_${centreTX - 1}_${centreTY + 1}`,
        x: (centreTX - 1) * tileEdgeM + (cellIX + 0.5) * swM,
        y: (centreTY + 1) * tileEdgeM + (cellIY + 0.5) * swM,
      };
    }

    if (typeof scene.persistSave === 'function') scene.persistSave();
  }

  function stockSandboxInventory(scene) {
    if (typeof ITEMS === 'undefined') return;
    const COUNT = 5;
    const inv = [];
    // Most-tested kinds first (seeds → produce → animals → minerals →
    // consumables).
    const ORDER = ['seed', 'produce', 'animal', 'mineral', 'magic', 'supply'];
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
    // Unspent memories (a save counter, not a bag stack) so the wizard
    // tower's offers are exercisable too.
    scene.save.memories = Math.max(scene.save.memories ?? 0, 20);
    if (typeof scene.updateMemoriesDOM === 'function') scene.updateMemoriesDOM();
    if (typeof scene.buildInventoryDOM === 'function') scene.buildInventoryDOM();
    if (typeof scene.persistSave === 'function') scene.persistSave();
  }

  function seedMechanicsState(scene, entry) {
    const save = scene.save;
    // Fire history is permanent in normal play; keeping it here made a second
    // sandbox visit unable to ignite the very same demonstration cells.
    save.groundFire = {};
    save.burnedObjects = [];
    save.potionEffects = {};
    scene._groundFireSave = null;
    delete save.tomeDays;
    delete save.tomeReadyAt;
    delete save.tomeMagicCd;
    save.conditions = {};
    const targets = (entry?.creatures || []).filter(c => c.id.includes('_PRACTICE_plant_'));
    for (const [i, id] of ['giant_potion', 'shrinking_potion'].entries()) {
      if (targets[i]) PotionEffects.apply(scene, targets[i], id);
    }
    // An ordinary third plant makes scale and health-cap changes comparable.
    // Ignite only the upper fuel row; the lower row remains available for casts.
    const fuel = entry?.objects.find(o => o.id.includes('_tree_PRACTICE_') && o.id.endsWith('_10_6'));
    if (fuel) {
      const cell = worldMetersToAbsCell(scene, fuel.x, fuel.y);
      scene._igniteGroundCell(cell, Date.now());
    }
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
    // One caption per labelled zone. Scenes that pack several biomes into
    // sub-rects (MARSH, RECREATION, CIVIC) declare `subLabels` so each biome is
    // individually labelled at its own centre; others use the single centre label.
    const addLabel = (text, cellIX, cellIY) => {
      const wx = tx * tileEdgeM + (cellIX + 0.5) * cellM;
      const wy = ty * tileEdgeM + (cellIY + 0.5) * cellM;
      const t = scene.add.text(0, 0, text, {
        font: fontUI('bold 8px'),
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.6)',
        padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 0).setVisible(false);
      scene._sandboxLabels.add(t);
      scene._sandboxLabelData.push({ wx, wy, t });
    };
    for (const s of LAYOUT.scenes) {
      if (s.subLabels) {
        for (const sub of s.subLabels) addLabel(sub.label, originIX + s.lx + sub.dx, originIY + s.ly + sub.dy);
      } else {
        addLabel(s.label, originIX + s.lx + Math.floor(s.w / 2), originIY + s.ly + Math.floor(s.h / 2));
      }
    }
    // Re-position labels from their world coord every frame so they follow the
    // camera. wanderCreatures runs each scene tick and we own the reference, so
    // wrap it (a direct scene.update patch doesn't intercept Phaser's binding).
    if (!scene._sandboxLabelTickInstalled) {
      scene._sandboxLabelTickInstalled = true;
      const reposition = () => {
        const data = scene._sandboxLabelData;
        if (!data) return;
        // Camera anchor, so the labels ride the ground under a peek drag the
        // same way the sprites they name do (coords.js viewAnchorWorldM).
        const a = viewAnchorWorldM(scene);
        const halfM = (VIEW_CELLS / 2 + 1) * scene.cellM;
        for (const d of data) {
          const dx = d.wx - a.x, dy = d.wy - a.y;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) { d.t.setVisible(false); continue; }
          const { x: sx, y: sy } = deltaMToScreen(scene, dx, dy);
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
  // Pure hooks keep coverage tests on the same builder the browser installs.
  global.Sandbox.buildForTest = buildForTest;
  global.Sandbox.seedCoverageState = seedCoverageState;
  global.Sandbox.layoutForTest = LAYOUT;
  global.Sandbox.seedMechanicsState = seedMechanicsState;
  global.Sandbox.seedHouseState = seedHouseState;
  global.Sandbox.stockInventoryForTest = stockSandboxInventory;
  global.Sandbox.resolveDestination = resolveDestination;
})(window);
