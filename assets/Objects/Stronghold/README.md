# Square-grid stronghold walls

Eleven OpenAI-generated wall candidates, 2 October 2026, using the zone object
atlas as a stone palette reference. The original angled wall candidates are
retained in ZoneVariants. These pieces are an orthogonal zone-replacement for
stronghold foundation stones, not a global replacement of mineral rock art.

Frame order: horizontal (EW), vertical (NS), top-left (ES), top-right (WS),
bottom-left (NE), bottom-right (NW), T north (NEW), T east (NES),
T south (ESW), T west (NSW), cross (NESW). Directions refer to screen/grid axes.

Rebuild exact 24×24 transparent frames with `python3 tools/pack_stronghold_art.py`.
The packer trims the generated source, uses nearest-neighbour sampling and hard
alpha, and seats the six-pixel wall bands around cell midpoints. Render at 4/3
scale for a 32px map cell. Source corners are normalized to 15×15 quadrants.

Installed as noninteractive stronghold_wall objects in Ruined Stronghold foundations.
Pieces are chosen from surviving cardinal neighbors; original global stones are unchanged.
The rectangle preview exposes remaining weathered-edge seams; these are not
claimed to be seamless production autotiles. Open ends and isolated cells retain the existing stone/rubble fallback.
Junctions use dedicated T and cross pieces. Rendering preserves frame alignment
instead of recentering each corner by its trimmed bounds.

Build the review with `python3 tools/preview_stronghold_art.py OUTPUT_DIRECTORY`.
