# Generated 16 px props

Pixel-art props made with an AI image model (the `image-gen` skill's
`genimg` CLI), as grid sheets at 1024 px, then cut out cell by cell at full
resolution, down-sampled to a small frame (16x16, or 16x24 for the taller
shrines), reduced to a small palette, given BINARY alpha (every pixel fully
opaque or fully clear — no chroma-key fringe) and a 1 px dark-plum outline
(#2b1a22) to match the game's hand-made sprites.

**Every file in this folder is a generated placeholder, not hand art.**
The `Status` column below states that explicitly for each entry; replace
with hand-drawn art when available.

## Batch 1 — `openai/gpt-5.4-image-2` via OpenRouter, 9x9 / 3x3 grid sheets

| File | Intended use | Status |
|---|---|---|
| barrel.png / barrel_smashed.png | waste-basket POI: a barrel you smash | generated placeholder (gpt-5.4-image-2 via OpenRouter, down-res'd) — replace with hand art when available |
| pot.png / pot_smashed.png | waste-basket POI: a clay pot you smash | generated placeholder (gpt-5.4-image-2 via OpenRouter, down-res'd) — replace with hand art when available |
| postbox.png | post-box POI (message box) | generated placeholder (gpt-5.4-image-2 via OpenRouter, down-res'd) — replace with hand art when available |
| signpost.png | waystone / signpost | generated placeholder (gpt-5.4-image-2 via OpenRouter, down-res'd) — replace with hand art when available |
| tar.png | fuel-station POI: tar pit (holds the player briefly) | generated placeholder (gpt-5.4-image-2 via OpenRouter, down-res'd) — replace with hand art when available |
| stakes_a/b/c.png | playground POI: iron stakes around it, one per cell | generated placeholder (gpt-5.4-image-2 via OpenRouter, down-res'd) — replace with hand art when available |
| pillar_a/c.png | bus-stop POI: a stone pillar either side, parallel to the road | generated placeholder (gpt-5.4-image-2 via OpenRouter, down-res'd) — replace with hand art when available |
| hay_a/b/c.png | inn / lodging POI: haybales with a blanket | generated placeholder (gpt-5.4-image-2 via OpenRouter, down-res'd) — replace with hand art when available |

## Batch 2 — `gpt-image-2` (OpenAI direct, chroma-keyed), 3x3 / 4x2 grid sheets

| File | Intended use | Status |
|---|---|---|
| hedge_end.png | end-cap for a hedge row (matches `sprites_32.png`'s hedges, at 16px) — rounded clipped-hedge block, redone to fill the frame | generated placeholder (gpt-image-2, down-res'd; redone) — replace with hand art when available |
| waystone.png | small weathered roadside waystone/milestone, carved cross, mossy — redone squat and wide | generated placeholder (gpt-image-2, down-res'd; redone) — replace with hand art when available |
| headstone.png | previous cross-shaped grave marker | retired placeholder; runtime uses pillar_c.png |
| barricade.png | bandit-style cheval-de-frise: sharpened stakes jutting from a lashed log — redone wider/chunkier | generated placeholder (gpt-image-2, down-res'd; redone) — replace with hand art when available |
| shrine.png | small lichened stone shrine, tiny green flame, moss look (the only aspect kept — owner cut the blossom/moon/thicket variants) | generated placeholder (gpt-image-2, down-res'd; 16x24) — replace with hand art when available |
| flint.png | ground-pickup flint nodule, flat flake look (the most distinct of the three candidate looks — owner cut the chipped and rounded-lump variants) | generated placeholder (gpt-image-2, down-res'd) — replace with hand art when available |
| wagon.png | broken covered wagon, 128x96 (one frame): the look a bus stop on a MAJOR road wears (loot.js chestLook 'wagon', drawn ~1.5 cells wide, foot-anchored) | generated placeholder (picked from three candidates, wagon_b) — replace with hand art when available |

## Batch 3 — macro stalls (in-building POIs), 80x80, true alpha, `market_stand.png`'s frame and box

One frame each, foot-anchored and drawn like the market stall (loot.js `chestLook` → `macro_<kind>`, render.js `RENDER_SPEC.chest`, ~1.35 cells wide, rising north over the POI cell). Picked from two candidates per kind.

| File | Intended use | Status |
|---|---|---|
| inn.png | the INN (lodging POIs): rest to full for coin, once a day per inn | generated placeholder — replace with hand art when available (picked from two candidates, inn_b) |
| chapel.png | the CHAPEL (place_of_worship POIs): daily alms, the Old Stones anchor | generated placeholder — replace with hand art when available (picked from two candidates, chapel_b) |
| apothecary.png | the APOTHECARY (pharmacy / dentist / hospital POIs): a T2 potion counter + the antidote | generated placeholder — replace with hand art when available (picked from two candidates, apothecary_a) |
| scriptorium.png | the SCRIPTORIUM (library / college POIs): a free Book page a day, Books for sale | generated placeholder — replace with hand art when available (picked from two candidates, scriptorium_a) |
| guildhall.png | the GUILDHALL (town_hall / police / fire_station POIs): one daily commission | generated placeholder — replace with hand art when available (picked from two candidates, guildhall_b) |
| curio.png | the CURIO HALL (museum / theatre / cinema POIs): donate one of each item, once | generated placeholder — replace with hand art when available (picked from two candidates, curio_a) |
| sundries.png | SUNDRIES (the generic `shop` POIs no produce stall claims): one supply item for sale | generated placeholder — replace with hand art when available (picked from two candidates, sundries_b) |
| training.png | the TRAINING HALL (sports_centre / yoga POIs): buy damage, for good or for a day | generated placeholder — replace with hand art when available (picked from two candidates, training_a) |

## Batch 4 — `gpt-image-2` (OpenAI direct, chroma-keyed), single-subject images

| File | Intended use | Status |
|---|---|---|
| bike_rack.png | bicycle_parking POI: a bike rack — tap for a stick-walking speed boost | generated placeholder (gpt-image-2, down-res'd) — replace with hand art when available |

## Batch 5 — scenic places (`gpt-image-2`, down-res'd)

| File | Intended use | Status |
|---|---|---|
| scope.png | the VIEWPOINT's scope (src/scenic.js): tap for the daily gift; the first vista ever pays a relic; a rest spot | generated placeholder (gpt-image-2, down-res'd) — replace with hand art when available |
| driftwood.png | the TIDE LINE's driftwood (a daily shore pickup, gives wood) | generated placeholder (gpt-image-2, down-res'd) — replace with hand art when available |
| bottle.png | the TIDE LINE's rare message bottle (a daily shore pickup that reads a note) | generated placeholder (gpt-image-2, down-res'd) — replace with hand art when available |

## Batch 6 — roadside/zone shrines (`gpt-image-2`, chroma-keyed, one image per kind, down-res'd to 16x24)

| File | Intended use | Status |
|---|---|---|
| shrines.png | shrine boons: 10 zone/road shrine kinds (src/shrines.js SHRINE_KINDS `frame`) — one 160x24 row of 16x24 frames: 0 wayfarer_post, 1 lantern_saint, 2 tide_bell, 3 bone_watcher, 4 moss_cairn, 5 rust_totem, 6 wishing_well, 7 harvest_idol, 8 toad_idol, 9 ember_altar | generated placeholder (gpt-image-2, down-res'd; 16x24) — replace with hand art when available |

## Contact sheets

| File | Contents | Status |
|---|---|---|
| sheet16.png | Batch 1's fifteen files in one fixed 240x16 strip, in the order in Batch 1's table — a fixed layout, kept as-is | generated placeholder, fixed layout — do not resize |
| sheet_props2.png | labelled contact sheet of every file in this folder (both batches), for review only | generated placeholder, review aid only — not used by the game |

Batch 3 (the macro stalls) is wired into the game (src/assets.js `macro_<kind>`); see src/assets.js for which of the others are.
