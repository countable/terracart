# Road treatment concepts

Eight preview-only alternatives in the actual Phaser WebGL road renderer:

- MD old trade roads: caravan wheel ruts, compacted gravel causeway, ancient
  broad slabs, buried old causeway.
- LG dimensional rifts: turquoise scar, violet void, obsidian faults, ancient
  dimensional conduit.

`concepts.js` derives material grain from the shipping selected-terrain atlas
and recorded native Rogue Adventure source crops. Directional wagon tracks,
large joints, rifts and energy channels follow the source road geometry. No
small cobble mask is used by the eight candidate MD/LG surfaces.

The study routes source code in an isolated browser context. `src/` is not
modified by this tool and no candidate is selected for normal play. Width
ordering, lamp filtering, terrain rules and restoration use the shipping game.
The controlled fixture deliberately assigns Lantern Row and Confusion Path so
changes are directly comparable, with a bend and junction in every view.

Serve the checkout on localhost port 8002. Dependencies: Chromium, root Node
modules, and purchased Rogue Adventure sources in `extra_assets/16x16`.

```sh
python3 -m http.server 8002 --bind 127.0.0.1
# In another terminal:
node tools/road-treatments/capture.cjs
python3 tools/road-treatments/report.py
```

The default output is `~/.artifacts/road-treatments/`. `OUT_DIR`, `GAME_URL`,
and `CHROMIUM` override the defaults. The report accepts its output directory as
the first argument. Finish, family and enlargement controls are presentation
controls over real native 352×352 captures. The source hash, actual renderer,
GL/page errors, geometry, resolved widths and opacity checks are in metadata.
Single rebuild timings are diagnostic samples, not phone benchmarks.

The source contact sheets are optional assets produced by the asset audit;
when present as `source-ground-contact.png` and `source-rift-contact.png` in the
output folder, the report links them beside each candidate's crop provenance.

## Small-road and path shading comparison

The separate shading section shows the shipping 20% vector tint, independently
of the MD/LG preview materials. Save the pre-shading renderer to a file and run:

```sh
git show <pre-shading-commit>:src/road_overlay.js > /tmp/road-shade-before.js
OUT_DIR="$HOME/.artifacts/road-treatments/shading" GAME_URL=http://127.0.0.1:8002 FIXTURE=tools/road-treatments/shading-fixture.json ROAD_SOURCE=/tmp/road-shade-before.js LABEL=before node tools/road-readability-study/capture.cjs
OUT_DIR="$HOME/.artifacts/road-treatments/shading" GAME_URL=http://127.0.0.1:8002 FIXTURE=tools/road-treatments/shading-fixture.json LABEL=after node tools/road-readability-study/capture.cjs
python3 tools/road-treatments/report.py
```

The main capture also checks three distinct small-road/path materials. Their
minimum base alpha, multiplied by the actual road-image alpha, is approximately
20%; restored material keeps transparent joints to avoid doubling that tint.
Pixel reads occur only in the capture harness/material preparation.
