# Floor catalog

The dungeon runs eight floors underground. Above ground, five tower floors
carry the climbing challenges. Code owns the current numbers; this file lists
what exists and what makes each floor its own.

The approved wall ladder is implemented in `WorldGen.FLOOR_PROFILES`: sewer
at 1, the prior natural cave terrain at 2, goblin warrens at 3, deep stone and
dwarves at 4, an open fungal cavern at 5, lava at 6 and dragon masonry at 7–8.
The game and floor viewer share these wall rules and approved material schemes.
L2 reads the original surface geometry directly and keeps the natural authored
area selection seed; its wall material is the approved lighter Abandoned Mines
scheme. Existing depth-based encounter/ore progression, travel gates and saved
IDs remain at their physical depths. The portal stone and arena key therefore
retain their existing progression depths during this wall-only update.

Still pending: the elevator rework (repair from floor 1, the descent module),
the wizard-tower key for 6 -> 7, and stair minting - generated down-ladders
still connect sealed floors, so only the rope, pit and arena-key gates of the
matrix below are live. The target rows below also include unimplemented
geometry: road-variant tunnels on 4, the dug descent
shaft, surface-shaped fungal beds, fungal vent skins and mushroom foes,
haunted-city ruin/cache dressing, lava heat shelters, and the largest-opening
roost/egg design. These remain proposals in
[floor-geometry-proposal.md](floor-geometry-proposal.md); existing wall digging,
ordinary mushrooms, crypt haunting and finite roost encounters remain in use.
Every input that defines a floor is catalogued in
[floor-design-review.html](floor-design-review.html).

Depth 0 is the surface. Each cave tile derives from the immutable surface or
its generated predecessor, as selected by `WorldGen.floorProfile`, so a floor's identity comes from three things:
its terrain rule, its content windows, and its route in.

## Sky floor (depth -1)

One level above the ground (`WorldGen.SKY_DEPTH`), the sky floor holds trials
over groves. Each sky tile is a copy of the surface tile's grove coverage as
white floor (`CAVE_FLOOR`, painted by `Render.undergroundGroundColor` for the
`sky` biome) over open air (`CAVE_WALL`, which blocks movement); nothing
spawns there and it has its own tile cache (`loadSkyTile`). An awakened grove
temple whose trial is the hidden way (`TemplePuzzles` `path`) lifts the player
onto the trial's seat (`TempleLayout.plan`) through `_realmSwitchDepth`, the
arena's switch. The route glows on the ground for
`TemplePuzzles.PATH_REVEAL_SECONDS` while the player waits on A; each cell step
is judged by `TemplePuzzles.move`, and a wrong step or leaving the square
replays the preview from A. Tapping A (or B once won) returns to the temple
door; a reload mid-trial does the same (`_recoverSkyRun`). The other temple
trials still run in the paused overlay scene (`temple_scene.js`).

## Dungeon floors (depth 1-8)

| Floor | Theme | Terrain and look | Unique to this floor | Signature foes |
| --- | --- | --- | --- | --- |
| 1 | Sewer | Brick walls under surface buildings; open route/channel surfaces | Sewer geometry does not create new water hazards; ordinary shallow-floor features retain their existing rules | Existing depth-1 roster |
| 2 | Natural caves | Prior L1 wall mask: buildings, water and Small roads form rock; Medium/Large roads and paths stay open | Original natural authored areas and selection seed, quarry provenance, floor torches and barrels; lighter Abandoned Mines walls | Existing depth-2 roster |
| 3 | Goblin warrens | Building-only base walls, connected warren rooms across eligible ground | Open doors and protected route/landmark approaches; existing authored stores and pressure traps move with the warren profile | Existing depth-3 roster |
| 4 | Deep stone + dwarves | Stone surrounding buffered road/path tunnels and eligible park, grove, playground, pitch and commercial clearings | Clearings carry Deep groves and Dwarven cities; approved blue masonry | Existing depth-4 roster |
| 5 | Fungal Underdark | One open cavern; no rockwalls | Fungal wall art is a comparison sample only; arena key gate remains at depth 5 | Existing depth-5 roster |
| 6 | Lava + demons | Surface-derived walls; building footprints become ground-level lava pits | Near-black basalt caps; stable one-in-four cracked face variants on remaining rockwalls | Fire elementals and existing depth-6 roster |
| 7 | Dragons | Surface-derived rock masses with Dreams violet masonry | Independent of open L5 and lava cells above | Existing dragon roster |
| 8 | Deep roosts | Same dragon masonry and surface-derived wall rule | Existing finite dragon-roost placement | Red dragons and roost guards |

Beyond 8 the dungeon stays open rather than ending: liches, minotaurs, hell
brutes and armoured demons hold depth 9 and deeper, and ore and chest tiers
hold at their ceilings.

Routes in - four gated descents split the dungeon; everything else is open:

| Segment | Ways down | Ways back up |
| --- | --- | --- |
| 1 → 2 | Ladders, pits and sinkhole cave-ins, rope | Up-ladders (always mirrored) |
| 2 → 3 | The elevator only - its floor 3 stop needs the ten-chest parts find. No ladders or pits drop into floor 3, and the rope refuses | The elevator |
| 3 → 4 | Dig - the stone must be broken through. No ladders, no pits, rope refuses | The shaft you dug stays open; climb back up it |
| 4 → 5 | The arena-locked hatches only - the portal stone found here opens the arena on the surface, five trial wins mint the key | The hatches, once unlocked |
| 5 → 6 | Ladders, pits, rope | Up-ladders (always mirrored) |
| 6 → 7 | The wizard-tower key only - raising the second wizard tower yields it (the 52nd restoration, once the first tower stands and 21 memories are home). No ladders or pits drop into the dragon layer, and the rope refuses | The hatches, once unlocked |
| 7 → 8 and below | Ladders, pits, rope | Up-ladders (always mirrored) |

So floors 2, 3, 4 and 6 own no downward ladders and no pits: the goblin city
ends at the elevator, the deep stone at the dig, the Underdark at the trial
key, and the lava stratum at the wizard's key. The wizard fits the layer he
unlocks - his tower's lessons train dragon hunters (`story.txt`).
- The elevator stands at Home. Repair it only from floor 1 - on the surface
  it says the elevator is broken, and nothing can be repaired from there.
  The first fix says: "The elevator machinery whirs to life. It can carry you
  up now but the module for descending is missing." The lift then carries
  only between the surface and floor 1. Ten low-tier chests (tiers 1-2) on
  floor 1 find the descent module; each deeper stop (floors 2 and 3) needs
  its own ten-chest parts find. The fully fixed elevator goes down to
  floor 3. Until the lift serves the floor you are on (the repair for
  floor 1, or that floor's own parts find), it offers no trip Home: climb
  out by ladder or rope.
- The portal stone, found on floor 4, opens the arena portal when carried to
  the surface.

## Tower floors (aboveground, climbing challenges)

Five trials, one per floor, climbed in order. The trial rules live in
`Arena.CHALLENGES` (`arena.js`); this table is the catalog.

| Floor | Trial | Rule |
| --- | --- | --- |
| 1 | Gather the stars | Touch all eight golden sparks (four corners, four midpoints) |
| 2 | The rune sequence | Visit the four runes in their numbered order, no clock |
| 3 | Swift circuit | Touch the four numbered gates in order within 60 seconds |
| 4 | Dance of light | Survive 30 seconds; dodge the moving beam; three hits end the trial |
| 5 | Keep the flame | Hold the central circle 15 seconds total; dodge expanding rings; three hits end the trial |

Status: the five trials run today in the flat Transcendent Arena (depth 100),
entered through a progression portal on safe surface ground; five wins mint
the key that opens the hatches to dungeon floor 5, the fungal Underdark
(`dungeon_progression.js`). The aboveground tower - five climbable floors,
one trial each - is the intended presentation, not yet built. When it is
built, the trials move there unchanged and the key follows the fifth floor's
win.
