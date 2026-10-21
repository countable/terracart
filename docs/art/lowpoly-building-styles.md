# Shared low-poly building styles

The default WebGL exteriors wear reviewed source-art skins from
`src/authored-buildings/`, selected by `AuthoredBuildings.recipeFor`. Native
textures and roof-color variants are prepared once at scene startup. Compass
rotation reuses geometry and textures. Roof recoloring preserves painted
shading; walls, chimney shafts, timber trim and dark closures keep their art.

| Gameplay role | Exterior model | Roof |
| --- | --- | --- |
| Home | Pixel Plains timber cabin (Home's alone) | Orange |
| Regular residence | com cottage, Pixel Plains brick/plaster, flat adobe/rooftop, or steam home; stable ID selection | Yellow |
| Blacksmith T1 / T2–T3 / T4–T7 | FDR ground floor only / full FDR / steam blacksmith | Slate |
| Trader | Trader | Green |
| Seed / supply shop | Market / city storefront | Lime / blue |
| Magic / relic shop | Market / city storefront | Teal / red |
| Pet / book shop | Market / city storefront | Rose / plum |
| First / second wizard tower | Purple wizard / steam wizard | Purple |
| Fort | City gearhouse inside existing palisade | Copper |

All shop models belong to the market/storefront pair; tier does not change
shop identity. Castle, turret and wreck geometry retain their existing paths.
Home retains its open-roof interior and furniture behavior. The lot outline is
the building: walls stand on every lot edge at any angle and the roof covers the
lot (`BuildingLowPoly.authoredOutline`). A model lends only its skin
(`AuthoredBuildings.skin`): complete doorless facade bays, the door once on the
entrance wall, its tiled roof in roof space, and single texels for gables,
fascia and ridge beams. Doors stand 13 units tall on every model. Tier-1 blacksmiths use the bottom
36 facade texels for a single storey, keeping the source door scale; higher tiers
retain their full facades. Model-only
features (porches, painted chimneys, dormers) do not appear on lot-outline
buildings. Wizard towers and the fort hall keep their whole shells, fit inside
the lot. Only models assigned to existing game roles ship.
Market and trader source pixels share the canonical images under
`assets/Objects/Approved/` with their sprite fallbacks.

The com cottage, wizard, steam home/wizard and City storefront/gearhouse use
registered Pixel Plains-style textures from `assets/Objects/PPBuildings/`.
`tools/build_pp_building_textures.cjs` exports the reviewed reference artwork
at the original texture dimensions, aligns structural bands, and retains the
original alpha mask. The manifest records registration knots and source hashes.
Dreamland, both blacksmiths, adobe/rooftop, market/trader and the three original
Pixel Plains houses keep their original source textures.

Six `pp_flat_*` review choices use native Pixel Plains flat-shop art, with a
tiled horizontal deck and colored fascia. `tools/extract_pp_flat_buildings.py`
extracts the six source colorways and assembles their native glass doorway;
`pp-flat-provenance.json` records exact crops. They are prepared with the native
palette and do not change existing residential assignments. The shared flat
roof builder also supports their L, T and courtyard footprints. Run
`node tools/sync_building_texture_viewer.cjs` to refresh the local
`http://localhost:8765/ra-village-house/` viewer; it also retains three
experimental City designs. `node test/pp-building-viewer.cjs` checks every
viewer choice through five rotations and the new flat roofs on concave plots.

## Generated interiors and fallback geometry

`src/building_lowpoly.js` retains the generated geometry and material system for
Home interiors, wrecks, turrets, and fallback rendering. The Canvas path uses
`BuildingStyles` and the roof adapter in `BuildingOverlay`. These paths remain
independent of the reviewed exterior meshes. Castle perimeters, signs,
interaction objects and fort/castle ownership retain their existing behavior.

`scene.buildingRoofVariant` selects ridge, inset, shallow or flat for generated
geometry; `styles` selects the footprint silhouette generator. Pyramid and
Japanese lofts use silhouette bands, with a clipped roof fallback when an inset
would collapse a narrow outline. Concave caps use ear clipping. Roofs use a
validated outward offset, reduced around unsafe notches, with closed fascia.
Upper walls sort above their supporting terrace deck. Compass updates project
retained vertices and UVs without rebuilding meshes or uploading textures.

Generated floors are 15.6 world units high at 0.65 units per facade texel:
`FLOOR_HEIGHT / DETAIL_SCALE` stays 24 texels per storey. Facade bays are 39
texels wide, with windows in alternating bays and a dedicated door bay.
`wallStart` centers the entrance wall on its door; `cornerBays` replaces partial
window bays at corners with plain wall. Roof UVs repeat in surface space.
`atlasFaces` clips triangles at texture repeat boundaries so large footprints
retain texel density without clamping or stretching the sheet.

`BuildingLowPoly.LOOK` owns generated material, projection and dressing settings:

- `heightScale` projects model height and keeps signs and flags aligned.
- `inkPx` adds an upward-only silhouette, without a bottom border or internal
  outlines. Faded buildings omit this pass.
- `eaveSplit` shades walls meeting roof levels; wreck masonry skips this strip.
- `wallThickness` controls the closed wall tops in Home's open-roof interior.
- `textured=false` uses each face's base color with the same lighting and ink.

`recipeFor` supplies generated role materials and storeys. The authored exterior
selection takes precedence over these recipes. While the player is inside Home,
`interiorGeometry` removes the roof, cuts walls level at the eaves, adds inward
wall faces and closes their tops. The lightmap masks the street outside the room.
Generated fallback storeys come from `Shops.shopTier`, with one at T1 and two at
T2 and above for ranked buildings; `scene.buildingStoreys` is a preview override.
These settings do not stretch or add floors to the reviewed exterior models.

## Wrecks

Wrecks retain broken wall sections around the footprint, an opaque rubble floor,
a surviving roof slope, exposed steel rafters and inward wall faces. Every wall
height step has an outward-facing end cap. Fallen panels lean into the rubble,
with their lower edges buried. Wrecks have no ridge beams or chimney.

The generated cel material uses touching staggered brick courses, weathered
rusty roof tiles and pale steel highlights. `wreck-floor-cel.png` supplies dense
dark fragments with sparse larger pieces. Warm floor masonry colors match
`LOOK.wreck.top`. Roof, wall and strut silhouettes cast one clipped shadow onto
the rubble floor; overlapping shadows do not accumulate. Solid roof faces sort
above wall crowns to prevent masonry bleeding through the tiles.

## Generated material sheets

`BuildingLowPoly.LOOK.facade` defaults to `cel`: a cached pixel sheet with
three-tone material ramps, timber beams, openings and sparse decorations.
Posts and bands use a broad face with a one-texel highlight and shadow. The
`tileset` option cuts facade bays from the approved material sheet instead.
Both are generated fallback choices, not the source of authored exterior art.

`assets/Objects/BuildingMaterials/approved-materials-v1.png` is packed by
`tools/build_approved_materials.py` from sources under `BuildingMaterials/source/`
and `reference-materials-v3.png`. `SHEET_SRC` owns the crop rectangles;
`approved_materials.test.js` verifies their bounds and roof repeat periods.
`paintOpenings` fills the source's white openings with glass, a plank door, or
boards for wrecks. Sheets are prepared once per material key and shared across
storey counts and footprints. Keep the source images needed by the packers.

When the approved sheet is unavailable, the generated-atlas path samples
`reference-materials-v3.png`: twelve seamless 96px tiles built by
`tools/build_building_materials.py`. Roof UVs repeat every 288 texels. The
renderer blends material luminance toward the recipe color and samples with
nearest filtering. Wall cells follow `ROLES[role].material`; roof cells follow
`roofMaterial`. The plinth uses rubble, or moss for a wreck.

Street-facing decorations use the road overlay's source transportation lines.
A generated house receives one framed door on a suitable outward-facing wall
within six cells. No suitable wall or nearby street means no decoration. Door
triangles rotate, sort and fade with the shell without changing movement or tap
targets. Home keeps its authored entrance; wrecks and special towers receive no
floating doors.

## Validation

- `node test/authored-buildings.cjs`: reviewed exterior geometry and palettes.
- `node test/building-lowpoly.cjs`: generated roofs and style families on complex
  footprints, including finite vertices, mesh budgets and cache reuse.
- `node test/building-roofs.cjs`: cached Canvas fallback geometry.
- `node test/building-lowpoly-browser.cjs`: shared textures, heading changes,
  retained buffers and real-game footprint injection. Serve the repository on
  port 7731 first; headless Chromium requires software WebGL.
- `node test/node/run.js`: full game regression suite.

`tools/building-lowpoly-preview.html` reviews generated geometry with deep
notches and narrow annexes. `tools/building-poly-preview.html` exercises the
Canvas adapter. These are fallback diagnostics, not the current exterior roster.
