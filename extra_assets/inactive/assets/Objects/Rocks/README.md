# Rock atlas

`rocks-16.png` is the approved DG-style rock family, with dark upper contours
and local shaded colors on the side and bottom edges. Each frame is native
16×16. The runtime atlas is 8×9 cells with 65 active frames and seven empty cells.
`ROCK_WORLD_SCALE` compensates for the former 24px cells without resampling art.

`dg-study-16.png` preserves the approved 8×8 study. `manifest.json` owns the
unchanged mapping into existing runtime identities. `export.json` records each
source frame and measured bounds. Repack without resampling:

```sh
CHROMIUM_PATH=/usr/bin/chromium node extra_assets/inactive/assets/Objects/Rocks/export.cjs
```

The source was generated from a DG gray-rock reference enlarged 4×, then reduced
4:1 with nearest-neighbor sampling. A background-connected mask removes gray;
directional edge repair maps the reference upper outline onto each silhouette
and uses local interior material colors on other boundaries. It changes boundary
colors only, retaining the masked silhouettes and interior pixels. Irregular
shapes and crystals use approximate upper-outline placement. The approved source,
cleanup script and comparisons are archived at
`http://localhost:8765/dg-rock-set-edges/`. Earlier cel-shaded assets remain as
historical studies and are not loaded by the game.

The first 30 frames retain regular/boulder pairs for plain stone, flint, Rose
Quartz, Topaz, Amethyst, Sapphire, Ruby, Emerald, Diamond, Copper, Iron, Gold,
Platinum, Crimson and Frost. Quartz is pink; the generic crystal deposit is
Sapphire. Platinum, Crimson and Frost are metals, represented with silver, red
and blue seams. Remaining frames retain the existing plain, contextual and
zone-signature slots, including Mystic Reef at frame 64.

`preview.html` displays runtime frames and zone tints. The current comparison is archived at
`http://localhost:8765/dg-rock-set-edges/comparison-green.png`.

After changing the atlas, regenerate its measured entries in
`SpriteLayout.ART_BOUNDS` and run the sprite audit. Media cache hashes are generated
by `node tools/cachebust.js --write`; do not hand-edit them.
