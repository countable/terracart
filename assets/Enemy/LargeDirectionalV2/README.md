# Large directional enemies

Five approved 32×32-frame sheets: bugbear, troll, giant bear, ogre and giant
reaper. Rows face north, east, south and west. Columns 0–3 walk; columns 4–7
show attack anticipation, windup, impact and recovery.

The viewpoint starts overhead, then tilts roughly 45 degrees toward the
south camera. Crowns, shoulders and backs dominate; faces and lower bodies
are foreshortened. Placement and travel use the game's square grid.

Generated with built-in imagegen using the existing big-monster and brute
art as style references. `prompts.json` records prompts; `frames.json`
records layout and suggested preview timings. `src/enemy_roster.js` owns
live movement and combat timing, art scale, stats and spawn eligibility.
The giant serpent remains a separate draft prototype with no live spawns.
