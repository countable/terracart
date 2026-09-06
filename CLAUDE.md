# CLAUDE.md

## Parallelism rules

- **Don't use `git stash` or `git worktree`** for parallel work.
- If two pieces of work would touch the same file, **do not parallelize them**.
  Either run them serially in one agent, or split the work along file
  boundaries so each agent owns disjoint files.
- Before spawning multiple agents, list the files each one would write and
  confirm the sets don't overlap. If they overlap, restructure or serialize.

## Subagent rules

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
  **Audit it:** `node test/node/run.js` › `test/node/peek_drag.test.js` drives the
  lifted shipping code: the projection round-trip under a peek, that a tap lands
  in the cell it was drawn over, that reach is unmoved by the camera, and that a
  pointer which dragged taps nothing.

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
  and both callers resolve the variant through `SpriteLayout.plainRockVariant`
  so they can't pick different rocks. A surface with no rock sprite promises
  nothing and passes `stones = null` for the old flat roll — that's the cave
  WALL dig, not a rock. Note the pair is one connected blob, so no pixel pass
  can count it: `stones` is authored, and the tripwire if the sheet is re-cut
  is the `ART_BOUNDS` width drift check in `tools/sprite_audit.js`.
  **And say the real number.** The plain-rock toast read `+1 Rock` while
  handing over three — if a loot path rolls a quantity, its flash prints that
  quantity.
  **Audit it:** `node test/node/run.js` › `test/node/rock_yield.test.js`.

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
