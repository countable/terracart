# Art sources

Keep original paintings and unused sprite packs outside the checkout. Only
runtime exports and inputs required by repository tools belong in `assets/`.

The default archive is `~/.artifacts/terracart-art/`. Set `TERRACART_ART_ROOT`
to an absolute path to use another location. Python preview tools also accept
`--reserve-root` for the unused-pack directory.

- `art-source/paintings/raw/`: full-resolution generated PNG masters.
- `art-source/sprites/`: former mushroom sheet and its provenance notes.
- `unused_art/`: unused packs, including their original license files.
- `assets/art/raw/`: legacy painting originals preserved during cleanup.
- `archive-manifest.json`: relative paths, sizes and SHA-256 hashes at migration.

The archive is local and is not included in a clone. Keep a separate backup;
rerunning a prompt cannot reproduce the same painting. Runtime play and tests
do not require the archive. Candidate previews and painting reprocessing do.

```sh
# Re-export an existing master without an API call.
node tools/gen_story_art.js --reprocess street_hedgerow

# Inspect available originals and unreferenced runtime candidates.
node tools/asset_inventory.js
```

`gen_story_art.js` exports runtime paintings to `assets/art/` and the generated
coin to `assets/Icons/coin.png`. It refreshes scene thumbnails after processing.
After changing runtime paintings, run cache busting and the node suite as
described in `CLAUDE.md`. Check both `art` references and `story` stems before
removing a runtime painting.

## Story-panel style references

Every new or regenerated story panel must include an approved existing panel
showing the Hood as an explicit image reference. Select it from the story-panel
presentation with the user; record its asset path and hash with the prompt.
Include scene-specific references as well when preserving a booth, prop or
composition. Do not replace the visual reference with prose describing a style.

The approved references are `assets/art/cave_first.webp` for Hood's appearance,
`assets/art/npc_orrin.webp` for pixel illustration treatment, and the original
`assets/art/restore_house.webp` for outdoor skies, landscape and warm palette.
The original `assets/art/street_bandit.webp` supplies the restricted palette,
deliberate pixel clusters and stepped shading; prefer its simpler pixel style
over the more finely textured roadside-wagon remake.
For outdoor scenes include that third reference explicitly. Keep rich warm
colour while making time of day ambiguous; do not default to gray or desaturation.
Their old lower text zones are not part of the reference style.
New story/event art targets 4:3 landscape with all copy below
the image in the dialog. Review a deliberate crop before regenerating an
otherwise suitable painting. Keep the first two opening panel formats (compass
and nightmare, both animation frames each); exclude the book-reading UI background.

## Paired booth paintings

The introduction is the visual reference for its transaction painting. Edit
that image with an explicit image reference. After-use panels zoom in on the
transaction object: bed, gift, medicine, book, coins, relic, supplies or practice
weapon. Preserve its design and materials, with cropped hands only where they
clarify the exchange. Faces and full booth views belong in introductions. Both stages use subdued, weathered light and reserved faces;
retain the introduction's painterly realism rather than switching to chibi.

Full edit prompts and reference provenance are recorded in
`docs/art/booth-story-art-prompts.json`. For the inn, the completed action shows
the hooded player resting in the existing bed while pale light swirls away.
`gen_story_art.js` retains the scene/export definitions; its text-only generator
must not be used to recreate either half of these established pairs. Use the
built-in image editor with the recorded visual reference, or `--reprocess` to
export an existing master without changing the painting.

## Opening compass slide

`story_compass` and `story_compass_frame2` are generated, matching portrait
paintings based on the selected living-silver HUD mockup. The first shows the
compass in grass beside a residential sidewalk; the second shows a gloved hand
lifting it. The camera and neighbourhood remain aligned for the one-time fade.
See [opening-compass-prompts.json](opening-compass-prompts.json) for masters,
full prompts, source hashes and WebP export settings. The older
`tools/art/reskin_story_compass.py` is not part of this asset pipeline.

## Compass rim

`assets/ui/compass/gold-rim.svg` owns the fine ring and engraved marks.
`assets/ui/compass/gold-fittings.png` supplies the north flourish, shared cardinal
fitting and diagonal bead, generated from the approved celestial gold-bead concept
at `~/.artifacts/compass-art-options/celestial-gold-beads.png` with the built-in
image tool. The generated HUD painting is a visual reference, not a texture.
The PNG retains its original alpha; CSS selects the three atlas regions without
resampling the master. Source, prompt and rectangles are recorded in
[compass-rim-art.json](compass-rim-art.json). Letters remain live HUD text so they
stay upright as the compass turns. See the geometry in
[the presentation guide](../design/presentation.md).

## Treasure dialog paintings

The X discovery, barrel, crate and seven chest-tier paintings show the concealed
brown-hooded survivor opening a smaller container. Match the warm amber pixel
treatment of `book_read` and `fire_first`; the first story panel is intentionally
a different style and is not a style reference. Containers retain their tier
materials and show only light inside; reward icons and text supply the contents.
[treasure-paintings.json](treasure-paintings.json) records generated masters,
source hashes, final built-in imagegen prompts, style references and export settings.
The scene definitions in `tools/gen_story_art.js` preserve the same composition intent.

## Book-reading page

`assets/art/book_page.webp` is the blank half-book background for live reading
text; the library list and non-book scenes keep their existing paintings.
The approved master is `~/.artifacts/dialog-style-exploration/book-page.png`;
`book-reading.png` beside it records the panel composition.

## Existing square scene masters

The 30 reference-edited scenes in `gen_story_art.js`'s `REFERENCE_SCENES`
export from archived square PNG masters at 512×512. Fill the frame with a
complete scene; no lower black field is reserved for text. The generator
refuses text-only regeneration for these masters and all paired booths.
Use an explicit reference image edit, or `--reprocess` an existing master.

After direct runtime asset edits, run `node tools/art_thumbs.js`. It preserves
image aspect in the thumbnails and mosaic cuts and emits `ART_ASPECTS` for
layout before the full painting loads. Legacy 11:14 paintings remain supported.

## Rounded building alternatives

The sixteen-frame rounded building sheet ships unchanged at
`assets/Objects/RoundedBuildings/buildings.png`. Its source, checksum, original
96px-cell rectangles and ground anchors are recorded in
[rounded-buildings.json](rounded-buildings.json). `ASSETS.rounded_buildings`
registers tight 64px house and 80px fort frames without cutting visible pixels.
All legacy building PNGs remain in place; `?buildingArt=legacy` selects them.
The renderer's existing scale and placement rules are unchanged; see
[building artwork selection](../design/rendering.md#rounded-building-artwork).
