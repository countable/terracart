# Shared low-poly building styles

The default WebGL exteriors wear reviewed source-art skins from
`src/authored-buildings/`, selected by `AuthoredBuildings.recipeFor`. Native
textures and roof-color variants are prepared once at scene startup. Compass
rotation reuses geometry and textures. Roof recoloring preserves painted
shading; walls, chimney shafts, timber trim and dark closures keep their art.

| Gameplay role | Exterior model | Roof |
| --- | --- | --- |
| Home | Pixel Plains timber cabin | Orange |
| Regular residence | Pixel Plains stucco/plaster cottage or log cabin; stable ID selection, pitched roofs | Yellow |
| Blacksmith T1–T3 / T4–T7 | Full FDR smithy / steam blacksmith, with a broad stone chimney | Slate |
| Trader T1 / T2+ | White plaster cottage / trader | Green |
| Seed / supply shop | T1: white plaster cottage; T2+: market / city storefront | Lime / blue |
| Magic / relic shop | T1: white plaster cottage; T2+: market / city storefront | Teal / red |
| Pet / book shop | T1: white plaster cottage; T2+: market / city storefront | Rose / plum |
| First / second wizard tower | Purple wizard / steam wizard | Purple |
| Fort | City copper hall inside pointed square timber palisade | Copper |

Tier-one traders and shops
use the Pixel Plains white plaster cottage (`pp_plaster`). Their existing roof
colors and role symbols distinguish the trades. Generic shops use blue. Higher
tiers retain their commercial models; upgrades preserve each trade’s roof color.
Blacksmiths use their dedicated masonry workshop at every tier and a broad,
flared stone chimney with smoke anchored at its dark mouth.
Each cottage entrance carries a small wooden sign beside its door, and its roof
carries a roof-coloured sign embossed with the same symbol. Symbols are centered
by the center of their visible ink, balancing top-heavy marks and excluding
padding in the source glyph. Both are simple
rounded rectangles with textured faces and real side walls: the front board
projects 1.2 world units from its mount, the roof plaque 1.5 along the roof
normal. The roof plate compensates for the roof slope so its visible face is
square in the default view; its side walls face outward to reveal the thickness.
The wall sign hangs six units above the door sill, beside the upper
doorway; the eaves may obscure it. Their geometry follows the doorway and roof plane, including heading,
occlusion and building fading. Shared material atlases are prepared at startup.
A mounted sign replaces its floating plate; trader deal bubbles remain.
Castle, turret and wreck geometry retain their existing paths.
Home retains its open-roof interior and furniture behavior. The lot outline is
the building: walls stand on every lot edge at any angle and the roof covers the
lot (`BuildingLowPoly.authoredOutline`). A model lends only its skin
(`AuthoredBuildings.skin`): complete doorless facade bays, the door once on the
entrance wall (0.2 units proud of it, clear of the facade's depth), its roof material in roof space, and source texels for
fascia and ridge beams. FDR gables repeat native stone and timber at facade
texel density, with a continuous native timber crossbeam tying the upper-storey
posts together below the gables; their ridge rise is capped at the native half-depth (24 texels)
instead of the generic 14 scene units. Other gables use single source texels. Pitched overhangs retain at least half the original
clearance around narrow returns, preventing almost-closed roof slits.
Decorative flat-roof rims cap corner mitres at twice the band width to avoid
inward spikes at acute corners. Doors stand 13 units tall on every model. Tier-one shops keep the full cottage
facade and door scale. Model-only
features (porches, painted chimneys, dormers) do not appear on lot-outline
buildings. Wizard towers and the fort hall keep their whole shells, fit inside
the lot with uniform scale. Their fitter tries dominant lot-edge orientations
and interior triangle centres to avoid shrinking unnecessarily on diagonal
wings; an explicit entrance direction remains fixed. Only models assigned
to existing game roles ship.

The fort uses the full `city_storefront` shell, fitted at 65% of the available
lot span, with one solid dice board centered above its entrance. It keeps the
original procedural horizontal plank floor (`biome11_0`), rather than the
interior sheet or RA paving. The shared palisade has true square posts 32/6
units wide. Short logs are 22.5 units tall, with an 8.5-unit carved point; every
second log is 10% taller (24.75 units), with the same point length. Sparse
Rogue Adventure-style vertical grain uses the original plank floor’s warm brown
colour family. A discrete step halfway up each log makes its upper half about
12% lighter. Both textured
and flat Canvas faces share that boundary. Cardinal and angled source edges
retain square posts even when the final distribution interval is shorter. Point
faces continue the same grain coordinates and face shade as the shaft, avoiding
a separate bright cap at their join.

Market and trader source pixels share the canonical images under
`assets/Objects/Approved/` with their sprite fallbacks.

The com cottage, wizard, steam home/wizard and City storefront/gearhouse use
registered Pixel Plains-style textures from `assets/Objects/PPBuildings/`.
`tools/build_pp_building_textures.cjs` exports the reviewed reference artwork
at the original texture dimensions, aligns structural bands, and retains the
original alpha mask. The manifest records registration knots and source hashes.
Dreamland, both blacksmiths, adobe/rooftop, market/trader and the three original
Pixel Plains houses keep their original source textures.

Six `pp_flat_*` review variants use native Pixel Plains flat-shop art, with a
plain source-colored horizontal deck and colored fascia. The native viewer model tucks walls
three source pixels inside the roof lip (4.8 ground units along depth). Production
lot-outline meshes keep walls on the real polygon and extend only the roof
outward with a validated polygon offset, reducing the lip around narrow returns.
A sixteen-texel fascia raises the deck; separate coping and soffit faces seal
the overhang without coplanar bands. The prepared wall atlas extends native
masonry over the source silhouette borders
so black vertical strips do not repeat at corners. Roof fascia colors also
extend through baked black perimeter pixels; geometric outlines remain. Door
overlays stand clear of the wall depth, while native adobe fronts use the
original doorway directly without an overlay. Expanded decks sit below the coping to avoid coplanar flicker. PP decks
sample a plain interior roof texel rather than repeating the source grid,
which creates an unintended checkerboard on large lots. Production PP and
adobe decks exclude the adjacent coping swatches. `tools/extract_pp_flat_buildings.py`
extracts the six source colorways and assembles their native glass doorway;
`pp-flat-provenance.json` records exact crops. They are prepared with the native
palette. They join the former-cabin replacement pool; other existing residential
assignments retain their models. The original adobe variants remain available. The shared flat
roof builder also supports their L, T and courtyard footprints. Run
`node tools/sync_building_texture_viewer.cjs` to refresh the local
`http://localhost:8765/ra-village-house/` viewer; it also retains three
experimental City designs. `node test/pp-building-viewer.cjs` checks every
viewer choice through five rotations and the new flat roofs on concave plots. Real Kelowna
outline checks use `GAME_URL=http://localhost:7735 node test/authored-kelowna-buildings.cjs`;
the fixture README documents provenance, focused reruns and coverage limits.
Inspect full-size images as well as contact sheets: subpixel roof slits can
pass sampled coverage checks while appearing as bright seams.

Roof repairs around painted protrusions preserve source texel density: translate
clean patches in roof coordinates rather than stretching a source column. The
steam home rectifies those same source tiles for expanded footprints, while the
steam wizard samples its current roof palette for inferred surfaces. Market
dormers and steam-home vents, pipes and landings are closed geometry aligned
to source-camera rays. Inferred City decks use equipment-free material patches;
doorless tower walls exclude the entire entrance frame from their sample. Expanded steam-blacksmith
barrel ends repeat timber at native scale and centre one source-width gear panel;
the emblem never stretches with the footprint. Entry and attic overlays stand
far enough off their walls to survive depth quantization at game scale.

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

Wrecks use the Broken plinth design: a sparse perimeter of 4–8-unit masonry
courses with broad breaches, chipped height steps and roughly six-unit thickness
where the footprint allows it. A few fallen blocks stand 2–4 units high. Roofs,
rafters and leaning panels are absent. Every height step has an outward-facing
end cap. Arbitrary concave footprints retain their exact ground area.

`tools/build_wreck_plinth.py` builds `wreck-plinth.png` with rounded, irregular
fieldstones, worn highlights and muted caps. The shared 512px atlas holds side
masonry in its upper-left quarter, caps in the upper-right, and dark ground with
sparse, low-contrast rubble below y=128. No per-building material is generated.
Rogue/Dreamland retain their prepared profile palette variants.
The floor sorts below actors; individual raised sections sort at their wall
baselines. Breaches, doorway clearance and scattered blocks use stable IDs.

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
