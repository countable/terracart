# Dreamland village-square renderer hooks

The supplied reference is **Fantasy Dreamland Reborn Village**, not Rogue
Adventure. This prototype selects installed source pixels; it does not recolor
RA or paint the reference image over a map.

This is a retained comparison study, not the primary terrain direction. Use
`http://localhost:8000/index.html?deepforest=on&artTrial=rogue` for current map-scale
playtesting. The [overworld scale brief](../../docs/art/art-direction-brief.md#overworld-scale-and-interaction)
keeps approximately 7m terrain and tap cells; Dreamland remains a supplemental
prop source. To inspect this older terrain experiment specifically, use
`http://localhost:8000/?deepforest=on&artTrial=dreamland`. Production artwork is bundled under
`assets/ArtTrials/DreamlandTerrain/`; rebuild it with the builder
`--out assets/ArtTrials/DreamlandTerrain`.

`terrain-hook.js` is the original isolated proof of the same `RATerrainTrial` API, enabled only for
`?artTrial=dreamland`. `capture-geographic.cjs` browser-routes it into that slot
and routes a small road-source extension. The capture uses the normal MVT
loader, spawn pass, generated terrain ring, vector roads and Phaser renderer.
No authored fake map is installed. Runtime integration now lives in the shared module; the browser route remains a reproducible isolated proof.

## Source roles

- Grass/residential/park: FDR_Ground_Tiles, first lime grass bank.
- Forest/orchard: the reference olive grass bank with deterministic native lime-edge patches and source round trees.
- Farmland/wetland: native plain or lightly stippled earth; no decorative props.
- Sand: pale sand bank.
- Water: first FDR_Water_Tiles water/stone-bank frame, without elevation.
- Civic/commercial/industrial: authored pale stone on grass.
- Ordinary street/path paving: alternating cracked and split slabs when unrestored, intact slabs when restored, from
  FDR_Village. Native 16px slabs display at 24px in the geographic game; road masks and
  32px gameplay cells are unchanged. Ground interiors likewise repeat at 24px,
  while transition masks retain their original scale. The authored reference
  fixture keeps its exact source composition.
- Suppressed, burned, poisonous and other special streets retain their existing
  source selection and warnings.

`assets/manifest.json` records every source rectangle and source-file SHA256.
`src/dreamland_objects.js` now applies the reviewed native buildings, round trees,
hanging lamps, fountain, crates and sign to existing matching objects. Rebuild
with `python3 tools/dreamland-square-study/build_objects.py`. The object manifest
records exact crops/assembly layers; no new objects spawn from this art profile.
Actual DeepForest positions, house footprint/collision geometry, growth and lamp
restoration states are preserved. Home's interior and special roles stay native
to their existing gameplay. Unrestored ordinary wrecks use native Dreamland plaster, roof fragments and timber on the existing broken 3D geometry.
No fences, benches, new decorative interactables, cliffs or elevation are added.

## Road integration

At the start of `selectedRoadTile(variant, restored)` in road_overlay.js, consult
`RATerrainTrial.roadTile?.(variant, restored)` and return a non-null result.
Its cached canvas is 96px wide. The selected-material `patternFill` calls must
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

## Authored reference map

Run `node tools/dreamland-square-study/reference-server.cjs`, then open
`http://localhost:8018/?sandbox=true&artTrial=dreamland`. This is an isolated,
explicitly fake map for reference matching, with a disposable save. Q/E and the
angle buttons rotate the normal 3D renderer; the condition button switches
wrecks/restored houses and unlit/lit lamps. The fountain uses native animated
water frames. Simulation is paused so the authored actors stay at their chosen
reference positions; the fixture forwards Q/E through `HeadingUp.keyTurn`.

`reference-layout.json` records pixel positions in the 640×360 reference frame,
source crops, the four authored building footprints, and excluded fences/benches.
The two upper houses and southwest house use closed native Dreamland 3D shells;
the southeast house is the asymmetric gable plus right wing. The lower houses
have true 3D native brick chimneys. These fixture-only proportions do not change
how normal geographic buildings fit their actual footprints.

Ground is a mosaic of installed source tiles, not the reference screenshot.
`build_reference_ground.py --reference /path/to/reference.png` reconstructs
visible ground at the measured 32px tile phase (16,4), allowing for GIF palette
quantization. The data preserves source paths and rectangles. Occluded ground
and ground beneath excluded fences/benches require explicit choices; the source
image is never drawn as a backdrop. Generic fixture props render through the
normal object specification and depth sorting, with no gameplay interactions
invented for them. Native character frames come from the original Dreamland
pack; village objects come from Dreamland Reborn.

With the server running, `node tools/dreamland-square-study/capture-match.cjs`
writes `restored.png`, `unrestored.png`, `rotated45.png`, `rotated90.png` and
`audit.json` under `/tmp/dreamland-reference-final` (or `OUT_DIR`). Each capture
is exactly 640×360. Lighting/chrome are hidden for this source-art comparison,
and animation is frozen to a declared frame; interactive review stays animated.
The check asserts real 3D models, stable object identity across restoration,
lamp condition, fountain presence, WebGL status and actual Q-key rotation.

For normal real-world geometry, run `VARIANT=dreamland RESTORED=1 CASES=athalmer
node test/ra-geographic-visual.cjs`. `node test/dreamland-objects-unit.cjs` checks
profile isolation, growth, condition, special roles and deterministic patches.
The normal game retains fruit-tree harvest cues, dead-tree variants, special
structures and existing actors; the reference map's inventory is a separate,
explicitly authored visual test. Canvas retains native collapsed/intact facade
sprites; WebGL uses the retained 3D renderer.
