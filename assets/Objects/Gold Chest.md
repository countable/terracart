# Gold chest art

`Gold Chest.png` is the unmodified right-hand 16 × 16 sprite from the existing
local `Chests.png` sheet: rectangle `(16, 0, 16, 16)`. Both source frames depict
closed chests; the right-hand gold chest is the approved map replacement.

The original 32 × 16 sheet is preserved beside the extracted sprite. No pixels
were recoloured, redrawn, rescaled or alpha-keyed. The local source did not
include author or licence metadata; this note records its source without
claiming additional provenance.

This original single-frame asset is retained for provenance. The runtime now
loads `Approved/chest-tiers.png`: seven authored 16×16 frames under texture
`chest`, indexed by tier minus one. See `docs/art/ART_SOURCES.md` for that sheet's
source and extraction method. Opened one-time chests still disappear through
existing game logic; the new sheet adds no open state or loot changes.
