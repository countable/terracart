# Generated 16 px props

Pixel-art props made with an AI image model (the `image-gen` skill's
`genimg` CLI), as grid sheets at 1024 px, then cut out cell by cell at full
resolution, down-sampled to a small frame (16x16, or 16x24 for the taller
shrines), reduced to a small palette, given BINARY alpha (every pixel fully
opaque or fully clear — no chroma-key fringe) and a 1 px dark-plum outline
(#2b1a22) to match the game's hand-made sprites.

**Every file in this folder is a generated placeholder, not hand art.**
The `Status` column below states that explicitly for each entry; replace
with hand-drawn art when available (nothing here is wired into the game
yet).

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
| barricade.png | bandit-style cheval-de-frise: sharpened stakes jutting from a lashed log — redone wider/chunkier | generated placeholder (gpt-image-2, down-res'd; redone) — replace with hand art when available |
| shrine.png | small lichened stone shrine, tiny green flame, moss look (the only aspect kept — owner cut the blossom/moon/thicket variants) | generated placeholder (gpt-image-2, down-res'd; 16x24) — replace with hand art when available |
| flint.png | ground-pickup flint nodule, flat flake look (the most distinct of the three candidate looks — owner cut the chipped and rounded-lump variants) | generated placeholder (gpt-image-2, down-res'd) — replace with hand art when available |

## Contact sheets

| File | Contents | Status |
|---|---|---|
| sheet16.png | Batch 1's fifteen files in one fixed 240x16 strip, in the order in Batch 1's table — a fixed layout, kept as-is | generated placeholder, fixed layout — do not resize |
| sheet_props2.png | labelled contact sheet of every file in this folder (both batches), for review only | generated placeholder, review aid only — not used by the game |

None of the files in this folder is wired into the game yet.
