# Art sources

Keep original paintings and unused sprite packs outside the checkout. Only
runtime exports and inputs required by repository tools belong in `assets/`.

The default archive is `~/.artifacts/terracart-art/`. Set `TERRACART_ART_ROOT`
to an absolute path to use another location. Python preview tools also accept
`--reserve-root` for the unused-pack directory.

- `approved-story-art/`: approved full-resolution story masters.
- `story-style-references/`: unchanged approved visual references.
- `art-source/paintings/raw/`: remaining masters for special panels and other art.
- `art-source/sprites/`: former mushroom sheet and its provenance notes.
- `unused_art/`: unused packs, including their original license files.
- `assets/art/raw/`: remaining legacy originals for other art.
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

The user-approved set is archived at
`~/.artifacts/terracart-art/story-style-references/`. Exact paths, source
provenance, dimensions, roles and SHA-256 hashes are tracked in
[story-style-references.json](story-style-references.json):

- `cave.png`: edited original cave, 4:3 and slightly taller Hood.
- `sundries.png`: approved painterly shop with the original close framing.
- `outdoor_work.png`: approved working-without-tools outdoor treatment.
- `grove_shrine.webp`: original shrine unchanged; disregard its lower copy zone.

Supply these as image references, not just prose descriptions. Include the
original target painting for scene identity and camera framing, and record the
actual reference paths/hashes with each prompt. The art-direction brief owns
the style, palette, framing and concealment rules. Earlier unselected review
remakes are not approved references or live replacements.

The masters are outside the checkout, like other archived source art. Preserve
these exact files; regeneration is not a reproducible substitute. Crop a good
original before repainting when only aspect ratio needs changing. The cave's
atmospheric dark edges are scene-specific, not a text field or global vignette.

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

Treasure paintings keep Hood concealed and use a restricted palette with
soft painterly pixel clusters. The seven chest-tier paintings use the approved
`story_wrecks` reference: chests must have the same stylized treatment as their
surroundings, without sharp product-render detail. Containers retain their tier
materials and show only light inside; reward icons and text supply the contents.
The final masters, prompts and runtime hashes are recorded in
[approved-story-art.json](approved-story-art.json).

## Book-reading page

`assets/art/book_page.webp` is the blank half-book background for live reading
text; the library list and non-book scenes keep their existing paintings.
The approved master is `~/.artifacts/dialog-style-exploration/book-page.png`;
`book-reading.png` beside it records the panel composition.

## Approved story paintings

[approved-story-art.json](approved-story-art.json) owns the 171 final 4:3
paintings: 135 original crops and 36 exports from 35 approved generations. Full-resolution
masters live in `approved-story-art/` under the archive root. These supersede
older raw masters and review rounds. The first two opening panels use 2:3 portrait frames; nightmare masters
are recorded separately in `opening_frames`. The book page and title splash
retain their special-purpose shapes. Copy belongs below the art; no text zone is baked in.

`node tools/gen_story_art.js --reprocess <key>` exports an approved master
losslessly at its recorded runtime width, without another palette conversion.
A missing approved master is an error, never a fallback to an older image.
For new edits, follow [the art direction brief](art-direction-brief.md) and use
the unchanged masters listed in [story-style-references.json](story-style-references.json).
Story illustrations intentionally differ from the main game's sprite style.

Run `node tools/art_thumbs.js` after direct runtime edits, followed by the
cache-bust tool and node suite. Thumbnails preserve the painting's aspect;
`ART_ASPECTS` supplies layout dimensions before the full painting loads.
Publish the current export grid with `python3 tools/build_approved_story_gallery.py`.

The opening wrecks scene holds its approved painting across both fade frames,
so the transition cannot restore the earlier, shorter player proportions.

## Rounded building alternatives

The sixteen-frame rounded building sheet ships unchanged at
`assets/Objects/RoundedBuildings/buildings.png`. Its source, checksum, original
96px-cell rectangles and ground anchors are recorded in
[rounded-buildings.json](rounded-buildings.json). `ASSETS.rounded_buildings`
registers tight 64px house and 80px fort frames without cutting visible pixels.
All legacy building PNGs remain in place; `?buildingArt=legacy` selects them.
The renderer's existing scale and placement rules are unchanged; see
[building artwork selection](../design/rendering.md#rounded-building-artwork).
