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
prevent a safe inset. The original ridge fixtures remain at 26–68 roof triangles
each. The imported style fixtures top out at 208–354 total triangles, including
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
