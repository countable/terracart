# Zone object sprites

64 generated candidates in an 8-column, 8-row grid. OpenAI image generation,
2 October 2026; no external art pack. The prompt requested a 1024-square atlas
emulating 24-pixel art. The model returned 1254-square artwork (`source.png`).
`atlas-1024.png` is the normalized reference sheet.

`objects-16.png` and `objects-24.png` contain exact 16×16 and 24×24 frames.
`manifest.json` names every frame in row-major order. Regenerate with
`python3 tools/pack_zone_art.py`, then `python3 tools/pack_reef_art.py`.
Exports use nearest-neighbour sampling, hard alpha and one-pixel margins.

The first four corals (row 4) are used by Mystic Reef. Other frames are candidate
art, including masonry and three-pot clusters; they do not create new mechanics.
