# Mystic Reef coral

`reef_atlas.png` is the original transparent 4×4 candidate sheet generated with
OpenAI image generation on 2 October 2026 for this project. No external art pack.

`coral.png` packs its first eight coral candidates into 64×64 frames. Rebuild with
`python3 tools/pack_reef_art.py`. Packing trims transparent margins and uses
nearest-neighbour resizing; it does not recolour or redraw the source.

Frames 0–3 are used as noninteractive water scenery near Mystic Reef zones.
Chests and ore use the existing game art and interaction mechanics. Remaining
atlas objects are proposals, not installed gameplay objects.
