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
            interactables.js  declarative tap-driven world-object registry
            items.js / crops.js / loot.js / rarity.js / shops.js  game data + economy
            inventory.js / energy.js / home.js  pure cores extracted from app.js
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

## Game modes

The How-to-play card asks a new save which game it wants, once:
**Easy mode — enable tutorial** (the starter ladder, the supply crates, a
pest-free home until the first harvest; farming and exploring are the loop)
or **Hard mode — no tutorial** (a $20 purse, traders at 1.5× the markup, Home
paying 60% for a haul, enemies at 1.5× HP and 2× damage in 1.5× the packs,
twice the surface slimes and no pest amnesty; roadside stands, the elite rate
and the kill bounty's per-HP rule are untouched, so a tougher foe simply pays
more). Every number that differs lives in `src/difficulty.js` as a
multiplier over the easy value — easy is the game exactly as it was — and each
consumer reads it at the site that owns the base number. The mode is per save
(`save.mode`) and kept; `test/node/difficulty.test.js` pins the table and the
consumers.

## Source of truth

Feature scope and design decisions live in **[docs/spec.txt](docs/spec.txt)**. Read it
first. `docs/FUNCTIONS.md` is a generated inventory of every function across `src/`.

## Conventions

See [CLAUDE.md](CLAUDE.md) for repo working rules. Notably: the `<script>` list and
cache-bust `?v=NN` values in `index.html` are edited by hand — bump the version when you
change a module so clients pick up the new file.
