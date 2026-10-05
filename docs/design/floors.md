# Floor catalog

The dungeon runs eight floors underground. Above ground, five tower floors
carry the climbing challenges. Code owns the current numbers; this file lists
what exists and what makes each floor its own.

Rework status: this catalog describes the target layout after the goblin-city
rework - the old floors 2-7 moved down one, a goblin city takes floor 2, each
floor carries a theme, and the ladder, pit, rope and elevator rules below
replace the old stair-chain design. The code still ships the pre-rework
depths until the rework lands: portal stone and the arena gate at floors 3
and 4, elevator repair offered from the surface, the Underdark splash on
floor 3, and ladders and pits on the old schedule.

Depth 0 is the surface. Each cave tile is the negative of the tile above it
(`worldgen.js` `loadCaveTile`), so a floor's identity comes from three things:
its terrain rule, its content windows, and its route in.

## Dungeon floors (depth 1-8)

| Floor | Theme | Terrain and look | Unique to this floor | Signature foes |
| --- | --- | --- | --- | --- |
| 1 | Natural caves with some engineered tunnels | Cave: the negative of the surface's walkable cells | Street and path mirror routes with themes, authored spring caves, barrels, floor torches, rolling-ball pressure plates, quarry gem seams, double mushroom growth, a thin copper seam; pits, holes and sinkhole cave-ins drop into the goblin city below; the only floor where campfires ward monsters (`FIRE_WARD_MAX_DEPTH = 1`) | Bats and slimes, a few goblins (window 1-2) |
| 2 | Goblin city | Only buildings turn to rock wall - roads stay open, unlike every other floor - and goblin-warren rooms laid out nexus-style cover the rest of the floor | The warrens are the floor: rooms claim everything except small clearings, which appear only on road variants and at non-goblin nexus places, the same anchors as floor 1; falls from floor 1's pits land in those clearings; a thin copper seam (the floor 1 share) | The warren family: club, spear and archer goblins, goblin trappers (city window 2-3) |
| 3 | Deep stone | Only surface park, grove, playground, pitch and commercial ground opens; the rest is stone the player must dig through to get anywhere | Digging is the way around: most places need it, and road variants keep about half the roads cleared as tunnels; clearings settle as Deep groves and Dwarven cities with residents, caches and shrines; copper is its mine; ghosts walk the even depths from here | Spider, zombie, spear goblin (3-4) |
| 4 | Underdark: a fungal world, open like the surface | Every cell opens into one cavern - no corridor maze, open ground under the fungi | The portal stone waits here (the first chest of tier 3 or better found a kilometre or more from home); first floor where chest tiers can reach T6; crypt ghosts appear; double mushroom growth returns with the fungi; the arrival story plays here ("The walls fall away into a barren cavern") | Purple slime, mushroom monsters, troll (4-5, troll 4-4) |
| 5 | Haunted layer: a dead city | Mirrors the surface grid - the city above, repeated in ruin and silence | Arena-locked hatches from floor 4 - the five tower trials mint the key that opens them; the dead city keeps the shape of home, and its ghosts keep theirs | Ghosts, sword spirits, vampire bats (5-6) |
| 6 | Lava stratum | Rock under surface buildings turns to lava | Infernal kinds enter the pools; fire elementals appear only here | Fire elemental (6-6), fiend, brute (6-7) |
| 7 | Dragon layer | Mirror of the floor above | First floor where chest tiers can reach T7; ghosts grow larger and double-strength from here (`GHOST_SCALING`); dragons arrive | Dragons and their kin (7-8) |
| 8 | Dragon layer: the deep roosts | Mirror of the floor above | Ore reaches tier 7 (the mine is tiers 6-7); the roosts, one red dragon to a territory; top of the designed dungeon | Red dragons and their roost guards (8-9) |

Beyond 8 the dungeon stays open rather than ending: liches, minotaurs, hell
brutes and armoured demons hold depth 9 and deeper, and ore and chest tiers
hold at their ceilings.

Routes in:

- Downward ladders and pits sit on every floor except 3 and 4. Ladders climb
  down on purpose; pits, holes and sinkholes drop one floor by accident.
  Up-ladders always mirror the ladder above.
- Floors 3 and 4 are sealed against casual descent: no downward ladders, no
  pits, and the rope refuses to go down from them. Down from floor 3 you dig -
  the stone must be broken through. Down from floor 4 the arena-locked
  hatches are the only way.
- The elevator stands at Home. Repair it only from floor 1 - on the surface
  it says the elevator is broken, and nothing can be repaired from there.
  The first fix says: "The elevator machinery whirs to life. It can carry you
  up now but the module for descending is missing." The lift then carries
  only between the surface and floor 1. Ten low-tier chests (tiers 1-2) on
  floor 1 find the descent module; each deeper stop (floors 2 and 3) needs
  its own ten-chest parts find. The fully fixed elevator goes down to
  floor 3.
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
the key that opens the hatches to dungeon floor 5, the haunted city
(`dungeon_progression.js`). The aboveground tower - five climbable floors,
one trial each - is the intended presentation, not yet built. When it is
built, the trials move there unchanged and the key follows the fifth floor's
win.
