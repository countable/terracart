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
to `~/.artifacts/selected-roads/`; `report.py` accepts its path as an argument.
The shared artifact server presents the report at
`http://localhost:8765/selected-roads/index.html`.

The fixtures cover Medium and Large weathered/restored/partially restored
roads, a bend, Small-road/path crossings, and a mixed-size junction. Fixed-road
metadata must have no variants. Pixel checks compare crossing surfaces against
road-only references, partial repairs against complete repairs, cleared base
pixels beneath repairs, real missing gravel chunks, camera move/return stability,
and the existing 20% Small-road/path tint. Road texture canvases isolate paving
from the separate terrain-grid rift-buffer display. Pixel reads occur only in
this capture harness, never in the game's rebuild path.
