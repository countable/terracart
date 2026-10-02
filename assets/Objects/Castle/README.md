# Castle tower art

`tower_shapes.png` contains four 32×40 frames in one 128×40 transparent sheet.
The frames preserve the approved generated silhouettes at their natural aspect
ratios, centred horizontally and seated on the bottom of each frame.

| Frame | Family | Approved candidate | Visible height |
| --- | --- | --- | --- |
| 0 | Citadel | 7, round crenellated tower | 37 px |
| 1 | Weathered Ruin | 12, damaged tower | 35 px |
| 2 | Intact Bastion | 1, square tower | 35 px |
| 3 | Old Archive Court | 3, timber upper ramparts | 33 px |

`frames.json` records each candidate number, its crop rectangle in the approved
master (`x, y, width, height`), and the exported silhouette height. Frame order
matches `CastleStyles.ids` and `CastleStyles.get(ownerKey).towerFrame`.
The candidate master is the transparent four-column, three-row sheet retained
under `~/.artifacts/castle-tower-candidates/master.png`.

Regenerate from the repository root, with Playwright Core and Chromium installed:

```sh
node tools/export_castle_towers.js ~/.artifacts/castle-tower-candidates/master.png
```

Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`. The exporter
recreates both the shape sheet and crop metadata. It uses high-quality reduction
to combine source detail rather than randomly selecting isolated source pixels.
The game then thresholds alpha to opaque pixel edges and maps brightness into
the family palette while baking the `tower` and `tower_unclaimed` textures.

`src/castle_styles.js` owns all stone, wood and courtyard colours. Archive brown
source pixels map to its wood ramp; other pixels map to stone. A family keeps
its silhouette after restoration. All four unclaimed palettes are weathered and
dark; restored versions are brighter. “Citadel” is a family, while darkness is
a condition. Weathered Ruin intentionally keeps its damaged silhouette.

Do not apply an additional global unclaimed wash to these textures. Wall tops
and courtyard floors consume the same already-treated material descriptors.
The runtime also records the top occupied pixel of each frame so flags and
claim markers clear towers of different heights.
