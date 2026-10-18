# Cel-shaded props

Approved study: `http://localhost:8765/bush-barrel-pot-cel-v3/index.html`.
All runtime cells are 24×24. `approved-study-24.png` retains the accepted artwork;
`export.cjs` copies its cells without resampling. `manifest.json` records the
source frame order. Palm frames 0–1 retain the previous unused pack variants;
frames 2–5 use the approved new crowns.

```sh
CHROMIUM_PATH=/usr/bin/chromium node assets/Objects/CelProps/export.cjs
```

Bushes use eight stable canopy variants. Red berry, teal poisonberry and golden
berry textures are baked from these same canopies at startup. Harvesting removes
only fruit. Brambles have four variants; clipped hedges have eight, with a broad
side facing the camera. Connected hedges use the separate cardinal atlas under
`../Hedges/`.

Barrel frames: oak, walnut, rope-bound driftwood, teal-painted, repaired charred,
copper-rimmed, mossy rain barrel, and a pair of small barrels. Pot frames:
terracotta, chipped turquoise glaze, charcoal/red, ivory/cobalt. Intact and
smashed pot atlases share their frame order.

`CONTAINER_CONTEXT_ART` in `src/loot.js` owns the zone/street/biome mapping.
Unknown contexts retain oak barrels and terracotta pots; cosmetic selection
never changes the existing material or loot profile.
