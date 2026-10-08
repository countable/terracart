# Sandbox test world

Load `index.html?sandbox=true`. The sandbox replaces the start tile with a
hand-laid town and countryside map. It keeps sparse mechanics close together,
because a tester can compare their art and interactions without waiting for a
real-world roll. `src/sandbox.js` owns the map.

For simulated travel, enable **☰ → Developer → GPS stick**. The blue left
stick moves the GPS fix; the ordinary stick still moves the character relative
to it. First movement takes over from device GPS for this session. Hiding the
stick keeps the simulated fix; reload to restore device GPS in normal play.

## Floor viewer

`tools/floor-viewer.html` builds its compact region through the live generation
pipeline. Variant index 0 uses natural selection. Each later index advances
all Nexus kinds and road groups together; each group wraps through its own
variant rows. The index completes a shared cycle before returning to natural
selection. Surface paths cycle scenic themes, and cave paths and small roads
cycle their underground themes. Placement rules still decide whether a layout
fits; the viewer reports declined placements.

## Jump links

Use `index.html?sandbox=true&sandboxZone=forest` to start at a named destination.
Examples include `beach`, `wetland`, `golf`, `castle`, `fort`, `grove`, `stones`,
`tar`, `practice`, `hazards`, `hazards-cave`, `restoration`, `meadow` and `crater`. Road destinations include `hedgerow-road`, `orchard-road`,
`thorny-road` and `parkpath`. `src/sandbox_destinations.js` owns the shared catalog used by
the game and design dashboards; coordinates come from the authored layout.

Existing `sandboxScene=FOREST` or `sandboxScene=PRACTICE` links still work.
Names are case-insensitive; unknown names return to the player plaza.
These links visit the sandbox's representative biomes, not every procedural
variant shown by the dashboards. Unsupported biomes have no jump link.

The Old Stones destination (`?sandbox=true&sandboxZone=stones`) includes an
awakened temple. Tap its marble footprint to enter the giant-reaper challenge
on floor +1. Walk off the platform to return to the ground, then enter again
to verify the fresh challenge; rewards remain limited to one per temple.

## Why scenes and vector roads

A real residential polygon is a scene, not a colour swatch. A road passes
houses, yards carry flora, and rocks collect near the kerb. The sandbox builds
the same composites.

The sandbox also supplies decoded transportation geometry with the same shape
as a vector tile. `RoadOverlay`, `Streets`, `StreetVariants` and the lamp pass
therefore read their normal inputs. The terrain grid and vector geometry come
from the same route table, so the visible road matches its spawn mask,
restoration metres and dressing.

## Layout from north to south

```text
Band 1  COUNTRYSIDE      FOREST · ORCHARD · ROCK
   -- Oak Road: hedgerow (road) --
Band 2  WATER & PASTURE  BARNYARD · PETTING PADDOCK · BEACH/PIER · WETLAND/GOLF
   -- Main Street: Lantern Row (road_lg) --
Band 3  CENTRE           PLAYER SPAWN · FARMLAND · SPELLS/POTIONS/FIRE
   -- Mill Lane: Burned Row (road_md) --
Band 4  TOWN             RESIDENTIAL ST · CIVIC BLOCK/PATH · SMALL HOUSE
   -- Garden Row: Toadstool Lane (road) --
Band 5  RECREATION       PARK/PARK PATH · PLAYGROUND · PITCH · CASTLE/FORT · HAZARDS
Band 6  NEW MECHANICS    STREETS · ZONES/MEADOW/CRATER · RESTORATION/ENCOUNTERS · QUARRY/RUINS
```

The footprint is 70 x 102 cells, about 490 m x 714 m at 7 m per cell.
`buildLayout` centres it in the start tile. The player teleports to PLAYER
SPAWN, where a synthetic Home trailer keeps the nearby wizard tower in its
wizard role.

## Map-system coverage

| System | Sandbox coverage |
|---|---|
| Vector roads | Decoded `transportation` and `transportation_name` layers drive the live road overlay. |
| Spawn safety | `roadMask`, `roadClass`, `spawnWhy` and the Major-and-Medium road group kerb buffer derive from the authored routes; the buffer is stamped one cell wider than the real one, so refusals stay conservative. |
| Street restoration | Half of Lantern Row starts restored, so lit and unlit lamps appear on one road. |
| Road variant dressing | The live `StreetVariants.dress` pass places hedges, trees, fruit trees, mushrooms, coins, waystones, barricades, tar, stakes and torches. |
| Old Trade Road | A plain Major or Medium road carries the bandit-verge bit and a hashed wagon-stop look. |
| Street rewards | Golden Road coins, street lairs and a cafe hoard use their normal generated records. |
| Scenic paths | Common Walk is a `parkpath`; the beach carries a scenic shore mask, tide pool and viewpoint scope. |
| Nexuses | Grove, Old Stones and Tar Yard anchors carry real Nexus coverage and run `ZoneDressing`. |
| Shrine kinds | The zones scene's east edge stands one shrine of each `Shrines.SHRINE_KINDS` row, north to south in table order; tap one for its boon. |
| Surface traps | `Traps.spawnSurface` places traps beside paths and park edges from the shared spawn fields. |
| Placed floor | One campfire joins the existing crops, tilled beds and scarecrows. |

<a id="street-variants"></a>

### Road variants

| Variant | Road | What it exposes |
|---|---|---|
| hedgerow | Oak Road | clipped hedges and a habitat gate |
| lantern | Main Street | dense amber lamps; half restored |
| burned | Mill Lane | tar, stakes, torches and slow cells |
| toadstool | Garden Row | mushroom verge and teal lamps |
| overgrown | Fern Way | staged roadside trees |
| orchard | Cherry Lane | alternating apple and maple rows |
| pilgrim | Abbey Walk | waystone end piece |
| golden | Coin Row | persistent verge coins |
| thorny | Thorny Way | brambles and a narrow road corridor |
| snare | Iron Lane | a snare chest ringed by iron teeth |
| barricade | Fort Road | barricades, stakes and guard lair |
| plain minor | Market Close / Maple Street | ordinary street comparison |
| plain major | Old Trade Road | old-trade-road lamps and wagon stop |
| parkpath | Common Walk | scenic path colour, lamps and reward multiplier |

This table covers every rolled minor and major row in
`StreetVariants.STREET_VARIANTS`. Scenic promenade and greenway rows still
need geography that the sandbox does not author.

## Terrain coverage

The surface tile contains every surface terrain code. Cave floor and wall codes 24-25 belong to depth tiles. The crater now paints
code 26 (lava) through the shared quarry layout.

| Codes | Terrain | Scene |
|---|---|---|
| 0-6 | grass, forest, sand, water, farmland, residential, park | countryside, beach, centre, town, recreation |
| 7-8 | road, path | connective roads, Maple Street, Common Walk and Civic |
| 9-12 | building tiers and rock | Small House, Castle/Fort and Rock |
| 13-14 | large and medium roads | Main Street, Mill Lane, Fort Road and Old Trade Road |
| 15-23 | school through pier | Civic, Recreation, Marsh, Orchard and Beach |
| 26 | lava | Destroyed crater |
| 27 | wasteland | vacant residential lot |
| 28 | grove | Sacred Grove |
| 29 | churchyard | Old Stones |
| 31 | tar yard | Tar Yard |

## Interactables and hazards

The original scenes retain the farming, mining, shops, chests, wells, castle,
treasure, fishing, wild plants, released pets and crop-growth coverage.
The new scenes add:

| Kind or state | Scene |
|---|---|
| `grove_shrine` | Sacred Grove |
| `headstone`, `infoboard` | Old Stones |
| `tar`, `stakes`, `torch` | Tar Yard and themed roads |
| `waystone` | Abbey Walk |
| `vista_scope` and scenic chest | Recreation viewpoint |
| `coindrop` from Golden Road | Coin Row |
| surface trap | Common Walk and park edges |
| campfire | Player Plaza |
| street and cafe lairs | themed streets |

## Creatures and combat

| Group | Kinds | Scene |
|---|---|---|
| Farm and pets | chicken, cow, cat, dog, released tame animals | Barnyard, Farmland, Paddock |
| Wildlife | rabbit, deer, crow, butterfly | Forest, Recreation |
| Shore | gull, giant crab, fish | Beach |
| Basic foes | slime, plant | Forest, Barnyard, Recreation |
| Melee and armour | goblin, skeleton, zombie | Grove, Old Stones |
| Ranged and rooted | goblin archer, copper plant | Grove |
| Special movement | ghost, fire slime | Old Stones, Tar Yard |

The sandbox seeds these creatures through `WorldGen.makeCreature`, so combat,
art, movement and hostility still resolve through the shared roster and
`Combat.isEnemy`.

## Test kit

### Restoration, services and recent encounters

Open `index.html?sandbox=true&sandboxZone=restoration` for two untouched
wrecks, ranked smithies (T1-T3), a trader, Seed/Supply Shops, the Book Shop,
Pet Shop and a turret. Use the stocked Magic Hammer on a wreck, then use a
Renovation Permit on a ranked building. Reload clears fixture restorations,
shine and renovations. Residential Street also uses explicit current build
cards instead of address-derived shop roles.

The save receives enough prior restorations to unlock the current first tower,
and at least 15 actual item discoveries to unlock ranks through T4. Unspent
memories alone do not unlock shop ranks. Authored buildings are restored using
`Houses.restoreAs`, so roles, ranks and one-off shop identities use the live
ledgers. The two marked wrecks remain unrestored until the tester chooses.

The eastern service row has all nine macro types: inn, chapel, scholar,
training, guildhall, curio, sundries, scriptorium and apothecary. A repeatable
crate, permanent barrel and clay pot, and a chest whose stable ID passes the
real mimic roll compare container behavior. The southern encounter area adds
mushroom monster, disguised treant, fire elemental, mimic, wurm and zombie
recipients for weapons, thrown potions, tomes and conditions.

`meadow` visits the real ordinary-bush dressing at its current 31.5% density;
`crater` visits the rounded lava pool and Ember altar generated by the real
quarry dresser. These are owned zone fixtures, so finite finds and guards also
run normally. `strip-mine` and `ruins` visit additional real quarry layouts,
including rock-covered finds, burrowing guards and breakable ruin walls. The
paddock includes a newborn shiny chicken, an adult shiny chicken and a bush
whose stable ID passes the real nest roll. The beach has a readable bottle.
`encounters` jumps directly to the enemy recipients. `thorny-road` visits the existing bramble corridor.

### Hazard lab

`hazards` visits a live spider, a landed web and a temporary sinkhole. The
spawn is clear of their contact cells. The web uses the normal saved landing
record and expiry; stepping off and back on tests paralysis renewal.

`hazards-cave` starts at depth 1 with three vents (poison, fire, paralysis),
a rolling ball, a sliding wall and a connected pair of cave-in cells. Arrival
and reset light a normal torch from the test kit, making the warnings visible. Walk
onto a plate to launch its trap; each plate fires once. Vents use their normal
inactive/warning/active cycle. Cave-ins start their five-second warning on
load and stay open. `cavein` lands beside the cracks to watch the full warning;
a second reset label there repeats the sequence without walking back. Depths 1 and 2 have authored empty floor tiles so falling
uses the real landing search and depth transition without a network wait.
The floor tiles retain the surface exclusion masks.

Tap **RESET HAZARDS** near the arrival point or reload the destination to reset
its fixtures. Surface hazards arm on approach when arriving from another scene. Browser probes can also call
`Sandbox.seedHazardState(scene, scene._sandboxHazardOrigin)`; the returned
records and `scene._sandboxHazardFixtures` carry `_sandboxProbe` tags. This
resets transient hazard lists and authored web/cave-in progress. The full kit
includes defenses: remove them and any active Flight/Immortal effects when
measuring raw damage, then equip/apply them for immunity comparisons.

### Recent combat mechanics

Open `index.html?sandbox=true&sandboxScene=PRACTICE` to start in the test yard
east of the farm. Any named scene in `src/sandbox.js` can be selected with
`sandboxScene`; unknown names fall back to Player Spawn.
The 14-cell-high yard keeps its combat targets clear of the major-road safety
buffers. Its spawn sits one cell south of the ordinary plant, inside its
attack range even after the movement stick returns to its anchor.

- Three rooted plants compare Giant, Shrinking and ordinary size. The first
  two receive actual potion effects on load, with normal expiry and health caps.
- A chicken, goblin and goblin archer provide friendly, melee and ranged
  recipients for thrown potions, sleep powder, scrolls and weapons.
- The upper tree/shrub/tar/grass patch starts burning. Watch spread, enemy
  escape, consumed shrubs/tar and the surviving charred tree. The lower patch
  starts fresh for flasks, Fireball and the Wall of Fire Tome.
- All new potions, scrolls, blank scrolls, the tome, Ember Ring and weapon
  supplies are in the bag. Dagger, lance and musket relics join the T3 kit.
  Use a scroll, then return Home to check its newly learned crafting recipe.
- Reload resets fire history, creature potion effects and shared and per-tome cooldowns, so
  the same fuel can burn again. Scroll learning is retained for crafting checks.

The full bag includes passive shields and rings: remove shields when checking
unmitigated mushroom confusion, and remove the Ember Ring when measuring raw
lava damage. The full kit intentionally makes some hazards harmless.

Check Giant/Shrinking body size and health bars, thrown-potion impact effects,
fire resistance, Protection/Immortal damage handling and Time cooldown reset.
The yard uses the real runtime paths; effects expire and targets move normally.
Generation-only chest top-ups and cave tier caps remain covered by node tests.

- The inventory starts with five of every item and at least 20 memories.
- Every relic and armour piece starts at T3. The pickaxe and axe start at T7 so every
  ore deposit and barricade can be cleared.
- Energy starts full.
- Sandbox houses start restored except for the two restoration-yard wrecks;
  each standing building uses its explicit build card and rank.

## Limits

- Procedural coral reefs, their source water geometry and whole-world spawn
  frequencies remain in their dedicated tests and real map.
- Procedural cave geometry and depth progression remain in the cave tests and
  real map. The hazard lab uses authored cave floor and real fall transitions.
  Surface crater lava and selected cave enemy recipients are also available.
- The sandbox authors decoded layer objects rather than fetching MVT bytes. It
  exercises downstream map systems, while parser and live fetch coverage stays
  in the fixture/browser tests.
- Park polygon characters and residential lot-ring flora depend on source
  polygon stamps. The sandbox uses the common park profile and its existing
  ambient fill instead.
- Scenic promenade and greenway classification still need coastal and corridor
  geometry beyond the one park path and shore authored here.

Every load rebuilds inventory, gear, crops, released pets, placed rocks,
restoration fixtures, potion effects, fire history and tome cooldowns,
campfires and street restoration for a predictable baseline. Scene captions
float above the map. To extend the world, add a scene to `BANDS` or a route to
a scene's `routes` table, then update this coverage matrix and
`test/node/sandbox_coverage.test.js`.

## Browser probes

With the local HTTP server running, use the following scripts (Python Playwright
and Chromium required). Each creates an isolated browser save and writes JSON
results and screenshots to `--output`:

```sh
python3 tools/probe_sandbox.py --url 'http://127.0.0.1:8000/index.html?sandbox=true&sandboxScene=PRACTICE'
python3 tools/probe_sandbox_week.py --url 'http://127.0.0.1:8000/index.html?sandbox=true&sandboxScene=PRACTICE'
python3 tools/probe_sandbox_services.py --url 'http://127.0.0.1:8000/index.html?sandbox=true&sandboxZone=restoration'
python3 tools/probe_sandbox_world.py --url 'http://127.0.0.1:8000/index.html'
python3 tools/probe_sandbox_hazards.py --url 'http://127.0.0.1:8000/index.html'
```

The weekly probe checks restoration/permit dialogs, potion impact states and
summoned allies. Services checks purchases, progression, daily rewards,
scroll crafting and pet pickup. World checks real lava/hazard ticks, enemy
ambushes and attacks, covered-find mining, work-speed boosts and container
ledgers. World cases pause the scene and advance isolated work/combat timers;
they remove carried defenses when measuring unmitigated damage. These checks
exercise runtime handlers, not a full GPS walking session or every loot roll.

Hazards checks both desktop and touch viewports: web entry/re-entry, vent
warning/contact cadence, moving and spent pressure traps, pit phases and real
falls, cave-in warning art, Flight, reset-label taps and foreground pause/resume.
It advances isolated hazard clocks in bounded steps and waits for a live render
frame before capture. Each case clears browser saves while retaining the
static asset cache.
