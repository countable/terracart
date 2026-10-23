# Temple and fort review

A standalone rotatable review of the selected temple and fort, with nine earlier
proposals retained in a collapsed comparison section. It follows the game's
square ground axes, half-depth foreshortening, screen-vertical height and nearest
neighbour source pixels. It does not change saved games or model registration.

Build the review:

```sh
python3 tools/temple-fort-study/build.py --out ~/.artifacts/temple-fort-study
```

Serve that directory over HTTP. The shared artifact server exposes it at
`http://localhost:8765/temple-fort-study/`. Drag either model to rotate it; each
card opens a larger view. Compass, condition, palette and roof controls are
shared. The detached paving slab is one 32-unit game cell.

The selected pair are:

- **T7, rune terrace with roof brim:** the original marble-like stone floor,
  small 16×8 staggered bricks and runes, with a continuous low stone brim around the
  raised top. Light top/left and dark bottom/right edges give each brick depth.
  No separate altar, doorway or walking entrance. It calls the
  shipping `TempleArt.draw` with no RA floor pattern and derives its brim and
  foundation dimensions from `TempleArt.geometry`.
- **F4, palisaded copper compound:** the F3 copper hall and two supply sheds,
  with one central dice sign and the original procedural grey-brown plank floor.
  Square poles touch along the perimeter, with pointed tops and a central gate.
  The study uses the shipping `WallMaterials.geometry` and atlas: poles are
  32/6 units wide and 24 units tall including their 10-unit carved points. The
  point continues the shaft grain and face colour. A discrete tint boundary at 12 units makes the upper half subtly lighter. The wood ramp
  matches Rogue Adventure Village's subdued brown poles.

`study.json` owns names and descriptions; `study.js` owns assemblies. `build.py`
copies the shipping City mesh builders, wall material module and temple painter
into the output. It extracts the exact `drawWoodFloorTex` and its `dot` helper
from `src/textures.js`. The plank overlay sits on the original `#9e7e50` floor
base. `sources.json` records copied source hashes so each saved review remains
reproducible after later runtime edits. Condition applies a shared preview wash;
it is not final restoration art. Geometry and texture buffers are retained on
compass changes; changing roof, palette or condition rebuilds assemblies.

`build_materials.py` crops native Rogue Adventure World sources and records
source rectangles, hashes and alpha ranges in `materials.json`. Native tiles
in older proposals use 0.62 world units per texel; registered City art uses its
native model scale. Raw licensed sheets are never copied.

Browser verification (requires Chromium and an HTTP server):

```sh
VIEWER_URL=http://localhost:8765/temple-fort-study/ node tools/temple-fort-study/check.cjs
```

`ART_OUTPUT` sets the screenshot and audit directory (default
`/tmp/temple-fort-check`). The check covers 11 meshes at nine headings, all eight
palette/condition/roof combinations, mobile layout and interactive rotation.
It checks finite mesh coordinates, WebGL/resource errors and retained buffers
and textures. It also checks the selected palisade's dimensions and shade
boundary, the original floors and the continuous temple brim. Interior rays
must still hit the three earlier closed temple shells in four cardinal
directions and overhead.

Rogue Adventure World: **ElvGames**. Registered Steampunk City textures: see
`assets/Objects/PPBuildings/manifest.json`. Use local processed derivatives only;
do not redistribute licensed sheets or use them in image generation.

## Existing fence sources

The acquired packs also contain these purpose-made fences. The selected fort
uses square 3D poles styled against the Village wood ramp, rather than a flat
fence sprite.

- Steampunk City `tile-B-05.png`: iron/copper gear panels and posts, crop
  `[96,208,288,176]`.
- Fantasy Dreamland Green Plains `FDR_Grasslands.png`: connected wooden rails,
  corners and posts, crop `[0,160,96,64]`.
- Pixel Plains `Harvest Sumer Full Ver. Pack/Wood stuff/fences and ladders etc.png`:
  timber rails and gate frames.
- Tiny Farm `Objects/Fence's copiar.png`: connected wooden enclosure pieces.
- Medieval Fortress `tile-B-02.png`: masonry parapets with railings.
