# Monster world

## Purpose

Give places recognisable inhabitants and fights. Geography chooses the family;
depth and the enemy roster choose its difficulty. Distinct imported monsters
replace routine tint and size variants.

## Owners

This file records the encounter design; the tables are code and data.

- Creature stats, art, actions and depth limits: `src/enemy_roster.js`.
- Habitat families and where they apply: `src/enemy_habitats.js`
  (`EnemyHabitats.FAMILIES`, `THEME_BANDS`, `SURFACE_FAMILIES`,
  `BUILDING_FAMILIES`, `SURFACE_ENCOUNTERS`, `surfaceSites`, `caveSites`).
- Finite guards of a composed zone: the `guards` column of each variant row
  in [zone-variants.json](zone-variants.json).
- Street and lair guards: `Lairs.STREET_TIER_GUARDS` and `KIND_ORDER`
  (`src/lairs.js`); authored garrisons are rows of `Lairs.GROUPS` (CLAUDE.md).

Retired kinds leave ordinary spawn pools.

## Surface places

A zone variant may declare a small finite guard budget beside its find or POI,
chosen to fit its story (graves raise the dead, gardens grow plants that bite,
the cove has pirates). Many variants have none. A budget belongs to the source
anchor, including where its coverage crosses tile boundaries, and a blocked
guard is omitted rather than moved. Headstone ghost interactions in the
churchyard variants are separate from the guard budget.

Mystic Reef and Shellwater Strand each place eight stealthy shore crabs;
Mystic Reef also keeps its giant crab. Ordinary shoreline seats make crabs
common outside nexus coverage. Wild crabs attack, while caught and tamed crabs
remain pets.

Themed streets carry at most one finite encounter per street and owning tile,
however many fragments the map splits the line into (`StreetVariants`, the
`street_*` tiers in `src/lairs.js`). Barricades are held by their goblins.
Scenic path variants gain no guards.

Optional wetland and rock sites (`surfaceSites`) place a small finite group
outside other variants' owned ground. Home safety rules hide unsuitable
encounters without rerolling them.

The approved large enemies use separate 32×32 sheets with north, east, south
and west walking and attack frames. They render wider than one cell in the
same overhead, south-tilted view as the other characters. Giant bears join
surface forest encounters and Ancient Grove roamers. Citadels use bugbear
guards for ordinary garrisons; authored special groups keep their members.
Giant reapers join encounters and local garrisons in all five Old Stones
variants. Ogres lumber beside minor roads on residential ground, outside the
major-road buffer. These surface foes are tier 3 and remain hidden within
750 m of the starter anchor, through the existing Home safety rules. Road,
private-land and occupied-cell exclusions still apply.

The giant serpent remains a draft prototype and has no live spawn entry.

## Caves

A persistent spatial region selects a habitat theme from the depth band
(`THEME_BANDS`), and the theme's family is filtered through the roster's depth
limits, so neighbouring rooms differ without mixing every eligible enemy into
one bag. Shallow levels are mostly natural burrows; crypts, strongholds and
infernal territory deepen with depth. Infernal creatures arrive with the lava
level (`WorldGen.LAVA_DEPTH`) and carry `lavaImmune`.

Ghost haunting belongs to crypt habitats (`ghostsHaunt`, `src/creature_ai.js`),
not to every floor. A dragon is a finite chamber encounter in the deepest band
(`caveSites`), outside the ambient pool. Its seat needs a clear chamber away
from stairs; a blocked chamber means no dragon rather than one moved to a
neighbouring tile.

Trolls inhabit natural cave pockets on level 3 only; they are not surface foes.

## Behaviour and readability

Rooted plants guard their territory. Goblin fighters, spear users and archers
supply different distances; bomb carriers add a visible fuse and blast.
Shamans heal allies, while necromancers summon a bounded number of skeletons.
Summons have stable defeated identities, so reloading cannot create an endless
reward supply. Minotaurs and charging demons commit to a visible direction;
casters and dragons mark attacks before damage lands.

Sprite adapters keep each imported sheet's frame layout. The roster supplies
names and behaviour independently of art folders.

## Placement

Beach themes need a canonical beach in the map data (`Zones.anchorOf`); its
sand and directly associated park share one owner and one encounter budget.
Ordinary grove motifs leave sand alone. Untagged beaches stay ordinary shores;
a beach-like name alone does not create a themed encounter. Pirate Cove's
shipwreck is the daily shrine interaction; it reserves its whole footprint and
approach before other dressing, with a deterministic fallback
([zone-variants.md](zone-variants.md), "Beach family").

Enemy seats pass the normal road, occupancy and restricted-ground checks
(`WorldGen.isSpawnCell` with the creature's derived class). Street guards keep
the kerb setback even when their species moves slowly. Saved defeats,
generated source coordinates and independent placement streams keep finite
encounters stable across rebuilds.
