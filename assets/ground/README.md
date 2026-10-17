# Ground atlas candidate

The current export is a 256×256 sheet containing 64 native 32×32 tiles:
32 materials, each with a base and decorated variant. `terrain-atlas-32.png`
is the opaque, palette-matched review sheet; `terrain-detail-32.png` is the
transparent runtime detail. `terrain-atlas-32.json` records source crops,
output hashes, dimensions and the export process. The final export trims four
source pixels from each crop edge to exclude generated divider lines. `PROMPT-32.txt` records the
built-in imagegen prompt and art references.

The art takes its restrained surface detail from `docs/art/direction-reference.png`
and its crisp pixel shapes from `assets/Character/FarmerCyan.png`. Ground tiles
have an explicit 32px art target: no intermediate 24px sampling or runtime resize.
The original `terrain-atlas.png`, metadata and prompt remain for comparison with
the previous 24→32 trial.

Open `tools/ground-texture-report.html` through HTTP. It shows the old image
trial beside the native export, with the procedural baseline, identical player
placement, 1×/2×/4× views and all material pairs. The report isolates texture
repetition; in-game biome blending remains authoritative.

`tools/export-ground-atlas.cjs --source <master.png>` samples the generated
master at 32px, preserves the existing palette using transparent residual detail,
and prepares identical opposite edges shared by both variants. Optional explicit
source row/column bounds handle imperfect generated layouts. Exported tiles
are always exactly 32×32. Keep generated masters in the local art archive rather
than shipping them as runtime textures. Inspect the native export for material
identity, interior edge bands and repetition; matching edge pixels alone cannot
prove visual quality.

The opt-in game trial (`?groundAtlas=true`) crops the baked transparent sheet
without reading pixels or recalculating its palette. Existing colour fills,
zone overrides and the border layer keep their prior behaviour. Structural
masonry, elevated cave walls, polygon roads and uncharted fog retain their
specialised renderers; the sheet contains review candidates for these too.

Water, pier water and lava retain their existing eight-phase, 220ms animated
ripple painters above the static image detail. Shoreline foam and pier decking
remain separate. The generation change does not replace their animation loop.

Rebuild this revision from the archived master:

```sh
node tools/export-ground-atlas.cjs --source ~/.artifacts/ground-atlas-32/terrain-atlas-v2-master.png --inset 4
```
