# Painting sources

`assets/art/` contains the paintings currently used by the game. Its scene
paintings supply the inline placeholders in `src/art_thumbs.js`.

- `raw/` preserves the full-resolution generated PNG masters (64 at the time
  of this cleanup). They are ignored by Git because of their size. Keep a
  separate backup: rerunning an image prompt cannot reproduce the same image.
- Street and influence-zone paintings remain in `assets/art/`: the street and
  zone story tables on `main` use them, along with macro/interactable scenes.
- The generated coin goes directly to `assets/Icons/coin.png`. There is no
  duplicate outbox in `assets/art/`.

`tools/gen_story_art.js` keeps the prompts and exports paintings to `assets/art/`,
including during `--reprocess`. For example:

```sh
# Re-export a runtime painting from its existing local master, without API use.
node tools/gen_story_art.js --reprocess street_hedgerow

# Generate a missing runtime painting (uses the image API).
node tools/gen_story_art.js kind_menu

# Refresh runtime-only scene thumbnails after moving or editing paintings.
node tools/art_thumbs.js
```

After changing paintings, regenerate the thumbnails, then run cache busting and
the node suite as described in `CLAUDE.md`. Check both direct `art` references
and `story` stems in data tables before treating a painting as unused.
