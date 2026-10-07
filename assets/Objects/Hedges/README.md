# Connected hedge art

Revised with the built-in OpenAI image tool on 2 October 2026, using the old
approved clipped hedge as the camera and foliage reference. The camera looks
down from the south at roughly 45 degrees: a broad rounded canopy sits over a short shaded foliage
face. The connected footprint stays on the square grid. The full generation
prompt is in `perspective-prompt.txt`. See CLAUDE.md's shared design rules for
the intentional mix of top-down placement and angled artwork. Future revisions
should keep the overhead view dominant, with more canopy visible and the
front foliage face compressed.

Rebuild with `python3 tools/pack_selected_zone_art.py`. The script isolates each
source sprite, packs centerline connections into 24×24 frames, and exports
`hedges-24.png` plus `single.png`. Display at 4/3 for 32px game cells.
Only Formal Garden and Hedge Garden use this set. Existing wood harvest remains.

The packer crops connected end caps and uses `tools/connected_art.py` to fit
arms separately from the junction. This preserves consistent join widths
without squeezing away the front face: E/W arms occupy y=4..19 and N/S arms
x=6..17. The isolated hedge keeps its rounded silhouette. Frame order and
connection masks are unchanged.
