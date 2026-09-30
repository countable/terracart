# Sprite art direction

The natural and unrestored world uses muted post-apocalyptic rustic colours.
Players, restored assets, and special or sacred places may deliberately introduce
cleaner, brighter or cooler colours. Colour signals care and significance; the
crisp chibi retro pixel style stays consistent in every state.

`art-direction.json` owns the working palette, colour provenance, state rules,
candidate assessments and proposed ruins roles. These are review targets, not a
runtime palette filter. No sprites or spawn rules are changed by this document.

The palette was built from twelve current story paintings. Each contributes an
equal sample: whole landscape paintings, but only the upper 40% of portrait
paintings, excluding the deliberately dark text area. The preview shows the
measured RGB median-cut colours separately from the curated working palette.
Muted foliage, neutral stone and restored accents are authored extensions, not
claimed as direct samples. Exact player cyan and charcoal come from the current
character sprites.

Use the current 16px Cyan character pack as the sprite style anchor: compact
shapes, dark readable contours, sparse intentional pixel clusters and opaque
pixel edges. Copy the paintings' colour relationships, not their detail density.
A soft high-resolution sprite does not become a style match through recolouring.

`spritePlan` in the JSON records the selected default sprite + target-colour
combinations, plus named variants for specific settings. The defaults are the
current chunky grass tuft, red spotted mushroom, rounded woodland bush, open broadleaf
tree, `pillar_c.png` for the grave marker and `pot.png` for the intact clay pot.
`pot_smashed.png` is the opened state of that same lootable container, not loose
ruins decoration. Their target palettes are declared as
palette IDs, so swatches and annotations stay in sync. Zone proposals cover dry
foliage, woodland details, caves, restored gardens, sacred places and ruin debris.
The gallery marks unselected candidates separately and identifies contour work
where recolouring alone is insufficient. Original thumbnails remain unchanged;
the browser renders proposed RGB palette swaps beside them using
`tools/nature_recolour.js`. Material groups separate foliage/caps from bark/stems;
colour ramps are assigned by source brightness. Dimensions and alpha are
preserved exactly. The six defaults are exported to `assets/Objects/Rustic/` with
`tools/apply_nature_recolours.py`, including matching growth and broken-pot
states. The clipped hedge is used on hedged lanes; formal-garden / residential /
commercial zone use remains an alternative. No optional recolour variants are enabled, and
the game has no seasons.

Generate both linked review pages and palette exports (Pillow and Node required):

```sh
python3 tools/preview_art_direction.py --output /tmp/art-direction
python3 tools/preview_nature_candidates.py \
  --reserve-root /home/claude/terracart/unused_art --output /tmp/art-direction
```

Outputs include a self-contained palette page, the full candidate gallery, JSON,
a PNG swatch chart, and a GPL palette importable by pixel-art editors. No image
service or generation is involved. Candidates show original source pixels alongside proposed recolours; the
assessments identify state-specific uses and any additional contour work.

## Active map-art audit

`map-audit-ground.json`, `map-audit-structures.json` and
`map-audit-interactables.json` audit 109 environmental art families.
Entries carry their actual placement producers, current source frames, palette
recommendations and available-library alternatives. Shared states are grouped;
unused registry definitions, actors and inventory-only items are excluded.
Campfires are outside this generated-placement audit; crops and the scarecrow
are explicitly included at the user’s request. Crops get a small 5.25% lightness
lift across their growth art, retaining their colours and outlines. Local OSM feature counts are source evidence, not final spawn counts.

Prevalence order is a qualitative estimate from terrain coverage and placement
rules; no representative post-filter map census was available. Eight families
(7.5%) have proposed zone-specific alternatives. None are seasonal and none
are installed by the dashboard. The clipped hedge is active on hedged lanes and remains a candidate for Formal
Garden and residential/commercial bush placements.

```sh
python3 tools/preview_map_art.py \
  --reserve-root /home/claude/terracart/unused_art --output /tmp/map-art-audit
```

The output is a self-contained searchable HTML dashboard plus `audit.json`.
`tools/export_map_art_painters.js` embeds the shipping terrain, road and building
painters with sample geometry. Existing texture states and proposed colour
studies are labelled separately. Per-material colour transfer preserves source
geometry and readable shading rather than forcing every sprite through one filter. The selected apple treatment provides the colour, saturation and shading reference
for all tree, bush and grass candidates, including the clipped hedge. Their foliage
uses continuous shade mapping while bark and fruit retain their identity.
Bushes and clipped hedges use half the initial foliage adjustment; other flora
(including the selected apple treatment) is eased back by 25%. Grass retains
the approved full-strength treatment. The
scarecrow preview strengthens its existing contour and shading. Flowers get
only a 7.5% palette, desaturation and lightness adjustment. Strong ground
patterns have 20% less contrast; the forest base is slightly darker. Fort and
castle floors move 20% toward their original colours. Lava is an exception:
keep its original fiery base and bright animated highlights. Restored building
sprites use only a 10% palette/desaturation/lightness pass; mushrooms use 7.5%.
The stone votive gets a 12% lightness lift; ladders and barrels receive a 20%
colour-only nudge. Churchyard ground regains a little saturation, and cave
floor/wall bases sit halfway between the original and previous proposals.
Tune saturation and contrast per sprite: readability matters as much as matching
the palette. Keep the helpful olive correction to bright green trees without
flattening their leaf shading. The original chest and unchanged well provide
contrast references beside the proposed art.
The rejected ground tileset alternatives remain in source details: the actual
procedural materials are better suited to arbitrary map polygons.

Mushroom Grove uses the red giant mushroom (32 × 48 frame 2) from
`art-source/sprites/Fantasy Mushroom.png`, copied unchanged to the Wilderness
assets. These are shrub interactables with the same harvesting and wood drops;
ordinary shrubs elsewhere retain their woodland bush art.

## Sandbox comparison

`tools/preview_sandbox_art.py` captures matched current/candidate views of the
actual sandbox in an isolated browser. It freezes time and actors, uses neutral
lighting, and stitches native 32px cells with a two-cell margin. No shipping
textures or user saves are modified. Candidates share the dashboard's gentle colour transfer and lighter,
moderately desaturated ground. Ground and water retain more of their original colour and depth, with the
previous lightening and desaturation reduced by approximately 25%. The original closed chest is the shading reference; the
new chest candidate keeps its shape with the original chest’s warm wood and
muted metal colours at half strength, preserving all eleven source shades. Clipped hedges are limited to residential/commercial shrub cells.

```sh
CHROMIUM_PATH=/path/to/chromium python3 tools/preview_sandbox_art.py \
  --url http://127.0.0.1:8767/ \
  --reserve-root /home/claude/terracart/unused_art \
  --output /tmp/sandbox-art-comparison
```

Outputs include before/after PNGs, a static comparison, capture metadata and an
interactive comparison page. The sandbox has no vector roads/building polygons
or assigned zone motifs, so the capture uses its intended tiled building mode.
It demonstrates candidates present in that layout, not every audit entry.
