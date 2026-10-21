# Rogue Adventure jungle renderer study

An opt-in, flat forest fixture that matches the supplied Rogue Adventure jungle
reference using the game's Phaser renderer. It does not change the live world's
art selections. Cliffs and elevation are omitted. The fixture includes 25 trees,
two lamps, seven rocks, 19 tiny flat leaf marks, a pond and six bridge cells.

## Reproduce

From the repository root, with the installed `extra_assets` tilesheets, Pillow,
Playwright Core and Chromium available:

```sh
python3 -m http.server 8000
```

In another terminal:

```sh
python3 tools/jungle-study/build_assets.py --out /tmp/ra-jungle
node tools/jungle-study/autotile.test.cjs
OUT_DIR=/tmp/ra-jungle node tools/jungle-study/capture.cjs
python3 tools/jungle-study/diagnostics.py /tmp/ra-jungle
```

`GAME_URL` overrides the game server; `CHROMIUM` overrides the browser binary.
The capture uses an isolated browser context and save. It writes `baseline.png`,
`jungle.png`, the fake tile input (`fixture.json`), paired object inventories,
`renderer-audit.json` and browser errors to `OUT_DIR`. Both captures are 640×500.

## Renderer path

`reference-layout.json` contains source-space tree placement and ground/pond
polygons, with explicit vertex refinements fitted to the visible reference. The
capture samples these into a fake `WorldGen` tile entry. Water remains connected
beneath the bridge; a separate `groundType` preserves terrain occupancy beneath
deck overlays. The live
`drawCells`, `drawObjects`, projection, sprite pools and WebGL snapshot render it.
Browser-only routes widen the capture viewport and configure the existing
`Lighting.draw` pass to a neutral half-bright ambient with two white lamp pools.
They omit the production canopy-cover contribution for this reference match.
No second lighting overlay is used.

`apply.js` assigns source art to the existing object appearance registry and
reuses the terrain sprite pool after `drawCells`. It suppresses the production
blur/foam overlay in this trial so it cannot draw a second border over the authored
edges. A trial-only low-poly filter lets the seven reference rocks use source
sprites. Houses and trees elsewhere in the game are unaffected.

`../jungle-autotile.js` provides a dual-grid selector: each rendered tile reads
four occupancy vertices and selects one of 16 source-native configurations.
Full 16px convex corners, straight edges and concave corners are retained at 2×
display scale. Diagonal islands remain disconnected. The atlases are baked once;
rendering only chooses cached frames. The secondary 47-mask API supports sheets
actually authored for quarter tiles; it is not used for these jungle edges.

## Fidelity and deliberate differences

- `assets.json` records exact source rectangles; `build_assets.py` reproduces crops.
- Trees, bank art, olive ground, lamps, bridge, rocks and leaf marks use installed
  sprites. The water's busy cyan ripple pixels are replaced once with that source's
  dominant water pigment to match the reference's calm surface.
- The reference's cliff system, flowers and upright grass decorations are omitted.
  Leaf marks are flat, non-interactable fixture decoration.
- The study is a still frame; it does not reproduce the GIF's rain or animation.
- The map is authored input, not real geographic tile generation. Native tile
  boundaries approximate the reference's pond and soil outlines.

## Checks

`autotile.test.cjs` checks disconnected diagonals, convex/concave corners,
channels, islands, negative coordinates and joins across source-tile boundaries.
`diagnostics.py` draws the actual resolver's source choices for visual inspection.
The browser capture asserts identical object IDs and positions between treatments,
53 objects, six bridge cells, two lamp collectors, the expected flat terrain types,
actual WebGL with no GL/browser errors, and the existing lightmap without a custom
overlay. It fails explicitly if the production lighting route anchors change.
