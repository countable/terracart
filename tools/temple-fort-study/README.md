# Tile-built temple and fort studies

A standalone visual workshop for six modular 3D structures. It uses the game's
square ground axes, half-depth ground foreshortening, screen-vertical height,
nearest-neighbour sampling and registered steampunk building meshes. It does
not register new gameplay models or modify saves, collisions or runtime assets.

Build a self-contained review:

```sh
python3 tools/temple-fort-study/build.py --out ~/.artifacts/temple-fort-study
```

Serve that directory over HTTP. The shared artifact server exposes it at
`http://localhost:8765/temple-fort-study/`. Rotation, condition, palette and roof
controls apply to every candidate. Each card opens a larger inspection view.
The detached 32-unit paving slab supplies a common scale reference.

`study.json` owns names and descriptions. `study.js` owns geometric assemblies:

| Temple | Fort |
| --- | --- |
| T1: open rune court in Sanctuary stone | F1: continuous steampunk courtyard block |
| T2: three-sided colonnade using Temple tiles | F2: textured timber palisade with central gearhouse |
| T3: terraced, roofed shrine using Temple tiles | F3: low masonry enclosure with central hall and sheds |

The current renderer retains GPU buffers and textures through compass changes.
A roof/palette/condition change rebuilds study assemblies; condition is a shared
preview wash, not final restoration art. All vertical detail is mesh geometry or
native facade art. Source tiles stay at a shared 0.62 world units per texel;
registered City source art uses its native model scale (0.38–0.4 units/texel).
Native column light bands remain painted. These choices need an in-world scale
and collision review before production adoption. F1 is a single orthogonal
U-shaped footprint, so its courtyard requires no polygon-hole support.

`build_materials.py` crops acquired Rogue Adventure World sources with Pillow.
It preserves native pixels and records source rectangles, hashes and alpha in
`materials.json`. `build.py` copies the shipping facade/roof/City builders into
the artifact with source hashes, so the saved experiment survives later runtime
changes. Raw licensed sheets are never copied. The City roof uses the game's
copper hue/saturation recipe; material lighting is deliberately restrained.
Runes and the small dice marker are procedural preview decoration.

Rogue Adventure World: **ElvGames**. Registered Steampunk City textures: see
`assets/Objects/PPBuildings/manifest.json`. Use local processed study derivatives
only; do not redistribute licensed source sheets or use them in image generation.

Browser verification (requires the artifact server and Chromium):

```sh
node tools/temple-fort-study/check.cjs
```

Set `VIEWER_URL` or `ART_OUTPUT` to change its input or screenshot directory.
The check exercises six models at nine headings, material/condition/roof
combinations, mobile layout and interactive rotation. It asserts finite mesh
coordinates, no WebGL/resource errors and retained buffers/textures on rotation.
