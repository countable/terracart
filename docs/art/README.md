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
states. The clipped hedge is only a future formal-garden / residential /
commercial zone alternative. No optional recolour variants are enabled, and
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
`map-audit-interactables.json` audit 107 active environmental art families.
Entries carry their actual placement producers, current source frames, palette
recommendations and available-library alternatives. Shared states are grouped;
unused registry definitions, actors and inventory-only items are excluded.
Player-only crops, campfires and scarecrows are outside this generated-placement
audit. Local OSM feature counts are source evidence, not final spawn counts.

Prevalence order is a qualitative estimate from terrain coverage and placement
rules; no representative post-filter map census was available. Eight families
(7.5%) have proposed zone-specific alternatives. None are seasonal and none
are installed by the dashboard. The clipped hedge is reserved for Formal
Garden and residential/commercial bush placements.

```sh
python3 tools/preview_map_art.py \
  --reserve-root /home/claude/terracart/unused_art --output /tmp/map-art-audit
```

The output is a self-contained searchable HTML dashboard plus `audit.json`.
`tools/export_map_art_painters.js` embeds the shipping terrain, road and building
painters with sample geometry. Existing texture states and proposed colour
studies are labelled separately. RGB studies preserve source shape/alpha;
they do not complete recommended contour cleanup or selective material masks.
The rejected ground tileset alternatives remain in source details: the actual
procedural materials are better suited to arbitrary map polygons.
