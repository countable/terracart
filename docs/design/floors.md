# Floor catalog

The dungeon runs eight floors underground. Above ground, five tower floors
carry the climbing challenges. Code owns the current numbers; this file lists
what exists and what makes each floor its own.

Depth 0 is the surface. Each cave tile is the negative of the tile above it
(`worldgen.js` `loadCaveTile`), so a floor's identity comes from three things:
its terrain rule, its content windows, and its route in.

## Dungeon floors (depth 1-8)

| Floor | Terrain and look | Unique to this floor | Signature foes |
| --- | --- | --- | --- |
| 1 | Cave: the negative of the surface's walkable cells | Street and path mirror routes with themes, authored spring caves, chasms that fall to floor 2, barrels, floor torches, rolling-ball pressure plates, quarry gem seams, double mushroom growth; the stair chain stops here by design (rope, elevator or a fall descends); the only floor where campfires ward monsters (`FIRE_WARD_MAX_DEPTH = 1`) | Cave slime, bat, club goblin (window 1-2) |
| 2 | Deep stone: only surface park, grove, playground, pitch and commercial ground opens | Clearings settle as Deep groves and Dwarven cities with residents, caches and shrines; chasm landings carved for falls from floor 1; last floor with the street mirror; copper is its mine (ore tier 2) | Spider, zombie, spear goblin (2-3), ghosts on even depths |
| 3 | Underdark: every cell opens into one barren cavern | Chest mirrors read the surface layer directly; first floor where chest tiers can reach T6; crypt ghosts appear (`minCryptDepth: 3`) | Purple slime, skeleton, troll (3-4, troll 3-3) |
| 4 | Mirror of the surface grid itself | Gated behind the level-4 key (five tower trials); double mushroom growth returns | Orc, vampire bat, bomb goblin (4-5) |
| 5 | Lava stratum: rock under surface buildings turns to lava | Infernal kinds enter the pools; fire elementals appear only here (5-5) | Fire elemental, fiend, brute (5-6) |
| 6 | Mirror of the floor above | First floor where chest tiers can reach T7; ghosts grow larger and double-strength from here (`GHOST_SCALING`) | Necromancer, orc mage, dryad (6-7) |
| 7 | Mirror of the floor above | Ore reaches tier 7 (the mine is tiers 6-7) | Succubus, orc shaman, bone plant (7-8) |
| 8 | Mirror of the floor above | Top of the designed dungeon; the mine stays tiers 6-7 | Lich, minotaur, red demon (8 on) |

Beyond 8 the dungeon stays open rather than ending: hell brutes, armoured
demons and dragon roosts (one red dragon per region) hold depth 9 and deeper,
and ore and chest tiers hold at their ceilings.

Routes in:

- Stairs wander from floor 2 down; up-stairs always mirror the down-stair above.
- The elevator serves floors 0-3 (`elevators.js` `FLOORS`). Opening ten
  low-tier chests (tiers 1-2) on a floor finds that floor's parts.
- Ropes descend one floor from the surface; chasms and sinkholes drop one
  floor involuntarily.

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
the level-4 key that opens dungeon floor 4 (`dungeon_progression.js`). The
aboveground tower - five climbable floors, one trial each - is the intended
presentation, not yet built. When it is built, the trials move there unchanged
and the key follows the fifth floor's win.
