# CLAUDE.md

## Parallelism rules

- **Don't use `git stash` or `git worktree`** for parallel work.
- If two pieces of work would touch the same file, **do not parallelize them**.
  Either run them serially in one agent, or split the work along file
  boundaries so each agent owns disjoint files.
- Before spawning multiple agents, list the files each one would write and
  confirm the sets don't overlap. If they overlap, restructure or serialize.

## Subagent rules

- **Delegate by default, and pick the model to match the work.** The Agent
  tool takes a `model` parameter — use it deliberately rather than letting
  everything inherit the parent's:
  - **haiku** — running the test suite (`node test/node/run.js`,
    `node tools/sprite_audit.js`) and reporting back which tests failed and
    with what message; and any other **token-heavy, judgement-light** job:
    grepping the tree for every call site of a symbol, reading a long file to
    answer one question, summarising a big diff, sweeping for stale comments.
    Ask for the conclusion (the failing assertions, the file:line list), never
    the raw dump — the point is to keep that output out of the parent's context.
  - **sonnet** — clear and obvious dev work: a change whose shape is already
    decided and whose files are already known. Adding a constant and its
    call sites, a mechanical rename, writing a test against a spec you hand
    it, a self-contained module extraction, applying a fix you have already
    diagnosed.
  - **opus** — complicated dev work: anything needing a design decision, a
    diagnosis, or a read across several of the QC invariants below. A bug
    with no known cause, a change that touches the tile pipeline / lighting /
    coords split, a balance change where the numbers are derived rather than
    tuned, or any task you would struggle to write a precise brief for.
  If you cannot tell whether a task is sonnet-obvious or opus-hard, it is
  opus-hard: a subagent that guesses wrong on this codebase's invariants
  costs more to unpick than it saved.
- **The parent still owns the finish.** Whatever the model, a subagent's
  report is input, not a result — the parent re-runs the tests, reads the
  diff, and does every git operation (see below).
- **Subagents must NOT run any `git` commands.** No `git add`, `git commit`,
  `git push`, `git stash`, `git checkout`. The parent agent handles every
  git operation. Give the subagent the commit SHA / branch state it needs
  in its prompt instead of asking it to look git up.
- **Subagents must NOT modify `index.html`.** The script-tag list is the
  parent's responsibility: the subagent reports *what* should be added, and
  the parent edits index.html in one place at the end. The cache-bust `?v=`
  is nobody's to type — the parent runs `node tools/cachebust.js --write`
  once after the last edit (see the cache-bust rule below).
- For multi-file refactors that delete from a shared file (e.g. extracting
  modules from `app.js`), tell each subagent to **CREATE its new module
  only** and **report exact line ranges to delete from the shared file**.
  The parent does the deletions in one coordinated pass after all subagents
  return — this avoids line-number drift between parallel agents touching
  `app.js`.

## QC rules

Most rules below point at the code that enforces them; the full rationale and
history live in the comments on the named symbols. Read those before changing
the mechanic.

- **One lane, many reasons: a new rule is usually a new REASON, not a new
  lane.** Before writing a gate, flag or ward, grep for the state it
  duplicates — the behaviour usually already exists under another name. If a
  per-tick read or shared predicate already answers your question, OR your
  reason into it and rename it for what it now means (the model:
  `unnoticed = shadowed || Combat.playerDowned(save.energy)` in
  `wanderCreatures`). Likewise a NUMBER two sides read is ONE table both read
  — the `roadOverlayWidthM` discipline (drawn-as-road and no-spawn-here off one
  constant); later rules just call this "one table both sides read".
  **The existing tests are the tell: a change that breaks no existing pin has
  probably not touched the existing mechanic at all** — ask whether it should
  have. **Reuse the lane when the MECHANISM is the same, never because the
  words match** — a campfire's ward (refuses a target cell) and Home's ward
  (turns the foe onto an away-from-Home angle) are two mechanisms; merging
  them freezes a foe inside the ring. If nothing existing fits, say in the new
  one's comment what it is NOT, so the next reason lands in the right lane.

- **Nothing spawns on a road, nor on top of anything already there — and
  "road" is not a terrain code.** The terrain grid rasterizes a way one cell
  wide and parking aisles to nothing, so `grid[]` under-reports the road. The
  answer is **`entry.roadMask`** (built in `rasterizeTile`, stamped from
  **`WorldGen.roadOverlayWidthM`**, the width `road_overlay.js` strokes). It
  sets no terrain; a masked cell just can't host a spawn. The other half is
  **`opts.occupied`**, a Set of flat cell indices (`cy*w+cx`) claimed by an
  object or wild plant, built once by `spawnInTile` (app.js) and handed to
  every spawner via `_spawnOpts`; `WorldGen.isSpawnCell` reads both (caves use
  `Traps.spawnCave`'s `occupiedIdx`). Checking road TERRAIN alone is the bug.
  **When you add a spawner, pass both** (`opts.roadMask` and `opts.occupied`).
  The one exception is a COIN DROP (a pickup, not scenery): it may lie on a
  road, never under anything (`app.js` › `coinGround` / `coinRoadCell`).
  **Audit it:** `node test/node/run.js` › `test/node/spawn_roads.test.js`.

- **The camera is not the player.** The viewport centres on a CAMERA ANCHOR
  (player + `scene.peekM`, the peek drag). **"Where do I DRAW this?"** goes
  through `coords.js` › `viewAnchorWorldM` / `viewAnchorCell` (or
  `worldMetersToScreen` / `screenToWorldMeters` / `cellScreenXY`); **"where
  IS the player?"** uses `playerM` / `playerToWorldCell()` — reach, every tap
  gate, fog reveal, tile loading, the 3×3 tile scans. Anything drawn AT the
  player (sprite, shadow, halo, facing arrow, swing) reads
  `scene.playerScreen()`, never `viewCenterX/Y`. **When you add a
  world-drawn layer, anchor it; when you add a reach or gate test, don't.**
  If you ever cache a layer about the viewport centre and SLIDE it by the
  peek, draw it wider by `PEEK_MAX_CELLS` cells (nothing slides today —
  every cached overlay rebuilds on `viewAnchorCell`). The lightmap is drawn at the player's screen point and
  its ramp ends on zero past the corner (`PLAYER_RAMP_PAST_CORNER_CELLS`).
  **Audit it:** `node test/node/run.js` › `test/node/peek_drag.test.js`.

- **The painter rule: the LOWER object (centre of mass) renders in front.**
  `src/render.js` › drawObjects ranks crops, objects and creatures together
  in ONE pass over `worldContainer` (`objectsContainer` / `plantedContainer`
  alias it) by `_cellRow(dy)`, then kind, then `dy`, stamped as depth. A layer
  of its own is a promise nothing will ever pass in front of it (the street
  lamp's own pool hid it under every footprint). **When you add something
  that stands up, give it a `RENDER_SPEC` row** (a `_kind` row + an item on
  `filteredObj`, as campfires, scarecrows and `_streetlamp` do); **only things
  that LIE on the ground (traps, pads, the road band, the pier plank) get a
  layer.** Hand-drawn geometry obeys it too (castle rampart pieces, the
  tier-12 pass in drawCells; `window.__RAMPART_DEBUG = true` tints them).
  Derive any vertical-overlap draw order from this rule, not a hand-picked
  layer.

- **Interactables sit clearly in ONE cell — the TAP is the CELL, not the
  art.** There is no pixel hitbox: every tap resolves through `coords.js` ›
  `sameAbsCell` against the object's data cell, so the art must agree with
  it. For every world sprite EXCEPT buildings (house / tower / shrine /
  produce stands / pot-of-gold), moving actors (creatures) and the street lamp
  (a canvas bake, seated by `RoadOverlay.LAMP_GROUND_FRAC`):
    1. The **visible art** (trimmed opaque bounds, not the frame box) **never
       crosses the cell's bottom edge**.
    2. Art that fits (height ≤ one cell) is **centred** vertically.
    3. Art that doesn't fit is seated with its **bottom 1px above** the edge.
    4. Art is **always centred horizontally**.
  Enforced by the seat pass in `src/render.js` and `src/sprite_layout.js`
  (`seatInCell` + the `ART_BOUNDS` table). To make a sprite obey, give its
  `RENDER_SPEC` entry `seat: true` (animated sheets: set `seatFrame` to a
  stable frame). If a sprite and its cell disagree, fix the anchor or the
  seat — there is no rect to adjust. When art changes, regenerate with
  `node tools/sprite_audit.js --emit-bounds` and paste into
  `src/sprite_layout.js`.
  **Audit it:** `node tools/sprite_audit.js` (also run by `node test/node/run.js`).

- **What the art SHOWS is what it DROPS.** Variants that differ in COUNT are
  not cosmetic: one table both sides read. `SpriteLayout.PLAIN_ROCK_VARIANTS`
  carries `col` (drawn) beside `stones` (paid by `plainRockBaseDrop`,
  `stones + randInt(0,1)`); `SpriteLayout.plainRockFrame` and
  `plainRockStones` both resolve through the one `plainRockVariant`. A surface
  with no rock sprite (the cave WALL dig) passes `stones = null`. `stones` is
  authored (the pair is one blob); the `ART_BOUNDS` width drift check in
  `tools/sprite_audit.js` is the tripwire if the sheet is re-cut. **And say
  the real number: if a loot path rolls a quantity, its flash prints that
  quantity.**
  **Audit it:** `node test/node/run.js` › `test/node/rock_yield.test.js`.

- **A frame index is not a frame COUNT — list the art, never count the
  cells.** A sheet cell can be blank; the renderer can't tell. A
  `CROP_SPRITE` entry declares **`frames: [...]`** (the frames that carry
  art), never a bare `variants` count. **And the hash must read the whole
  KEY**: per-cell looks resolve through `items.js` › `wildplantFrame` (off
  `util.js`'s `fnv1a` of the id), never `_ix`/`_iy` (deleted by
  `rasterizeTile`) or an id's `.length`. **When a look varies per cell, hash
  the id, not its shape; and when a crop varies, list its frames.**
  **Audit it:** `node test/node/run.js` › `test/node/shell_variants.test.js`
  and `node tools/sprite_audit.js` › `wildFrameRows`.

- **A dialog about a thing on the map opens with THAT THING'S SPRITE.**
  `app.js` › `MODAL_KINDS` supplies a fallback emoji glyph per category; a
  caller with a picture passes `kindIcon` (HTML, twin of `kindLabel`), drawn
  ungreyed. One resolver both sides read: `loot.js` › `chestLook` picks a
  chest's look and carries its **texture key**; `render.js` draws by that key
  and `app.js` › `worldIconHTML` shows its baked frame (`WORLD_ICON_URLS`,
  `bakeSheetFrame`). **When you add a dialog about an object the player just
  tapped, hand it that object's sprite; when you add a look, put its texture
  key on the look.**
  **Audit it:** `node test/node/run.js` › `test/node/treasure_icon.test.js`.

- **A tilled cell is one BAKED bed, never a per-frame rounded path.** The
  soil is the `tilled_N` texture (`textures.js` › `drawTilledTex`, inset
  `TILLED_INSET_PX`, corners `TILLED_CORNER_PX`, transparent ring), and
  `render.js` paints NO soil fill under it. The watered look is a TINT on the
  pad sprite (`WATERED_TINT`), set every frame the pool sprite is reused. Any
  shape a cell wears every frame belongs in its texture, not a Graphics path
  (cellGfx is cleared and re-tessellated each frame).
  **Audit it:** `node test/node/run.js` › `test/node/tilled_bed.test.js`.

- **The creature "crown" rule (work wheel) and the enemy health BAR.** The
  work wheel over a creature **rests on** its crown: the ring's TOP EDGE sits
  on the top row of the art at rest (drop capped at half the art's height for
  short animals). Derived from `src/sprite_layout.js` › `CREATURE_ART`, which
  `render.js` draws from and `app.js` seats via `creatureWheelDy(kind)`, with
  `CREATURE_WHEEL_R` there too. **Never re-tune the wheel with a flat px
  offset, and never CENTRE it on the crown** (that was the old bug — a full
  radius of ring floating above every animal).
  **Enemy health is a BAR, not a ring**: `_drawEnemyHealth` /
  `_drawEnemyHealthBar` (app.js) float a strip a fixed gap ABOVE the crown,
  seated by `SpriteLayout.creatureHealthBarTop(kind)` +
  `HEALTH_BAR_W/H/GAP` — never a flat offset, never health as a ring again.
  Damage lands as "-N" popups (`_popDamageNumber`, fed by `_damageEnemy` on a
  `DMG_POPUP_BEAT_MS` throttle).
  **Audit it:** `node tools/sprite_audit.js` (the wheel) and
  `node test/node/run.js` › `test/node/health_bar.test.js`.

- **A KIND is a ROW, never a chain of literals — and a kind GROUP is a
  predicate.** What a creature DOES lives in `src/sprite_layout.js` ›
  `CREATURE_BEHAVIOUR` (beside `CREATURE_ART`, both via `baseKind` so a giant
  inherits): wandering, pets and `prey`, GAME (crow + deer), drops, produce,
  scarecrow response, gait and bolt — asked through `isPet` / `isGame` /
  `creatureDrop` / `creatureProduce` / …, never `kind === '…'`. HOSTILITY is
  NOT in the row: it stays `combat.js` › `MONSTERS` via `Combat.isEnemy`. A
  group of kinds tested in more than one place is a predicate in
  `src/interactables.js` — `isCastle(o)`, `isTreeLike(kind)`,
  `isBuilding(kind)` — and "is this object spent" is
  `isSpent(o, spentSets(scene, save))`. **When you add a creature, add its
  row; when you test a kind group twice, name it.**
  **Audit it:** `node test/node/run.js` › `test/node/creature_table.test.js`
  and `test/node/predicates.test.js`.

- **Combat is HIT POINTS, and the numbers are derived.** `src/combat.js` owns
  one HP pool per foe, drained by the melee wheel, bow/staff shots and pets.
  Damage is pinned to the old timed wheel by `dps = 15000 / toolDurationMs`
  (one shot = one second of that rate). If a fight feels wrong, change
  `TOOL_DURATION_MS` or the kind's `hp` — never a fudge factor in combat.js.
  **"Enemy" is narrower than "defeatable"**: enemies (`Combat.isEnemy`) are
  the wild slime and cave monsters. Crow and deer are GAME — nothing
  auto-fires at them, no shot may hit them. A tamed slime (`released_*`) is a
  pet, never a target. **When you add a hostile kind, put it in the monster
  table.**
  **Audit it:** `node test/node/run.js` › `test/node/combat.test.js`.

- **Armour SOAKS a blow — it does not grow the bar.** Each worn piece adds its
  TIER to a reduction pool (`items.js` › `armorSlotReduction` /
  `armorReduction`; slots differ only in price), and `Combat.mitigate` SPENDS
  that pool against a blow over `MITIGATION_ROUNDS` halving rounds, floored at
  `MIN_PLAYER_DAMAGE`. The soak is LINEAR on the 1..16 damage scale and the
  pool is spent, not re-charged — if armour stops discriminating between
  tiers, check those two before retuning anything (see `Combat.mitigate`'s
  comment). Mode and potion (`Difficulty.enemyDmgMul`, the shield) scale the
  blow BEFORE armour. The three ways a foe reaches the player (slime leech,
  cave-monster melee, goblin arrow) all go through
  `Combat.playerDamage(dmg, this.save.armor)`; the arrow also passes
  `shot.hits` (`MONSTER_ARROW_HITS`) so its bundle is soaked per hit. **When
  you add a way for something to hit the player, mitigate it; a raw
  `save.energy -= dmg` is the bug.** What a piece soaks is printed on the
  piece (Stats row, shop offer) from `armorSlotReduction`.
  **Audit it:** `node test/node/run.js` › `test/node/armor.test.js`.

- **NOTHING HUNTS A BODY.** At zero energy the reach is 0
  (`coords.js` › `reachRadiusM`) and no damage path takes a point off an empty
  bar, so a downed player is not there to be hunted: `wanderCreatures` ORs
  `Combat.playerDowned(save.energy)` beside `shadowed` into **`unnoticed`**,
  and every hostile-interest branch reads it (the leech, the monster's hit and
  arrow, the struck slime's charge, both stalk branches). **When you add a
  hostile behaviour that takes an interest in the player, gate it on
  `unnoticed`, not on `shadowed`.**
  `_tickTraps` also stands down on collapse, but reads `Combat.playerDowned`
  DIRECTLY, never `unnoticed` — a Shadow Powder hides you from what notices
  you; iron jaws notice nothing. Ask whether a new rule is about being
  *noticed* or about being *upright*.
  At zero energy the sprite lies down (`playerBodyRotation()`,
  `PLAYER_DOWNED_ROTATION`; `playerBodyDy()` drops its centre onto the fix).
  `playerBodyDy()` is the ONE answer to "where is the body's centre?" —
  reading `playerFeetNudgeY` directly leaves marks in the air over a downed
  sprite.
  **Audit it:** `node test/node/run.js` › `test/node/downed_pursuit.test.js`
  and `test/node/traps.test.js`.

- **A tile build stutters on its WORST BLOCK, not its total.** The rasterizer
  is a generator (`rasterizeTileSteps`); the slicer can only yield at a
  `yield`. The boot profile's `worst block <N>ms in <label>` names the yield
  the block ENDED at — the culprit is the code just before it. Watch for a
  **quadratic** (scanning everything kept so far, or a `splice` per rejection
  — compact in place) and a **helper called plainly from the generator** that
  walks a whole polygon (make it a `function*` and `yield*` it, like
  `spawnDebrisSteps` / `_spawnRockClustersSteps`). **When you add a pass over
  every cell, object or polygon, give it a yield.**
  The post-rasterize path in `loadTile` (cave entrance, Overpass bin
  injection) has no slicer at all, so anything there must be O(n) by
  construction. Cross-tile duplicates are settled by POINT OWNERSHIP inside
  the rasterize (a seam house / POI is emitted only by the tile holding its
  anchor), never by scanning neighbour tiles — that read load order.
  **Audit it:** `node test/node/run.js` › `test/node/tile_build_blocks.test.js`
  and `test/node/worldgen_dedup.test.js`.

- **The loop STEPS on a cap, and a per-frame pass either skips a still step
  or walks an index — never the tile.**
    1. **`FPS_LIMIT`** (app.js, 30) is the step rate on any display; Phaser is
       handed **`PHASER_FPS_LIMIT`** = one more, because `stepLimitFPS` drops
       remainders and an exact vsync multiple under-delivers.
    2. **`Lighting.draw` paints only when its inputs move**, keyed by
       `frameKey`; animated inputs read `lightClock`, quantised to
       `LIGHT_TICK_MS`. **The key must name every input**: a new thing the
       paint reads goes into `frameKey` or it will not repaint.
    3. **`drawObjects` walks `WorldGen.forEachItemInBox`** (a derived per-tile
       chunk index, `CHUNK_M` / `chunkIndex`, keyed on the array's identity,
       length and last element), never `entry.objects` / `entry.wildplants`
       flat. The query box is the sprite cull plus the widest thing offered
       before the cull (`HOUSE_PAD_M`, `Lighting.objectLightPadCells`).
       Objects never move in place; creatures do and are not indexed.
  **When you add a per-tile array a per-frame pass reads, index it the same
  way; when you add an offer before the sprite cull, widen the box.**
  ☰ › Load profile reports steps vs frames, still vs walking steps, the
  lightmap tick and `drawObjects scanned`; `?fps=N` (0 = uncapped) and
  `?rscale=N` are A/B knobs.
  **Audit it:** `node test/node/run.js` › `test/node/still_frames.test.js`
  and `test/node/chunk_index.test.js`.

- **A tile can be REBUILT under you, and a rebuilt entry is a NEW object.**
  `rebuildTileWithBin` swaps in a replacement carrying only live `creatures`
  and `coinDrops`; any other state hung on the old entry is gone and
  `spawnInTile` must run again. That pass is gated on **`entry._spawned`**, a
  flag the rebuild does NOT carry — never on carried state (gating on
  `entry.creatures` made spawns vanish until refresh). **When you put
  per-session state on a tile entry, decide what a rebuild does with it**:
  carried across, or re-derived by a pass that a dropped flag re-runs.
  **Audit it:** `node test/node/run.js` › `test/node/spawn_rebuild.test.js`
  (note `starter_relic.test.js` tests `_placeStarterTrail` directly and does
  not cover the call gate).

- **The tile URL is RESOLVED, never pinned.** OpenFreeMap rotates its dated
  planet directories. `WorldGen.resolveTileUrl` asks the TileJSON
  (`TILEJSON_URL`) for the live template, caches it in IndexedDB for a day,
  and `fetchTileResponse` re-asks once when a fetch fails.
  `TILE_URL_FALLBACK` is only an offline first-run fallback; bumping it is
  never the fix. **Every tile fetch goes through `fetchTileResponse`** — a raw
  `fetch(tileUrlFor(...))` is the bug.
  **Audit it:** `node test/node/run.js` › `test/node/tile_url.test.js`.

- **A module's `?v=` is DERIVED from its bytes — never typed, never bumped.**
  The `?v=` on each `index.html` script tag is the only thing that
  invalidates the browser's HTTP cache for it; a module changed under a stale
  `?v=` serves the OLD file beside a fresh `app.js` (a crash with no repro on
  a cold cache). Bumping `SHELL_VERSION` does not fix that. **`node
  tools/cachebust.js --write` after the last edit** writes each `?v=` as 8 hex
  of the file's sha256 and `SHELL_VERSION` as a hash of the list — there is no
  number to choose (`vendor/phaser.js` is covered). **A merge that conflicts
  on a tag is resolved by keeping EITHER side and running `--write`** —
  resolve conflict markers first; `--write` refuses a file still carrying
  `<<<<<<<`.
  **Audit it:** `node test/node/run.js` runs `tools/cachebust.js`'s own
  CHECKS, which fail on any stale tag.

- **The player's FEET are on the GPS fix.** `playerM` is the projected fix,
  drawn at `viewCenter`; the sprite is raised by `playerFeetNudgeY` (app.js
  create(), the negative of the frame's feet drop) so its feet land on the
  point, and `feetOffsetM` is 0. Ground marks (contact shadow, footprints,
  GPS crosshair, walk target, a peer's shadow in `multiplayer.js`) sit on the
  point itself; anything wanting the body's centre (facing arrow, powder
  countdowns, swing arc, halo) adds **`playerBodyDy()`**, never the raw nudge.
  If the map looks offset from the feet along one axis, the seating has
  drifted — never fix it by moving the projection or re-adding a per-mark
  offset. The road band's WIDTH is drawn true-scale (`widthPxFor`) from
  `WorldGen.roadWidthM`'s per-class table — change that table if a band's
  width reads wrong.
  **Audit it:** `node test/node/run.js` › `test/node/feet_anchor.test.js`.

- **Every wait the player can read is `shortDuration`.** `src/util.js` ›
  `shortDuration`: the LARGEST unit that applies, an integer, a unit letter
  (`20d`, `3h`, `30m`, `12s`) — never a compound, never a bare number, never
  `0m` while the gate still refuses (it ceils). Pair it with `msToNextUtcDay`
  for anything gated on a UTC day key (`Delivery.dayKey`, castle favour,
  coin-burst POIs). A shop's wait is one number both call sites format
  (`ShopsMath.readiness().waitMs`, `shopWaitLabel`). **When you add a timed
  thing, format its wait with `shortDuration`** — and if it has no readout at
  all, that is the bug.
  **Audit it:** `node test/node/run.js` › `test/node/duration_notation.test.js`.

- **An energy number lands ON ITS CELL, by the player.** Every `+N⚡` / `−N⚡`
  goes through `app.js` › `_popEnergy(delta, { ix, iy })` — the cell the
  change belongs to (a spend resolves it from the TAP via `_cellAtScreen`),
  defaulting to the player's cell for changes to the body. It seats through
  the projection (`_energyPopAt` → `_cellToastAt` / `playerScreen`, never
  `viewCenterX/Y`), clear of the cell's top edge or of the player's head
  (`ENERGY_POP_HEAD_PX`, `_isPlayerCell`), in the `cell` toast tier. **The
  number is the whole mark: nothing is drawn on the ground** — adding a cell
  outline back (the removed `_flashCellOutline`) is the bug. **When you add an
  energy gain or loss the player can see, pop it with `_popEnergy` and name
  the cell** — a `flash` of a ⚡ number at the viewport centre is the bug.
  **Every other number on the map is the same thing**: `_popCellNumber(text,
  color, ix, iy)` (coin `+$1` on the coin's cell); the foe's `-N`
  (`_popDamageNumber`) is a `damage` row of `TOAST_TIER`. **A number drawn on
  the map is a `_toast` tier, never its own `add.text`**, and names the cell
  or foe it is about.
  **And the body flinches**: a blow on the player calls `_flashPlayerHit` at
  the instant it lands (never from the throttled pop); `_updatePlayerAura`
  flicks it red for `HIT_FLASH_MS` on both the tint and the halo texture
  (`setTint` is a no-op under Canvas). **When you add a drain on the body,
  call `_flashPlayerHit` where the loss is banked.**
  **Audit it:** `node test/node/run.js` › `test/node/energy_pop.test.js` and
  `test/node/hit_flash.test.js`.

- **Working is not resting.** The passive rests in `app.js` update() — Home
  (`HOME_FULL_REST_S`) and campfire (`FIRE_FULL_REST_S`) — pause while
  `working`: a work wheel is running OR the rest hold hasn't expired. Every
  frame of a wheel and every successful `spendEnergy` push the hold out by
  `REST_SETTLE_S` (`_holdRest`, sole writer of `_restHoldUntil`). The stick
  walk's per-cell drain and a foe's blow are deliberately NOT jobs. Never fix
  a "free" job by raising its cost or slowing its wheel. **When you add a
  passive energy source, gate it on `working`; when you add a way to spend
  energy on a job, send it through `spendEnergy` so it holds the rest.**
  **Audit it:** `node test/node/run.js` › `test/node/rest_work.test.js`.

- **The world is GENERATED; the save is only what you CHANGED.** Every
  interactable outside the starting area is a pure function of where it is:
  `WorldGen.makeRng` (mulberry32) seeded from tile coords (`HASH_MUL_X` /
  `HASH_MUL_Y`), depth and a per-stream salt. No global seed, no stored object
  list. A new interactable belongs in exactly one bucket:
    1. **GENERATED** — position, tier, drop. Nothing reaches the save. The
       default.
    2. **THE DELTA** — what the player DID to a generated thing, as an
       exception list of ids: `caught`, `chopped`, `picked`, `opened`,
       `sprungTraps`, `disarmedTraps`, `brokenRocks`, `foundTreasures`,
       `dugWalls`, `tilled`.
    3. **PLACED** — things somebody PUT there, stored in full: `planted`,
       `fruittrees`, `placedRocks`, `scarecrows`, `fires`, `released`, and the
       starting area (`starterTrailer` / `starterShopId`, `starterCratesAt`,
       `starterPlotAt`, `starterPondAt`).
  **Bucket 2 ids must be derived from POSITION** — never a counter, array
  index or `Date.now()` (the pest crow is the one exception, which is why
  `wanderCreatures` prunes its marker). **Salt the roll, never the position**:
  a per-save salt (`save.relicSalt`) may change what the starter chest holds
  or the quest board offers, never where things sit. **Each spawner seeds its
  OWN stream** rather than drawing from the caller's, so existing worlds don't
  re-roll.
  **Traps are the sharpest instance** (`src/traps.js`): generated; only
  `save.sprungTraps` and `save.disarmedTraps` reach the save. Surface traps go
  on the verge (`Traps.isRoadside` over `entry.roadMask`, seat cleared by
  `WorldGen.isSpawnCell` with `_spawnOpts`); cave traps sit around
  up-staircases, never under an object sprite. The tick reads
  `playerToWorldCell()` (the feet), and costs pop through `_popEnergy` on the
  trap's cell.
  **Audit it:** the determinism pins in `test/node/traps.test.js`,
  `test/node/cave_coins.test.js` and `test/node/beach_treasure.test.js`.

- **Every player sees the SAME generated world — the save's frame is for
  DRAWING, never for generating.** Multiplayer players talk about places ("the
  peach tree by the church"), so given the same tile bytes a tile must
  generate identically on every device. Each save projects the world in its
  own metre frame (`START_LAT`, the frozen home latitude, scales
  `tileEdgeM`), so **absolute world metres differ between players** — by
  metres for homes metres apart. Therefore:
    1. **A tile's cell grid is the TILE's, from its own latitude**
       (`WorldGen.cellsPerEdgeForTile(ty)`), never `START_LAT`'s. A cell's
       size in the frame is `tileEdgeM / entry.cellsPerEdge` — never assume
       `CELL_M` or `scene.cellsPerTile` when indexing a tile's cells.
    2. **Ids, seeds and hashes come from tile + local cell** (`${prefix}_${tx}_
       ${ty}_${ix}_${iy}`) or an OSM id — never `Math.round(x)`, a metre in a
       hash, or a global `floor(x / CELL_M)`. A metre-denominated step or area
       in generation is converted through the tile's CELLS, not `mvtToM`.
    3. **Per-player data never reaches the generated world.** Home distance,
       game progress and the starting area may ADJUST a thing for its own
       player (an overlay applied after generation, a nerf, softer contents),
       never decide what the thing IS or WHERE it sits: species, a chest's
       type / tier / look, which ruins hold a garrison and what's in it, which
       guards are elite. Player edits (dug walls, the pond, placed stairs) stay
       off the generated grid a deeper level is derived from.
    4. **Nothing depends on load order or network luck**: cross-tile dedup
       picks its survivor from the data, not from which tile was cached
       first; cached Overpass bins are stored frame-free.
  **What MAY differ between players, by design**: chest CONTENTS and every
  drop roll, recurring random events (coin bursts, respawns, wandering,
  shop stock), game-mode counts (easy vs hard creature / trap numbers), and
  per-player progress (restoration is per-save today — sharing it is shelved in
  `docs/SHARED_RESTORATION_PLAN.md`). **When you add a generated thing, ask
  what two players with different homes and modes would each see.**
  **Audit it:** `node test/node/run.js` › `test/node/world_frame.test.js`
  and `test/node/lairs.test.js`.

- **Light ADDS, darkness doesn't — the lightmap is the only lighting pass,
  and its numbers are DERIVED.** `src/lighting.js`: a viewport-sized 2D
  CANVAS (`scene.lightTex`, shown by `scene.lightMap`) filled with the ambient
  floor, each source adding its radial cookie with `'lighter'`, MULTIPLIED
  over the world from above the sprites. Never paint darkness in a Graphics
  pass, never use a RenderTexture for it, and `Render.spriteTint` must never
  compose the reach dim onto a sprite (double-darkens).
  **The plateau is per cell**: its edge is painted from `cellInReach`'s own
  expressions (rounded by `ReachCorner`), so what is lit is exactly what the
  tap gate accepts — a circle for the plateau is the bug. Inside it
  `plateauFill` / `plateauLevel` shade by `PLATEAU_FALL`.
  **THE LIGHT IS THE AFFORDANCE — never stroke a reach outline back on.** If
  the boundary stops reading, widen the STEP at its edge in `lighting.js`
  (pinned to outweigh `PLATEAU_FALL`) and check `PLATEAU_OUTPUT_K` first.
  `reachGfx` carries only the unmapped-tile reveal.
  **The knobs**: `Lighting.profile` derives ambient, plateau and edge from
  `Render.reachDimColor` / `reachDimAlpha` and `FALLOFF_A` / `FALLOFF_P`.
  Retune a look through `PLAYER_OUTPUT_K` (the ramp outside reach) and
  `PLATEAU_OUTPUT_K` (the reach area — a CEILING, measured; re-measure before
  raising it); `AMBIENT_K` is the contrast knob; `AMBIENT_DAY_LUM` is the
  noon floor stated as a luminance (via `atLuminance`). A further factor
  added in lighting.js breaks the pinned correspondence. **State a look you
  can see as a luminance; keep `AMBIENT_K` for the contrast between them.**
  **Day/night**: `Lighting.daylight(scene, now)` from `sunElevationDeg`
  (ramp `DAY_ELEV_DEG` → `NIGHT_ELEV_DEG`) moves the out-of-reach wash toward
  `NIGHT_DIM_A` / `NIGHT_TINT_KEEP`; the plateau is not darkened and caves
  ignore the sun. `profile()` with no daylight is noon.
  `window.__DAYLIGHT = 0..1` forces it.
  **Every light source is a ROW in `Lighting.KINDS` — when you add one, add a
  row and return its kind from `Lighting.sourceKind`.** For a POINT light
  (placed fire, lamp), add a collector called from `draw()` beside
  `collectFires` / `collectLamps`, culling at `halfM` + the row's radius, not
  the sprite cull. Rows today: player; Home (`trailer`, radius `HOME_R`);
  restored building (keyed on `isClaimedKey`); campfire (radius
  `FIRE_REST_R`); live POIs (breathing on `POI_PULSE_PERIOD_S` — this IS the
  POI marker, never draw a ring back); street lamps (`cobble` row, spacing
  `Streets.lampSpacingM()`, never retyped).
  **Audit it:** `node test/node/run.js` › `test/node/lighting.test.js`,
  `test/node/reach_corners.test.js` and `tools/layer_audit.js`.

- **A message on the MAP is thirty characters.** `util.js` › `MAP_MSG_MAX`
  budgets every `flash` / `flashLoot` — the whole rendered line including
  interpolations, per line for `\n` toasts. When a line doesn't fit, cut the
  sentence (the scaffolding, not the information) — never wrap it; anything
  needing more room is a modal (`showMessageModal` / `showOfferModal`). **Do
  not interpolate anything unbounded** (e.g. an OSM POI name — name the KIND).
  **Audit it:** `node test/node/run.js` › `test/node/copy_voice.test.js`.

- **What an item DOES is written on the ITEM, not in the Book.** The
  description surfaces are `ITEM_EFFECTS[id]` (the `✦` line, ~55 chars max,
  nowrap), `RELIC_DEFS[slot].blurb`, the Eat button's `+N⚡` and the Stats
  panel's armour row. `PLAY_TIPS` is not one of them. **When a tip and a
  description overlap, the description wins and the tip goes**; move any
  extra fact onto the line. **The one sanctioned exception is
  `items.js` › `ITEM_GUIDE_TIPS`**: a guide page for a key mechanical item
  (the Crow Feather, every `HOME_RECIPES` craftable) or a behaviour (flowers
  as a gift, winning a slime over) may restate its OWN item's line, because
  its job is the strategy around it — the overlap test exempts a guide
  against its own key only. Add a craftable, add its guide. **The one exception is the one SECRET**: the
  sapphire's ✦ line describes its open use (the portal); the slime taming is
  hinted only in `PLAY_TIPS`' closing riddle. **When an item has a secret
  use, its ✦ line describes the open one.**
  **Audit it:** `node test/node/run.js` › `test/node/item_descriptions.test.js`.

- **What NO item can say is written in the Book — truthfully, in the order
  it's needed.** A mechanic the player can't discover by looking and no ✦
  line can carry (a derived number, a gate, a side-effect — e.g. the
  first-taste energy cap `Energy.maxEnergy`, `SLOW_GRIND_MS`, `enemyBounty`,
  `CHEST_TIER_HOME_RINGS_M`, `DELIVERY_BONUS_MULT`, `QUEST_SLOTS`) is
  documented in `PLAY_TIPS` or nowhere. **When you add a mechanic of that
  shape, add its tip.** Numbers in a tip are **re-derived from the module that
  owns them**, never retyped. **Grep both tables (`PLAY_TIPS` and the item
  descriptions) for a constant before you change it.**
  The Book is drawn often enough to read: `dropWeight: 3`, and places of
  learning (`POI_CATEGORY` `'school'` in `loot.js`) pin it via `rarity.js`'s
  per-context `favourite`. Use `favourite` when a PLACE should be known for a
  thing; `dropWeight` when a thing should be commoner everywhere.
  **THE ORDER IS THE CURRICULUM**: `app.js` `_bookRead` walks `PLAY_TIPS`
  front to back, one page per Book, bookmarked in `save.tipsRead`. Tips run
  by **when they first become ACTIONABLE**, not by subject (first ten
  minutes, starter loop, what's lying around, village economy, the land,
  animals, fighting, underground, long gates, the riddle last). **Put a new
  tip with the moment the player first needs it, and don't re-randomise the
  draw.**
  **Audit it:** `node test/node/run.js` › `test/node/books.test.js`.

- **Home is a CAMPFIRE YOU OWN, and its ring is ONE number.** A campfire
  lights, warms and repels on `FIRE_REST_R`; Home does all three on
  **`HOME_R`**: the `trailer` light row, `isRestingAtHome` (a plain distance
  test, `HOME_FULL_REST_S`), and `wanderCreatures`' `homeWard`, which turns
  every `Combat.isEnemy` foe inside it onto an angle AWAY FROM HOME (never a
  refused target cell, which freezes a foe inside; never away-from-player,
  which drives far-side foes through the door) and switches its bite off.
  The trade panel is a tap on the building, no part of the ring. Where Home
  is comes from **`homeWorldPos()`** — surface-only, memoised on the home id,
  only a HIT memoised. **When you add an effect to Home, put it on `HOME_R`.**
  **Audit it:** `node test/node/run.js` › `test/node/home_ward.test.js` and
  `test/node/lighting.test.js`.

- **A street is restored ALONG THE WAY, never per cell — and the way is a
  LINE of a feature, never the feature.** `src/streets.js` measures
  restoration as metre intervals of arclength per `transportation` line, keyed
  `Streets.lineKey(feature, lineIdx)` (features can be merges of many lines).
  Only metres inside the tile square count (`tileSpans`). "In reach" is
  `reachIntervals` over `cellInReach` from the player's reach cell; the dwell
  is `createSight`'s sliding window. The restored look is a second canvas in
  `road_overlay.js` rebuilt on `Streets.epoch(save)`; the dwell preview and
  shine are the one per-frame Graphics (`RoadOverlay.drawLive`, from
  `drawRoadGeometry`). The ladder (`src/trail.js`) counts metres
  (`GOAL_STEP_M`), one blast and counter per sweep. **Do not bring a per-cell
  road state back.**
  The restored band is feathered at its edge only (`softenEdge`, last step of
  `commitRestored`; radius `RESTORED_BLUR_FRAC` capped at `RESTORED_BLUR_PX`,
  both measured) — never blur the drawn layer, never fake it with stacked
  translucent strokes; where canvas can't `filter`, ship the hard edge.
  `STREET_SHINE_ALPHA` and `BLAST_STONE_R_CELLS` keep the moment quiet.
  **Audit it:** `node test/node/run.js` › `test/node/streets.test.js` and
  `test/node/road_overlay.test.js`.

- **A restored street LIGHTS ITS OWN WAY.** A lamp every
  `Streets.lampSpacingM()` metres (`Streets.LAMP_SPACING_M`, the STREET's own
  constant — deliberately NOT `Trail.GOAL_STEP_M`; `lampsAlong` skips lines
  under half the spacing). Lamps are GENERATED, never stored
  (`Streets.lampsAlong`, lit when `Streets.covers` finds the metre restored).
  An unlit lamp draws as the old road cobble (`assets.js` › `cobble`,
  `STREET_LAMP_DARK_FRAME` via `WorldGen.classifyLine`). `_updateStreetLamps`
  keeps every nearby lamp on ONE list flagged `lit`; the draw pass and
  `Lighting.collectLamps` both read the flag — a second list for dark stones
  is the bug.
  **Seat on the VERGE, derived**: `Streets.lampOffsetM` = half
  `WorldGen.roadOverlayWidthM` + `STREET_LAMP_R_CELLS` (widest art footprint,
  off `RoadOverlay.LAMP_FOOT_R_CELLS` / `STREET_LAMP_DARK_CELLS`), resolved
  through `Streets.pointAtM(line, mvtToM, s, offM)`. **Never seat a lamp with
  a flat offset, and never give the light a point of its own**: one point
  comes out of `_streetLampsForTile` for both art and light.
  The art (`RoadOverlay.paintLamp`, colours `UI_LAMP_GLOW` for what it sheds
  and `UI_LAMP_GOLD` for its metal) goes through `RENDER_SPEC._streetlamp`,
  seated on its ground line (`LAMP_GROUND_FRAC`, `STREET_LAMP_ORIGIN_Y`); the
  light is lifted to the lantern by `RoadOverlay.LAMP_LANTERN_RISE_CELLS` as a
  draw-space `dyPx` on the light entry — never as metres in `dx`/`dy`.
  Retune the lamp's height by re-mapping `LAMP_PROFILE`, never by moving
  `LAMP_GROUND_FRAC`. The dark cobble keeps a centred origin (set per lamp).
  The lamp list is collected from the CAMERA ANCHOR, memoised on anchor cell
  + `Streets.epoch`. **Neither memo may be stamped on a tile that is still
  loading** (entries sit in `WorldGen.tileCache` with no `layers` until the
  build lands) — the `_neighborZoneCache` rule. **When you cache an answer
  read off a tile entry, ask what it says while that tile is still loading.**
  **Audit it:** `node test/node/run.js` › `test/node/street_lamps.test.js`,
  `test/node/streets.test.js`, `test/node/road_overlay.test.js` and
  `test/node/lighting.test.js`.

- **The ladder pays out of the ROAD's own pool, and the first rung is
  fixed.** `Trail.PRIZE_CONTEXT` is `rarity.js` › `'treasure:road'` (seeds,
  coins, produce). Prize #1 is `Trail.firstPrize` (the onion seed). The first
  banked metres open `_showTrailIntro` (flagged `save.trail.greeted`), and
  every ceremony prints the next rung via `trailNextPrizeLine` off
  `Trail.goalFor`. Two synthetic classes sit in `classBias`: `cash` →
  `{ kind:'gold', amount }` with NO `slot` (how payers tell money from gear),
  worth `CASH_TIER_VALUE` (derived from `PRICES`); and `bundle` (wood + stone
  by count). **When you add a class that isn't an items.js `kind`, give it a
  ceiling in `CLASS_MAX_TIER` and a branch before the item resolution** — or
  the roll pays nothing.
  **Audit it:** `node test/node/run.js` › `test/node/trail.test.js` and
  `test/node/loot.test.js`.

## Testing

- **Run `node test/node/run.js`** — the main suite; it runs headlessly and
  includes `tools/sprite_audit.js` and `tools/cachebust.js`'s checks. After
  the last edit of any file `index.html` loads, run
  `node tools/cachebust.js --write`.
- The browser harness (`test/run_tests.py`) needs a browser that isn't always
  available. When you can't run it, say so plainly and rely on careful review
  — don't editorialize about it.

## Commits

- Commit freely as work completes; no need to ask before committing.
- **When all pending work is done, merge to `main` and push `main` — no
  need to ask.** Don't push the session/feature branch; the feature branch
  is the workspace, `main` is what goes up. "Done" means everything the
  user asked for is finished and the tests you can run are green — a
  half-finished change stays on the branch until it isn't.
- **Never rebase, always merge.** If integrating remote changes, use
  `git merge` (or `git pull --no-rebase`). Do not run `git rebase`,
  `git pull --rebase`, or `git pull` when `pull.rebase` is configured.

## Branching

- **Work on the feature branch designated for the session** (the branch
  named in the session/task instructions). Create it locally if it
  doesn't exist yet.
- **Minor changes can go straight to `main`** — a one-line constant, a
  colour or copy fix, a small self-contained tweak to one file. Commit on
  `main` and push; no branch, no merge commit. Anything bigger — work
  spanning several files, a new module, a behaviour change worth reading
  as one unit — belongs on the session branch.
- **When work is ready, merge to `main` and push `main`** (via `git merge`,
  never rebase) rather than pushing the feature branch. Go ahead and do it
  — no approval needed.
