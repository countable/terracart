# Rendering, lighting and streets

Detail doc for projection, sprite seating, performance, lighting and street
restoration. The root `CLAUDE.md` owns the overview; read this before changing
rendering, lighting or street mechanics. Camera and art geometry live in
[docs/art/map-perspective.md](../art/map-perspective.md).

## Player robe colour

Reflect stores one of `Multiplayer.COLORS` in `save.playerColor`. Farmer, all
four callings and the mounted sheet have a separable cyan cloth palette:
`#349aa4` shadows, `#4ebcb9` midtones and (runner only) `#6cd8d5` highlights.
`PlayerRobeArt.bake` reads each loaded PNG once and builds all ten texture and
directional-animation variants with `recolorEnemyPixels`' exact `colors` map
and `preserveUnmapped`. Skin, hair, tools, metal, mount, alpha and frame geometry
stay unchanged. `_syncPlayerSkin` selects cached art without pixel reads or
texture creation during movement. Dragon form keeps its own art. A future
sheet with no separable cloth palette falls back to whole-sprite tint; none
of the current sheets needs that fallback. Conditions still tint over the robe.
Name and colour changes share multiplayer's persistence and fresh-hello path;
offline colour edits never connect the player. Peers use the same cached farmer
robe variants; calling choices remain local.

## Selected world artwork

Approved dashboard ALT IDs are recorded beside their native crop exports in
`assets/Objects/SelectedProps`, `assets/Objects/SelectedFlora` and
`assets/selected-terrain`. Containers and surface mushrooms choose among the
approved alternatives by stable object identity; terrain uses existing spatial
variant indices. Never vary these choices with time. Colour-matched pot shards,
underground mushroom art, crop growth stages, berry-bush remnants and loot
behavior remain separate from the new standing artwork. Retired reference
assets and planned cave mechanisms do not gain placement merely by changing art.

Runtime loads selected art from local spritesheets: `SelectedWorld/world.png`
for world props and flora, `Icons/SelectedItems/items.png` for item choices,
and the existing `selected-terrain` strip for terrain. Rebuild the world atlas
with `tools/build_selected_world_atlas.py` after changing its source exports;
`tools/build_selected_items.py` owns selected item crops and frame metadata.
The exporters preserve native pixels and record their source ALT IDs.

`ArtAtlas` registers logical texture aliases using the master sheet's shared
Phaser `TextureSource`, so aliases add neither image requests nor GPU uploads.
Their generated `frameRects` preserve local frame numbers and dimensions;
the master alone owns source destruction. World objects that are also items
(such as torch, rubble and wood) point at the selected item's exact rectangle.
DOM icons, dashboard previews and sprite audits resolve those same rectangles
rather than inferring frame positions from the packed sheet width.

Trees and water remain opt-in through `artTrial=trees-water` (or `trees` /
`water`); `artTree=ALT-0038`, `ALT-0176`, or `ALT-0245` fixes the broadleaf
comparison. The trial registers native textures only for that page load,
preserves tree growth and saves, and never changes normal game defaults.

## World layers

Use these terms for object presentation and walking behavior, not pixel height:

| Category | Code value | Examples | Compass and walking behavior |
| --- | --- | --- | --- |
| Groundcover | `WorldLayers.GROUNDCOVER` | Terrain, nexus/variant textures, floors | Follows the map; no support lift |
| Ground decals | `WorldLayers.GROUND_DECAL` | X marks, tar puddles, holes | Above groundcover, below props; follows the map; no lift |
| Step-over props | `WorldLayers.STEP_OVER_PROP` | Cold/lit firepit, rocks, rubble, bushes, low walls | Upright; supports the player's feet while crossing |
| Standing props | `WorldLayers.STANDING_PROP` | Saplings, trees, lamps, dropped-item icons, houses | Upright; ordinary feet-based depth ordering; no support lift |

`WorldLayers.forObject` uses the explicit `RENDER_SPEC.layer` for decals and
`ObstacleStep.profile` for step-over props; all other objects are standing props.
Do not infer a category from image size, shadows, or whether an object is lit.
Saplings are standing props despite their small size. `ObstacleStep` measures
support continuously from world coordinates, so stopping on a prop keeps the
player raised; this is not a timed jump. Connected support masks stay in world
coordinates when the artwork counterrotates.

Furniture uses the ordinary object list so the Home's near walls can occlude
it. `FURNITURE` owns each item's frame, flat/mid/basin height and supported flip;
flat rugs are ground decals and mid pieces use `ObstacleStep.PROFILES.furniture`
for continuous support. Basins are walkable ground decals with no step lift;
they draw under the player, whose submersion crop hides only the lower body.
`RENDER_SPEC.furniture` seats each piece from its trimmed bounds at
`FURNITURE_SCALE` (1: approved 24px art cells map to 32px runtime cells;
24×32 beds/bookcases can extend above the cell).
New furniture bases sit horizontally centred, one-third of a cell up from its
bottom (`seatFoot: 2 / 3`), letting tall art overlap the wall behind. Rugs retain centred art. Tall beds and bookshelves use the shared tall-art
seat, with their bottom one pixel above the cell edge. Mirrored bounds keep asymmetric pieces
centred when flipped. The base center comes from the bottom three opaque
rows, so an overhanging lamp shade does not displace its stand. Depth and lamp
emitters follow the same base. Mutable furniture
appearances are not cached. The complete piece is fitted proportionally into a
16×16 icon for item surfaces. `tierSheetFrame` maps catalog tiers to the seven
styles: Crude, Simple, Fine, Veblen, Masterwork, Royal and Ancient. The shared
`furnitureFrame` resolver keeps world and inventory art together; workbenches
and candelabras retain their roster art. Existing catalog tiers select the style;
these images do not introduce per-instance tiers or alter item progression.
Crops carrying a `planter` furniture id use
`RENDER_SPEC.furniture.planterCrop`: a 16px frame starting 3px below
the cell's top edge before applying the planter's seating offset, so its roots
move with the soil. Their normal growth art is unchanged. The crop
shares its planter's ground depth and sorts immediately above it, preserving
Home wall occlusion.

`python3 tools/build_furniture_sheets.py` rebuilds both sheets from
`assets/Objects/Furniture/manifest.json`. Approved overrides use a 24px native cell: small pieces are 16×16,
and beds/bookcases are 24×32. The builder scales these by 32/24 with nearest
neighbour sampling into the existing 32×64 slots. The manifest selects only
approved kind/tier pairs; all other art remains in the legacy 32×32 atlas.
`source/approved/approvals.json` records provenance, source/export hashes and
backdrop removal. Both roster and tier frames use the same approved source.
Icons fit the complete piece proportionally. Roster frames occupy 0–15 and the 91 tier frames
follow them. The original workbench and candelabra source crops still use their
existing fit rules. The sprite audit covers every frame and permitted flip.
After rebuilding art, regenerate `ART_BOUNDS` and the DOM icon atlas so map,
inventory, shop and pickup-toast surfaces agree. Indoor lamps emit through the
shared lighting pass.

The 16-piece roster is Tinker’s Workbench, Quilted Cot, Washing Tub (basin), Gear-Rim
Looking Glass, Oak Side Table, Four-Drawer Dresser, Clay Planter, Burgundy Rug,
Frontier Bookshelf, Floor Lamp (T3), Grandfather Clock (T3), Pedestal Owl
(T2), Riveted Copper Planter, Floor Candelabra (T1), Surveyor’s Globe and Brass
Stargazer. The floor lamp uses the stock Arcane Library shaded lamp in a 32×64 frame across
all quality tiers, with its light seated at frame y=14. The owl statues, clocks
and planters use generated 24×24 tier sprites. Both planter items share the seven
tier variants, with empty soil for crop overlays. The candelabra retains its
existing source crop; the tub uses its approved generated variants. Each piece
still occupies one floor cell.

Large item and gear portraits (48px and above) use the five 8×8 dialog atlases
in `assets/Icons/DialogItems`, built by `tools/build_dialog_item_art.py` from
sundries-reference painterly masters on black. `DialogItemArt` maps all 345
catalog IDs to 96px cells. Small inventory/map icons retain their original art.
Large portraits preserve variant tints and badges; loot rewards and tapped item
descriptions display them at 96px. The catalog records every reference crop and
generated cell; the manifest records source and export hashes.

Resolved appearances carry `layer`; pooled sprites carry `_worldLayer`. The same
category controls depth order, fading, and compass compensation. Ground decals
always precede props. Both prop categories interleave with actors by ground
anchor, with the player drawn above their current supporting props at every
compass heading. `_worldDecalCount` marks that prefix for the rotated depth sort.
The render camera anchor snaps once to the logical pixel grid before ground,
sprites and inverse taps project their positions. Physical player/GPS positions
remain continuous; player art projects against that same snapped anchor.

Contact shadows are presentation attached to props, not ground decals. The
flat ground marks beside them (the elite's rune circle, the GPS ring) are
squashed top-down bakes: heading-up counter-rotates them like the shadows, and
the map's turn reaches their runes or ticks as a frame of their rotation strip
(`Render.groundMarkFrame`), never as a sprite rotation that would stand the
ellipse on its end.

The home firepit is centred two cells due south of the house's centre after the
first device-compass reading, or out front toward a street facing the door
(see [Home](combat.md)), without an inward artwork
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
`Render.drawConnectedWallPrisms` (source `props`): one union mesh for a core
and its connected arms, seated on the cells' terrain slots, rising by the
step-over lift in `ObstacleStep.PROFILES`, with thickness from
`Render.CONNECTED_WALL_ART` and surfaces from `WallMaterials`. Those pieces leave the sprite pools for the frame;
they still interact, block and support steps from their data cells. An isolated
wall cell keeps its rubble sprite and a lone garden bush its rounded sprite.
`wall_materials.js` owns the shared cel-pixel atlas: subdued hedge clusters,
bevelled crowns, single-width stone caps with shaded edges and transverse joints, mortared sides
and darker footing, and light crate wood. Only exposed edges bevel; shared cell
boundaries keep exactly matching cap vertices. Texture coordinates follow world
cells, so sub-cell movement and a view rebuild do not slide the material.
`wall_surface_renderer.js` submits the textured triangles through Phaser's
existing WebGL pipeline and uses affine texture triangles for Canvas fallback;
there is no wall canvas bake or texture upload on heading changes. At a fixed
heading the command buffers are reused. House footprint foundations use the same
retained perimeter faces, descending below the floor instead of rising as a wall.
Only camera-facing sides draw; uncapped perimeters also support concave footprints
without triangulating their textured floors. Floors remain cached ground textures.
L1 sewer water repeats the approved sewer tileset swatch on actual water, water
beneath pier decking, and existing underground route centre lanes through
`FloorWallMaterials.groundTexture`. The runtime ground pool and floor viewer share
that selection and its prebuilt texture, replacing the ordinary animated water
texture in the same ground slot. Terrain and collision stay unchanged: actual
water remains water, piers retain their decking, and decorative channels remain
walkable cave-floor cells. Both actual water and L1 route channels use the normal
waist-up player crop; pier decking stays dry. Flight, dragon riding and raised prop
support clear the crop as on surface water. Dry L1 cells use one cool-grey 16px stone slab enlarged to a 32px cell, with stable world-cell
selection of 14/16 plain slabs, 1/16 cracked slabs and 1/16 grates. Planning
previews call the same selector. Other levels keep their existing ground.
Building interiors use 32px swatches from the PP Interiors Pack's `all floors.png`
(`assets/Objects/BuildingMaterials/all-floors.png`): square tiles for houses,
wooden boards for Home and forts, and masonry for civic buildings. The patterns
remain anchored to world coordinates and clipped to each footprint.
`drawInteriorFloorTexture` repeats unshaded 32×16 source courses at half size
(16×8 at the 32px runtime cell), keeping floor motifs in proportion to furniture.
Nearest sampling preserves crisp edges. The wood and masonry swatches skip the
sheet's top wall-shadow band to avoid cell seams.
Procedural house roofs use triangulated caps and retained sloped roof faces.
`PolygonGeometry` owns collinear pruning, ear clipping and the shared even–odd
point-in-rings predicate. Renderers retain their own coordinate normalization,
canonical vertex order and mesh caches.
They share the same elevation projection in north-up and heading-up modes;
legacy sprite modes retain the north-up wall atlas artwork.
The WebGL low-poly path (`building_lowpoly.js`) draws houses to match the 2D
billboard sprites: `BuildingLowPoly.LOOK` owns the height foreshortening, the
upper outer-edge ink pass, eave shadow, flat-deck bands and chimney numbers, and the
material sheets are cut once per material from the tilesets. Roof UV wrapping
uses the selected sheet's repeat: 360 texels for approved crops, 288 for generated
and cel sheets, so atlas boundaries preserve the material pattern. Each low-poly
building has a pooled render object in `worldContainer`, interleaved with props
and actors by its footprint's vertex-average ground anchor. Faces and ink groups
remain ordered within that building. One upward-shifted silhouette draws before
all building faces, including wrecks, so bottom edges and internal joins receive
no outline. This is whole-building painter ordering,
not per-pixel occlusion for long or concave footprints. Buildings retain map
rotation; only their elevation vector compensates for heading. The retained
geometry's pan offset also moves its sorting anchor, including at a fixed heading.
Ground floors and the legacy architectural walls remain in their background
passes. Standalone building viewers without a world container sort buildings
in their existing wall container.
Standing buildings become 50% opaque while the player occupies their footprint
or their visible projected faces cover the player's body from in front. The
footprint test includes concave outlines; the overlap test uses visible triangles
for low-poly meshes and ramparts, and trimmed art bounds for legacy sprites.
These checks follow compass rotation and retained pan offsets, and restore full
opacity immediately on leaving. Faded low-poly buildings skip the filled ink
outline passes so overlapping ink cannot obscure the player through the fade.
They update opacity without rebuilding geometry
or reading pixels. Home keeps its separate indoor roof-cutaway behavior.
Wrecks render below the player without fading. Broken wall sections vary in
height; their interior step cuts run perpendicular to each wall, while corners
retain their mitred joins. Their roof remnant has an irregular broken edge,
short projecting rafters, and chipped supporting crowns. Dense opaque rubble
with dark gaps covers the floor; loose blocks spill beyond the main breach.
Legacy wreck sprites use the ground layer and
a flattened vertical scale; restoring a wreck returns it to standing architecture.

[Low-poly building styles](../art/lowpoly-building-styles.md) owns the detail.
`WallPerspective` prisms (castle ramparts, Canvas fallback) read the same
table: height through `LOOK.heightScale`, and the ink outline is drawn once
per connected run (blocks sharing a ground vertex at any level, or one wall's
support) before that run's first fill, so a ring of sections and the merlons
standing on it carry one upper outer outline with no bottom edge or internal seams. Legacy castle and Home prisms retain their flat colors; connected walls and fort pickets use the shared wall atlas.

`scene.activeInterior()` shares Home's interior renderer and outside-darkness
mask with detected malls and strip malls. Retail footprints come from the same
POI census as indoor-mall placement (`entry.retailInteriors`); two contained
public commercial booths qualify, including small strip centres. The player's
exact ground position opens the room, and stepping out restores its normal
building rendering. Retail uses the sheet's square tiles and Home keeps wood.
The overlay replaces the host shell with Home's open-roof, per-wall geometry;
courtyards are excluded from both the floor and the lit interior. This changes
rendering only: shop rewards retain their existing interior/frontage positions.

Home uses the original nearby building footprint, or a 2×2 footprint stamped
by `scene_venues.js` when no building is within two cells. It draws no sprite: `Render.houseTextureKey` hands its role
a null key, and the overlay's Home branch (`building_overlay.js`) paints its
house floor on the canvas and then the house. On the low-poly path it is the
`home` role (`BuildingLowPoly.ROLES`); while the player stands inside
(`scene.homeInside`, part of the overlay's claim epoch) its recipe is
`interior` — the roof off, the walls level at the eaves, inner faces and a
thick timber top band (`interiorGeometry`) — and the lightmap masks the outside (see
Lighting). An interior is one render object PER WALL (`interiorGeometry`
tags each face with its ring `edge`; `BuildingLowPoly.add` places a mesh per
edge), each sorted in the shared world sort at its wall's sort point
(`WallPerspective.wallSortPoint`, the one rule both building paths share:
the baseline's point in the player's screen column at the current heading,
clamped to the wall's ends and re-asked every frame; a wall seen end-on
takes its end lowest on screen), so the player draws over the wall behind
them and under the wall in front along the wall's whole length at every
heading; a standing building stays one object at its footprint centroid.
Without the low-poly path (Canvas) the same house is
retained prisms in the `home` group (`WallPerspective`, `alwaysActive`) with
the palisade's thickness and a taller wall, a doorway gap on the door side
(`shape.door`), and a gabled two-tone roof with a ridge; inside, no roof and
the wall tops in the wall's own colour, and the group is `perWall`: every
wall section draws into a part of its own in the world container, anchored
at the same sort point and handed to the frame's world sort through
`WallPerspective.worldPieces` — never the one wall-container graphics,
which sits under the player's container and drew the player over every wall.
Inside, on either path, no wall is inked at all (`noInk`): a wall inking
its own outline over its neighbour's fill left black seams between the
walls, and the dark mask outside the room is edge enough. The interior's wall thickness is `BuildingLowPoly.LOOK.wallThickness`
(2.8 px) on the low-poly path, placed outside the footprint so the full floor
remains available. Inner and outer faces retain identical opening UVs, including
shutters, sills and the entrance. A shared interior atlas uses warm plaster and
wood trim from [Pixel Plains Interiors Pack by Jose Javier (SnowHex)](https://snowhex.itch.io/pp-interior-and-houses-pack)
(`all-walls.png`); its timber wraps over
the cut tops. Both sides receive directional lighting and darker ground contact,
including generated exterior materials. Thickness is `HomeArea.HOUSE.thicknessPx` (2 px) on the
prism path.
A door faces the nearest street: `BuildingLowPoly.streetDoor` picks the
wall (its `edge`), which becomes the facade's entrance bay (`geometry`'s
`entrance`) and carries the plank door panel. Home's door has one source,
the trailer's saved doorway wall (`save.starterTrailer.door`): the nearest
road or path cell within `HomeArea.DOOR_STREET_CELLS` of its anchor at
placement (`_homeDoorSideToStreet`), the placement heading deciding only
with none that near. The overlay hands that wall to the low-poly house
(`ringEdgeNearest` → `add`'s `entrance` → `edgeDoor`) and the prism path
cuts its doorway there, so the painted bay, the panel, the doorway gap and
`homeInside` agree; an adopted house without a saved doorway asks the
streets like every other house. The sign seats over the drawn top, or
`HOUSE.signLiftPx` above the footprint's centre when there is no model.
While `homeInside()` is true, a separate white luxury number sits above that
sign in the same label pool and fades over the player. Its retained text key
includes the active Home, indoor state and `Furniture.luxuryOf` score; the
number never shares Home's typing clock.

A fort (tier 11; `Houses.displayRole` answers `fort`) is a palisade outer rim
plus a central gambling hall, never a generated body. The overlay paints the
fort's plank floor and emits the tier-11 pickets of `perspectiveEdges`:
separate broader pointed posts with rounded octagonal bodies and continuous cel shading,
sized and spaced by `WallMaterials.WOOD`,
along every footprint edge, as `WallPerspective` segments in the polygon group, so the rim
follows concave rings and turns with the compass like every other wall. The
hall is the approved `house_fort` sprite (`house_fort_unclaimed` before the
fort is unlocked), seated by the RENDER_SPEC `house` row on the footprint's
centre of mass at the fort row of `BUILDING_ART`; the overlay never records
the fort in `scene._proceduralBuildings`, which is what keeps that sprite
visible. `Render.BUILDING_STYLE_ROLES` has no `fort` row and `BuildingLowPoly`
never receives a fort footprint. With the overlay off, the tiled pass draws the
same rim from cell edges (`render.js`, tier 11). Turrets, wizard towers and
castles keep their own treatments.

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
- Zoom is camera-only. The resting view a game opens on spans seven cells
  (`DEFAULT_VIEW_CELLS`, `MAP_DEFAULT_ZOOM`); one level closer, five across
  (`PINCH_VIEW_CELLS`), is the room-sized view. Plain +/− buttons on the
  right change the resting span by two cells, bounded by `PINCH_VIEW_CELLS`
  and `VIEW_CELLS`; disabled buttons mark the limits. `_setRestZoom` is the
  resting zoom's one writer, and the view eases to a new rest through the
  peek's spring (`_tickMapZoom`: `ZOOM_STEP_MS` for a step, never a cut).
  Stepping inside Home (`homeInside`) eases to the closest level on its own
  and stepping out eases back to the player's choice (`_tickHomeZoom`,
  `HOME_ZOOM_MS`; once per crossing, so a step taken inside holds until they
  leave; never underground). The choice lasts for the
  session, including modals and depth changes. A pinch sets the resting zoom
  too: on release its zoom stays (`_pinchEnd` → `_setRestZoom`), anywhere
  between the full view and `PINCH_VIEW_CELLS`, and a later +/− steps from it.
  `_applyMapZoom` clips the camera viewport and counter-scales map chrome;
  the DOM controls never zoom or rotate. Gameplay ranges and loading stay
  based on `VIEW_CELLS`; taps convert back through `_unzoomPt`.
  The opening shot uses the same camera: after two seconds with the map
  unobscured it begins easing back to the selected resting zoom. Pending Home
  placement never holds the camera in the close-up.
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
  and north-up mode retain the caret. The caret is foreshortened down the
  turned screen (like the GPS ring), not the map's y, so it lies flat at any
  map turn. It is ground paint under the body,
  so it is pushed out along the heading by the least that takes it off the
  body's on-screen box; pointing up-screen it clears the head instead of hiding
  behind it. The heading-up compass rim keeps its north marker.
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
  the facing chevron, the GPS ring) use that point; body
  effects use `playerBodyDy()` so they also follow the downed pose. Do not
  compensate for sprite seating by changing the projection.
- Water, tar-yard terrain and unburned street tar puddles lower the player's
  body to the waterline and crop away the lower half of its current sprite frame.
  Furniture with height `basin` does the same at the player's feet cell on the
  current depth, indoors or outdoors; picking it up restores the pose next update.
  The Wash ability still requires an owned indoor Home cell.
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
  Building footprints and walls are background. House foundations draw a shaded
  base below the top surface with a thin rim. Temples use retained foundation
  faces below the rune floor and low, capped stone perimeter walls above it;
  `TempleArt.geometry` owns their dimensions. The prisms retain concave
  footprints and screen-up height through compass turns, without moving runes.
  House sidewalls stay close to
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
  overlap uses cached trimmed `ART_BOUNDS`, or a `RENDER_SPEC` row's
  `artBounds` for procedural art that declares one (the street lamp's
  ironwork, `RoadOverlay.LAMP_BODY_FRAC`), else the frame bounds, and updates even on reused sprite slots. Moving clear restores the
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
- Ordinary props resolve taps by data cell (`sameAbsCell`). Buildings additionally
  accept their visible roof and wall extent through `Render.buildingHit`: retained
  visible triangles for low-poly meshes and wall prisms, trimmed art bounds for
  legacy sprites. Hit tests use the same heading projection and pan offsets as
  drawing; pointer input has already undone camera zoom and heading. Overlapping
  buildings select the frontmost drawn owner, with no hits in empty corners of
  pitched roofs. The owner routes through the ordinary interaction registry and
  existing reach/visibility gates; ground-footprint taps remain supported.
  Seat cell-bound
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
- Underground rock walls use full-cell 32×32 prisms, 19px high, through the
  retained `WallPerspective` renderer in both north-up and compass views.
  `FloorWallMaterials` supplies the approved per-level caps, native 16px face
  textures and 3px exposed lips; runtime and floor viewer share its atlas.
  The compact source strip and provenance live in `assets/Objects/Cave/`.
  Atlases are baked once at startup. Live neighbour masks rebuild geometry after
  mining or tile arrival; compass and fractional camera movement reuse it.
  Internal faces are omitted, and individual blocks share the actor depth sort.
  L1 recesses the upright face 5px, with the crown pulled back to meet it and five
  quarter-circle strips returning to the floor boundary. The entire profile
  stays inside its cell; the crown follows the recessed face without an overhang. Exposed outer corners
  use inward miters; closed diagonals pin inside-corner endpoints, tapering the
  recess over 5px so L/T junctions close without holes. Straight cell seams
  retain identical profiles. Continuous UVs span the subdivisions; camera-facing
  selection uses the existing retained renderer, including compass rotation.
  Depth-specific parts hide on floor changes. L6 keeps near-black caps and a
  stable one-in-four cracked-wall variant keyed by absolute cell. Floor profiles
  own wall placement: the material renderer never creates walls on open L5 or
  raises L6 lava pits into rock masses.
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
  being squashed tilts the ellipse, so a turning ground mark is a strip, and
  the compass turn is a strip frame too (`Render.groundMarkFrame`).
- Flat ground marks share one table, `GROUND_MARK` (render.js): the bake size,
  the on-screen width at which the baked strokes land at their designed
  weight, the tilt that lays a top-down bake flat for the south camera, the
  strip step, and the stroke passes (dark under-stroke, soft halo, line) in a
  mark's ink.
  `bakeGroundMark` (scene_create.js) is the one bake; the elite's rune bands
  and the player's GPS ring (`gps_ring`, baked in gold) are its rows. The GPS
  ring's `GPS_RING` row carries its own on-screen width and tilt (at the
  shared tilt it read squashed) and the facing caret's paint instead of the
  halo: a gold line on a dark outline over a drop shadow down the screen
  (`GPS_RING.passes`). The caret is pushed off the ring as well as the body. The GPS ring (`gpsGhost`) is always drawn while there is a fix:
  around the feet while the body stands on it, left on the ground once the
  stick walks the body off, and, once its centre is off the visible map, its
  bearing is a micro gold rim dot (`_drawGpsRimDot`, drawn with the MARKERS
  on the rim layer). The walk-home lead stops on the ring's ellipse.
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
- `RoadSafety` paints visible cells selected by `WorldGen.nightZoneBits` with its
  muted red ground wash after dark; lot-only, walking-path and roadside-path exemptions stay
  clear. The wash sits above road surfaces and below
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
  Regular rocks and boulders both use native 16px frames at 80.96% of scale 1.6 (`ROCK_WORLD_SCALE`; placed
  stones 1.408, the produce icon); their height
  difference is authored into the DG-style atlas (8 columns, 9 rows).
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
  The same 16px
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
- Lantern (`evertorch`) uses the shared player-light collector and torch radius with a blue
  `Lighting.KINDS` row. It takes visual precedence while both lights burn;
  neither expands interaction reach. Its stock carryable-lantern icon comes from
  Medieval Furniture and uses the shared inventory/offer/toast renderer.

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
  walking; the player circle follows movement inside a cell without cell-change
  fades, keyed and drawn on the whole pixel the body sprite lands on (a sub-pixel
  easing step repaints nothing).
  Reach and street restoration follow movement within a cell, independently of
  camera peeks. Canvas and GPU share one circular mask, rebuilt only when its screen position,
  radius or viewport changes. Stable world cookies use padded caches
  by their exact whole-pixel phase. Player-attached, breathing, flickering and
  transient lights keep the individual stamp path. The full-frame key gates
  before every canvas call. Reach lighting uses a circle centred on the player's
  whole-pixel screen point with the interaction radius. `cellInReach` accepts a cell exactly when its square overlaps the
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
  `HomeArea.HOUSE.maskColour` at `maskAlpha`, the house cut out as its exact
  roofless silhouette: the ring swept by the walls' drawn height
  (`indoorSilhouette`, filled nonzero, so an L-shaped adopted house keeps its
  notch dark; `liftPx`, so the lift is screen-up at every heading, and the
  drawn height alone, never plus the wall thickness). The cut's edge feathers
  `maskFeatherPx` into the room across the walls' outline, built on the
  mask's own layer (`indoorCuts`), so no seam of lit ground shows outside the
  walls. The frame key carries the interior and its lift, and the GPU
  compositor stands down while the mask is up. Masks compose over the lights;
  only sources add.
- Add sources through `Lighting.KINDS` / `sourceKind`; point-source collectors
  cull by viewport plus light radius, not sprite bounds. The POI pad and the
  `poi` light together mark a real map POI: a loose crate and a generated
  barrel or pot (`o.barrel`, no `poiClass`) get neither. Use the existing
  derived luminance/contrast controls; remeasure the plateau ceiling before
  raising it.
- Furniture light is selected by its metadata `light` through `sourceKind`:
  `furniture_lamp` reaches 2 cells with steady warm light; `furniture_candle`
  reaches 1.5 cells with slight warm flicker. Only saved-depth objects inside
  the active Home's owned cells (`PlacedFloor.furnitureIndoors`) emit; outside
  pieces still render. Both sprite and pre-cull scans offer furniture, so
  off-screen fixtures can light the room edge. The metadata `lightFrameY`
  emitter is seated with the frame's trimmed bounds and furniture scale,
  then follows the existing `dyPx` / `liftPx` mechanism at every map heading.
  Pickup removes the normal object and its light on the next object draw.
- Waystones draw their own 16px standing-stone sheet (`waystone`) at the
  shared small-rock scale: frame 0 dormant, frame 1 with the carved spiral
  glowing. The per-draw material hook selects the frame from
  `Waystones.isLit`, so activation reads in daylight in Canvas and WebGL;
  cached geometry remains valid. `Waystones.isLit` also gates the steady ivory `Lighting.KINDS.waystone` source, including permanent
  completed sets. Unlit stones emit no light and no daily-availability pulse.
  The same inset contact shadow as mineral rocks grounds the stone's footing.
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

## Reviewed building exteriors

`AuthoredBuildings` maps saved gameplay roles to reviewed closed meshes. Regular
residences use yellow roofs; shop themes use signature roof colors on market or
city storefront models, and forts use the copper-roof city gearhouse inside the
existing palisade. Home, shop inventory, ownership, tiers and wizard story gates
continue using their existing saved identities. The full mapping is maintained
in [low-poly building styles](../art/lowpoly-building-styles.md).

Source images load through `ASSETS`. `AuthoredBuildings.prepare` bakes shared
materials and roof palettes at scene startup; cell rebuilds clone cached faces
and fit a closed shell uniformly inside the footprint. Home's front-gabled
cabin first lengthens away from its door by whole native roof courses
(`AuthoredBuildings.rowsFor`) until it is as deep as its lot, so the house fills
the footprint instead of leaving bare floor beside a shrunken cabin. No pixel
reads or canvas texture creation occur during placement or compass updates. Home switches to
its existing interior walls and floor while occupied. Castle/turret/wreck models
and the Canvas fallback remain available through their existing render paths.

## Footprint building styles

The default house and fort architecture comes from `building_styles.js`, using
source building polygons rather than a freestanding sprite. `Render` owns the
role and shop-line style tables: plaster terraces for residences, brick for the
blacksmith, Japanese roofs for traders and book/pet shops, stepped pyramid roofs
for the wizard and potion/relic shops, and low broken walls for wrecks.
Forts take no footprint style: see the fort paragraph under World layers.
Restoring a building changes its material and geometry together. On the retained
WebGL path, the overlay passes its claim result into `BuildingLowPoly.recipeFor`.
`RESTORED_ROLES` holds every restored design; `LOOK.restoredRoles` lists the live
ones, currently only the relic shop. It uses straight Pixel Plains walls, door
and windows (`LOOK.facadeVariant='A'`) under a red roof, and its chimney samples
the ground-wall texture. The shared cel atlas is built once per material recipe
with no pixel readback. See the [low-poly styles](../art/lowpoly-building-styles.md)
for cell and cache rules.

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

`SELECTED_CONTAINER_FRAMES` in `loot.js` lists the active atlas frames shared
by map and popup art. Barrels use only the cylindrical frame 3; the square
variants are excluded. Crates and intact pots retain their stable ID-selected
variants. `POT_SMASHED_FRAMES` pairs terracotta pots with shard frame 0 and
cream pots with frame 3; zone, street and biome cannot change the broken pot's
colour. Selection does not change rewards, material identity, saved IDs or
restocking behavior.

## Building sprite artwork

Restoration choices, Home's icon and map sprite fallbacks use the original
role textures through `Render.houseTextureKey` and `Render.houseTextureFrame`.
Plain houses use the `house` front frame; shops and other roles use their
original `house_<role>` images. Wizard towers and turrets retain their shrine
and tower frames. Turrets always use the intact bastion tower, with matching
castle ramparts following their building footprint; this visual treatment does
not change their house ownership or gameplay tier. Unclaimed forts use their
baked weathered artwork. Blacksmiths use grey stone block walls and charcoal
slate roofs, distinct from the standard house’s warm plaster and clay tiles.

Procedural buildings remain the default on the map. `?buildingArt=legacy`
selects the original sprites instead. Both modes use the original artwork
for dialog icons and sprite fallbacks.

The selected native 16px cylindrical barrel scales to `1.1 × 1.1`.
Long grass uses `1.16 × 0.9`; trunk chests use
`1.6 × 0.8`, and supply crates use `0.8 × 1.1`. Chests have trimmed bounds for every tier to keep their art centered.
