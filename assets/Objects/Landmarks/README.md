# Grove shrine artwork

Native-resolution, unmodified crops from the local art reserve (`unused_art`).
Coordinates are zero-based pixels, expressed as x, y, width, height.

| Asset | Source pack and sheet | Crop |
| --- | --- | --- |
| shrine-figure.png | Medieval Fantasy Royal City / tile-B-03.png | 192, 240, 48, 48 |
| shrine-votive.png | Fantasy City ver1.3 / Tiles / Above.png | 112, 256, 16, 16 |

Both are grove POI appearances. `SpriteLayout.GROVE_SHRINE_ART` owns their
world scale and selects a stable appearance from the POI ID. These replace
the generated moss shrine placeholder; rewards and interactions are unchanged.
