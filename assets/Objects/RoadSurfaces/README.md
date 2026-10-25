# Fixed road surfaces

`surfaces.png` contains four 128px materials, left to right:

1. Medium / unrepaired: cracked compacted gravel with missing chunks.
2. Medium / restored: the approved Compacted Gravel Causeway material.
3. Large / unrepaired: the approved Turquoise Dimensional Scar's dark Hell crust.
4. Large / restored: the approved Ancient Dimensional Conduit's mineral bed.

Source crops and palette recipes are recorded in `sources.json`. Rebuild with
`python3 tools/build_road_surfaces.py` using the purchased Rogue source sheets.
`rune-mask.png` records the extracted native Ancient glyph silhouette; its row
runs are baked into `src/road_surfaces.js` by the same builder. Runtime code reads
no pixels and has no dependency on `extra_assets/`.

`RoadSurfaces.decorate` lays road-aligned details using original-way metre
phase, retaining the same pattern across repair boundaries and camera movement.
These are fixed road-class treatments, not variants or spawn identities.
