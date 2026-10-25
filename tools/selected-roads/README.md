# Selected road renderer checks

These controlled fixtures exercise the shipping Phaser road renderer and its
normal asset registration. The harness does not replace `road_overlay.js`,
`road_surfaces.js`, or their materials. It only forces Phaser's WebGL renderer,
freezes daylight/actors, and installs an isolated synthetic map and save.

Serve the checkout on localhost (port 8002 by default), then run:

```sh
node tools/selected-roads/capture.cjs
python3 tools/selected-roads/report.py
```

Chromium, the root Node dependencies, and Python Pillow must be available.
`GAME_URL`, `OUT_DIR`, and `CHROMIUM` override the defaults. Evidence defaults
to `~/.artifacts/ancient-road-surfaces/`; `report.py` accepts its path as an argument.
The shared artifact server presents the report at
`http://localhost:8765/ancient-road-surfaces/index.html`.

The fixtures cover Medium and Large weathered/restored/partially restored
roads, shallow and acute bends, same-tier T junctions, Small-road/path crossings,
and a mixed-size junction. Alternate-terrain fixtures retain the same road
geometry over grass, sand, rock and farmland; only those fixtures clear the
synthetic map’s road-suppression buffer to expose each substrate. Fixed-road
metadata must have no variants. Pixel checks compare crossing surfaces against
road-only references, partial repairs against complete repairs, cleared base
pixels beneath repairs, real missing pavers, camera move/return stability,
the existing 20% Small-road/path tint, terrain-independent road ink, and
clipping to the source-road union (with a one-pixel antialiasing allowance),
through-road interiors at T junctions, and the open channel mouth on the Large
T junction. Road texture canvases isolate paving
from the separate terrain-grid rift-buffer display. Pixel reads occur only in
this capture harness, never in the game's rebuild path.
