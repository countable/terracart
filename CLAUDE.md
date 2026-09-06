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
- **Subagents must NOT modify `index.html`.** The script-tag list and
  cache-bust `?v=NN` is the parent's responsibility. The subagent reports
  *what* should be added; the parent edits index.html in one place at the end.
- For multi-file refactors that delete from a shared file (e.g. extracting
  modules from `app.js`), tell each subagent to **CREATE its new module
  only** and **report exact line ranges to delete from the shared file**.
  The parent does the deletions in one coordinated pass after all subagents
  return — this avoids merge-conflict-style line-number drift between
  parallel agents touching `app.js`.

## QC rules

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
  viewport centre and slide it, give it the peek margin.**
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

- **Interactables must be clearly in one cell.** Other than houses and fauna,
  every interactable should visually occupy a single tile — its art and
  collision box must align to the same cell. If it appears to straddle a cell
  boundary, or if the sprite and hitbox don't obviously belong to the same
  cell, that is a bug. Fix the offset, anchor, or collision rect before shipping.

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
  of it made a goblin's bite land any softer. A piece now contributes its **tier
  SQUARED** to a reduction pool (`items.js` › `armorSlotReduction` /
  `armorReduction` — every slot pays the same for a tier and they differ only in
  PRICE), and `Combat.mitigate` spends that pool against a blow in
  `MITIGATION_ROUNDS` passes: soak up to HALF the damage, halve the pool, soak
  up to half of what is LEFT, four times over. Halves round DOWN and
  `MIN_PLAYER_DAMAGE` is the floor, so four halvings cap armour at 15/16ths of a
  hit however good it is — which is what makes a quadratic pool safe to hand out
  instead of a hand-tuned percentage per slot. **The mode and the potion scale
  the blow BEFORE armour spends against it** (`Difficulty.enemyDmgMul`, the
  shield's halving), so a hard-mode hit is soaked as a hard-mode hit.
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

- **A trap is generated, never stored — until it is sprung.** Where the traps
  are (`src/traps.js`) is a pure function of the tile's coordinates, and its
  depth underground, through `WorldGen.makeRng` — like the X-mark scatter and
  the cave rocks. The ONLY thing that ever reaches the save is
  `save.sprungTraps`: the ids of the ones the player has stepped on, which is
  what keeps a discovered trap discovered across a reload, a tile eviction and
  a rebuild. Each spawner seeds its OWN stream rather than drawing from the
  caller's, because `spawnInTile` and `spawnCaveCreatures` are long chains off
  one rng and taking numbers out of them would re-roll every world seed
  downstream. Surface traps go ON THE VERGE, never on the road: roadside-ness
  is `Traps.isRoadside` over **`entry.roadMask`** and the seat is cleared by
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
  down for contrast (the one deliberate departure: "totally unlit areas
  should be darker"). Retune a look through those; `AMBIENT_K` is the
  contrast knob, and another factor added in lighting.js breaks the
  correspondence the test pins.
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
  light in the dark, never by a ring drawn back under the pad. **When you add a
  light source, add a row and return its kind from `Lighting.sourceKind`**;
  the collector culls at `halfM` + the row's own radius, not the sprite cull,
  so a lantern a cell off-screen still lights the edge.
  **What stayed on `reachGfx`:** the white reach OUTLINE. It is the tap
  affordance; never move it onto the lightmap.
  **Audit it:** `node test/node/run.js` › `test/node/lighting.test.js` (the
  derived levels, the table, the collector, the source pins) and
  `tools/layer_audit.js` (the lightmap above ground, halo and sprites, below
  the labels).

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
  algebra, the sight window, restore/epoch), `test/node/road_overlay.test.js`
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
