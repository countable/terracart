# Real Kelowna building review

Run a local server at the repository root, then:

```sh
GAME_URL=http://localhost:7735 OUT=/tmp/kelowna-buildings-review/final node test/authored-kelowna-buildings.cjs
```

Requires Playwright Core and Chromium at `/usr/lib/chromium/chromium`. `QUICK=1` limits the run to the largest outline and brick style. `KEYS=trader,pp_flat_red LOTS=6,11 ANGLES=45,90` selects focused repair checks; omit these filters for the release audit. The full run renders 12 exact exterior rings, all 33 production key/palette combinations (21 building keys), and headings 0, 45, 90, 180 and 270 degrees. It uses production `BuildingLowPoly.add`, `authoredOutline`, source textures and WebGL depth renderer. Screenshots and audit JSON are written outside the repository.

`fixtures.json` records original MVT coordinates, feature IDs, ring indices, geographic coordinates, source tile hashes and translated/scaled metre coordinates. No geometry is snapped, simplified, orthogonalized or otherwise reshaped. These are OpenFreeMap MVT feature IDs, not asserted individual OSM way IDs. `extract.cjs` reproduces selection from the repository's Kelowna tile fixtures.

Coverage samples a 33×33 interior grid plus inward edge-midpoint probes and checks projected roof triangles above the ring. Runtime errors, non-finite geometry, non-authored fallbacks and missing sampled roof coverage fail the audit. The prepared PP flat deck region is also checked for a single source color, preventing repeated grid/checkerboard texture regressions. Visual inspection is still required: samples alone cannot prove absence of every gap, inverted triangle or texture seam.

Scope limitations: single exterior rings only; tile-clipped rings and negative-area interior rings were excluded. Courtyard holes and reconstructed multipolygons are not covered. The wizard, steam wizard and city gearhouse deliberately fit their original source shells inside the lot, and therefore are exempt from whole-lot roof coverage. Thin lots can produce very small landmark shells. Timing values are diagnostic, not a device-independent performance benchmark.
