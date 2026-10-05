# docs index

`CLAUDE.md` at the repo root owns working policy and invariants; the code owns
current numeric values. Keep paths in this table stable - update references
when a file moves.

| Path | What it holds |
| --- | --- |
| ../CLAUDE.md | working policy, invariants, and this index's authority |
| ../README.md | setup and source map |
| process/QC_RULES.md | art and asset checklist |
| process/SANDBOX.md | sandbox test world manual |
| design/spec.txt | game design spec |
| design/story.txt | story bible (wins over copy in src/) |
| design/monster-world.md | encounter design |
| design/zone-variants.md | zone placement contract |
| design/CHEST_THEMES.md | themed loot invariants |
| design/generation.md | world generation, saves, spawn gate, precedence |
| design/rendering.md | projection, seating, performance, lighting, streets |
| design/combat.md | damage, energy, timed effects, pets, Home |
| design/presentation.md | dialogs, story delivery, feedback, teaching |
| art/README.md | sprite art direction and active audits |
| art/art-direction-brief.md | camera, scale and palette brief |
| art/map-perspective.md | map camera and art geometry rules |
| art/ART_SOURCES.md | external art archive rules |
| art/ASSET_INVENTORY.md | asset inventory tool guide |
| data/zone-variants.json | implemented variant spec; tools read this path |
| data/basic-zone-density-proposals.json | basic zone density targets |
| data/basic-zone-signatures.json | basic zone signatures |
| data/beach-zone-variants.draft.json | superseded beach snapshot (rows live in zone-variants.json); kept as preview input and art provenance |
| data/underground-zone-variants.draft.json | underground preview tool input |
| reports/zone-economy.md | generated report; regenerate before trusting |
| ../test/node/README.md | headless test harness |

## data/

The JSON files under `data/` are inputs that tools and generated code read by
literal path, not prose. Edit them like specs and rerun the owning tool.

## reports/

`reports/` holds generated output. `tools/zone_economy.py` rewrites
`zone-economy.md` wholesale; edit the tool, not the page.
