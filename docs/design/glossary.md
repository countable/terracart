# Game terminology glossary

## Purpose

Use one vocabulary for game design, comments and documentation. This glossary
records the preferred names, the other names in the repository, and the places
where those names describe different concepts. It does not rename APIs or change
mechanics.

## Scope

This covers shared world-generation, layout, progression and interaction concepts
found in maintained source and design docs. It is not an item, creature or story
character catalogue; those belong to their owning tables and the story bible.
Evidence links point to representative definitions and uses, not every occurrence.

**Finding:** terminology is not yet consistent. The largest issues are the scope
of **Nexus**, the overlap between **Landcover**, biome and basic zone, and the two
meanings that **Major road** would have under the requested road naming scheme.

Status meanings:

- **Preferred:** use this term in design prose; technical identifiers may differ.
- **Nonconformance:** wording names the same concept differently or leaves its scope unclear.
- **Technical name:** an API, data key or source-map term with a valid separate role.
- **Open:** the repository supports multiple meanings; the proposed distinction needs a design decision.

Use title case for glossary labels and UI category headings. Ordinary prose may
use lowercase common nouns (a nexus, landcover, a road variant); capitalization
alone is not a semantic error. Preserve proper names such as Home and Dragon Hood.

## World and object placement

| Preferred term | Meaning | Other names and conformance | Evidence |
| --- | --- | --- | --- |
| **Nexus** (scope open) | A special place with an anchor, authored objects and a chosen variant. This is the requested design term, but its exact extent is unresolved. | Three meanings coexist: a compact arrangement at a POI; the whole owned zone coverage; and just the temple-bearing kinds. Calling every influence zone a Nexus would broaden the last meaning. | [Local pattern](../../src/zones.js#L75); [whole coverage](generation.md#spawn-precedence); [temple-bearing kinds](../../src/zones.js#L175). |
| **Influence zone** | An anchor's surrounding field, with a kind, strength and terrain influence. | `Zones`, `ZONE_KINDS`, zone and special zone are established names. **Open:** whether Nexus replaces this design label or names a feature within it. “Zone” alone also appears for ordinary landcover, so qualify it. | [Zone model](../../src/zones.js#L2); [variant contract](zone-variants.md). |
| **Nexus variant** (proposed label) | The selected authored configuration for one special place: background, materials, POI arrangement, finds, guards and atmosphere. | Current contract says **zone variant**, with `ZoneVariants`, `anchor.variant`, `zoneVariant` and the JSON `zone` key. These are established technical names. A prose rename depends on the Nexus scope decision. | [Zone variants](zone-variants.md); [data-key explanation](../../src/zone_variants.js#L7). |
| **Landcover** | The ordinary ground category and its ambient object population, such as grass, forest or rock, before special-place and road-variant ownership. This is the requested design label. | **Nonconformance in design labels:** basic zone, basic tile and general zone/biome fill obscure this role. **Technical distinctions:** the literal map layers `landcover` and `landuse` are separate inputs; a terrain code is the final cell paint; a biome profile defines behavior. Keep those distinctions in implementation prose. | [General fill precedence](generation.md#spawn-precedence); [basic-zone data scope](../data/basic-zone-signatures.json); [biome registry](../../src/biome_profiles.js#L1); [map classification](../../src/worldgen.js#L1171). |
| **Terrain** | The ground type recorded in each grid cell, including roads, buildings and cave walls as well as natural ground. | Terrain and biome are paired loosely in `BiomeProfiles`. Terrain is broader than Landcover; replacing every occurrence would lose information. | [Terrain enum](../../src/worldgen.js#L353); [profile enum](../../src/biome_profiles.js#L21). |
| **Biome profile** | The registry of a ground type's flora, static objects, fauna and atmosphere. | Biome, per-biome feel and `BiomeProfiles` are valid names for this mechanism. It supplies Landcover behavior, but is not itself a map polygon or a Nexus. | [Registry definition](../../src/biome_profiles.js#L1). |
| **Road Variant** | The theme and authored dressing assigned to an eligible road; the shared table also supplies scenic path looks. | **Nonconformance in design prose:** street variant, street theme and special road when they mean the selected variant. `StreetVariants` and `STREET_VARIANTS` remain valid technical names. Scenic path themes have a separate selection mechanism. | [Road choice](zone-variants.md#choosing-a-variant); [street module](../../src/street_variants.js#L2); [path themes](../../src/scenic.js#L20). |
| **Layout** | The spatial arrangement of objects in discrete game cells. | Pattern, motif, composition and arrangement are related but narrower: a motif can repeat; a composition can remain fixed; a POI arrangement occupies slots beside the POI. A variant includes more than its layout. **Open:** the reusable allowed-layout catalogue discussed in design is not yet a declared shared runtime taxonomy. | [Integer-cell interpreter](../../src/zone_variants.js#L1); [placement contract](zone-variants.md#placement-contract). |
| **Object set** (proposed label) | The selected object types available to a layout. | `materials`, flora, static objects and filler are existing mechanisms with different roles. Do not rename them all to object set until a shared schema exists. | [Variant materials](../data/zone-variants.json); [biome accessors](../../src/biome_profiles.js#L15). |
| **Anchor** | The stable geographic identity and origin used to choose and place a special feature. | POI point is one anchor source, not its definition: generated quarries use parking-lane geometry. The blanket comment “An anchor is a POI POINT” is too narrow. | [POI-only wording](../../src/zones.js#L23); [generated quarry anchors](zone-variants.md#generated-quarries). |
| **Coverage** | The full area owned by a feature, including intentionally empty cells. | Influence footprint, associated park and placement fringe are components of the coverage union. Occupancy is different: actual objects and access requirements can block cells inside coverage. | [Coverage union](zone-variants.md#coverage-union); [precedence](generation.md#spawn-precedence). |
| **Halo / fringe** | A halo applies a zone's surrounding terrain influence; a fringe extends an ordinary park beyond its polygon. | These are related geometry mechanisms, not interchangeable names for a Nexus. A park fringe can exist without any anchor or Nexus reward. | [Halo and fringe definitions](../../src/zones.js#L39). |
| **Ambient fill** | Ordinary procedural objects outside higher-priority authored ownership. | General fill, biome scatter, ordinary scatter and procedural dressing are understandable aliases; use ambient fill when discussing the common placement role. “Dressing” also includes authored content, so is broader. | [Precedence](generation.md#spawn-precedence); [ownership](zone-variants.md#placement-contract). |
| **Cell / tile / footprint** | A cell is one allowed ground location; a tile is a map-data chunk containing cells; a footprint is the set of cells occupied by an object or feature. | These are distinct units. “Tile” in basic tile previews is ambiguous when it means a terrain category rather than a map chunk. Sprite pixels and visible bounds do not define interaction cells. | [Generation coordinates](generation.md#generation-saves-and-tiles); [footprint reservation](generation.md#spawn-precedence); [render seating](rendering.md). |
| **Scenic path / viewpoint / vista chest** | A scenic path is an eligible off-road route with a scenic classification. A viewpoint is a mapped landmark. A vista chest is a reward tied to the scenic system. | These are related, not aliases. `Scenic` explicitly distinguishes itself from a zone; a viewpoint has no zone field or terrain paint. | [Scenic definitions](../../src/scenic.js#L8); [zone distinction](../../src/scenic.js#L68). |

## Roads and paths

The requested design labels are **Major road**, **Medium road**, **Small road**
and **Path**. The terrain model has four corresponding categories, but the
current word **major** also means the union of its two larger categories in road
safety and variant selection. A global search-and-replace would change meaning.

| Requested label | Terrain and map classes | Current names and required distinction |
| --- | --- | --- |
| **Major road** (proposed single-tier label) | `T.ROAD_LG`: motorway, trunk, primary. | Called **large road**, `lg_road`, `LARGE_ROAD_CLASSES`, or “big ways.” **Open:** adopt Major for this tier only after naming the combined safety/variant group explicitly. |
| **Medium road** | `T.ROAD_MD`: secondary, tertiary. | Medium road and `md_road` map directly. This tier is also currently a **major** road for safety and variant selection. |
| **Small road** | `T.ROAD`: minor, service, street, plus the classifier's fallback. | Small road and `sm_road` map to the terrain tier. **Minor street** in variant selection is narrower: only minor/street classes, excluding service ways. |
| **Path** | `T.PATH`: path, footway, track, pedestrian, cycleway, steps. | Footpath and walking path are common prose aliases. Map class `path` is narrower than the whole game category. Scenic eligibility and variant eligibility do not include every `T.PATH` class. |

Evidence: [terrain enum](../../src/worldgen.js#L362),
[classification](../../src/worldgen.js#L1226),
[variant size selection](../../src/street_variants.js#L443),
[large and medium wording](../process/SANDBOX.md#L107),
[sm/md/lg reference data](../data/underground-zone-variants.draft.json).

For new explanatory prose, spell out **Major and Medium roads** when referring
to the combined group under the proposed labels. Existing `ROAD_CLASS_MAJOR_*`,
`inMajorBuffer`, `size: 'major'` and `sizeOfTags()` continue to mean **ROAD_LG +
ROAD_MD**. Retaining these technical names requires explicit comments; changing
them would be a separate refactor.

Other road concepts:

| Term | Meaning and naming guidance | Evidence |
| --- | --- | --- |
| **Road band** | The actual drawn carriageway width. Terrain cells, road mask and geometric band are related representations, not synonyms. | [Road mask](generation.md#generation-saves-and-tiles). |
| **Kerb buffer** | Safety area around the combined MD/LG road band. Kerb, verge and buffer sometimes appear together, but a verge is a placement location and need not equal the safety mask. | [Safety bits](../../src/worldgen.js#L2075); [safety rule](generation.md#generation-saves-and-tiles). |
| **Street** | A named route within a parish for variant identity; restoration measures pieces of source geometry. Neither meaning is a road-size tier. | [Variant identity](../../src/street_variants.js#L4); [restoration geometry](../../src/streets.js#L18). |
| **Old Trade Road** | Narrative/thematic name for the existing major-group road treatment. `bandit`, `BANDIT_STORY` and bandit-verge keys are retained technical names; they are not an additional road tier. | [Declared old internal name](../../src/street_variants.js#L14). |
| **Thorny Path** | Proper name of a Road Variant whose `size` is `minor`. Its title does not make its substrate a `T.PATH`; explain this when listing variant eligibility. | [Variant row](../../src/street_variants.js#L320). |
| **Pier** | Separate ground category `T.PIER` for a walkway over water; some scenic logic treats it as a walking route. It is not `T.PATH` terrain. | [Classifier](../../src/worldgen.js#L1250); [scenic routes](../../src/scenic.js#L8). |

## Special-place families

These names are layers of identity, not interchangeable labels. Keep the family,
terrain and individual variant separate when defining allowed layouts.

| Design family | Other names / keys | Distinction | Evidence |
| --- | --- | --- | --- |
| **Grove** | Sacred Grove, `grove`, `T.GROVE` | A grove anchor is distinct from ordinary park landcover and from the terrain it paints. | [Family row](../../src/zones.js#L188). |
| **Old Stones** | Churchyard, `stones`, `T.CHURCHYARD` | Old Stones names the special-place family; churchyard names its ground. Real cemeteries are quiet land and do not mint this authored zone. | [Family row](../../src/zones.js#L194); [sensitive places](../../src/zones.js#L17). |
| **Tar Yard** | `tar`, `T.TAR_YARD`, fuel-station anchor | Tar hazards are objects within the place, not its coverage. | [Family row](../../src/zones.js#L199); [geometry versus density](zone-variants.md#placement-contract). |
| **Shore** | Beach family, `beach` | The zone family differs from ordinary sand landcover and from the scenic shoreline system. Beach is a valid data key; using it for all three without qualification is ambiguous. | [Family row](../../src/zones.js#L184); [beach contract](zone-variants.md#beach-family); [scenic beaches](../../src/scenic.js#L37). |
| **Quarry** | `quarry`, quarry site, parking-lane site | The family can select crater, abandoned quarry, strip mine or stronghold configurations. Ordinary rock terrain is not automatically a quarry. | [Generated quarries](zone-variants.md#generated-quarries). |
| **Temple / shrine / keeper** | Temple-bearing Nexus, `grove_shrine`, zone keeper | A temple is a building/room feature; a shrine is a daily interactable; a keeper is an NPC role. These are components of a place, not aliases for Nexus. | [Temple and keeper flags](../../src/zones.js#L171); [shrine contract](zone-variants.md#placement-contract). |

## Progression and interactions

| Preferred term | Meaning | Aliases, narrower concepts and nonconformances | Evidence |
| --- | --- | --- | --- |
| **Dragon Hood** | Game title. | TerraCart, Pocket Acres and Mending Lane are former titles. **Nonconformance:** using them for the current game. `terracart.*` storage keys remain required technical names; Mending Lane remains the starting neighbourhood. | [Title history](spec.txt#L1); [root policy](../../CLAUDE.md#purpose). |
| **The Hood / the Breaking** | The protagonist's story name / the world-changing event. | Survivor describes the protagonist's apparent role. The night the roofs fell is an in-world name for the Breaking, not a terminology error. Story names and unresolved canon belong to the story bible. | [Story premise and world](story.txt#L15). |
| **Home** | The player's home location and its rest, light and ward context. | Spawn/start location and trailer are associated references, not universal synonyms for every Home mechanic. `HomeArea` and `homeWorldPos()` are technical owners. | [Home rules](combat.md); [home context](spec.txt#L1083). |
| **Energy** | The player's spendable pool for jobs and incoming damage; pets also have their own energy. | Health/HP is appropriate for enemy combat health. Calling the player's resource HP would obscure the shared energy mechanic; “health bar” in foe UI is intentional. | [Energy and damage](combat.md); [energy definition](spec.txt#L228); [foe health](spec.txt#L498). |
| **Reach** | The player's current interaction range. | Lit reach/range connects the same range to its visual display. Viewport, sight and projectile range are distinct concepts. | [Reach rules](spec.txt#L206); [rendering](rendering.md). |
| **Work wheel** | The timed-action interface for jobs. | Working/job describes the action state. Combat has its own timing and health display rather than a work wheel. | [Interaction rules](spec.txt#L220); [job energy](combat.md). |
| **Restoration** | Repairing the world through building restoration or road-band restoration. | Mending is valid story language. A fort is unsealed; a castle is claimed: these are different actions, not merely renamed wreck restoration. | [Building roles](../../src/houses.js#L1); [fort unlocking](../../src/houses.js#L21); [street restoration](spec.txt#L580). |
| **Restoration ladder** | The shared progression that banks restored street/path metres and awards prizes. | `Trail` is its technical module. **Ambiguity:** onboarding trail/crate trail refers to starting placements, not this prize ladder. | [Ladder](../../src/trail.js#L2); [starter trail](spec.txt#L137). |
| **Living lamps** | Restored route lamps that provide the recurring re-walk credit. | Lamp light is a visual/source mechanism; first-time restoration credit and scenic bonuses are separate reward rules. | [Lamp credit distinction](../../src/scenic.js#L14); [street lamps](spec.txt#L606). |
| **Memory** | A discovery-triggered story progression event. | Discovery is the recorded first find that triggers it; `save.discovered` is the technical ledger. Memory is not a general synonym for every reward or restoration. | [Memories](spec.txt#L878). |
| **Chest / crate** | A chest gives once; an eligible crate restocks. | Cache and hoard describe authored finds/themes and should be qualified by their actual interaction or reward mechanism. Pots/barrels can use chest reward ledgers without becoming crates. | [Rewards and restocking](generation.md#generation-saves-and-tiles). |
| **Relic** | Equipment or a special tool/reward in the relic system. | Gear, tool and weapon are broader or role-specific descriptions. Relic chest names the starter reward source, not every chest containing equipment. | [Tools and equipment](spec.txt#L850); [starter relic chest](spec.txt#L144). |
| **Lair / garrison / guard / encounter** | A lair is an occupied derelict structure; its garrison is the authored enemy group. A guard protects a feature. An encounter is a separate themed spawn mechanism. | Foe, enemy and monster are ordinary aliases at the creature level. Replacing all four group/placement terms with encounter would erase ownership and budget differences. | [Lairs](../../src/lairs.js#L2); [finite guards versus encounters](zone-variants.md#placement-contract). |
| **Pet / companion / fauna** | A pet is an individually owned animal; a companion can be a timed follower; fauna are ordinary world animals. | Tamed, carried and deployed describe lifecycle states, not interchangeable ownership systems. `save.released` also stores pet records, so its name alone does not imply unowned. | [Pet and follower ownership](combat.md). |
| **Condition / buff / boon** | Conditions model status effects; buffs model timed benefits; shrine boons are place-granted benefits. | Status effect/status chip can describe their presentation. Shared presentation does not mean the underlying registries or durations are interchangeable. | [Status and buff rules](combat.md); [shrine story](story.txt#L45). |
| **Floor / depth / level** | Floor names a playable vertical layer; depth is its underground index. | Cave level and dungeon floor are valid aliases in context. Level is ambiguous with other progression; tower floors are aboveground and need an explicit direction. | [Floor catalogue](floors.md); [surface-owned geometry](generation.md#generation-saves-and-tiles). |
| **Spawn gate / spawn class** | The shared placement permission mechanism and the category of object asking for a cell. | `minor` is a spawn class for scenery/flora as well as a road-group word elsewhere. These are independent meanings; qualify the term. | [Spawn gate and classes](generation.md#generation-saves-and-tiles). |

## Cleanup boundaries

1. Resolve whether Nexus names the complete special place, its focal composition,
   or a subset of place families. Then align the zone contract, module headers
   and review labels with that scope.
2. Adopt the requested four road labels in design/UI text and explicitly name
   the combined MD/LG safety and variant group. Preserve map tags and runtime
   values until a separate tested refactor changes them.
3. Use Landcover for ordinary ground/object-set design, while retaining terrain,
   biome profile, `landcover` and `landuse` where their technical distinction matters.
4. Prefer Road Variant over street variant in design prose. Retain proper names,
   such as Thorny Path, and document their actual eligible road category.
5. Extend this glossary when a shared concept is coined. Keep item/creature names,
   numeric tuning and detailed mechanics in their owning catalogues and docs.
