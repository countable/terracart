# Beach zone variants — implementation notes

Mystic Reef, Pirate Cove and Shellwater Strand are implemented as `beach` variant rows of the canonical `zone-variants.json` table and its generated runtime data. This file and `beach-zone-variants.draft.json` keep their historical "draft" filenames because tools cite them; the JSON retains the original design snapshot for preview tooling, and this file keeps design rationale only. Beach selection, composite sand/park ownership, finite rewards and the shipwreck shrine are active. The placement contract below also specifies shoreline orientation and daily tide-seat reservations.

## Can we detect beach parks?

Yes where the source map supplies the geometry, but not exhaustively. `Scenic.isBeachSand` recognizes explicit sand/beach tags, and the scenic shore pass recognizes original SAND terrain beside mapped water. It reads `Zones.landAt`, so grove ground paint does not erase the evidence. The current terrain mapping also recognizes beach-class ground.

Sand is the primary zone, independent of the park. A beach variant requires an actual mapped sand footprint, with either a beach tag or shoreline evidence. The sand does not need to be inside a park. A directly adjoining park area may join the same composite design; proximity to an unrelated park is insufficient. Waterfront parks without sand remain ordinary parks. Inland sand without beach or shoreline evidence is not automatically a beach.

Resolve sand ownership before grove coverage so parks cannot subsume it. Preserve sandy ground on the sand component; treat adjoining parkland as the landward component of the same chosen variant. One beach anchor, orientation and find budget span that composition. Remaining parkland outside the composite keeps its normal grove treatment. Use stable source sand identity, never a tile-clipped polygon centroid, for anchors, orientation and finite reward ownership. Missing or ambiguous geometry goes to review rather than inventing a sand zone.

## Original design rows

The live values (repeats, counts, guards, `attracts`) are the variant rows in `zone-variants.json`; the table below is the design snapshot.

Repeats prefer at most 6 × 6 cells, with an 8 × 8 ceiling. Smaller rectangles are welcome. Each frame stays anchored to the POI and aligned with the shore; dimensions are width along shore × depth toward land. Coverage is measured before clipping, shrine reservations, tide cells and finds. One cell is currently 7 m.

| Variant | Repeat | Background | Daily shrine | Finite finds / fauna |
|---|---|---|---|---|
| Mystic Reef | 6 × 6 | 3 stones, 3 shells, 1 blue flower; **19.44%** | Existing small anchor with touching stone/shell/flower crescent | 1 starflower; no guards or affinity |
| Pirate Cove | 8 × 8 | 7 driftwood ribs, 3 shells, 2 rubble; **18.75%** | **One actual shipwreck, maximum 3 × 3-cell extent**, on dry sand | 1 gold ore rock, 2 slime guards; crow affinity 35% |
| Shellwater Strand | 3 × 5 | 2 shell seats and 1 driftwood seat; **20%** | Open shell horseshoe with driftwood corners | 2 wild roses on vegetated landward ground; butterfly affinity 35% |

Pirate Cove's open rib pattern remains background dressing. Its shipwreck replaces the central arrangement as the shrine, with one object id, one interaction and the existing daily gift. The artwork preserves its aspect ratio inside a 3 × 3-cell maximum extent; it is not nine objects or nine rewards. Reserve all nine covered cells and a one-cell landward approach before background fill. Require the entire footprint to be eligible dry sand; do not clip the hull or overwrite higher-priority Home, story or building spawns. If a deterministic whole-footprint fallback cannot fit, retain the existing accessible daily POI and report the missing wreck.

The shipwreck PNG in `docs/art/shipwreck-shrine-draft.png` supplies the registered runtime shrine art. The preview evaluates it at 48 px and 72 px. Runtime placement reserves its 3 × 3 extent and landward approach, with an accessible daily-POI fallback when the whole wreck cannot fit.

## Art candidates

- **Cowrie colour mix:** use existing valid pink/gold/blue shell frames 0–2 as visual choices for existing shell pickups. Do not increase seats or rewards.
- **Broken-barrel salvage:** existing generated smashed-barrel art can replace a driftwood seat's look if it retains the wood pickup budget and matches its item art. This is a proposed mapping, not an enabled barrel loot mechanic.
- **Modular ship art:** [Sevarihk's 32 px Ship Tileset](https://sevarihk.itch.io/ship-tileset) provides modular hulls and fittings. The creator permits CC-BY4; credit is required if adopted. It is an alternative source, not imported art.
- **Nautical objects:** [Underwater Ruins & Shipwrecks](https://animalsanmore.itch.io/underwater-ruins-shipwrecks-pixel-art-pack) includes anchors, rope coils, nets and ship bells; anchor and rope coil are in its free sample. It discloses AI-assisted art and permits commercial use/modification. These are unimported candidates needing a compatible existing interaction and a small-scale visual check.

Standing objects must be interactables or hazards. A new appearance replaces an existing seat or belongs to the shrine's one interaction; it does not create extra decorative occupancy or rewards.

## Placement and reward contract

- The composition must include its original sand footprint and may extend onto directly adjoining eligible parkland within its influence and landward fringe (at most 30 m). Sand stays sand; adjoining parkland stays the vegetated landward component. Never fill water or paint over roads, paths, piers or buildings.
- Sand ownership is resolved before grove coverage. The beach variant also owns its optional adjoining park component, with one background composition and one finite find plan across both components and all tile seams. Adding parkland does not roll a second beach variant or multiply rewards.
- Preserve the existing daily tide stream and reserve its waterline seats. Do not stack a second tide population beneath these patterns.
- Replace ordinary beach buried-X scatter inside owned coverage with the declared finite find budget. Otherwise long shorelines could dwarf the variant rewards.
- Keep the existing one-per-POI daily grove gift, with beach-themed art. Do not restore a generic park chest or add a second daily reward.
- Small POI decoration touches its anchor; the shipwreck instead reserves its whole extent. Finds connect through clear lanes. Blocked small slots are omitted; inaccessible finds use deterministic eligible fallback seats and then report shortfalls.
- Fauna percentages relocate existing animals, not spawn additional animals. Fauna can overlap objects; guards use normal enemy eligibility and occupancy.
- Each beach variant row declares its own `attracts` column, independently of the grove, stones and tar rows.

## Verification

Check stable shoreline orientation, waterline reservations, landward vegetation filters and whole-footprint shipwreck fallback on long beaches and parks crossing tile seams. Background pickup densities and finite-find counts are separate budgets; this document does not claim an exact economic total.
