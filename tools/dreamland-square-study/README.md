# Dreamland village-square renderer hooks

The supplied reference is **Fantasy Dreamland Reborn Village**, not Rogue
Adventure. This prototype selects installed source pixels; it does not recolor
RA or paint the reference image over a map.

The normal game now supports `http://localhost:8000/?headingUp=false&deepforest=on&artTrial=dreamland`. Prefer that URL for playtesting. Production artwork is bundled under
`assets/ArtTrials/DreamlandTerrain/`; rebuild it with the builder
`--out assets/ArtTrials/DreamlandTerrain`.

`terrain-hook.js` is the original isolated proof of the same `RATerrainTrial` API, enabled only for
`?artTrial=dreamland`. `capture-geographic.cjs` browser-routes it into that slot
and routes a small road-source extension. The capture uses the normal MVT
loader, spawn pass, generated terrain ring, vector roads and Phaser renderer.
No authored fake map is installed. Runtime integration now lives in the shared module; the browser route remains a reproducible isolated proof.

## Source roles

- Grass/residential/park: FDR_Ground_Tiles, first lime grass bank.
- Forest/orchard: muted green grass bank, keeping current tree artwork.
- Farmland/wetland: native plain or lightly stippled earth; no decorative props.
- Sand: pale sand bank.
- Water: first FDR_Water_Tiles water/stone-bank frame, without elevation.
- Civic/commercial/industrial: authored pale stone on grass.
- Ordinary street/path paving: alternating cracked and split slabs when unrestored, intact slabs when restored, from
  FDR_Village. Source pixels enlarge exactly 2x, matching 16px ground on 32px cells.
- Suppressed, burned, poisonous and other special streets retain their existing
  source selection and warnings.

`assets/manifest.json` records every source rectangle and source-file SHA256.
Fountain and hanging-lamp crops are provided as reviewed candidates for **existing
matching objects only**. They are not spawned by the hook. The reference tree
crop documents the source; live trees and the latest house scheme stay unchanged.
No fences, benches, new decorative interactables, cliffs or elevation are added.

## Road integration

At the start of `selectedRoadTile(variant, restored)` in road_overlay.js, consult
`RATerrainTrial.roadTile?.(variant, restored)` and return a non-null result.
Its cached canvas is 128px wide. The selected-material `patternFill` calls must
use `tile.width` as their period (unrestored source-in; two restored source-atop
calls). The ordinary roads' existing masks, widths, geographic phase and rails
are preserved. Do not change unrelated noise or hazard pattern periods.

All ground compositions and path enlargement bake once during scene preparation.
Per-cell rendering only selects atlas frames; there is no runtime pixel readback
or per-cell canvas allocation. A failed/missing source should fail the visual
check, not substitute invented artwork.

## Reproduce

```sh
python3 tools/dreamland-square-study/build_assets.py
node tools/dreamland-square-study/hook.test.cjs
CASES=athalmer CHECK_BOUNDARY=1 GAME_URL=http://127.0.0.1:8000 \
  node tools/dreamland-square-study/capture-geographic.cjs
```

For paired geometry assertions, place the corresponding
`athalmer-baseline-unrestored.json` from `test/ra-geographic-visual.cjs` into the
output directory (`OUT_DIR`, default `/tmp/ra-third/geo`). The test compares
terrain, underlays, object IDs and coordinates, lamp state and building models.
This is a theme match on real geometry, not a recreation of the reference town
layout. Existing gameplay lighting also makes the scene darker than the promo.
