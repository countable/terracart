# Actual-renderer road comparison

This tool installs a controlled synthetic road tile into a disposable sandbox
browser context. Shipping rasterization, variant interval resolution, road
canvases, lamp placement, and Phaser WebGL render the captures. The fixture
assigns variants explicitly; it is not a claim about a randomly generated town.
Normal 11-cell captures are primary. Optional 21-cell views widen the camera;
the fixed mobile UI mask clips their vertical coverage.

Serve the checkout on localhost port 8000. Chromium and the root Node dependencies
must be installed. Save a renderer version from before this change to compare:

```sh
git show <pre-change-commit>:src/road_overlay.js > /tmp/road-readability-baseline.js
ROAD_SOURCE=/tmp/road-readability-baseline.js LABEL=before node tools/road-readability-study/capture.cjs
LABEL=after node tools/road-readability-study/capture.cjs
python3 tools/road-readability-study/verify.py
python3 tools/road-readability-study/report.py
```

Output defaults to `~/.artifacts/road-readability-implementation/`.
Set `OUT_DIR`, `GAME_URL`, or `CHROMIUM` to override it. Set `CELLS=21` for
wider captures, before and after. Generate those before building the report if
you want its wider-detail images, then build with `INCLUDE_WIDE=1`. `verify.py` and `report.py` accept the output
directory as their first argument. The verifier needs Pillow.

Metadata records the frozen renderer source hash, actual WebGL type/errors,
resolved variant intervals and widths, lamp positions, and synchronous rebuild
timing samples. The samples use headless SwiftShader and are not device/frame-rate
benchmarks. Pixel comparisons use the road texture inputs to exclude unrelated
rift-ground policy differences, and use actual scene screenshots for seam on/off.
Seams are enabled only for these fixtures with `scene.roadVariantSeams = true`.
The seam-off case renders identical geometry with the flag disabled.

## Medium/Large solid-bed comparison

The optional `FIXTURE` path selects a different controlled geometry JSON.
`ROAD_ALPHA_AUDIT=1` records cached material alpha counts without asserting
that a baseline is already opaque. For the solid-bed change:

```sh
git show <pre-solid-bed-commit>:src/road_overlay.js > /tmp/mdlg-road-before.js
OUT_DIR="$HOME/.artifacts/mdlg-road-fill" FIXTURE=tools/road-readability-study/solid-fill-fixture.json ROAD_ALPHA_AUDIT=1 ROAD_SOURCE=/tmp/mdlg-road-before.js LABEL=before node tools/road-readability-study/capture.cjs
OUT_DIR="$HOME/.artifacts/mdlg-road-fill" FIXTURE=tools/road-readability-study/solid-fill-fixture.json ROAD_ALPHA_AUDIT=1 LABEL=after node tools/road-readability-study/capture.cjs
python3 tools/road-readability-study/solid-fill-report.py "$HOME/.artifacts/mdlg-road-fill"
```

The last command verifies fully opaque MD/LG cached materials in both finishes,
unchanged transparent gaps on plain roads and Lantern Row, and fully opaque
interior pixels in the actual road canvases. It also creates the comparison
report. The road image's existing overall alpha remains unchanged; the bed
removes material holes, rather than changing terrain-grid painting.
