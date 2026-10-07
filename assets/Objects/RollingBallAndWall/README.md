# Rolling ball and raised spike wall

Both assets use transparent 24×24 frames. The smooth ball replaces the
spiked design. Its round silhouette stays fixed while an uneven seam and
contrasting surface patches move across it. Fixed lighting makes those marks
read as rotation rather than a moving light source.

The ball sheet contains four rows (north, northeast, east, southeast), with
eight phases per row. Opposite directions play the matching row in reverse.
Drive phase from distance traveled: `turns = distance / (2 * Math.PI * radius)`.
Use the displayed radius and distance in the same units. Stop advancing phase
when the ball stops. The preview's speed slider demonstrates this behavior.

The wall has north, east, south and west facings in a 2×2 sheet. Its raised
face stays visible while its beam remains horizontal or vertical on the
square grid. Slide the selected frame across a cell without rotating the
sprite in the screen plane.

Generated with built-in imagegen. Sources and prompts are retained;
`frames.json` records mappings and `export-checks.json` records packing.
Integrated in `src/pressure_traps.js` on dungeon level 1. A neutral pressure plate (existing `cave_mechanisms` frames 2/3) releases a ball or cardinal spike wall toward the player when stepped on. Each encounter fires once. The trap travels at 0.25 cells per second for up to six cells, stopping at blocked ground. Moving trap contact pushes the body safely along its travel direction. Activated traps deal 5 damage per second while touching the player, with fractional damage carried between frames; stopped traps cease pushing. Invulnerability prevents damage. Raw GPS stays unchanged.

Placement is seeded independently, respects cave floor/exclusion/occupancy rules, and reserves space from the other new hazards. Ball rotation follows actual travel, including reversed rows for opposite directions; a stopped ball stops rolling. Plates and traps use the existing world depth ordering.
