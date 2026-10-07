# Generation, saves and spawn precedence

Detail doc for world generation, saves and placement precedence. The root
`CLAUDE.md` owns the overview; read this before changing generation, spawn
access or tile lifecycle mechanics.

## Generation, saves and tiles

- Spider webs save their absolute cell, world position, depth and wall-clock
  expiry in `save.spiderWebs`. They survive reloads and tile eviction until
  24 hours after landing; another shot refreshes that cell without duplicating
  it. Silk in flight is transient and is cleared when depth changes.

- Do not add save/data compatibility migrations until the user requests them.
  Retired save formats may be discarded; keep current-state defaults, validation
  and runtime cleanup separate from compatibility conversion.

- Farmland and golf-course no-spawn exclusions apply at every dungeon depth.
  `WorldGen.SPAWN_WHY_ALL_FLOORS` owns the inherited reasons; `floorSpawnWhy`
  derives them from immutable surface evidence. Preserve that mask through cave
  generation and runtime spawns; repainting or digging never grants spawn access.

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
  `docs/design/floors.md` owns the per-floor catalog.

- A per-floor rule - rope seals, fall seals, hazards, lighting levels - reads
  one owning table keyed by floor, never a depth literal at a call site.
  `WorldGen.floorProfile(depth)` owns cave terrain, street projection and gem
  probabilities, authored cave-area weights/carving/garrisons, pressure traps,
  arrival story IDs and entry keys. Keep story copy in the presentation module;
  choose its story through the profile. Depths beyond the explicit rows inherit
  the default profile, including the infernal entry key.
  `DungeonProgression.ROPE_SEALED_FLOORS` is the pattern (the rope, the
  sinkhole minting and the fall check all read it); lighting already derives
  its per-floor ambience from depth (`Lighting.profile`, `litDim`).

- Generate the world deterministically; save player changes as id sets and
  player-placed objects in full. The starting area is also stored explicitly.
  Each spawner owns a seeded RNG stream so adding one does not reroll others.
- A POI chest's tier is its tile's QUOTA SEAT (`WorldGen.seedChestTiers`):
  each tile seeds ~1 T5, 5 T4, 11 T3, 18 T2 (x1..x2 over 100..1000
  budgeted POIs) onto its best-ranked POIs (the MVT `rank` tag),
  round-robin across chest categories; everything else is T1. Vista chests
  are fixed T5 outside the budget; a Nexus chest can win a seat without
  spending one (+1 on top). Each underground floor re-seats its own pyramid over
  its mirrors (the rank rides down), and the cap CLIMBS underground
  (`loot.js chestTierMaxFor`: T6 from depth 3, T7 from 6) while the depth
  bonus stays `+floor(depth/2)`. Unseeded chests (hand-placed, sandbox) are
  the unstamped T2 - the old count ladder is retired, and `o.poiDensity`
  now only feeds restock days and the pots of gold. Breakable pots and
  barrels select their loot by stable appearance (`barrelProfile`), not
  density.
- THE LOW-TIER QUOTA: a tile below `WorldGen.LOW_TIER_CHEST_QUOTA` (200)
  tier-1 chests tops up with ambient crates (`topUpAmbientCratesSteps`,
  after the variant top-up): one-time tier-1 crates on 'reward' cells, lowest
  cell hash first. Its shortfall (`entry.lowTierDeficit`) also lays extra X
  marks in proportion (scene_creatures.js `X_TOP_UP_MAX`), drawn off the cell
  hash so the tile's rng stream never shifts. Mine mouths ignore ambient
  crates and drop any they land on.
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
  to 7 for a class crowding its tile); pots of gold, bike racks, chapels and
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
  never ours to reopen on a data coincidence). Every spawner calls
  `WorldGen.isSpawnCell(grid, w, h, cx, cy, opts, cls)` with `_spawnOpts`
  (`spawnWhy`, `roadMask`, `occupied`) AND its class (the source sweep in
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
  barricade/spike lines also cross their own Major or Medium road band
  and kerb buffer. All keep
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
  player via `unnoticed`. Where a species prefers to stand
  is an `attracts` column (road variant rows, `Zones.ZONE_KINDS`,
  `BIOME_ATTRACTS`) read by `_seatFaunaOnFavouriteGround`: relocate existing
  spawns, never add, each species on its own stream. SLOW is a reason inside `_bodyHold`
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
  do not stack their shiny and adult strength bonuses.
  A RETREAT among houses
  (a bolt, Home's rout, wandering off, a pet's shove) runs the ROADSIDE:
  `roadsideRunAngle` (creature_ai.js) bends the away angle along the nearest
  street on the creature's own side, and a retreat step never enters a yard
  (`yardReasonAt` — the gate's BEHIND_HOUSE / PRIVATE) it is not already in.
  A new retreat reason takes that bend, never its own steering
  (`test/node/roadside_run.test.js`).
- Mushroom groves use the themed surface encounter lane to scatter individual
  mushroom monsters across six-cell patches, with a seeded 60% presence roll
  per patch. Seats stay within grove coverage and obey the shared spawn gate,
  occupied cells, defeat ledger and Home protections; they are not shrine guards.
  `MushroomGas` also selects concealed emitters from the grove's existing
  mushrooms using stable plant IDs and the enemy spawn gate. Approaching one
  reveals it and releases a burst; remaining nearby permits another burst after
  eight foreground seconds. Picking or burning the plant stops its emission.
- Nexus coverage: `ZoneCoverage` owns the union of the influence footprint and the
  associated park footprint plus park fringe. Its ground and declarative layout
  (`docs/data/zone-variants.json`, `ZoneDressing`) replace ordinary terrain paint and
  ambient fill; roads and buildings remain visible. Nexus painting and
  quarry coverage preserve all spawn exclusions, including PRIVATE and
  BEHIND_HOUSE; the shared gate still owns its existing POI-frontage exception.
  Gas-station influence uses the tar row’s own minimum and maximum radii.
  Cave generation retains the original ground,
  objects and spawn reasons so surface dressing cannot reroll entrances.
  A park's POI becomes its daily grove shrine in place, preserving its name
  and id. Other Nexus chests keep `zoneNexus` and its tier bonus. No decorative
  props: every standing piece is interactable or a hazard, one art per
  interactable. Repeating backgrounds can thin selected materials with a
  deterministic `materialKeepChance`; fixed shrine slots and other materials
  retain their positions. Nexus mechanics use existing lanes (tar slow, lair tier,
  `ghostsHaunt`, coin-burst ledger, `_storySplashOnce`).
- Strip mines and L1 use `EnvironmentHazards` for hidden cave-in clusters of
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
  does not repair live fetching.
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
   replaces residential land cover and ambient yard fill, while buildings,
   piers and other land-access exclusions keep their paint. Nexus variants
   override road variants where they overlap; the physical road and its
   safety restrictions remain intact.
6. Ambient fill: ordinary plants, rocks and generic scattered content.

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
  generic fauna. Within it, only the variant's declared fauna and `attracts`
  row can add or attract animals; underlying shore/terrain rules do not apply.
- Resolve equal-priority generated claims using stable world-space feature keys
  and buffered geometry, never iteration order, tile-load order or save state.
  Apply saved-player changes as overlays without rerolling the generated world.
  If an authored footprint cannot fit, use its deterministic eligible fallback
  or report a shortfall; never spill it into forbidden or higher-priority space.
