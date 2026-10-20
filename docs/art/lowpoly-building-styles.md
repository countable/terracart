# Shared low-poly building styles

Integrated from `art/house-symmetry` (084c5226) and the retained low-poly prototype.
The style branch supplies role/shop palettes, concave inset validation, optional
parapets and roof lofts, synthesized footprints, real model heights for signs,
and a reversible rounded-sprite fallback. The default WebGL path uses shared
textured triangles, not geometry for mortar, windows or roof courses.

The cottage finish follows the supplied `/tmp/bldg.png` reference: warm walls,
dark timber framing and braces, clay/slate/thatch roof treatments, recessed
joinery and broad eave shading. These details live in shared material sheets;
story count and footprint do not create a new texture. Material palettes stay
role-driven. Reference pixels are not embedded in the generated textures.
Ordinary delivery houses have one storey; specialised buildings retain their
role-specific heights. The Canvas fallback reads the same storey count.

`scene.buildingRoofVariant` selects ridge, inset, shallow or flat. Leaving it
unset selects a low-poly roof appropriate to the role; `styles` explicitly
selects the imported silhouette generator. Pyramid/Japanese lofts use only
silhouette bands, with a simple clipped roof fallback if tiny outline details
prevent a safe inset. The original flush ridge fixtures remain at 26–68 roof triangles
each. Cottage roofs use a validated 3.5-unit outward offset (reduced for unsafe
notches), totaling 300 roof triangles across six complex fixtures versus 276
flush; wall counts are unchanged. Facade UVs fit whole bays, reserve one clear
entrance on the longest facade, and leave tiny returns free of squeezed openings.
A lantern and planter occupy sparse positions in the shared atlas. Larger roof
courses and stronger slope lighting add no geometry. The imported style fixtures top out at 208–354 total triangles, including
walls and silhouette trim. Neither path rebuilds meshes or uploads textures
when only compass heading changes.

`?buildingArt=legacy` selects the original sprites for comparison.

`BuildingLowPoly.LOOK.facade` picks the shared facade sheet: `cel` (ships)
draws a minimal cel-shaded pixel sheet from scratch with the supply crate's
restraint in the approved house sprites' colours (plum-brown ink and shade,
red-brown frame wood, cream highlights, teal glass; three-tone ramps round the
role colour, a single highlight pixel per feature) with openings at the tileset's scale and bay
placement and only a lintel, sill, step and lantern as decoration; `tileset`
cuts bays from the approved materials sheet instead. Height ships at 1.0. `tools/building-billboard-preview.html` has a
Facade select and a "Show sheet" toggle to compare the two.
The cel facade paints thick beams over the wall planks at the existing storey,
post and diagonal-brace positions. Each has a broad wood face in the wall's
palette, a one-texel upper/left highlight and a lower/right shadow. Posts and
bands are five texels wide; diagonal braces span each full panel and match their apparent thickness. Casements keep their upper edge and raise their sill by three texels. `ROLES.window` follows the approved pixel-art sprites: four-pane house windows, wood-shuttered smithy windows, twin-pane trader windows with slate shutters, and wider four-pane market windows for every shop specialty. Wizard windows retain an arched frame. All keep the raised sill; shops gain width. The cached sheet includes this style in its key.
The Canvas fallback retains the imported style renderer. Existing castle
perimeters, signs, interaction objects and fort/castle ownership remain intact.

Validation:
- `node test/building-lowpoly.cjs`: original plane roofs plus eight style families
  on six detailed footprints, finite vertices, mesh budgets and cache reuse.
- `node test/building-roofs.cjs`: the cached Canvas fallback generator.
- `node test/building-lowpoly-browser.cjs`: shared textures across story counts,
  compass sweep, retained buffers and real-game footprint injection. Serve the
  repository on port 7731 first; Chromium requires software WebGL in headless CI.
- `node test/node/run.js`: full game regression suite.

Interactive review: `tools/building-lowpoly-preview.html`. The review deliberately
includes deep notches and narrow annexes, beyond the compact cottage reference.

The pixel-art pass uses 15.6-unit floors at 0.65 world units per facade texel
(`FLOOR_HEIGHT`/`DETAIL_SCALE` stays 24 texels a storey; both halved together
when buildings read twice too tall, so doors and windows halved with them), a
twelve-color generated palette, nearest-neighbor sampling and a one-pixel ink
outline. Chimneys, eave bands, wizard shells and wrecks halved with the
storeys (wrecks later regrew their crumbling sections, below). Flat
three-step face lighting replaces interpolated wall gradients. The shared sheet
is now 512x512, with a 384-pixel-high roof region: the compact cross footprint
previously clamped against the smaller region and smeared the texture along its
arms. The browser regression checks unclamped cross-roof UVs, palette size and
all three story heights. The six compact roofs total 110 triangles (previously
106); the six complex roofs still total 300. No per-building sheets are created.

The alignment/eaves pass replaces whole-bay fitting with fixed wall texel density
and projects imported loft textures onto their actual slope. Default cottage
roofs now extend 5 units, falling back to 2.5 around unsafe narrow returns, with
a 2.8-unit dark fascia. Roofs and fascia draw above the wall shell. Stepped wall
shadow bands use the existing palette. Whole-wall triangulation removes inactive
roof-plane cuts and avoids splitting each gable into quads; a stored facade
direction keeps lighting identical across all its triangles.
Current counts (including walls and fascia): compact cottages 334 triangles for
six buildings; complex fixtures 880, comprising 296 roof, 272 wall and 312 fascia
triangles. The previous complex set was 652 without fascia (300 roof / 352 wall).
Texture detail remains shared and adds no triangles. Compass-only movement still
allocates no new meshes or material sheets. The reference still has more curated
gables and intersecting roof directions than this generator.

Role rollout: `BuildingLowPoly.recipeFor` supplies cottage framing for plain
houses, timber siding for trailers/supply/pet shops, stone for smiths, brick for bookshops,
plaster for traders/seed/potion shops, and masonry for relic shops. Production
palettes still come from `Render.buildingProfileFor`; existing signs are retained.
Wall colors are darkened and compressed toward the base pigment, with additional
height-based eave shading. Roof marks are sparse, larger tile highlight clusters.
Forts take no recipe: the overlay draws their palisade rim and keeps the
gambling-hall sprite ([rendering](../design/rendering.md)); castle geometry is
unchanged.

Wizard towers ignore footprint shape and size: an eight-sided stone shaft with
one overhanging conical roof uses 24 triangles. Turrets are fixed-size miniature
crenellated castle towers (90 triangles). Both are centered on the source bounds.
Wrecks use the cottage shell, charred materials, a clipped surviving half-roof
with a two-sided broken eave, bare rafters over the lost half, soot-dark textured
interior walls and a floor of darkened roof tiles (`debris` faces). Wrecks carry
no ridge beams or chimney. Special silhouettes share the same material system, and their
actual heights are returned to the existing sign/flag placement path.

Review all thirteen roles in `tools/building-role-preview.html`; the compact role
fixtures and complete heading sweep are validated without material regeneration.

GIF reference pass: active materials now use the imagegen-generated shared atlas
`assets/Objects/BuildingMaterials/reference-materials-v2.png`, based on the user's
`/tmp/bldg2.gif`. The atlas contains clay/slate/thatch and plaster/timber/masonry.
Nearest-neighbor sampling, per-role recoloring and separate wall/roof palette
reduction happen once while constructing the shared material, not during heading
updates. Generated plaster stays quiet and diagonal cottage braces are omitted.
The full generation prompt/provenance lives beside the PNG in README.md.

The requested legacy rollback supersedes the role rollout above: wizard uses the
original shrine frame 3; turret uses the intact bastion tower texture inside
matching castle ramparts around its footprint. Both bypass generated footprint
shells. Existing castle geometry is unchanged.
The special low-poly tower builders remain available for prototype comparisons
but are not used by the normal game path. Browser checks verify the legacy keys,
absence of tower meshes, generated atlas availability and retained heading buffers.

Roof scale refinement: generated roof cells now repeat every 72 atlas pixels
instead of 96 (25% smaller tiles); wall scale is unchanged. Ridge/shallow UVs
use continuous surface distance through the flat ridge cap, eliminating per-plane
texture jumps. The geometry test checks shared roof vertices for identical UVs.
The role review again shows all thirteen types, including shrine frame 3 and the
actual `makeTowerTexture`/CastleStyles turret generator. No polygon counts changed.

Further roof scale adjustment: repeat cells are now 36 atlas pixels, half the
previous 72-pixel size in both directions. Wall scale and geometry are unchanged.

Damage/flat-roof pass: wrecks retain the half-roof but now subtract two bounded
openings from its triangles, interpolate UVs along cuts, and add dark inward
wall faces and an exposed floor. The wreck-only shared material adds boarded
windows/door, damp streaks, moss at the base, and missing-tile patches. Damage
meshes are cached by footprint. Market/trader (and generic shop) uses the
multistorey silhouette with a 24-unit setback, reduced where a narrow footprint
requires it, and flat plaster roof material. Supply also has a flat roof.
Concave caps use ear-clipping instead of a triangle fan. The role-sheet examples
use 64 triangles for market, 16 for supply and 79 for wreck (two true holes).

Atlas overflow fix: projection no longer clamps texture coordinates to the sheet
edge. At mesh assembly, faces extending beyond the material region are clipped
at repeat boundaries with interpolated positions/UVs. Roofs repeat complete
36-pixel material cells; walls repeat complete facade bays. Ordinary 150px square
fixtures stay at 38 triangles; 800px and 1400px fixtures use 92 and 170 respectively.
Unit tests verify exact surface-area preservation, in-bounds coordinates and
constant texel density on every edge. Rotation only projects retained UVs; no
extra textures, per-frame subdivision or uploads are introduced.

Market draw-order fix: upper walls previously shared the supporting roof cap's
painter layer, allowing large deck triangles to cover the facade diagonally.
Style walls now sort immediately after their supporting deck, independent of
triangle depth. Duplicate coplanar cap triangles are removed. The review market
is 60 triangles instead of 64. Regression tests cover both cap uniqueness and
wall/deck ordering at the exact shared height.

Cottage reference pass (`/tmp/houseref.webp`, `/tmp/more-houses.webp`): every
line where two roof planes meet (ridge, hip, valley) gets a two-sided timber beam
(`beam` faces, 1 unit proud of the ridge). Plaster and timber walls gain a
knee-high rubble plinth. A terraced market halves its upper-storey setback
until no wing collapses below half its edge, and terrace caps sort below walls
rising from the same height. The geometry test bounds beam and chimney
triangles separately from fascia.

## Billboard look

The low-poly path is drawn to match the game's 2D billboard sprites
(`house.png`, `home_wagon.png`, the reference houses at `/tmp/houses3.webp`).
`BuildingLowPoly.LOOK` owns every number below; `tools/building-billboard-preview.html`
edits that table live beside the sprites, and a phone-viewable copy of the same
review is published as a Claude artifact.

- Height: `update()` projects z through `LOOK.heightScale` (1.0, full model
  height); the review page's slider foreshortens it for comparison. Sign and flag placement still reads
  the model height; the browser regression checks drift against the scaled z.
- Ink outline: `renderWebGL` re-emits each ink group's visible triangles in the
  solid trim texel, tinted `LOOK.ink`, at eight screen offsets of
  `LOOK.inkPx` (2) art pixels (× camera zoom), then draws the group. A building is
  one contiguous sorted run; faded buildings omit these repeated filled ink passes
  so they remain see-through. Its ink groups (body, flat deck, chimney) draw in
  layer order so each gets a line where it meets the surface below it. Same
  retained vertices; nothing allocates on a heading change.
- Flat roofs: no parapet lip. The deck is one colour (`solid` faces draw the
  recipe roof colour from the solid texel) with a lighter 3.5-unit rim and a
  darker 9-unit band inside it (`flatBands`, flags `rim`/`rimShade`, coloured
  in `add()`); terraced decks get the same from their prism rings.
- Eave shadow: `eaveSplit` (run by `atlasFaces`) splits every wall triangle
  whose top meets a roof level 9 units below it; the strip above draws at half
  shade. Walls rising above a terrace deck get it too.
- Bays: the facade sheet is 39-texel bays, windows in the even bays, the door
  in bay 6. `wallStart` centres an entrance wall on its door and every other
  wall on a plain bay; `cornerBays` (in `atlasFaces`, from each wall's
  `wallSpan`) then swaps any window bay a corner would cut for its plain
  neighbour, so an opening is shown whole or not at all and never hugs a
  corner. This adds up to two cuts per wall triangle (a 150px square maps to
  about 180 triangles).
- Beams: in the cel sheet the floor bands, posts and braces are the wall's own
  wood a shade darker, lit along the top/left and shadowed below/right, so they
  read as raised timber rather than ink lines.
- Chimneys: a cobbled stack (sides are `wall` faces with `rawUV` into the
  sheet's stone plinth rows), a wider cap and a dark mouth, as ink group 2.
  `ROLES[role].chimneys`/`chimneyScale` would place a pair at 26%/74% of the
  ridge; every role, the smithy included, takes the default one at 28%. The smithy shaft widens slightly toward the roof (`chimneyFlare`), meeting its cap without an overhanging lip. A role
  with `smoke` puffs from its mouths (`smokeMouths`, projected like the faces)
  in render.js's firepit smoke pass, sharing `HomeArea.FIREPIT_SMOKE`.
- Wreck: thick broken walls follow the inset footprint at roughly 16-unit
  intervals, with smaller sub-section steps confined to two exposed stretches. Every height step has an outward-facing end cap, including small chips.
  One roof slope is missing entirely; a short cap joins the longer
  opposite slope on the original roof planes. Steel rafters follow the underside,
  with supporting wall remnants beneath the extended side. Their atlas strip
  provides pale flange highlights, a dark edge and small rivets.
  Both wall faces use touching staggered bricks with a flat warm-grey base,
  full light top/left edges and full dark bottom/right edges. Courses align
  across wall sections and continue across their top faces using the same UV
  course. Broad irregular stains weather wall and roof surfaces; the roof also
  has a darker tint and narrow staggered tiles matching `com_houses_03_c.png`: rusty red-orange planes, dark full outlines and bright golden edges, under irregular tarnish. Loose 3D bricks retain the same cel palette. The opaque generated `wreck-floor-cel.png` covers the floor with dense darker
  cel fragments of varied sizes, splintered planks and half-buried furniture,
  pipe and gear remnants, separated by deep shadow gaps. It is sampled at 128px
  with nearest filtering; warm light masonry tones snap to the exact 3D block
  colour (`LOOK.wreck.top`). Three-step directional lighting darkens side faces, with a broad 48%
  ground-contact shade fading toward the wall tops. Top faces remain light;
  one black outer silhouette surrounds the wreck without internal ink. Roof, wall and steel-strut silhouettes project a single cool cel shadow onto the rubble floor, clipped to the footprint; overlapping shadows do not stack. Fallen panels lean from their original inner wall bays into the rubble, with their lower edges buried. The floor is predominantly small dark irregular fragments with sparse larger pieces. Solid roof faces draw above wall crowns to prevent masonry bleeding through the tiles. Wreck
  masonry skips the generic dark eave strip on outside walls.
- Roof direction: every sloped face is tiled from its own eave, u along the
  eave and v growing downhill, so the sheet's course bottoms face the ground on
  every face at every heading; ridge and hip beams cover the seams, and a
  ridge's flat cap continues its first slope without one. Awnings (the `inset`
  variant: potion, relic) keep a solid cap in the roof's mean tone from its
  sheet (`tex.roofTone`), with rim bands and its own ink group, over four such
  skirts.
- Untextured mode: `LOOK.textured=false` draws every face in its base colour
  (`face.flat`) through the solid texel, keeping cel steps and the ink. The
  review page toggles it; castle ramparts (`WallPerspective`) share the
  height scale and ink pass and are flat-coloured either way.
- Sprite roles: the overlay skips the shell for the wizard tower and the
  turret, which keep their sprite art. Home is the `home` role — one storey of
  plaster under a clay ridge — and the one building with an `interior` recipe:
  while the player stands inside, `interiorGeometry` rebuilds it with no roof,
  every wall cut level at the eaves, the inner face of each wall wound to face
  the room, and a top band `LOOK.wallThickness` deep across the wall tops.
  The lightmap masks the street outside it (`lighting.js` paintIndoorMask).

Material sheets (`tilesetSheet`, supersedes the generated-atlas materials
below when the approved sheet is loaded): per wall/roof pair, one `LOOK.sheet`-pixel
(768) canvas in the layout `atlasFaces` expects, cut from
`assets/Objects/BuildingMaterials/approved-materials-v1.png`. That sheet is the
approved set and nothing else, packed by `tools/build_approved_materials.py`
from the unshipped sources under `BuildingMaterials/source/` (the user's pixel
tileset: plaster, timber, brick and stone walls, slate roof; the user's
painterly sheet: red tile roof) and the generated `reference-materials-v3.png`
(fish-scale clay and thatch, tinted to the role colour by luminance like the
generated sheets). Every role draws from it: walls are plaster (plain, market,
seed, potion), timber (pet, supply, relic, wreck), brick (book) and stone (blacksmith);
roofs are tinted clay (plain, potion, book), tinted thatch (seed, pet), slate
(blacksmith, wreck), red tile (relic) or a flat deck (market, supply); all
nearest-sampled.
`SHEET_SRC` holds the crop rectangles exactly as the packer prints them
(`approved_materials.test.js` keeps every rectangle inside the PNG and every
roof tile a divisor of the 360-texel period); rerun the packer and paste its
table when a crop moves. `zoom` crops the centre of a bay so brick (1.7×)
repeats larger. Windows take every other bay, so the door bay sits between
plain bays and facades keep bare wall between openings; a `blank` recipe
(ramparts) takes plain bays only. The pixel tileset leaves openings white, so
`paintOpenings` flood-fills them: the ground-floor entrance bay becomes a plank
door, the rest blue glass with a lighter pane; a wreck boards them over. Sheets
are cut once per material key and shared across story counts and footprints,
like the generated ones.

Generated-atlas materials (the fallback for headless review and
missing art): the renderer samples `reference-materials-v3.png`, twelve
seamless 96px tiles built by `tools/build_building_materials.py` and drawn
1:1, so texel density is set in the build script, not by a browser
downsample. Roof UVs wrap every 288 texels (three tiles). Each tile is
blended toward the role colour (roofs 0.7, plaster and clapboard 0.55, other
walls 0.4) by luminance ratio, keeping its own outlines and highlights; the
old narrow contrast clamp and 12-colour sheet quantisation apply only here.
Wall cells follow `ROLES[role].material` (plaster, timber boards, clapboard,
brick, otherwise rubble; the painterly dark stone and cobble fall back to
rubble); roof cells follow `roofMaterial` (clay, slate, thatch, shingle,
glazed; red tile falls back to clay; flat roofs use flagstone). The plinth is
rubble, or moss on a wreck.

Street-facing door decorations use the road overlay’s source transportation lines.
A standing low-poly house receives one framed plank door on the nearest outward-facing
wall within six cells, provided the wall has room for the door and four-pixel corner
clearance on both sides. No nearby street or no suitable wall means no decoration.
The retained door triangles rotate, sort and fade with the building; they do not
alter its footprint, movement or tap target. Home retains its authored entrance,
and wrecks and special tower silhouettes do not receive floating doors.

Ranked buildings use one storey at T1 and two storeys at T2 and above,
across smithies, traders and every shop line. T3+ may gain extra floors or
ornaments; the current baseline stays at two. Gameplay ranks come from
`Shops.shopTier`, not footprint biome tiers. Renovation invalidates cached
geometry immediately. Unranked homes, ruins and special structures retain
their own designs; `scene.buildingStoreys` remains a preview override.
## Source artwork matching workflow

These rules apply to source-matched building experiments and future implementations.
The current review is served at `http://localhost:8765/ra-village-house/`; its
30-degree calibration is a preview setting, not a change to production camera code.

### Shape and triangle budgets

Start with a closed basic building shape. Add low-poly geometry only for major
silhouette features such as a chimney, boiler, porch, dome or substantial dormer.
Keep brickwork, shingles, windows, gears that lie on a wall, and narrow trim in
textures unless their depth materially changes the rotated silhouette. Simplify
the reference where necessary to keep the outer shell closed.

Count rendered triangles, including external details: stay below **500 for basic
houses** and **1,000 for larger buildings**. Check counts after resizing or changing
footprints; long wings and many roof sections can cost more than the native model.
A frame-wide silhouette pass does not add triangles to each building mesh.

### Fast setup and calibration

- Find the exact source sheet and crop first. Existing reference catalogs often
  already record the coordinates. Inspect the whole sprite: a runtime frame may
  clip its bottom or omit a roof feature. Preserve the original crop for comparison.
- Match at **30 degrees above the ground** before tuning proportions. The preview
  converts its authored screen-space depth by `y / sin(30°)` and height by
  `z / cos(30°)`. Apply `16 / sourceDoorHeight` once to the complete physical model
  so the source door reads as 16 pixels at 1×. If no door exists, document the
  reference dimension used instead. Never stretch the shaft to compensate for a
  camera mismatch.
- Reuse the material/mesh interface: one spec per source, one cached
  `prepare(context, image, spec, key)` atlas, and
  `build(template, spec, key, polygonOrNull)` returning physical-coordinate
  triangles. Add the picker and reference crop once; avoid copying an entire
  renderer for each style.

### Texture and facade shortcuts

- Use original source pixels for the front facade and sample their palette for
  inferred surfaces. Prepare a complete doorless facade bay for the rear and sides;
  remove the door frame and dressing too. Preserve native window sizes and place
  corner posts only at actual building corners. Fill short remainder spans with
  matching quiet wall texture.
- Extend the nearest opaque texels into transparent sprite margins within the
  building crop. Transparency in a sprite is not a hole in a physical wall.
  Carry corner beam texture to the join instead of switching to a background color.
- Draw roof courses in roof surface coordinates. Repeating perspective-painted
  raster roof fragments preserves diagonal stair steps and produces sawtooth
  patterns in side/top views; inverse shear alone does not reliably remove them.
  Retain source colors, tile sizes and broad trim, then let geometry supply perspective.
- Keep texture density tied to physical surface length, not building width.
  Split at repeat boundaries before UVs leave their atlas region. Sample constant
  colors at texel centers (`x + 0.5`, `y + 0.5`) to avoid triangular flicker.
- Overhangs should continue the adjacent roof texture. Keep the original wall/roof
  join, then add a small closed lip with fascia and underside. Miter real corners;
  at an intermediate ridge split, offset along the edge normal so adjacent roof
  planes still meet. Remove identical hidden internal caps.

### Footprints and rotation checks

- Keep each style's wall and peak heights fixed across footprint variants. Preserve
  facade bay scale. Cover concave footprints with disjoint roof sections and close
  exposed height steps; do not overlap full roof boxes or leave a missing membrane
  to imitate a sprite cutout.
- Check face winding before repainting a seemingly blank face. A reversed gable or
  porch wall can expose the background even when its UVs and texture are correct.
  Remove duplicate coplanar faces instead of masking depth flicker with arbitrary
  offsets. A protruding feature needs finished sides, a back and a closed underside.
- Compare the source and native model at 30°, then inspect front, rear and both
  sides through a full orbit. Include L/T/U footprints, low and high elevations,
  and an underside view when closing shells. Test finite positions, atlas bounds,
  constant heights and triangle counts, but also inspect screenshots: valid numbers
  and no WebGL errors do not prove visual parity or a closed-looking shell.
- Use a screen-space silhouette mask for the overall black outline. Ink only the
  background adjacent to the visible object, excluding ground-contact pixels.
  This avoids outlining every triangle, facade seam or attached feature internally.
- For local Chromium review, use the installed browser with headless software
  WebGL (`--no-sandbox --ozone-platform=headless --use-angle=swiftshader
  --enable-unsafe-swiftshader`) and remove a stale `DISPLAY` variable. Capture
  the visible native WebGL canvas, not the hidden Phaser bookkeeping canvas.

### Roof refinement shortcuts

- Select rectangular material patches without baked perspective silhouettes. Sample
  timber separately from slate or metal so trim does not contaminate the roof tone.
- Keep skylights and other baked roof details at their native physical size when a
  footprint grows; repeat material spans instead of stretching the whole sprite.
- A closed ridge prism costs 12 triangles. Intersect it with the intact roof shell
  to add a major source-art beam without opening seams.
- On round roofs, clamp UVs inside the painted material. A sprite's black outer
  contour becomes an unwanted meridian seam when wrapped; let the silhouette pass
  supply the outer ink instead.
- Divide roof decks and coping into adjoining faces with shared edges. Nearly
  coplanar overlays can still flicker in a 16-bit depth buffer at high elevations.
