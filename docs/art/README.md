# Sprite art direction

The natural and unrestored world uses muted post-apocalyptic rustic colours.
Players, restored assets, and special or sacred places may deliberately introduce
cleaner, brighter or cooler colours. Colour signals care and significance; the
crisp chibi retro pixel style stays consistent in every state.

`art-direction.json` owns the working palette, colour provenance, state rules,
candidate assessments and proposed ruins roles. These are review targets, not a
runtime palette filter. No sprites or spawn rules are changed by this document.

Approved world-art replacements are recorded by review ID and destination frame
in `assets/Objects/Approved/world-art-imports.json`. The source crops under
`assets/Objects/Approved/Sources/WorldArt/` retain the generated pixels before
review downsampling, with original sheet hashes and crop coordinates in that
manifest. Run `python3 tools/import_world_art_candidates.py` after rebuilding a
legacy sheet. It replaces only approved frames, preserves sheet geometry and
all neighbouring pixels, and updates the Approved manifest hashes. The map-art
baker calls this automatically after its older recolour recipes. The approved
wood log fills all three quantity frames so the world and inventory stay aligned.

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
tree and `pot.png` for the intact clay pot. Grave markers now use the approved zone-object atlas.
`pot_smashed.png` is the opened state of that same lootable container, not loose
ruins decoration. Their target palettes are declared as
palette IDs, so swatches and annotations stay in sync. Zone proposals cover dry
foliage, woodland details, caves, restored gardens, sacred places and ruin debris.
The gallery marks unselected candidates separately and identifies contour work
where recolouring alone is insufficient. Original thumbnails remain unchanged;
the browser renders proposed RGB palette swaps beside them using
`tools/nature_recolour.js`. Material groups separate foliage/caps from bark/stems;
colour ramps are assigned by source brightness. Dimensions and alpha are
preserved exactly. The five remaining defaults are exported to `assets/Objects/Rustic/` with
`tools/apply_nature_recolours.py`, including matching growth and broken-pot
states. Shrubs have two appearances: the basic bush and the approved cut hedge at 80%
of its former residential display size. Both share shrub mechanics, and neither
receives biome tint. The cut hedge has a soft contact shadow behind its lower third.
Timber trees use maple or pine sprout, young and mature frames at one scale per
species; their size classes retain their harvest tiers and yields. Biomes do not tint sprites. Long grass keeps its standard art and wetland reeds context; mushrooms use the same surface cap in Mushroom Groves and retain their two cave caps. The game has no seasons.

Generate both linked review pages and palette exports (Pillow and Node required):

```sh
python3 tools/preview_art_direction.py --output /tmp/art-direction
python3 tools/preview_nature_candidates.py \
  --reserve-root ~/.artifacts/terracart-art/unused_art --output /tmp/art-direction
```

Outputs include a self-contained palette page, the full candidate gallery, JSON,
a PNG swatch chart, and a GPL palette importable by pixel-art editors. No image
service or generation is involved. Candidates show original source pixels alongside proposed recolours; the
assessments identify state-specific uses and any additional contour work.

## Applied map art

The player's Home is a timber travelling wagon with an arched moss-green roof,
iron straps, wooden spoked wheels and a copper stovepipe. Its sprite lives in
`assets/Objects/Home/home_wagon.png`; `house_trailer` remains the shared texture
key for the map and Home icon. The 108×75 frame preserves the previous building
scale. Opening, recovery, supplies and selling paintings share this design;
the wooden workshop interior already matches. Keep the survivor's face hidden
inside the raised brown hood in these scenes.

All approved map-audit proposals are installed. `assets/Objects/Approved/manifest.json`
records source hashes, recipes and output hashes; original source assets remain
available. The asset registry and map/inventory icon sheets use the same approved
frames. Baked unclaimed buildings bypass the old runtime wash to keep their sludge
and weathering visible. Chapel, macro POI booths, actors and other retained art
remain unchanged.

The sprite contexts are wetland-edge reeds and Burned Row stakes. Loose rocks in Stone Garden, Broken Masonry, Flint Field, Broken Depot, Seep, Work Yard, Black Ring and Pirate Cove use their approved contextual frames in the existing zone-object atlas. Ordinary loose rocks, planted rock crops and inventory icons keep their standard art. `assets/Objects/ZoneVariants/approved-additions.json` records these appended frames and their approved sources; `tools/pack_selected_zone_art.py` preserves them during regeneration. Shrubs use the basic bush or the smaller cut hedge, with the same mechanics. Ancient Grove and Silent Circle also use their
approved ground accents. Context selection preserves placement IDs, quantities,
loot and interaction types.

Rebuild the deterministic sprite exports from original sources (Pillow, Playwright,
Node and Chromium required):

```sh
CHROMIUM_PATH=/path/to/chromium python3 tools/apply_map_art.py
node tools/sprite_audit.js
```

`src/textures.js`, `src/building_overlay.js` and `src/road_overlay.js` own the
installed generated-material colours. The audit dashboard reads baked sprite
outputs directly, so no second colour treatment is applied. The sandbox comparison
captures the installed game against the preserved before image; pass `--baseline`
when generating into a new output directory after application.

Ground-pattern attenuation is now halfway back toward its pre-recolour strength
(for example forest 0.50 → 0.75 and rock 0.80 → 0.90), following gameplay review.
Building footprint floors, wall faces and restored castle masonry likewise use
the midpoint of the original and approved palettes. Unclaimed footprint material
receives a 5% treatment instead of 10%. Terrain base colours and sprite sheets
retain their approved treatment. These values live in the shared runtime painters.

## Active map-art audit

`map-audit-ground.json`, `map-audit-structures.json` and
`map-audit-interactables.json` audit 110 environmental art families.
Entries carry their actual placement producers, current source frames, palette
recommendations and available-library alternatives. Shared states are grouped;
unused registry definitions, actors and inventory-only items are excluded.
Campfires are outside this generated-placement audit; crops and the scarecrow
are explicitly included at the user’s request. Crops get a small 5.25% lightness
lift across their growth art, retaining their colours and outlines. Local OSM feature counts are source evidence, not final spawn counts.

Prevalence order is a qualitative estimate from terrain coverage and placement
rules; no representative post-filter map census was available. Eight families
(7.3%) have installed context art or ground accents. None are seasonal. The clipped
hedge applies to Formal Garden and residential/commercial shrub placements.
Broken Masonry uses dedicated rubble art; ordinary wild rockfruit retains its own sprite.

```sh
python3 tools/preview_map_art.py \
  --reserve-root ~/.artifacts/terracart-art/unused_art --output /tmp/map-art-audit
```

The output is a self-contained searchable HTML dashboard plus `audit.json`.
`tools/export_map_art_painters.js` embeds the shipping terrain, road and building
painters with sample geometry. Existing texture states and proposed colour
studies are labelled separately. Per-material colour transfer preserves source
geometry and readable shading rather than forcing every sprite through one filter. The selected apple treatment provides the colour, saturation and shading reference
for all tree, bush and grass candidates, including the clipped hedge. Their foliage
uses continuous shade mapping while bark and fruit retain their identity.
The default bush uses its original green source with the selected 72% apple-led
treatment and 10% softer interior contrast, preserving its dark contour. Clipped
hedges retain their separate half-strength adjustment. Other flora
(including the selected apple treatment) is eased back by 25%. Grass retains
the approved full-strength treatment. The
scarecrow preview strengthens its existing contour and shading. Flowers get
a 10% palette shift with 7.5% desaturation and lightness adjustments. Strong ground
patterns have 20% less contrast; the forest base is slightly darker. Fort and
castle claimed floors move 20% toward their original colours. Unclaimed
buildings and footprints retain the original weathering and visible sludge,
with only a gentle 10% palette/lightness treatment. Lava is an exception:
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

Mushroom Grove and Mushroom Lane giant mushrooms use the approved red cap
in `assets/Objects/ZoneVariants/approved-24.png` (24 × 24, frame 40).
Axe harvesting gives one wood and one mushroom. The same frame represents
ordinary forage in these two variants, with ordinary mushroom rewards.
Ordinary shrubs retain only the basic bush and smaller cut hedge.
Rockfruit stone
pixels use the approved ore rocks’ grey palette across growth and inventory
frames, including player-placed rocks; foliage and sprite alpha are preserved.
Carnivorous plants use a muted olive multiply tint from their shared enemy-roster
row, so gameplay, zone previews and the foliage audit agree.

## Sandbox comparison

`tools/preview_sandbox_art.py` captures matched before/applied views of the
actual sandbox in an isolated browser. It freezes time and actors, uses neutral
lighting, and stitches native 32px cells with a two-cell margin. The capture does not modify
shipping textures or user saves. Installed art uses the dashboard's gentle colour transfer and lighter,
moderately desaturated ground. Ground and water retain more of their original colour and depth, with the
previous lightening and desaturation reduced by approximately 25%. The original closed chest is the shading reference; the
new chest candidate keeps its shape with the original chest’s warm wood and
muted metal colours at half strength, preserving all eleven source shades. Clipped hedges are limited to residential/commercial shrub cells.

```sh
CHROMIUM_PATH=/path/to/chromium python3 tools/preview_sandbox_art.py \
  --url http://127.0.0.1:8767/ \
  --reserve-root ~/.artifacts/terracart-art/unused_art \
  --output /tmp/sandbox-art-comparison
```

Outputs include before/after PNGs, a static comparison, capture metadata and an
interactive comparison page. The sandbox has no vector roads/building polygons
or assigned zone motifs, so the capture uses its intended tiled building mode.
It demonstrates installed art present in that layout, not every audit entry.

## Bush alternatives and texture seams

`tools/preview_bush_options.py` renders eight bush studies from
`bush-options.json`: the shipped woodland bush, gentler recolours, several
chunky wild-bush alternatives and the context-only clipped hedge. This gallery
marks the original green bush with 72% treatment as the selected proposal.
Nut plants use a brighter olive treatment;
rockfruit retains its shape while leaning toward the actual ore-stone colours.
Forest spots use half-strength overlays; sand marks are 15% softer. Wetland
marsh retains its original colour balance and full texture with a small base
lightness lift. Golf fairway is unchanged. Orchard floor is 20% closer to its
original colour than the earlier proposal; sports pitch pattern strength is 88%
of original. Seam fixes live in the runtime
terrain painters so randomly adjacent variants share compatible boundaries.

The cut hedge uses the same muted green direction as the pine: its baked
recipe shifts foliage hue 12 degrees toward pine, then reduces saturation
and brightness by 10% each. Its silhouette, alpha and ground shadow stay intact.

The pine foliage treatment includes cyan shadows that the general green mask
missed, and warms mint highlights at the same shading luminance. Other flora
strengths are unchanged.


Pirate Cove's active shipwreck shrine uses the unchanged generated PNG from
`docs/art/shipwreck-shrine-draft.png`, copied to `assets/Objects/Beach/`.
`SpriteLayout.SHIPWRECK_SHRINE_ART` fits its original aspect ratio inside the
reserved 3 × 3 cells. It remains one daily shrine, not extra rewards.
The Beach folder's driftwood and beach rock come from Core Systems Asset
Factory's Verdant Props 16×16 pack; its included license permits use in games.
Beach rock and driftwood alternates are retired; pickups use their standard art
everywhere. Their item identities and inventory icons stay wood and rock. The
existing cowrie shell colors remain.


## Foliage and rock comparison

The dedicated comparison exports current runtime appearances, including timber
sizes and growth frames, fruit-tree overlays, both shrub looks, mushrooms,
plain/ore rocks, loose stone, crop stages, plant enemies and
authored context art. Fallen wood uses only look 2 for every quantity. Source sheets are embedded unchanged; approved-output provenance is
not a claim that every frame matches the motif. Pin appearances to compare at a
shared game scale, or switch to sprite detail for colour inspection.

```sh
python3 tools/preview_foliage_audit.py --output /tmp/foliage-audit
```

The self-contained HTML and `audit.json` come from `export_foliage_audit.js`, which
uses the shipping object resolver and crop-render branch. The audit omits light,
fog, shadows and tool-lock fading. It makes no game-art changes.


## Quarry crystal cluster

`assets/Objects/Wilderness/crystal_cluster.png` is the unchanged 16×16
`crystal_cluster` tile from Verdant Props (Core Systems Asset Factory, 2026).
The pack licence is preserved beside it. Mineral-rock records with
`deposit: 'crystal'` use this cluster at the shared rock scale and measured
cell-centred seating; ordinary stone and ore artwork are unchanged.

## Castle families

`src/castle_styles.js` owns four stable material families: Citadel (cool pale
stone), Weathered Ruin (sage limestone and surviving broken battlements),
Intact Bastion (warm sandstone, no guards), and Old Archive Court (warm stone
with timber rampart tops). There is no Mended Court family. The Citadel name
has no “dark” qualifier: darkness means an unclaimed, weathered condition in
every family, while restoration brings back clean, brighter materials.

Towers, tiled walls, polygon walls and courtyard floors resolve the same
building owner key through `CastleStyles.get(key, claimed)`. Its numeric
palettes already include the condition treatment; never apply the general
unclaimed building wash to them again. Castle wall sections use ordinary object
depth at their lowest masonry point. The 32×48 towers sit at the bottom of their
cell; their bottom ten pixels fade from 30% to full opacity to soften joins.
Archive ramparts keep a stone base and face beneath
their wooden crest; the Ruin's uneven crenellations echo its damaged tower.

Weathered Ruin courtyards contain a few broken fluted columns, made from the
existing pillar's lower shaft and plinth. `CastleStyles.columnSites` scatters
these deterministically inside the source ring (about four in a 5×8-cell
court), away from walls and one another. Both floor modes share these sites
and the same stone palette. They are decorative, with no collision or tap
targets. Unclaimed masonry retains roughly 80% of restored brightness;
courtyard floors retain roughly 89%, providing extra contrast against walls.
Each family has its own dark skull banner: black for Citadel and
Ruin, grey with a shield for Bastion, and brown with a book for Archive.

The Ruin also has sparse missing paving, fine cracks and small rubble marks,
with chips and missing sections along its battlements. Damage is seeded and
cached in the existing floor and wall artwork; it creates no world objects,
collision changes or animated effects. Restoration changes its palette while
preserving the damage, and the other castle families keep their intact surfaces.
Floor damage uses at most eight 96×96 textures (four patterns in two condition
palettes), lazily baked and shared by all ruins. Tiled floors reuse their
existing texture pool; polygon floors and wall chips use their existing caches.
