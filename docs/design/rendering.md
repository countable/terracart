# Rendering, lighting and streets

Detail doc for projection, sprite seating, performance, lighting and street
restoration. The root `CLAUDE.md` owns the overview; read this before changing
rendering, lighting or street mechanics. Camera and art geometry live in
[docs/art/map-perspective.md](../art/map-perspective.md).

## Coordinates, rendering and performance

- `Render.drawSpiderWebs` draws cell-sized ground silk below characters and
  a strand from the fixed launch point to the moving projectile tip above
  the world. It reuses two graphics layers, culls to the viewport and clears
  both each frame, including depth changes; no cell-cache invalidation is needed.

- Draw from the camera anchor using `coords.js` projection helpers. Reach,
  taps, fog and tile loading use `playerM` / `playerToWorldCell()`.
  Draw player-attached effects at `scene.playerScreen()`, not viewport centre.
- The player's feet sit on the GPS fix. Ground marks use that point; body
  effects use `playerBodyDy()` so they also follow the downed pose. Do not
  compensate for sprite seating by changing the projection.
- Flight raises the body by the consumable row’s `liftPx` through `playerBodyDy()`;
  the shadow, world position and ground sorting remain at the feet. Expiry lowers
  the body automatically. Thrown flight potions also raise creature bodies.
- Upright scenery, castle wall pieces and characters (including the player)
  share `Render.sortWorldDepth`: lower continuous ground/feet Y renders in
  front. Use stable seating geometry, never animation lift or whole cell rows.
  Add sprite appearances to `RENDER_SPEC`; ground surfaces stay underneath.
  Castle wall caps and faces use `CastleStyles.rampart` dimensions in both
  renderers. Polygon corners use bounded bevel joins; depth seating follows
  the rendered masonry base, including the lift on angled edges.
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
- A creature's contact shadow centres 3 px above its ground point
  (`SHADOW_LOOK.creature.dy`), so its feet stand on the ellipse's middle; the
  elite's rune circle shares that centre.
- An elite (`Combat.isElite`) keeps its own colours, baked vivid once per
  sheet (`Render.vividTexture`), under every renderer; the gold tint is for
  shiny animals. Its twin rune circle is two white rotation strips
  (`elite_ring`, `elite_ring_inner`, baked at boot) turning against each
  other and tinted the rank's `ring` colour — `Render.canvasTint` bakes the
  tinted copy under Canvas, which ignores sprite tint. A sprite rotated after
  being squashed tilts the ellipse, so a turning ground decal is a strip.
  The shine sweep and a warping rank's space warp (`Render.setEliteWarp`, a
  camera post pass attached only while one is on screen) need the device's
  graphics-FX opt-in (`Render.canShine`).
- Centre work wheels in the target cell, including net captures. Use a small,
  solid disc at 50% opacity. Seat enemy health bars from `CREATURE_ART` helpers,
  not fixed pixel offsets. Work tools animate at the target cell.
- Bake repeated cell geometry into textures (e.g. tilled beds). Reset mutable
  properties such as watered tint whenever pooled sprites are reused.
- Respect `FPS_LIMIT` and its elapsed-time cadence adapter. The default stays
  30 fps for battery life; `?fps=0` follows the display, including 120 Hz.
  Wall-clock housekeeping must not count game steps. Feed Phaser's measured
  display interval to the adaptive tile-slice budget so a long slice cannot
  hide an 8.3 ms refresh as a 16.7 ms frame. Per-frame tile scans use
  `WorldGen.forEachItemInBox`, not flat object arrays. Widen queries for
  offers/lights beyond the sprite cull. Indexed objects do not move in place.
- Cached drawing keys must include every input. `Lighting.frameKey` uses the
  quantised light clock; new tile arrays read per frame need a derived index.
  `drawObjects` caches appearance by identity only for generation-immutable
  records, reuses their configured pool slots while body and camera stand still,
  and sorts the shared world container only when membership or assigned depth
  changes; tool/work transitions invalidate reuse, while connected, clock-driven
  and saved-state art stays live.
- `RoadSafety` paints every visible `ROAD_CLASS_MAJOR_BUFFER` cell with its
  muted red ground wash after dark. The wash sits above road surfaces and below
  road names, buildings and world sprites. Its key includes the camera cell,
  row-band phase, night state and visible road bits, so a crossing, sunset or
  newly loaded tile rebuilds it while sub-cell motion only scrolls it.
  `drawObjects` hides generated objects, plants, placed crops, fires, scarecrows,
  treasure marks and coin drops in that zone. The tap pass reads the same
  `RoadSafety` predicate, so hidden interactions cannot remain active.
- A cell-crossing rebuild never reads pixels back: no `getImageData`, no
  per-piece `textures.createCanvas` (Phaser reads the canvas back on
  creation). Bake short-lived canvas pieces into shared atlas pages
  (`building_overlay.js` wall atlas) and apply a colour treatment to the
  colours (`unclaimedMaterialColor`), not to finished pixels. The road overlay
  retains its visible base/restored pair while it paints a hidden pair in 2 ms
  slices, then swaps both atomically; each pass reuses its full-size scratch
  layers between rebuilds. Measured: one read-back per building per crossing
  was the walking stutter on iPhone.

Tests: `peek_drag`, `feet_anchor`, `shell_variants`, `rock_yield`, `health_bar`,
`tilled_bed`, `still_frames`, `chunk_index`, `building_overlay`; also
`tools/sprite_audit.js`.

## Lighting and streets

- Gas uses a translucent cell-bound pixel cloud above world sprites and below
  lighting and fog, clipped to the world viewport. `GasRender` eases density
  changes over 320 ms while the simulation diffuses once per second. Drawing
  reads a cached field snapshot and performs no texture creation or readback.
  Mushroom projectiles use the same cloud painter and lilac palette, at
  three-quarters of a cell wide.

- `lighting.js` owns the sole lighting pass: additive source cookies on a 2D
  canvas multiplied over the world. Do not add darkness passes or dim sprites
  again. Its screen-attached base (ambient plus player ramp) stays baked while
  walking; transparent, padded reach-cell masks crop with the camera and rebuild
  only when their geometry or validity edge changes. If the normal validity edge
  lands on `drawCells`' crossing frame, the mask borrows the remaining physical
  pad once and rebuilds on the next ordinary frame; it never crops past the
  painted edge. A viewport scratch blends
  old/new masks at their live fade weights and colours them with the radial
  gradient still centred on the body. Stable world cookies join padded caches
  by their exact whole-pixel phase. Player-attached, breathing, flickering and
  transient lights keep the individual stamp path. The full-frame key gates
  before every canvas call. Reach lighting follows `cellInReach`; light conveys
  reach and live POIs without outline rings. Day/night leaves the reach plateau bright;
  caves ignore it.
- Add sources through `Lighting.KINDS` / `sourceKind`; point-source collectors
  cull by viewport plus light radius, not sprite bounds. Use the existing
  derived luminance/contrast controls; remeasure the plateau ceiling before
  raising it.
- Streets restore metre intervals along each transportation line, keyed by
  `Streets.lineKey(feature, lineIdx)`, clipped to tile spans. Keep reach tied
  to the player and visuals keyed by `Streets.epoch`; do not add per-cell road
  state. The reach sweep rejects tile squares outside the padded reach, then
  caches eligible line records, bounds and tile spans on each tile entry. A new
  entry or replacement `layers` array invalidates the geometry, so a cell move
  rejects distant lines without walking their vertices.
  Feather only the restored band's edge, with a hard-edge fallback.
- Generate lamps from `Streets.lampSpacingM()` (independent of restoration ladder goals).
  One list and `lit` flag feed art and lighting. Derive verge offset from road
  width and lamp footprint; art and light share the same world point. Lantern
  rise is a draw-space offset; retune height through `LAMP_PROFILE`.
  Collect/cache lamps about the camera anchor, only after tiles finish loading.
- Restoration ladder rewards use `Trail.PRIZE_CONTEXT`; the first reward uses `firstPrize`.
  Synthetic loot classes need both a `CLASS_MAX_TIER` ceiling and a branch
  before item resolution. Cash rewards have no `slot`.

Tests: `lighting`, `reach_corners`, `streets`, `street_lamps`, `road_overlay`,
`trail`, `loot`; also `tools/layer_audit.js`.
