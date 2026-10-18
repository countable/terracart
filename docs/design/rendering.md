# Rendering, lighting and streets

Detail doc for projection, sprite seating, performance, lighting and street
restoration. The root `CLAUDE.md` owns the overview; read this before changing
rendering, lighting or street mechanics. Camera and art geometry live in
[docs/art/map-perspective.md](../art/map-perspective.md).

## World layers

Use these terms for object presentation and walking behavior, not pixel height:

| Category | Code value | Examples | Compass and walking behavior |
| --- | --- | --- | --- |
| Groundcover | `WorldLayers.GROUNDCOVER` | Terrain, nexus/variant textures, floors | Follows the map; no support lift |
| Ground decals | `WorldLayers.GROUND_DECAL` | X marks, tar puddles, holes, flat rune rings | Above groundcover, below props; follows the map; no lift |
| Step-over props | `WorldLayers.STEP_OVER_PROP` | Cold/lit firepit, rocks, rubble, bushes, low walls | Upright; supports the player's feet while crossing |
| Standing props | `WorldLayers.STANDING_PROP` | Saplings, trees, lamps, dropped-item icons, houses | Upright; ordinary feet-based depth ordering; no support lift |

`WorldLayers.forObject` uses the explicit `RENDER_SPEC.layer` for decals and
`ObstacleStep.profile` for step-over props; all other objects are standing props.
Do not infer a category from image size, shadows, or whether an object is lit.
Saplings are standing props despite their small size. `ObstacleStep` measures
support continuously from world coordinates, so stopping on a prop keeps the
player raised; this is not a timed jump. Connected support masks stay in world
coordinates when the artwork counterrotates.

Resolved appearances carry `layer`; pooled sprites carry `_worldLayer`. The same
category controls depth order, fading, and compass compensation. Ground decals
always precede props. Both prop categories interleave with actors by ground
anchor, with the player drawn above their current supporting props at every
compass heading. `_worldDecalCount` marks that prefix for the rotated depth sort.
The render camera anchor snaps once to the logical pixel grid before ground,
sprites and inverse taps project their positions. Physical player/GPS positions
remain continuous; player art projects against that same snapped anchor.

Contact shadows are presentation attached to props, not ground decals; flat rune
rings are decals and retain the map's rotation.

The home firepit is centred two cells due south of the house's centre after the
first device-compass reading (see [Home](combat.md)), without an inward artwork
nudge. The ring, matching fire, smoke, interaction and step-over footprint use
that position. Its cold and lit states are both step-over props.

Continuous architectural walls are background geometry, separate from object
props. Their connected wall meshes remain attached to their ground footprints;
they cannot use per-object billboard rotation without opening gaps between
segments. In heading-up mode, `wall_perspective.js` retains ground vertices and
separate elevations for polygon, tiled and connected-prop walls. Each compass
change inverse-rotates only the height vector, selects camera-facing sides, and
orders short wall prisms by screen depth. Connected stronghold wall runs and
clipped hedge walls (the `connectedArtForTile` masks) join that batch through
`Render.drawConnectedWallPrisms` (source `props`): a core block plus an arm to
each connected cell edge, seated on the cells' terrain slots, rising by the
step-over lift in `ObstacleStep.PROFILES`, with thickness and colour from
`Render.CONNECTED_WALL_ART`. Those pieces leave the sprite pools for the frame;
they still interact, block and support steps from their data cells. An isolated
wall cell keeps its rubble sprite and a lone garden bush its rounded sprite.
Explicit triangles use Phaser's existing WebGL batching or Canvas fallback;
there is no wall canvas bake or texture upload on heading changes. At a fixed
heading the command buffers are reused. House footprint foundations use the same
retained perimeter faces, descending below the floor instead of rising as a wall.
Only camera-facing sides draw; uncapped perimeters also support concave footprints
without triangulating their textured floors. Floors remain cached ground textures;
Procedural house roofs use triangulated caps and retained sloped roof faces.
They share the same elevation projection in north-up and heading-up modes;
legacy sprite modes retain the north-up wall atlas artwork.
The WebGL low-poly path (`building_lowpoly.js`) draws houses to match the 2D
billboard sprites: `BuildingLowPoly.LOOK` owns the height foreshortening, the
ink outline pass, eave shadow, flat-deck bands and chimney numbers, and the
material sheets are cut once per material from the tilesets. Roof UV wrapping
uses the selected sheet's repeat: 360 texels for approved crops, 288 for generated
and cel sheets, so atlas boundaries preserve the material pattern. Each low-poly
building has a pooled render object in `worldContainer`, interleaved with props
and actors by its footprint's vertex-average ground anchor. Faces and ink groups
remain ordered within that building. This is whole-building painter ordering,
not per-pixel occlusion for long or concave footprints. Buildings retain map
rotation; only their elevation vector compensates for heading. The retained
geometry's pan offset also moves its sorting anchor, including at a fixed heading.
Ground floors and the legacy architectural walls remain in their background
passes. Standalone building viewers without a world container sort buildings
in their existing wall container.
[Low-poly building styles](../art/lowpoly-building-styles.md) owns the detail.
`WallPerspective` prisms (castle ramparts, Canvas fallback) read the same
table: height through `LOOK.heightScale`, and the ink outline is drawn once
per connected run (blocks sharing a ground vertex at the same base level)
before that run's first fill, so a ring of sections shows no seams while
crown teeth outline separately. They remain untextured.

Home — the player's house (`HomeArea.HOUSE`, footprint stamped by
`scene_venues.js`) — draws no sprite: `Render.houseTextureKey` hands its role
a null key, and the overlay's Home branch (`building_overlay.js`) paints its
house floor on the canvas and then the house. On the low-poly path it is the
`home` role (`BuildingLowPoly.ROLES`); while the player stands inside
(`scene.homeInside`, part of the overlay's claim epoch) its recipe is
`interior` — the roof off, the walls level at the eaves, inner faces and a
thick top band (`interiorGeometry`) — and the lightmap masks the outside (see
Lighting). Without the low-poly path (Canvas, north-up) the same house is
retained prisms in the `home` group (`WallPerspective`, `alwaysActive`) with
the fort's thickness and a taller wall, a doorway gap on the door side
(`shape.door`), and a gabled two-tone roof with a ridge; inside, no roof and
the wall tops in the wall's own colour. The sign seats over the drawn top, or
`HOUSE.signLiftPx` above the footprint's centre when there is no model.

## Coordinates, rendering and performance

Enemy roster sheets load when their kind enters the active creature bubble, before
viewport culling; a depth change or new spawn uses the same path. Sheets needed
for boot-baked inventory portraits remain eager. The loader deduplicates requests
and retains its single retry and palette hooks. During a cold transition the
actor uses a neutral warning marker until its own sheet arrives; the next
draw restores its directional/attack frame. Pet and elite recoloring waits for
the real source so a missing texture cannot become a permanent cached palette.

- `Render.drawSpiderWebs` draws cell-sized ground silk below characters and
  a strand from the fixed launch point to the moving projectile tip above
  the world. It reuses two graphics layers, culls to the viewport and clears
  both each frame, including depth changes; no cell-cache invalidation is needed.

- Draw from the camera anchor using `coords.js` projection helpers. Reach,
  taps, fog and tile loading use `playerM` / `playerToWorldCell()`.
  Draw player-attached effects at `scene.playerScreen()`, not viewport centre.
- Named booth signs show the booth kind above at most two words of the rusticified
  place name. If the second word is an article or connector (such as “the” or
  “of”), only the first word appears. Full names remain available in dialogs.
- The circular map and compass rim sit 55 CSS pixels above the layout baseline;
  the published aperture position follows the canvas so touch targets stay aligned.
- Zoom is camera-only. The initial view spans nine cells instead of eleven,
  one cell closer on each edge (`MAP_DEFAULT_ZOOM`). Plain +/− buttons on the
  right change the resting span by two cells, bounded by `PINCH_VIEW_CELLS`
  and `VIEW_CELLS`; disabled buttons mark the limits. The choice lasts for the
  session, including modals and depth changes. Pinch zoom remains temporary
  and springs back to that selected view on `PEEK_RETURN_MS`.
  `_applyMapZoom` clips the camera viewport and counter-scales map chrome;
  the DOM controls never zoom or rotate. Gameplay ranges and loading stay
  based on `VIEW_CELLS`; taps convert back through `_unzoomPt`.
  The opening shot uses the same camera and ends at the selected resting zoom.
- Once Phaser selects its renderer, software Canvas uses a 1× backing store:
  the logical pixel-art grid. WebGL retains its 2× memory budget. This avoids
  CPU-bound high-DPR rasterization during map rotation without changing CSS
  layout, camera projection or pointer coordinates. Both cameras use the same
  existing resize path, which explicitly restores the logical CSS size before
  refreshing input bounds when returning to scale 1. Explicit `?rscale=N` remains a diagnostic override,
  bounded to 1–2×; game cadence is unchanged.
- iPhone compass samples with negative headings or negative/non-finite accuracy
  are ignored, retaining the last usable bearing while the sensor recalibrates.
  The first absolute bearing replaces any relative startup smoothing history.
- Heading-up is the default (`?headingUp=false` keeps north up). The main
  camera turns about the view centre by `-compassDeg` (Q / E fake it on
  desktop), and the map clips to the inscribed circle. Phaser's two-corner
  camera cull is disabled for that camera because rotated bounds invert;
  world pools and masks still bound rendering. Camera scroll remains fractional
  (`roundPixels=false`) so Phaser cannot shift the solved rotation centre away
  from UI projections and inverse taps. Depth ≥ 90 draws on an
  unturned `uiCam`. Upright art counterrotates around explicit ground anchors
  and sorts by rotated feet only between `prerender` and `postrender`.
  Groundcover and ground decals retain the map rotation. Body effects, tree fruit and tower
  flags share their owner's anchor; transparent frame padding is not a foot.
  Roof signs and DOM delivery bubbles use that same footprint anchor; batched
  sign boards and smoke counterrotate their drawing commands. Contact shadows
  keep their ellipse orientation. Building shadows share the building pivot,
  retain their screen-vertical inset, and size to the visible art footprint.
  Broken lamp posts and dropped items stay upright like other raised props.
  Creature appearance directions rotate without changing simulation state.
  The player facing chevron is omitted in heading-up mode when a device
  compass reports, unless direction lock is engaged. The gold lock beside zoom
  holds the current map rotation while sensor readings continue; the caret then
  shows phone direction. Unlocking eases toward the current sensor heading. This
  scene-local choice resets on scene creation. Until a GPS fix is captured,
  direction is forced locked even if the heading sensor reports. Tapping the
  lock subscribes to the shared GPS watch and unlocks on success; failure keeps
  it locked. Repeated taps share one pending request, released on shutdown.
  Detection alone does not relocate a sandbox or teleport world. Desktop without a heading sensor
  and north-up mode retain the caret. The heading-up compass rim keeps its north marker.
  Game state stays north-up; taps, peek drags and steering convert back
  through `HeadingUp.toWorldVec`, including the manual GPS stick.
- Map annotations use `HeadingUp.toOverlayPt` for UI-camera graphics: rotate
  and zoom their ground anchor, then apply the upright body/head lift. Work
  rings, tools, watering effects and enemy health bars mark themselves `_huUI`
  after projecting, avoiding a second transform. Toasts keep `_huAnchor`
  separate from stacking, head lift and drift; default loot and banners stay
  fixed in the UI, including their DOM icons. Rim dots intersect the visible
  circle at the current zoom; labels stay upright inside it and taps retain
  the corresponding unzoomed world point.
  Both cameras refresh their render scale on resize. Multiplayer names,
  health bars and ping graphics use a counter-rotated annotation container
  with the same projected anchors and circular rim limits.
- The player's feet sit on the GPS fix. Ground marks (shadow, footprints,
  the facing chevron) use that point; body
  effects use `playerBodyDy()` so they also follow the downed pose. Do not
  compensate for sprite seating by changing the projection.
- Water, tar-yard terrain and unburned street tar puddles lower the player's
  body to the waterline and crop away the lower half of its current sprite frame.
  This spatial pose stays while paused, clears on dry ground, and yields to
  flight, the dragon form, collapse and step-over support. It does not change
  movement, reach or feet-based sorting; heading-up rotates the same cropped body.
- Flight raises the body by the consumable row’s `liftPx` through `playerBodyDy()`;
  the shadow, world position and ground sorting remain at the feet. Expiry lowers
  the body automatically. Thrown flight potions also raise creature bodies.
- Upright scenery and characters (including the player) share
  `Render.sortWorldDepth`: lower continuous ground/feet Y renders in front.
  Use stable seating geometry, never animation lift or whole cell rows.
  Add sprite appearances to `RENDER_SPEC`; ground surfaces stay underneath.
- Layer order is landcover, variant surfaces, building footprints, walls,
  ground state (such as oil spills), then objects and characters.
  Building footprints and walls are background. House and temple foundations
  share the floor canvas: draw the shaded base below the top surface, with a
  thin rim rather than an upright perimeter wall. House sidewalls stay close to
  the footprint's brick colour, with a modest shadow in both restoration states.
  Polygon fort walls and tiled castle
  ramparts live in `buildingWallContainer`, immediately above the footprint
  layer and below pads, traps, shadows and every interactable. Wall geometry
  never adjusts an actor's feet or enters the world depth sort. Towers and
  flags retain ordinary world ordering. Tower textures fade fully to transparent
  across their bottom ten pixels so cell-seated bases blend into angled walls;
  this is baked once for both restoration states. Walls and footprints use a muted
  palette so interactables remain distinct. Unclaimed house and fort floors
  retain a little more brick red and weathered timber warmth beneath the green
  wash; their existing slime, grain, cracks and dark foundation edges preserve
  the dilapidated state. Restored floors and castle materials keep their palettes.
  Castle courtyards are cell-tiled. Half of the cached variants are one full
  cell slab; the rest split it, a quarter into four quarter-cell stones (2×2)
  and a quarter joining one adjacent pair into a horizontal or vertical
  half-cell slab, with both positions represented. Polygon courtyards
  scatter those variants across a cached eight-cell-square repeat; tiled floors
  choose them from a mixed world-cell hash. The pattern stays fixed while the
  camera moves. Each joint uses one recessed pixel, with quiet worn stretches
  and stronger corners. Polygon courtyards use these stone seams without a
  second cell-grid overlay.
  Castle wall caps and faces use `CastleStyles.rampart` dimensions in both
  renderers. The cap stays narrow while the shaded face stands well over
  twice its depth, so walls read as three-quarter uprights rather than a
  top-down outline; polygon corners use bounded bevel joins with faces beneath them.
  Merlons have low rectangular tops spanning the full wall-cap width, with both
  opposing faces flush with the wall below at every angle. Their length along
  the wall is independent of its thickness. Full end blocks reach each corner;
  the rear highlight stays inside the cap silhouette. Polygon wall bodies and
  crenellations use separate cached passes, with every body drawn before the
  crowns so adjacent wall sections cannot cover a crenellation top. Heading-up
  prisms order each supporting wall by screen depth, then draw its bodies before
  its crowns, so a rear crown cannot overpaint a nearer wall. This retained
  centroid ordering handles ordinary joined walls; intersecting walls are not
  split into an exact visibility graph. Castle wall
  bodies omit mid-wall shadow stripes; the bottom silhouette and a quiet rear highlight define the edge.
- Standing objects fade to half their normal opacity only when their art overlaps
  the player's inset body box and their world depth draws them in front. The
  overlap uses cached trimmed `ART_BOUNDS`, with frame bounds for procedural
  art, and updates even on reused sprite slots. Moving clear restores the
  original opacity; tool access never changes it. On a turned heading-up map
  both boxes stand at their turned feet and lower turned feet count as in
  front (`Render.headingFadeView`), matching the heading-up draw order.
  Prop contact shadows turn about their prop's ground anchor, so a tucked-up
  shadow stays under the art at every compass heading; a wild plant's authored
  shadow (`Render.wildplantShadow`) is the same ellipse rule off its seated
  art at the plant alpha, centred on the foot `Render.plantPlacement` draws
  the plant on, and turns about the plant's cell point; the shrine pedestal
  (`pad_shrine`, drawn with its masonry face south) turns back about its cell
  centre the same way, while flat POI pads turn with the ground. Ground decals retain their own
  opacity, and fruit overlays follow their tree.
- Taps resolve the data cell (`sameAbsCell`), not pixel bounds. Seat cell-bound
  sprites through `seat: true`, `seatInCell` and `ART_BOUNDS`: centre horizontally;
  centre vertically if they fit, otherwise bottom-seat 1px above the cell edge.
  Seated art, shadows and labels counterrotate about the cell centre so these
  offsets stay screen-relative at every heading; depth uses the visible foot.
  Buildings, moving creatures and canvas-baked street lamps have separate seating.
  A house sprite (small and medium tiers) stands its bottom-middle on its
  footprint's centre of mass: the object sits on the nearest footprint cell
  and carries the remainder (`footDx`/`footDy`, worldgen
  `footprintFootOffset`); its shadow, sign, roof plate and bubble follow the art.
  Building contact shadows use 25% opacity.
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
- Large gas-emitting mushrooms reuse the regular giant mushroom frame, scale
  and seating with a yellow-green tint shared by gameplay and map review. Small
  gas mushrooms retain their dedicated art. The renderer carries `gasEmitter` into the crop view without changing crop
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
  graphics-FX opt-in (`Render.canShine`). Phaser's PreFX pipeline draws its
  offscreen passes under the current camera scissor, and the map camera is a
  sub-viewport, so `Render.guardPreFxScissor` lifts the scissor around each
  FX quad (app.js installs it before the game boots); without it a shiny
  prop vanishes or shows a slice at every zoom but 1 and every heading.
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
- Ground coins pulled by the Ring of Gathering move every scene frame using
  elapsed time, capped at 100 ms after a stall. Their speed is independent of
  display cadence; collection still resolves at the player's feet.
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
  their scale compensates for the larger source grid,
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
  Regular rocks and boulders both use 24px frames at 80.96% of scale 16/15 (`ROCK_WORLD_SCALE`; placed
  stones 1.408, the produce icon); their height
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
  frame uses the same `ROCK_WORLD_SCALE` for small stones and sight-blocking boulders.
  `ROCK_VARIANT_ART` owns these scales; placed rocks draw their 16px produce
  frame at 1.408×, comfortably inside a cell.
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

- Exploration fog is optional and off by default. The menu's **Fog of war**
  button applies immediately and persists per device as `terracart.fogOfWar`.
  When enabled, unknown surface ground has a neutral grey wash with a dense
  interior and smooth, wispy frontier. Exploration continues to record and save
  while the wash is disabled. This setting does not affect cover visibility,
  night lighting or cave darkness; underground never draws exploration fog.

Surface daylight follows the player's local sun with a 30-minute extension at
both dawn and dusk. Nighttime ambient luminance is 10% brighter, blending back
to the existing noon level. The circular reach indicator keeps half its added
light; the smooth player glow carries the other half, preserving nearby
brightness on the surface and underground. This compensation fades beyond
the reach rim within the existing player-light radius.

- `Visibility` owns current cover, separately from `Fog`'s saved exploration.
  Only cave terrain walls fully block sight beyond their cell. Bushes, hedges,
  short walls, larger standing trees and rocks marked `sightBlocking: true`
  provide partial cover, with a non-stacking 50% darkness treatment. Small
  rocks and the smallest tree saplings provide no cover. The facing blocker
  stays visible. Any cover (`Visibility.hidden`) removes the actors behind
  it — creatures, peers, coins, shots — with their labels, shadows and
  target affordances. Scenery (objects, plants, crops, traps, hazards) and
  the ground stay drawn and tappable in the shadow so the player keeps their
  bearings; full cover is black and removes scenery as well. The cover
  mask's feather spreads outward only, so every hidden cell keeps its full
  darkness, including the occupied cells of concealing bushes and trees.
  At zero energy, cover stops hiding actors/scenery and the obstruction mask
  clears; both return on revival. Physical cover for enemy sight is unchanged.
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

- `lighting.js` owns the sole lighting pass: additive source cookies composed
  into a lightmap and multiplied over the world. Canvas is the default compositor;
  the opt-in GPU compositor below consumes the same shapes and light gains.
  Do not add darkness passes or dim sprites
  again. Its screen-attached base (ambient plus player ramp) stays baked while
  walking; the player circle retains fractional-pixel positioning without cell-change fades.
  Reach and street restoration follow movement within a cell, independently of
  camera peeks. Canvas and GPU share one circular mask, rebuilt only when its screen position,
  radius or viewport changes. Stable world cookies use padded caches
  by their exact whole-pixel phase. Player-attached, breathing, flickering and
  transient lights keep the individual stamp path. The full-frame key gates
  before every canvas call. Reach lighting uses a circle centred continuously on the exact player position with the interaction
  radius. `cellInReach` accepts a cell exactly when its square overlaps the
  circle; tangency alone does not count. The base circle is reduced to match
  the old centre-tested cell footprint when standing at a cell centre. Smooth
  movement still changes which boundary cells overlap. Each Inner Light upgrade crosses only
  the next projected cell-square overlap threshold, unlocking tied cells together.
  Upgrade thresholds use actual row grid widths, including the differently aligned cells at tile-row seams;
  the established nominal base radius remains unchanged,
  and are cached by the containing cell and projection. Depth and blindness
  adjust the base radius before upgrades, so every upgrade adds reachable cells; light conveys reach and live POIs without outline rings. The radial player glow uses
  `PLAYER_OUTPUT_K = 0.44`; the added circular reach light is halved by
  `REACH_OUTPUT_K = 0.5`. The smooth player glow carries the removed half,
  preserving nearby brightness on the surface and underground. It fades beyond
  the reach rim within the existing light radius.
  Day/night leaves the reach plateau bright;
  caves ignore it.
- Indoors (`scene.homeInterior`, non-null while the player stands on one of
  Home's cells) `paintIndoorMask` fills the lightmap outside the house with
  `HomeArea.HOUSE.maskColour` at `maskAlpha`, the house cut out as the convex
  hull of its ring and the ring lifted by the walls' height (`liftPx`, so the
  lift is screen-up at every heading); the frame key carries the interior and
  the GPU compositor stands down while it is up. Masks compose over the lights;
  only sources add.
- Add sources through `Lighting.KINDS` / `sourceKind`; point-source collectors
  cull by viewport plus light radius, not sprite bounds. The POI pad and the
  `poi` light together mark a real map POI: a loose crate and a generated
  barrel or pot (`o.barrel`, no `poiClass`) get neither. Use the existing
  derived luminance/contrast controls; remeasure the plateau ceiling before
  raising it.
- Waystones use the existing plain rounded low-rock frame (`rock_variants:0`)
  at the shared small-rock scale. At startup, a source-atop ivory material
  variant preserves the rock’s alpha and shading. The per-draw material hook
  selects it while lit so activation reads in daylight in Canvas and WebGL;
  cached geometry remains valid. `Waystones.isLit` also gates the steady ivory `Lighting.KINDS.waystone` source, including permanent
  completed sets. Unlit stones emit no light and no daily-availability pulse.
  The same inset contact shadow as mineral rocks grounds the low silhouette.
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
- Suppressed Medium/Large roads use weathered grey-turquoise stone, sparse turquoise mineral
  fractures and dusty ground across the full road suppression buffer, including
  after restoration. Restored bands keep the weathered surface color, replacing
  fractures with a softly glowing turquoise outline around the road geometry. The ground uses the road buffer mask (excluding parking-only
  suppression), on the surface and outside water/buildings. Dry wasteland texture with sparse baked turquoise gem/star flecks
  replaces lush biome detail there. Flecks are static paint, never light sources. This render-only palette never enters street
  theme selection or dressing; runtime and preview share the pavement painter.
- Old Stones uses grey-purple ground, stone dust, lichen and pale lavender
  lamps, distinct from the turquoise rift palette.
- Generate lamps on paths and Small roads from `Streets.lampSpacingM()`
  (independent of restoration ladder goals), with sparse lamps on Medium/Large
  roads. Street variants tint ordinary lamps; an enclosing nexus takes precedence.
  Suppressed roads keep their own muted turquoise light and chipped stone wayside
  lamps even inside a nexus.
  One list and `lit` flag feed art and lighting. Derive verge offset from road
  width and lamp footprint; art and light share the same world point. Lantern
  rise is a draw-space, screen-up offset (`dyPx`); on a turned heading-up map
  `Lighting.liftPx` turns it back into the map's frame so the glow stays on
  the upright lamp's lantern. Retune height through `LAMP_PROFILE`.
  Collect/cache lamps about the camera anchor, only after tiles finish loading.
  A lamp's footing (`RoadOverlay.lampCellsFor`, the same reserved cells
  dressing keeps clear) is never tillable: `cellAt` flags it `underLamp` and
  `isTillableCell` refuses it.
- Restoration ladder rewards use `Trail.PRIZE_CONTEXT`; the first reward uses `firstPrize`.
  Synthetic loot classes need both a `CLASS_MAX_TIER` ceiling and a branch
  before item resolution. Cash rewards have no `slot`.

Tests: `lighting`, `lighting_player_circle`, `streets`, `street_lamps`, `road_overlay`,
`trail`, `loot`; also `tools/layer_audit.js`.

- Cave pressure plates use a low-opacity floor mark revealed within one body
  cell. Plate-controlled gas outlets use one cached metal-grate texture and
  the existing gas-cloud renderer; both grate and plate sort as ground objects.

### GPU migration candidates

Phaser AUTO already uses WebGL for sprites and Graphics when available.
Measure CPU work and uploads before replacing another renderer. Moving lights
and flicker can trigger Canvas blending and a full lighting texture refresh.
The lighting prototype (`?gpuLighting=true`) moves composition into Phaser's
WebGL context. `lighting.js` supplies cached source canvases with repaint
revisions and crop positions; `lighting_gpu.js` uploads changed sources and
composites them into a retained GPU lightmap. The circular reach mask receives
its radial colour before composition; cover composites last. Explicit
premultiplied-alpha blend factors preserve Canvas additive semantics.

The prototype defaults off. Unsupported renderers and compositor failures use
the Canvas path. `LightingGPU.status(scene)` reports the active backend,
fallback reason and upload/composition counters. A successful fallback is not
a GPU benchmark. `tools/probe_gpu_lighting.py` compares both modes under the
same scripted lighting and camera changes. Target-device visual, frame-time and
power measurements are required before enabling it by default; lower CPU time
alone does not establish a battery saving.

Dense gas Graphics are another profiling candidate; exploration fog is lower
priority because it defaults off and changes mainly with cells or state. Roads
and static terrain already amortize rasterization through cached textures and
sliced rebuilds; replacing them with live geometry is not inherently faster.

`tools/probe_wall_perspective.py` compares a dense nine-castle fixture under
continuous injected device heading. It records frame CPU time, render submission,
wall update time, and texture/buffer calls where WebGL is available. Run identical
browser/backend settings against separate baseline and candidate servers.
Headless CPU timings do not establish handset GPU time or a 120fps guarantee;
validate on the target device before making that claim.

## Footprint building styles

The default house and fort architecture comes from `building_styles.js`, using
source building polygons rather than a freestanding sprite. `Render` owns the
role and shop-line style tables: plaster terraces for residences, brick for the
blacksmith, Japanese roofs for traders and book/pet shops, stepped pyramid roofs
for the wizard and potion/relic shops, stone tiers for forts and low broken walls
for wrecks. Restoring a building changes its material and geometry together.

`BuildingOverlay` emits retained prisms only when footprint inputs or restoration
state change. Roof insets stop when narrow or concave wings cannot support another
level; they never scale toward a centroid outside the building. The existing
source data exports individual rings, so courtyard holes are not reconstructed.
Source polygons without surviving house icons still receive architecture. Home
and synthetic houses without polygons get a bounded square footprint using their
existing area and ground anchor. A house sprite hides only after geometry has
actually been emitted; interaction cells, shop signs and delivery badges remain.
Badge elevation reads the emitted building height. Geometry remains in the existing
building background layer below actors, including on tall roofs.

`?buildingArt=legacy` selects the original sprites. Omit the query or use
`buildingArt=procedural` for footprint architecture. This per-page selection is
not saved. Original sprites also supply restoration cards and Home icons.

## Bush and container artwork

`assets/Objects/CelProps/` supplies native 24px bushes, brambles, clipped hedges,
coastal palms, barrels and pots. Stable plant IDs select canopy frames. Berry
textures bake red, teal or gold fruit onto all eight canopies once at startup;
picking retains the same foliage frame and transparency. Square clipped bushes
present a broad side toward the camera. Connected hedges retain their fifteen
cardinal masks and use matched edge pixels from `assets/Objects/Hedges/`.

`CONTAINER_CONTEXT_ART` in `loot.js` selects cosmetic barrel/pot frames from
zone, then street, then biome; unknown contexts use oak and terracotta. Coastal
contexts use rope-bound or painted wood and turquoise pots, industrial contexts
use copper-rimmed or repaired barrels and charcoal pottery, and wetland contexts
use mossy rain barrels. Pot shards retain the intact pot's frame. Selection does
not change rewards, material identity, saved IDs or restocking behavior.

## Building sprite artwork

Restoration choices, Home's icon and map sprite fallbacks use the original
role textures through `Render.houseTextureKey` and `Render.houseTextureFrame`.
Plain houses use the `house` front frame; shops and other roles use their
original `house_<role>` images. Wizard towers and turrets retain their shrine
and tower frames. Unclaimed forts use their baked weathered artwork.

Procedural buildings remain the default on the map. `?buildingArt=legacy`
selects the original sprites instead. Both modes use the original artwork
for dialog icons and sprite fallbacks.

Default oak barrel art uses the supply crate’s manufactured-wood palette directly,
without a runtime tint. Only frame 0 of the barrel sheet is replaced; the other
seven variants retain their original pixels. Default barrels scale to
`(2/3) × 1.1 × 1.1`. Long grass uses `1.16 × 0.9`; trunk chests use
`1.6 × 0.8`, and supply crates use `0.8 × 1.1`. Chests have trimmed bounds for every tier to keep their art centered.
