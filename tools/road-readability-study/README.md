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
