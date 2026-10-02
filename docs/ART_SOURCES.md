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

## Paired booth paintings

The introduction is the visual reference for its transaction painting. Edit
that image with an explicit image reference, changing only the completed
transaction. Keep the same keeper, proportions, view, awning, sign, fixtures,
and background. Both stages use subdued, weathered light and reserved faces;
retain the introduction's painterly realism rather than switching to chibi.

Full edit prompts and reference provenance are recorded in
`docs/art/booth-story-art-prompts.json`. For the inn, the completed action shows
the hooded player resting in the existing bed while pale light swirls away.
`gen_story_art.js` retains the scene/export definitions; its text-only generator
must not be used to recreate either half of these established pairs. Use the
built-in image editor with the recorded visual reference, or `--reprocess` to
export an existing master without changing the painting.
