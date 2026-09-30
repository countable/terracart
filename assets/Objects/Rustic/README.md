# Applied rustic defaults

Exact palette exports from `docs/art/art-direction.json`, using the same
`tools/nature_recolour.js` mapper as the art review gallery. Original source
images remain in their existing locations; their provenance is unchanged.

| Runtime file | Original source / frame |
| --- | --- |
| Props.png | Wilderness/Props.png; only grass frame 10 and surface mushroom frame 35 replaced (mushroom source frame 13) |
| trees.png | Tree.png first-row sprout, young and mature frames remapped to runtime frames 1, 2, 3 |
| bush.png | Wilderness/bushes.png rounded green frame 1 |
| pillar_c.png | Generated/pillar_c.png |
| pot.png | Generated/pot.png |
| pot_smashed.png | Generated/pot_smashed.png, matching the intact pot palette |

Dimensions and transparency are preserved for every source frame. No optional
zone recolours are applied. Clipped hedges remain a proposed formal-garden and
residential/commercial alternative. Cave mushrooms and fruit trees retain their
existing textures. Existing biome lighting/tints still operate normally.

Rebuild with Pillow, Playwright and Chromium:

```sh
python3 tools/apply_nature_recolours.py
```

Set `CHROMIUM_PATH` when using a separately installed Chromium executable.
