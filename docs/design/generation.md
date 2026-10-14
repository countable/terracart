# Generation, saves and spawn precedence

Detail doc for world generation, saves and placement precedence. The root
`CLAUDE.md` owns the overview; read this before changing generation, spawn
access or tile lifecycle mechanics.

## Surface rocks

- After zone and scenic dressing, `assignSurfaceBoulder` selects roughly one
  eighth of plain natural mineral rocks from their stable ids. Boulders retain
  their mining identity and yield. Ore, gem deposits, cave rocks, roadside rocks
  and connected zone walls are excluded from this size selection. Selected
  rocks carry `sightBlocking: true`; ordinary stones stay small and leave sight
  clear. Shared rocks use neutral grey material artwork, with authored zone signatures
  and optional zone tints for the supported places.

## Habitat populations

- Ambient animal budgets share `HabitatSpawns.FAUNA_DENSITY`: ordinary landcover,
  road roamers, and ordinary shoreline fauna use 70% of their base counts,
  rounded to whole animals. Nexus populations, enemies, authored formations, starter guarantees,
  saved animals and pets keep their existing counts.
- `src/habitat_spawns.js` owns fauna mixtures, landcover/variant resolution and
  population budgets. Nexus coverage wins, then a declared Road Variant,
  then ordinary landcover. `streetAreaVariants` records the winning variant
  across its entire corridor, including furniture gaps. Plain roads/paths
  have no profile. Residential, Grass and the Nexus variants collectively
  provide core inhabitants; uncommon landcovers supply travel variety.
- Ordinary surface fauna and enemy requests use separate tile budgets,
  apportioned by raw habitat coverage. Safety restrictions never enter the
  count calculation. Compute legal species seats through `isSpawnCell` and
  exhaust that pool within the same habitat. Forbidden ground is missing map
  area, not a roll that thins the population. A species with no sufficient
  legal space reports a placement shortfall without switching habitat/species.
- Synthetic floor previews set `scene.habitatTileAreaScale` to their tile area
  divided by a real map tile's area at the preview latitude. This scales only
  ordinary fauna, enemy and mode-reserve budgets before placement. Live scenes
  default to 1; Nexus, road, shoreline and authored encounter budgets keep
  their own rules.
- Mode differences in landcover enemy count are a reserve, not a reroll: the
  world seats the largest `Difficulty` `landEnemyCountMul` share
  (`enemy_habitat_…_r<n>` ids) after the base population, and each mode shows
  its share through `HabitatSpawns.reserveVisible` (hard 1.5×, easy none).
- All generated creatures reserve their seats before captures, defeats, Home,
  daylight, amnesty and mode overlays. Stable habitat slots choose species;
  legal-seat changes cannot change their identities or species. Fauna may share
  static interactable cells, but generated inhabitants do not share each
  other's seats. Habitat and shoreline fauna prefer three-cell Chebyshev
  separation across species, including already placed inhabitants. Seeded seat
  order stays deterministic; if no fully spaced legal seat exists, use the best
  remaining clearance so tight habitat does not silently lose its population.
  `entry.habitatPopulation` separates requested, placed and
  shortfall counts; matching authored Nexus fauna satisfies matching slots.
- Crows are the open country's corvid: Grass landcover, Grove Nexus and
  declared Road Variant populations; Ravens are the houses' (Residential).
  Rabbits have ordinary surface populations. Cat exclusion from Wasteland, Deer restriction
  to Forest/Residential, and Butterfly exclusion from Forest/Orchard remain
  species placement limits.
- Shore length is a specialized ambient budget outside Nexus coverage. Every
  Nexus keeps its own declared inhabitants and excludes generic shoreline
  top-ups, including after captures. Safety only removes destinations;
  `entry.shorePopulation` records placement shortfalls.
- Ordinary beach enemy slots favour Jellyfish (80%) over Giant Crabs (20%).
  Jellyfish occupy legal shoreline water; crabs occupy sand. The shared enemy
  budget and Home restrictions still apply; Nexus encounters keep their own mix.
- Beach Nexus influence has a hard ten-cell radius (about a 20×20-cell
  extent), including ragged edges and park-derived beach companions. Larger
  mapped beaches remain ordinary sand outside that cap, with normal beach
  spawning. Other Nexus kinds retain their existing coverage rules.
- The former species-first draw stream is replayed only to preserve unrelated
  tile treasure RNG and map old cell-based enemy defeats to new stable habitat
  identities. Historical fauna counts are compatibility inputs, not current
  population tuning. New captures keep the existing species/tile/ordinal ID
  scheme; saved filtering never releases a generated seat to another creature.
- Nexus roamers, finite guards, optional Wetland/Rock sites and authored building
  encounters retain their explicit budgets. Mobile guards exhaust legal seats
  within their feature before reporting a shortfall. Rooted pattern inhabitants
  and core/roof formations retain their exact authored layout seats.
- Triggered bush fauna and ambient haunting consult the owning habitat. Headstone
  ghosts, starter/story creatures, crop pests, saved pets and summons remain
  feature/progression/player-driven exceptions; all placement still uses the
  shared gate. Hazards such as vents and whirlwinds retain their own system.

- Cave ambient enemies use stable request IDs: packs end in `pack_<ordinal>`
  and roamers in `roam_<blockX>_<blockY>`, after the depth/tile prefix. Their
  identities and species remain fixed when safety relocates their seats. A
  raw-floor compatibility pass assigns historical cell aliases before safety;
  each alias belongs to one request, so old defeats neither resurrect relocated
  foes nor suppress multiple enemies. Rabbit identities remain ordinal-based.
- Rendering and simulation use `EnemySpawns.isSurfaceResident`, including
  habitat-only residents without ordinary roster metadata. Evening suppression
  is reevaluated after dusk and dawn, including specialized Metal Slimes.

## Generation, saves and tiles

- After surface POI placement settles, `assignScholarFallback` upgrades one
  surviving Scriptorium (library or college) to a Scholar when the tile has no
  Scholar. The smallest stable object id wins, independent of input order or
  player progress. This service override preserves the source POI class, id,
  treasure rules and underground chest mirrors; existing school Scholars take
  precedence. Selection precedes live overlays and never depends on visits.

- Spider webs save their absolute cell, world position, depth and wall-clock
  expiry in `save.spiderWebs`. Spider Path webs instead regenerate from their
  section seed, remain while their surface tile is loaded, and never enter
  this expiring save list. Shots landing on permanent silk do not change it.
  Shot webs survive reloads and tile eviction until
  24 hours after landing; another shot refreshes that cell without duplicating
  it. Silk in flight is transient and is cleared when depth changes.

- Do not add save/data compatibility migrations until the user requests them.
  Retired save formats may be discarded; keep current-state defaults, validation
  and runtime cleanup separate from compatibility conversion.

- Surface access exclusions and typed safety suppression apply at every dungeon depth.
  Road bands, junctions, private/restricted/quiet land and sensitive sites retain
  their reason bits; kerb and sensitive-area buffers retain their spawn-class rules.
  Terrain alone is recalculated for the current floor. Underground tiles also
  inherit road geometry for chase boundaries, warnings and night-road hiding/drain.
  Farm and orchard interiors, and entire golf courses, exclude spawns at every dungeon depth.
  Fields keep an eligible outer rim of `WorldGen.FARM_EDGE_CELLS` cells,
  measured from the source footprint; roads, POIs and later paint cannot create
  interior edges. Farmland rims scatter static T1–T2 wild crops at seeded growth
  stages, directly on the ground, through the ordinary wildplant lane. They have
  no dirt bed or watering interaction.
  `WorldGen.SPAWN_WHY_ALL_FLOORS` owns the inherited reasons; `floorSpawnWhy`
  derives them from immutable surface evidence. Preserve that mask through cave
  generation and runtime spawns; repainting or digging never grants spawn access.

- L2 fills eligible ground between authored areas with connected goblin-warren
  rooms (`CaveAreas.planCity`, configured by `floorProfile(2).warren`).
  Shared walls have two-cell doors; clipped rooms retain open rims, and route
  clearings, landmarks and stair approaches stay clear. The city owns its empty
  ground so ordinary rock scatter cannot refill its passages. Room encounters
  use stable IDs and the class-specific safety gate; finite stores share the
  existing cave-container budget. The drill budget is placed before the city.

- L2 pressure plates are subtle floor marks, visible only within one cell of
  the player's body. Stepping on one triggers its paired rolling ball, spike
  wall or gas grate once per encounter. Gas grates stay inert until pressed,
  then emit the existing poison/paralysis gas burst rather than a periodic
  geyser eruption. City passages may host traps despite the city's ambient
  reservation; actual objects, landmark approaches and the hazard safety gate
  still exclude placement. Grove ghost plates retain their existing visibility.

- Authored cave areas use `ZoneVariants.anchorFrame` and run before ordinary
  floor passes. Keep their empty-ground reservations separate from object
  occupancy (`CaveAreas`); ambient spawns must respect both. Derive deeper
  floors from `geologyGrid`, before authored terrain changes. Ordinary cleanup
  and gem conversion must leave `caveArea` pieces intact. Authored warren
  stores spend `WorldGen.caveContainerBudget` before ambient barrels.
  Dungeon mazes on floors 1–2 repeat the reviewed 34 × 33 braided wall mask
  (spacing 3, loops 77%) in canonical anchor coordinates across eligible grove
  coverage. Fill is diggable `CAVE_WALL`, not rock objects. Clipped boundaries,
  tile seams, routes, landmark approaches and the focus stay open; shortest
  wall-cutting paths connect each eligible component. Protected islands are
  never carved, and components with no existing floor access are skipped.
  Small and thin footprints keep fewer walls rather than stretching the maze.
  Only the focus-owning tile places its seeded Ember shrine or T3 chest; an
  existing mirrored POI chest is replaced with the same identity. Cell-addressed
  encounters use `EnemySpawns.caveKind` for the current floor and the ordinary
  defeat ledger. Player mining applies afterward through the normal dug-cell
  overlay, so returning does not restore excavated maze walls.

- Zone geometry is surface-owned and level-independent: zones, anchors,
  coverage and the road mask are computed once on the surface, frozen in its
  `caveSource` snapshot, and every floor reads that snapshot read-only - no
  zone is re-rolled per level. A floor instead derives its terrain from a
  class-to-terrain mapping over that inherited geometry (`undergroundTerrain`)
  and its content from per-floor tables: enemy habitats mint their own
  per-depth regions (`THEME_BANDS`), while chest mirrors, torch sites, quarry
  provenance and spring caves inherit surface anchors. The street mirror and
  any per-floor road clearings are level-scoped projections of surface lines.
  On L1, only Small roads become road-derived cave walls; Medium/Large roads
  and paths remain open terrain. Route projection cannot carve the L1 Small-road
  walls. Buildings and water retain their existing wall mapping. Open terrain
  does not relax inherited spawn safety.
  `docs/design/floors.md` owns the per-floor catalog.

- A per-floor rule - rope seals, fall seals, hazards, lighting levels - reads
  one owning table keyed by floor, never a depth literal at a call site.
  `WorldGen.floorProfile(depth)` owns cave terrain, street projection and gem
  probabilities, flint-bearing rock frequency, authored cave-area weights/carving/garrisons, pressure traps,
  the vent kinds a floor erupts,
  arrival story IDs and entry keys. The terrain ladder is city 2, clearings 3,
  open fungal 4, haunted surface mirror 5, lava 6, and dragon mirrors 7–8.
  Clearing rewards carry the receiving depth; biome tints follow the profile.
  Keep story copy in the presentation module;
  choose its story through the profile. Depths beyond the explicit rows inherit
  the default profile, including the infernal entry key.
  `DungeonProgression.ROPE_SEALED_FLOORS` governs rope descent, sinkhole and
  authored cave-hole minting, and both fall checks; lighting already derives
  its per-floor ambience from depth (`Lighting.profile`, `litDim`).

- Flint Field's central disk contains mineable flint-bearing rocks instead of
  loose pickups. Visible flint seams yield stone and one guaranteed flint.
  L1 marks a quarter of ordinary ambient rocks as flint-bearing using stable
  rock IDs and `floorProfile(depth).flintRockP`; placement and ore rolls retain
  their existing seeded streams. Other floors and loose tar-zone flint keep
  their existing rules.

- Generate the world deterministically; save player changes as id sets and
  player-placed objects in full. The starting area is also stored explicitly.
  Each spawner owns a seeded RNG stream so adding one does not reroll others.
  Barricades are tier-2 supplies found in supply/field loot or supply shops.
  Finding one unlocks its Home recipe: three wood makes one barricade. Select
  it and tap an empty safe cell to place it on the current floor. Saved
  barricades reuse the wild obstacle's art, slowing, damage and axe/fire/kit
  clearing rules; floor-tagged records survive reloads without reappearing
  after removal. Chopping a crafted barricade returns its recipe wood cost
  without a shiny bonus.
- Indoor mall POIs retain their original map cells instead of migrating to
  building frontage. `WorldGen.indoorMallPoisSteps` classifies each source
  building component independently: at least 4,000 m², at least 9 distinct
  POI positions inside, and at least half 15 m or more from its walls.
  Courtyard holes subtract area, exclude contained pins and count as walls;
  disconnected buildings never pool tenants. Buffered map points participate
  in classification, while the existing tile-ownership rule still controls
  placement. Ordinary buildings and shallow strip centres keep frontage
  placement. `shop=mall` alone cannot override the geometry: both enclosed
  Orchard Park and outdoor Orchard Plaza use that tag. The rule is a geometry
  heuristic, not an entrance-access guarantee; missing tenant mapping and
  clipped footprints can leave an enclosed mall using frontage placement.
- A POI chest's tier is its tile's QUOTA SEAT (`WorldGen.seedChestTiers`):
  each tile seeds ~1 T5, 5 T4, 11 T3, 36 T2 (x1..x2 over 100..1000
  budgeted POIs) onto its best-ranked POIs (the MVT `rank` tag),
  round-robin across chest categories; everything else is T1. A bus stop
  never takes a seat: it is always a regular restocking crate
  (`loot.js chestAlwaysCrate`), because the wagon art belongs only to the
  old-trade-road mercenary stop. Vista chests
  are fixed T5 outside the budget; a Nexus chest can win a seat without
  spending one (+1 on top). Each underground floor re-seats its own pyramid over
  its mirrors (the rank rides down), and the cap CLIMBS underground
  (`loot.js chestTierMaxFor`: T6 from depth 4, T7 from 7) while the depth
  bonus stays `+floor(depth/2)`. Unseeded chests (hand-placed, sandbox) are
  the unstamped T2 - the old count ladder is retired, and `o.poiDensity`
  now only feeds restock days and POI coin bursts. Breakable pots and
  barrels select their loot mix by stable appearance (`barrelProfile`). Surface
  waste-basket/recycling POIs share `barrelDensity`, the combined tile count
  stamped with POI density (including restamps after live additions). At ≤10
  containers, each is full with a 75-coin budget; at ≥200, each has a 20% full
  chance and a 15-coin budget. Both interpolate linearly between endpoints.
  Generated non-POI containers keep 30% full odds and a 15-coin budget. Full
  containers pay that budget as coins or use `ChestThemes.quantityForBudget`
  for item stacks, including category shares and caps; higher budgets never
  promote item tiers. All containers remain permanently smashed after use.
- An X mark is hidden (`HiddenObjects.treasureHidden`) until the feet stand
  on a neighbouring cell (`HiddenObjects.tick` records it in
  `save.hiddenDiscoveries`), or within the vision disc with Perception; until
  then it is neither drawn nor diggable. A covering rock adds no rule of its
  own. The Treasure Map's dot is apart.
- X-mark density: every ambient X stream (tile scatter, low-tier quota,
  footpath and inland-sand bonuses, shoreline, cave floors) scales its count
  by `loot.js X_MARK_FREQUENCY`; authored marks (parking, hoards) stay one
  per site. Shoreline marks use an additional 0.7 density multiplier and
  seeded farthest-first placement, at least three cells apart from each other
  and earlier X marks on the tile. Their positions repeat for every player
  and reload; crowded beaches may place fewer when no spaced legal seat remains.
- A GREAT X (`loot.js GREAT_X`): `GREAT_X.share` (a tenth) of every X mark,
  whatever stream laid it, chosen by `isGreatX` off the mark's id. Drawn thick
  and dark red, it digs the `treasure:great` pool (gold, a tool or weapon, or
  other equipment) through the same handler, hiding and found-ledger.
- Sparse-tile seeding: below 250 POIs per 2.8224 km² of spawnable land,
  `topUpAmbientCratesSteps` fills to 200 per that area (240 × 240 seven-metre
  cells, a typical mid-latitude tile). Both numbers scale with the count of
  cells accepted by the reward spawn gate, so compact review tiles get
  proportionally fewer crates. Use canonical cell area, not the player’s
  latitude-dependent metre frame. Water, road surfaces and other
  excluded ground contribute no area; occupancy blocks placement without
  shrinking the target. The census includes surface POIs of every tier and
  type, plus generated filler; fixed starter loot and cave mirrors are excluded.
  The additions are one-time T1 crates, scattered by stable cell hashes across
  free spawnable cells. Their loot follows underlying landcover: grass, forest,
  parks and wetlands use park loot; farmland and orchards use farm loot;
  commercial ground uses commerce, school grounds use school, and other ground
  uses roadside. The pre-fill shortfall (`entry.lowTierDeficit`) also lays extra
  X marks in proportion (`X_TOP_UP_MAX`), drawn off the cell hash. Mine mouths
  ignore ambient crates and drop any they land on.
- Treasure trails (`HomeArea.chestTrailCandidates`, up to `CHEST_TRAIL_LIMIT`)
  lead to the nearest unopened T2+ surface chests within
  `CHEST_TRAIL_RADIUS_CELLS` of the player, anywhere on the surface (only the
  starter crate's guide stays inside Home's ring); the chest at a trail's end
  rolls `CHEST_TRAIL_TIER_BONUS` tier higher, within its depth cap.
- A Small road's end inside the tile that meets no other vehicle way (a
  cul-de-sac) holds one tier-1 supply crate (`o.crate`, no `poiClass`, so it
  gives once): `StreetVariants.dress`, seated like an end piece, capped per
  tile, lowest hash of the end's global point first. Ends clipped at the tile
  edge are not dead ends.
- Chests give ONCE (`save.opened`), including smashed pots and barrels. Crates
  (`restocks`) come back after `crateRestoreDays` (1 for an ordinary crate, up
  to 7 for a class crowding its tile); bike racks, chapels and
  grove shrines daily. Recurring sites take the one day ledger (`Macros.markToday` — it
  keeps a week; `usedToday` / `stillBare` / `restockWaitMs` read it) and glow
  while available (`poiLit`); a refusal is `Macros.waitLine(prefix, ms)`. A
  recurring thing is a ROW of `Macros.DAILY_VISIT_KINDS` (its ledger lane,
  bare days, refusal prefix, optional `open` tap) resolved by
  `visitKindForObject`; rolling-millisecond cooldowns use `Ledger`
  (save.js). A new recurring thing joins that table, never a list of its own.
- Derive generated ids/seeds from tile + local cell or OSM id, never array
  indices, timestamps or save-relative metres. The transient pest deer is the
  id exception. Per-save salts may vary rewards, not positions;
  `WorldGen.setReviewSalt` is for the map-review tool only.
- Every player with the same tile data sees the same generated identities and
  positions. Use `cellsPerEdgeForTile(ty)` and `tileEdgeM / entry.cellsPerEdge`:
  the save's `START_LAT` metre frame is for drawing, not generation.
  Player progress/home adjustments are overlays; player edits must not alter
  the generated grid used to derive deeper levels.
- Reward rolls, recurring events, mode-dependent creature/trap counts and
  player progress may differ. Restoration remains per-save. Deduplication uses
  data/anchor ownership, not tile load order; cached Overpass bins are frame-free.
- THE SPAWN GATE is `entry.spawnWhy` (`WorldGen.stampSpawnWhySteps`, beside
  the road mask in the sliced build): per cell, the REASONS it is refused
  (`WorldGen.SPAWN_WHY` bits), never a single verdict. HARD reasons refuse
  every spawn: TERRAIN, ROAD (the roadMask only - at least half the cell under
  the band; road proximity is KERB, never hard), JUNCTION (an intersection
  involving an MD/LG road, including the overlapping bands and a 2-cell
  buffer), RESTRICTED land, QUIET land,
  KINDERGARTEN grounds, a SENSITIVE_SITE point, BEHIND_HOUSE, PRIVATE (a
  lot with no public frontage; OR — Sep 2026, the Voronoi rule — exterior
  COMMERCIAL / INDUSTRIAL ground whose NEAREST POI, over the tile's whole poi
  layer incl. its buffer, is not PUBLIC in the one table
  `WorldGen.COMMERCIAL_POI_KIND` (office / hotel / clinic nearest, or none
  within `NEAREST_POI_MAX_M`; `commercialPoiField` is the one field the gate
  and map-review read); a POI chest in reach lifts it), FARM_INTERIOR (a field past
  `FARM_EDGE_CELLS` of other ground — the EDGE band itself carries no reason
  at all: every class may spawn there). TYPED reasons refuse only the classes
  whose row of ONE table, `WorldGen.SPAWN_CLASS_BLOCKS`, names them: KERB
  (fast movers only), JUNCTION_SOFT (fast movers and hazards), SENSITIVE.
  (Sep 2026, owner's call: the typed HOUSE
  reason — a 40 m house buffer on lot land — and the typed SCHOOL reason —
  school / college grounds, plus its school-hours timing — are both dropped
  entirely; KINDERGARTEN stays hard. FARM was inverted the same day: the
  field EDGE band used to be typed-suppressed, now it carries no reason.)
  RESTRICTED and KINDERGARTEN hold only where the cell's FINAL terrain paint
  still agrees with the class's own look (`restrictedExpectedTerrain`,
  T.SCHOOL for kindergarten) — COMMERCIAL WELCOMES VISITORS (Sep 2026): a
  later or higher-priority commercial/retail polygon overlapping a stray
  restricted-class or kindergarten polygon in the source data wins the cell
  and reopens it (to be judged by its nearest POI like any commercial
  cell), though a real hospital campus IS its own commercial paint
  and keeps RESTRICTED. The military/railway rows of QUIET_LAND get the same
  paint check (`stampQuietLandSteps`'s optional `grid` arg); cemetery and the
  boundary/park aboriginal_lands rows do not (no own paint to compare, or
  never ours to reopen on a data coincidence). Every static spawner calls
  `WorldGen.isSpawnCell(grid, w, h, cx, cy, opts, cls)` with `_spawnOpts`
  (`spawnWhy`, `roadMask`, `occupied`) AND its class. Creature generators call
  `CreatureSpawns.isSpawnCell` or `gateAt` with the kind; the wrapper derives
  the class and delegates to that same gate (the source sweep in
  `test/node/spawn_class.test.js`): `minor` (flora, rocks, scenery — hard
  reasons only), `headstone`, `cave`, `fauna` / `fastFauna`, `npc`,
  `attractor`, `enemy` / `fastEnemy`, and `hazard` (surface traps). Fast
  movers and hazards refuse JUNCTION_SOFT, the overlapping bands and 1-cell
  buffer at a Small-road junction. A creature's class is DERIVED
  (creature_ai.js `creatureSpawnClass`: fast = top speed over
  `BRISK_WALK_MPS`), never typed at a call site. A new refusal is a new
  reason bit plus its column in the table, never a separate check at a
  spawner. Authored Thorny Path, Snare Lane and Barricade Road cross-sections are the
  narrow exception: `streetObstacle` may occupy explicitly declared cells
  of its own road band. Thorny Path and snare clusters (and a Snare Lane's few lone stray snares, declared one band cell at a time) cross variant-eligible Small roads only; removable
  barricade/spike lines belong on paths. Every authored cross-section refuses
  Major/Medium road bands and their kerb buffers. All keep
  private, quiet, restricted, water/building and occupancy exclusions. Ordinary
  spawn classes cannot use that declaration to cross a road.
  POI chests are the place itself (`landRefused` —
  land reasons only). The live Overpass fence veto (`privateVetoAt`) is for per-player
  things only and fails open. Road terrain alone misses drawn roads; the mask uses
  `WorldGen.roadOverlayWidthM` and masks cells when the drawn bands cover
  `WorldGen.ROAD_MASK_MIN_COVER` of their area. Coins never land on road cells
  or in yards, and every timed reward (coin bursts, bounty packs,
  `findWalkableDestination`) stays on the player's SIDE of any MD/LG road
  (`sameSideField`, creature_ai.js) — nothing urgent across a Major or Medium road.
  Cave traps use their occupied-cell set; surface traps sit beside footpaths
  or on park edges, never near a road (`Traps.isTrapGround`).
- Path variant assignment joins connected mapped fragments and balances natural
  endpoints, nearby terrain/Nexus affinity and a soft 300 m length target.
  Ordinary sections are at least 180 m and at most 550 m. Junction-created
  approaches shorter than 60 m merge into the connected through-path rather
  than starting their own theme; well-spaced forks remain boundaries. True
  short dead-end branches retain their own geometry and assignment. Every 20 m, sample beside the path using source ground
  and Nexus traits. A dominant affinity change must persist 40 m on both sides
  to attract a cut. Source endpoints and pronounced bends are also preferred;
  interpolated cuts keep long uniform spans bounded. Choose cuts together to
  avoid short leftovers. Theme affinity uses the same surrounding traits.
  Section keys use their boundary coordinates and mapped level rather than an
  ordinal, so an unchanged downstream section keeps its identity. Boundary
  reasons and lengths are exposed in the map review viewer.
  `streetIndex.pathSections` owns their geometry, stable
  keys, source feature IDs and themes;
  isolated short paths and tile-edge remnants stay short. Exact T-junctions are joined even when a source line omits the junction
  vertex. Nearby disconnected endpoints are not snapped together. At forks, the
  straightest continuation is preferred deterministically. Different mapped
  levels and bridge/tunnel classes never join, and disconnected geometry
  never joins just because it shares a feature ID. Sections are tile-local;
  generation never depends on which neighbouring tiles are loaded.
  Path sections have their own weighted pool: mostly Greenway, Park Path and
  Promenade, with occasional Lantern Row and Barricade and a rare Golden Path
  (2% base weight), plus Slime Trail and Spider Path (5% each, taken equally
  from Greenway and Park Path). Slime Trail picks one species per stable section
  from green, purple, fire and splitting slimes. Seeded posts every 70 m hold
  two of that species, with a midpoint post on short sections where placement
  allows. These are finite path-authored enemies using the ordinary defeated
  guard ledger, with no daily reset or extra shrine. Golden Path uses Golden Road’s
  daily shrine reward. A shrine is seated at each end where safe ground permits;
  both use the section key for one shared daily activation and the same coin
  seats, so either direction works without a second payout. At most one coin
  seat per cell is sampled along the
  exact path centreline, never snapped to cell centres or placed on verges.
  Occupancy and spawn restrictions leave gaps; path-authored seats survive
  Nexus crossings. Scenic overrides still apply. Small-road variants
  never enter that pool. A majority-scenic section uses its landscape's look. Scenic restoration bonuses still follow the
  original geographic intervals. Painting, dressing, lamps, stories and map
  review all consume the same section assignment.
- Poison Path, Fire Path, Paralysis Path and Confusion Path each have 3% base
  weight, taking six percentage points each from Greenway and Park Path. Their
  matching geysers use seeded verge seats every 42 m, with a midpoint sample
  for short sections. The hazard gate and occupancy can leave gaps. Every
  section attempts a daily shrine before claiming geyser cells, searching its
  length for safe public ground. Poison lends Mending, Fire lends Ember,
  Paralysis lends Shield, and Confusion lends Light; these are ordinary daily
  boons, not immunity to the matching gas. Geysers yield to Nexus coverage.
- Spider Path has 5% base selection weight. A seeded 35% of cell-spaced
  path samples receive permanent webs, with a small seeded lateral offset.
  Webs use the hazard spawn gate and reserve their cells; restricted land,
  occupancy, vehicle roads and road-junction safety can leave gaps. One
  two-spider garrison per section seats on safe nearby ground. Both webs
  and spiders yield to Nexus coverage. Web contact
  uses the usual six-second paralysis, once per entry, with flight immunity.
- Nexus interiors suppress Small-road variants using exact coverage-boundary
  intervals shared by pavement, lamps, stories and hazards. The selected theme
  and its stable identity survive; only outside portions receive themed
  dressing. Coverage also clips area claims and hot-road end caps. Paths keep
  their light paving and lamps inside, but Nexus vegetation and encounters
  take precedence: all path/road props, plants, rewards, traps, geysers, guards
  and slow effects yield, including where the Nexus motif leaves a cell empty.
  Affinity is sampled before suppression. Nexus influence follows connected
  routes for up to 150 m, fading with route distance; parallel disconnected
  roads and different bridge/tunnel levels do not inherit it. The path pool's
  normal weights live on its rows as `pathWeight`; Small roads retain `share`.
- Medium roads are always **Old Trade Road**, and large roads are always
  **Ancient Highway**. Neither receives road variants, themed obstacles,
  themed guards or variant flora. Both retain road suppression and nighttime
  curse damage. Selected mapped bus stops off the MD carriageway can retain
  mercenary hiring wagons; LG roads and junctions cannot. Ordinary mapped
  places keep their existing rules.
- Parking lots join the MD/LG kerb buffer's suppression at every hour
  (`ROAD_CLASS_MAJOR_BUFFER`, stamped into the spawn gate as `KERB`) without
  acquiring a road surface, the standing-on-carriageway warning or the night
  zone: a cell only a lot puts in the buffer also carries
  `ROAD_CLASS_LOT_BUFFER`, and every night-zone reader (blood aura,
  interaction hiding, energy drain) goes through `WorldGen.nightZoneBits`.
  A lot never removes a road buffer's night zone. Mapped parking polygons
  supply their footprint; retained tagged/inferred parking aisles use the lot
  detector's 12 m radius, and non-streetside parking POIs its 30 m radius.
  Fast movers cannot spawn or enter; traps, whirlwinds and other
  `hazard`-gated placements stay out. Repainting a lot as a Quarry Nexus keeps
  this suppression.
- The road is never a refuge and never a lure. `roadClass` derives all safety
  geometry from the vector bands. `ROAD_CLASS_MAJOR_ROAD` marks an MD/LG cell
  only when that group covers at least half of it, which gives runtime warnings
  the same threshold as `roadMask`. `ROAD_CLASS_JUNCTION_EXCLUDE` marks every
  MD/LG-involved junction's overlap plus 2 cells: every spawn and every
  non-allied creature refuses it. `ROAD_CLASS_JUNCTION_SOFT` marks a Small-road
  junction plus 1 cell: fast movers and hazards refuse it. Bridge, tunnel and
  causeway crossings do not create ground-level junctions. The Major-and-Medium road group carries a kerb
  buffer (`ROAD_CLASS_MAJOR_BUFFER`): no hostile steps onto the band, no FAST
  mover (foe or animal over `BRISK_WALK_MPS` — `isFastMover`; the wild
  slime's charge is under it) spawns in or enters the buffer, and a player standing in
  it is left alone — the pavement ends a chase, the street adds nothing
  (`test/node/kerb_refuge_sim.test.js`). Above a run (`util.js` speed helper,
  shared with egg hatching) nothing restores, pays or taps and foes ignore the
  player via `unnoticed`. `HabitatSpawns` allocates the base population from
  the winning landcover, Nexus or Road Variant profile before it chooses
  legal seats. Plain roads add no population. The beach path variant (`promenade`) owns
  its metal slimes in `pathFauna`, seated on its adjacent legal ground: one per 300 m of path cells, at most two
  per tile, with stable path-cell defeat identities. Ordinary beach and pier
  populations and other path variants contain no metal slimes. Road Variant `fauna`
  declarations supply local inhabitants.
  Where a species prefers to stand is an `attracts` column (road variant rows,
  `Zones.ZONE_KINDS`, `BIOME_ATTRACTS`, scenic themes and
  `Streets.PATH_LAMP_ATTRACTS`) read by `_seatFaunaOnFavouriteGround`. Each
  species declares an integer count range, currently `[2, 5]`: a seeded quota
  draws the nearest existing positioned animals by distance to actual eligible
  ground, with stable creature IDs breaking ties. Animals already on that
  ground count toward the quota. Each Nexus has its own quota; road families,
  scenic themes, walking-path lamp cells and terrain codes each use their
  tile-wide union. Relocation still respects habitat and the spawn gate,
  retains the original seat if no eligible destination exists, and never
  creates or recovers missing fauna. Evening Major/Medium traffic is a
  reversible presence overlay on generated ambient residents at their original
  seats (`EnemySpawns.busyRoadAllows`, using the existing surface-night
  threshold). It hides without relocation or replacement. Owned pets, summons,
  story residents and finite guards keep their separate lifecycle rules.
  SLOW is a reason inside `_bodyHold`
  fed by `entry.slowCells` (`StreetVariants.SLOW_KINDS`); a new slowing
  hazard joins that map, never a new movement gate. Top speeds are BASE
  numbers: ordinary wild gait, bolt, glide and flee speeds stay within
  `WILD_SPEED_CEILING_MPS` (creature_ai.js; `test/node/speed_ceiling.test.js`
  measures every lane). Retune the row, never add a cap; a hurry (the rout,
  a struck animal) never stacks on a bolt. The hunted crow's retreat hop
  (`CROW_DEPART_HOP`) is the base-speed exception, tied to the hunt's odds.
  Shiny creatures move at 1.5 times ordinary speed; escaping animals use
  1.3 instead. Apply the multiplier after the base pace, never cap it.
  Shiny HP and attack are doubled through `Combat.powerMul`; raised pets
  do not stack their shiny and adult strength bonuses. A shiny foe's elite
  rank (`Combat.ELITE_RANKS`, combat.md) replaces both factors with its row's.
  Whether a foe is an elite is `EnemySpawns.rollsElite`: the eligible kind,
  the id's shiny roll, and never within `ELITE_STAIR_CLEAR_CELLS` of a
  generated staircase (a seat by the stairs keeps its foe, plain; no extra
  draw). Every spawner that rolls elites asks it; a group's authored elite
  is the exception.
  A RETREAT among houses
  (a bolt, Home's rout, wandering off, a pet's shove) runs the ROADSIDE:
  `roadsideRunAngle` (creature_ai.js) bends the away angle along the nearest
  street on the creature's own side, and a retreat step never enters a yard
  (`yardReasonAt` — the gate's BEHIND_HOUSE / PRIVATE) it is not already in.
  A new retreat reason takes that bend, never its own steering
  (`test/node/roadside_run.test.js`).
- Promoted procedural backgrounds use `TerrainLayouts` (`src/terrain.js`) in
  both game and layout lab; `ZoneVariants.placement` caches the configured plan
  and samples it in the canonical POI frame, preserving empty-area reservations,
  spawn gates and per-cell identities through ordinary `ZoneDressing`.
- Mushroom groves use a Hilbert background with a 60:40 giant-to-small mushroom
  mix. Reduced material affinity distributes giant caps more evenly; the
  repeating 33-cell plan has 176 giant and 118 small mushrooms before exclusions.
  Its find guard is a mushroom monster too. The themed surface encounter lane
  scatters individual mushroom monsters across six-cell patches, with a seeded 60% presence roll
  per patch. Seats stay within grove coverage and obey the shared spawn gate,
  occupied cells, defeat ledger and Home protections; they are not shrine guards.
  `MushroomGas` also selects concealed emitters from the grove's existing
  mushrooms using stable plant IDs and the enemy spawn gate. Approaching one
  reveals it and releases a burst; remaining nearby permits another burst after
  sixteen foreground seconds. Picking or burning the plant stops its emission.
- A party meets bigger groups. Zone encounter groups
  (`EnemyHabitats.surfaceEncounterProfileSteps`) record how to make member
  `n` (kind, seat, body); `EnemyHabitats.scaleEncounters` grows them on each
  device to P, the highest party size observed for that encounter. Each device
  proposes the local player plus near peers on this depth (`Multiplayer.partyCount`),
  capped at 32; `group` frames merge proposals by maximum, so asymmetric peer
  rosters eventually agree. Offline P = 1 introduces no extras. A group
  of c ≥ 2 grows to c × (1 + 0.5 × (P − 1)), its fraction rounded up when
  `unit(`${id}:mp:${P}`)` falls under it; a single draws per extra player k
  on `unit(`${id}:mp:${k}`)`: under 0.5 it becomes the world's elite (shiny
  plus `Combat.rollEliteRank`) unless already one or ineligible, else it gains
  a member. Extras are `${id}_${n}` for n ≥ c, seated by the base members'
  own rule against the tile's finished generated occupancy plus the group's
  own extras (never other groups', whose extras arrive in any order), pass the
  spawn gate, are shared-marked and stay dead once caught. The count is sticky
  upward while the tile's entry lives. A rebuilt tile starts from the solo
  world, then reapplies any remembered or newly received encounter count.
  Only completed spawn passes may grow. Loaded encounters announce up to 32
  counts per second within the shared enemy-frame budget, oldest announcement
  first, retrying after ten seconds and on joins/reconnects. Received counts
  for unloaded encounters are bounded to 2,048 records and expire after five
  minutes without refresh; lower or duplicate reports never shrink a live
  encounter. Counts are keyed by encounter ID, surface only. Old clients ignore
  the new frames and retain their previous local scaling until refreshed.
  Garrisons (authored sizes), cave packs and roamers (two-pass canonical cave
  seating) and per-device mints do not scale
  (`test/node/multiplayer_shared.test.js`).
- Nexus coverage: `ZoneCoverage` owns the union of the influence footprint and the
  associated park footprint plus park fringe. Its ground and declarative layout
  (`docs/data/zone-variants.json`, `ZoneDressing`) replace ordinary terrain paint and
  ambient fill, including procedural residential yard trees; roads and buildings
  remain visible. Mapped and detected trees also yield to Nexus coverage,
  including its empty cells. Nexus painting and
  quarry coverage preserve all spawn exclusions, including PRIVATE and
  BEHIND_HOUSE; the shared gate still owns its existing POI-frontage exception.
  Gas-station influence uses the tar row’s own minimum and maximum radii.
  Cave generation retains the original ground,
  objects and spawn reasons so surface dressing cannot reroll entrances.
  A park's POI becomes its daily grove shrine in place, preserving its name
  and id. An eligible park polygon without a mapped POI receives a centred
  synthetic Grove anchor and the same Nexus coverage; concave outlines and
  holes use the nearest interior centre fallback. Clipped polygons retain
  coverage and their source-seeded theme, but cannot invent a whole-park
  centre or duplicate finite shrine/find/guard budgets. Ordinary PARK enemy
  definitions and the separate biting-plant scatter are removed; Grove
  variants own their inhabitants. Other Nexus chests keep `zoneNexus` and its
  tier bonus. No decorative
  props: every standing piece is interactable or a hazard, one art per
  interactable. Repeating backgrounds can thin selected materials with a
  deterministic `materialKeepChance`; fixed shrine slots and other materials
  retain their positions. Nexus mechanics use existing lanes (tar slow, lair tier,
  `ghostsHaunt`, coin-burst ledger, `_storySplashOnce`).
- Sacred Grove keeps its six-cell shrub/tree clusters, with visible pressure
  plates along the empty grid seams and deterministic breaks; shrine cells,
  authored routes and existing occupancy stay clear, and plates use the ghost
  spawn gate. `PressureTraps` raises one ordinary ghost on a grounded player
  step and stores the stable plate id in `save.pressedPlates`; its depressed
  frame survives reloads and tile regeneration without another summon. Flight
  does not press plates, and a refused ghost spawn leaves a plate unspent.
- L1 and the surface Nexus rows marked `caveIns` (the Seep and Black Ring tar
  pits) use `EnvironmentHazards` for hidden cave-in clusters of
  2–5 connected cells scattered across general eligible ground. Their seeds are
  cell-based and materialized on first contact. Any grounded entity (player,
  enemy, animal, pet or NPC) stepping onto a seeded cell starts the whole cluster's
  five-second warning: half-cell cracks, full-cell cracks, then black gaps from
  fallen chunks. Every cell passes the shared spawn gate and occupancy checks.
  Moving bodies sweep their accepted steps so crossing a cell triggers it too.
  AI uses the ordinary hazard detour lane once cracks are visible, and can escape
  the cell beneath it. Flight, including permanent natural flight, bypasses
  contact and avoidance.
  Opened clusters use the connected L1 floor-gap texture and remain permanent.
  `save.caveIns` retains warning progress and opened cells across reloads;
  foreground ticks own the clock. `HazardFalls` owns landing and descent,
  including floor seals and retrying unavailable landings. Temporary sinkholes
  do not compete with these clusters; existing L1 chasms remain unchanged.
  A grounded enemy, pet or charmed creature (`HazardFalls.fallsThrough`;
  never a flier, NPC or hired ally) that ends a creature tick over an open gap (opened cave-in,
  open sinkhole or L1 chasm — `HazardFalls.gapAt`) falls too
  (`HazardFalls.dropCreatures`): it leaves this floor and lands, by the same
  landing search, on the floor below when that tile is already spawned, or is
  gone this session otherwise. A fall is no kill: nothing enters `save.caught`.
  A fallen pet rejoins through `Companions.tickPets` catch-up.
- POIs that are no chest ride existing lanes too: a GATE is two posts round a
  spawn point (`WorldGen.gatePostsAt`, lairs.js `'gate'` tier — one foe a UTC
  day, `DAILY_TIERS`); an INFORMATION board reads a Book page like the
  waystone (`pageStone`); a bike rack's speed is a reason in the stick-walk
  lane (`_walkRelics` → `steerSpeedMul`); road furniture that is no place
  (`SX_NOT_A_PLACE`) mints nothing.
- Tile rebuilds replace the entry. Decide which state survives and which is
  regenerated; gate spawning on `entry._spawned`, not carried `creatures`.
  Do not cache a final answer from a tile still loading (no `layers` yet).
- Fetch tiles through `fetchTileResponse`, which resolves the live TileJSON
  template and retries resolution on failure. Bumping a dated fallback URL
  does not repair live fetching. After the centre is playable, surface rings
  prefetch at most three raw tile payloads ahead through `prefetchTileBytes`;
  decode, generation and spawning remain serial and sliced. Cache hits and
  retry backoff skip lookahead; a newer centre stops the older ring. Prefetched
  failures enter the normal tile failure path when their build turn arrives.
- Yield during tile-wide cell/object/polygon passes in `rasterizeTileSteps`,
  including helpers via `yield*`. Keep unsliced post-rasterize work linear.
  A profile's worst-block label identifies the block ending at that yield.

Tests: `world_frame`, `worldgen_dedup`, `traps`, `lairs`, `spawn_roads`,
`road_junctions`, `spawn_rebuild`, `tile_url`, `tile_build_blocks`, `street_variants`, `zones`,
`chest_tier`, `daily_crates`, `density_pois`, `spawn_class`, `guard_groups`
(`test/node/*.test.js`).

## Spawn precedence

Commercial default ground uses the shared hedge lattice for bushes and pot
pillars. Connection tuning belongs to `HEDGE_WALL_PCT` in `worldgen.js`; it
changes whole wall segments while preserving pillar spacing and open interiors.

Higher-priority placements and their access space take precedence in this order:

1. Saved player-owned objects, Home and story placements. Preserve saved ids and
   progress; a conflicting generated story placement finds a valid alternative
   rather than moving or deleting a player-owned object.
2. Building-related objects: entrances, building rewards and frontage objects.
3. Other place-specific landmarks: named viewpoints, wells, cave entrances and
   similar location-bound features. Incidental mapped trees, shrubs and poles
   are ambient fill, not landmarks merely because they came from OSM.
4. Nexus variants, including their deliberately empty layout cells.
5. Road variants, across their defined corridor and verge, including
   deliberately empty gaps. The claim reaches two cells past the road band
   (`StreetVariants.TERRAIN_VERGE_CELLS`): inside it the variant's ground
   replaces residential land cover and ambient yard fill. Generic roadside rocks
   belong only to normal (non-variant) streets and yield throughout variant
   coverage, even when sourced from the same road. The original rock substrate
   remains available for stable cave entrances. Buildings,
   piers and other land-access exclusions keep their paint. Nexus variants
   override road variants where they overlap; the physical road and its
   safety restrictions remain intact. Goblin Gang Street is a Small-road
   variant with compact sections up to 250 m. Per street key in a tile, six
   paired clusters target 30 breakable barrels and 30 goblin grunts (five
   per gang, in either difficulty). Fragments share that budget; blocked
   seats reduce the count. Barrels use the attractor gate, and gang posts
   and their guards retain the fast-enemy spawn gate.
   Overgrown forest roads additionally roll a one-third chance of a Giant Bear
   from their stable street key. Selected streets attempt one finite bear post
   per owning tile, alongside the usual plant guard. Geometry fragments share
   the post; occupancy and the fast-enemy safety gate can prevent placement.
6. Ambient fill: ordinary plants, rocks and generic scattered content.
   Forest landcover scatters pine only; wooded park characters scatter maple
   only, from their `BiomeProfiles` rows. Both mark `treeSpeciesFixed` so
   the near-home softwood overlay preserves their habitat. Species changes
   do not consume random draws or move trees. Residential yards keep their
   mixed maple/pine selection. Imported ordinary trees on forest cells become pine.
   Authored park/Nexus coverage already excludes imported trees and keeps
   its own tree choices; fruit trees keep their species. Outside forests,
   mapped trees retain their original mix.
   Tree-bearing street variants declare their timber species on the variant
   row: Overgrown uses pine and Orchard uses maple alongside its fruit trees.
   Street timber also marks `treeSpeciesFixed`, so its type stays consistent
   through the starter area. Unfixed trees keep the existing near-home pine rule.
   Residential yard trees are the newest ambient fill: while the DeepForest
   layer is paused (`DEEPFOREST_TREES_ENABLED`), each residential polygon
   seeds random-sized trees from the `T.RESIDENTIAL` `yardTrees` row
   (`BiomeProfiles.yardTrees`). They seat after every older object and wild
   plant, obey the residential spawn gate like the yard flora, and yield
   their cell to any mapped or detected tree from the tile bin.

- Hard terrain, land-access, road-safety and accessibility rules are prerequisites,
  separate from priority. Higher priority does not bypass them. Any authored
  terrain-carving exception must be explicit and confined to its existing rule.
- Resolve area ownership before ambient fill. All lower-priority producers,
  including later scenic, Overpass and runtime passes, respect the same full-area
  reservation. Protecting only occupied object cells is insufficient: a variant's
  empty lanes belong to it too. A higher-priority object can occupy a variant
  area; its presence does not release that area to ambient fill.
- Area ownership and object occupancy are separate. Inside the winning area,
  objects still obey collision and access rules. Reserve a large object's entire
  declared footprint (a 3 × 3 shipwreck is one interaction), not just its anchor.
- Authored guards, finite finds, shrine gifts and tide pickups belong to their
  declared feature and retain their own budgets and placement rules. Generic
  traps, treasure and rooted enemies respect variant exclusions; a variant's
  own content does not use the ambient-fill veto. Fauna retain their intentional
  ability to share interactable cells and their terrain/road restrictions.
  Nexus coverage also excludes ordinary beach bottles, tide reservations and
  generic fauna. Within it, `HabitatSpawns` supplies the variant's declared
  fauna; arrangement stays within the winning owner. Underlying landcover
  and generic shoreline rules do not supply an additional population.
  A path crossing a Nexus retains its own path-generated content; this
  exception never admits ordinary road or biome spawns.
- Resolve equal-priority generated claims using stable world-space feature keys
  and buffered geometry, never iteration order, tile-load order or save state.
  Apply saved-player changes as overlays without rerolling the generated world.
  If an authored footprint cannot fit, use its deterministic eligible fallback
  or report a shortfall; never spill it into forbidden or higher-priority space.
