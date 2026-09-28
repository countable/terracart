# Generated 16 px props

Pixel-art props made with `openai/gpt-5.4-image-2` on OpenRouter (the
`image-gen` skill's `genimg --openrouter`), as 9x9 and 3x3 grid sheets at
1024 px, then cut out cell by cell at full resolution, down-sampled to 16x16,
reduced to a small palette, given BINARY alpha (every pixel fully opaque or
fully clear — no chroma-key fringe) and a 1 px dark-plum outline
(#2b1a22) to match the game's hand-made sprites.

| File | Intended use |
|---|---|
| barrel.png / barrel_smashed.png | waste-basket POI: a barrel you smash |
| pot.png / pot_smashed.png | waste-basket POI: a clay pot you smash |
| postbox.png | post-box POI (message box) |
| signpost.png | waystone / signpost |
| tar.png | fuel-station POI: tar pit (holds the player briefly) |
| stakes_a/b/c.png | playground POI: iron stakes around it, one per cell |
| pillar_a/c.png | bus-stop POI: a stone pillar either side, parallel to the road |
| hay_a/b/c.png | inn / lodging POI: haybales with a blanket |
| sheet16.png | all fifteen in one 240x16 strip, in the order above |

None is wired into the game yet.
