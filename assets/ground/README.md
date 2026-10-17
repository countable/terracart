# Ground atlas candidate

The current export is a 384×256 sheet containing 96 native 32×32 tiles:
28 active materials, each with a plain base and two decorated variants. Four unused road/path material slots remain transparent to preserve terrain IDs. `terrain-atlas-32.png`
is the opaque, palette-matched review sheet; `terrain-detail-32.png` is the
transparent runtime detail. `terrain-atlas-32.json` records source crops,
output hashes, dimensions and the export process. The export removes generated dividers with a five-source-pixel inset. Approved sand, water, brick, wood, castle, commercial and pier frames are copied exactly from the archived baseline. Median background anchoring prevents decorations from tinting their entire cell. `PROMPT-32.txt` records the
built-in imagegen prompt and art references.

Material-specific leaf litter, clover, bark chips, mineral flakes, reed stubble and divots draw on the user reference `docs/art/ground-style-reference.gif`. Grove defaults stay almost flat; commercial paving uses exactly one square slab per32px cell, with a flat interior and perimeter-only joints. Decorations contain one or two larger connected forms with clean flat shadows and highlight lips; scattered noise is removed.

The art takes its restrained surface detail from `docs/art/direction-reference.png`
and its crisp pixel shapes from `assets/Character/FarmerCyan.png`. Ground tiles
use four closely related cel-shaded tones per material (RGB offsets −10, 0, +6, +10), except lava with its saturated red/orange/gold palette, with sparse decorations selected at an 80/10/10 base/A/B ratio. Lava mixes its three channel layouts equally to reduce repeated motifs. Shallow highlighted bumps, worn depressions and low scrub give the decoration variants shape without prop-like contrast. Palette snapping happens after edge preparation, preserving hard shade boundaries. Tiles
have an explicit 32px art target: no intermediate 24px sampling or runtime resize.
The original `terrain-atlas.png`, metadata and prompt remain for comparison with
the previous 24→32 trial.

Open `tools/ground-texture-report.html` through HTTP. It shows the procedural original
beside the latest native export, with the old image trial for reference, identical player
placement, 1×/2×/4× views and all material pairs. The report isolates texture
repetition; in-game biome blending remains authoritative.

`tools/export-ground-atlas.cjs --source <master.png>` samples the generated
master at 32px, preserves the existing palette using transparent residual detail,
and prepares identical opposite edges shared by all three variants. Optional explicit
source row/column bounds handle imperfect generated layouts. Exported tiles
are always exactly 32×32. Keep generated masters in the local art archive rather
than shipping them as runtime textures. Inspect the native export for material
identity, interior edge bands and repetition; matching edge pixels alone cannot
prove visual quality.

The opt-in game trial (`?groundAtlas=true`) crops the baked transparent sheet
without reading pixels or recalculating its palette. Existing colour fills,
zone overrides and the border layer keep their prior behaviour. Sand retains its original procedural painter. Castle floors retain all 16 original variable-size slab layouts. Brick uses the image atlas with staggered courses and matching x/y edges. Wood, elevated cave walls, polygon roads and uncharted fog retain their
specialised renderers, and the comparison displays those actual renderers. Schoolyard, pitch and golf retain their original stripes beneath the new detail; their atlas base is transparent.

Water, pier water and lava retain their existing eight-phase, 220ms animated
ripple painters above the static image detail. Shoreline foam and pier decking
remain separate. The generation change does not replace their animation loop.

Rebuild this revision from the archived master:

```sh
node tools/export-ground-atlas.cjs --source ~/.artifacts/ground-atlas-32/terrain-atlas-revised-master.png --row-bounds 0,123,240,359,480,599,720,838,1024 --output /tmp/ground-revised-baseline --inset 5 --keep-from ~/.artifacts/ground-atlas-32/approved-baseline --keep-materials 2,3,9,11,12,16,23 --cel-shaded
node tools/export-ground-atlas.cjs --source ~/.artifacts/ground-atlas-32/terrain-atlas-focused-master.png --source-grid 3,3 --source-materials 18:0,28:1,26:2 --inset 5 --keep-from /tmp/ground-revised-baseline --keep-materials 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,19,20,21,22,23,24,25,27,29,30,31 --cel-shaded
```
