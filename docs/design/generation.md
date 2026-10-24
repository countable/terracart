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
  Underground floors do not generate ambient rabbits.
  L7 ambient encounters use the dragon floor habitat: four parts red dragon
  to one red demon, within the existing deterministic population budget.
  Deeper roost habitats retain one fixed dragon seat per region.
  Rabbits have ordinary surface populations. Cat exclusion from Wasteland, Deer restriction
  to Forest/Residential, and Butterfly exclusion from Forest/Orchard remain
  species placement limits.
- Shore length is a specialized ambient budget outside Nexus coverage. Every
  Nexus keeps its own declared inhabitants and excludes generic shoreline
  top-ups, including after captures. Safety only removes destinations;
  `entry.shorePopulation` records placement shortfalls.
- Beach encounter tables retain their declared species mix, but Excluded water
  cannot receive creatures, coral scenery or reef treasure, even with shore reach
  or a water-only placement profile. Dry-shore inhabitants, ore and the reef
  shrine still use the shared tier gate. A refused aquatic candidate leaves a
  shortfall rather than moving onto land or borrowing another species slot.
- Mystic Reef's rounded stone-and-shell clusters replace their flowers with
  one-cell tidepools. The ordinary finite find becomes another guarded pool.
  `ZoneDressing` carves only eligible dry cells, retains a dry perimeter and
  reserves an empty cardinal bank; existing water, buildings, roads, paths,
  occupied ground and access exclusions cannot be carved. Each generated
  pool's `zoneDress.fishStock` policy guarantees one initially stocked T3+
  species through the ordinary `fishSpotStocked`/`spotFish` helpers. Rod catch
  odds still apply, escapes keep the fish, and a landed fish remains depleted
  through the existing `save.fishedSpots` ledger. Shiny sightings use the same
  stock policy as the cast.
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
  Ordinary ruin guards use the street-facing doorway selected by
  `BuildingLowPoly.streetDoor`, matching building rendering. Seats stay within
  three cells of the doorway and before the street, subject to the normal
  spawn gate. A blocked frontage drops its guards instead of moving them behind
  the building. With no detected doorway, the existing ring remains. Fort and
  castle core/roof formations keep their authored seats.
- Triggered bush fauna and ambient haunting consult the owning habitat. Headstone
  ghosts, starter/story creatures, crop pests, saved pets and summons remain
  feature/progression/player-driven exceptions; all placement still uses the
  shared gate. Hazards such as vents and whirlwinds retain their own system.
  Whirlwinds form and wander only on plain GRASS, PITCH and SCHOOL cells
  (never park, playground or a Nexus zone's terrain) that a landcover, landuse
  or park polygon mapped (`entry.mappedLand`: unmapped ground defaults to
  GRASS and is mostly the gaps between houses), and never within
  `HomeArea.isNear` of the start; a Scroll of Wind gust is not bound by these.
  In the local gusty hours (`Whirlwinds.CONFIG.gust`) one likelier roll raises
  a spaced group of several.

- Cave ambient enemies use stable request IDs: packs end in `pack_<ordinal>`
  and roamers in `roam_<blockX>_<blockY>`, after the depth/tile prefix. Their
  identities and species remain fixed when safety relocates their seats. A
  raw-floor compatibility pass assigns historical cell aliases before safety;
  each alias belongs to one request, so old defeats neither resurrect relocated
  foes nor suppress multiple enemies.
- Rendering and simulation use `EnemySpawns.isSurfaceResident`, including
  habitat-only residents without ordinary roster metadata. Evening suppression
  is reevaluated after dusk and dawn, including specialized Metal Slimes.

## Authored preview sandboxes

- `SandboxScenarios.build` converts a versioned semantic cell matrix and explicit
  prop/creature placements into ordinary tile entries. `FloorSandbox.writeScenario`
  uses the same session-storage transfer, installation and disabled-save path as
  the floor viewer. Producers own layout generation; the adapter does not reroll
  terrain or ambient populations. Creature IDs derive from scenario, mode, seed,
  species and cell. Restarting reloads the same authored snapshot.
- Scenario cells become real terrain (including actual water and lava), with a one-cell
  rock boundary and square padding. Player starts on dry, unoccupied ground.
  Creatures use the normal factory; preview props are decorative `sandboxprop`
  objects with supplied art. Explicit `pushable: true` blocks use `PushBlocks`: tap
  from a cardinally adjacent cell to push one cell into clear, loaded, dry ground.
  They block walking, never chain-push, fill water or repaint terrain, and retain
  their identity/art when moving across tile boundaries. Positions last for the
  sandbox session and reset on reload. The cardinal destination rule is shared
  with temple block trials. Other preview props remain decorative.
- Bounded PNG/WebP/JPEG data URIs travel with the snapshot; the art manifest and
  semantic cells let the renderer reuse floor-specific preview art. Dimensions,
  placements, payload and image sizes are checked before storage. The return URL
  is HTTP(S) only. Scenario loads suppress automatic Home placement/clearing, Home variants,
  normal spawns and unrelated depth generation; ordinary floor-viewer transfers preserve their existing behavior.

## Generation, saves and tiles

- Fresh players start with zero coins in every mode, including sandbox. Mode
  selection never changes the purse, and sandbox fixture reloads never grant
  coins. Loading an existing save preserves its earned balance.

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

- School fields carry denser wild grass plus common PetNip and rarer
  Nettle, with densities owned by `BiomeProfiles`. Plain Small-road verges
  sample herb seats on both sides every 21 metres; PetNip is the common roll,
  Nettle the rare one. The ordinary spawn gate excludes unsafe seats, road
  nexuses and themed stretches. Both herbs use the standard wildplant harvest
  lane; PetNip feeds pets and Nettle supplies the Home Growth Powder recipe.
  The same roll grows a bush above the herb band (`PLAIN_BUSHES` in
  `street_variants.js`; 8% shrub, 2.5% berry, 1.5% poisonberry of the
  seats): mostly ordinary shrubs, with berry and poisonberry bushes mixed
  in, still fewer than the herbs.
  Residential verges instead keep PetNip uncommon at 12% of eligible seats.
  Its excess former seats become clipped hedges, keeping the total greenery
  density and rarer Nettle placement unchanged.

- Every house fronting a plain (unthemed) Small street stands 0-2 loot barrels
  (`HOUSE_BARREL_ODDS`: 50% none, 40% one, 10% two)
  on the verge before it, clustered side by side a cell back from the kerb
  (`StreetVariants.dressSteps`, the house barrels pass; `HOUSE_BARRELS_MAX`,
  `HOUSE_FRONT_REACH_CELLS`, `HOUSE_FRONT_SPAN_CELLS`). They are always
  wooden barrels (`barrelStyle`); clay pots belong to Pottery Road. A house is a run of house-tier building cells a
  ray out from the band's edge reaches within five cells; forts, castles and
  another road in the way end the ray. The count is a hash of the tile and
  the house's first wall cell, so every player sees the same; a terrace counts
  a house per frontage span. Seats take the first free verge cell out past
  the kerb cell, on the reward gate, so none stands on a Major-and-Medium
  kerb; the kerb cell itself is the last resort for a one-deep frontage.
  Themed stretches and Major roads stand none. A generated barrel is not a
  place: it draws no POI pad (`render.js`, the pad pass); a bin POI (a waste
  basket or recycling point) wears the full pad (`padShapeKeyForPoi`). One seat in ten (`HOUSE_CRATE_SHARE`, a hash
  of the seat) stands a tier-1 restocking crate instead of a barrel.

- Cleared wild longgrass, the wild herbs (the wild flowers, PetNip and
  the nettle) and the picked berry and poisonberry bushes (the rows of
  `SaveState.WILD_REGROWTH`, read through `SaveState.regrows`) return after
  an independently sampled exponential wait averaging two real days
  (`SaveState.GRASS_REGROWTH_MEAN_MS`, every row's mean today). A crop grows
  back by having a row; the mechanism is one. A picked berry bush stands as
  a bare bush meanwhile (`WILDPLANT_RULES` `pickedCrop`) and fruits again
  when its id leaves `picked`; the golden berry bush has no row.
  Harvest records the deadline in `save.grassRegrowth`; normalization and
  the ten-second save heartbeat remove expired ids from `picked` /
  `burnedObjects`. Deadlines persist across reloads and run while offline.
  Generated plants stay in their tile lists, so the ordinary spent-state
  renderer reveals regrown plants without rerasterizing. The heartbeat
  discovers already-cleared plants from older saves in nearby loaded chunks
  and starts their clocks on that visit; ids cannot safely be inferred from
  prefixes shared with other crops. Player-owned plants and all other cleared
  objects (bushes, berries, barriers) retain their existing rules.
- Picking a wild berry records its original id in `save.picked` as usual,
  but leaves the same bush at that location, with only its berries removed.
  Mature berry bushes use the ordinary bush frame and scale; a texture baked
  once at scene creation adds the berries without changing the foliage. The
  `WILDPLANT_RULES.pickedCrop` render view survives reloads without another
  save field; the remnant is scenery, not another berry or wood reward.
  Burned bushes/ground stay cleared. Farmed crop harvesting is unchanged.

- Do not add save/data compatibility migrations until the user requests them.
  Retired save formats may be discarded; keep current-state defaults, validation
  and runtime cleanup separate from compatibility conversion.

- Surface gameplay tiers apply at every dungeon depth. Each floor inherits the
  immutable surface tier field with its access reasons; digging and floor paint
  cannot reopen Excluded ground or remove Passing restrictions. Live terrain and
  occupancy are checked on the current floor. `floorSpawnWhy` preserves the
  source evidence, and cave source snapshots carry the tier field alongside it.
  Underground tiles retain road geometry for chase boundaries, warnings and
  night-road hiding/drain. Farm and orchard interiors and golf grounds retain
  their source access restrictions. Eligible field rims remain measured from
  source footprints; roads, POIs and later paint cannot create interior edges.

- L3 fills eligible ground between authored areas with connected goblin-warren
  rooms (`CaveAreas.planCity`, configured by `floorProfile(3).warren`).
  Shared walls have two-cell doors; clipped rooms retain open rims, and route
  clearings, landmarks and stair approaches stay clear. The city owns its empty
  ground so ordinary rock scatter cannot refill its passages. Room encounters
  use stable IDs and the class-specific safety gate; finite stores share the
  existing cave-container budget. The drill budget is placed before the city.

- L3 pressure plates are subtle floor marks, visible only within one cell of
  the player's body. Stepping on one triggers its paired rolling ball, spike
  wall or gas grate once per encounter. Gas grates stay inert until pressed,
  then emit the existing poison/paralysis gas burst rather than a periodic
  geyser eruption. City passages may host traps despite the city's ambient
  reservation; actual objects, landmark approaches and the hazard safety gate
  still exclude placement. Grove ghost plates retain their existing visibility.

- L2 carries the natural cave profile previously used on L1: its authored
  areas have no goblin warrens, and `generationDepth: 1` preserves the original
  anchor selection and deterministic slot ordering. L1 sewer has no authored
  natural areas. Physical-depth encounter, ore and travel progression remain
  unchanged by this wall update; saved object IDs still include actual depth.
- Authored cave areas use `ZoneVariants.anchorFrame` and run before ordinary
  floor passes. Keep their empty-ground reservations separate from object
  occupancy (`CaveAreas`); ambient spawns must respect both. Derive deeper
  floors from `geologyGrid`, before authored terrain changes. Ordinary cleanup
  and gem conversion must leave `caveArea` pieces intact. Authored warren
  stores spend `WorldGen.caveContainerBudget` before ambient barrels.
  Dungeon mazes on floors 2–3 repeat the reviewed 34 × 33 braided wall mask
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
  On L2, only Small roads become road-derived cave walls; Medium/Large roads
  and paths remain open terrain. Route projection cannot carve the L2 Small-road
  walls. Buildings and water retain their existing wall mapping. L4 carves
  surface road footprints (including paths) plus a one-cell buffer into
  connected tunnels, preserving surrounding deep stone and eligible public
  clearings. `floorProfile(4).roadTunnelBufferCells` owns the clearance;
  physical road masks retain wider carriageways, with terrain routes as a
  fallback. Tunnels do not become settlement clearings or surface street
  overlays. Open terrain
  does not relax inherited spawn safety.
  `docs/design/floors.md` owns the per-floor catalog.

- Player movement permits wading through actual water on every floor, including
  sewer scenarios. This does not change `WorldGen.isWalkable` or spawn safety:
  land creatures and ground drops still avoid water. Cave walls remain solid.

- A per-floor rule - rope seals, fall seals, hazards, lighting levels - reads
  one owning table keyed by floor, never a depth literal at a call site.
  `WorldGen.floorProfile(depth)` owns cave terrain, street projection and gem
  probabilities, flint-bearing rock frequency, authored cave-area weights/carving/garrisons, pressure traps,
  the vent kinds a floor erupts,
  arrival story IDs and entry keys. The terrain ladder is sewer 1 (building walls), natural caves 2 (the old
  L1 mask read directly from the surface), goblin city 3, deep-stone clearings and road tunnels
  4, open fungal 5, lava 6, and dragon masonry 7–8. Lava and dragon strata
  read surface geometry directly; an open fungal floor must not erase lava
  footprints. Lava building cells are ground-level `CAVE_LAVA`, not rockwalls.
  Clearing rewards carry the receiving depth; biome tints follow the profile.
  Keep story copy in the presentation module;
  choose its story through the profile. Depths beyond the explicit rows inherit
  the default profile, including the infernal entry key.
  `DungeonProgression.ROPE_SEALED_FLOORS` governs rope descent, sinkhole and
  authored cave-hole minting, and both fall checks; lighting already derives
  its per-floor ambience from depth (`Lighting.profile`, `litDim`).

- Flint Field's central disk contains mineable flint-bearing rocks instead of
  loose pickups. Visible flint seams yield stone and one guaranteed flint.
  L2 marks a quarter of ordinary ambient rocks as flint-bearing using stable
  rock IDs and `floorProfile(depth).flintRockP`; placement and ore rolls retain
  their existing seeded streams. Other floors and loose tar-zone flint keep
  their existing rules.

- Generate the world deterministically; save player changes as id sets and
  player-placed objects in full. The starting area is also stored explicitly.
  Each spawner owns a seeded RNG stream so adding one does not reroll others.
  Weighted draws share `weightedPickAt`; adapters retain their RNG consumption,
  exact boundary comparisons and zero-weight fallback to preserve seeded worlds.
  Placement occupancy uses `PlacedFloor.indexAt` for crops and placed objects;
  surface-only tilled cells must not block placements on other floors.
  `Crops.reconcileTilled` checks saved surface plots after tile loading and
  crop raids, using `isTillableCell` for terrain, roads and lamp footings.
  Unloaded plots and plots with a live surface crop retain their soil. Invalid
  empty plots lose both their tilled marker and bed quality through the saved
  set binding; rendering never repairs farming state.
  Barricades are tier-2 supplies found in supply/field loot or supply shops.
  Finding one unlocks its workbench recipe: three wood makes one barricade. Select
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
  The same containment census exports `entry.retailInteriors` for buildings
  containing at least two distinct public commercial POI positions (using
  `commercialPoiKind`), including smaller strip centres with no area/depth
  minimum. Private offices, coincident duplicates and courtyard pins do not
  supply booths. This rendering metadata preserves all source polygon rings
  and holes in absolute world-frame metres, with global-MVT geometry keys
  stable across buffered copies and save scales. It does not change frontage
  placement or the enclosed-mall classification. Entering a footprint uses
  the shared Home interior floor and outside-darkening engine; courtyard
  holes remain outside.
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
  chance and a 15-coin budget. Both interpolate linearly between endpoints. Items
  size to that budget; a clay pot's coin result pays a fifteenth of it
  (`CLAY_POT_LOOT` `budgetDiv`: 1 coin at 15, 5 at 75).
  Generated non-POI containers keep the table's 45% full odds and a 15-coin
  budget, where about a quarter of smashes pay the signature find: a barrel's
  one apple, a pot's one coin (`BARREL_LOOT` / `CLAY_POT_LOOT`). Full
  containers pay that budget as coins or use `ChestThemes.quantityForBudget`
  for item stacks, including category shares and caps; higher budgets never
  promote item tiers. All containers remain permanently smashed after use.
- The Ring of Gathering draws loose coins gradually toward the player;
  `COIN_COLLECTION` owns the pull speed and arrival distance. Collection pays
  only on arrival and preserves the generated coin’s one-time ledger.
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
  lead to the nearest unopened T2+ surface chests and unfound, uncovered X
  marks within `CHEST_TRAIL_RADIUS_CELLS` of the player, anywhere on the
  surface; crates never get one. The line is faint dashed black ink (`Starter.TRAIL_STYLE`).
  Each frame clips the cached route to the player's distance from its treasure
  (`behindCells`, 0: no slack beyond the feet): the line recedes ahead of
  approaching feet and returns when walking away. Segment clipping preserves dash positions and
  separate visible stretches, without adding pathfinding as the player moves.
  The chest at a trail's end rolls `CHEST_TRAIL_TIER_BONUS` tier higher, within
  its depth cap; an X at a trail's end (`Starter.isTrailTreasure`) shows and
  digs without waiting for the feet to stand beside it.
- Each Pilgrim's Way street key owns one tile-local set of 3–6 waystones.
  Stable cell hashes choose a compact cluster on safe verge cells, within ten
  cells of its anchor and without crossing an arterial. Geometry fragments
  share the set; fewer than three legal, spaced seats produces no puzzle.
  Each stone carries `waystoneSet` and the actual `waystoneCount`; all seats
  are claimed together before later ambient dressing. Grounded feet light a stone
  for `Waystones.LIGHT_MS` and toasts the set's progress (“2/5 waystones
  lit”) in the centred viewport toast; tapping an unlit stone says “closer...” and grants
  no lore. All members must be lit simultaneously. Completion lives in
  `save.waystoneSets`, leaves every member permanently lit, and saves one T3
  chest beside the player. Unopened rewards are restored after tile reloads;
  if nearby legal cells are full, the completed set retains a pending chest
  until a safe seat is available. Temporary lights use `save.waystoneUntil`.
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
- Geographic spawn eligibility comes from `GameplayTiers` in
  `src/gameplay_tiers.js`. The tile's `gameplayTiers` field and its reasons are
  shared by generation, runtime births and map review. The classifier uses
  source geometry and access evidence, then resolves overlaps in one place.
  Within one rasterization, `prepareTileSteps` builds source polygon, path,
  road and junction masks once. Both tier passes reuse that temporary geography;
  each applies current Nexus coverage and access/lot masks to fresh output
  arrays. Prepared masks belong to that build, never a persistent tile cache.
  Street surfaces take precedence over surrounding zones: medium/large streets
  are Excluded, ordinary small streets are Calm, and small dead ends are Passing.
  Old Stones coverage includes its absorbed adjoining parking lots as Calm;
  other parking lots are Passing. Mapped school, college, university and education
  grounds qualify as Core recreation ground without a separate park polygon or
  school-hours check; buildings and explicit access/land exclusions still apply.
  Missing qualifying evidence is Excluded.
- Core mapped paths include a one-cell band beyond their edges. They interrupt
  Passing buffers around medium/large roads and intersections, but cannot open
  an Excluded road surface or restricted ground. Intersections receive a wider
  Passing buffer than ordinary road stretches. Buffer dimensions belong to the
  classifier; renderers and spawners consume its result.
- `WorldGen.isSpawnCell` is the sole placement gate. On classified tiles it
  checks the tier policy before live terrain, occupancy and building clearance.
  Excluded refuses every spawn. Passing refuses fast creatures and hazards;
  Calm and Core use the shared class policy. A small street or path no longer
  fails solely because the old road footprint covered its cell. The source
  `spawnWhy` bits retain access evidence and diagnostics rather than acting as
  a second geographic policy on classified tiles. Synthetic fixtures without
  source geometry derive tiers from their explicit terrain and reason evidence,
  then use the same permission table.
- Every static spawner passes its class to `WorldGen.isSpawnCell`; creature
  producers call `CreatureSpawns.isSpawnCell` or `gateAt` with the kind. Creature
  classes derive from the roster and speed tables. Runtime summons, restored
  creatures and generated placements use the same tile field. A new geographic
  rule belongs in `GameplayTiers`, not in a spawner. Occupancy, habitat choice,
  finite encounter budgets and live building clearance remain placement rules.
- Excluded ground uses permanent `EXCLUSION_ROCK`, which blocks player movement
  and cannot be mined or tilled. Medium/large road surfaces remain visible roads
  while refusing every spawn. Water and building footprints retain their
  physical surfaces and remain Excluded. Building ownership protects house/footprint
  cells even if their terrain was repainted. Tier classification precedes final placement so
  a rejected cell cannot retain an object from an earlier placement pass.
- Source access evidence still records private/restricted/quiet land, sensitive
  sites, kindergarten grounds, public pier access and farm/golf restrictions.
  `SPAWN_WHY` preserves those source reasons for inspection. Geographic decisions
  consume them centrally through the tier classifier. Villagers retain the live
  building moat, and newly stamped buildings invalidate placements beneath them.
- Place-bound producers, including POI chests and authored road cross-sections,
  share the same Excluded and Passing policy. Authored seats retain their own
  layout and habitat requirements, but cannot reopen an Excluded cell. Street
  obstacles, including tar pits and stakes, count as hazards when applying
  Passing restrictions. Their record classes also govern cleanup and live
  replay, so rejected slowing debris cannot become an active slowdown later.
- The live Overpass fence veto (`privateVetoAt`) is for per-player
  things only and fails open when no successful mask is known. Its last known
  mask stays active during a background refresh or outage; successful masks
  stay fresh for 30 days. Overpass decoration bins are cached indefinitely.
  Both query kinds share persistent per-endpoint cooldowns: one hour after
  failure, six hours after HTTP 429, or a longer server `Retry-After`.
  Memory caches preserve successful and negative results if IndexedDB is
  unavailable, and concurrent callers share the cache read and request.
  Partial Overpass responses never replace successful data. These optional
  requests run in the background and never gate base map geometry.
  Road terrain alone misses drawn roads; the mask uses
  `WorldGen.roadOverlayWidthM` and masks cells when the drawn bands cover
  `WorldGen.ROAD_MASK_MIN_COVER` of their area. Static rewards use the tier
  gate, including Passing. Every timed reward (coin bursts, bounty packs,
  `findWalkableDestination`) stays on the player's SIDE of any MD/LG road
  (`sameSideField`, creature_ai.js) — nothing urgent across a Major or Medium road.
  L1 sewer uses the base ambient snare count (6–10 attempts per tile), rather
  than the deeper floors’ 100× multiplier. The game and floor viewer share this
  floor-profile setting; retained traps keep their seeded positions and IDs.
  The floor viewer alone previews L2 at its base snare count (7–11 attempts
  per tile); gameplay retains the deeper-floor multiplier.
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
- A mapped parallel roadside path removes the night zone on its side of an
  MD/LG road, along the path’s length and within the existing kerb buffer.
  `ROAD_CLASS_PATH_SIDE` preserves creature suppression while the shared
  `nightZoneBits` check excludes the wash, hidden interactions and drain.
  The walking-path footprint itself (`ROAD_CLASS_PATH`, at least one cell wide)
  clears every overlapping night zone, including crossings and grade-separated
  paths. Off-path carriageway cells and buffers without a same-level parallel
  path on their side remain dark. Private or inaccessible paths grant neither
  exemption. Road warnings retain their geometry; spawn eligibility uses tiers.
- Parking footprints feed the tier classifier. Mapped polygons supply their
  exact footprint; retained tagged/inferred aisles use the lot detector's 12 m
  radius, and non-streetside parking POIs its 30 m radius. Lots are Passing,
  except coverage absorbed by Old Stones, which is Calm. A Quarry repaint keeps
  the parking tier. `ROAD_CLASS_LOT_BUFFER` remains available to the independent
  movement and night-road rules; a lot alone does not acquire the night zone.
- The road is never a refuge and never a lure. `roadClass` derives all safety
  geometry from the vector bands. `ROAD_CLASS_MAJOR_ROAD` marks an MD/LG cell
  only when that group covers at least half of it, which gives runtime warnings
  the same threshold as `roadMask`. Junction bits remain movement geometry:
  `ROAD_CLASS_JUNCTION_EXCLUDE` marks an MD/LG junction's overlap plus 2 cells,
  and `ROAD_CLASS_JUNCTION_SOFT` marks a Small-road junction plus 1 cell.
  Bridge, tunnel and causeway crossings do not create ground-level junctions.
  Spawn eligibility reads the tier field instead: junction surroundings are
  Passing, paths can interrupt them, and the MD/LG street surfaces are Excluded.
  Existing movement rules retain their kerb geometry (`ROAD_CLASS_MAJOR_BUFFER`):
  no hostile steps onto the band, no fast mover enters the buffer, and a player
  standing in it is left alone - the pavement ends a chase, the street adds nothing
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
- Formal Garden uses four clipped hedge arms around concentric pale-flower
  and orange rings in an eight-cell parterre. Formal and Hedge Gardens use
  connected hedge art from the surviving cardinal shrub neighbours.
- Orchard motifs retain their apple and maple seats; seeded grass scatters into
  unoccupied motif cells with distance-weighted attraction to those trees,
  measured across motif seams. Grass becomes sparse in the open aisles.
- Mushroom groves use a Hilbert background with a 60:40 giant-to-small mushroom
  mix. Reduced material affinity distributes giant caps more evenly; the
  repeating 29-cell plan has 133 giant and 89 small mushrooms before exclusions,
  keeping its clearings smaller than the former 33-cell plan.
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
- Spooky Woods is a selectable wooded Grove variant. It keeps Ancient Grove's
  living tree clusters, brambles, harvestable grass, stone trail and guarded
  starflower, adding bare harvestable trees only in the existing shrine tree
  seats. These use the ordinary tree identity, save ledger and shared spawn
  gate; they are not extra decorative pickups. Dark olive soil covers eligible
  Grove ground without altering roads, buildings or exclusion ownership.
- Nexus coverage: `ZoneCoverage` owns the union of the influence footprint and the
  associated park footprint plus park fringe. Its ground and declarative layout
  (`docs/data/zone-variants.json`, `ZoneDressing`) replace ordinary terrain paint and
  ambient fill, including procedural residential yard trees; roads and buildings
  remain visible. Ordinary mapped trees yield to Nexus coverage, including its empty cells.
  DeepForest and Gemini crowns supersede generated scenery there, using an
  explicit owning-variant tree species or material mapping when one is defined. Nexus painting and
  quarry coverage preserve all spawn exclusions, including PRIVATE and
  BEHIND_HOUSE; the shared gate still owns its existing POI-frontage exception.
  A connected parking-lane footprint adjoining a church's Old Stones coverage
  becomes part of that same Nexus, retaining its identity and theme without a
  separate Quarry or finite reward budget. Roads, paths and water split parking
  footprints. Parking-lane quarry footprints replace Grove coverage, including
  park interiors and fringe; other Nexus owners and excluded cells retain their ownership.
  If several churchyards touch one lot, the northernmost, then westernmost
  church anchor owns its unclaimed cells. Absorbed lots cannot claim other lots.
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
  retain their positions. Thorn Nexus (Ancient Grove) keeps half its repeated
  bramble seats, covering roughly a quarter of the ground while preserving trees,
  disguised treants and shrine layouts. Nexus mechanics use existing lanes (tar slow, lair tier,
  `ghostsHaunt`, coin-burst ledger, `_storySplashOnce`).
- Sacred Grove keeps its six-cell shrub/tree clusters and quiet open seams.
  It has no authored pressure-plate footpaths or footpath ghost triggers.
- Strip mines use the same cave-in lifecycle on their one-cell outer rim,
  only where the actual shared tier field is Tier 2 calm ground. Each visited
  eligible rim seed has a 60% roll for 1–3 connected rim cells; clusters never
  extend into Tier 3 benches, enclosed interior holes or further outside the
  perimeter. Explicitly calm boundary cells inside the footprint are eligible
  too. Exterior flood-fill distinguishes the outer perimeter from holes, and
  unloaded neighbours never count as boundary evidence. Ordinary hazard,
  transport, private-ground and occupancy gates still apply; tier ownership is
  unchanged. This adds no ambient vent or sinkhole inside the quarry.
- L1 and the surface Nexus rows marked `caveIns` (the Seep tar pits) use `EnvironmentHazards` for hidden cave-in clusters of
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
  day, `DAILY_TIERS`); an INFORMATION board reads a Book page
  (`pageStone`); a bike rack's speed is a reason in the stick-walk
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
  retry backoff skip lookahead; a newer centre stops the older ring. Repeated
  checks of the same centre and depth retain its unfinished ring and byte
  lookahead while the exact centre entry remains ready and spawned. Replacing
  or evicting that entry still starts a fresh pass for Overpass or recovery.
  Prefetched failures enter the normal tile failure path when their build turn
  arrives.
- Yield during tile-wide cell/object/polygon passes in `rasterizeTileSteps`,
  including helpers via `yield*`. Keep unsliced post-rasterize work linear.
  A profile's worst-block label identifies the block ending at that yield.
- Park and beach coverage unions scan conservative polygon bounds including
  their fringe. Footprint cleanup uses numeric local cell keys; preserve its
  insertion, component traversal and bridge tie order because later ownership
  arbitration depends on the ordered result.

Tests: `world_frame`, `worldgen_dedup`, `traps`, `lairs`, `spawn_roads`,
`road_junctions`, `spawn_rebuild`, `tile_url`, `tile_build_blocks`, `street_variants`, `zones`,
`chest_tier`, `daily_crates`, `density_pois`, `spawn_class`, `guard_groups`
(`test/node/*.test.js`).

The approved wall material source and cap colors live in
`src/floor_wall_materials.js`. Both the game and fabricated floor viewer use
these profiles and the same terrain generator. L5 generates no walls; its
fungal wall sample remains available only as an art stress test. L2 uses the
approved lighter Abandoned Mines wall material while retaining natural-cave
terrain and authored-area rules. This changes floor assignments, not saved
ledger keys or progression gates.

## Spawn precedence

Commercial default ground uses the shared hedge lattice for bushes and pot
pillars. Connection tuning belongs to `HEDGE_WALL_PCT` in `worldgen.js`; it
changes whole wall segments while preserving pillar spacing and open interiors.

For generated area content, precedence is **exclusion → suppression → Home →
Nexus → road variants → landcover**. Exclusion and suppression are eligibility
constraints, not competing themes: no area owner bypasses them. Saved/player-owned
placements, physical building footprints, and location-bound story/landmark
placements retain the ownership rules below; ordinary area filling must not
replace them. Home admits its curated starter placements rather than incidental
landmarks from an underlying theme.

The implementation keeps eligibility and ownership separate: `WorldGen.isSpawnCell`
applies exclusion/suppression by spawn class; `WorldGen.variantOwnerAt` resolves
Home, Nexus and road ownership (no owner means ordinary landcover). Per-player
Home filtering is applied after deterministic generation. Runtime theme effects
use `WorldGen.zoneAnchorAt(entry, index)` for the winning Nexus anchor (or
`null` when Home, a cave reservation, or another owner wins). Habitat resolution
uses the same owner without reinterpreting coverage. Both `coverage` and legacy
`idx` masks are resolved centrally. Road presentation uses
`StreetVariants.indexFor`; raw generated coverage/index data is retained for
shared generation and underground inheritance, not runtime priority decisions.

After surface ownership is resolved, the live Home overlay discards complete
four-connected Nexus/road-variant remnants smaller than
`WorldGen.MIN_VARIANT_CELLS` (16 cells; exactly 16 stays). Count footprint cells,
not objects; different Nexus anchors and road variant codes count separately.
Discarded cells lose generated content, theme effects and themed pavement,
returning to underlying terrain without exposing a lower-priority variant.
Saved/player-owned content and physical roads remain. Generated masks and
underground inheritance are unchanged. A component touching a tile edge is
retained because its full extent is unknown; do not discard a cross-tile variant
from one tile's partial count. Spawn-class-specific suppression is still an
eligibility gate, not a universal subtraction from variant area.

Higher-priority placements and their access space take precedence in this order:

1. Saved player-owned objects, Home and story placements. Preserve saved ids and
   progress; a conflicting generated story placement finds a valid alternative
   rather than moving or deleting a player-owned object. Home adopts the nearest
   existing house footprint within three cells of the player's initial position,
   prioritizing a footprint containing the player. Distance is to the polygon
   edge, not the house's entrance. With no nearby house, it adds a 2×2-cell
   house on open ground, searching farther across loaded surface tiles if the
   immediate area is blocked. All four cells must avoid roads, water and existing
   buildings. `clearHomeFooting` removes incidental clutter only:
   existing building cells, objects and outlines are never erased for Home.
   `HomeVariant` reserves a 50 m circle around the frozen `starterCratesAt`
   anchor on the surface only. It overrides road, Nexus and ordinary biome
   content with the curated starter area: Tilly and other unlocked story
   neighbours, the doorstep chicken, starter supplies and authored starter
   placements. Player possessions and mapped buildings remain. Physical roads
   keep their geometry and safety rules but lose their themes inside Home.
   A live street-index copy uses the same boundary intervals as Nexus road
   suppression, including paths; pavement, labels, stories and hot-road effects
   read it through `StreetVariants.indexFor`. Shared generation reads the original.
   Apply this per-player overlay after shared generation, retaining the
   original grids, dressing and zone metadata for cave generation and stable
   spawn identities. The floor viewer uses the same overlay and starter placers.
   The starter trail has two seed crates (nine potato seeds and nine rockfruit
   seeds). Its nine Rock and nine Wood are instant `groundstack` pickups,
   normally three piles of three per material; cramped ground keeps the
   remainder in fewer piles. All seats use the same spawn gate and avoid Home's
   footing. Supplies stay deterministic, revealed and included in tutorial
   guidance. `save.picked` spends individual piles; an opened legacy material
   crate spends every replacement pile through `legacyChestId`. Hard mode
   removes both seed crates and loose material supplies.
2. Building-related objects: entrances, building rewards and frontage objects.
3. Other place-specific landmarks: named viewpoints, wells, cave entrances and
   similar location-bound features. Incidental mapped trees, shrubs and poles
   are ambient fill, not landmarks merely because they came from OSM.
4. Nexus variants, including their deliberately empty layout cells.
5. Road variants, across their defined corridor and verge, including
   deliberately empty gaps. The claim reaches two cells past the road band
   (`StreetVariants.TERRAIN_VERGE_CELLS`): inside it the variant's ground
   replaces residential land cover and ambient yard fill. Ground materials carry
   the street theme: Hedgerow uses park, Overgrown forest, and Pilgrim rocky
   terrain. No separate carpet strips or repeating emblems overlay the verge.
   Generic roadside rocks
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
   Berry Lane (a Small-road row) and Berry Trail (a path row) line both
   verges with bushes of every kind (`BERRY_LANE_BUSHES`: shrubs, berry and
   poisonberry bushes, and brambles never more than a third), one sample a
   cell with a quarter left empty; `GOLDEN_BUSH_SHARE.street` (one in
   fifty) of those bushes is the golden berry bush, and every other ambient
   bush the world seats (the biome scatter, yards, park pads, mapped tree
   rows and plain verges: `WorldGen.ambientBush`) rolls it at `.wild` (one in
   a hundred and fifty) through `goldenBushCrop` (items.js) — one salt, so
   the wild roll is a subset of the lane's; authored zone, hedge and thicket
   pieces never roll it. A goblin runt post every 40 m, a
   third of them held (`BERRY_RUNT_CHANCE`), seats the `street_berry`
   garrison one cell behind the bush row: one ambusher that hides in the
   nearest bush.
   Pottery Road (a Small-road row, sections up to 250 m) lines both verges
   with generated clay pots (`VERGE_ROWS.pottery`): one sample a cell with
   `POTTERY_GAP` (35%) left empty, each pot the first free cell from the
   second verge cell out on the reward gate, so none stands on the kerb cell
   or a Major-and-Medium kerb. No guards and no POI: a pot is a smashable
   prop (`CLAY_POT_LOOT`, a coin a quarter of the time). It is the only
   street that stands clay pots.
   Trade Row (a Small-road row, sections up to 250 m) lines both verges with
   generated wooden barrels the same way (`VERGE_ROWS.trade`,
   `TRADE_BARREL_GAP` 30% left empty, a cell back from the kerb on the reward
   gate) and seats a two-runt `street_trade` garrison post every 25 m
   (`TRADE_GRUNT_STEP_M`), two thirds of them held (`TRADE_GRUNT_CHANCE`),
   a cell behind the barrel row on the fast-foe gate.
   Overgrown forest roads add extra encounters beside the usual plant guard,
   each a row of the variant's `extraEncounters` rolled from the stable street
   key: a sounder of two wild boars on every overgrown street, and a Giant
   Bear on one third of them. Each selected encounter attempts one finite post
   per owning tile (its own `street_*` tier in `src/lairs.js`). Geometry
   fragments share the post; occupancy and the fast-enemy safety gate can
   prevent placement. An extra encounter's garrison is its own ladder
   (`StreetVariants.EXTRA_ENCOUNTER_TIERS`): the street's building family,
   which themes the plant stretch, never re-themes the boars or the bear.
6. Ambient fill: ordinary plants, rocks and generic scattered content.
   Forest landcover scatters pine only; wooded park characters scatter maple
   only, from their `BiomeProfiles` rows. Both mark `treeSpeciesFixed` so
   the near-home softwood overlay preserves their habitat. Species changes
   do not consume random draws or move trees. Residential yards keep their
   mixed maple/pine selection. Imported ordinary trees on forest cells become pine.
   Authored park/Nexus coverage excludes ordinary imported trees and keeps
   its own tree choices; fruit trees keep their species. Outside forests,
   mapped trees retain their original mix.
   Tree-bearing street variants declare their timber species on the variant
   row: Overgrown uses pine and Orchard uses maple alongside its fruit trees.
   Street timber also marks `treeSpeciesFixed`, so its type stays consistent
   through the starter area. Unfixed trees keep the existing near-home pine rule.
   Residential yard trees are the newest ambient fill: while the DeepForest
   layer is off (enable it with `?deepforest=on`), each residential polygon
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
- Building-footprint taps resolve the cell’s owner across loaded tiles; the
  nearest-building fallback applies only to footprints without ownership.
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

### Furniture

Furniture is durable player property in `save.furniture`, exempt from history
trimming. Each one-cell record stores item identity, a cell-derived id, world
position, `PlacedFloor.stampDepth` depth, flip and optional Home `houseKey`.
Floor lamps, owl statues, clocks and planters occupy one floor cell. The stock
floor lamp retains its upright proportions; all seven owl, clock and planter
tiers use generated 24×24 exports. The furniture manifest maps both legacy
and tier frames to these exports; source masters and crop provenance live in
`assets/Objects/Furniture/source/generated/`.
`PlacedFloor.restoreFurniture` overlays it into normal `entry.objects` after
saved barricades on both surface and cave loads. Surface loading first calls
`ensureStarterTrailerObject` to stamp synthetic Home ownership, then derives
`houseKey` from `PlacedFloor.homeCell` during reconciliation. Missing ownership
grids never authorize indoor abilities. Saved claims remove generated
clutter, preserve the containing house, and survive Home's footing sweep.
Generated snapshots remain unchanged. Live `spawnCells` join `spawnOptsOf`
occupancy without changing its generated set, so pickup releases only the
furniture claim. Starter story seating and reward seats also respect saved pieces.

`Furniture.recompute` is the sole writer of `save.houseLuxury`, a map from
Home key to `{ score, footprintKey }`. Consumers use `Furniture.luxuryOf`.
Saved indoor furniture contributes catalog tier squared (1/4/9/16/25), or its
metadata `luxury` override. Outdoor and cave furniture contributes zero;
one record counts once even when its future footprint spans several cells.
Placement, successful pickup, Home move/adoption and load recompute the cache
through `PlacedFloor.furnitureIndoors`. Tile overlays validate ownership after
Home stamping. Each record retains its validated `houseFootprintKey` so tile
eviction does not erase luxury; unloaded geometry cannot authorize an ability.
A new Home location invalidates that association even when its synthetic id
is reused. Inactive Homes score zero. Reconciliation also refreshes luxury
quests and banks newly reached milestone memories through the discovery ledger.

Placement uses `placeOnEmptyCell`: any owned Home floor cell, including its
anchor and doorway, or ordinary open ground accepted by `isSpawnCell` with
`spawnOptsOf` and the `minor` class. `homeInside(x,y)` shares the exact building
ownership lookup with the default player-feet query. Other buildings, roads,
water, planted/tilled cells, traps, the Home firepit and occupied footprints
refuse placement. `SpawnOwnership.footprintCells` owns overlaps; fires, traps,
barricades and reward seats cannot reuse a furniture cell. A planter is the
sole crop exception: it supplies tilled soil on an owned Home building cell,
without adding the building floor to the tilled set. `save.planted` holds the
normal crop record plus `planter: furnitureId`; watering, growth, pests and
harvest use the ordinary Crops paths. Held crop or flower seeds plant directly;
empty hands open the planter dialog. Tree saplings still require field soil.
Planting rechecks Home ownership and refuses outdoors. Harvest leaves the pot;
pickup refuses until its crop has been harvested.

While the player is inside Home, its building tap handlers defer to held or
placed furniture on Home floor cells. Exterior roofs/walls and other buildings
keep architectural priority. Furniture stays in the normal render list so
near walls can occlude it. Pickup grants and verifies one inventory item before
removing property; dialog pickup and flip callbacks explicitly persist.
Multi-cell footprints and per-tier sheet frames remain later phases.

### Initial Home orientation

A new live game waits for the first compass reading before placing its house
and campfire, for at most `HomeArea.FIREPIT_COMPASS_GRACE_MS`; with no reading
by then it places them north-up. The player remains at their GPS position. The starting offsets
rotate into that heading once for a newly constructed 2×2 house, whose anchor
is one cell ahead of the player. An adopted building keeps its source footprint
and position. The firepit uses open ground near Home; water and roads are rejected,
and a full ground cell separates it from every building, including diagonal
corners and buildings across tile seams. New house doorways face the player (`HomeArea.doorSide`). The saved layout stays fixed through later
heading changes and reloads. Existing Homes keep their saved positions; sandbox
and north-up previews retain the north-facing layout.

## Schoolyard game flags

`schoolyard_fields.js` joins connected SCHOOL ground across loaded tile seams
and places one flag near each field's center, on a cell allowed by the shared
reward spawn gate. Buildings, roads, private land and occupied cells are
excluded. Fields touching unloaded edges wait for their surrounding map data.
The seven-cell-wide play area uses reachable safe field cells around the flag;
small fields without nine playable cells are skipped. Placement is deterministic
from terrain and occupancy; flags and active rounds are scene overlays rather
than saved world objects.
