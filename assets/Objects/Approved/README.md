# Approved map art

Generated from the selected map-art audit recipes. Original library sheets stay
unchanged; these PNGs preserve their frame layouts and contain the reviewed
colour treatments and swaps. `manifest.json` records source hashes, affected
texture keys, frame operations and output hashes. Only affected assets are listed.

Rebuild from the repository root:

```sh
CHROMIUM_PATH=/path/to/chromium python3 tools/apply_map_art.py
```

The first export can use `--reserve-root /path/to/unused_art`. Selected external
library sources are retained in `Sources/`, so subsequent exports do not need
that library. Every run starts from the original sources, never from its own
outputs. Pillow reads source crops; the shared `ArtPreviewColour` Canvas2D
implementation performs the same transforms as the review pages.

Tree growth sheets and crop growth frames keep their existing geometry.
Inventory-only frames retain their original pixels unless explicitly included
in the audit. The seven existing produce-counter frames share their treatment.
No actor, enemy, macro-booth or chapel art is changed.

Unclaimed fort and wreck PNGs already include their approved weathering; their
asset records declare `unclaimedArt` to prevent a second runtime wash. Separate
context sprites are selected by the game only in their declared zones. Moss
stone retains the four quantity silhouettes, adding four moss-detail pixels
immediately inside each contour without changing its alpha or reward mapping.
