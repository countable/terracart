# Zone variants

Declarative design for review. This table is not yet loaded by the game; the existing world generation and map review remain unchanged.

## Placement contract

- Six equally weighted grove variants and five each for churchyards and tar yards. Choose once from the stable anchor identity. Meadow and Flint Field explicitly use seeded scatter keyed by anchor, variant, and global cell; they do not repeat a random tile or change between visits. Other variants use structured patterns.
- Background slots use their declared repeat motif, seeded scatter, or continuous line grid throughout the coverage union, without radial density falloff. Coordinates are zero-based. One cell is currently 7 metres. Work Yard and Hedge Garden use one-cell-wide lines every 13 cells: the preview shows three by three open plots enclosed by four horizontal and four vertical lines. Shared borders belong to one grid; intersections count once.
- Orient the motif toward the accessible POI approach, quantized to a quarter turn. If no approach can be resolved, use the stable anchor orientation. All tiles must use the same resolved orientation.
- `material.cycle` advances by repeat-block x + y modulo cycle length. Every slot in a bed uses the same phase, keeping beds monochrome. Density values are derived from complete material cycles.
- Density is nominal motif coverage, or expected seeded-scatter coverage, before obstacles. Report actual eligible-ground coverage separately. Existing interactables count toward the background budget; do not overlay another full 15% on occupied land.
- POI material arrangements and connection markers replace background allocations within the same budget. Special finds and guards have separate finite counts. Tar is a hazard and does not count as coverage.
- POI coordinates are offsets from the accessible settled chest. Relocate whole arrangements within four cells, preserving the approach; skip an arrangement if no valid placement exists.
- Find coordinates are fractions of zone radius, in the same oriented frame. Resolve and own their finite plan once per anchor across tile boundaries. Try deterministic fallback seats within the zone; report an unmet count instead of spawning on forbidden ground.
- Keep compact beds whole when blocked. Continuous grid lines are clipped only by the coverage boundary, reserved POI space, and ineligible or occupied cells; never discard an entire long line because one cell is blocked. Do not introduce decorative gaps or replace missing segments with random scatter. Existing roads, buildings, restricted land and spawn buffers remain authoritative.
- Common material uses the minor spawn gate. Finds use attractor eligibility. Guards and headstones use enemy eligibility. A blocked headstone falls back to ordinary stone; a blocked guard is omitted without removing its find.
- Grove shrines remain the existing one-per-POI daily interactable, separate from the finite ground finds. Headstone ghosts retain their current interaction behavior.

## Coverage union

Cover the union of the ragged influence footprint, its associated park polygon, and that polygon's placement fringe. Use the full existing `FRINGE_FILL_M` reach (30 m), not only the 12–20 m terrain-painted band. A large park remains covered beyond the point's influence radius. A zone without an associated park uses its influence footprint alone.

Associate parks through the source polygon containing the anchor, not proximity to arbitrary parks. Resolve overlap once per global cell using the existing influence-strength/kind/key ordering; fringe-only ties use the stable anchor key. Then apply the shared spawn gate. Real cemeteries and other quiet/restricted areas remain excluded. Unnamed parks keep their existing fringe behavior without acquiring extra zone rewards.

The variant frame extends continuously over this union. Finite find targets retain their influence-radius coordinates as the first choice, then search valid alternatives in the union. Expanding coverage does not multiply the per-anchor find or guard count.

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

Connection operators are specifications for a shared interpreter, not currently supported runtime APIs. Reuse eligible pattern slots; do not draw through major roads or create bonus density.

## Variants

| Zone | Variant | Background mix | POI | Finds | Guards |
|---|---|---|---|---|---|
| grove | Meadow | 10% grass, 4% blue, 1% orange (seeded scatter) | flower ring | 3 medium: rose | none |
| grove | Mushroom Grove | 8% mushroom, 4% shrub, 3% grass | mushroom crescent | 1 rare: star | 1 slime at find |
| grove | Orchard | 4% fruit_tree, 6% grass, 2% blue | paired trees | 3 medium: gemfruit | none |
| grove | Formal Garden | 10% shrub, 6% blue, 2% orange | hedge flanks flower diamond | 2 medium: rose | none |
| grove | Hedge Garden | 14.79% shrub, 0.44% blue, 0.15% orange (continuous grid) | hedge courtyard | 2 medium: rose | none |
| grove | Ancient Grove | 3% tree, 7% shrub, 5% grass | stone tree ring | 1 rare: star | 2 slime at find |
| stones | Stone Garden | 10% stone, 5% grass | four stones | 3 medium: gemfruit | none |
| stones | Ordered Graves | 6% grave, 6% stone, 3% grass | flanking stone rows | 2 medium: gemfruit | headstone ghosts on interaction |
| stones | Overgrown Graves | 8% grass, 4% shrub, 4% stone, 2% grave | overgrown crescent | 1 rare: star | headstone ghosts on interaction |
| stones | Broken Masonry | 12% rubble, 8% stone | stone square | 3 medium: gemfruit | 1 slime at find |
| stones | Silent Circle | 8% stone, 2% grass | inner stone ring | 1 rare: star | none |
| tar | Flint Field | 10% flint, 5% rubble (seeded scatter) | flint ring | 3 medium: gemfruit | none |
| tar | Broken Depot | 12% rubble, 6% flint | paired stacks | 2 medium: gemfruit | none |
| tar | Seep | 8% flint, 4% rubble | tar crescent | 1 rare: star | none |
| tar | Work Yard | 7.69% flint, 7.1% rubble (continuous grid) | material grid | 3 medium: gemfruit | none |
| tar | Black Ring | 9% rubble, 6% flint | tar ring | 1 rare: star | none |

## Before runtime integration

Implement and test the shared motif/connection interpreter, stable cross-tile orientation and finite-find ownership. Measure coverage at Kelowna Gospel Fellowship, including the outer zone, and verify collisions, blocked beds, rebuild stability, guard eligibility, and one-versus-two/three find counts. Special finds use existing starflower (T5), wildrose (T3), and gemfruit (T3) pickups.

## Review preview

Generate directly from the table:

```sh
python3 tools/preview_zone_variants.py docs/zone-variants.json /tmp/zone-variants-preview
```

The generator validates material densities across full repeat cycles, distinct POI positions, grid continuity, find counts, and tar guard exclusions. It displays the background plus the POI arrangement, marked POI point, and an exact-offset POI close-up. Toggles reveal the background beneath the reserved POI area. Finds, guards, connection routes, actual obstacles, and real map boundaries are not drawn; the coverage-union diagram is schematic.
