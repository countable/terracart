# terracart

A Pokémon-Go-style farming game played on real-world map data. Mobile web first
(desktop supported), rendered with Phaser 3 over OpenFreeMap vector tiles. No build
step — `index.html` loads the source modules directly as `<script>` tags.

## Run it

Serve the repo root over HTTP (a service worker + `fetch` are used, so `file://`
won't work) and open `index.html`:

```sh
python -m http.server 8000      # then visit http://localhost:8000
```

WASD moves the player on desktop; geolocation drives it on mobile.

## Layout

```
index.html            Entry point + inline UI/CSS. Loads src/ modules in order.
sw.js                 Service worker (precache shell + cache map tiles). Must stay at root.
manifest.webmanifest  PWA manifest. icon-192/512.png are the PWA icons.

src/      Game source modules (vanilla JS, global scope, load-order dependent).
            app.js        main game/scene wiring (largest module)
            worldgen.js   procedural world from map tiles
            render.js     Phaser draw layer
            interact.js   input + interactions
            items.js / crops.js / loot.js / rarity.js / shops.js  game data + economy
            textures.js / assets.js   sprite-sheet setup + asset manifest
            mvt.js / coords.js / save.js / util.js / sandbox.js / testtools.js
vendor/   Third-party libraries (phaser.js).
assets/   Active game art the build actually loads (Character/, Farm Animals/, Icons/, Objects/).
Sprites/  Source art library (gitignored). Sprites/unused/ holds art not referenced by the game.
data/     Static data sidecars (e.g. satextract_osm.geojson).
docs/     spec.txt (source of truth for features), FUNCTIONS.md, tile_analysis.txt.
tools/    Standalone dev/debug pages + analysis scripts (not shipped).
test/     Browser test harness — open test/harness.html over HTTP.
```

## Source of truth

Feature scope and design decisions live in **[docs/spec.txt](docs/spec.txt)**. Read it
first. `docs/FUNCTIONS.md` is a generated inventory of every function across `src/`.

## Conventions

See [CLAUDE.md](CLAUDE.md) for repo working rules. Notably: the `<script>` list and
cache-bust `?v=NN` values in `index.html` are edited by hand — bump the version when you
change a module so clients pick up the new file.
