# Sandbox test world

Load `index.html?sandbox=true`. The sandbox replaces the start tile with a
hand-laid town and countryside map. It keeps sparse mechanics close together,
because a tester can compare their art and interactions without waiting for a
real-world roll. `src/sandbox.js` owns the map.

For simulated travel, enable **☰ → Developer → GPS stick**. The blue left
stick moves the GPS fix; the ordinary stick still moves the character relative
to it. First movement takes over from device GPS for this session. Hiding the
stick keeps the simulated fix; reload to restore device GPS in normal play.

## Jump links

Use `index.html?sandbox=true&sandboxZone=forest` to start at a named destination.
Examples include `beach`, `wetland`, `golf`, `castle`, `fort`, `grove`, `stones`,
`tar` and `practice`. Road destinations include `hedgerow-road`, `orchard-road`
and `parkpath`. `src/sandbox_destinations.js` owns the shared catalog used by
the game and design dashboards; coordinates come from the authored layout.

Existing `sandboxScene=FOREST` or `sandboxScene=PRACTICE` links still work.
Names are case-insensitive; unknown names return to the player plaza.
These links visit the sandbox's representative biomes, not every procedural
variant shown by the dashboards. Unsupported biomes have no jump link.

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
Band 5  RECREATION       PARK/PARK PATH · PLAYGROUND · PITCH · CASTLE/FORT
Band 6  NEW MECHANICS    STREET VARIANTS · SACRED GROVE/OLD STONES/TAR YARD
```

The footprint is 36 x 92 cells, about 252 m x 644 m at 7 m per cell.
`buildLayout` centres it in the start tile. The player teleports to PLAYER
SPAWN, where a synthetic Home trailer keeps the nearby wizard tower in its
wizard role.

## Map-system coverage

| System | Sandbox coverage |
|---|---|
| Vector roads | Decoded `transportation` and `transportation_name` layers drive the live road overlay. |
| Spawn safety | `roadMask`, `roadClass`, `spawnWhy` and the major-road kerb buffer derive from the authored routes; the buffer is stamped one cell wider than the real one, so refusals stay conservative. |
| Street restoration | Half of Lantern Row starts restored, so lit and unlit lamps appear on one road. |
| Street dressing | The live `StreetVariants.dress` pass places hedges, trees, fruit trees, mushrooms, coins, waystones, barricades, tar, stakes and torches. |
| Old trade road | A plain major road carries the bandit-verge bit and a hashed wagon-stop look. |
| Street rewards | Golden Road coins, street lairs and a cafe hoard use their normal generated records. |
| Scenic paths | Common Walk is a `parkpath`; the beach carries a scenic shore mask, tide pool and viewpoint scope. |
| Influence zones | Grove, old-stones and tar anchors carry real zone coverage and run `ZoneDressing`. |
| Shrine kinds | The zones scene's east edge stands one shrine of each `Shrines.SHRINE_KINDS` row, north to south in table order; tap one for its boon. |
| Surface traps | `Traps.spawnSurface` places traps beside paths and park edges from the shared spawn fields. |
| Placed floor | One campfire joins the existing crops, tilled beds and scarecrows. |

### Street variants

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
| snare | Iron Lane | a snare chest ringed by iron teeth |
| barricade | Fort Road | barricades, stakes and guard lair |
| plain minor | Market Close / Maple Street | ordinary street comparison |
| plain major | Old Trade Road | old-trade-road lamps and wagon stop |
| parkpath | Common Walk | scenic path colour, lamps and reward multiplier |

This table covers every rolled minor and major row in
`StreetVariants.STREET_VARIANTS`. Scenic promenade and greenway rows still
need geography that the sandbox does not author.

## Terrain coverage

The surface tile contains every surface terrain code. Cave-only codes 24-26
belong to depth tiles and stay outside this surface sandbox.

| Codes | Terrain | Scene |
|---|---|---|
| 0-6 | grass, forest, sand, water, farmland, residential, park | countryside, beach, centre, town, recreation |
| 7-8 | road, path | connective roads, Maple Street, Common Walk and Civic |
| 9-12 | building tiers and rock | Small House, Castle/Fort and Rock |
| 13-14 | large and medium roads | Main Street, Mill Lane, Fort Road and Old Trade Road |
| 15-23 | school through pier | Civic, Recreation, Marsh, Orchard and Beach |
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
  supplies are in the bag. Dagger, spear and musket relics join the T3 kit.
  Use a scroll, then return Home to check its newly learned crafting recipe.
- Reload resets fire history, creature potion effects and daily tome use, so
  the same fuel can burn again. Scroll learning is retained for crafting checks.

Check Giant/Shrinking body size and health bars, thrown-potion impact effects,
fire resistance, Protection/Immortal damage handling and Time cooldown reset.
The yard uses the real runtime paths; effects expire and targets move normally.
Generation-only chest top-ups and cave tier caps remain covered by node tests.

- The inventory starts with five of every item and at least 20 memories.
- Every relic and armour piece starts at T3. The pickaxe starts at T7 so every
  ore deposit can be mined.
- Energy starts full.
- Sandbox houses start restored, while the wizard house keeps its `wizard`
  role.

## Limits

- Cave floor, wall and lava require synthetic depth tiles, so codes 24-26 and
  cave-only enemies remain in the cave tests and real map.
- The sandbox authors decoded layer objects rather than fetching MVT bytes. It
  exercises downstream map systems, while parser and live fetch coverage stays
  in the fixture/browser tests.
- Park polygon characters and residential lot-ring flora depend on source
  polygon stamps. The sandbox uses the common park profile and its existing
  biome scatter instead.
- Scenic promenade and greenway classification still need coastal and corridor
  geometry beyond the one park path and shore authored here.

Every load rebuilds inventory, gear, crops, released pets, placed rocks,
campfires and street restoration for a predictable baseline. Scene captions
float above the map. To extend the world, add a scene to `BANDS` or a route to
a scene's `routes` table, then update this coverage matrix and
`test/node/sandbox_coverage.test.js`.
