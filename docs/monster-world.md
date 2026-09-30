# Monster world

## Purpose

Give places recognizable inhabitants and fights. Geography chooses the family;
depth and the enemy roster choose its difficulty. Distinct imported monsters
replace routine tint and size variants.

## Scope

This records the enabled encounter design. `src/enemy_roster.js` owns creature
stats, art and actions; `src/enemy_habitats.js` owns habitat families;
`docs/zone-variants.json` owns finite guards attached to composed zones.
Retired variants remain readable in old saves but leave ordinary spawn pools.

## Surface places

| Place | Finite encounter |
| --- | --- |
| Mushroom Grove | One slime or spider beside the existing find |
| Orchard | One farmer goblin beside a find |
| Hedge Garden | One rooted POI guard, plus stationary plants in the hedge pattern |
| Ancient Grove | Plant and spider at the find, plus stationary plants beside the repeating tree centers |
| Ordered Graves | One skeleton soldier; headstone ghost interactions remain |
| Overgrown Graves | One spider; headstone ghost interactions remain |
| Broken Masonry | One club goblin replaces the slime |
| Silent Circle | One ghost wakes when approached; its defeat persists |
| Pirate Cove | Pirate grunt and gunner flank the gold-ore find |
| Mystic Reef | One giant crab; ordinary shore crabs remain passive fauna |
| Shellwater Strand | No authored guards |

Meadow, Formal Garden and Stone Garden receive no authored guards. All five tar
variants retain their existing encounter rules. These budgets belong to the
source anchor, including when its visual coverage crosses tile boundaries.

Overgrown streets receive a plant, orchard streets a farmer goblin, and
toadstool lanes a spider. Each named street has at most one such encounter per
tile, even when the map splits its line into fragments. Barricades use a spear
goblin, with archer support on Hard. Burned streets keep their fire slimes.
Scenic path variants gain no guards.

Optional Hungry Marsh sites place a plant and slime on wetland. Orc Strongholds
place an orc and shaman on rock. Each site has a finite budget and stays outside
other variants' owned ground. Large ruin garrisons can use the local faction.
Existing home safety rules hide unsuitable encounters without rerolling them.

## Caves

| Depth | Habitat mix |
| --- | --- |
| 1–2 | Mostly natural burrows, with goblin warrens |
| 3–4 | Natural pockets, roots, warrens, crypts and strongholds |
| 5–6 | Roots, warrens, crypts, strongholds and the first infernal pockets |
| 7–8 | Crypts, strongholds and more infernal territory, with isolated roots |
| 9+ | Deep crypts, strongholds, infernal territory and dragon roosts |

A persistent spatial region selects the habitat. Its family is filtered through
the roster's depth limits, so neighboring rooms can differ without mixing every
eligible enemy into one bag. Demons never appear before depth 5. The existing
lava level at depth 5 marks that transition. Infernal creatures have explicit
lava immunity.

Ghost haunting belongs to crypt habitats rather than every even-numbered floor.
A dragon is a finite chamber encounter from depth 9, outside the ambient pool.
Its seat needs a clear chamber and separation from stairs; a blocked chamber
omits the dragon rather than moving it to a neighboring tile.

## Behavior and readability

Rooted plants guard their territory. Goblin fighters, spear users and archers
supply different distances; bomb carriers add a visible fuse and blast.
Shamans heal allies, while necromancers summon a bounded number of skeletons.
Summons have stable defeated identities, so reloading cannot create an endless
reward supply. Minotaurs and charging demons commit to a visible direction;
casters and dragons mark attacks before damage lands.

New sprite adapters keep each imported sheet's frame layout. The combat roster
supplies names and behavior independently of art folders. Legacy aliases remain
compatible with saved creatures and completed encounters.

## Placement and remaining art gaps

Beach themes require a canonical beach point of interest in the map data
(`class`, `subclass` or `natural` tagged `beach`). Its sand and directly associated
park share one owner and one encounter budget. Ordinary grove motifs leave sand
alone. Untagged beaches remain ordinary shores, with occasional ambient pirates;
a beach-like name alone does not create a themed encounter.

Pirate Cove's shipwreck uses the existing daily shrine interaction and reward.
It reserves a 3 × 3 dry-sand footprint plus an approach before other dressing,
with deterministic whole-footprint relocation or a small-shrine fallback.
New beach driftwood and rock art retain their existing pickup mechanics. Beach motifs use a stable
quarter-turn orientation; aligning them to the shoreline awaits a canonical
shore direction shared by neighboring tiles. Shellwater's roses require
vegetated ground and may be omitted when the beach has no eligible landward
space.

Enemy seats pass the normal road, occupancy and restricted-ground checks.
Street guards retain the extra kerb setback even when their species moves
slowly. Saved defeats, generated source coordinates and independent placement
streams keep finite encounters stable across rebuilds.
