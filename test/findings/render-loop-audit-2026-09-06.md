# Render-loop efficiency audit — 2026-09-06

Scope: everything that runs once per frame from `MapScene.update()`
(`src/app.js` › `_updateTimed`) — the app.js helpers, `Render.drawCells`,
`Render.drawObjects`, the lightmap, the two geometry overlays, fog, and
Phaser's own render step. Static read of the whole path plus a headless
measurement of the real loop (method below). Nothing in the game was changed.

## Method

- Read: `_updateTimed` and every helper it reaches (app.js), render.js in
  full, lighting.js, road_overlay.js, building_overlay.js, fog.js, coords.js,
  util.js, and the Phaser 3.87 Graphics WebGL renderer in `vendor/phaser.js`.
- Measured: the real game booted headless in Chromium (Playwright, SwiftShader
  WebGL) in `?sandbox=true` + `__TEST_MODE`, with the in-game profiler
  (`window.__boot`) recording every pass and a CDP CPU profile attributing
  Phaser-internal time back to our call sites. Two phases: 6–8 s standing
  still, 8–16 s walking a square at the DEBUG 10× keyboard speed.
  Reproduce with `node tools/perf_loop.js` (see the header of that file).
- Caveats on the numbers: SwiftShader makes GL calls slower than a phone GPU
  and headless rAF runs at ~15 Hz, so frame GAPS are meaningless here; the
  per-pass JS timings and the relative shares are what to read. The sandbox
  tile has no MVT layers, so the road/building overlay REBUILD cost was
  audited by reading only. `__TEST_MODE` skips the rest accrual and the cobble
  sweep, so those are read-only findings too.

## Measured baseline (sandbox, 9 tiles, 61 objects, 131 wildplants, 24 creatures)

From the in-game profiler's own ticks, quiet machine, avg / worst ms:

| pass                                | standing still | walking       |
|-------------------------------------|---------------:|--------------:|
| phaser render (Phaser's own step)   | 3.5 / 10       | 4.2 / 10      |
| update (all) (our JS)               | 1.25 / 3.7     | 2.2 / 22      |
| of which drawObjects                | 0.62 / 2.6     | 0.93 / 5.1    |
| of which drawCells                  | 0.43 / 2.5     | 0.95 / 14     |
| update @crossing                    | –              | 7.2 / 22      |
| drawCells @crossing                 | –              | 5.3 / 14      |
| fog paint (per crossing)            | –              | 2.1 / 10      |

From the CPU profile, per frame (inclusive; `busy` = all non-idle samples):

| function                              | standing still | walking |
|---------------------------------------|---------------:|--------:|
| busy, total                           | 8.1            | 7.9     |
| `batchFillPath` (Phaser earcut fills) | 1.47           | 2.12    |
| `_updateTimed` (all of our update)    | 0.84           | 1.63    |
| `drawCells`                           | 0.27           | 0.73    |
| `drawObjects`                         | 0.37           | 0.59    |
| garbage collector                     | 0.24           | 0.47    |
| `Lighting.draw` + `canvasToTexture`   | 0.30           | 0.51    |
| `paintFogTexture` (amortised)         | –              | 0.24    |
| Phaser `setText`/`updateText`         | ~0             | 0.19    |

(A first run taken while three other processes shared the CPU read 2–3×
higher across the board and is discarded; the relative shares were the same.)

Two things stand out before any single hotspot:

1. **Phaser's render step costs 3–4× all of our update code**, and its
   biggest single component is `batchFillPath` — earcut triangulation of
   path fills — at 1.5–2.1 ms/frame, 18–27 % of all busy time. That is our
   Graphics layers being re-tessellated every frame, see finding 1.
2. **Standing still costs nearly the same as walking** (8.1 vs 7.9 ms busy).
   Nothing in the frame is gated on "did anything change": cellGfx, the
   noise/cobble/letter pools, the lightmap, the footprints, the facing arrow
   and the HUD text all rebuild every frame with identical output. The
   sandbox is a small world; on a dense real tile the per-object and
   per-tile terms below (findings 4–6) grow while finding 1 stays constant.

## Findings, ranked by measured or expected per-frame cost

### 1. "Cached" Graphics layers are re-tessellated by Phaser every frame — and the rounded corners cost ~100 vertices each

`src/render.js` caches the biome-border layer (`borderGfx`, rebuilt on
crossings, line 1101–1112), the grid (`gridGfx`, 2114–2136) and the atmosphere
rim (`atmosRimGfx`, 1034–1049) on the assumption that a Graphics object whose
command list is stable is free between rebuilds. **It is not.** Phaser's
WebGL Graphics renderer replays the whole `commandBuffer` every frame: every
`fillRect` is re-batched as a quad, every `lineBetween` as a stroked quad, and
every `FILL_PATH` (what `fillRoundedRect`, `fillCircle` and `fillPoints`
become) is re-run through earcut. An `ARC` is stepped at 0.01 of its sweep
(`vendor/phaser.js`, `case s.ARC: … I+=.01`), so **a `fillRoundedRect` is four
~100-point arcs earcut'd per frame, and a `fillCircle` is one ~100-point
polygon**. Caching the commands only saves our JS and GC; the GPU-side JS is
paid every frame regardless.

Measured command-buffer sizes per frame in the sandbox: `gridGfx` 9 860
entries (~1 230 dashed line segments), `borderGfx` 6 500–7 900 (~1 500–1 900
rects plus 21–30 `fillCircle`s at the blur corners), `cellGfx` ~2 000 (169 base
fills, 11 `fillRoundedRect`s → 44 arcs), `atmosRimGfx` 1 080 (30 nested
`strokeRect`s), `footprintGfx` 250 (five 14-gons). `batchFillPath` alone was
175 ms over 119 frames standing still (1.47 ms/frame) and 358 ms over 169
walking frames (2.12 ms/frame).

**Fix (largest single win, medium effort):** the static layers should be
*images*, not command lists. The fog layer already shows the shape
(`scene.fogTex` canvas texture painted on crossings, container scrolled by
the sub-cell fraction, render.js 2174–2261): paint border/grid/rim once per
crossing into a canvas texture (or `Graphics.generateTexture` /
RenderTexture) and draw one quad. Cheaper first step: replace the
`fillCircle` corner rounds in the border (1411–1414, 1432–1435) and the
`fillRoundedRect` cell corners (1334, 1494) with small pre-baked 6 px corner
sprites from a pool, and give the footprint (finding 7) and the reach outline
(2070–2084, 356 entries of `lineBetween`) the same treatment. Each `arc`
removed is ~100 fewer vertices per frame.

### 2. `drawCells` re-textures 338 pooled sprites and re-rasterises road labels every frame

`render.js:1547` `ns.setTexture(texKey)` and `1671–1672` `cs.setTexture(...);
cs.setFrame(frame)` run for every one of the 169 cells' noise and cobble
sprites every frame. The comment at 1663–1665 says "Phaser short-circuits if
the key is already current"; **it does not** — `Sprite.setTexture` is
`this.texture = textures.get(key); return this.setFrame(...)` unconditionally,
and `setFrame` re-derives size, origin and crop each time, then
`setDisplaySize` runs again on top. Measured: `setTexture` + `setFrame`
under drawCells are ~0.12 ms/frame standing still — small in absolute terms
in the sandbox, but ~45 % of drawCells' own steady-state time, and the key
of a cell only changes on a crossing (the water phase is the one per-frame
exception).

The road-label pool is worse per item: a slot is the cell INDEX, so every
crossing moves each label to a different `Text` object and `lt.setText`
(1580) re-rasterises its canvas and re-uploads it (Phaser's same-text guard
can't help when the text moved slots). `updateText` under drawCells was
24 ms over 169 walking frames with a couple of labels on screen; a street
grid has many more.

**Fix (trivial, high value per line):** use the file's own
`setTextureIfDifferent` (render.js 211) for both sprite pools and run
`setDisplaySize` only when the swap happened; key label slots by anchor
(`tile/ix_iy`) rather than by cell index so a label keeps its `Text` object
while it stays on screen.

### 3. The lightmap is repainted and re-uploaded to the GPU every frame, unconditionally

`src/lighting.js` › `draw` (564–651) has no change detection: every frame it
clears the 352×352 canvas, paints the plateau over 169 cells with up to 8
`inReach` closure calls each (~1 350 calls), draws every light cookie, then
`tex.refresh()` — a ~500 KB RGBA upload — even when the player, the reach
radius, the depth, the daylight minute and every light are exactly where
they were last frame. Measured: 0.30 ms/frame standing still (0.20 paint +
0.10 `canvasToTexture` upload), 0.51 walking — the third-largest per-frame
item after Phaser's fills and our two draw passes. On a stationary player
this is pure waste, and on a phone the texture upload is the expensive half.

**Fix (small, high value):** key the paint on (anchor cell, sub-cell
fraction quantised to a pixel, reach radius, depth, daylight minute, the
collected light list's positions/ids, the POI pulse phase quantised). Paint
only when the key changes. The pulse means a live POI keeps it dirty at its
own cadence, which is fine — most frames have no POI on screen.

### 4. Two all-tile object scans on the per-frame path

- `app.js:10534` `isRestingAtHome`: `for (const e of WorldGen.tileCache.values()) for (const o of e.objects)` **every frame** while the player stands on any building cell with a real (non-trailer) adopted home. O(cached tiles × objects). Use the 3×3 `forEachItemNear` or memoise on the player's cell.
- `app.js:10588` `ensureStarterTrailerObject` (called from `drawObjects`, render.js 2320): a linear scan of the Home tile's whole object list every frame, then `clearHomeTrailerOverlap` splits every cached tile's key string per frame (10623). Latch on (tile entry identity, `objects.length`), the same trick `_trailerMoat` already uses.
- `app.js:10458` `ensureStarterShopId` has three early-return paths that do not latch `_starterShopOk`, so while the home tile is evicted the all-tile house scan can run every frame. Latch a "checked this tile set" key.

### 5. Creatures are walked twice per frame and hashed per frame

`wanderCreatures` (app.js 6946) and `_combatTick` (6055) each do a full
`forEachItemNear('creatures')` over the 3×3 tiles with the range cull inside
the callback; each `forEachItemNear` builds 9 tile-key strings. Per surviving
creature per frame: `isShiny(c.id)` (7074) concatenates `id + '#shiny'` and
FNV-hashes it — an immutable per-id value. The same `isShiny` runs again in
`drawObjects` for every tree and wildplant (render.js 899, 3938, 4281, 4288).
Cache the shiny bit on the object (`o._shiny`), and fuse the two creature
passes into one that hands `_combatTick` the near list.

### 6. `drawObjects` allocates its whole spec table every frame

`RENDER_SPEC` (render.js 2760–3125) is a `const` inside `drawObjects`: ~15
nested object literals holding ~40 arrow functions, plus ~30 helper closures
(`project`, `_houseKey`, `_houseFrame`, `_seatedFoot`, …) and a `new Set` at
3134, re-created 60× a second. Beyond the GC churn this defeats V8's inline
caches (fresh closure identity at every call site). `project` (2349)
allocates `{sx, sy}` per drawn item (2–4 per item per frame) where
`cellScreenXY` (313) already demonstrates the shared-scratch idiom.
Per-house work is recomputed 30–50× per frame (`_houseRole`/`_houseKey`/
`_houseFrameW` chains, each ending in a `textures.get().get(frame)` lookup),
and `_seatedFoot` (3143) re-evaluates the spec that `configureObject` (3246)
evaluates again 40 lines later, both building a `` `${texKey}:${frame}` ``
string per seated object. Hoist the table to module level, memoise per
object (the pattern `_chestLook` / `_standCache` already use), and precompute
`_cellRow` once per entry instead of twice per comparison in the z-sort
(2565–2572).

### 7. Ground marks rebuilt from scratch every frame

- Footprints (app.js 5857–5869): `footprintGfx.clear()` then, per print, 14
  `{x,y}` objects + 28 trig calls + a 14-gon `fillPoints` — five prints,
  several at alpha ≈ 0.1. Pre-bake the 14 unit-circle points (one table per
  `N`), or replace the polygons with a pooled sprite.
- Facing arrow (5796–5820): `facingGfx.clear()` + 8 path ops every frame.
  Gate on facing/position change, or make it a rotated sprite.
- `_updatePlayerAura` (8311): `player.setTint` written every frame on the
  common path, and the wave `sin` computed before the branch that needs it.

### 8. The cobble-trail sweep and the per-cell string keys

`_sweepCobbleTrails` (app.js 11729): builds a `` `${ix},${iy},${r}` `` key
every frame just to compare with the memo, and `for (const [key, s] of
sight)` destructures a 2-array per watched stone per frame. Its crossing-time
rebuild (11692) calls `cellInReach` ~169×, each allocating `{cellIX, cellIY}`
and re-reading `Date.now()` (coords.js 227) — hoist as render.js 2025 does.
`_isPathStoneActive` (11613) builds a `` `${lix}_${liy}` `` string per visible
road/path cell per frame from `drawCells` (1616). `drawCells` itself computes
`cellKeyFromAbsCell` twice per cell (1252 and 1448, the same key), and the
road-label lookup (1574) and path-under lookup (1529) build `` `${ix}_${iy}` ``
strings per road/path cell per frame. Integer keys (`ix * 65536 + iy`) or a
per-tile typed array would remove all of it.

### 9. Overlay prologue and small per-frame waste in the app.js path

- `overlayFrame` (coords.js 119) runs twice per frame (road + building) and
  allocates 9 `{tx,ty,entry}` objects + a concatenated `ready` string just to
  test the cache key. `claimEpoch` (building_overlay.js 558) calls
  `Object.keys` on three save maps every frame; a counter bumped on claim is
  O(1).
- `updateHUD` (app.js 9137) `classList.remove('booting')` every frame, unguarded.
- `dragonTimerText.setText(shortDuration(...))` (5639) and the work-icon
  `style.transform` template (6841) are unguarded per-frame writes while
  active; `_dayKey()` (5895) allocates a `Date` + ISO string + regex per
  frame while a delivery compass is up; `save.caught.includes` (6769) is a
  linear scan per frame during a fight (use `setOf`).
- `_syncModalGate` (12724) forces a style+layout flush 6×/s via
  `getClientRects()`; a `MutationObserver` on the modal root would make it
  event-driven.
- The creature/object pools assign slots by sorted list order, so when
  entities re-order (creatures wander, objects sort by `dy`) a slot's texture
  changes and `s.play(...)` restarts (`play`/`startAnimation` showed up under
  render.js 4128). Keying slots by entity id would stop the churn.

### 10. Crossing-frame spikes (read-only; the overlays did not exercise here)

`road_overlay.js` › `rebuild` (581–673) walks all 9 tiles × all MVT layers ×
all features (the unfiltered `entry.layers`), projects every vertex through
closures into fresh `{x,y}` objects, strokes the whole network twice, does two
480×480 pattern fills, adds a decor path per rail tie, then uploads a 480×480
texture; `building_overlay.js` › `rebuild` (565–663) is the lighter sibling
with a `pts.map` clone per building and its own upload. Both fire on every
anchor-cell crossing, **including peek-drag crossings** (`viewAnchorCell`
carries `peekM`), with no coalescing — a fast drag can trigger both rebuilds
several frames in a row. Pre-extract the transportation features once at
decode time and debounce rebuilds while a peek is in flight.

## What is already right (don't re-audit)

- The cell-crossing dirty gate for the border, grid, fog, atmosphere sample
  and the two overlays; the container scroll for the sub-cell fraction.
- `Fog.reveal` first-line early-out and the 10 s flush throttle.
- `setOf` (WeakMap memo on identity + length) at every per-frame call site.
- `neighborNonRoadType` memo (app.js 7603) — the 7×7 road-tint scan is O(1)
  after first sight.
- `cellScreenXY` scratch object; the hoisted reach math in render.js 2025 and
  lighting.js 593; the `_plantedNear` pre-filter (1091).
- `setTextureIfDifferent` and the `*Once` Text style guards (render.js 211–246)
  where they are used; `updateEnergyDOM` and the money/HUD text guards.
- `_starterGuidanceGoal` 500 ms memo; `advanceGrowth` 1 s tick;
  `ensureTilesAround` 20 m gate; `_turretFire` scan cache; the lighting
  cookie caches and once-a-minute sun elevation; `particles.js` (event-driven,
  no tick).
- The 3×3 tile restriction in `drawObjects` and the cull-before-work order.

## Recommended order

1. Finding 3 (dirty-key the lightmap) — small, removes a per-frame paint and
   GPU upload worth ~0.3–0.5 ms.
2. Finding 2 (guard the pool `setTexture`s, key label slots by anchor) — a
   few lines, ~half of drawCells' steady-state cost and the label re-rasters.
3. Finding 1 (bake the static Graphics layers to textures; remove `arc`s) —
   the largest win by far (1.5–2 ms/frame of `batchFillPath` plus the quad
   batching of ~3 000 rects and ~1 200 dashes), a day's work, and the fog
   layer is the template.
4. Findings 4 and 5 (the all-tile scans and the double creature walk).
5. Finding 6 (hoist `RENDER_SPEC`, memoise per object) — steady GC relief.
6. The rest as they come up.

Re-measure after each step with `node tools/perf_loop.js`; the "standing
still" column should fall well below the "walking" column once 1–3 land.
