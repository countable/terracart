# Rogue Adventure village renderer study

This opt-in fixture recreates the flat portion of the supplied village reference
through the game's actual Phaser/WebGL renderer, `drawCells`, `drawObjects`, world
projection, pooled sprites and existing lighting. It does not modify production
world generation, house definitions, tree art or street-lamp placement.

The 630×360 capture omits promotional badges/footer, cliff elevation, the elevated
wood platform and the bench. Three wall lanterns are attached to house facades;
the unsupported fourth reference lantern is omitted. Native 16px source tiles
render at 2× with nearest-neighbor sampling; subtle leaf flecks retain 1× native pixels. Ground transitions reuse the jungle
study's 16-mask dual-grid autotiler. Asset source rectangles and any assembly
recipes are recorded in `assets.json` and extracted by `build_assets.py`.

The three houses are existing `house` objects with isolated source-sprite
appearance overrides. There is no matching existing authored RA village building
in the registry, so this study does not claim to reuse matching authored geometry.
Trees likewise keep ordinary tree semantics. The central stone-rimmed RA hatch
is an existing `staircase` object with `dir: 'down'`, `depth: 0`; its original
interaction handler routes to `changeDepth(+1, sameObject)`. Capture asserts that
handler dispatch with a temporary method spy, without changing scene depth. This
checks the interaction contract, not a full underground traversal.

Reproduce from repository root (game server running on port 8000):

```sh
python3 tools/village-study/build_assets.py --out /tmp/ra-building/render
cp tools/village-study/assets.json /tmp/ra-building/render/assets.json
OUT_DIR=/tmp/ra-building/render node tools/village-study/capture.cjs
node tools/jungle-study/autotile.test.cjs
```

The capture writes `baseline.png`, `village.png`, identical paired object-position
snapshots, `fixture.json`, `renderer-audit.json` and `errors.json`. Assertions check
actual WebGL output, no browser errors, unchanged paired geometry, native autotile
registration and descent interaction dispatch. Browser-only source routes isolate
viewport and lighting adjustments. The game itself does not load these files.
