# Rendering, lighting and streets

Detail doc for projection, sprite seating, performance, lighting and street
restoration. The root `CLAUDE.md` owns the overview; read this before changing
rendering, lighting or street mechanics. Camera and art geometry live in
[docs/art/map-perspective.md](../art/map-perspective.md).

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
- Centre work wheels in the target cell, including net captures. Use a small,
  solid disc at 50% opacity. Seat enemy health bars from `CREATURE_ART` helpers,
  not fixed pixel offsets. Work tools animate at the target cell.
- Bake repeated cell geometry into textures (e.g. tilled beds). Reset mutable
  properties such as watered tint whenever pooled sprites are reused.
- Respect `FPS_LIMIT` and its elapsed-time cadence adapter. Per-frame tile scans
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
  state. The reach sweep rejects tile squares outside the padded reach, then
  caches eligible line records, bounds and tile spans on each tile entry. A new
  entry or replacement `layers` array invalidates the geometry, so a cell move
  rejects distant lines without walking their vertices.
  Feather only the restored band's edge, with a hard-edge fallback.
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
