# CLAUDE.md

## Purpose

Working guidance for Mending Lane, a GPS farming RPG rendered with Phaser 3.
Keep project-wide constraints here; keep implementation rationale beside the code.

## Scope and navigation

- Vanilla JavaScript, no build step. `index.html` loads scripts in order into
  shared global scope. Preserve that order when adding modules; keep `sw.js`
  at the repository root for its service-worker scope.
- [README.md](README.md): setup and source map.
- [test/node/README.md](test/node/README.md): test harness and module registration.
- [docs/art/README.md](docs/art/README.md): palette and sprite style direction;
  use the current chibi characters for style, muted rustic colours for natural
  and unrestored assets, and deliberate colour contrast for restored/sacred places.
- [docs/QC_RULES.md](docs/QC_RULES.md): checklist for art, sprites and item surfaces;
  read it for asset changes. This file owns mechanic invariants if notes disagree.
- [docs/spec.txt](docs/spec.txt): game design; code owns current numeric values.
- [docs/SANDBOX.md](docs/SANDBOX.md): hand-built world for visual checks.
- Preserve the `terracart.*` storage keys despite the game's name change.

## Workflow

- Use subagents to batch large or parallelizable tasks.
- Serve locally with `python3 -m http.server 8000`; use `?sandbox=true` for the
  test world. The game needs HTTP for fetches and the service worker.
- After the last edit to a file loaded by `index.html`, run
  `node tools/cachebust.js --write`, then `node test/node/run.js`.
  Script `?v=` values and `SHELL_VERSION` are derived hashes; never edit them
  by hand. Resolve merge markers before regenerating hashes.
- The headless suite includes sprite, cache and layout audits. For browser
  checks, see the test README; if the browser harness cannot run, say so plainly.
- Work on the designated session branch; create it if needed. Small,
  self-contained changes may go directly to `main`.
- Commit completed work without asking. Once all requested work is finished and
  available tests pass, merge to `main` and push `main`, not the feature branch.
  Unfinished work stays on its branch. Always merge; never rebase.

## Shared design rules

- Search for an existing predicate, state flag or table before adding one.
  Extend it when the mechanism is the same; similar names alone do not justify
  combining mechanisms. Read its comments and regression tests before changing it.
- Keep numbers shared by rendering, gameplay and copy in one owning table.
  Derive consumers from it; do not add independent tuning factors.
- Add kinds as table rows and repeated kind groups as predicates:
  `SpriteLayout.CREATURE_BEHAVIOUR`, `CREATURE_ART`, `Combat.MONSTERS`,
  `interactables.js` predicates, `RENDER_SPEC`, and `Lighting.KINDS`.
  Creature variants inherit through `baseKind`; hostility uses `Combat.isEnemy`.
- Read the relevant tests under `test/node/` before changing a mechanic. If a
  supposed mechanic change touches no existing regression assertion, check that
  it actually uses the existing implementation.

## Generation, saves and tiles

- Generate the world deterministically; save player changes as id sets and
  player-placed objects in full. The starting area is also stored explicitly.
  Each spawner owns a seeded RNG stream so adding one does not reroll others.
- A POI chest's tier is its class's DENSITY on its own tile (`loot.js`
  `CHEST_DENSITY_TIERS` / `chestTier(o)`, off `o.poiDensity` stamped by
  `WorldGen.stampPoiDensity`): 1 of a kind → T4 … 25+ → T1, plus depth and
  nexus. It is the tier shown AND paid; Home never enters it. Pots of gold
  (`potCoinsFor`), barrels (`barrelEmptyP`) and restock days read the same count.
- Chests give ONCE (`save.opened`), except what recurs: crates and barrels
  (`restocks`) come back after `crateRestoreDays` (1 for an ordinary crate, up
  to 7 for a class crowding its tile); pots of gold, bike racks, chapels and
  grove shrines daily. All take the one day ledger (`Macros.markToday` — it
  keeps a week; `usedToday` / `stillBare` / `restockWaitMs` read it) and glow
  while available (`poiLit`); a refusal prints the wait via `shortDuration`. A
  new recurring thing joins that ledger and that glow, never a list of its own.
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
  every spawn: TERRAIN, ROAD (the roadMask only — ≥ half the cell under the
  band; road proximity is KERB, never hard), RESTRICTED land, QUIET land,
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
  (fast movers only), SENSITIVE. (Sep 2026, owner's call: the typed HOUSE
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
  `attractor`, `enemy` / `fastEnemy`. A creature's class is DERIVED
  (creature_ai.js `creatureSpawnClass`: fast = top speed over
  `BRISK_WALK_MPS`), never typed at a call site. A new refusal is a new
  reason bit plus its column in the table, never a separate check at a
  spawner. POI chests are the place itself (`landRefused` —
  land reasons only). The live Overpass fence veto (`privateVetoAt`) is for per-player
  things only and fails open. Road terrain alone misses drawn roads; the mask uses
  `WorldGen.roadOverlayWidthM` and masks cells when the drawn bands cover
  `WorldGen.ROAD_MASK_MIN_COVER` of their area. Coins never land on road cells
  or in yards, and every timed reward (coin bursts, bounty packs,
  `findWalkableDestination`) stays on the player's SIDE of any MD/LG road
  (`sameSideField`, creature_ai.js) — nothing urgent across a major road.
  Cave traps use their occupied-cell set; surface traps sit beside footpaths
  or on park edges, never near a road (`Traps.isTrapGround`).
- The road is never a refuge and never a lure. MD/LG roads carry a KERB
  BUFFER (`ROAD_CLASS_MAJOR_BUFFER`): no hostile steps onto the band, no FAST
  mover (foe or animal over `BRISK_WALK_MPS` — `isFastMover`; the wild
  slime's charge is under it) spawns in or enters the buffer, and a player standing in
  it is left alone — the pavement ends a chase, the street adds nothing
  (`test/node/kerb_refuge_sim.test.js`). Above a run (`util.js` speed helper,
  shared with egg hatching) nothing restores, pays or taps and foes ignore the
  player via `unnoticed`. Where a species prefers to stand
  is an `attracts` column (street variant rows, `Zones.ZONE_KINDS`,
  `BIOME_ATTRACTS`) read by `_seatFaunaOnFavouriteGround`: relocate existing
  spawns, never add, each species on its own stream. SLOW is a reason inside `_bodyHold`
  fed by `entry.slowCells` (`StreetVariants.SLOW_KINDS`); a new slowing
  hazard joins that map, never a new movement gate.
- Influence zones: `ZoneCoverage` owns the union of influence and the
  associated park footprint plus fringe. Its ground and declarative layout
  (`docs/zone-variants.json`, `ZoneDressing`) replace ordinary zoning and
  procedural dressing; roads and buildings remain visible. Painted ground
  drops inferred PRIVATE / BEHIND_HOUSE reasons, retaining all site and
  geometry restrictions. Cave generation retains the original ground,
  objects and spawn reasons so surface dressing cannot reroll entrances.
  A park's POI becomes its daily grove shrine in place, preserving its name
  and id. Other nexus chests keep `zoneNexus` and its tier bonus. No decorative
  props: every standing piece is interactable or a hazard, one art per
  interactable. Zone mechanics use existing lanes (tar slow, lair tier,
  `ghostsHaunt`, coin-burst ledger, `_storySplashOnce`).
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
`spawn_rebuild`, `tile_url`, `tile_build_blocks`, `street_variants`, `zones`,
`chest_tier`, `daily_crates`, `density_pois`, `spawn_class` (`test/node/*.test.js`).

## Spawn precedence

Higher-priority placements and their access space take precedence in this order:

1. Saved player-owned objects, Home and story placements. Preserve saved ids and
   progress; a conflicting generated story placement finds a valid alternative
   rather than moving or deleting a player-owned object.
2. Building-related objects: entrances, building rewards and frontage objects.
3. Other place-specific landmarks: named viewpoints, wells, cave entrances and
   similar location-bound features. Incidental mapped trees, shrubs and poles
   are general fill, not landmarks merely because they came from OSM.
4. Special zone variants, including their deliberately empty pattern cells.
5. Special road variants, across their defined corridor and verge, including
   deliberately empty gaps. Zone variants override road variants where they
   overlap; the physical road and its safety restrictions remain intact.
6. General zone/biome fill: ordinary plants, rocks and generic scattered content.

- Hard terrain, land-access, road-safety and accessibility rules are prerequisites,
  separate from priority. Higher priority does not bypass them. Any authored
  terrain-carving exception must be explicit and confined to its existing rule.
- Resolve area ownership before general fill. All lower-priority producers,
  including later scenic, Overpass and runtime passes, respect the same full-area
  reservation. Protecting only occupied object cells is insufficient: a variant's
  empty lanes belong to it too. A higher-priority object can occupy a variant
  area; its presence does not release that area to general fill.
- Area ownership and object occupancy are separate. Inside the winning area,
  objects still obey collision and access rules. Reserve a large object's entire
  declared footprint (a 3 × 3 shipwreck is one interaction), not just its anchor.
- Authored guards, finite finds, shrine gifts and tide pickups belong to their
  declared feature and retain their own budgets and placement rules. Generic
  traps, treasure and rooted enemies respect variant exclusions; a variant's
  own content does not use the general-fill veto. Fauna retain their intentional
  ability to share interactable cells and their terrain/road restrictions.
- Resolve equal-priority generated claims using stable world-space feature keys
  and buffered geometry, never iteration order, tile-load order or save state.
  Apply saved-player changes as overlays without rerolling the generated world.
  If an authored footprint cannot fit, use its deterministic eligible fallback
  or report a shortfall; never spill it into forbidden or higher-priority space.

## Coordinates, rendering and performance

- Draw from the camera anchor using `coords.js` projection helpers. Reach,
  taps, fog and tile loading use `playerM` / `playerToWorldCell()`.
  Draw player-attached effects at `scene.playerScreen()`, not viewport centre.
- The player's feet sit on the GPS fix. Ground marks use that point; body
  effects use `playerBodyDy()` so they also follow the downed pose. Do not
  compensate for sprite seating by changing the projection.
- Upright scenery, castle wall pieces and characters (including the player)
  share `Render.sortWorldDepth`: lower continuous ground/feet Y renders in
  front. Use stable seating geometry, never animation lift or whole cell rows.
  Add sprite appearances to `RENDER_SPEC`; ground surfaces stay underneath.
- Taps resolve the data cell (`sameAbsCell`), not pixel bounds. Seat cell-bound
  sprites through `seat: true`, `seatInCell` and `ART_BOUNDS`: centre horizontally;
  centre vertically if they fit, otherwise bottom-seat 1px above the cell edge.
  Buildings, foot-anchored stalls (market stands and the in-building macro
  stalls, `src/macros.js`), moving creatures and canvas-baked street lamps have
  separate seating.
  Use a stable `seatFrame` for animation. After art changes, run
  `node tools/sprite_audit.js --emit-bounds` and update `src/sprite_layout.js`.
- List actual crop `frames`, not sheet-cell counts. Hash the full id for
  per-cell variation (`wildplantFrame`); do not use id length or transient indices.
  When art depicts quantity, rendering and drops share the variant table
  (`PLAIN_ROCK_VARIANTS`); loot messages report the actual quantity rolled.
- Seat creature work wheels and enemy health bars from `CREATURE_ART` helpers,
  not fixed pixel offsets. The work wheel rests on the crown; health is a bar.
- Bake repeated cell geometry into textures (e.g. tilled beds). Reset mutable
  properties such as watered tint whenever pooled sprites are reused.
- Respect `FPS_LIMIT` and its derived `PHASER_FPS_LIMIT`. Per-frame tile scans
  use `WorldGen.forEachItemInBox`, not flat object arrays. Widen queries for
  offers/lights beyond the sprite cull. Indexed objects do not move in place.
- Cached drawing keys must include every input. `Lighting.frameKey` uses the
  quantised light clock; new tile arrays read per frame need a derived index.
- A cell-crossing rebuild never reads pixels back: no `getImageData`, no
  per-piece `textures.createCanvas` (Phaser reads the canvas back on
  creation). Bake short-lived canvas pieces into shared atlas pages
  (`building_overlay.js` wall atlas) and apply a colour treatment to the
  colours (`unclaimedMaterialColor`), not to finished pixels. Measured: one
  read-back per building per crossing was the walking stutter on iPhone.

Tests: `peek_drag`, `feet_anchor`, `shell_variants`, `rock_yield`, `health_bar`,
`tilled_bed`, `still_frames`, `chunk_index`, `building_overlay`; also
`tools/sprite_audit.js`.

## Combat, energy and Home

- `combat.js` owns foe HP for melee, projectiles and pets. Damage derives from
  `TOOL_DURATION_MS`; tune that or monster HP, not an extra combat multiplier.
  Game animals (crow/deer) are not enemies or projectile targets; released
  slime pets are never targets.
- Route incoming damage through `Combat.playerDamage` and armour mitigation,
  including per-hit arrow bundles. A shield potion halves the raw blow before
  armour; difficulty multiplies the mitigated blow after armour. Armour reduces
  blows rather than increasing maximum energy.
- `Energy.set` is the only runtime energy writer (save migration is exempt).
  Accumulate fractional per-frame gains/losses before banking whole pips.
- Hostile interest checks use `unnoticed` (shadowed or downed); stalking adds
  sight range through `unseen`. Traps check `Combat.playerDowned` directly:
  concealment does not stop them. Downed players have no reach and are not hunted.
- Job costs use `spendEnergy`; passive restoration pauses while `working`
  (work wheel or rest hold). Walking drains and enemy blows are not jobs.
- Home light, rest and ward share `HOME_R` and surface-only `homeWorldPos()`;
  campfires use `FIRE_REST_R`. Home wards steer enemies away from Home and suppress bites.
  Do not merge this with campfires' refused-target-cell ward, which would trap
  enemies inside Home's ring.

Tests: `combat`, `armor`, `energy_int`, `downed_pursuit`, `rest_work`, `home_ward`.

## Lighting and streets

- `lighting.js` owns the sole lighting pass: additive source cookies on a 2D
  canvas multiplied over the world. Do not add darkness passes or dim sprites
  again. Reach lighting follows `cellInReach`; light conveys reach and live POIs
  without outline rings. Day/night leaves the reach plateau bright; caves ignore it.
- Add sources through `Lighting.KINDS` / `sourceKind`; point-source collectors
  cull by viewport plus light radius, not sprite bounds. Use the existing
  derived luminance/contrast controls; remeasure the plateau ceiling before
  raising it.
- Streets restore metre intervals along each transportation line, keyed by
  `Streets.lineKey(feature, lineIdx)`, clipped to tile spans. Keep reach tied
  to the player and visuals keyed by `Streets.epoch`; do not add per-cell road
  state. Feather only the restored band's edge, with a hard-edge fallback.
- Generate lamps from `Streets.lampSpacingM()` (independent of trail goals).
  One list and `lit` flag feed art and lighting. Derive verge offset from road
  width and lamp footprint; art and light share the same world point. Lantern
  rise is a draw-space offset; retune height through `LAMP_PROFILE`.
  Collect/cache lamps about the camera anchor, only after tiles finish loading.
- Living lamps: a lit lamp's brightness and visit credit come from ONE delta,
  `save.lampVisits[id]` (Streets `lampBrightness` / `lampCredit` / `visitLamp`,
  pruned at `LAMP_FADE_MS`); brightness rides the lamp list as `bright` and
  the light as a steady gain `g` in `frameKey` (never the animated `a`).
  Credit banks through `_bankStreetMetres`, gated like the sweep (passenger,
  surface, drift home). Walking paths lay lamps via `Streets.lampLayFor`.
- Trail rewards use `Trail.PRIZE_CONTEXT`; the first reward uses `firstPrize`.
  Synthetic loot classes need both a `CLASS_MAX_TIER` ceiling and a branch
  before item resolution. Cash rewards have no `slot`.

Tests: `lighting`, `reach_corners`, `streets`, `street_lamps`, `road_overlay`,
`trail`, `loot`; also `tools/layer_audit.js`.

## Dialogs, feedback and teaching

- Dialogs use `makeModalShell` with a kind, which supplies a scene painting.
  Generate paintings with `tools/gen_story_art.js`'s `scene()` composition:
  portrait, subject above, quiet copy zone below. The shell handles overflow
  with its band layout. Painted headers use a label without emoji/`kindIcon`.
- Before memory 30, art and dialogue may foreshadow the survivor's past but
  must not reveal it. `MemoryStory` gates Act 2 on the first tower and nine
  lifetime memories; that tower is abandoned at 21. Its memory-30 reveal
  happens only at the second tower (restoration index 25 or later): both the
  wizard and survivor are dragons; the survivor was his Warmonger. Keep earlier
  scenes ambiguous; most paintings need no hint. Reuse existing art for this arc.
- Format every visible wait with `shortDuration`; UTC-day gates pair it with
  `msToNextUtcDay`. A timed gate needs a visible wait.
- Map messages fit `MAP_MSG_MAX` (30 characters) per rendered line, including
  interpolations. Cut copy or use a modal; do not interpolate unbounded POI names.
- Map numbers use toast tiers: `_popEnergy(delta, { ix, iy })` for energy,
  `_popCellNumber` for other cell amounts, `_popDamageNumber` for foes. Name the
  affected cell; body changes default to the player. Body damage calls
  `_flashPlayerHit` when it lands, independently of popup throttling.
- Book stories use direct firsthand excerpts in quotation marks. Occasional
  narrator asides sit outside the quotation in italics (`bookPageHTML`), usually
  one short sentence. Vary length, format, mood and author voice across books;
  use `BOOK_VOLUMES` for named volumes and consistent author voices, and reserve
  humor for some passages. Scholars can quote any page early: foreshadow without
  revealing the player’s identity or the wizard’s secret. Preserve approved
  excerpts and keep `ITEM_GUIDE_TIPS` as the owner of shared item parables. Authors
  describe their world, not interface elements such as work circles or health bars.
- Story panels, books and item descriptions carry at most one useful fact,
  told through the world, physical sensations or a character's voice. Hint at
  the advantage and leave exact effects for discovery. Confirmations state
  the choice and direct outcome concisely; keep prices and required quantities
  clear. Exact mechanics belong in brief action feedback or dedicated Stats,
  derived from owning constants. Keep safety and technical recovery instructions
  direct. Preserve `PLAY_TIPS` order for saved reading progress; secret uses
  stay out of public item descriptions (sapphire taming stays in the closing riddle).
- Loot identity by place uses per-context `favourite`; general frequency uses
  `dropWeight`.
- A neighbour's talk is its ROLE, a row of `NPC.PROFILES[zone].roles` with a
  label in every `NPC.LABELS` zone and a branch in `NPC.dialogue` that reads
  an owning ledger (restoration, lamps), never a count of its own. A zone's
  story in a resident's voice is the `keeper` column of `Zones.ZONE_KINDS`.
  The story neighbours by the trailer (`NPC.STORY_ROLES`, seated by
  `Starter.placeSafeAreaWarden`) arrive by the memory ledger (`minMemories`,
  re-run from `_bankDiscovery`) and speak through `MemoryStory.npcDialogue`
  by act; a new story voice is a role there, not a new placer or dialog path.

Tests: `scene_art`, `duration_notation`, `copy_voice`, `energy_pop`, `hit_flash`,
`item_descriptions`, `books`, `story_neighbours`.

## Maintaining this file

Add guidance here only when it changes how future work should be done across
files or prevents a non-obvious recurring mistake. State the rule once with its
owning API and, where useful, a regression test. Keep tuning values, algorithms
and bug history in source comments/tests; replace superseded rules rather than
appending exceptions. Update the relevant section instead of adding a new diary entry.
