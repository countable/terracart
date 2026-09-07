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
    The point of these is to keep a wall of output OUT of the parent's
    context — so ask for the conclusion (the failing assertions, the file:line
    list), never the raw dump.
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
  is nobody's to type — it is derived from the file's bytes, and the parent
  runs `node tools/cachebust.js --write` once after the last edit (see the
  cache-bust rule below).
- For multi-file refactors that delete from a shared file (e.g. extracting
  modules from `app.js`), tell each subagent to **CREATE its new module
  only** and **report exact line ranges to delete from the shared file**.
  The parent does the deletions in one coordinated pass after all subagents
  return — this avoids merge-conflict-style line-number drift between
  parallel agents touching `app.js`.

## QC rules

- **Find the mechanic that already ships: a new rule is usually a new REASON,
  not a new lane.** Before writing a gate, a flag or a ward, look for the one
  the game already has — the odds are the behaviour you want exists under
  another name, wanting one more reason to fire.
  The Sep 2026 "enemies chase a dead player" fix is the model. The game already
  had a state in which no hostile takes an interest in the player: the Shadow
  Powder's minute, read once per tick as `shadowed` and consulted by five
  branches (the leech, the monster's hit and its arrow, the struck slime's
  charge, and both stalk branches, each falling back to the aimless wander).
  "A player on an empty bar is not worth hunting" is that SAME state arriving
  for a different reason — so the fix ORed the new reason into the old read
  (`unnoticed = shadowed || Combat.playerDowned(save.energy)`) and renamed what
  those five branches ask. One line and a rename. A `_downed` flag threaded to
  five NEW conditions would have been five more places to keep in step with the
  five that already existed, and the next ward would have made ten.
  **The existing tests are the tell.** Four shipped pins (`powders`,
  `home_ward`, `lairs`, `combat`) failed on that rename and moved to the new
  name — which is the proof the two behaviours are one lane. Had the new reason
  needed branches of its own, every one of those tests would have passed
  untouched and the duplication would have shipped invisibly. **A change that
  breaks no existing pin has probably not touched the existing mechanic at
  all** — ask whether it should have.
  The shape is everywhere in here, and most of these rules are an instance of
  it: Home is the campfire's three effects on one radius (`HOME_R`), a pet's
  kill calls `resolveDefeat` rather than its own copy of the payout (the copy
  is why a dog's kill paid no bounty), `Traps.isRoadside` reads `entry.roadMask`
  instead of a second road test, the work wheel and the health bar both seat off
  `CREATURE_ART`, and the plain rock's draw and its drop resolve through one
  `plainRockVariant`. It is the `roadOverlayWidthM` discipline pointed at
  BEHAVIOUR rather than at a number: one lane, many reasons.
  **Reuse the lane when the MECHANISM is the same, never because the words
  match.** A campfire's ward and Home's ward both repel the same foes and are
  still two mechanisms — the fire refuses a target cell, Home turns the foe onto
  an away-from-Home angle — because a refused cell freezes a foe already inside
  the ring on the doormat. Merging those would ship that stall. The question is
  "would ONE implementation serve both?", not "do these sound alike?".
  **So before you add a flag, grep for the state it duplicates.** If a per-tick
  read or a shared predicate already answers your question, add your reason to
  it and rename it for what it now means; if nothing does, say in the new one's
  comment what it is NOT, so the next reason lands in the right lane.

- **Nothing spawns on a road, and "road" is not a terrain code.** The terrain
  grid under-reports the road every time: a way rasterizes exactly ONE cell
  wide however wide it really is, and parking aisles rasterize to no cell at
  all — while the overlay draws each way at its real carriageway width. So a
  motorway's band covers a cell either side of the cells it paints, a parking
  lot is asphalt the grid still calls landuse, and a filter that reads `grid[]`
  is told "grass" for both. That is why this bug kept coming back.
  The answer is **`entry.roadMask`** (built in `rasterizeTile`, stamped from
  **`WorldGen.roadOverlayWidthM`** — the same number `road_overlay.js` strokes
  its band with, so drawn-as-road and no-spawn-here can't drift apart). It sets
  no terrain: a masked cell keeps its biome and stays walkable, it just can't
  host a spawn. Every spawner consults it, by passing `opts.roadMask` to
  `WorldGen.isSpawnCell` (the shared rule) or reading the mask directly.
  **When you add a spawner, pass the mask.** Checking road TERRAIN alone is the
  bug, not the fix.
  **Audit it:** `node test/node/run.js` › `test/node/spawn_roads.test.js` runs
  the real rasterizer over synthetic MVT layers and fails if any object, wild
  plant or buried-X lands on a road cell or under a road band.
  **Nor on top of anything already there.** Road terrain and the road mask are
  half the "don't spawn here" rule — the other half is `opts.occupied`, a Set
  of flat cell indices (`cy*w+cx`, same shape as `roadMask`) already claimed by
  an object or wild plant. `spawnInTile` (app.js) builds it ONCE from
  `entry.objects` + `entry.wildplants` before any spawner runs and hands it to
  every one of them through the same `_spawnOpts` the road mask rides in on —
  so a trap can't spring under a rock sprite (the art is its only warning) and
  an X mark can't bury itself under a tree, undiggable until the tree is
  felled. Caves have always checked this directly (`Traps.spawnCave`'s
  `occupiedIdx`); `opts.occupied` is the surface side of the same rule, read by
  `WorldGen.isSpawnCell` right beside `opts.roadMask`. **When you add a
  spawner, pass both.**

- **The camera is not the player.** Since the peek drag (drag the map to look a
  few cells past the edge; it springs back on release), the viewport centres on
  a CAMERA ANCHOR — the player plus `scene.peekM`. The split is absolute:
  anything asking **"where do I DRAW this?"** goes through
  **`coords.js` › `viewAnchorWorldM` / `viewAnchorCell`** (or `worldMetersToScreen`
  / `screenToWorldMeters` / `cellScreenXY`, which already do), and anything
  asking **"where IS the player?"** keeps using `playerM` / `playerToWorldCell()`
  — reach, every tap gate, fog reveal, tile loading, the 3×3 tile scans. Mixing
  them is the bug in both directions: a draw pass left on the body tears that
  layer off the ground under a peek (the road bands, the building footprints and
  the reach glow each had to be re-anchored), and a gameplay test moved onto the
  anchor would let a peek reach three cells further than the arm does.
  Anything drawn AT the player rather than at a world position — the sprite, its
  shadow, halo, facing arrow, sword swing — reads `scene.playerScreen()`, never
  `viewCenterX/Y`. **When you add a world-drawn layer, anchor it; when you add a
  reach or gate test, don't.**
  A third case sits beside those two: a layer too expensive to rebuild per frame
  is cached about `viewCenterX/Y` and SLID by the peek (`setPosition(-peekPx)`)
  instead. That is fine, but a slid image must be drawn WIDER than the frame —
  by `PEEK_MAX_CELLS` cells, the drag's own clamp — or the peek pulls its outer
  edge into view. The distance falloff shipped stopping exactly at the viewport
  half-diagonal, so a drag put a hard circular arc of the darkness's own edge
  across the corner of the map. The lightmap (`src/lighting.js`) is drawn at
  the player's screen point every frame rather than slid, and its ramp ends ON
  ZERO — `PLAYER_RAMP_PAST_CORNER_CELLS` (one cell) beyond the half-diagonal,
  so the corners stay just lit — with the ambient floor past it the same value,
  so there is no edge for a peek to find. **When you cache a layer about the
  viewport centre and slide it, give it the peek margin.** Note that NOTHING
  slides today: `render.js`'s `peekPxOf` has no caller left, and every cached
  overlay (border, grid, fog, the road and building canvases) rebuilds on
  `viewAnchorCell` and shifts only by the sub-cell fraction. So this case is
  advice for the next such layer, not a description of a live one — do not go
  hunting for the slid layer it describes.
  **Audit it:** `node test/node/run.js` › `test/node/peek_drag.test.js` drives the
  lifted shipping code: the projection round-trip under a peek, that a tap lands
  in the cell it was drawn over, that reach is unmoved by the camera, that a
  pointer which dragged taps nothing, and that no viewport corner escapes the
  falloff rings at any peek angle.

- **The painter rule: the LOWER object (centre of mass) renders in front.**
  World sprites already obey it via the screen-row z-order in
  `src/render.js` › drawObjects (a sprite in a lower screen row always draws
  over one in a higher row). It governs hand-drawn geometry too — the castle
  rampart pieces sort by it (a south wall over the side bands, a north wall
  over the feet of side bands descending from the row above; see the tier-12
  pass in drawCells). When adding anything that overlaps vertically, derive
  its draw order from this rule, not from a hand-picked layer.
  `window.__RAMPART_DEBUG = true` tints the castle wall pieces apart
  (north blue / south green / sides red) when the stacking needs eyeballing.

- **Interactables must be clearly in one cell — and the TAP is the CELL, not
  the art.** There is no pixel hitbox anywhere in this codebase: every tap
  resolves through `coords.js` › `sameAbsCell` against the object's own data
  cell, so "collision box" here means nothing more than which cell the object
  records itself in. That is precisely why the art has to agree with it — a
  sprite that straddles a boundary is a thing the player must tap a cell away
  from where it appears to be. The seat rule below is the ENFORCEMENT and
  carries the real exemption list (buildings — house / tower / shrine /
  produce stands / pot-of-gold — plus moving actors); this bullet is the WHY,
  not a second mechanism, and its old "other than houses and fauna" was a
  narrower list than either the seat rule or `tools/sprite_audit.js` has ever
  used. If a sprite and its cell disagree, fix the anchor or the seat: there is
  no rect to adjust.

- **The "one cell" sprite-position rule.** For every world sprite EXCEPT
  buildings (house / tower / shrine / produce stands / pot-of-gold) and moving
  actors (creatures):
    1. The sprite's **visible art** (its opaque, trimmed bounds — NOT the frame
       box, which often has transparent padding) must **never cross the cell's
       bottom edge** (never overlap the cell below).
    2. Art that **fits** in the cell (height ≤ one cell) is **centred** vertically.
    3. Art that **doesn't fit** is seated with its **bottom 1px above** the edge.
    4. Art is **always centred horizontally** on the cell.
  This is enforced in code by the seat pass in `src/render.js` + the single
  source of truth in **`src/sprite_layout.js`** (`seatInCell` + the `ART_BOUNDS`
  trimmed-bounds table). To make a sprite obey it, give its `RENDER_SPEC` entry
  `seat: true` (the renderer computes `dxPx`/`dyPx` from the rule; `origin` is
  then just the no-SpriteLayout fallback anchor). For animated sheets, set
  `seatFrame` to a stable frame so the art doesn't bob.
  **Audit it:** `node tools/sprite_audit.js` (also run as part of
  `node test/node/run.js`). It decodes the real PNGs, checks `ART_BOUNDS` hasn't
  drifted, and verifies every seated sprite obeys the rule. When art changes,
  regenerate the table with `node tools/sprite_audit.js --emit-bounds` and paste
  it into `src/sprite_layout.js`.

- **What the art SHOWS is what it DROPS.** A sprite variant is not free
  cosmetics when the variants differ in COUNT. The plain rock's four looks
  (mineralrock sheet row 15, cols 3..6) include one that draws a PAIR of
  stones — and until Sep 2026 the variant was a bare `(x+y) % 4` hash in
  `render.js` while every plain rock dropped the same `randInt(1,3)`, so the
  double rock could hand you one and a lone pebble could hand you three. The
  answer is the same discipline as `roadOverlayWidthM`: **one table both sides
  read**. `SpriteLayout.PLAIN_ROCK_VARIANTS` carries `col` (what render.js
  draws) beside `stones` (what `plainRockBaseDrop` pays, `stones + randInt(0,1)`),
  and both callers (`SpriteLayout.plainRockFrame` for the draw,
  `SpriteLayout.plainRockStones` for the drop) resolve the variant through the
  one internal `plainRockVariant` so they can't pick different rocks. A surface with no rock sprite promises
  nothing and passes `stones = null` for the old flat roll — that's the cave
  WALL dig, not a rock. Note the pair is one connected blob, so no pixel pass
  can count it: `stones` is authored, and the tripwire if the sheet is re-cut
  is the `ART_BOUNDS` width drift check in `tools/sprite_audit.js`.
  **And say the real number.** The plain-rock toast read `+1 Rock` while
  handing over three — if a loot path rolls a quantity, its flash prints that
  quantity.
  **Audit it:** `node test/node/run.js` › `test/node/rock_yield.test.js`.

- **A frame index is not a frame COUNT — list the art, never count the cells.**
  A sprite sheet is a grid, and nothing in the renderer can tell a cell holding
  a sprite from one holding nothing. `CROP_SPRITE.shell` said `variants: 12`
  because Shell.png is 3×4 — but only its TOP ROW is shells (three cowries);
  the rest is three keyline duplicates, two flat mask rows and four BLANK
  cells, the same layout `Gemstones.png` has. So the beaches were empty: the
  renderer drew `hash % 12` and most shells landed on a blank frame — a pickup
  you could tap but not see. The answer is the `PLAIN_ROCK_VARIANTS`
  discipline: **`frames: [0, 1, 2]`**, the frames that carry art, listed.
  **And the hash must read the whole KEY.** The same pass hashed `_ix`/`_iy` —
  which `rasterizeTile`'s occupancy pass DELETES before the entry is ever
  drawn — XORed with the wildplant id's `.length`, one number for a whole tile,
  so every shell on a beach drew the same frame chosen by how many digits its
  cell index happened to have. One resolver owns it now
  (**`items.js` › `wildplantFrame`**, off `util.js`'s `fnv1a` of the id, the
  same stable key a reload and a tile rebuild both reproduce), and the
  renderer asks it rather than rolling its own. The shiny twinkle's phase was
  the same `.length` hash one function over — a "desync" that put every shiny
  in a tile in unison. **When a look varies per cell, hash the id, not its
  shape; and when a crop varies, list its frames.**
  **Audit it:** `node test/node/run.js` › `test/node/shell_variants.test.js`
  (the resolver over a real rasterized beach) and `node tools/sprite_audit.js`
  › `wildFrameRows`, which decodes the real PNG behind every frame a
  `CROP_SPRITE` entry declares and fails if it is off the sheet, transparent,
  or a single flat colour — and refuses a bare `variants` count outright.

- **A tilled cell is one BAKED bed, never a per-frame rounded path.** The
  soil is the `tilled_N` texture (`textures.js` › `drawTilledTex`): an opaque
  pad inset `TILLED_INSET_PX` from every edge with `TILLED_CORNER_PX` corners
  and a transparent ring, so each cell reads as its own bed with the ground
  colour showing between neighbours, and `render.js` paints NO soil fill under
  it. Until Sep 2026 it painted one — and at a sand/residential zone corner it
  was a `fillRoundedRect` wearing the ZONE's radii, which Phaser tessellates
  into ~400 points and triangulates every frame (cellGfx is cleared each
  frame). Any shape a cell wears every frame belongs in its texture, not in a
  Graphics path. The watered darkening is a TINT on that pad sprite
  (`WATERED_TINT`), set on every frame the pool sprite is reused: a wash under
  an opaque pad is hidden, and one over it darkens the ground ring too.
  **Audit it:** `node test/node/run.js` › `test/node/tilled_bed.test.js` runs
  the real `drawTilledTex` against a recording 2D context.

- **The creature "crown" rule (work wheel).** Creatures are exempt from the
  one-cell rule above (they're feet-anchored moving actors), but the
  work-progress wheel drawn over one is not free-floating: it **rests on** that
  kind's **crown** — the ring's TOP EDGE sits on the top row of its visible art
  at rest — so the whole wheel reads as sitting on the animal, at any size.
  An animal shorter than the wheel's diameter can't give up a full radius
  without the ring sliding off its feet, so the drop is capped at half the art's
  height and the wheel centres on its midline instead.
  It's derived, not tuned: the per-kind draw geometry (frame, scale, foot
  origin, constant float, trimmed art rows) lives in
  **`src/sprite_layout.js`** › `CREATURE_ART`, which `render.js` draws from and
  `app.js` places the wheel from via `creatureWheelDy(kind)`; the ring radius
  lives there too (`CREATURE_WHEEL_R`) so the number that draws the wheel and
  the number that seats it can't drift apart. Never re-tune the wheel with a
  flat px offset — one number can't fit a chicken and a cow, which is how it
  ended up 4px above the chicken and down at a perched crow's feet.
  **The wheel CENTRED on the crown until Aug 2026**, which left a full radius
  (10px) of ring in the empty sky above every animal — a constant overshoot, so
  it read as too high on all of them and worst as a fraction of the small ones.
  If you are tempted to centre it on the crown again, that is the bug.
  **Audit it:** `node tools/sprite_audit.js` (also in `node test/node/run.js`)
  re-decodes the creature PNGs and fails if `CREATURE_ART` has drifted from the
  art, if a wheel has left its seating, or if any ring floats above a crown it
  is tall enough to sit on.
  **Enemy health is a BAR, not the wheel's ring.** The health readout over a
  wounded enemy (`_drawEnemyHealth` / `_drawEnemyHealthBar` in `app.js`, worn
  bright by the combat wheel's own target in `_drawWorkProgress`) is a small
  strip floating a fixed gap ABOVE the kind's crown — deliberately a different
  shape on the other side of the crown from the work wheel, so a fight and a
  job can't be misread for each other. Its seating is derived the same way the
  wheel's is: `SpriteLayout.creatureHealthBarTop(kind)` + the
  `HEALTH_BAR_W/H/GAP` constants live in `src/sprite_layout.js`, off the same
  `CREATURE_ART` table. Never seat it with a flat px offset, and never draw
  health as a ring again. Damage lands as floating "-N" popups
  (`_popDamageNumber`, fed by `_damageEnemy` on a `DMG_POPUP_BEAT_MS` throttle
  that accumulates the melee wheel's per-frame fractions into whole numbers).
  **Audit it:** `node test/node/run.js` › `test/node/health_bar.test.js`.

- **Combat is HIT POINTS, and the numbers are derived.** Fighting an enemy is
  not a timer any more: `src/combat.js` owns one HP pool per foe that the melee
  wheel, bow/staff shots and a pet's teeth all drain. The damage rates are NOT
  tuned — they're pinned to the old timed wheel by the identity
  `dps = 15000 / toolDurationMs`, so a weapon tier still kills a given foe in
  exactly the time it used to, and one shot carries one second of that rate.
  If a fight feels wrong, change `TOOL_DURATION_MS` or the kind's `hp`; adding a
  fudge factor in combat.js breaks the correspondence the tests pin.
  **"Enemy" is narrower than "defeatable".** Enemies (`Combat.isEnemy`) are the
  wild slime and the cave monsters — things that attack you. Crow and deer are
  GAME: nothing auto-fires at them and no shot may hit them, or hunting stops
  being a choice. A sapphire-tamed slime (`released_*`) is a pet, never a
  target. **When you add a hostile kind, put it in the monster table** — that
  registration is what makes it an enemy everywhere at once.
  **Audit it:** `node test/node/run.js` › `test/node/combat.test.js`.
  **ARMOUR IS THE OTHER SIDE OF THAT POOL, and it soaks — it does not grow the
  bar.** Until Sep 2026 each worn piece added `energyPerTier × tier` to the max
  ENERGY, which is a bigger tank rather than better protection: it paid a player
  who never fought exactly what it paid one who lived underground, and no amount
  of it made a goblin's bite land any softer. A piece now contributes **its
  TIER** to a reduction pool (`items.js` › `armorSlotReduction` /
  `armorReduction` — every slot pays the same for a tier and they differ only in
  PRICE), and `Combat.mitigate` spends that pool against a blow in
  `MITIGATION_ROUNDS` passes: soak up to HALF the damage, halve what is LEFT of
  the pool, soak up to half of what is left of the blow, four times over.
  Halves round DOWN and `MIN_PLAYER_DAMAGE` is the floor, so four halvings cap
  armour at 15/16ths of a hit however good it is — nobody ever out-equips the
  game. **The mode and the potion scale the blow BEFORE armour spends against
  it** (`Difficulty.enemyDmgMul`, the shield's halving), so a hard-mode hit is
  soaked as a hard-mode hit.
  **Two rules keep the ladder legible, and both were learned by shipping it
  wrong for a day.** First, **the soak is LINEAR and lives on the damage's own
  scale**: everything that hits the player deals 1..4 (`MONSTERS[].dmg`),
  doubled for an elite and again on hard — the whole damage space is **1..16**.
  It shipped as tier SQUARED, which put a full Frost set at 196 against that, so
  every tier from Iron up flattened every blow to the floor and the entire
  ladder above Wood was invisible. A quadratic soak needs damage numbers an
  order of magnitude bigger than this game has. Second, **the pool is SPENT, not
  re-charged**: handing each round the full halved pool afresh lets P soak
  `P + P/2 + P/4 + P/8` ≈ 1.9P, so a full Wood set (4) took SEVEN points off a
  blow — more than most blows are worth. What survives a round is halved before
  the next, the total can never exceed the pool, and the halving does its work
  by decaying the UNSPENT remainder. Between them a T1 piece is a flat −1 on
  every blow and every rung of the ladder still tells against the worst hit in
  the game. **If armour ever stops discriminating between tiers, check those two
  before retuning anything.**
  There are exactly three places a foe reaches the player — the surface slime's
  leech, a cave monster's melee, and a goblin archer's arrow — and all three go
  through `Combat.playerDamage(dmg, this.save.armor)`. The arrow passes
  `shot.hits` as well: it carries `MONSTER_ARROW_HITS` hits of the table in one
  projectile so its damage per minute matches the melee cadence it stands in
  for, and soaking that bundle in ONE lump would hand the parity straight back —
  the archer would become the one foe armour barely helps against. **When you
  add a way for something to hit the player, mitigate it**; a raw
  `save.energy -= dmg` is the bug. And what a piece soaks is printed ON the
  piece (the Stats row, the shop offer) from `armorSlotReduction` — one table,
  both sides, the `roadOverlayWidthM` discipline.
  **Audit it:** `node test/node/run.js` › `test/node/armor.test.js`.
  **NOTHING HUNTS A BODY.** At zero energy the player has collapsed: the reach
  is 0 (`coords.js` › `reachRadiusM`), so nothing can be tapped, swung at or
  dug, and all three of those damage paths already refuse to take a point off
  an empty bar. A foe that goes on stalking one is chasing something it is
  forbidden to bite — and on hard, where nothing but Home lifts the bar off
  zero, it escorts the player the whole way home. So a downed player is not
  THERE to be hunted, exactly as a Shadow Powder makes them:
  `wanderCreatures` ORs the two wards once per tick into **`unnoticed`**
  (`Combat.playerDowned(save.energy)` beside `shadowed`) and every
  hostile-interest branch reads that — the leech, the monster's hit and arrow,
  the struck slime's charge, and both stalk branches, each falling back to the
  aimless wander. It is ONE expression on both sides, the `roadOverlayWidthM`
  discipline: the test that drops the pursuit is the same one that refuses the
  damage, so a foe can never be chasing a player it cannot hurt. **When you add
  a hostile behaviour that takes an interest in the player, gate it on
  `unnoticed`, not on `shadowed`.**
  **Audit it:** `node test/node/run.js` › `test/node/downed_pursuit.test.js`.

- **A tile build stutters on its WORST BLOCK, not its total.** The rasterizer
  is a generator (`rasterizeTileSteps`); the slicer can only hand the frame
  back at a `yield`, so one pass that runs straight through freezes the game
  for exactly as long as it takes, however small the budget is. The boot
  profile names it — `worst block <N>ms in <label>` — and the label is the
  yield the block ENDED at, i.e. the culprit is the code just before it.
  Three of these have shipped now: the building cover scan, the wildplant
  sweep, and the merged-house thinning (`worst block 1397ms in after the layer
  loop`, an O(H^2) scan of the kept roofs, now a Set of cells). The two shapes
  to watch for are a **quadratic** (a scan of everything kept so far, or a
  `splice` per rejection inside a reverse walk — compact in place instead) and
  a **helper called plainly from the generator** that walks a whole polygon
  (make it a `function*` and `yield*` it, as `spawnDebrisSteps` and
  `_spawnRockClustersSteps` are).
  **When you add a pass over every cell, object or polygon, give it a yield.**
  **Audit it:** `node test/node/run.js` › `test/node/tile_build_blocks.test.js`
  times every step of a real build over a 3000- and a 6000-building tile and
  fails if any single block runs long.
  **The post-rasterize path in `loadTile` has no slicer at all** — the
  cross-tile dedup, the cave entrance, the Overpass bin injection all run
  straight through when the rasterize resolves, and they are charged to no
  span narrower than `neighbour ring (in the background)`, so a profile can
  only point at them by elimination. Anything there must be O(n) by
  construction: the house dedup was a scan of every house in every cached tile
  per house of the new one (six frames over 100 ms, worsening with each tile
  the ring added) and is a bucket grid now — `collectDedupIndex`'s `houseNear`
  / `addHouse`, never a walk of `housePositions`.
  **Audit it:** `test/node/worldgen_dedup.test.js`.

- **A tile can be REBUILT under you, and a rebuilt entry is a NEW object.**
  When a tile rasterizes before its Overpass bin arrives, `rebuildTileWithBin`
  builds a replacement and swaps it into the cache. It carries over only what
  it cannot reconstruct — live `creatures`, `coinDrops` — so ANY other state
  app.js hung on the old entry is gone, and `spawnInTile` has to run again.
  That pass is therefore gated on **`entry._spawned`**, a flag the rebuild does
  NOT carry, never on carried state: gating on `entry.creatures` made a
  rebuilt tile look spawned, and the starter crates, the buried X, the treasure
  scatter and the fruit trees all vanished a few seconds into the session and
  "came back on refresh" (on reload the bin is cached, so no rebuild happens).
  This is the third bug of the shape — the chest dedup, then the house dedup,
  now the spawn gate. **When you put per-session state on a tile entry, decide
  what a rebuild does with it**: carried across, or re-derived by a pass that a
  flag the rebuild drops will re-run.
  **Audit it:** `node test/node/run.js` › `test/node/spawn_rebuild.test.js`
  runs the shipping gate line against a rebuilt entry. Note that
  `starter_relic.test.js` drives `_placeStarterTrail` directly and passed
  throughout the bug — the trail was fine, the CALL to it was not.

- **The tile URL is RESOLVED, never pinned.** OpenFreeMap serves each weekly
  planet build from a dated directory (`/planet/20260520_001001_pt/…`) and its
  host keeps two versions, deleting the rest — so a version baked into
  `src/worldgen.js` stops answering within weeks, and it fails as a NETWORK
  error, not a tile 404 (there is no location block for a gone version). That
  was "can't reach the map — tap to retry" on a blank ground that no tap could
  clear, invisible to anyone whose home tiles were already in IndexedDB.
  `WorldGen.resolveTileUrl` asks the TileJSON (`TILEJSON_URL`) for the live
  template at the first fetch, remembers it in IndexedDB for a day, and
  `fetchTileResponse` re-asks it ONCE when a tile fetch fails — a rotation
  mid-session heals on the next tile. `TILE_URL_FALLBACK` is only the
  last-known-good for an offline first run; bumping it is never the fix.
  **Every tile fetch goes through `fetchTileResponse`** — a raw
  `fetch(tileUrlFor(...))` anywhere else is the bug coming back.
  **Audit it:** `node test/node/run.js` › `test/node/tile_url.test.js`.

- **A module's `?v=` is DERIVED from its bytes — never typed, never bumped.**
  `index.html` loads ~43 same-origin scripts at versioned URLs, and the version
  is the ONLY thing that invalidates them: the URL is what the browser's HTTP
  cache matches on, so a module whose content changed while its `?v=` stood
  still keeps serving the OLD file to everyone who already has it — beside a
  fresh `app.js` that calls into it. That is a crash with no stack in the
  changed code and no repro on a cold cache.
  It shipped in Sep 2026 as **`Combat.playerDowned is not a function`**: the
  commit that added `playerDowned` to `src/combat.js` and its five call sites
  to `src/app.js` never touched index.html, and the merge that landed it
  resolved index.html by hand and carried only app.js's bump across, so
  combat.js stayed at `?v=15`. Bumping `SHELL_VERSION` does not reach it —
  that drops the service worker's shell cache, but the HTTP cache underneath
  still matches the byte-identical URL. An audit of every tag at the time found
  **fourteen more** modules changed since their last bump, each the same latent
  crash waiting for app.js to call into it.
  A hand-typed counter cannot be right by construction: it records what somebody
  remembered rather than what changed, and it collides on every merge — two
  branches both bumped `app.js` to `v=531` and `SHELL_VERSION` to `shell-v182`
  for different content, which is a second way to serve a stale file. So the
  number is derived: **`tools/cachebust.js`** writes each `?v=` as 8 hex of the
  file's own sha256 and `SHELL_VERSION` as a hash of the resulting list, so it
  moves when any module does and only then. What ships and what the URL claims
  are one value read twice — the `roadOverlayWidthM` discipline pointed at the
  tags. A merge cannot collide two hashes, because the hash follows the MERGED
  content rather than either side's counter.
  **`node tools/cachebust.js --write` after the last edit** is the whole
  workflow; there is no number to choose and `vendor/phaser.js` is covered too.
  **Audit it:** `node test/node/run.js` › `tools/cachebust.js`'s own CHECKS
  (node scope, like the sprite and shell audits — the `*.test.js` sandbox has
  no `require()`). The first names every stale tag and fails the suite so the
  drift can't ship; the rest pin the derivation under it, since that check is
  only as good as the hashing it asks.

- **The player's FEET are on the GPS fix.** `playerM` is the projected fix,
  and every world layer (ground cells, the road band, the building polygons)
  is drawn in that one frame with the fix at `viewCenter`. The player sprite
  is seated so its visible feet land ON that point: `playerFeetNudgeY` (app.js
  create()) is the NEGATIVE of the frame's feet drop, the sprite is drawn that
  much above `viewCenter`, and `feetOffsetM` is 0. Ground marks — the contact
  shadow, footprint dots, the GPS crosshair, the walk target, a peer's shadow
  in `multiplayer.js` — sit on the point itself; anything that wants the
  body's centre (the facing arrow, the dragon timer, the swing arc, the halo)
  adds `playerFeetNudgeY` to it. **Until Sep 2026 the sprite was CENTRED on
  the fix** and the feet hung 14px (3 m) south of it, with every ground mark
  carrying its own +13/+14 to follow them down — so standing on a road's
  centreline put the band through the character's waist and the whole map
  read as shifted a body-length north of where you stood. If the map looks
  offset from the feet along one axis, the seating has drifted; never fix it
  by moving the projection or by re-adding a per-mark offset.
  The road band's WIDTH is a different question: it is drawn at true scale
  (`widthPxFor` = metres × CELL_PX / cellM) from the per-class guess table in
  `WorldGen.roadWidthM` (the tiles carry no width tag), so a band that reads
  too narrow or wide against the real street is that table's number to change.
  **Audit it:** `node test/node/run.js` › `test/node/feet_anchor.test.js`
  pins the seating as source text (app.js can't load headlessly).

- **Every wait the player can read is `shortDuration`.** One notation, one
  helper: the LARGEST unit that applies, an integer, and a unit letter —
  `20d`, `3h`, `30m`, `12s`. Never a compound (`1h 5m`), never a bare number,
  never `0m` while the gate still refuses (the ceil cascades, so 59.5 minutes
  is `1h` and the smallest pending wait is `1s`). It lives in
  **`src/util.js`** › `shortDuration`, beside `msToNextUtcDay` — the companion
  for anything gated on a UTC day key (`Delivery.dayKey`, the castle favour,
  the coin-burst POIs), because "come back tomorrow" is twenty hours or twenty
  minutes and the player can't tell which.
  Until Sep 2026 there were FIVE shapes for the same question: the fruit tree
  rolled its own `d`/`h` ladder, the produce cooldown printed `(43m)`, the shop
  plaque `12m`, the crop badge a **bare `7`** with no unit at all, and the
  delivery house, the castle, the coin-burst POI and the resting anvil gave no
  number whatsoever. A shop's wait is the one number two call sites both draw
  (`ShopsMath.readiness().waitMs` for the plaque, `shopWaitLabel` for the tap),
  so both format the same ms — the `roadOverlayWidthM` discipline again.
  **When you add a timed thing, format its wait with `shortDuration`** — and if
  it has no readout at all, that is the bug, not a style choice.
  **Audit it:** `node test/node/run.js` › `test/node/duration_notation.test.js`
  pins the formatter and sweeps the call-site sources for a re-grown ladder or
  a fresh unquantified "tomorrow" / "later".

- **An energy number lands ON ITS CELL, by the player.** Every `+N⚡` / `−N⚡`
  goes through `app.js` › `_popEnergy(delta, { ix, iy })`: the absolute cell
  the change belongs to (the plot a till paid for, the wall a dig cost — a
  spend resolves it from the TAP via `_cellAtScreen`), defaulting to the
  player's own cell when the change is to the body (a rest tick, a slime's
  leech, the offline refill). It seats through the projection
  (`_energyPopAt` → `_cellToastAt` / `playerScreen`, never `viewCenterX/Y`),
  hangs just clear of the cell's top edge — or of the player's HEAD on their
  own cell, `ENERGY_POP_HEAD_PX`, derived from the walker's frame and feet
  drop, `_isPlayerCell(ix, iy)` being the test that picks the body — so where
  the number hangs is what tells the reader WHICH cell. **The number is the
  whole mark: nothing is drawn on the ground.** A thin outline used to tick on
  the cell under it in the same ink, which read as a flash of red or green
  damage on whatever you had just tapped; it was removed in Sep 2026 along
  with `_flashCellOutline`, and adding a ring back is the bug returning.
  It wears the `cell` toast tier: bold, stroked and
  drop-shadowed, no chip, because it sits on any ground at all. Until Sep
  2026 the rest splash was a note at the viewport centre minus 70px and the
  drains sat 40px above the same point — nowhere in particular, and under a
  peek drag two cells from anyone. **When you add an energy gain or loss the
  player can see, pop it with `_popEnergy` and name the cell** — a `flash` of
  a ⚡ number at the viewport centre is the bug coming back.
  **Every other number on the map is the same thing.** `_popEnergy` is the
  ⚡ face of `_popCellNumber(text, color, ix, iy)`, which the coin pickup's
  `+$1` uses on the coin's cell (it used to flash at the finger, which is
  over the coin only until it lifts). The foe's `-N` (`_popDamageNumber`)
  stays on the foe's health bar — that IS its cell — but is a `damage` row
  of the same `TOAST_TIER` table, so it wears the same stroke and shadow;
  it was a hand-set `add.text` beside the table with no shadow. **A number
  drawn on the map is a `_toast` tier, never its own `add.text`**, and it
  names the cell or the foe it is about.
  **And the body flinches.** A blow on the player (the slime leech, a
  monster's melee, an arrow in `_shotHitsPlayer`) calls `_flashPlayerHit`
  at the instant it lands — never from the throttled pop, which rolls a
  second of bites into one number — and `_updatePlayerAura` flicks the
  character red for `HIT_FLASH_MS` on TWO channels: the sprite tint and the
  halo's red texture, because `setTint` is a no-op under Phaser's Canvas
  fallback and a tint-only flinch is invisible there. **When you add a
  drain on the body, call `_flashPlayerHit` where the loss is banked.**
  **Audit it:** `test/node/hit_flash.test.js`.
  **Audit it:** `node test/node/run.js` › `test/node/energy_pop.test.js` runs
  the lifted seating on a stub scene (cell edge, head clearance, peek) and
  pins the call sites and the tiers as source text.

- **Working is not resting.** The passive rests in `app.js` update() — Home
  (`HOME_FULL_REST_S`) and campfire warmth (`FIRE_FULL_REST_S`) — pause while
  a work wheel runs (`const working = !!this._workProgress`). Until Sep 2026
  they didn't, and a new player's first till was free: the starter trailer is
  dropped under the player at spawn, the starter plot is carved two cells from
  it inside reach from the trailer's own cell, and the Home rest ticked at
  ~1.1⚡/s under a 2.25 s wheel that had cost 2⚡ — the bar read the same
  number before and after. Never fix a "free" job by raising its cost or
  slowing its wheel; the rest resumes the moment the wheel clears, and that
  is what earns the energy back. **When you add a passive energy source,
  gate it on `working`.**
  **Audit it:** `node test/node/run.js` › `test/node/rest_work.test.js` pins
  both gates as source text and shows the ungated rest out-earning the till.

- **The world is GENERATED; the save is only what you CHANGED.** Every
  interactable outside the starting area is a pure function of WHERE it is.
  `WorldGen.makeRng` is a mulberry32 seeded from integers, and the integers are
  the tile's coordinates (`HASH_MUL_X` / `HASH_MUL_Y`), its depth underground,
  and a per-stream salt constant — the traps, the X-mark scatter, the cave
  rocks and flora, the cave monsters and their coins, the chest tiers, the POI
  loot, the wild plants, the lairs, the rock clusters. There is **no global
  world seed** and no stored object list, and that buys three things at once: a
  tile evicted from the cache and rasterized again lays the identical world, a
  tile REBUILT under the player (see the rebuild rule below) lays it again
  unchanged, and two players standing on the same real street see the same one.
  So a new interactable belongs in exactly one of three buckets, and saying
  which is the whole design decision:
    1. **GENERATED** — where it is, what tier it is, what it drops. NOTHING
       reaches the save. This is the default and it should stay the default:
       storage is what makes a world diverge from itself.
    2. **THE DELTA** — what the player DID to a generated thing, as a list of
       exceptions and never a copy of the thing: `caught`, `chopped`, `picked`,
       `opened`, `sprungTraps`, `disarmedTraps`, `brokenRocks`,
       `foundTreasures`, `dugWalls`, `tilled`. The generator still lays the
       thing every time; the list only says "…except that one".
    3. **PLACED** — things that exist because somebody PUT them there, which no
       coordinate can re-derive, so they are stored in full with their
       positions: `planted`, `fruittrees`, `placedRocks`, `scarecrows`, `fires`,
       `released`, and the starting area the game lays down once
       (`starterTrailer` / `starterShopId`, `starterCratesAt`, `starterPlotAt`,
       `starterPondAt`).
  **Bucket 2 rests entirely on the ID**, so an id must be derived from POSITION
  — never from a counter, an array index or `Date.now()`. A re-rasterized tile
  has to mint the identical id or the delta stops applying and the "dead" thing
  walks back in. The pest crow is the one exception and it proves the rule: its
  id comes off `Date.now() + Math.random()` and is never minted again, which is
  why `wanderCreatures` PRUNES its marker when the tile leaves the cache
  instead of keeping it forever like every other id in `save.caught`.
  **The SEAT is location-keyed; only the CONTENTS may be salted.** A per-save
  salt (`save.relicSalt`) is mixed into what the starter chest HOLDS and what
  the quest board offers, so a reset rerolls the prize — while the seat stream
  stays purely positional, so the chest sits where it always sat and a rebuild
  mid-save reproduces both. Salt the roll, never the position.
  **And each spawner seeds its OWN stream** rather than drawing from the
  caller's: `spawnInTile` and `spawnCaveCreatures` are long chains off one rng
  (fauna, then treasure, then the path bonus…), so taking numbers out of one
  would re-roll every world seed downstream of it. A separate stream costs
  nothing and leaves every existing world exactly as it was.
  **Audit it:** the determinism pins — `test/node/traps.test.js` ('a cave level
  is deterministic per (tile, depth)', 'same ids, in the same order — a rebuilt
  or re-rasterized tile is identical'), `test/node/cave_coins.test.js` ('the
  pass is deterministic per tile and depth') and `test/node/beach_treasure.test.js`
  ('same tile, same seed, same marks').

  **A trap is the sharpest instance: generated, never stored — until it is
  sprung.** Where the traps are (`src/traps.js`) is that pure function of tile
  coordinates and depth; the only things that ever reach the save are
  `save.sprungTraps` (the ids of the ones stepped on, which keeps a discovered
  trap discovered across a reload, an eviction and a rebuild) and
  `save.disarmedTraps` (spent with a Trap Disarm Kit — a removed trap stays
  removed). Surface traps go ON THE VERGE, never on the road: roadside-ness is
  `Traps.isRoadside` over **`entry.roadMask`** and the seat is cleared by
  `WorldGen.isSpawnCell` with the tile's own `_spawnOpts` — the road rule
  above, not a copy of it. Cave traps sit around the up-staircases (the
  monsters' and coins' anchors) and never under an object sprite, since down
  there the art is the only warning. The per-frame tick reads
  `playerToWorldCell()` — the FEET, never the peek anchor — and both costs pop
  through `_popEnergy` on the trap's own cell.
  **Audit it:** `node test/node/run.js` › `test/node/traps.test.js`, which also
  runs both procedural textures against a recording 2D context and fails if the
  hidden one stops being subtle or either leaves its cell.

- **Light ADDS, darkness doesn't — the lightmap is the only lighting pass.**
  Until Sep 2026 the lighting was five Graphics workarounds for "Phaser has no
  gradient primitive": a fillRect per unlit cell, a second wash over the lit
  cells underground, a pink wash at low energy and ~100 cached strokeCircle
  falloff rings. All of it painted DARKNESS, which
  composes one way only (two dims overlap darker), so a campfire could never
  be built out of it. `src/lighting.js` replaced the lot with one model:
  a viewport-sized CANVAS texture (`scene.lightTex`, shown by the
  `scene.lightMap` image, app.js create()) filled with the ambient floor,
  every light source adding its baked radial-gradient cookie into it with
  `'lighter'`, and the whole thing MULTIPLIED over the world from ABOVE the
  sprites — so a house or a tree outside every light goes as dark as the
  ground it stands on, and `Render.spriteTint` must never compose the reach
  dim onto a sprite again (that darkens a wreck twice). It is a 2D canvas,
  not a RenderTexture, on purpose: the cookies drawn through Phaser's
  render-texture batch came back cut and quadrant-scrambled on some GPUs,
  and a canvas composites the same way everywhere.
  **The plateau is per cell.** The lit area's sharp edge is painted with
  `cellInReach`'s own expressions over every reach cell, so it IS the
  staircase the white outline traces and the tap gate accepts; only the
  falloff outside it is a circle. A circle for the plateau is the bug.
  Inside the staircase the plateau is NOT flat: the fill is a radial
  gradient about the feet (`plateauFill`), full `lit` at the player and
  `PLATEAU_FALL` of it gone by the reach rim (`plateauLevel`, quadratic so
  the middle stays flat), clipped by the per-cell path so the edge is still
  exact. It is shading, not a second falloff: the test pins that the step
  off the plateau to `edge` outweighs the fall across it at every depth and
  hour. Deepen the look through `PLATEAU_FALL`; if the rim ever needs to be
  darker than that step, that is a reach-affordance change, not a lighting
  tweak.
  **The numbers are derived, not tuned:** `Lighting.profile` builds the
  ambient, the plateau and the edge level from the same
  `Render.reachDimColor` / `reachDimAlpha` the old wash painted with plus the
  falloff pair (`FALLOFF_A` / `FALLOFF_P`), so the surface with only the
  player lit looks as it did — except the FLOOR, which `AMBIENT_K` scales
  down for contrast ("totally unlit areas should be darker"), and the two
  OUTPUT knobs, which say how much of that reproduced wash the player's own
  light gives back: `PLAYER_OUTPUT_K` for the ramp OUTSIDE the reach area
  (`edge`, and the falloff hung off it) and `PLATEAU_OUTPUT_K` for the reach
  area itself (`lit`). Retune a look through those; `AMBIENT_K` is the
  contrast knob, and a further factor added in lighting.js breaks the
  correspondence the test pins.
  **The two output knobs are two numbers because the picture wants opposite
  things of them.** They were one until Sep 2026, and dimming the mid-field so
  the placed lights — a campfire, Home, a POI — would tell against the body
  took the ground the player actually WORKS on down with it. Splitting them
  costs none of the relations the shared knob was keeping, because raising
  `lit` alone only widens them: the falloff's shape is `edge`'s alone,
  `PLATEAU_FALL` is a fraction of `lit` so the plateau's easing scales with
  it, `lit > edge` holds by a bigger margin, and the step off the plateau
  grows faster than the fall across it. **And `PLATEAU_OUTPUT_K` is a CEILING,
  not a taste:** the plateau ADDS over the ambient floor, which at noon is
  already `AMBIENT_DAY_LUM` bright, so past 0.60 the reach area clips to white
  and takes `PLATEAU_FALL`'s shading with it. The number was measured over
  every `COLORS` × `DUST_OF` pairing the biome palette can produce (the
  tightest is 0x35261e, the most saturated dim in the world, at 0.602), not
  eyeballed — **re-measure it before raising it, and re-measure it if the far
  field is ever brightened again.**
  **The floor's DAY end is a level, not a scale.** `AMBIENT_DAY_LUM` (0.40) is
  what unlit ground is WORTH at midday — 40% of the art's own brightness, read
  off the screen — and `atLuminance` puts the derived floor there by mixing it
  toward white. A multiplier could not say that: the floor is the biome's dim
  colour, so one number landed at a different brightness in every biome, and
  raising it scaled channels that overflow their byte. The NIGHT end is
  untouched by construction — its target is `AMBIENT_K` × the floor's own
  luminance, which `atLuminance` reaches by scaling, the exact expression it
  always was. **State a look you can see as a luminance; keep `AMBIENT_K` for
  the contrast between them.**
  **The surface picture is HIGH NOON, and the real sun darkens it.**
  `Lighting.daylight(scene, now)` is 0..1 from the sun's elevation at the
  player's lon/lat (`sunElevationDeg`, recomputed once a minute), a twilight
  ramp from `DAY_ELEV_DEG` down to `NIGHT_ELEV_DEG`; `profile(scene, daylight)`
  moves the out-of-reach wash toward `NIGHT_DIM_A` and drains its biome tint
  to `NIGHT_TINT_KEEP`. The reach plateau is NOT darkened — it is the Inner
  Light — and caves ignore the sun. `window.__DAYLIGHT = 0..1` forces it for
  eyeballing. `profile()` with no daylight is noon, which is what keeps the
  derivation tests clock-free.
  **The light table is `Lighting.KINDS`**, one row per source: the player, Home
  (`trailer` — the starter trailer or the house adopted in its place), a
  restored building (keyed on the SAME `isClaimedKey` test the derelict wash
  reads, so it lights the frame its wash lifts), a campfire whose radius
  IS `FIRE_REST_R` — stand in the light, stand in the warmth — and every live
  POI, a small treasure blue-white light breathing on `POI_PULSE_PERIOD_S`
  with a per-id phase: that IS the old halo ping (the ring layer, its pool
  and its texture are gone), so a place reads from across the map by its own
  light in the dark, never by a ring drawn back under the pad — and a STREET
  LAMP every `Streets.lampSpacingM()` metres of restored street (the `cobble`
  row; that is the STREET's own constant, 100 m, deliberately NOT the prize
  ladder's 200 m rung — see the street rule below, and never retype the
  number here). **When you add a light source, add a row and return its kind from
  `Lighting.sourceKind`** — or, for a light that is a POINT rather than a
  scanned object (a placed fire, a lamp), a collector of its own called from
  `draw()` beside `collectFires` / `collectLamps`;
  the collector culls at `halfM` + the row's own radius, not the sprite cull,
  so a lantern a cell off-screen still lights the edge.
  **THE LIGHT IS THE AFFORDANCE — there is no reach outline any more.** A
  white line (2px, 0.15 alpha) was stroked over the same staircase on
  `reachGfx` until Sep 2026, and `Render.reachOutlineCell` + a per-cell
  `isReach` loop + an arc helper existed to draw it. It made sense while
  `PLAYER_OUTPUT_K` had the plateau at a bit over half its light and the
  boundary needed underlining; once `PLATEAU_OUTPUT_K` lit the reach area back
  up, the line and the light were two drawings of one boundary and the line
  was the louder. The plateau is painted per reach cell from `cellInReach`'s
  own expressions, rounded by the same `ReachCorner` rule the line rounded by,
  so what is LIT is exactly what the tap gate accepts — cell-exact, not a
  circle. **Never stroke a reach outline back on:** if the boundary stops
  reading, widen the STEP at its edge in `lighting.js` (that step is pinned to
  outweigh `PLATEAU_FALL` at every depth and hour), and check
  `PLATEAU_OUTPUT_K` before anything else. `reachGfx` now carries the
  unmapped-tile reveal alone, and `ReachCorner` keeps only the corner
  classification — `shortenH` / `shortenV` said where a STROKED edge stopped
  short of a round, and left with the stroke.
  **Audit it:** `node test/node/run.js` › `test/node/lighting.test.js` (the
  derived levels, the noon headroom the plateau knob is set at, the table, the
  collector, the source pins), `test/node/reach_corners.test.js` (the plateau
  rounds every corner of the staircase exactly once — and the outline is gone
  and stays gone) and `tools/layer_audit.js` (the lightmap above ground, halo
  and sprites, below the labels).

- **A message on the MAP is thirty characters.** `util.js` `MAP_MSG_MAX` is
  the budget for every `flash` / `flashLoot` — a toast drawn over the world, on
  a phone, read at a glance while the player is looking at the cell they just
  tapped. Past about thirty characters it stops being a glance and starts
  covering the thing it describes. **The budget is the whole rendered line**,
  including any name or number interpolated into it, and a `\n` toast gets it
  per line.
  So it is a real constraint on what a flash can SAY, and the answer when a
  line does not fit is to cut the sentence — never to wrap it. Anything that
  genuinely needs more room is a **modal** (`showMessageModal` /
  `showOfferModal`), where the player has stopped to read: that is why the
  consumable dialogs run to two clauses and their flashes do not.
  Two consequences worth knowing before you write one. **Do not interpolate
  anything unbounded**: a chest's POI name is arbitrary OSM text ('Saint
  Someone Memorial Library and Reading Room'), so the till refusal names the
  KIND instead. And when the budget forces a cut, cut the scaffolding, not the
  information — 'A tree stands here — fell it first.' lost four words and kept
  both the obstacle and the verb.
  **Audit it:** `node test/node/run.js` › `test/node/copy_voice.test.js`
  measures every static flash literal (a template is measured as its skeleton,
  since its real width is a runtime value), the terrain table and every till
  refusal, plus the name-bearing lines against the longest name the catalog
  can actually produce.

- **What an item DOES is written on the ITEM, not in the Book.** There are
  four description surfaces, and the player reads every one while HOLDING the
  thing, exactly when the answer is wanted: `ITEM_EFFECTS[id]` (the `✦ …` line
  under the selected stack), `RELIC_DEFS[slot].blurb` (the same line for a
  relic, plus the Stats panel's per-slot row), the Eat button's `+N⚡` for a
  food, and the Stats panel's `+N max energy` for armour. **`PLAY_TIPS` is not
  one of them.** A Book is a consumable: spending one to be told what the
  inventory bar was already showing is a wasted read, and the two copies drift.
  Until Sep 2026 a THIRD of the list was that — the Rope tip and
  `ITEM_EFFECTS.rope` said the same sentence twice, the Hoe tip was its blurb
  reworded, and one tip explained what a Book does, which you could only read
  by burning a Book. The drift was real and shipped: the Bow/Staff tip still
  said "one shot a second" long after `Combat.FIRE_INTERVAL_MS` was halved to
  2000, and the tool tip still said a Wood relic was "three times quicker"
  after `TOOL_DURATION_MS[1]` moved 3000 → 4000 ms (it is 2.25×).
  A tip carries what no single item can — where things grow, how a shop or a
  gate behaves, what an animal wants, what a readout means, a riddle. **When a
  tip and a description overlap, the description wins and the tip goes**; if the
  tip carried a fact the line didn't, move the fact onto the line (keep it
  short — the `✦` row is `nowrap` + ellipsis, so ~55 chars is the ceiling).
  **The one exception is the one SECRET.** What an item secretly does is not a
  description — printing it spoils it. `ITEM_EFFECTS.sapphire` read `Offer to a
  slime to tame it` until Sep 2026: the game's single real secret, on the
  inventory bar the instant anyone held a sapphire, while the gem's ADVERTISED
  use (the portal down, its own Portal button) went undescribed. The line names
  the portal now, and the taming is hinted in exactly one place — the closing
  riddle in `PLAY_TIPS`, which says "creature" before it says "slime". Nothing
  else names it: `ANIMAL_FOOD.slime` is unreachable through `animalLikesFood`
  in practice (a slime is an enemy, so `interact.js` takes the sapphire branch
  and then the combat branch long before the favourite-food path), so no
  "it wants X" hint can leak it. **When an item has a secret use, its ✦ line
  describes the open one.**
  **Audit it:** `node test/node/run.js` › `test/node/item_descriptions.test.js`
  sweeps every tip against every description for word overlap (three distinct
  words is a restatement), re-checks that the sweep still catches the six real
  tips deleted in the prune, pins that the facts they carried landed on the
  items, and pins the sapphire's one-hint rule.

- **Home is a CAMPFIRE YOU OWN, and its ring is ONE number.** A placed
  campfire lights, warms and repels on one radius (`FIRE_REST_R` — the
  `Lighting.KINDS.fire` row resolves to it). Home does the same three on
  **`HOME_R`**: the `trailer` light row resolves to it, `isRestingAtHome` is a
  plain distance test against it (`HOME_FULL_REST_S`), and `wanderCreatures`'
  `homeWard` turns every `Combat.isEnemy` foe inside it around and switches
  its bite off while it leaves. The lit circle IS the safe circle IS the
  circle you recover in, so the player reads the whole rule off the picture —
  three numbers would drift and two of them would be invisible.
  Home keeps the one thing a fire hasn't: the trade panel, which is a TAP on
  the building and no part of the ring.
  Two shapes to avoid. The rest was **two special cases that agreed on
  nothing** — an adopted house counted only from INSIDE (a building cell plus
  a nearest-house scan), the trailer only from its own snapped cell, and
  neither rested you on the DOORSTEP, which is where the player stands to work
  the starter plot. And the ward is an **angle away from HOME**, never a
  refused target cell like the scarecrow's: a foe deep inside the ring would
  have all six attempts rejected and freeze on the doormat (the stall the
  "surrounded by scarecrows" comment warns about), and away-from-PLAYER would
  drive a foe on the far side straight through the door.
  Where Home IS comes from **`homeWorldPos()`** — surface-only (the world is
  GPS-mirrored, so a Home must not ward a cave below it) and memoised on the
  home id, because all three effects ask every frame and the adopted-house
  branch is a walk of every object in every cached tile. Only a HIT is
  memoised; a miss just means the tile isn't loaded yet.
  **When you add an effect to Home, put it on `HOME_R`.**
  **Audit it:** `node test/node/run.js` › `test/node/home_ward.test.js` (the
  rest ring and the resolver run for real on a stub scene; the ward is pinned
  as source text) and `test/node/lighting.test.js` for the light radius.
- **And what NO item can say is written in the Book — truthfully, and often
  enough to be read.** The rule above says what to take OUT of `PLAY_TIPS`; this
  is what has to go IN. A mechanic the player cannot discover by looking at it —
  a derived number, a gate, a side-effect, a place that behaves differently —
  and that no single item's `✦` line can carry, is documented HERE or nowhere.
  The Sep 2026 audit found a long list living only in the code: the first-taste
  energy cap (`Energy.maxEnergy` reads `save.eaten.length`), the slow grind
  (`SLOW_GRIND_MS` / `_ENERGY`), the reach the dark takes back (`reachCells`),
  the roadside snares, the giants, the coin a kill pays (`enemyBounty`), the
  10% monster hoard, the chest Home rings (`CHEST_TIER_HOME_RINGS_M`) and depth
  promotion, the delivery premium (`DELIVERY_BONUS_MULT`), the three-slot quest
  board, the stall discount, pets hunting, castle turrets. **When you add a
  mechanic of that shape, add its tip.**
  And the numbers in a tip are **re-derived from the module that owns them**,
  never retyped — because retyping is exactly how the stale ones got there.
  Five shipped at once: `HOME_FULL_REST_S` (a tip still rested you in *any*
  building, at a rate deleted with `INDOOR_FULL_REST_S`), `Delivery`'s pin (a
  tip "rerolled" a wishlist that never rerolls), `QUEST_SLOTS` (a tip still
  named the hand-written chain the board replaced), the T5 chest gem, and the
  deep ore that mines the bars a tip called "smelted, never mined".
  Nor is the Book the only surface that lies: `COFFEE_AMULET_BOOST` has been 2
  while `ITEM_EFFECTS.coffee` said "+1 tier", and `RELIC_DEFS.bugnet.blurb`
  advertised "catch crows" — the one animal a net cannot take (a crow is
  HUNTED, `interact.js` `HUNT_KINDS`). **Grep both tables for a constant before
  you change it.**
  **A tip nobody draws is a tip nobody has.** The Book carries `dropWeight: 3`
  so it is the plurality of the T2 consumable pool everywhere instead of one
  seventh of it, and the places of learning — school / college / library /
  bookshop, their own `POI_CATEGORY` `'school'` in `loot.js` — pin it through
  `rarity.js`'s per-context **`favourite`**, so about a THIRD of their chests
  hand one over against under 3% anywhere else. That category is civic in every
  other respect (tier, pad, cave mirror) on purpose: the split moved the loot,
  not the price. Use `favourite` when a PLACE should be known for a thing; use
  `dropWeight` when a thing should simply be commoner everywhere.
  **THE ORDER IS THE CURRICULUM.** `PLAY_TIPS` is READ FRONT TO BACK — `app.js`
  `_bookRead` walks it one page per Book, bookmarked in `save.tipsRead` — so
  where a tip sits decides WHEN in a playthrough it is taught, and adding one
  is a placement decision rather than an append. The pages run by **when a tip
  first becomes ACTIONABLE**, which is not the same as grouping it by subject,
  and the difference is the whole point: grouping by subject put 'A ruined
  house can be rebuilt' at page 63 as a "progression gate" when rebuilding is
  starter-chain STEP FOUR — so what your first rebuild becomes was taught
  forty-six pages before the fact that you could rebuild at all — and left
  chests, which most players open minutes in, behind the entire village
  economy and twelve consecutive pages of animal husbandry. The stages: the
  first ten minutes, the starter loop, what is already lying around, the
  village economy, the land you walk over, animals, fighting, underground, the
  long gates — and the single riddle last, so the secret is the end of the
  course rather than a 1-in-72 accident. **Ask when the player can first ACT
  on a tip, not what it is about.** It used to be a uniform random draw with no
  memory, which threw the ordering away, put a repeat inside the first ~10
  reads and needed ~370 books to cover the list. The directional chest hint is
  gated on the course being finished for the same reason: at a 50% flip, every
  hint was a read that taught nothing new. **Put a new tip with the moment the
  player first needs it, and don't re-randomise the draw.**
  **Audit it:** `node test/node/run.js` › `test/node/books.test.js` re-derives
  every number a tip quotes from the module that owns it, blacklists each stale
  sentence by name, pins the front-to-back read and the block order, and
  measures the school chest's book rate against every other chest.

- **A street is restored ALONG THE WAY, never per cell — and the way is a
  LINE of a feature, never the feature.** `src/streets.js` measures
  restoration as float metre intervals of arclength along each
  `transportation` line the tile hands us, keyed
  `Streets.lineKey(feature, lineIdx)` (the MVT feature id, which real tiles
  carry on every feature and keep across seams, plus a hash of the line's
  endpoints, count and class — because a quarter of features are Planetiler
  MERGES of every same-tagged way in the tile, one of them 42 disconnected
  lines, so a feature-level key would be nonsense). Only the metres INSIDE
  the tile square count (`tileSpans`): MVT geometry runs into the buffer and
  the neighbour tile carries those metres itself. "In reach" is
  `reachIntervals` over `cellInReach` from the player's reach cell (the
  camera-anchor rule), an exact grid traversal, and the two-second dwell is
  `createSight`'s sliding window: a stretch ripens only when it has been in
  reach for EVERY instant of the window. The restored look is a SECOND
  canvas in `road_overlay.js` rebuilt on `Streets.epoch(save)`, never a
  per-frame path; the dwell preview and the shine are the one per-frame
  Graphics (`RoadOverlay.drawLive`), drawn from `drawRoadGeometry` so they
  seat against the same sub-cell scroll the band uses. The ladder
  (`src/trail.js`) counts metres — `GOAL_STEP_M`, 200 m — and one blast and
  one throttled counter fire per sweep, not per piece. Until Sep 2026 this
  was COBBLE TRAILS: pebble sprites on paved cells, keyed per cell and
  thinned by a hash, so the counted stones and the drawn road were two
  different things; do not bring a per-cell road state back.
  **What DID come back is the LIGHT.** A restored street lights its own way:
  one glowing cobble every `Streets.lampSpacingM()` metres of rebuilt
  carriageway — its OWN constant, `Streets.LAMP_SPACING_M` (100 m),
  deliberately NOT `Trail.GOAL_STEP_M` (200 m) any more. It shipped tied to
  the ladder's rung under the `roadOverlayWidthM` discipline, so a walk that
  earned a prize lit about one lamp — but the "gets a lamp at all" floor
  (`lampsAlong`: a line under half the spacing gets none, on purpose, so a
  dense block of driveways doesn't read as a lit car park) rode along with
  that number, and OSM cuts a way at every intersection: an ordinary
  suburban block is routinely under the 100 m a 200 m spacing demanded, so a
  whole town could be walked clean and never show a single lamp. Halving the
  spacing to 100 m (floor 50 m) lets a normal block qualify without touching
  the ladder's own pacing — the two are allowed to disagree now; 200 m of
  restoration still pays one prize, but may light two lamps. A lamp is
  GENERATED, never stored
  (`Streets.lampsAlong` off the line's own geometry, lit when `Streets.covers`
  finds its metre in the restored list) — the traps rule, so a rebuilt tile
  lights the same stones and the save gains nothing by it. It is TWO halves on
  ONE point, because the lightmap MULTIPLIES: baked art
  (`RoadOverlay.paintLampStone`, drawn under the lightmap — a light alone does
  not exist at noon) and the `Lighting.KINDS.cobble` row over it, both in
  `UI_LAMP_GLOW` — the old activated-cobble violet, brought back for the lamp
  specifically rather than the street's own `UI_STREET_INK` (the chips, the
  sparks, the counter): the carriageway restores in pale warm stone, but a
  lamp reads as ACTIVATED, the way a claimed cobble always did. The list
  app.js hands to both (`_updateStreetLamps`) is
  collected from the CAMERA ANCHOR and memoised on the anchor cell +
  `Streets.epoch` — never from the feet, which is the restoring sweep's side of
  the camera rule, not the drawing side.
  **NEITHER MEMO MAY BE STAMPED ON A TILE THAT IS STILL LOADING** — the
  `_neighborZoneCache` rule ("don't memoise a 'no neighbour found'"), and the
  reason no lamp lit at all between Sep 2026 and the fix. A tile's entry is in
  `WorldGen.tileCache` from the moment its FETCH starts, with no `layers` until
  the build lands seconds later, and `_updateStreetLamps` runs on every frame —
  so it always meets tiles in that state. `_streetLampsForTile` wrote its empty
  answer onto the entry, and the entry IS the cache: every tile in the world
  was measured for lamps while it was still loading and answered "none here"
  for the rest of the session. The per-tile list is now returned uncached
  until the tile has data, and `_updateStreetLamps` leaves its own key unset
  while any tile of the ring is unready — otherwise a reload would hold every
  lamp already in the save dark until the player happened to step onto another
  cell. **When you cache an answer read off a tile entry, ask what it says
  while that tile is still loading.**
  **The restored patch is SOFT, and its edge only.** The rebuilt band is laid
  crisp — clean setts, a hairline kerb — and then FEATHERED as the last step of
  `commitRestored`, through `softenEdge`: a blurred mask of the same strokes
  composited `destination-in`, so the silhouette melts into the dilapidated
  band under it while the setts inside stay sharp. At the band's FULL width (a
  Gaussian leaves its half-maximum on the original edge, so nothing is stroked
  in to compensate) and with a radius derived from that width
  (`RESTORED_BLUR_FRAC`, capped at `RESTORED_BLUR_PX`) — a fixed radius eats a
  footway alive, its centre never reaching full alpha. Both numbers were
  measured against a real canvas, not guessed; past about a third of the width
  a narrow way restores ghostly rather than soft. Blurring the drawn layer
  instead smears the cobble into grey, which is the one thing the restored look
  is for; a stack of translucent strokes standing in for the blur blotches at
  every junction (a translucent stroke composites with ITSELF where a path
  doubles back — the same trap the opaque-then-alpha rule at the top of the
  file exists to avoid), so where canvas cannot `filter`, the hard edge ships.
  The moment itself is quiet to match: `STREET_SHINE_ALPHA` is well under full
  white and eased out, and `BLAST_STONE_R_CELLS` is a nod, not a detonation —
  a sweep lands every few paces of an ordinary walk.

  **The ladder pays out of the ROAD's own pool, and the first rung is fixed.**
  `Trail.PRIZE_CONTEXT` is `rarity.js` › `'treasure:road'` — seeds first, with
  coins and produce as the other two faces of the pick and nothing else, because
  a two-way choice drawn from six classes is a lottery rather than a decision.
  Prize #1 is not rolled at all: `Trail.firstPrize` hands over the onion seed,
  so the first thing a road ever pays names what roads pay in. The first metres
  a save ever banks open the one-time dialog (`_showTrailIntro`, flagged
  `save.trail.greeted`), and EVERY ceremony prints the next rung through
  `trailNextPrizeLine` off `Trail.goalFor` — a prize that pays without saying
  where the ladder goes next is a dead end.

  **Two synthetic classes sit in `classBias` beside the item kinds**, because
  what makes each a reward is not which item came out of the pool. `cash`
  resolves to `{ kind:'gold', amount }` with NO `slot` — that missing field is
  how every payer tells money from a gear cash-out — and its worth is DERIVED:
  `CASH_TIER_VALUE` is the median of `PRICES` over each tier, made monotone and
  capped, so a coin option and a loot option on the same roll are the same
  prize stated twice. `bundle` is a pile of wood and stone, its own class
  because what makes it a bundle is the COUNT (a T1 chest rolls no quantity
  bracket at all, so wood out of the ordinary pool arrives one stick at a
  time). **When you add a class that isn't an items.js `kind`, give it a
  ceiling in `CLASS_MAX_TIER` and a branch before the item resolution** — the
  pool lookup will otherwise hand back null and the roll pays nothing.

  **Audit it:** `node test/node/run.js` › `test/node/streets.test.js` (the
  algebra, the lamp placement, the sight window, restore/epoch),
  `test/node/street_lamps.test.js` (the lamps' wiring),
  `test/node/road_overlay.test.js`
  (the restored pass, the tiles and the soft edge), `test/node/trail.test.js`
  (the lifted sweep on a synthetic tile, the first rung, the dialogs) and
  `test/node/loot.test.js` (the two synthetic classes and the road pool).

## Testing

- The test harness (`test/run_tests.py`) needs a browser, which isn't always
  available in this environment. When you can't run it, just say the tests
  weren't run and rely on a careful code review — **don't editorialize about
  lacking browser access or blocked downloads.** State it plainly and move on.

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
