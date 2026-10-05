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
No gameplay integration is included.
