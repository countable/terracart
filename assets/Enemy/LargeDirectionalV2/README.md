# Elevated-view enemy revision

Six 32×32-frame sheets: bugbear, troll, giant bear, ogre, giant reaper and
giant serpent. Rows face north, east, south and west. Columns 0–3 walk;
columns 4–7 show attack anticipation, windup, impact and recovery.

The viewpoint starts overhead, then tilts roughly 45 degrees toward the
south camera. Crowns, shoulders and backs dominate; faces and lower bodies
are foreshortened. Placement and travel use the game's square grid.
CLAUDE.md owns this convention.

Generated with built-in imagegen using the existing big-monster and brute
art as style references. Prompts, original generated sources and native
exports are retained. `index.html` compares these sheets with the previous
version. `frames.json` contains frame mappings and suggested timing.
Bugbear, troll, giant bear, ogre and giant reaper are integrated through the enemy roster and habitat rules. The coiled giant serpent remains a draft; `../SegmentedSerpent/` explores a multi-cell replacement.
