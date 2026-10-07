# Zone variants

An influence zone's kind is a row of `Zones.ZONE_KINDS` (`src/zones.js`):
`quarry`, `beach`, `grove`, `stones` (the old stones / churchyard) and `tar`
(the tar yard). Each anchor of a kind resolves to one zone VARIANT
(`anchor.variant`; placed objects carry it as `zoneVariant`). The variant rows
are declarative data in [zone-variants.json](../data/zone-variants.json): background
motif, materials, POI arrangement, finite finds, guards, connection shape,
fauna pull and atmosphere. That file owns every count, density, offset,
weight and material; this file states the rules the data and runtime keep.

The game and map review load the table through `src/zone_variant_data.js`.
Regenerate it after editing the JSON with
`node tools/zone_variant_data.js --write`; `--check` verifies it read-only.

## Runtime owners

- `ZoneCoverage` (`src/zone_coverage.js`): the coverage union and its one
  winner per cell; generated quarry sites.
- `ZoneVariants` (`src/zone_variants.js`): variant choice (`pick`), traits
  and motif sampling.
- `ZoneDressing` (`src/zone_dressing.js`): materials, POI arrangement, finite
  finds, connections (`connectionSteps`, reading the row's
  `connection.shape`) and guards, all through the shared spawn gate.
- `QuarryLayout` (`src/quarry_layout.js`): quarry modules and their budgets.

## Choosing a variant

Choice is deterministic from the stable anchor identity, never tile load
order or save state. An explicit `anchor.variant` of the right kind wins.
Otherwise row weights are scaled by soft affinities between the variant's
traits and its surroundings (`TRAITS`, `RELATED`, `OPPOSED` in
`src/zone_variants.js`): context proportions are averaged, never multiplied,
and every eligible variant keeps a nonzero chance. Context is the anchor's own
geographic POI tags, falling back to its park character; it never infers a
parent from a neighbouring tile's clipped polygon.

Special roads roll rarity independently of theme. Street names and the
surrounding zone variants adjust only the conditional theme weights: once
coverage is final, each eligible road samples its own segments
(`StreetVariants.AFFINITY_SAMPLE_M`), weights the covering variants' traits by
length and picks one theme for all its fragments. Roads clipped at a tile
edge use neutral context. No extra tiles are fetched; rendering reads the
stored street index without rerolling.

## Coverage union

Coverage is the union of the ragged influence footprint, the park polygon
that contains the anchor, and that park's placement fringe (`FRINGE_FILL_M`).
A zone without an associated park uses its influence footprint alone. Parks
associate through the source polygon containing the anchor, never mere
proximity. Overlaps resolve once per global cell by the existing influence
strength / kind / key order; fringe-only ties by stable anchor key. Then the
shared spawn gate applies: cemeteries and other quiet or restricted land stay
excluded, and unnamed parks keep their fringe without gaining zone rewards.

The variant frame runs continuously over the union. Fixed compositions
intersect their footprint with it; they never stretch or repeat to fill it.
Expanding coverage never multiplies the per-anchor find or guard budget.

## Placement contract

- **Ownership.** Variant coverage replaces procedural biome scatter and
  street dressing, including their empty lanes (CLAUDE.md, "Spawn
  precedence"). Mapped POIs, buildings and authored features stay occupied.
  Generic rooted plants, traps and treasure stay outside coverage; authored
  finds and traps keep their own budgets.
- **Ground.** Zone ground styling overrides ordinary zoning across the union;
  roads, paths, piers, water and buildings keep their footprint, and source
  land's spawn reasons and trap rules stay authoritative.
- **Frame.** The world-to-pattern mapping is phased from the settled POI
  (`background.poiOrigin.cell`) and oriented toward the POI's accessible
  approach, quantised to a quarter turn, with a stable anchor fallback. Every
  tile resolves the same frame, so a zone never restarts its phase at a seam.
- **Motifs.** Repeating motifs stay small enough to read at a glance; choose
  dimensions for the pattern, not a padded square. Seeded scatter is used
  only where a row declares it, keyed by anchor, variant and global cell, so
  it never changes between visits. A `material.cycle` phase is per bed, so
  beds stay monochrome.
- **Geometry before density.** Recognisable geometry wins over any density
  target. Density is measured from the declared geometry before obstacles;
  never thin a continuous line to meet a number. Hazards (tar, traps) are not
  coverage.
- **Blocked cells.** Compact beds stay whole or move whole; continuous lines
  are clipped only by the coverage edge, reserved POI space and ineligible or
  occupied cells. Never fill gaps with random scatter.
- **POI arrangement.** It touches the settled chest and replaces only the
  slots it occupies; blocked slots are omitted, not pushed outward. A POI
  inside a building uses the row's `whenInsideBuilding` arrangement beside the
  settled frontage.
- **Finite finds.** Planned once per anchor on its owning tile, across tile
  boundaries; deterministic fallback seats inside the union; an unmet count is
  reported as a shortfall, never spilled onto forbidden ground.
- **Gate classes.** Background material uses `minor`; finds use `attractor`;
  guards and headstones use their enemy / `headstone` class
  (`WorldGen.isSpawnCell`). A blocked headstone becomes ordinary stone; a
  blocked guard is omitted without removing its find. Surface traps also pass
  `Traps.isTrapGround`.
- **Shrines.** The grove shrine stays the one daily interactable per POI. A
  variant named in a `Shrines.SHRINE_KINDS` row's `zones` makes that shrine
  its kind; churchyard and tar-yard shrines stand on the first free ring cell
  within `Zones.SHRINE_SEAT_R`.
- **Encounters.** Themed surface encounters are rows of
  `EnemyHabitats.SURFACE_FAMILIES` rolled by `SURFACE_ENCOUNTERS`
  (`src/enemy_habitats.js`), separate from finite guards and ambient enemies.
- **Fauna.** A variant's `attracts` column relocates the tile's existing fauna
  onto its coverage (`_seatFaunaOnFavouriteGround`, `src/scene_creatures.js`);
  it never adds spawns. The variant column replaces the zone kind's
  affinity; an empty column means no pull. Fauna may share interactable
  cells but keep their terrain and road limits.

## Generated quarries

Parking-lane geometry becomes quarry coverage instead of visible road; the
lanes stay out of pavement, street variants, lamps and restoration, while real
access roads remain roads. Parking geometry is removed before road masks and
nexus fitting; the filter also recognises tightly constrained unlabelled
service-road patterns (`src/worldgen.js`, lot lanes) but keeps driveways,
alleys and the access road. Lane buffers merge into sites through eligible
ground only; roads, paths and water divide sites; holes stay holes.

A complete site picks one of the four `quarry` rows (crater, abandoned
quarry, strip mine, stronghold), fitted by `QuarryLayout` around the spawn
gate, with names from `ZoneCoverage`. Site sizes, gaps and module shapes are
`quarryLayouts` in the JSON. Too-small fragments stay ordinary ground. A site
touching a tile edge cannot know its full footprint, so it falls back to
cell-addressed strip-mine scatter with no finite finds, guards or partial
crater, labelled as an edge site. Mined, opened, dug and defeated things use
the existing progress ledgers and never refill.

## Beach family

The beach rows are live. Shoreline orientation derives from buffered mapped
water at the canonical anchor, with a reported deterministic fallback. Zone
placement reserves the daily tide-pool seats, including seats empty today.

- The shipwreck is one interaction; reserve its whole footprint, never just the anchor cell.
- If an authored footprint cannot fit, take the deterministic fallback or report the shortfall; never spill into higher-priority space.
- Beach rewards come from the variant rows; nothing double-dips the grove shrine or tide seats.

## Building-aware fitting

Where a complete owner-local site cannot hold a variant's composition, the
dressing may fit a smaller intact arrangement or a frontage bed along a
building (`src/zone_dressing.js`, "zone frontage fit"). Finite finds, shrine
and guards seat first; only background material shrinks. Otherwise it reports
a composition shortfall.

## Review tools

- Preview straight from the table (Node.js, Python 3, Pillow):
  `python3 tools/preview_zone_variants.py docs/data/zone-variants.json <out>` and
  `python3 tools/preview_beach_variants.py <out>`. The generator validates
  densities over full cycles, POI positions, grid continuity and find counts;
  its coverage diagram is schematic.
- The map review (`tools/map-review.html`, `tools/map-review-zones.js`) shows
  variant labels, each zone's union, live placements and what occupancy or
  the gate removed; `?quarryClusters=1` (with `removedLanes=1`) colours quarry
  ownership. These are read-only views of the game's own generation.

Tests: `zone_variants`, `zone_coverage`, `zone_dressing`, `zone_ground`,
`zone_runtime`, `zones`, `quarry_layout`, `quarry_coverage`,
`beach_orientation`, `fauna_seat_pools` (`test/node/*.test.js`).
