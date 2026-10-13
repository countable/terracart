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
- Upright scenery and characters (including the player) share
  `Render.sortWorldDepth`: lower continuous ground/feet Y renders in front.
  Use stable seating geometry, never animation lift or whole cell rows.
  Add sprite appearances to `RENDER_SPEC`; ground surfaces stay underneath.
- Layer order is landcover, variant surfaces, building footprints, walls,
  ground state (such as oil spills), then objects and characters.
  Building footprints and walls are background. Polygon walls and tiled castle
  ramparts live in `buildingWallContainer`, immediately above the footprint
  layer and below pads, traps, shadows and every interactable. Wall geometry
  never adjusts an actor's feet or enters the world depth sort. Towers and
  flags retain ordinary world ordering. Walls and footprints use a muted
  palette so interactables remain distinct.
  Castle courtyard cells mostly retain four quarter-cell stone tiles (2×2).
  A quarter of the cached variants join one adjacent pair into a horizontal or
  vertical half-cell slab, with both positions represented. Polygon courtyards
  scatter those variants across a cached eight-cell-square repeat; tiled floors
  choose them from a mixed world-cell hash. The pattern stays fixed while the
  camera moves. Each joint uses one recessed pixel, with quiet worn stretches
  and stronger corners. Polygon courtyards use these stone seams without a
  second cell-grid overlay.
  Castle wall caps and faces use `CastleStyles.rampart` dimensions in both
  renderers; polygon corners use bounded bevel joins with faces beneath them.
  Merlons have low rectangular tops spanning the full wall-cap width, with both
  opposing faces flush with the wall below at every angle. Their length along
  the wall is independent of its thickness. Full end blocks reach each corner;
  the rear highlight stays inside the cap silhouette. Polygon wall bodies and
  crenellations use separate cached passes, with every body drawn before the
  crowns so adjacent wall sections cannot cover a crenellation top. Castle wall
  bodies omit mid-wall shadow stripes; the bottom silhouette and a quiet rear highlight define the edge.
- Standing objects fade to half their normal opacity only when their art overlaps
  the player's inset body box and their world depth draws them in front. The
  overlap uses cached trimmed `ART_BOUNDS`, with frame bounds for procedural
  art, and updates even on reused sprite slots. Moving clear restores the
  original opacity; tool access never changes it. Ground art retains its own
  opacity, and fruit overlays follow their tree.
- Taps resolve the data cell (`sameAbsCell`), not pixel bounds. Seat cell-bound
  sprites through `seat: true`, `seatInCell` and `ART_BOUNDS`: centre horizontally;
  centre vertically if they fit, otherwise bottom-seat 1px above the cell edge.
  Buildings, moving creatures and canvas-baked street lamps have separate seating.
  A house sprite (small and medium tiers) stands its bottom-middle on its
  footprint's centre of mass: the object sits on the nearest footprint cell
  and carries the remainder (`footDx`/`footDy`, worldgen
  `footprintFootOffset`); its shadow, sign, roof plate and bubble follow the art.
  Use a stable `seatFrame` for animation. After art changes, run
  `node tools/sprite_audit.js --emit-bounds` and update `src/sprite_layout.js`.
- Every underground floor uses the same connected cave-wall atlas: raised caps,
  chipped rims and lighter front faces. Live neighbour masks update after mining
  and tile arrival; pooled sprites hide when returning to the surface or sky.
- Connected ground art that must abut its neighbours (chasm sections) seats on
  its terrain slot through `absCellScreenCentre` (coords.js), never on its own
  rounded `deltaMToScreen` point: neighbours' float centres sit `CELL_PX` ± epsilon
  apart, and rounding each alone opens an intermittent 1px seam.
- List actual crop `frames`, not sheet-cell counts. Hash the full id for
  per-cell variation (`wildplantFrame`); do not use id length or transient indices.
  Legacy `PLAIN_ROCK_VARIANTS` retains rock yields independently of the neutral
  material silhouettes; loot messages report the actual quantity rolled.
- Apple and Worldpeach trees keep their mature size after picking. Their
  24-hour fruit regrowth is green for the first 12 hours, then uses the mature
  blossom frame for the final 12 hours (apple frame 8, peach frame 4).
  Ripe trees return to the green frame
  with separate fruit overlays. `Crops.fruitTreeState` owns readiness and the
  blossom window; initial sapling growth still flowers during stage 3.
- Procedural wildplant backgrounds carry the shared layout's `_terrainScale`
  into the normal crop renderer as a size multiplier; cell positions, crop art
  and harvest rewards remain owned by their existing records and tables.
- Revealed gas-emitting mushrooms use separate small and giant context art;
  the renderer carries `gasEmitter` into the crop view without changing crop
  identity, harvest rewards or inventory icons.
- A creature's contact shadow centres 3 px above its ground point
  (`SHADOW_LOOK.creature.dy`), so its feet stand on the ellipse's middle; the
  elite's rune circle shares that centre.
- NPC sheet corrections live in `SpriteLayout.NPC_SHEETS.render` and bake once
  through `makeNpcSheet` at asset load. Grove fox bodies match the citizens'
  height and outline ink while retaining the shared feet anchor; map animations,
  dialogue portraits and the NPC roster use that same transform.
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
- Centre a static target's work wheel in its cell; a creature's (a net
  capture, a hunt) rides the creature, on its body (`creatureWheelDy`). Use a
  small, solid disc at 50% opacity. Seat enemy health bars from `CREATURE_ART`
  helpers, not fixed pixel offsets. Work tools animate at the wheel.
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
  changes; work transitions invalidate reuse, while connected, clock-driven
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

- Approved replacements are resampled from original generated crops at the
  24px art grid, never enlarged from a finished 16px export. The world-art
  importer records `resizeSheet` for compatibility frames in migrated sheets;
  selected frames are then replaced from original sources. Palms and shells
  use 24px cells at 4/3 display scale. Tall shrine frames use 24×36 cells;
  their scale and the waystone scale compensate for the larger source grid,
  preserving their established screen footprint. Legacy unrelated sheets and
  building or multi-cell canvas dimensions remain separate from this rule.

- The shared mineral rock set uses a slightly warm grey palette and high
  three-quarter overhead view. The generic `rock_variants` sheet has
  24px cells forming fifteen adjacent small/large
  material pairs plus three extra plain-stone pairs. `mineralRockArtFrame` selects the matching gem deposit or ore tier,
  plain stone for ordinary cave rubble,
  and flint when marked `rockMaterial: 'flint'`, including flint-bearing L1
  cave rubble. The flint mark takes precedence over the generic cave variant. Partial
  cover (`sightBlocking: true`) selects the taller boulder silhouette.
  Regular rocks and boulders both use 24px frames at scale 4/3; their height
  difference is authored into the graphic-storybook atlas (8 columns, 9 rows).
  Outside authored rock zones, wild rubble shares
  the four generic plain small shapes and skips biome tint; planted crop stages
  and inventory icons retain their existing art. A stable id hash selects plain
  stone shape independently of biome, mining quantity and small/large size.
  Mining quantities retain their existing variant tables.
  Thirteen stone contexts use one environmental design each from
  `rock_variants` frames 52–64: Stone Garden, Broken Masonry, Flint Field, Broken Depot,
  Seep, Work Yard, Black Ring, Pirate Cove, Strip Mine, Stronghold Quarry,
  Crater Quarry, Abandoned Quarry and Mystic Reef. Color, moss and weathering carry
  the place; Work Yard uses a cut stone slab and Crater Quarry has a glowing lava
  seam painted into the sprite. These contain no collectible mineral inclusions.
  The same 24px
  frame scales to 4/3 for both small stones and sight-blocking boulders.
  `ROCK_VARIANT_ART` owns these scales and the placed-rock scale of 2.88.
  These display sizes leave mining
  quantities, occupied cells and cover behavior unchanged.
  Named context/variant fields resolve the theme, with legacy zone-object
  frames 64–71 as a fallback. Gem, ore and explicitly flint-bearing rocks always
  retain the shared material silhouettes and readable inclusions.
  One 144×264 atlas holds 65 used frames and one empty trailing cell: shared material/shape pairs 0–35,
  neutral zone pairs 36–51, and environmental designs 52–64. The source
  images and `assets/Objects/Rocks/export.cjs` rebuild the atlas.
  All earlier approved art remains available: `rockStyle: 'plain'` selects the original
  neutral zone pair where one exists, otherwise the common plain shapes;
  `rockStyle: 'shared'` always selects the common plain shapes. Stronghold
  wall segments retain their connected wall art and physical behavior.
  `ZONE_ROCK_THEMES` owns multiply colors: shared/neutral art automatically
  inherits its supported zone palette; a named `rockTheme` selects a palette
  explicitly and `rockTheme: false` keeps neutral colors. Other zones use
  regular neutral rocks, including older records with legacy decoration frames.
  Recoloring preserves frame/material/yield identity,
  and never double-tints the authored themed sprite. Thus new zone palettes
  require no copies of every ore and gem sprite.

## Lighting and streets

- `Visibility` owns current cover, separately from `Fog`'s saved exploration.
  Only cave terrain walls fully block sight beyond their cell. Bushes, hedges,
  short walls, larger standing trees and rocks marked `sightBlocking: true`
  provide partial cover, with a non-stacking 75% darkness treatment. Small
  rocks and the smallest tree saplings provide no cover. The facing blocker
  stays visible. Any cover (`Visibility.hidden`) removes the actors behind
  it — creatures, peers, coins, shots — with their labels, shadows and
  target affordances. Scenery (objects, plants, crops, traps, hazards) and
  the ground stay drawn and tappable in the shadow so the player keeps their
  bearings; full cover is black and removes scenery as well. The cover
  mask's feather spreads outward only, so every hidden cell keeps its full
  darkness.
  `Lighting.coverFrame` caches a world-aligned mask and composites it into the
  existing lightmap after light sources. It reuses the exploration fog's
  low-resolution smooth upscale and world-keyed wisps, with a roughly one-cell
  feather from a small separable filter instead of the exploration ramp. Noise coordinates and both canvases
  are reused; only changes to the sight field repaint the alpha buffer. Cover queries always
  originate at the player's body, including during camera peeks; the mask alone
  traces from `Visibility.observer`, the body snapped to an eighth-cell lattice
  inside its own cell, so walking and GPS glide repaint it per step rather than
  every frame. Rays read a dense typed-array cover grid, never per-cell key
  strings; the object rescan is gated by a signature (night state included) and
  a one-second refresh for slow in-place edits. The per-ray cache clears
  whenever the body moves, so render passes test `Render.coverHidden` only
  after their view-box cull: a ray per off-screen fish spot, coin or X across
  the tile ring once cost most of a walking frame.
- Evertorch uses the shared player-light collector and torch radius with a blue
  `Lighting.KINDS` row. It takes visual precedence while both torches burn;
  neither expands interaction reach. Its icon reuses Torch art with the
  icon-source CSS palette filter in the shared inventory/offer/toast renderer.

- Gas uses a translucent cell-bound pixel cloud above world sprites and below
  lighting and fog, clipped to the world viewport. `GasRender` eases density
  changes over 320 ms while the simulation diffuses once per second. Drawing
  reads a cached field snapshot and performs no texture creation or readback.
  Each `MushroomGas.KINDS` row owns its colours (confusion bright yellow,
  poison green, paralysis blue); an opacity floor keeps even a thin fringe in
  its colour over a dim cave floor. Mushroom projectiles use the same cloud
  painter and confusion palette, at three-quarters of a cell wide.

- `lighting.js` owns the sole lighting pass: additive source cookies on a 2D
  canvas multiplied over the world. Do not add darkness passes or dim sprites
  again. Its screen-attached base (ambient plus player ramp) stays baked while
  walking; transparent, padded reach-cell masks crop with the camera and rebuild
  only when their geometry or validity edge changes. If the normal validity edge
  lands on `drawCells`' crossing frame, the mask borrows the remaining physical
  pad once and rebuilds on the next ordinary frame; it never crops past the
  painted edge. A viewport scratch blends
  old/new masks at their live fade weights and colours them with the radial
  gradient still centred on the body. Interrupted fades retain exact weights,
  but rendering skips masks outside the painted view and an aggregate of less
  than one 8-bit alpha level; it never renormalises the remaining brightness.
  Active mask canvases stay pinned until compositing finishes, including when
  a fade needs more than four masks. Surplus canvases are released as it settles. Stable world cookies join padded caches
  by their exact whole-pixel phase. Player-attached, breathing, flickering and
  transient lights keep the individual stamp path. The full-frame key gates
  before every canvas call. Reach lighting follows `cellInReach`; light conveys
  reach and live POIs without outline rings. The radial player glow uses
  `PLAYER_OUTPUT_K = 0.44`; the added reach-cell light is halved by
  `REACH_OUTPUT_K = 0.5`, with interaction distance unchanged.
  Day/night leaves the reach plateau bright;
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
- Source-geometry road bands own all paving, in the game and map review.
  Raster road/path cells paint one shared backdrop type for both colour and
  biome texture (`Render.roadBackdropType`): explicit street ground, then the
  surrounding biome, then grass. Never paint raw road colours or separate path
  pebbles beneath the band; their grid edges read as a second road.
- Roads and paths use muted colors so ground objects remain the focus.
  Restored paving has recessed dark joints, tidy courses and small polished
  bevels; worn cracks and mushroom spots stay low contrast. Keep each theme’s
  undertone. Burned Row retains its dark stone and glowing embers.
- Restored Toadstool (Mushroom) and Snare lanes use near-black setts close to
  the default restored road. Retain their red/brown undertones and mushroom
  spots; the shared clean-stone bevel supplies the polished highlights.
- Slime Trail overlays its muted green paving with glossy slime pools and pale
  bubbles, in both worn and restored states. The same pattern painter serves
  runtime paving and the map review.
- Path paving and lamp palettes follow the assigned segment intervals. Scenic
  geography still owns restoration bonuses; first-walk stories use the assigned
  theme on the restored segment.
- Generate lamps only on paths and Small roads, from `Streets.lampSpacingM()`
  (independent of restoration ladder goals). Medium/Large roads have no lamp
  sites, including broken lamps and spawn reservations.
  One list and `lit` flag feed art and lighting. Derive verge offset from road
  width and lamp footprint; art and light share the same world point. Lantern
  rise is a draw-space offset; retune height through `LAMP_PROFILE`.
  Collect/cache lamps about the camera anchor, only after tiles finish loading.
- Restoration ladder rewards use `Trail.PRIZE_CONTEXT`; the first reward uses `firstPrize`.
  Synthetic loot classes need both a `CLASS_MAX_TIER` ceiling and a branch
  before item resolution. Cash rewards have no `slot`.

Tests: `lighting`, `reach_corners`, `streets`, `street_lamps`, `road_overlay`,
`trail`, `loot`; also `tools/layer_audit.js`.

- Cave pressure plates use a low-opacity floor mark revealed within one body
  cell. Plate-controlled gas outlets use one cached metal-grate texture and
  the existing gas-cloud renderer; both grate and plate sort as ground objects.
