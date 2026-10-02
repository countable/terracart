# Square-grid stronghold walls

Six OpenAI-generated wall candidates, 2 October 2026, using the zone object
atlas as a stone palette reference. The original angled wall candidates are
retained in ZoneVariants. These pieces are an orthogonal zone-replacement for
stronghold foundation stones, not a global replacement of mineral rock art.

Frame order: horizontal (EW), vertical (NS), top-left (ES), top-right (WS),
bottom-left (NE), bottom-right (NW). Directions refer to screen/grid axes.

Rebuild exact 24×24 transparent frames with `python3 tools/pack_stronghold_art.py`.
The packer trims the generated source, uses nearest-neighbour sampling and hard
alpha, and seats the six-pixel wall bands around cell midpoints. Render at 4/3
scale for a 32px map cell. Source corners are normalized to 15×15 quadrants.

Preview only: not registered in game rendering or foundation generation.
The rectangle preview exposes remaining weathered-edge seams; these are not
claimed to be seamless production autotiles. Open ends, junctions and isolated
cells still need an explicit fallback when integrating partial foundations.

Build the review with `python3 tools/preview_stronghold_art.py OUTPUT_DIRECTORY`.
