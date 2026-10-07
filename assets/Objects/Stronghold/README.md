# Stronghold walls viewed from above at 45 degrees

Eleven wall sprites revised with the built-in OpenAI image tool on 2 October
2026. The previous wall sheets supplied the stone palette and topology; the
old approved clipped hedge supplied the elevated viewpoint. The light top
caps and shaded front masonry now have visible depth instead of reading as
flat paving. Cardinal connections remain on the game's square grid. The
illustrated viewpoint is from the south; placement follows the top-down grid,
as specified in CLAUDE.md's shared design rules. Walls retain legible upright
height while other props emphasize their top surfaces; preserve these cardinal
connections when revising the viewpoint.

Prompt: edit the ruined walls to a 45-degree elevated camera, showing broad
light top caps and darker vertical masonry faces. Preserve muted warm-grey
stone, olive moss, chunky pixels and transparency. Keep screen-horizontal and
screen-vertical connections, without rotating the grid. Arrange the eleven
pieces in a four-column, three-row sheet, in the frame order below; leave the
last cell empty. No text, ground, grass or cast shadows.

Frame order: horizontal (EW), vertical (NS), top-left (ES), top-right (WS),
bottom-left (NE), bottom-right (NW), T north (NEW), T east (NES),
T south (ESW), T west (NSW), cross (NESW). Directions refer to screen/grid axes.

Rebuild exact 24×24 transparent frames with `python3 tools/pack_stronghold_art.py`.
The packer isolates the largest connected sprite in each source cell, excluding
stray pixels from neighboring art, then trims the generated source, uses nearest-neighbour sampling and hard
alpha, crops connected end caps, and fits arms separately from their junction
with `tools/connected_art.py` to preserve the raised cap and front face.
E/W arms occupy y=6..15;
N/S arms occupy x=9..14. Render at 4/3 scale for a 32px map cell.

Installed as noninteractive stronghold_wall objects in Ruined Stronghold foundations.
Pieces are chosen from surviving cardinal neighbors; original global stones are unchanged.
Open ends and isolated cells retain the existing stone/rubble fallback.
Junctions use dedicated T and cross pieces. Rendering preserves frame alignment
instead of recentering each corner by its trimmed bounds.

Build the review with `python3 tools/preview_stronghold_art.py OUTPUT_DIRECTORY`.
