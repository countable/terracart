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
- Derive generated ids/seeds from tile + local cell or OSM id, never array
  indices, timestamps or save-relative metres. The transient pest crow is the
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
- Every spawner passes `roadMask` and `occupied` through `_spawnOpts` to
  `WorldGen.isSpawnCell`. Road terrain alone misses drawn roads; the mask uses
  `WorldGen.roadOverlayWidthM` and masks cells when the drawn bands cover
  `WorldGen.ROAD_MASK_MIN_COVER` of their area. Coin pickups may occupy roads,
  but not objects.
  Cave traps use their occupied-cell set; surface traps sit on the verge.
- Road rules: surface traps belong only on the verges of BANDIT STRETCHES of
  major roads (`entry.roadClass` bit `ROAD_CLASS_BANDIT_VERGE`, stamped by
  `stampBanditStretchesSteps`) and on WASTELAND (`Traps.isTrapGround`, which
  reads the land's class under a zone halo). Where a species prefers to stand
  is an `attracts` column (street variant rows, `Zones.ZONE_KINDS`,
  `BIOME_ATTRACTS`) read by `_seatFaunaOnFavouriteGround`: relocate existing
  spawns, never add, each species on its own stream. SLOW is a reason inside `_bodyHold`
  fed by `entry.slowCells` (`StreetVariants.SLOW_KINDS`); a new slowing
  hazard joins that map, never a new movement gate.
- Influence zones (`src/zones.js`): anchors are POI points (park→grove,
  fuel→tar, place of worship / cemetery→stones), sized from local crowding
  inside the poi buffer so every tile agrees. The halo repaints ONLY
  RESIDENTIAL / COMMERCIAL / WASTELAND, last in `rasterizeTileSteps`. Each
  owned anchor's chest (id unchanged, `zoneNexus` → `ZONE_NEXUS_TIER_BONUS`)
  gets a nexus pattern laid like street dressing (roadMask + occupied). No
  decorative props: every standing piece is interactable or a hazard, one
  art per interactable. Zone mechanics are reasons on existing lanes (tar
  slow, lair tier, `ghostsHaunt`, coin-burst ledger, `_storySplashOnce`).
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
`spawn_rebuild`, `tile_url`, `tile_build_blocks`, `street_variants`, `zones`
(`test/node/*.test.js`).

## Coordinates, rendering and performance

- Draw from the camera anchor using `coords.js` projection helpers. Reach,
  taps, fog and tile loading use `playerM` / `playerToWorldCell()`.
  Draw player-attached effects at `scene.playerScreen()`, not viewport centre.
- The player's feet sit on the GPS fix. Ground marks use that point; body
  effects use `playerBodyDy()` so they also follow the downed pose. Do not
  compensate for sprite seating by changing the projection.
- Upright objects, crops and creatures share the painter pass in `render.js`:
  lower centre of mass renders in front. Add upright things to `RENDER_SPEC`;
  separate layers are for ground surfaces, not standing objects.
- Taps resolve the data cell (`sameAbsCell`), not pixel bounds. Seat cell-bound
  sprites through `seat: true`, `seatInCell` and `ART_BOUNDS`: centre horizontally;
  centre vertically if they fit, otherwise bottom-seat 1px above the cell edge.
  Buildings, moving creatures and canvas-baked street lamps have separate seating.
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

Tests: `peek_drag`, `feet_anchor`, `shell_variants`, `rock_yield`, `health_bar`,
`tilled_bed`, `still_frames`, `chunk_index`; also `tools/sprite_audit.js`.

## Combat, energy and Home

- `combat.js` owns foe HP for melee, projectiles and pets. Damage derives from
  `TOOL_DURATION_MS`; tune that or monster HP, not an extra combat multiplier.
  Game animals (crow/deer) are not enemies or projectile targets; released
  slime pets are never targets.
- Route incoming damage through `Combat.playerDamage` and armour mitigation,
  including per-hit arrow bundles. Difficulty/potion scaling precedes armour;
  armour reduces blows rather than increasing maximum energy.
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
- Art may hint that the survivor is the demon who burned the world, but never
  reveal it. Follow the generator's `LORE`: at most one subtle hint per piece,
  only where it fits; most pieces have none.
- Format every visible wait with `shortDuration`; UTC-day gates pair it with
  `msToNextUtcDay`. A timed gate needs a visible wait.
- Map messages fit `MAP_MSG_MAX` (30 characters) per rendered line, including
  interpolations. Cut copy or use a modal; do not interpolate unbounded POI names.
- Map numbers use toast tiers: `_popEnergy(delta, { ix, iy })` for energy,
  `_popCellNumber` for other cell amounts, `_popDamageNumber` for foes. Name the
  affected cell; body changes default to the player. Body damage calls
  `_flashPlayerHit` when it lands, independently of popup throttling.
- Item effects belong on item descriptions/Stats, derived from owning constants.
  `PLAY_TIPS` teaches otherwise undiscoverable mechanics in first-actionable
  order, read sequentially. Search tips and descriptions when changing a value.
  `ITEM_GUIDE_TIPS` may repeat its own item's effect to teach strategy; add a
  guide for each craftable. Secret uses stay out of the item's public effect
  line (sapphire taming stays in the closing riddle).
- Loot identity by place uses per-context `favourite`; general frequency uses
  `dropWeight`.

Tests: `scene_art`, `duration_notation`, `copy_voice`, `energy_pop`, `hit_flash`,
`item_descriptions`, `books`.

## Maintaining this file

Add guidance here only when it changes how future work should be done across
files or prevents a non-obvious recurring mistake. State the rule once with its
owning API and, where useful, a regression test. Keep tuning values, algorithms
and bug history in source comments/tests; replace superseded rules rather than
appending exceptions. Update the relevant section instead of adding a new diary entry.
