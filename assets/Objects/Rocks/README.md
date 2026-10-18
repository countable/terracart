# Rock atlas

`rocks-24.png` is the approved cool-stone, cel-shaded family: circular ground
footprints, geometric upper forms, softened outlines, bright crystal facets and
metallic seams. Each frame is 24×24. The runtime atlas is 8×9 cells with 65 active
frames and seven transparent trailing cells.

`cel-shaded-study-24.png` preserves the approved 8×8 study. `manifest.json` owns
the explicit mapping from that study into the existing runtime frame identities;
themed slots reuse the closest approved forms. `export.json` records the output
bounds and source frame for each runtime frame. Repack without resampling:

```sh
CHROMIUM_PATH=/usr/bin/chromium node assets/Objects/Rocks/export.cjs
```

The first 30 frames retain regular/boulder pairs for plain stone, flint, Rose
Quartz, Topaz, Amethyst, Sapphire, Ruby, Emerald, Diamond, Copper, Iron, Gold,
Platinum, Crimson and Frost. Quartz is pink; the generic crystal deposit is
Sapphire. Platinum, Crimson and Frost are metals, represented with silver, red
and blue seams. Remaining frames retain the existing plain, contextual and
zone-signature slots, including Mystic Reef at frame 64.

`preview.html` displays runtime frames and zone tints. The original generation
prompts and icon comparison are archived at
`http://localhost:8765/rock-game-materials-24/index.html`.

After changing the atlas, regenerate its measured entries in
`SpriteLayout.ART_BOUNDS` and run the sprite audit. Media cache hashes are generated
by `node tools/cachebust.js --write`; do not hand-edit them.
