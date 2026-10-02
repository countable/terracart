# Connected hedge art

Generated with the built-in OpenAI image tool on 2 October 2026, using selected
zone-object #46 as the foliage reference. Prompt: transparent 4×3 sheet of
strictly orthogonal, chunky 24px-style olive hedges: two straights, four corners,
four T junctions, a cross, and an isolated compact hedge. No diagonal perspective.

Rebuild with `python3 tools/pack_selected_zone_art.py`. The script isolates each
source sprite, packs centerline connections into 24×24 frames, and exports
`hedges-24.png` plus `single.png`. Display at 4/3 for 32px game cells.
Only Formal Garden and Hedge Garden use this set. Existing wood harvest remains.

The 2 October softness revision uses the original sheet and the older approved
clipped hedge as image-edit references. Foliage is fuller and rounded, with
gentler green shading. Straight sections now occupy 12 rather than 8 pixels
of the 24px cell; corners and junctions expand around the same centerlines.
