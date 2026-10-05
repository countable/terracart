# Hazard animation assets

Square top-down grid, artwork viewed from overhead tilted toward the south. Native sinkhole and whirlwind cells are 48×48; vents are 24×24.

Vents and sinkholes are integrated through `src/environment_hazards.js`; the whirlwind uses `src/whirlwinds.js`. Their clocks advance during foreground gameplay. Seeded visit encounters retain the world's terrain, building and private-land exclusions.

Underground vents repeat 5 seconds inactive, 3 seconds warning, and 3 seconds active. Contact damages the player at most once per second. Fire applies 6 seconds of burning, poison applies 30 seconds of poison, and yellow gas applies 5 seconds of paralysis. Paralysis stops movement and starting/continuing attacks; projectiles already in flight continue. Repeated exposure refreshes the specified duration without shortening a stronger existing condition. Existing immunities apply.

Sinkholes cover a complete 2×2-cell region, excluding buildings and occupied structures. Cracks warn for 5 seconds, followed by a brief opening animation, a seeded 5–20-second open period, and a 0.6-second close. An overlapping player falls one level with no additional fall-damage charge. Destination terrain, objects, creatures and traps are checked before committing the transition; failed or stale loads do not move the player. Falls are involuntary, so ordinary stair/rope progression locks do not stop them. Reserved arena floors are excluded.

Sinkhole warning and closing frames are terrain-independent alpha overlays. The open pit stays dark; the final frame is fully transparent. The art contains no painted occupant.

Whirlwinds form harmlessly, then roam eligible grass/school ground and damage/push nearby characters. Player knockback changes the movement offset, not raw GPS.

`vent-cycle-complete.png` has five columns (inactive, two warning, two active) and three rows (poison, fire, paralysis). `vent-inactive.png` has one inactive cell per row. `pack-vents.cjs` retains the approved stone ring and replaces plume-colored aperture pixels using the generated inactive reference. The old four-column cycle remains for compatibility. All three inactive states are used by the repeating vent cycle.

`index.html` previews all cycles over grass, stone, snow or transparency checks. `frames.json` describes layout. `export.cjs` packs original generation sources without smoothing. The prior opaque-soil sinkhole is retained as `sinkhole-ground-patch.png` for comparison.
