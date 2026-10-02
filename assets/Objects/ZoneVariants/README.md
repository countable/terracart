# Zone object sprites

64 generated candidates in an 8-column, 8-row grid. OpenAI image generation,
2 October 2026; no external art pack. The prompt requested a 1024-square atlas
emulating 24-pixel art. The model returned 1254-square artwork (`source.png`).
`atlas-1024.png` is the normalized reference sheet.

`objects-16.png` and `objects-24.png` contain exact 16×16 and 24×24 frames.
`manifest.json` names every frame in row-major order. Regenerate with
`python3 tools/pack_zone_art.py`, then `python3 tools/pack_reef_art.py`.
Exports use nearest-neighbour sampling, hard alpha and one-pixel margins.

The accepted frames are recorded in selection.json and installed through the
zone/material tables. Unselected proposals are excluded from the active review
and approved atlas. The original sheets remain historical generation sources.

## Approved selection

`selection.json` owns the user's accepted source-frame numbers; `approved-24.png`
contains only those frames, preserving original indices and leaving discarded
cells transparent. The original atlas is retained as generation provenance.
`review-baseline-assets.json` preserves the prior assets for before/after review.
Rebuild installed standalone assets, approved atlas, and hedges with
`python3 tools/pack_selected_zone_art.py`.

All clay-pot locations use selected frame20 and `pots_smashed.png` after use.
The latter was generated with the built-in image tool on 2 October 2026:
matching three cracked terracotta pots, all smashed into jagged bases and large
shards, same reddish palette, overhead 24px-style pixel art, transparent
background. `pots-smashed-source.png` preserves the generated source.
