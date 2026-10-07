# Shipwreck runtime image

`shipwreck_shrine_runtime.png` contains the approved Shipwreck A artwork in a
192×128 RGBA canvas. The map draws that canvas at 96×64 logical pixels.
`SpriteLayout.SHIPWRECK_SHRINE_ART` retains the three-cell reserved width.
The source crop, generated-sheet hash, crop coordinates and placement rectangle
live in `assets/Objects/Approved/world-art-imports.json`.

Regenerate from the repository root:

```sh
python3 tools/import_world_art_candidates.py --review ART-2026-10-05-SHIPWRECK-A
```

The importer preserves transparency, uses hard pixel edges and nearest-neighbour
scaling, and retains the reviewed base anchor. `shipwreck_shrine.png` remains the
original generated design; it is not the source of the selected replacement.
