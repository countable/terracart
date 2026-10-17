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

`?buildingArt=rounded` and `?buildingArt=legacy` retain the sprite comparisons.
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

The pixel-art pass uses 31.2-unit floors (30% taller), approximately 1.3x texture
scale, a twelve-color generated palette and nearest-neighbor sampling. Flat
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
houses, timber siding for trailers/supply/pet shops, brick for smiths/bookshops,
plaster for traders/seed/potion shops, and masonry for relic shops. Production
palettes still come from `Render.buildingProfileFor`; existing signs are retained.
Wall colors are darkened and compressed toward the base pigment, with additional
height-based eave shading. Roof marks are sparse, larger tile highlight clusters.
The fort recipe retains its prior wall contrast and roof courses; castle geometry
is unchanged.

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
original shrine frame 3, turret uses the original CastleStyles tower texture, and
both bypass generated footprint shells. Existing castle geometry is unchanged.
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
(`beam` faces, 1 unit proud of the ridge); ridge and shallow roofs with a level
ridge over 24 units long add a stone chimney (`chimney` faces, 13 units above the
ridge) at 28% along it. Flat roofs sample the stone-flag atlas cell and the
`flat` variant adds a 3-unit parapet with an inset coping. Plaster and timber
walls gain a knee-high rubble plinth; windows are four-pane casements with blue
glass exempt from the muted wall wash. A terraced market halves its upper-storey
setback until no wing collapses below half its edge, and terrace caps sort below
walls rising from the same height. The geometry test bounds beam and chimney
triangles separately from fascia.

Materials (supersedes the GIF reference pass and roof-scale notes above): the
renderer samples `reference-materials-v3.png`, twelve seamless 96px tiles
built by `tools/build_building_materials.py` and drawn 1:1, so texel density is
set in the build script, not by a browser downsample. Roof UVs wrap every 288
texels (three tiles). Each tile is blended toward the role colour (roofs 0.7,
plaster and clapboard 0.55, other walls 0.4) by luminance ratio, keeping its own
outlines and highlights; the old narrow contrast clamp and 12-colour sheet
quantisation now apply only to the no-atlas fallback. Wall cells follow
`ROLES[role].material` (plaster, timber boards, clapboard, brick, otherwise
rubble); roof cells follow `roofMaterial` (clay, slate, thatch, shingle,
glazed; flat roofs use flagstone). The plinth is rubble, or moss on a wreck.
