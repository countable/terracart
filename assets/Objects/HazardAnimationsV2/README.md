# Hazard animation assets

Square top-down grid, artwork viewed from overhead tilted toward the south. Native sinkhole and whirlwind cells are 48×48; vents are 24×24.

The sinkhole is now a terrain-independent alpha overlay: cracks and fragments in warning/closing frames, opaque dark pit when open, and a fully transparent final frame. Ground remains visible between cracks. Occupants must be drawn separately and lowered/hidden before closing; this sheet does not introduce sinkhole encounters.

Whirlwind formation and active animation are integrated through `src/whirlwinds.js`. Formation is harmless; the active whirlwind roams eligible grass/school ground and damages/pushes nearby characters. Player knockback changes the movement offset, not raw GPS.

`vent-cycle-complete.png` has five columns (inactive, two warning, two active) and three rows (poison, fire, paralysis). `vent-inactive.png` has one inactive cell per row. `pack-vents.cjs` retains the approved stone ring and replaces plume-colored aperture pixels using the generated inactive reference. The old four-column cycle remains for compatibility. The matching poison inactive sprite also replaces the local game's previous differently shaped inactive prop.

`index.html` previews all cycles over grass, stone, snow or transparency checks. `frames.json` describes layout. `export.cjs` packs original generation sources without smoothing. The prior opaque-soil sinkhole is retained as `sinkhole-ground-patch.png` for comparison.
