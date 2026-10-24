# Sprite art direction

The natural and unrestored world uses muted post-apocalyptic rustic colours.
Players, restored assets, and special or sacred places may deliberately introduce
cleaner, brighter or cooler colours. Colour signals care and significance; the
crisp chibi retro pixel style stays consistent in every state.

Rogue Adventure is the only map-art path. `src/rogue_objects.js` installs the
active source textures and object appearances; `src/rogue_prop_profile.js` owns
approved foliage, container and fixture replacements. `src/ground_materials.js`
and `src/terrain_transitions.js` own native terrain selection. The full runtime
contract lives in [rendering.md](../design/rendering.md), and the camera, scale
and palette direction lives in [art-direction-brief.md](art-direction-brief.md).

## Runtime art and rebuilding

Resolve art from the installed registry and the game's appearance functions.
Raw base `ASSETS` entries, old ALT approvals and source-pack thumbnails do not
establish what the game currently draws. Preserve source pixels, logical texture
keys, stable object IDs, crop growth and harvest behaviour when rebuilding art.

- `tools/build_ra_prop_profile.py` combines flora, container and fixture exports
  into the active asset, icon and seating registry.
- `tools/build_rogue_objects.py` exports Rogue landscape objects and their bounds.
- `tools/build_ra_terrain_trial.py` builds the native terrain atlas and manifest;
  its historical filename does not imply an optional renderer.
- `tools/build_ra_containers.py`, `tools/build_ra_flora.py` and the fixture
  exporters own the inputs recorded by the prop-profile builder.
- Retained selected world and item atlases use
  `tools/build_selected_world_atlas.py` and `tools/build_selected_items.py`.
  Profile-owned keys replace obsolete aliases before preload.

Use the current 16px Cyan character pack as the character style anchor. Map
art follows the Rogue overworld scale and palette rather than close-up village
scale. Copy the paintings' colour relationships, not their detail density.
A soft high-resolution sprite does not become a style match through recolouring.
The game has no seasons.

## Review and validation

The design directory at `design/index.html` links the current runtime viewers.
Regenerate the Nexus/road snapshot after art or definition changes:

```sh
python3 tools/preview_zone_variants.py
node test/variant-art-parity.cjs http://localhost:8765
node tools/asset_inventory.js --json
```

The snapshot exporter loads the active profile and runs the game's mineral and
berry callbacks in Chromium. The pixel comparison boots an isolated sandbox and
checks the resulting textures, including terrain, foliage, fixtures and generated
art. A successful image request alone does not prove that the chosen pixels
match the game. See [ASSET_INVENTORY.md](ASSET_INVENTORY.md) for reference scanning
and archive rules. `docs/process/QC_RULES.md` owns the general asset checklist.

Pirate Cove retains its approved 192 × 128 shipwreck shrine and reserved 3 × 3
cells through `SpriteLayout.SHIPWRECK_SHRINE_ART`. It remains one daily shrine;
art replacement does not add rewards. Compatible third-party art retains its
licence and source provenance even when its former profile is archived.

## Retired experiments

Earlier palette treatments, tree/water trials, Dreamland rendering and their
review commands are historical material under `extra_assets/inactive/`.
`extra_assets/inactive/docs/art/legacy-map-art-profiles.md` preserves the former
map-art guide and runtime notes. These files are reference and rebuild history,
not alternate game settings. Historical dashboards remain in `design/archive.html`.

## Castle families

`src/castle_styles.js` owns four stable material families: Citadel (cool pale
stone), Weathered Ruin (sage limestone and surviving broken battlements),
Intact Bastion (warm sandstone, no guards), and Old Archive Court (warm stone
with timber rampart tops). There is no Mended Court family. The Citadel name
has no “dark” qualifier: darkness means an unclaimed, weathered condition in
every family, while restoration brings back clean, brighter materials.

Towers, tiled walls, polygon walls and courtyard floors resolve the same
building owner key through `CastleStyles.get(key, claimed)`. Its numeric
palettes already include the condition treatment; never apply the general
unclaimed building wash to them again. Castle wall sections use ordinary object
depth at their lowest masonry point. The 32×48 towers sit at the bottom of their
cell; their bottom ten pixels fade from 30% to full opacity to soften joins.
Archive ramparts keep a stone base and face beneath
their wooden crest; the Ruin's uneven crenellations echo its damaged tower.

Weathered Ruin courtyards contain a few broken fluted columns, made from the
existing pillar's lower shaft and plinth. `CastleStyles.columnSites` scatters
these deterministically inside the source ring (about four in a 5×8-cell
court), away from walls and one another. Both floor modes share these sites
and the same stone palette. They are decorative, with no collision or tap
targets. Unclaimed masonry retains roughly 80% of restored brightness;
courtyard floors retain roughly 89%, providing extra contrast against walls.
Each family has its own dark skull banner: black for Citadel and
Ruin, grey with a shield for Bastion, and brown with a book for Archive.

The Ruin also has sparse missing paving, fine cracks and small rubble marks,
with chips and missing sections along its battlements. Damage is seeded and
cached in the existing floor and wall artwork; it creates no world objects,
collision changes or animated effects. Restoration changes its palette while
preserving the damage, and the other castle families keep their intact surfaces.
Floor damage uses at most eight 96×96 textures (four patterns in two condition
palettes), lazily baked and shared by all ruins. Tiled floors reuse their
existing texture pool; polygon floors and wall chips use their existing caches.


## Procedural polygon buildings

`src/building_overlay.js` owns the small-building generator. `WALL_RECIPES`
curates shop palettes, five materials (plaster, brick, timber, sandstone and
cut stone), and default floor counts. Stable seeded texture phases provide
variation; floor bands, recessed windows, timber lintels, eave shadows and
plinths retain a consistent rhythm. Specialty identity comes from the existing
house/shop ledgers and signs. The generator adds no roof badges.

The CraftPix desert settlement reference informed the broad light/shadow areas,
sparse masonry marks and framing; our dungeon reference and art brief govern
pixel scale and restrained surface detail. No reference pixels are imported.

The clean roof keeps the exact source eave while simplifying its interior
control ring within four pixels and a 3.5% area budget. Coarser, planar cells
reduce mesh size; native-pixel height-field shading avoids exposing triangle
edges at the ridges. The former dense roof remains available for comparison.
Generated roof bitmaps and wall material swatches are cached and bounded.

Open `tools/building-poly-preview.html` to compare clean/dense roofs, roof
variants and one to three storeys on the detailed footprint fixtures. Run
`npm run test:roofs` for topology, cache, simplification-budget and wall-recipe
checks; `node test/building-generator.cjs` checks the browser renderer against
a local server on port 7731.

### Retained low-poly footprint buildings

`src/building_lowpoly.js` is the WebGL path for small polygon buildings with
compass mode installed. `building_overlay.js` still owns footprint selection,
claim colors and shop recipes; the old Canvas treatment remains the fallback.
Existing house sprites are hidden only when their ID has a rendered polygon;
shop signs and interaction objects remain in the ordinary object pass.

The roof is an exact footprint triangulation clipped against a few planar
slopes. The longest facade chooses its axis, independently of compass heading.
`ridge` gives straight gables, `inset` caps four bounding slopes at 8px,
`shallow` caps a gentle gable at 5px, and `flat` has no slope. Concave returns
can meet raised roof planes: their walls extend upward to close the gable.
This deliberately differs from a hip roof meeting every eave at one height.
Small notches stay in the perimeter; there is no sampled ridge network.

The six irregular fixtures use 26–68 roof triangles (276 total, versus 6,322
in the previous clean sampled mesh), plus 48–68 wall triangles each. These
are fixture measurements, not a universal limit: polygon complexity controls
cost. Footprints are simple rings, as in the existing overlay; separate holes
are not introduced by this change.

Generated 512×256 material sheets share by material and palette (about 0.5 MiB RGBA each), across all three story counts. Facade UVs select the height from one three-story sheet.
Plaster chips, masonry joints, windows, doors, floor bands and subtle roof pigment
are texture pixels. Roof stripes are omitted to reduce visual noise and shimmer;
soft mortar, sparse substrate chips, recessed joinery and thin cornices follow
the reference detail scale. Vertex lighting darkens the wall tops beneath the
eaves without adding faces or unique textures. The adobe, whitewash/blue-joinery and brick examples in
`footprint-house-styles/concepts.png` guide the review palette and detail
scale; the reference bitmap itself is not embedded in the game.
Geometry and textures are retained while turning. A heading change updates
projected vertices and painter order; WebGL submits the textured triangles.
Texture sheets are released at scene shutdown. Ground-overlay rebuilds can
regenerate geometry, but heading alone never invalidates that overlay.

Review: `tools/building-lowpoly-preview.html` (real Phaser/WebGL, not the
Canvas shim). Checks: `npm run test:lowpoly`, and, with the repository served
on port 7731, `node test/building-lowpoly-browser.cjs`. The browser check sweeps
361 headings, asserts retained faces, no texture refreshes, no new textures,
and screen-vertical height. Its software-GPU timing is diagnostic rather than
a mobile frame-rate guarantee. Architecture remains in the existing background
layer; this does not add depth-buffer occlusion against actors or other sprites.

#### Castle and fort assessment

The existing `WallPerspective` path already retains prisms and keeps their
height vertical through compass rotation. It rebuilds a Graphics command
buffer on heading changes without baking new Canvas textures. The legacy
non-perspective path uses cached atlas wall sprites.

Fort runs use roughly six square posts per 32px cell. Each post retains
20 triangles: four body faces split at the half-height colour boundary plus
four pyramidal tip faces. Sparse grain stays in the shared texture atlas.
Posts are one-sixth of a cell wide. Normal posts are 22.5 units tall with an
8.5-unit carved point; alternating posts are 10% taller (24.75 units) with the
same point length. Grain and face shades continue into the carved tip;
compass changes reuse the geometry. Both polygonal and cell walls share these
sizes and colours. Castle battlements retain their established renderer.

The central fort building is the full copper City hall, inset inside the lot
and marked by one centered dice board, with no side sheds. The palisade uses
the plank floor’s warm wood colour family. The original procedural plank floor
remains visible around it. `tools/temple-fort-study/` previews that composition
and the original pale temple floor with a low adobe-like brim.

Temples use `TempleArt`'s small 16×12 running-bond bricks and native cyan runes,
with dark stone for tar temples. Subtle light top/left and darker bottom/right
edges give the bricks depth in the cached floor paint, without extra geometry.
Brick faces meet edge to edge, with no mortar lines or gutters. A continuous three-unit-thick wall rises four units
above the rune surface; the foundation extends seven units beneath it. The brim
has no gate, battlements or corner towers. Polygon floors call the original
slab painter directly; RA paving is not baked or substituted for temples.

## Third-party building art credit

Restored low-poly facade textures include processed crops from **Pixel Plains
Interiors Pack**, by **Jose Javier (SnowHex)**:
<https://snowhex.itch.io/pp-interior-and-houses-pack>. Used and modified under
the acquired pack licence. Raw assets are not included. Exact crops, processing
and licence terms are recorded in
[BuildingMaterials/README.md](../../assets/Objects/BuildingMaterials/README.md).
