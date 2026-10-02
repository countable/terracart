# Mystic Reef coral

`reef_atlas.png` is the original transparent 4×4 candidate sheet generated with
OpenAI image generation on 2 October 2026 for this project. No external art pack.

`coral.png` now packs eight 24×24 coral frames from the newer ZoneVariants
atlas. Rebuild with `python3 tools/pack_zone_art.py` followed by
`python3 tools/pack_reef_art.py`. The original atlas is retained for reference.

Frames 0–3 are used as noninteractive water scenery near Mystic Reef zones.
Chests and ore use the existing game art and interaction mechanics. Remaining
atlas objects are proposals, not installed gameplay objects.
