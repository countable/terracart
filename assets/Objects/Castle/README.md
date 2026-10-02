# Castle tower art

`tower_shapes.png` contains four 32×48 frames in one 128×48 transparent sheet.
The approved designs were regenerated with taller masonry shafts in
`tower_master.png`, then fitted to one cell wide and one-and-a-half cells tall.
Each tower is seated at the bottom of its cell. Wall sections share the ordinary
object painter order, anchored at their lowest masonry point. No cell-based
tower/wall ordering overrides are used.

| Frame | Family | Approved candidate | Visible height |
| --- | --- | --- | --- |
| 0 | Citadel | 7, round crenellated tower | 48 px |
| 1 | Weathered Ruin | 12, damaged tower | 48 px |
| 2 | Intact Bastion | 1, square tower | 48 px |
| 3 | Old Archive Court | 3, timber upper ramparts | 48 px |

`frames.json` records each candidate number, its crop rectangle in the approved
master (`x, y, width, height`), and the exported silhouette height. Frame order
matches `CastleStyles.ids` and `CastleStyles.get(ownerKey).towerFrame`.
The regenerated master is the transparent four-column, one-row sheet beside
this file. Candidate numbers refer to the original twelve-design exploration.
Frame 1 now uses `tower_ruin_master.png`: a further-damaged version with a
broken parapet lip and cracked shaft. Its built-in imagegen prompt is saved in
`ruin-generation.json`; the exporter preserves the other three frames.

Regenerate from the repository root, with Playwright Core and Chromium installed:

```sh
node tools/export_castle_towers.js
```

Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`. The exporter
recreates both the shape sheet and crop metadata. It uses high-quality reduction
to combine source detail rather than randomly selecting isolated source pixels.
The game thresholds source alpha to clean pixel edges and maps brightness into
the family palette while baking the `tower` and `tower_unclaimed` textures.
The bottom ten rows then fade from 30% opacity at the foot to 100% opacity,
softening joins with irregular castle geometry in both restoration states.

`src/castle_styles.js` owns all stone, wood and courtyard colours. Archive brown
source pixels map to its wood ramp; other pixels map to stone. A family keeps
its silhouette after restoration. All four unclaimed palettes are weathered and
dark; restored versions are brighter. “Citadel” is a family, while darkness is
a condition. Weathered Ruin intentionally keeps its damaged silhouette.

Do not apply an additional global unclaimed wash to these textures. Wall tops
and courtyard floors consume the same already-treated material descriptors.
The runtime also records the top occupied pixel of each frame so flags and
claim markers clear towers of different heights.

Every unclaimed tower flies a square black skull flag. Restoration removes
those flags and shows the existing player banner on the castle's flag post.

Unrestored tower flags share a square dark cloth and skull motif, with distinct
heraldry: Citadel has a midnight-blue skull banner; Weathered Ruin a cracked
skull on moss-black cloth; Intact Bastion a skull inside a shield on burgundy;
Old Archive Court a skull above an open book on plum. `makeCastleSkullFlagTexture`
bakes these four native pixel canvases once. The renderer selects them using
the same castle identity as the masonry. Restoration removes the skull flags
and keeps the original cream and green-heart player banner at `flagPost`.
