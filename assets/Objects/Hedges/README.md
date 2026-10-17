# Connected hedge art

The connected hedges use the approved bush/barrel/pot v3 cel-shaded foliage.
The camera sees a broad front side and a dominant canopy on a cardinal square
grid. `approved-props-v3.png` preserves the approved source atlas.

Rebuild with `python3 tools/pack_cel_hedges.py`. This crops interior foliage
swatches from approved frames 32 and 43, composites their canopy and shaded
front pixels into each connection mask, and exports `hedges-24.png`, the
individual named frames, and `single.png` (approved frame 47). It also writes
`/tmp/cel-hedge-joins.png` for visual inspection. No new foliage or shading is
painted by the packer.

The runtime atlas is 360×24: fifteen 24×24 frames in the unchanged order and
connection masks recorded in `manifest.json`. E/W arms span y=4..19; N/S arms
span x=6..17. Every connecting edge has exactly the same RGBA strip as its
opposite edge, checked by the exporter across all possible tile pairs. Display
at 4/3 for 32px game cells. Only Formal Garden and Hedge Garden use this set;
wood harvesting is unchanged.

The older `source.png` and `perspective-prompt.txt` document the superseded
painted set. Do not regenerate these runtime assets with the older
`pack_selected_zone_art.py` packer, which uses that source.
