# Mending Lane

A GPS farming RPG played on real-world map data: walk your neighbourhood, open
the places on it, farm, trade, fight, and restore the wrecked streets and
houses around your Home. Mobile web first (desktop supported), rendered with
Phaser 3 over OpenFreeMap vector tiles. No build step — `index.html` loads the
source modules directly as `<script>` tags.

(Formerly "Terracart" / "Pocket Acres". Save and storage keys keep the
`terracart.*` prefix on purpose, and the relay server is still
`terracart-relay`.)

## Run it

Serve the repo root over HTTP (a service worker + `fetch` are used, so
`file://` won't work) and open `index.html`:

```sh
python -m http.server 8000      # then visit http://localhost:8000
```

GPS drives the player on mobile; WASD / arrow keys (or the on-screen stick) on
desktop. `?sandbox=true` swaps the start tile for a hand-laid test world with
one of everything — see [docs/SANDBOX.md](docs/SANDBOX.md).

## Test it

```sh
node test/node/run.js           # headless suite + sprite/cache-bust/layout audits
```

See [test/node/README.md](test/node/README.md). The browser harness
(`test/harness.html`, `test/run_tests.py`) needs Chromium.

## Layout

```
index.html            Entry point + inline UI/CSS. Loads src/ modules in order.
sw.js                 Service worker (precache shell + cache map tiles). Must stay at root.
manifest.webmanifest  PWA manifest; icon-192/512.png are the PWA icons.

src/        Game source (vanilla JS, global scope, load-order dependent). The big ones:
              app.js          the Phaser scene: wiring, HUD, dialogs, per-frame update
              worldgen.js     map tiles → terrain grid, objects, creatures (seeded)
              render.js       the world draw pass (RENDER_SPEC, painter rule, seat pass)
              lighting.js     the lightmap — the only lighting pass
              interact.js     tap dispatch (TAP_HANDLERS)
              interactables.js  declarative tap-driven world-object registry
              items.js / rarity.js / loot.js / shops*.js / gear.js   catalog + economy
              combat.js / wizard.js / quests.js / trail.js / streets.js   systems
            plus small pure cores (coords, energy, inventory, crops, fog, traps,
            lairs, difficulty, …) that the headless suite loads directly.
vendor/     Third-party libraries (phaser.js — see vendor/README.md).
assets/     Game art the build loads (Character/, Enemy/, Farm Animals/, Icons/, Objects/, art/).
data/       Static data sidecars (satextract_osm.geojson and its sources).
docs/       spec.txt (design spec), QC_RULES.md (art/asset checklist), SANDBOX.md.
tools/      Dev/debug pages and audit scripts (not shipped); cachebust.js lives here.
test/       node/ (headless suite) and the browser harness.
server/     Multiplayer presence relay (Node WebSocket) — see server/deploy/README.md.
satextract/ Offline satellite/OSM feature extraction for the data sidecar.
```

## Game modes

The How-to-play card asks a new save which game it wants, once (`save.mode`,
kept for the life of the save):

- **Easy mode — enable tutorial.** The starter ladder and its green arrow, the
  supply-crate trail, and a pest-free home until the first harvest; farming,
  exploring and rebuilding are the loop.
- **Hard mode — no tutorial.** A $20 purse (against $50), traders at 1.5× the
  markup, Home paying 60% for a haul, enemies with 1.5× HP and 2× damage in
  1.5× the packs, twice the surface slimes, no pest amnesty, crows dispatched
  at your crops, garrisons in derelict buildings, and a far thicker scatter of
  roadside traps that bite harder. A kill still pays per HP, so a tougher foe
  simply pays more.

Every number that differs lives in `src/difficulty.js` as a multiplier over
the base value, read at the site that owns that value;
`test/node/difficulty.test.js` pins the table and its consumers.

## Where the rules live

- **[CLAUDE.md](CLAUDE.md)** — working rules and the QC invariants. It is the
  authority: when a note and CLAUDE.md disagree, CLAUDE.md wins.
- **[docs/spec.txt](docs/spec.txt)** — the design spec: what each system does
  and why. The code is the authority on numbers.
- **[docs/QC_RULES.md](docs/QC_RULES.md)** — the art/asset checklist.

## Conventions

See [CLAUDE.md](CLAUDE.md). Notably: the `?v=` on every `index.html` script tag
and `SHELL_VERSION` in `sw.js` are derived from file bytes — never type them;
run `node tools/cachebust.js --write` after the last edit.
