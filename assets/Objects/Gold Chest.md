# Gold chest art

`Gold Chest.png` is the unmodified right-hand 16 × 16 sprite from the existing
local `Chests.png` sheet: rectangle `(16, 0, 16, 16)`. Both source frames depict
closed chests; the right-hand gold chest is the approved map replacement.

The original 32 × 16 sheet is preserved beside the extracted sprite. No pixels
were recoloured, redrawn, rescaled or alpha-keyed. The local source did not
include author or licence metadata; this note records its source without
claiming additional provenance.

The runtime uses texture `chest`, frame 0, for the map and treasure-dialog
icon. Its shared 1.6× scale preserves the previous visible map width (~22px).
Opened one-time chests disappear through the existing game logic; this asset
does not add an open state or change chest contents.
