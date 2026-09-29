# Beach zone variants — draft

These three rows are proposed in `beach-zone-variants.draft.json`. They are not in the generated runtime table and do not change live park selection. Existing materials and rewards make the first pass practical; beach POI art and shoreline placement operators still need implementation.

## Can we detect beach parks?

Yes where the source map supplies the geometry, but not exhaustively. `Scenic.isBeachSand` recognizes explicit sand/beach tags, and the scenic shore pass recognizes original SAND terrain beside mapped water. It reads `Zones.landAt`, so grove ground paint does not erase the evidence. The current terrain mapping also recognizes beach-class ground.

Sand is the primary zone, independent of the park. A beach variant requires an actual mapped sand footprint, with either a beach tag or shoreline evidence. The sand does not need to be inside a park. A directly adjoining park area may join the same composite design; proximity to an unrelated park is insufficient. Waterfront parks without sand remain ordinary parks. Inland sand without beach or shoreline evidence is not automatically a beach.

Resolve sand ownership before grove coverage so parks cannot subsume it. Preserve sandy ground on the sand component; treat adjoining parkland as the landward component of the same chosen variant. One beach anchor, orientation and find budget span that composition. Remaining parkland outside the composite keeps its normal grove treatment. Use stable source sand identity, never a tile-clipped polygon centroid, for anchors, orientation and finite reward ownership. Missing or ambiguous geometry goes to review rather than inventing a sand zone.

## Proposed rows

Every pattern repeats in a 12 × 12 cell frame anchored to the POI and oriented along the shore. Percentages below are ideal background coverage before clipping, POI decoration, reserved tide cells and finds. A cell is currently 7 m. The preview shows that ideal frame, not a mapped shoreline.

| Variant | Repeating background | POI pattern | Finite finds | Guards / fauna |
|---|---|---|---|---|
| Mystic Reef | 8.33% rounded stone crescents, 8.33% shell inlays, 2.78% blue flower pools; **19.44% total** | Three stones on the seaward side, shells on the flanks, blue flowers on the landward corners; all touch the POI | **1 starflower**, in a small magical bed on dry ground | No guards; no fauna attraction |
| Pirate Cove | 9.72% driftwood in open U-shaped wreck ribs, 5.56% shell dashes, 2.78% rubble; **18.06% total** | Driftwood ribs immediately flank the POI; a shell marks the seaward opening | **1 gold ore rock**, using its normal pick requirement | 2 ordinary slimes at the find; crow affinity 35% |
| Shellwater Strand | 12.5% shells in parallel ribbons, 1.39% driftwood, 2.78% grass at the vegetated landward edge; **16.67% maximum total** | Open shell horseshoe with two driftwood corners; open toward land | **2 wild roses** on eligible vegetated ground; report a shortfall if the beach has no such edge | No guards or traps; butterfly affinity 35% |

Mystic Reef should feel quietly enchanted, Pirate Cove like the remains of a wreck, and Shellwater Strand like a pleasant ordinary beach. Optional future glow/wreck art can strengthen those themes; no new enemy or reward system is assumed.

## Placement and reward contract

- The composition must include its original sand footprint and may extend onto directly adjoining eligible parkland within its influence and landward fringe (at most 30 m). Sand stays sand; adjoining parkland stays the vegetated landward component. Never fill water or paint over roads, paths, piers or buildings.
- Sand ownership is resolved before grove coverage. The beach variant also owns its optional adjoining park component, with one background composition and one finite find plan across both components and all tile seams. Adding parkland does not roll a second beach variant or multiply rewards.
- Preserve the existing daily tide stream and reserve its waterline seats. Do not stack a second tide population beneath these patterns.
- Replace ordinary beach buried-X scatter inside owned coverage with the declared finite find budget. Otherwise long shorelines could dwarf the variant rewards.
- Keep the existing one-per-POI daily grove gift, with proposed beach-themed art. Do not restore a generic park chest or add a second daily reward.
- POI decoration touches its anchor. Finds connect through clear lanes. Blocked slots are omitted; inaccessible finds use deterministic eligible fallback seats and then report shortfalls.
- Fauna percentages relocate existing animals, not spawn additional animals. Fauna can overlap objects; guards use normal enemy eligibility and occupancy.
- Two of these three draft variants have fauna affinities. The existing sixteen live rows and their half-with-affinity rule remain unchanged until the new family is reviewed.

## Before activation

Implement beach ownership and stable shoreline orientation, waterline reservations and landward vegetation filters; settle the POI art; check the common-pickup plus finite-find economy against current rewards. Especially verify long beaches and parks crossing tile seams. No exact economic total is claimed by this draft.
