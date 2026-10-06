# Floor geometry proposal - inputs and open decisions

Companion to [floors.md](floors.md) (the target catalog) and
[floor-design-review.html](floor-design-review.html) (the inputs checklist).
This page answers, per floor: which surface evidence does the floor
recognize, how is each read, and where the theme, the player activities or
the geometry mapping are still undecided. Everything marked PROPOSAL or OPEN
needs the owner's confirmation; each carries a default.

## The geometry input menu

These are the surface inputs a floor can recognize - the full menu, not just
roads, buildings, landcover, nexus, POIs and road variants:

| # | Input | What it is | Owning read | Floors using it today |
| --- | --- | --- | --- | --- |
| 1 | Terrain paint | `WorldGen.T` classes (walkable land, PARK/GROVE/PLAYGROUND/PITCH/COMMERCIAL, FARMLAND, SAND, WATER, ROAD, buildings) | `FLOOR_PROFILES` terrain modes (`undergroundTerrain`) | every floor, by mode |
| 2 | Roads | Drawn carriageway bands, by class (MD/LG/minor) | `surfaceRoadMask` at the spawn gate; the street mirror carves routes | every floor (gate); 1-2 (mirror) |
| 3 | Buildings | Footprint polygons painted as building terrain | lava mode (`isBuildingTerrain`); spawn-gate moat | 5 (lava); all (gate) |
| 4 | Zone/nexus anchors | `ZoneCoverage` anchors (grove, quarry, ...) | `cave_areas.js` `DEPTH_WEIGHTS` | 1-2 (authored areas) |
| 5 | POIs | The objects layer (chests, low-tier seats) | chest mirrors (`caveChestsFrom`), torch sites (`caveTorchSites`) | every floor |
| 6 | Road variants | `StreetVariants` corridors (thorny, snare, barricade...) | surface-only today | 0 (surface) |
| 7 | Transportation lines | OSM paths and minor streets | `Underground.project` (profile `streetMirror`) | 1-2 |
| 8 | Spawn-gate evidence | `spawnWhy` classes, `roadMask` | `floorSpawnWhy` (FARMLAND/GOLF inherited); the clearings mode adds an npc-class gate | every floor |
| 9 | Water | Pools, lakes, rivers (`T.WATER`) | Excluded by walkability - becomes wall | none (wall everywhere) |
| 10 | Authored cave areas | Spring, warrens, mushroom, gemstone, mine tunnels | `cave_areas.js` `DEPTH_WEIGHTS` + `BUDGETS` | 1-2 |
| 11 | Above-floor objects | Stairs, ground holes, quarry rocks, mirrored caches | stair mirroring, `fallLandings`, `quarryProvenance`, chest lineage | every floor |

## Floor 1 - natural caves (decided; no open decisions)

Recognizes: 1, 2 (mirror), 4 (spring/warren/mushroom/gemstone areas at
grove anchors, mine tunnels at quarries), 5 (chest mirrors, torch seats), 7
(paths and streets carved as themed routes), 8, 11 (holes minted here fall to
floor 2; quarry seams stamp down). Theme, activities and geometry are decided
(floors.md) and shipped.

## Floor 2 - goblin city

| Input | How defined | Status |
| --- | --- | --- |
| Buildings (3) | New terrain mode `city`: building cells are the ONLY walls | DECIDED (floors.md) |
| Roads (2) | Road cells stay open - the city's streets | DECIDED |
| Warren rooms (10) | `cave_areas` nexus rooms today cover anchor neighborhoods (goblin weight 45 at depth 2, budget 16) | EXISTS - see P1 |
| Road variants (6) | Projected as the source of clearings | PROPOSAL P2 |
| Non-goblin nexus (4) | Spring/mushroom/gemstone picks host clearings | PROPOSAL P2 |
| POIs (5) | Chest mirrors and torch sites | PROPOSAL P4 |
| Water (9) | None in the city | PROPOSAL P3 |

- **P1 - Full-floor warrens.** Rooms stop being anchor-local and tile the
  floor between roads and clearings: the existing planner (BUDGETS scaled by
  coverable cells) packs 5x5..9x7 chambers with 1-2 cell corridors, and the
  street-mirror routes (input 7) become the main corridor net rooms hang off.
  Default: yes.
- **P2 - Clearings.** Clearings appear only where a projected road variant
  passes (input 6, projected like the street mirror) and at non-goblin nexus
  anchors (the spring/mushroom/gemstone/mine picks of DEPTH_WEIGHTS) - the
  "same anchors as floor 1" rule made concrete. Default: yes.
- **P3 - Water.** Dry city: no pools (the seep theme ends at floor 1).
  Default: dry.
- **P4 - POIs.** Chest mirrors land only in clearings (the reward for finding
  one); torch sites render as street lamps on open road cells. Default: yes.

Activities (proposal): warren raids - each room cluster holds one cache and
a trapper ambush; the garrison budget is `BUDGETS.goblins` scaled to room
count. Theme: decided (floors.md).

## Floor 3 - deep stone

| Input | How defined | Status |
| --- | --- | --- |
| Landcover (1) | `clearings` mode: park/grove/playground/pitch/commercial open, seeded with settlements | DECIDED (row ships at depth 2 today; shifts to 3) |
| Digging | The way around | PROPOSAL P6 |
| Road variants (6) | Half the roads cleared as tunnels | PROPOSAL P7 |
| POIs (5) | Chest mirrors, dwarf/grove settlements (shipped) | DECIDED |
| Down route | The dig shaft to floor 4 | PROPOSAL P8 |

- **P6 - Dig rule.** Every CAVE_WALL on this floor is diggable at the usual
  energy cost; clearings are simply pre-dug rooms. No floor is otherwise
  dig-through (floors 1-2 walls stay solid). Default: yes.
- **P7 - Road tunnels.** Each drawn road corridor crossing the tile gets a
  per-road coin (avalanche hash of its `Streets.lineKey`): cleared corridors
  become 2-cell tunnels through the stone, joining clearings - target ~50% of
  corridors per tile. Default: yes.
- **P8 - The down shaft.** A "soft stratum" seam object, about one per tile,
  seated at a clearing edge; digging it open (3x wall work) opens the shaft
  to floor 4 that stays climbable. Needs art + interaction. Default: one seam
  per tile; alternative is a fixed shaft seat per tile.

## Floor 4 - fungal Underdark

| Input | How defined | Status |
| --- | --- | --- |
| Terrain (1) | `open` mode - every cell opens | DECIDED |
| Landcover (1) | Fungal beds | PROPOSAL P9 |
| Hazards | Spore vents | PROPOSAL P10 |
| POIs (5) | Portal stone (T4+ chest, 1 km out); T6 chests; torch sites | DECIDED |

- **P9 - Fungal geometry.** Fungal beds derive from the surface FOREST/GROVE
  paint above (the mirror pays off: woods above, fungus below); glow
  mushrooms inside them as light sources (`Lighting.KINDS.mushroom` already
  exists). Default: yes.
- **P10 - Spore vents.** Vents may mint on 4 with a fungal skin (same
  mechanic, new art). Default: yes.
- **P11 - Foes.** Add mushroom monsters to the roster at window 4-5 (they are
  surface-only today). Default: yes.

## Floor 5 - haunted dead city

| Input | How defined | Status |
| --- | --- | --- |
| Terrain (1) | `surfacePaint` mode - the city above repeated | DECIDED |
| Buildings (3) | Ruin treatment | PROPOSAL P12 |
| Roads (1/2) | Cracked pavement look | PROPOSAL P13 |
| POIs (5) | Gravestone caches; the arena hatch | PROPOSALS P13, P14 |
| Ghosts | Constant haunt | PROPOSAL P15 |

- **P12 - Ruins.** Option A (cheap): building footprints stay solid wall with
  ruin dressing on the faces. Option B (full): a RUIN_WALL terrain with
  passable gaps every few cells - the city becomes lootable wreckage.
  Default: A now, B later.
- **P13 - Dead dressing.** POI chest mirrors render as gravestone caches
  (the headstone interactable already exists); roads get a cracked-pavement
  paint variant. Default: yes.
- **P14 - Hatch seat.** One arena hatch per tile at the best-ranked POI site
  (the plaza). Default: yes.
- **P15 - Constant haunt.** The dead city ignores the even-depth ghost rule:
  ghosts walk floor 5 always. Default: yes.

## Floor 6 - lava stratum

| Input | How defined | Status |
| --- | --- | --- |
| Terrain (1) | `above` mirror + lava under buildings | DECIDED (profile row) |
| Water (9) | Obsidian crust or wall | PROPOSAL P16 |
| Heat | The floor's challenge | PROPOSAL P17 |

- **P16 - Water above.** Surface water becomes obsidian crust (walkable, fire
  ticks) or stays wall. Default: stays wall (today's behavior).
- **P17 - Heat.** Slow energy drain floor-wide unless near a cool crystal
  (new interactable) or on crust; campfires refuse to light on 6. Default:
  yes.

## Floors 7-8 - dragon layer

| Input | How defined | Status |
| --- | --- | --- |
| Terrain (1) | `above` mirror (default profile row) | DECIDED |
| Roost seats | Largest opening per habitat region | PROPOSAL P18 |
| 7 vs 8 split | Hunting grounds vs roosts | PROPOSAL P19 |
| Dressing | Scorched ground | PROPOSAL P19 |

- **P18 - Roosts.** One roost per `EnemyHabitats` region on 8: the largest
  connected opening hosts the hoard (a T7 chest), egg clutches and the red
  dragon; seats derive from the region id, never load order. Default: yes.
- **P19 - The split.** Floor 7 is the hunting ground (dragon-kin patrols,
  scorched-bones dressing via a CAVE_PASSES row); floor 8 is the roosts.
  Default: yes.

## Beyond 8

Open recursion with ceilings (ore and chest tiers cap; liches and demon
kinds hold 9+). No proposals needed now.

## Decision list for confirmation

| # | Decision | Default |
| --- | --- | --- |
| P1 | Warrens tile the full floor; street mirror is the corridor net | yes |
| P2 | Clearings only on projected road variants + non-goblin nexus anchors | yes |
| P3 | Floor 2 water: none | dry |
| P4 | Chest mirrors only in clearings; torches as street lamps | yes |
| P6 | All floor-3 walls diggable | yes |
| P7 | Per-road coin clears ~50% of corridors as tunnels | yes |
| P8 | One soft-stratum seam per tile opens the climbable shaft | one seam |
| P9 | Fungal beds follow surface FOREST/GROVE | yes |
| P10 | Spore vents on 4 with fungal skin | yes |
| P11 | Mushroom monsters, window 4-5 | yes |
| P12 | Ruins: solid walls + dressing now; RUIN_WALL later | A now |
| P13 | Gravestone caches + cracked pavement | yes |
| P14 | One arena hatch per tile at the best POI | yes |
| P15 | Ghosts constant on 5 | yes |
| P16 | Water on 6 stays wall | wall |
| P17 | Heat drain + cool crystals; no campfires | yes |
| P18 | One roost per habitat region on 8 | yes |
| P19 | 7 hunting grounds, 8 roosts | yes |
