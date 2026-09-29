# Zone variants

The game and map review load this declarative table through `src/zone_variant_data.js`. Regenerate that file after editing the JSON: `node tools/zone_variant_data.js --write`. Verify it with `node tools/zone_variant_data.js --check`.

## Placement contract

- Six equally weighted grove variants and five each for churchyards and tar yards. Choose once from the stable anchor identity. Meadow and Flint Field explicitly use seeded scatter keyed by anchor, variant, and global cell; they do not repeat a random tile or change between visits. Other variants use structured patterns; Ancient Grove adds light seeded grass only between its fixed clusters.
- Background slots use their declared repeat motif, seeded scatter, or continuous line grid throughout the coverage union, without radial density falloff. Coordinates are zero-based. One cell is currently 7 metres. Work Yard uses a fixed 5 × 5 arrangement with one-cell-wide lines every four cells and its POI centered in the middle plot. Hedge Garden uses continuous lines every four cells throughout the coverage union; the preview shows a 4 × 4 sample. Shared borders belong to one grid; intersections count once.
- Orient the motif toward the accessible POI approach, quantized to a quarter turn. If no approach can be resolved, use the stable anchor orientation. All tiles must use the same resolved orientation.
- `material.cycle` advances by repeat-block x + y modulo cycle length. Every slot in a bed uses the same phase, keeping beds monochrome. Density values are derived from complete material cycles.
- Recognizable geometry takes priority over the earlier approximate 15% guide. Never thin a continuous line to meet a density target. Density is measured from the declared geometry, or is the expected seeded-scatter coverage, before obstacles. Report actual eligible-ground coverage separately. Variant coverage replaces procedural biome scatter and street dressing, including their empty lanes. Mapped POIs, buildings and authored features remain occupied. Generic runtime rooted plants, traps and treasure scatter stay outside coverage; authored finds and traps retain their budgets.
- POI material arrangements and connection markers replace occupied background slots where they coincide. For fixed geometry, density is an outcome: do not delete unrelated line cells to compensate for POI decoration. Special finds and guards have separate finite counts. Tar is a hazard and does not count as coverage.
- POI coordinates are offsets from the accessible settled chest. Outdoor arrangements touch the POI: Meadow has a radius-three grass disk and Flint Field a radius-two flint disk, each with a one-cell bush or rubble rim, while other variants use the eight immediately adjacent cells. They stay fixed to the POI; blocked slots are omitted rather than pushed outward. When the original POI lies inside a building, use its stored `whenInsideBuilding` arrangement beside the settled frontage, preserving the previous relocation rules. Both grid variants fix their phase to the settled POI.
- Find coordinates are fractions of zone radius, or explicit plot coordinates when specified, in the same oriented frame. Resolve and own their finite plan once per anchor across tile boundaries. Try deterministic fallback seats within the zone; report an unmet count instead of spawning on forbidden ground.
- Keep compact beds whole when blocked. Continuous grid lines are clipped only by the coverage boundary, reserved POI space, and ineligible or occupied cells; never discard an entire long line because one cell is blocked. Do not introduce decorative gaps or replace missing segments with random scatter. Existing roads, buildings, restricted land and spawn buffers remain authoritative.
- Common material uses the minor spawn gate. Finds use attractor eligibility. Guards and headstones use enemy eligibility. A blocked headstone falls back to ordinary stone; a blocked guard is omitted without removing its find.
- Zone ground styling overrides ordinary land zoning throughout the coverage union. Roads, drawn road bands, paths, piers, water and buildings retain their visible footprint; source-land spawn restrictions and trap rules remain authoritative.
- Fauna may share cells with interactables and do not reserve layout cells. Their terrain and road restrictions still apply; guards and other enemies retain occupancy checks.
- Grove shrines remain the existing one-per-POI daily interactable, separate from the finite ground finds. Headstone ghosts retain their current interaction behavior.

## Coverage union

Cover the union of the ragged influence footprint, its associated park polygon, and that polygon's placement fringe. Use the full existing `FRINGE_FILL_M` reach (30 m), not only the 12–20 m terrain-painted band. A large park remains covered beyond the point's influence radius. A zone without an associated park uses its influence footprint alone.

Associate parks through the source polygon containing the anchor, not proximity to arbitrary parks. Resolve overlap once per global cell using the existing influence-strength/kind/key ordering; fringe-only ties use the stable anchor key. Then apply the shared spawn gate. Real cemeteries and other quiet/restricted areas remain excluded. Unnamed parks keep their existing fringe behavior without acquiring extra zone rewards.

The variant frame extends continuously over this union. Fixed compositions such as Work Yard intersect their declared footprint with the union; they do not stretch, repeat, or grow extra rooms to fill irregular extensions. Finite find targets retain their influence-radius coordinates as the first choice, then search valid alternatives in the union. Expanding coverage does not multiply the per-anchor find or guard count.

## Shared connection operators

| Operator | Interpretation |
|---|---|
| follow_grid_lane | Connect POI and finds through open grid plots without cutting the continuous material lines; place finds in matching plot centers. |
| alternating_markers | Alternate existing background materials along the POI-to-find route. |
| paired_markers | Matched material pairs at the declared cell spacing on either side of the route. |
| avenue | Use aligned existing rows to frame the route, with an open central lane. |
| clear_aisle | Remove background slots from a one-cell-wide route; the optional material marks its edge. |
| stepping_stones | Reassign background slots nearest regular route stations to the declared material. |
| aligned_ring_gaps | Give successive repeated rings an opening facing the route. |
| broken_row | Interrupt the row at the route junction; the find occupies the continuation. |
| offset_row | Shift the route’s final row segment sideways one cell before the find. |

Connection operators run in `src/zone_dressing.js`. Reuse eligible pattern slots; do not draw through major roads or create bonus density.

## Variants

| Zone | Variant | Background mix | POI | Finds | Guards | Fauna affinity |
|---|---|---|---|---|---|---|
| grove | Meadow | 15% shrub outside the clearing; no grass outside | R=3 grass disk with bush rim | 3 medium: rose | none | rabbit 50%, butterfly 65% |
| grove | Mushroom Grove | 11.11% mushroom, 5.56% shrub, 2.78% grass | mushroom crescent | 1 rare: star | 1 slime at find | butterfly 50% |
| grove | Orchard | 6.25% apple trees, 6.25% medium maples | paired trees | 3 medium: gemfruit | none | deer 65% |
| grove | Formal Garden | 11.57% shrub, 9.92% blue, 3.31% orange | hedge flanks flower diamond | 2 medium: rose | none | none |
| grove | Hedge Garden | 43.75% shrub, 4.69% blue, 1.56% orange | flowers in hedge room | 2 medium: rose | none | rabbit 60% |
| grove | Ancient Grove | 2.04% tree, 16.33% shrub, 26.78% grass (expected) | stone tree ring | 1 rare: star | 2 slime at find | deer 60% |
| stones | Stone Garden | 4.54% iron_ore, 18.14% stone, 6.8% grass | four stones | 3 medium: gemfruit | none | none |
| stones | Ordered Graves | 6% grave, 6% stone, 3% grass | flanking stone rows | 2 medium: gemfruit | headstone ghosts on interaction | crow 65% |
| stones | Overgrown Graves | 8% grass, 4% shrub, 4% stone, 2% grave | overgrown crescent | 1 rare: star | headstone ghosts on interaction | crow 40%, butterfly 35% |
| stones | Broken Masonry | 12% rubble, 8% stone | stone square | 1 rare: platinum_ore | 1 slime at find | none |
| stones | Silent Circle | 15% stone, 1% grass | inner stone ring | 1 rare: star | none | crow 50% |
| tar | Flint Field | 15% rubble outside the circle | R=2 flint disk with rubble rim | 3 medium: gemfruit | none | none |
| tar | Broken Depot | 12% rubble; hazards: 6% trap | rubble and trap flanks | 2 medium: gemfruit | none | none |
| tar | Seep | 6.25% rubble; hazards: 15.63% tar | tar crescent | 1 rare: star | none | none |
| tar | Work Yard | 28.57% copper_rock, 20.41% rubble | material grid | 1 rare: crimson_ore | none | none |
| tar | Black Ring | 25% rubble; hazards: 12.5% tar | tar ring | 2 rare: gold_ore | none | none |

## Runtime placement

`ZoneCoverage` builds the union; `ZoneVariants` samples motifs; `ZoneDressing` places materials, finite finds, connections and guards through the shared spawn gate. Mapped places remain occupied; procedural biome and street placements yield to the zone. Blocked geometry is clipped. Finite finds are generated once on the source anchor’s owning tile, with deterministic fallback inside its available coverage and diagnostic shortfalls when exhausted. Source-point origins remain stable across tile seams; wholly contained outdoor zones can align their background to the settled POI. Park association uses the source polygon and POI geometry available in each tile’s buffer; a clipped polygon that omits its distant anchor cannot associate that part of a very large park. The map review offers a coverage overlay and reports each POI’s selected variant. Special finds use existing starflower (T5), wildrose (T3), gemfruit (T3), and gold/platinum/crimson mineral rocks (T4/T5/T6). Each variant declares an explicit count; Black Ring intentionally has two rare gold rocks.

## Review preview

Generate directly from the table:

```sh
python3 tools/preview_zone_variants.py docs/zone-variants.json /tmp/zone-variants-preview
```

The generator validates material densities across full repeat cycles, distinct POI positions, grid continuity, find counts, and tar guard exclusions. It displays the background plus the POI arrangement, marked POI point, and an exact-offset POI close-up. Toggles reveal the original background beneath the POI cells. Each motif uses its declared POI-relative phase; no arbitrary square clearing is cut into it. Finds, guards, fauna affinities, connection routes, actual obstacles, and real map boundaries are not drawn; the coverage-union diagram is schematic.

## Mushroom Grove spacing

Mushroom pairs occupy opposite halves of a 6 × 6 repeat. Two shrubs and one grass cell stagger between them, giving 19.44% coverage before clipping. Every motif column has a placement, and no two consecutive rows are empty, preventing the broad blank strips of the former 10 × 10 layout.

## Hedge Garden geometry

- Hedge lines repeat every four cells throughout the coverage union. Each room has a 3 × 3 interior between one-cell-thick lines. The preview shows four rooms per axis; it does not limit world coverage.
- The settled POI is at motif cell (6, 6), centered in room (1, 1). Translate the grid by POI cell minus (6, 6), then apply the common orientation.
- No ordinary flower at the POI center. Four adjacent marigolds frame the shrine within its room. Hedge walls remain continuous around it.
- Repeating background density before POI replacement is 50%: 43.75% shrub, 4.6875% blue flowers and 1.5625% marigolds. The two finite rose finds replace room-center flowers; extending the grid does not multiply finds.
- Irregular boundaries and obstacles clip placement while preserving grid phase and spacing.

## Tar-yard material choices

- Work Yard uses copper-bearing mineral rocks (`yieldTier: 2`, `requiredTier: 1`) in place of flint, including its adjacent POI pattern. Vertical rubble lines remain.
- Seep replaces all flint with tar pits, including the crescent and connection markers. Its 8 × 8 repeat has 6.25% gatherable rubble plus 15.625% tar hazards; the latter includes its two existing extra pits per repeat tile.
- Broken Depot replaces all flint with traps, including the POI flanks and offset-row markers. Background coverage is 12% rubble plus 6% trap hazards. Surface trap records must enter the existing trap collection and pass both the enemy spawn gate and `Traps.isTrapGround`. This can omit traps where the real location has no eligible footpath or park edge.
- Black Ring replaces all flint with tar pits. Background coverage is 25% rubble plus 12.5% tar hazards in an 8 × 8 repeat, with a smaller, near-continuous outer circle.
- Material replacements retain the declared finite special-find counts. Tar pits and traps are shown separately from gatherable coverage.

## Ore finds

- Black Ring: two gold-bearing rocks, at normalized offsets (−0.4, 0.55) and (0.4, 0.55) from the POI, replacing its former starflower.
- Work Yard: one crimson-bearing rock centered in plot (2, 4), using zero-based plot coordinates, replacing its three gemfruit finds. Copper-bearing rocks remain its background material.
- Broken Masonry: one platinum-bearing rock at (0, 0.6), replacing its three gemfruit finds. Its one slime guard follows this find.
- These use existing mineral-rock interactions: yield tiers 4, 6, and 5 respectively, with normal required pick tiers 3, 5, and 4. Valuable placements use attractor eligibility. Counts are per anchor and do not multiply across tiles or fringe coverage.

## Ancient Grove clusters

A 7 × 7-cell repeat contains one rounded cluster: one central tree, eight shrubs around it, and twelve longgrass cells on the outer edge. The four square corners are removed. Clusters repeat every seven cells, two cells closer than the previous nine-cell spacing, giving 42.86% fixed coverage. Each otherwise empty cell has a deterministic 4% chance of longgrass, adding about 2.29 percentage points for 45.14% expected total coverage. This scatter never replaces cluster cells and does not change between visits. The POI replaces the central tree of the anchor cluster; its adjacent decorations replace only the slots they occupy. The starflower find and two slime guards remain.

## Stone Garden concentric rings

Three rings centered on the POI have radii 3, 6 and 9 cells and contain 16, 32 and 52 touching stones respectively. The rings use symmetric pixel-circle outlines. Continuing clockwise through the inner, middle and outer rings, every fifth stone is iron: exactly twenty of 100 stones. Two staggered longgrass rings between them contain ten and twenty cells. The complete 21 × 21-cell footprint holds 80 ordinary stones, 20 iron rocks and 30 grass cells (29.48% background coverage). The central four-stone POI arrangement remains additional to these rings. Iron uses the existing tier-3 ore rock with a tier-2 pick requirement. The finite radial composition is clipped to the eligible coverage union rather than repeated from each tile.

## Fauna affinities

Exactly eight of sixteen variants declare a nonempty `attracts` column, using the existing `{species: probability}` convention. These probabilities move existing tile fauna onto eligible cells of the variant coverage union; they do not add spawns or guarantee sightings. The original seat is retained if no valid destination exists. Keep existing occupancy, fauna placement restrictions, and pest amnesty. Fauna and guards have separate rules.

On integration, the variant column replaces the zone-kind affinity: an empty object means no zone-specific pull, rather than inheriting the old grove/deer or churchyard/crow defaults. Existing street and underlying-terrain preferences continue independently.

| Variant | Affinities | Intent |
|---|---|---|
| Meadow | Rabbit 50%, butterfly 65% | Grazing and flower visitors |
| Mushroom Grove | Butterfly 50% | Small moving lights among the mushrooms |
| Orchard | Deer 65% | Browsers beneath fruit trees |
| Hedge Garden | Rabbit 60% | Movement within the garden rooms |
| Ancient Grove | Deer 60% | Quiet woodland presence between clusters |
| Ordered Graves | Crow 65% | Birds among the stone rows |
| Overgrown Graves | Crow 40%, butterfly 35% | Wildlife returning to neglected ground |
| Silent Circle | Crow 50% | Occasional movement in an otherwise quiet ring |

Formal Garden, Stone Garden, Broken Masonry and all five tar-yard variants have no zone-specific affinity. They can still contain naturally spawned fauna. The live attraction pass reads these variant rows over the same coverage union and relocates existing fauna without adding population.

## Work Yard grid

The 5 × 5 plots share six continuous boundaries on each axis, at cell coordinates 0, 4, 8, 12, 16 and 20. The whole footprint is 21 × 21 cells. Copper occupies horizontal lines and intersections (126 cells); rubble occupies the remaining vertical-line cells (90 cells). Background coverage is 48.98%, chosen for recognizable geometry rather than the former density guide. The POI is at cell (10, 10), exactly centered in plot (2, 2). Its outdoor arrangement uses the adjacent top and bottom rows. The crimson find occupies the center of the far middle plot.

## Silent Circle continuity

Each 10 × 10 repeat contains a radius-three circle of sixteen neighboring positions: fifteen stones form one continuous arc, with one grass-marked opening. Coverage is 15% stone and 1% grass. The outdoor POI ring has seven immediately adjacent stones and one open entrance to the south. The wider indoor/frontage arrangement remains available separately.

## POI-relative pattern origins

Every variant declares `background.poiOrigin.cell`. The world-to-pattern mapping is `inverse_rotate(world_cell - settled_poi_cell) + poiOrigin.cell`, with repeat-block indices derived in the same frame. This aligns the composition once for the whole zone rather than restarting its phase at each tile or at the preview corner. The preview uses this mapping, including its contextual close-ups.

Only the POI cell and actual decoration slots replace existing background slots. Ancient Grove's central tree becomes the POI, retaining the outer grass ring; Silent Circle retains its enclosing ring around the POI. Other motif positions remain intact. Missing settled-chest information requires a stable anchor fallback resolved consistently across tiles during integration.

| Variant | POI position in motif | Intended alignment |
|---|---|---|
| Meadow | [0, 0] | scatter seed origin |
| Mushroom Grove | [3, 2] | clearing between mushroom pairs |
| Orchard | [4, 4] | avenue center between apple rows |
| Formal Garden | [5, 5] | central cross aisle between four mirrored flower beds |
| Hedge Garden | [6, 6] | plot center |
| Ancient Grove | [3, 3] | cluster center replacing center tree |
| Stone Garden | [10, 10] | center of three concentric stone rings |
| Ordered Graves | [5, 4] | central stone row between graves |
| Overgrown Graves | [5, 4] | middle of shrub row |
| Broken Masonry | [4, 4] | clearing between masonry groups |
| Silent Circle | [5, 5] | circle center |
| Flint Field | [0, 0] | scatter seed origin |
| Broken Depot | [5, 4] | middle of material row |
| Seep | [3, 3] | central seep replaced by poi |
| Work Yard | [10, 10] | plot center |
| Black Ring | [3, 3] | inner ring clearing |

## Map review diagnostics

The map review shows variant labels and a park/zone selector. Select a zone to highlight its union and see live placements, fauna, removed general/street placements, and background slots lost to occupancy or spawn restrictions. The source filter isolates the variant or hides fauna; marker popups report their generating source. These are read-only views of the game’s generation, not a separate placement simulation.

## Meadow clearing

The POI is the center of a radius-three-cell disk (21 m). Its 28 surrounding cells contain longgrass. A one-cell-wide bush rim occupies the 20 cells with distance greater than three and at most four cells. Outside this composition, seeded bush coverage is 15%, with no grass or ordinary flower scatter. The three wild-rose finds remain; flower-marker connections are removed. Roads, buildings and occupied cells still clip the arrangement.

## Flint Field circle

Uses a smaller version of the Meadow arrangement: 12 flint cells within radius two around the POI, 16 rubble cells forming the rim up to radius three, then 15% seeded rubble outside. The three gemfruit finds remain.

## Black Ring spacing

An 8 × 8 repeat holds a radius-three circle of sixteen touching rubble cells and a tight inner ring of eight tar cells. The POI replaces its center. This makes the circles smaller and two cells closer than the previous repeat.

## Proposed beach family

Three beach-specific variants are drafted separately in [beach-zone-variants.draft.md](beach-zone-variants.draft.md), with the declarative rows in [beach-zone-variants.draft.json](beach-zone-variants.draft.json): Mystic Reef, Pirate Cove and Shellwater Strand. They are not loaded by the game. The draft includes beach detection, shoreline orientation and rules for sharing coverage with inland groves and the existing daily tide.
